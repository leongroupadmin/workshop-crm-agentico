import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarTelefono, sePuedeEscribirPrimero } from "@/lib/telefono";
import { proveedorDe, type Proveedor } from "@/lib/mensajeria";

/**
 * Cómo nace una conversación de WhatsApp cuando no la abre el webhook.
 *
 * Lo normal es que el chat lo cree el primer mensaje entrante. Pero cuando el
 * primero en escribir somos nosotros —el botón de "escribir" de la bandeja— hace
 * falta exactamente la conversación que armaría el webhook: mismo proveedor,
 * misma cuenta y el mismo id de chat. Si se guardara con otro formato, la charla
 * aparecería partida en dos apenas la persona conteste.
 */

type Supabase = SupabaseClient;

/** Por dónde sale un chat que arrancamos nosotros. */
export type Salida =
  | { ok: true; provider: Extract<Proveedor, "ycloud">; accountId: string }
  | { ok: false; error: string };

/**
 * Por dónde escribirle primero a alguien en este workspace.
 *
 * Se mira la conversación de WhatsApp más reciente y se sale por donde salen
 * las demás: el CRM puede tener los dos proveedores conectados a la vez, y
 * arrancar una charla por uno distinto del que usa el equipo dejaría un chat
 * que después nadie puede contestar.
 *
 * Zernio queda afuera a propósito. Su API manda mensajes a una conversación
 * que ya existe y no tiene con qué crearla desde un teléfono: no es que no lo
 * hayamos implementado, es que del otro lado no hay por dónde.
 */
export async function salidaParaEscribirPrimero(
  supabase: Supabase,
  workspaceId: string,
): Promise<Salida> {
  const { data } = await supabase
    .from("conversations")
    .select("provider, zernio_account_id")
    .eq("workspace_id", workspaceId)
    .eq("channel", "whatsapp")
    .not("zernio_account_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  let huboZernio = false;

  for (const fila of data ?? []) {
    const provider = proveedorDe(fila.provider as string | null);
    const accountId = ((fila.zernio_account_id as string | null) ?? "").trim();
    if (!accountId) continue;

    if (provider === "zernio") {
      huboZernio = true;
      continue;
    }

    return { ok: true, provider, accountId };
  }

  // Todavía no entró ningún mensaje: se cae al entorno, que es lo único que
  // queda por consultar.
  const ycloud = (process.env.YCLOUD_PHONE_NUMBER ?? "").trim();
  if (ycloud) return { ok: true, provider: "ycloud", accountId: ycloud };

  if (huboZernio) {
    return {
      ok: false,
      error:
        "Las conversaciones de este WhatsApp salen por Zernio, que no permite empezar una charla desde el CRM. El chat se abre solo cuando el contacto escribe.",
    };
  }

  return {
    ok: false,
    error:
      "Todavía no hay un WhatsApp conectado desde el que escribir. Vinculalo en Ajustes y volvé a intentar.",
  };
}

/**
 * El id con el que el proveedor nombra al chat de este contacto.
 *
 * Tiene que coincidir letra por letra con el que va a mandar el webhook cuando
 * la persona conteste, o la respuesta cuelga de una conversación nueva.
 */
export function chatIdDelContacto(
  salida: Extract<Salida, { ok: true }>,
  telefono: string | null,
): string | null {
  // La misma regla que decide a quién le ofrecemos el botón de escribir: si se
  // separaran, la bandeja volvería a listar contactos cuyo chat no se puede
  // abrir.
  if (!sePuedeEscribirPrimero(telefono)) return null;

  // En YCloud la conversación es el par de números, y el del contacto va en el
  // mismo formato que el nuestro —con o sin `+`— tal como lo escribe YCloud.
  return normalizarTelefono(telefono, salida.accountId.startsWith("+") ? "con-mas" : "solo-digitos");
}

/**
 * Abre la conversación de un contacto al que nunca le escribimos.
 *
 * Se arma igual que la que crearía el webhook, así cuando la persona conteste
 * el evento entrante la encuentra en vez de duplicarla.
 *
 * Si el chat ya estaba tomado por otra conversación del workspace, se usa esa:
 * es el mismo WhatsApp, aunque figure con dos fichas distintas.
 */
export async function abrirConversacion(
  supabase: Supabase,
  input: {
    workspaceId: string;
    contactId: string;
    provider: Proveedor;
    chatId: string;
    accountId: string;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      channel: "whatsapp",
      provider: input.provider,
      zernio_chat_id: input.chatId,
      zernio_account_id: input.accountId,
      status: "open",
    })
    .select("id")
    .single();

  if (!error) return (data?.id as string) ?? null;

  const { data: existente } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("zernio_chat_id", input.chatId)
    .maybeSingle();

  if (existente?.id) return existente.id as string;

  console.error("[whatsapp] no se pudo abrir la conversación:", error.message);
  return null;
}
