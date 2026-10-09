import "server-only";

import {
  causaDelRechazo,
  describeError,
  type CausaDeRechazo,
} from "@/lib/zernio-errores";

/**
 * Cliente REST de Zernio, para el sentido saliente.
 *
 * El webhook no necesita esto: los mensajes entrantes los empuja Zernio y se
 * autentican con el secreto HMAC. La API key hace falta solo para responder.
 *
 * Contrato tomado del adaptador oficial (github.com/zernio-dev/chat-sdk-adapter):
 * Bearer token, base `https://zernio.com/api`, y el `accountId` va en el cuerpo.
 */

const DEFAULT_BASE_URL = "https://zernio.com/api";

export type SendResult =
  | { ok: true; messageId?: string }
  /**
   * `status` es el código HTTP que devolvió el proveedor, cuando hubo uno.
   * Quien envía lo mira para distinguir un fallo que se puede reintentar de
   * otro que no: un 403 sobre la cuenta se arregla volviendo a atarla, un 400
   * por el contenido del mensaje no.
   */
  | { ok: false; error: string; status?: number; causa?: CausaDeRechazo };

export type { CausaDeRechazo };

/**
 * Manda un mensaje de texto a una conversación de Zernio.
 *
 * `conversationId` es el `zernio_chat_id` guardado en `conversations`, no el id
 * de nuestra tabla.
 */
export async function sendZernioMessage(input: {
  conversationId: string;
  accountId: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Falta la variable ZERNIO_API_KEY en el entorno." };
  }

  const baseUrl = (process.env.ZERNIO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/v1/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accountId: input.accountId, message: input.text }),
    });
  } catch (error) {
    console.error("[zernio] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con Zernio." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[zernio] la API rechazó el envío", response.status, detail);
    return {
      ok: false,
      error: describeError(response.status, detail, input.accountId),
      status: response.status,
      causa: causaDelRechazo(response.status, detail),
    };
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: { messageId?: string } }
    | null;

  return { ok: true, messageId: body?.data?.messageId };
}

/** Lo que Zernio entiende en `attachmentType`. */
export type ZernioAdjunto = "audio" | "image" | "video";

/**
 * Manda un adjunto a una conversación de Zernio.
 *
 * El adjunto va en `attachmentUrl` y `attachmentType`, no en un arreglo: la
 * primera versión de esto espejaba la forma en que los adjuntos *llegan* por el
 * webhook (`{ type, url }`) y Zernio la rechazaba, porque el sentido saliente
 * usa otro contrato.
 *
 * `voiceNote` es lo que separa una nota de voz —la burbuja con la onda y el
 * play— de un archivo de audio adjunto. Sólo vale con OGG/Opus: en cualquier
 * otro formato hay que mandarlo en false o el canal lo rebota. En una imagen o
 * un video no significa nada, así que no se manda.
 */
export async function sendZernioAttachment(input: {
  conversationId: string;
  accountId: string;
  attachmentUrl: string;
  attachmentType: ZernioAdjunto;
  /** Sólo para OGG/Opus. Manda el audio como nota de voz y no como adjunto. */
  voiceNote?: boolean;
  caption?: string;
}): Promise<SendResult> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Falta la variable ZERNIO_API_KEY en el entorno." };
  }

  const baseUrl = (process.env.ZERNIO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/v1/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Si el envío llega pero la respuesta se pierde, el reintento no manda
        // el archivo dos veces.
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        accountId: input.accountId,
        attachmentUrl: input.attachmentUrl,
        attachmentType: input.attachmentType,
        ...(input.attachmentType === "audio" ? { voiceNote: input.voiceNote === true } : {}),
        // Un texto vacío junto a un adjunto es un campo de más: se manda sólo
        // si de verdad hay algo que decir.
        ...(input.caption ? { message: input.caption } : {}),
      }),
    });
  } catch (error) {
    console.error("[zernio] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con Zernio." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[zernio] rechazó el adjunto", input.attachmentType, response.status, detail);
    // Se traduce igual que el texto. Antes el audio devolvía el error crudo a
    // propósito, para no perder lo que contestaba Zernio; ahora la traducción
    // ya lo cita, así que no hay nada que preservar quedándose afuera.
    return {
      ok: false,
      error: describeError(response.status, detail, input.accountId),
      status: response.status,
      causa: causaDelRechazo(response.status, detail),
    };
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: { messageId?: string } }
    | null;

  return { ok: true, messageId: body?.data?.messageId };
}

export type ZernioConversationSummary = {
  id: string;
  platform?: string;
  accountId?: string;
  participantId?: string;
  participantName?: string;
  participantUsername?: string;
  participantPicture?: string;
  status?: string;
  updatedAt?: string;
};

export type ListResult =
  | { ok: true; conversations: ZernioConversationSummary[] }
  | { ok: false; error: string };

/**
 * Lista las conversaciones que Zernio tiene de su lado.
 *
 * Sirve para separar dos fallas que se ven igual desde el CRM: que Zernio no
 * tenga el mensaje, o que lo tenga y no esté disparando el webhook.
 */
export async function listZernioConversations(limit = 20): Promise<ListResult> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable ZERNIO_API_KEY en el entorno." };

  const baseUrl = (process.env.ZERNIO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/inbox/conversations?limit=${limit}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    console.error("[zernio] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con Zernio." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: describeError(response.status, detail) };
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: unknown[]; conversations?: unknown[] }
    | null;

  // La respuesta viene envuelta en `data`; se tolera `conversations` por si
  // cambia el envoltorio.
  const rows = body?.data ?? body?.conversations ?? [];

  return {
    ok: true,
    conversations: (Array.isArray(rows) ? rows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        platform: asText(item.platform),
        accountId: asText(item.accountId),
        participantId: asText(item.participantId),
        participantName: asText(item.participantName),
        participantUsername: asText(item.participantUsername),
        participantPicture: asText(item.participantPicture),
        status: asText(item.status),
        updatedAt: asText(item.lastMessageAt ?? item.updatedTime ?? item.updatedAt),
      };
    }),
  };
}

export type ZernioHistoryMessage = {
  id: string;
  text: string;
  incoming: boolean;
  mediaUrl: string | null;
  createdAt: string;
};

export type HistoryResult =
  | { ok: true; messages: ZernioHistoryMessage[] }
  | { ok: false; error: string };

/**
 * Trae el historial de una conversación.
 *
 * La respuesta REST no tiene la misma forma que el webhook: el cuerpo viene en
 * `message` y no en `text`, la fecha es `createdAt` y no `sentAt`, y el emisor
 * viene aplanado. El propio SDK oficial documenta que confundir las dos formas
 * fue un bug, así que acá se normaliza al entrar.
 */
export async function listZernioMessages(
  conversationId: string,
  accountId: string,
  limit = 50,
): Promise<HistoryResult> {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable ZERNIO_API_KEY en el entorno." };

  const baseUrl = (process.env.ZERNIO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const params = new URLSearchParams({ accountId, limit: String(limit), sortOrder: "desc" });
  const url = `${baseUrl}/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    return { ok: false, error: "No se pudo conectar con Zernio." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: describeError(response.status, detail, accountId) };
  }

  const body = (await response.json().catch(() => null)) as { messages?: unknown[] } | null;
  const rows = Array.isArray(body?.messages) ? body.messages : [];

  return {
    ok: true,
    messages: rows.flatMap((row) => {
      const item = row as Record<string, unknown>;
      const id = asText(item.id);
      if (!id) return [];

      const attachments = Array.isArray(item.attachments) ? item.attachments : [];
      const first = attachments[0] as { url?: unknown } | undefined;

      return [
        {
          id,
          text: asText(item.message) ?? "",
          incoming: item.direction !== "outgoing",
          mediaUrl: asText(first?.url) ?? null,
          createdAt: asText(item.createdAt) ?? asText(item.sentAt) ?? new Date().toISOString(),
        },
      ];
    }),
  };
}

const asText = (value: unknown) => (typeof value === "string" ? value : undefined);
