import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Channel } from "@/types/database";

/**
 * Contrato de los webhooks de Zernio.
 *
 * Verificado contra el adaptador oficial (github.com/zernio-dev/chat-sdk-adapter):
 * el cuerpo se firma con HMAC-SHA256 usando el secreto del webhook y la firma
 * viaja en hexadecimal en `X-Zernio-Signature` (o `X-Late-Signature`, el header
 * heredado).
 */

export type ZernioAttachment = {
  type: "image" | "video" | "audio" | "file" | "sticker" | "share" | "location" | "contact";
  url: string;
};

export type ZernioSender = {
  id: string;
  name?: string;
  username?: string;
  picture?: string;
  phoneNumber?: string;
};

export type ZernioMessagePayload = {
  id: string;
  event: string;
  timestamp: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: "incoming" | "outgoing";
    text: string | null;
    attachments?: ZernioAttachment[];
    sender: ZernioSender;
    sentAt: string;
  };
  conversation: {
    id: string;
    platformConversationId: string;
    participantId?: string;
    participantName?: string;
    participantUsername?: string;
    participantPicture?: string;
    status: "active" | "archived";
  };
  account: {
    id: string;
    platform: string;
    username: string;
    displayName?: string;
  };
};

/**
 * Compara la firma recibida contra el HMAC del cuerpo crudo.
 *
 * `rawBody` tiene que ser el texto exacto que llegó: si se vuelve a serializar
 * el JSON, la firma deja de coincidir.
 */
export function verifyZernioSignature(rawBody: string, signature: string, secret: string): boolean {
  // Algunos proveedores prefijan el algoritmo (`sha256=abc...`).
  const clean = signature.trim().replace(/^sha256=/i, "");
  const digest = (encoding: "hex" | "base64") =>
    createHmac("sha256", secret).update(rawBody).digest(encoding);

  // Se prueban las dos codificaciones habituales del mismo HMAC. No debilita
  // nada: cada intento sigue siendo una comparación real contra el secreto, y
  // ahorra un 401 imposible de diagnosticar si Zernio firma en base64.
  return equals(clean, digest("hex"), "hex") || equals(clean, digest("base64"), "base64");
}

function equals(received: string, expected: string, encoding: "hex" | "base64"): boolean {
  const a = Buffer.from(received, encoding);
  const b = Buffer.from(expected, encoding);

  // timingSafeEqual exige longitudes iguales; distinta longitud ya es inválida.
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Compara el token que viaja en la query contra el secreto compartido.
 *
 * Es la alternativa para cuando el proveedor no firma el cuerpo: sin firma no
 * hay nada que verificar, y la única prueba de autenticidad posible es que
 * quien llama conozca el secreto. Es más débil que el HMAC —las URLs quedan
 * escritas en logs y proxies— así que se usa solo si no hay firma.
 */
export function verifyZernioToken(token: string, secret: string): boolean {
  const received = Buffer.from(token);
  const expected = Buffer.from(secret);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Headers donde puede venir la firma, del más específico al más genérico. */
const SIGNATURE_HEADERS = [
  "x-zernio-signature",
  "x-late-signature",
  "x-webhook-signature",
  "x-hub-signature-256",
  "x-signature",
  "signature",
];

const EVENT_HEADERS = ["x-zernio-event", "x-late-event", "x-webhook-event", "x-event"];

/**
 * Lee la firma y el evento.
 *
 * Se recorre una lista de headers porque el nombre exacto varía entre versiones
 * de Zernio, y un header con otro nombre daba un 401 idéntico al de una firma
 * incorrecta: dos causas muy distintas, imposibles de distinguir desde afuera.
 * Por eso también se devuelven los nombres recibidos, para el diagnóstico.
 */
export function readZernioHeaders(request: Request) {
  const find = (names: string[]) => {
    for (const name of names) {
      const value = request.headers.get(name);
      if (value) return { name, value };
    }
    return null;
  };

  const signature = find(SIGNATURE_HEADERS);
  const event = find(EVENT_HEADERS);

  return {
    signature: signature?.value ?? null,
    signatureHeader: signature?.name ?? null,
    event: event?.value ?? null,
    receivedHeaders: [...request.headers.keys()].sort(),
  };
}

/**
 * Traduce la plataforma de Zernio al enum `channel_type` de la base.
 *
 * Zernio cubre más plataformas de las que modela el CRM (Telegram, X, Bluesky,
 * Reddit). Las no soportadas devuelven null y el webhook las descarta sin
 * error, para que Zernio no reintente indefinidamente.
 */
export function toChannel(platform: string): Channel | null {
  switch (platform?.toLowerCase()) {
    case "whatsapp":
      return "whatsapp";
    case "instagram":
      return "instagram";
    case "facebook":
    case "messenger":
      return "messenger";
    default:
      return null;
  }
}
