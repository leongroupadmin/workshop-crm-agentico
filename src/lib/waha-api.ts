import "server-only";

import { leerEstadoDeSesion, type SesionDeWhatsapp } from "@/lib/waha";
import type { SendResult } from "@/lib/zernio-api";

type Destino = {
  /** `waha:default`, guardado en `zernio_account_id` por compatibilidad. */
  accountId: string;
  /** JID de WhatsApp, por ejemplo `549…@c.us`. */
  chatId: string;
};

function sessionDe(accountId: string): string {
  return accountId.replace(/^waha:/, "") || process.env.WAHA_SESSION || "default";
}

export async function sendWahaMessage(input: Destino & { text: string }): Promise<SendResult> {
  return post("/api/sendText", {
    session: sessionDe(input.accountId),
    chatId: input.chatId,
    text: input.text,
  });
}

/**
 * Manda un audio por WAHA, siempre como nota de voz: la burbuja con la onda y
 * el play, no el archivo con los auriculares.
 *
 * Se le pide a WAHA que lo convierta siempre, aunque ya sea OGG/Opus: su
 * conversión deja el audio con los ajustes de una nota de voz de WhatsApp
 * —mono, 48 kHz, Opus—, sin depender de cómo grabó el navegador ni de qué
 * archivo se subió. Pide el ffmpeg del contenedor, que WAHA trae y que ya se
 * usaba para todo lo que no era OGG.
 *
 * El mime va fijo en OGG/Opus porque es lo que sale de la conversión, entre
 * en el formato que entre. Con el motor WEBJS no es un detalle: WAHA convierte
 * y después vuelve a poner el mime que le pasamos, así que un mp3 declarado
 * como `audio/mpeg` llegaba convertido pero rotulado como mp3, y WhatsApp lo
 * mostraba como un archivo de audio.
 */
export async function sendWahaAudio(input: Destino & { audioUrl: string }): Promise<SendResult> {
  return post("/api/sendVoice", {
    session: sessionDe(input.accountId),
    chatId: input.chatId,
    file: {
      mimetype: "audio/ogg; codecs=opus",
      url: input.audioUrl,
      filename: "audio.ogg",
    },
    convert: true,
  });
}

/**
 * Manda una imagen o un video por WAHA.
 *
 * Son dos endpoints distintos y no uno con un tipo: WAHA arma el mensaje según
 * la ruta, y `/api/sendFile` dejaría la foto como un documento adjunto en vez de
 * la burbuja con la miniatura.
 *
 * El `filename` se arma con la extensión de la URL porque WhatsApp lo usa para
 * decidir cómo abrir el archivo, y la URL de Supabase ya la trae: el archivo se
 * guarda con la extensión que le corresponde al mime.
 */
export async function sendWahaMedia(
  input: Destino & { kind: "imagen" | "video"; url: string; mimeType: string; caption?: string },
): Promise<SendResult> {
  const esImagen = input.kind === "imagen";
  const extension = input.url.split("?")[0].split(".").pop() || (esImagen ? "jpg" : "mp4");

  return post(esImagen ? "/api/sendImage" : "/api/sendVideo", {
    session: sessionDe(input.accountId),
    chatId: input.chatId,
    file: {
      mimetype: input.mimeType,
      url: input.url,
      filename: `${esImagen ? "imagen" : "video"}.${extension}`,
    },
    // WAHA ignora el campo si viene vacío, pero mandarlo igual deja un mensaje
    // con un caption en blanco en algunas versiones.
    ...(input.caption ? { caption: input.caption } : {}),
  });
}

async function post(path: string, body: Record<string, unknown>): Promise<SendResult> {
  const baseUrl = process.env.WAHA_API_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.WAHA_API_KEY?.trim();

  if (!baseUrl) return { ok: false, error: "Falta WAHA_API_BASE_URL en el entorno." };
  if (!apiKey) return { ok: false, error: "Falta WAHA_API_KEY en el entorno." };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[waha] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con WAHA." };
  }

  const detalle = await response.text().catch(() => "");
  if (!response.ok) {
    console.error("[waha] la API rechazó el envío", response.status, detalle);
    return { ok: false, error: `WAHA respondió ${response.status}: ${detalle || "sin cuerpo"}` };
  }

  let messageId: string | undefined;
  try {
    const parsed = JSON.parse(detalle) as {
      id?: string | { _serialized?: string };
      key?: { id?: string };
    };
    messageId =
      typeof parsed.id === "string"
        ? parsed.id
        : parsed.id?._serialized ?? parsed.key?.id;
  } catch {
    // Un 2xx sin JSON sigue siendo un envío exitoso.
  }

  return { ok: true, messageId };
}

/** La sesión configurada, sin el prefijo `waha:` que guarda la conversación. */
function sesionConfigurada(): string {
  return (process.env.WAHA_SESSION ?? "default").trim() || "default";
}

/**
 * En qué anda la sesión de WhatsApp, preguntándoselo a WAHA.
 *
 * Es lo único que el CRM no puede deducir solo: un envío fallido se parece a
 * un número mal cargado, y una sesión caída no deja rastro hasta que alguien
 * revisa por qué no llegó un recordatorio.
 */
export async function estadoDeLaSesion(): Promise<
  { ok: true; sesion: SesionDeWhatsapp } | { ok: false; error: string }
> {
  const sesion = sesionConfigurada();
  const respuesta = await get(`/api/sessions/${encodeURIComponent(sesion)}`);
  if (!respuesta.ok) return respuesta;

  let cuerpo: { status?: unknown; me?: { id?: string; pushName?: string } | null };
  try {
    cuerpo = JSON.parse(respuesta.texto);
  } catch {
    return { ok: false, error: "WAHA respondió algo que no es JSON." };
  }

  // `me.id` viene como `549…@c.us`; en pantalla alcanza con el número.
  const crudo = cuerpo.me?.id ?? null;
  const numero = crudo ? `+${crudo.replace(/@.*$/, "").replace(/\D/g, "")}` : null;

  return { ok: true, sesion: { estado: leerEstadoDeSesion(cuerpo.status), numero } };
}

/**
 * El QR para vincular el teléfono, como data URL.
 *
 * Se devuelve empaquetado en vez de exponer una ruta que haga de proxy: el QR
 * es una credencial —quien lo escanea se queda con la sesión de WhatsApp— y
 * una ruta abierta lo dejaría al alcance de cualquiera que adivine la URL.
 * Así sólo lo ve quien ya pasó por la sesión del CRM.
 */
export async function qrDeLaSesion(): Promise<
  { ok: true; dataUrl: string } | { ok: false; error: string }
> {
  const sesion = sesionConfigurada();
  const baseUrl = process.env.WAHA_API_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.WAHA_API_KEY?.trim();
  if (!baseUrl || !apiKey) return { ok: false, error: "Falta la configuración de WAHA." };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/${encodeURIComponent(sesion)}/auth/qr`, {
      headers: { "X-Api-Key": apiKey, Accept: "image/png" },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[waha] no se pudo pedir el QR:", error);
    return { ok: false, error: "No se pudo conectar con WAHA." };
  }

  if (!response.ok) {
    return { ok: false, error: `WAHA respondió ${response.status} al pedir el QR.` };
  }

  const tipo = response.headers.get("content-type") ?? "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ok: true, dataUrl: `data:${tipo};base64,${bytes.toString("base64")}` };
}

async function get(
  path: string,
): Promise<{ ok: true; texto: string } | { ok: false; error: string }> {
  const baseUrl = process.env.WAHA_API_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.WAHA_API_KEY?.trim();

  if (!baseUrl) return { ok: false, error: "Falta WAHA_API_BASE_URL en el entorno." };
  if (!apiKey) return { ok: false, error: "Falta WAHA_API_KEY en el entorno." };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[waha] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con WAHA." };
  }

  const texto = await response.text().catch(() => "");
  if (!response.ok) {
    return { ok: false, error: `WAHA respondió ${response.status}: ${texto || "sin cuerpo"}` };
  }

  return { ok: true, texto };
}

/**
 * El teléfono detrás de un `@lid`.
 *
 * WhatsApp está migrando a un identificador interno —`167177357402318@lid`—
 * que no contiene el número por ningún lado. Cuando el cliente contesta desde
 * uno de esos, el CRM recibe un chat que no se parece en nada al que abrió el
 * recordatorio (`549…@c.us`) y termina creando un contacto nuevo, sin teléfono
 * y con el historial partido.
 *
 * WAHA guarda la correspondencia y la entrega por acá. A veces devuelve `pn`
 * en null —pasa y está documentado en su propio repositorio—: en ese caso se
 * devuelve null y el mensaje sigue su camino sin teléfono, que es lo que hacía
 * antes. Perder la unión es malo; frenar el mensaje entrante sería peor.
 */
export async function telefonoDelLid(lid: string): Promise<string | null> {
  const sesion = sesionConfigurada();
  const respuesta = await get(
    `/api/${encodeURIComponent(sesion)}/lids/${encodeURIComponent(lid)}`,
  );

  if (!respuesta.ok) {
    console.warn("[waha] no se pudo resolver el lid:", lid, respuesta.error);
    return null;
  }

  let cuerpo: { pn?: unknown };
  try {
    cuerpo = JSON.parse(respuesta.texto);
  } catch {
    return null;
  }

  // Llega como `549…@c.us` o como los dígitos pelados, según la versión.
  const digitos = String(cuerpo.pn ?? "").replace(/\D/g, "");
  return digitos.length >= 8 ? `+${digitos}` : null;
}
