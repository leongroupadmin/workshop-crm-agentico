import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { etapaDeEntrada } from "@/lib/embudos";
import { toChannel } from "@/lib/zernio";
import {
  listZernioConversations,
  listZernioMessages,
  type ZernioConversationSummary,
} from "@/lib/zernio-api";

export type ImportSummary = {
  conversaciones: number;
  contactos: number;
  mensajes: number;
  omitidas: number;
};

/** Cuántas conversaciones se traen en paralelo, para no agotar el rate limit. */
const BATCH_SIZE = 4;

/**
 * Trae de Zernio las conversaciones que ya existen y las vuelca al CRM.
 *
 * Sirve para dos cosas: cargar el historial previo a la conexión, y destrabar
 * el caso en que el webhook todavía no dispara. Es idempotente —las claves
 * `zernio_chat_id` y `zernio_message_id` son únicas—, así que correrla dos
 * veces no duplica nada.
 */
export async function importFromZernio(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }> {
  const listed = await listZernioConversations(100);
  if (!listed.ok) return { ok: false, error: listed.error };

  const summary: ImportSummary = { conversaciones: 0, contactos: 0, mensajes: 0, omitidas: 0 };

  // Las cuentas se registran primero: es lo que después le permite al webhook
  // resolver el workspace sin depender del auto-asociado.
  await registerAccounts(supabase, workspaceId, listed.conversations);

  for (let index = 0; index < listed.conversations.length; index += BATCH_SIZE) {
    const batch = listed.conversations.slice(index, index + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((conversation) => importOne(supabase, workspaceId, conversation)),
    );

    for (const result of results) {
      if (!result) {
        summary.omitidas += 1;
        continue;
      }
      summary.conversaciones += 1;
      summary.mensajes += result.messages;
      if (result.contactCreated) summary.contactos += 1;
    }
  }

  return { ok: true, summary };
}

async function registerAccounts(
  supabase: SupabaseClient,
  workspaceId: string,
  conversations: ZernioConversationSummary[],
) {
  const seen = new Map<string, string>();
  for (const item of conversations) {
    if (item.accountId && !seen.has(item.accountId)) {
      seen.set(item.accountId, item.platform ?? "");
    }
  }
  if (seen.size === 0) return;

  const { error } = await supabase.from("zernio_accounts").upsert(
    [...seen].map(([accountId, platform]) => ({
      zernio_account_id: accountId,
      workspace_id: workspaceId,
      platform,
    })),
    { onConflict: "zernio_account_id", ignoreDuplicates: true },
  );

  if (error) console.error("[zernio] no se pudieron registrar las cuentas:", error.message);
}

type ImportedConversation = { messages: number; contactCreated: boolean };

async function importOne(
  supabase: SupabaseClient,
  workspaceId: string,
  conversation: ZernioConversationSummary,
): Promise<ImportedConversation | null> {
  const channel = toChannel(conversation.platform ?? "");
  if (!channel || !conversation.accountId) return null;

  const contact = await resolveContact(supabase, workspaceId, channel, conversation);
  if (!contact) return null;

  const { data: saved, error } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: workspaceId,
        contact_id: contact.id,
        channel,
        zernio_chat_id: conversation.id,
        zernio_account_id: conversation.accountId,
      },
      { onConflict: "workspace_id,zernio_chat_id" },
    )
    .select("id")
    .single();

  if (error || !saved) {
    console.error("[zernio] no se pudo importar la conversación", conversation.id, error?.message);
    return null;
  }

  await ensureOpportunity(supabase, workspaceId, contact.id);

  const messages = await importMessages(supabase, saved.id, conversation);

  return { messages, contactCreated: contact.created };
}

async function importMessages(
  supabase: SupabaseClient,
  conversationId: string,
  conversation: ZernioConversationSummary,
): Promise<number> {
  const history = await listZernioMessages(conversation.id, conversation.accountId!);
  if (!history.ok) {
    console.error("[zernio] no se pudo traer el historial", conversation.id, history.error);
    return 0;
  }
  if (history.messages.length === 0) return 0;

  const { error } = await supabase.from("messages").upsert(
    history.messages.map((message) => ({
      conversation_id: conversationId,
      sender_type: message.incoming ? "contact" : "user",
      content: message.text,
      media_url: message.mediaUrl,
      zernio_message_id: message.id,
      created_at: message.createdAt,
    })),
    { onConflict: "zernio_message_id", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[zernio] no se pudieron guardar los mensajes", conversation.id, error.message);
    return 0;
  }

  return history.messages.length;
}

/**
 * Igual que en el webhook: se busca por la identidad del canal antes de crear,
 * para que la misma persona no aparezca duplicada entre WhatsApp e Instagram.
 */
async function resolveContact(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: string,
  conversation: ZernioConversationSummary,
): Promise<{ id: string; created: boolean } | null> {
  const externalId = conversation.participantId;

  if (externalId) {
    const { data } = await supabase
      .from("contact_identities")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", channel)
      .eq("external_id", externalId)
      .maybeSingle();

    if (data?.contact_id) return { id: data.contact_id, created: false };
  }

  const name =
    conversation.participantName || conversation.participantUsername || "Contacto sin nombre";

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name,
      avatar_url: conversation.participantPicture ?? null,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[zernio] no se pudo crear el contacto", error?.message);
    return null;
  }

  if (externalId) {
    await supabase.from("contact_identities").upsert(
      {
        workspace_id: workspaceId,
        platform: channel,
        external_id: externalId,
        contact_id: created.id,
      },
      { onConflict: "workspace_id,platform,external_id", ignoreDuplicates: true },
    );
  }

  return { id: created.id, created: true };
}

async function ensureOpportunity(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
) {
  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const stageId = await etapaDeEntrada(supabase, workspaceId);
  if (!stageId) return;

  await supabase
    .from("opportunities")
    .insert({ workspace_id: workspaceId, contact_id: contactId, stage_id: stageId });
}
