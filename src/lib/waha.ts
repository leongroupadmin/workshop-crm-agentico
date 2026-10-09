// Sin `server-only`: el mapeo y la firma son funciones puras y se prueban con
// payloads representativos del contrato oficial de WAHA.
import { createHmac, timingSafeEqual } from "node:crypto";

import type { MensajeEntrante } from "@/lib/entrante";

type WahaMedia = {
  url?: string;
  mimetype?: string;
  filename?: string;
};

export type WahaEvent = {
  id?: string;
  event?: string;
  session?: string;
  timestamp?: number;
  engine?: string;
  me?: { id?: string; pushName?: string };
  payload?: {
    id?: string | { _serialized?: string };
    timestamp?: number;
    from?: string;
    to?: string;
    fromMe?: boolean;
    body?: string;
    hasMedia?: boolean;
    media?: WahaMedia | null;
    type?: string;
    _data?: {
      notifyName?: string;
      pushName?: string;
      senderPn?: string;
      caption?: string;
    };
  };
};

function idDelMensaje(id: string | { _serialized?: string } | undefined): string | null {
  if (typeof id === "string" && id.trim()) return id.trim();
  const serializado = typeof id === "object" && id ? id._serialized?.trim() : "";
  return serializado || null;
}

/** `549…@c.us` → `+549…`; conserva `@lid` como identidad, pero no inventa teléfono. */
function telefonoDeJid(jid: string | undefined): string | undefined {
  const limpio = jid?.trim();
  if (!limpio?.endsWith("@c.us")) return undefined;
  const numero = limpio.slice(0, -"@c.us".length).replace(/\D/g, "");
  return numero ? `+${numero}` : undefined;
}

/**
 * Los tipos de mensaje de WhatsApp Web que traen un archivo.
 *
 * WAHA avisa del adjunto con `hasMedia`, pero no siempre: cuando no lo pudo
 * descargar puede llegar el evento con el tipo puesto y nada más. Sin esta
 * lista ese mensaje quedaba sin texto y sin adjunto, y hoy lo descartaría
 * `procesarEntrante` creyendo que es un aviso interno.
 */
const TIPOS_CON_ARCHIVO = new Set([
  "image",
  "audio",
  "ptt",
  "voice",
  "video",
  "document",
  "sticker",
]);

/**
 * Cuando una foto llega sin el archivo (`hasMedia` en false), WhatsApp Web deja
 * su miniatura en `body`, en base64, y WAHA la pasa tal cual: el CRM la
 * mostraba como si la persona hubiera escrito cientos de letras sueltas.
 *
 * Ningún texto escrito se ve así: largo, sin un espacio, y empezando con la
 * firma de un JPEG, PNG, WebP o GIF.
 */
const FIRMAS_DE_IMAGEN = ["/9j/", "iVBORw0KGgo", "UklGR", "R0lGOD"];

function esMiniaturaEnBase64(texto: string): boolean {
  return (
    texto.length >= 100 &&
    FIRMAS_DE_IMAGEN.some((firma) => texto.startsWith(firma)) &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(texto)
  );
}

function tipoDeAdjunto(media: WahaMedia | null | undefined, declarado: string | undefined): string {
  const mime = media?.mimetype?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "file";

  const tipo = declarado?.toLowerCase();
  if (tipo === "ptt" || tipo === "voice") return "audio";
  if (tipo === "document") return "file";
  return tipo || "file";
}

function fechaDelEvento(timestamp: number | undefined): string {
  if (!Number.isFinite(timestamp)) return new Date().toISOString();
  const valor = timestamp as number;
  return new Date(valor < 10_000_000_000 ? valor * 1000 : valor).toISOString();
}

/** Traduce el evento `message` de WAHA al formato común del CRM. */
export function aMensajeEntranteWaha(evento: WahaEvent): MensajeEntrante | null {
  if (evento.event !== "message") return null;

  const mensaje = evento.payload;
  const session = evento.session?.trim();
  const chatId = mensaje?.from?.trim();
  const mensajeId = idDelMensaje(mensaje?.id);

  // `message.any` puede incluir mensajes propios; esta defensa también evita
  // que un payload mal configurado haga que la IA se conteste a sí misma.
  if (!mensaje || mensaje.fromMe || !session || !chatId || !mensajeId) return null;
  // La bandeja modela conversaciones uno a uno, no grupos ni estados.
  if (chatId.endsWith("@g.us") || chatId === "status@broadcast") return null;
  // `0@c.us` no es un teléfono: es la cuenta con la que WhatsApp manda sus
  // propios avisos. Entraba como un lead llamado "+0", al que el agente podía
  // ponerse a contestar.
  if (chatId === "0@c.us") return null;

  const media = mensaje.media;
  const cuerpo = mensaje.body?.trim() ?? "";
  const miniatura = esMiniaturaEnBase64(cuerpo);
  const tipoDeclarado = mensaje.type?.toLowerCase() ?? "";
  const tieneAdjunto = Boolean(
    mensaje.hasMedia || media || miniatura || TIPOS_CON_ARCHIVO.has(tipoDeclarado),
  );
  const telefono = telefonoDeJid(mensaje._data?.senderPn) ?? telefonoDeJid(chatId);
  const nombre = mensaje._data?.notifyName?.trim() || mensaje._data?.pushName?.trim();
  // La miniatura no es texto: lo que la persona escribió, si escribió algo,
  // viene en el epígrafe.
  const texto = (miniatura ? "" : cuerpo) || mensaje._data?.caption?.trim() || null;

  return {
    provider: "waha",
    channel: "whatsapp",
    // El prefijo evita que una sesión llamada `default` choque con el id de
    // cuenta de otro proveedor. Al enviar se vuelve a extraer el nombre.
    cuenta: {
      id: `waha:${session}`,
      plataforma: "whatsapp",
      usuario: telefonoDeJid(evento.me?.id) ?? evento.me?.pushName ?? session,
    },
    chatId,
    mensajeId,
    direccion: "incoming",
    texto,
    // WAHA borra el archivo a los tres minutos (`WHATSAPP_FILES_LIFETIME`):
    // si el CRM no se queda con una copia, el audio no se puede escuchar después.
    adjunto: tieneAdjunto
      ? {
          // Una miniatura sin tipo de archivo declarado es, igual, una foto.
          type: tipoDeAdjunto(
            media,
            miniatura && !TIPOS_CON_ARCHIVO.has(tipoDeclarado) ? "image" : mensaje.type,
          ),
          url: media?.url?.trim() || null,
          guardarCopia: true,
        }
      : null,
    enviadoEl: fechaDelEvento(mensaje.timestamp ?? evento.timestamp),
    remitente: {
      externalId: chatId,
      nombre,
      telefono,
    },
    tipoCrudo: mensaje.type,
  };
}

/** WAHA firma el cuerpo crudo con HMAC-SHA512 en `X-Webhook-Hmac`. */
export function verificarFirmaWaha(rawBody: string, signature: string, secret: string): boolean {
  const limpia = signature.trim().replace(/^sha512=/i, "");
  if (!limpia || !secret) return false;

  const esperada = createHmac("sha512", secret).update(rawBody).digest();
  return (["hex", "base64"] as const).some((encoding) => {
    const recibida = Buffer.from(limpia, encoding);
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
  });
}

/**
 * Si una URL de adjunto la sirve nuestra propia instancia de WAHA.
 *
 * WAHA no deja los archivos abiertos: `media.url` apunta a su mismo servidor y
 * lo protege la misma API key que el resto de su API. Pedirlo pelado devuelve
 * 401, y el CRM se quedaba sin el audio para transcribir.
 *
 * Se compara contra la base configurada y no contra el host a secas para no
 * mandarle la key a cualquier URL que llegue en un webhook: si un día el evento
 * trae un adjunto alojado en otro lado, ese pedido sale sin credenciales.
 *
 * Y dentro de esa base, sólo `/api/files/`, que es donde WAHA deja los
 * adjuntos. Desde que el chat pide los audios a través del CRM, la URL que se
 * pide sale de la fila del mensaje, y esa fila la puede editar cualquiera del
 * equipo que vea el chat: sin este límite, apuntarla a `/api/screenshot` le
 * devolvía una captura del WhatsApp entero firmada con nuestra key. La URL se
 * normaliza antes de comparar para que un `/api/files/../` no se cuele.
 *
 * Que WAHA arme sus URLs con la misma base que usa el CRM para llamarlo no es
 * automático cuando corre en Docker: adentro del contenedor su idea de
 * "localhost" es otra. Ver la sección de WAHA en el README.
 */
export function esMediaDeWaha(url: string, baseUrl: string | undefined): boolean {
  const base = baseUrl?.trim().replace(/\/$/, "");
  if (!base) return false;

  try {
    // Las dos pasan por el mismo parser: si no, un host en mayúsculas o un
    // `:80` explícito en la variable de entorno dejarían de coincidir.
    return new URL(url).href.startsWith(new URL(`${base}/api/files/`).href);
  } catch {
    return false;
  }
}

/** La key para pedirle a WAHA este adjunto, o null si no es suyo. */
export function credencialesDeWaha(url: string): Record<string, string> | null {
  const key = process.env.WAHA_API_KEY?.trim();
  return key && esMediaDeWaha(url, process.env.WAHA_API_BASE_URL) ? { "X-Api-Key": key } : null;
}

/**
 * En qué anda la sesión de WhatsApp.
 *
 * Son los estados que devuelve WAHA. `SCAN_QR_CODE` es el que importa: la
 * sesión existe, el contenedor está sano y aun así no sale ni entra un
 * mensaje, porque nadie vinculó el teléfono.
 */
export type EstadoDeSesion =
  | "WORKING"
  | "SCAN_QR_CODE"
  | "STARTING"
  | "STOPPED"
  | "FAILED"
  | "DESCONOCIDO";

export type SesionDeWhatsapp = {
  estado: EstadoDeSesion;
  /** El número vinculado, cuando hay uno. */
  numero: string | null;
};

export type DiagnosticoDeSesion = {
  nivel: "ok" | "aviso" | "alarma";
  titulo: string;
  mensaje: string;
  /** Si tiene sentido mostrar el QR para vincular un teléfono. */
  pideQr: boolean;
};

/**
 * Traduce el estado de WAHA a algo accionable.
 *
 * El valor de esto no es el texto sino el nivel. Un WhatsApp desconectado no
 * rompe nada visible: el CRM sigue anotando recordatorios y marcándolos como
 * fallados, las citas siguen bajando de Calendar, la Agenda se ve normal. El
 * primero en enterarse es el cliente que no recibió el aviso. Por eso
 * `STOPPED` y `FAILED` son alarma y no aviso: no hay nadie más que lo note.
 */
export function diagnosticarSesion(sesion: SesionDeWhatsapp): DiagnosticoDeSesion {
  switch (sesion.estado) {
    case "WORKING":
      return {
        nivel: "ok",
        titulo: "WhatsApp conectado",
        mensaje: sesion.numero
          ? `Los recordatorios salen desde ${sesion.numero}.`
          : "Los recordatorios salen por acá.",
        pideQr: false,
      };
    case "SCAN_QR_CODE":
      return {
        nivel: "alarma",
        titulo: "Falta vincular el teléfono",
        mensaje:
          "Escaneá el código con el WhatsApp que atiende. Hasta que no lo hagas no sale ningún recordatorio.",
        pideQr: true,
      };
    case "STARTING":
      return {
        nivel: "aviso",
        titulo: "Conectando…",
        mensaje: "La sesión está arrancando. Actualizá en unos segundos.",
        pideQr: false,
      };
    case "STOPPED":
      return {
        nivel: "alarma",
        titulo: "WhatsApp desconectado",
        mensaje:
          "La sesión está detenida: los recordatorios se anotan pero no salen. Arrancala desde el panel de WAHA.",
        pideQr: false,
      };
    case "FAILED":
      return {
        nivel: "alarma",
        titulo: "La sesión falló",
        mensaje:
          "WhatsApp cortó la sesión. Suele pasar cuando se cierra desde el teléfono. Hay que reiniciarla y volver a vincular.",
        pideQr: true,
      };
    default:
      return {
        nivel: "aviso",
        titulo: "Estado desconocido",
        mensaje: "No se pudo interpretar lo que respondió WAHA.",
        pideQr: false,
      };
  }
}

/** Los estados que WAHA nombra; cualquier otra cosa entra como desconocida. */
export function leerEstadoDeSesion(valor: unknown): EstadoDeSesion {
  const estados: EstadoDeSesion[] = ["WORKING", "SCAN_QR_CODE", "STARTING", "STOPPED", "FAILED"];
  return estados.find((estado) => estado === valor) ?? "DESCONOCIDO";
}
