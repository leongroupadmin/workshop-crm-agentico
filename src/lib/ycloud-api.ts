import "server-only";

import { credenciales } from "@/lib/integraciones-server";
import { normalizarPlantillas, type ComponenteSaliente, type Plantilla } from "@/lib/plantillas";
import type { SendResult } from "@/lib/zernio-api";

/**
 * Cliente REST de YCloud, para el sentido saliente.
 *
 * El webhook no necesita esto: los mensajes entrantes los empuja YCloud y se
 * autentican con el secreto del webhook. La API key hace falta solo para
 * responder.
 *
 * El contrato —`X-API-Key`, base `https://api.ycloud.com/v2`, `from`/`to` en
 * E.164— se escribió sin la documentación a mano y se confirmó contra envíos
 * reales. El error se devuelve entero en vez de traducirlo: si algún día deja
 * de coincidir, lo que importa es ver qué contestó YCloud, y por eso también
 * la base es configurable.
 */

const DEFAULT_BASE_URL = "https://api.ycloud.com/v2";

/**
 * La API key y la URL base, de Configuración → Conexiones o del entorno.
 *
 * Devuelve el error ya armado para quien llama: "falta la API key de …,
 * cargala en Conexiones" es lo único que hay que decirle a quien la ve.
 */
async function conectar(): Promise<
  { ok: true; apiKey: string; baseUrl: string } | { ok: false; error: string }
> {
  const cred = await credenciales("ycloud", ["api_key"]);
  if (!cred.ok) return cred;
  return {
    ok: true,
    apiKey: cred.valores.api_key,
    baseUrl: (cred.valores.base_url || DEFAULT_BASE_URL).replace(/\/$/, ""),
  };
}

type Destino = {
  /** Nuestro número, en E.164. Es la cuenta de la conversación. */
  from: string;
  /** El teléfono del contacto, en E.164. */
  to: string;
};

/** Manda un mensaje de texto por WhatsApp. */
export async function sendYcloudMessage(input: Destino & { text: string }): Promise<SendResult> {
  return post({
    from: input.from,
    to: input.to,
    type: "text",
    text: { body: input.text },
  });
}

/**
 * Manda un audio por WhatsApp.
 *
 * En la API oficial no existe el interruptor de "nota de voz" que sí tiene el
 * canal no oficial: un audio por link llega como mensaje de audio reproducible,
 * y es lo más cerca que se puede estar de la burbuja con la onda. Por eso acá
 * no hay un parámetro `voiceNote`: no habría nada que hacer con él.
 */
export async function sendYcloudAudio(input: Destino & { audioUrl: string }): Promise<SendResult> {
  return post({
    from: input.from,
    to: input.to,
    type: "audio",
    audio: { link: input.audioUrl },
  });
}

/**
 * Manda una imagen o un video por WhatsApp.
 *
 * El contrato es el mismo que el del audio —`type` y un objeto con `link`—, con
 * la diferencia de que la imagen y el video sí aceptan `caption`: el texto llega
 * pegado al archivo, en una sola burbuja, y no como un mensaje aparte que puede
 * llegar desordenado.
 */
export async function sendYcloudMedia(
  input: Destino & { kind: "imagen" | "video"; url: string; caption?: string },
): Promise<SendResult> {
  const tipo = input.kind === "imagen" ? "image" : "video";
  return post({
    from: input.from,
    to: input.to,
    type: tipo,
    [tipo]: {
      link: input.url,
      // Un caption vacío es un campo de más: se manda sólo si hay algo que decir.
      ...(input.caption ? { caption: input.caption } : {}),
    },
  });
}

async function post(body: Record<string, unknown>): Promise<SendResult> {
  const conexion = await conectar();
  if (!conexion.ok) return conexion;
  const { apiKey, baseUrl } = conexion;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/whatsapp/messages`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[ycloud] no se pudo alcanzar la API:", error);
    return { ok: false, error: "No se pudo conectar con YCloud." };
  }

  const detalle = await response.text().catch(() => "");

  if (!response.ok) {
    console.error("[ycloud] la API rechazó el envío", response.status, detalle);
    return { ok: false, error: `YCloud respondió ${response.status}: ${detalle || "sin cuerpo"}` };
  }

  // El id sirve para deduplicar contra el webhook: lo que mandamos vuelve a
  // entrar como evento, y sin el wamid se guardaría dos veces.
  let messageId: string | undefined;
  try {
    const parsed = JSON.parse(detalle) as { wamid?: string; id?: string };
    messageId = parsed.wamid ?? parsed.id;
  } catch {
    // Un 2xx sin JSON igual es un envío hecho: no vale la pena fallar por esto.
  }

  return { ok: true, messageId };
}

/**
 * Trae las plantillas de WhatsApp aprobadas.
 *
 * Se piden en vivo y se guardan unos minutos en memoria: son pocas, cambian
 * cuando alguien crea una en el panel de YCloud, y sincronizarlas a la base
 * sería mantener una copia que se desactualiza sola. El caché es por instancia
 * del servidor, así que en el peor caso alguien ve una plantilla nueva unos
 * minutos tarde.
 */
export type PlantillasResult =
  | { ok: true; plantillas: Plantilla[] }
  | { ok: false; error: string };

const CACHE_MS = 5 * 60 * 1000;
let cache: { plantillas: Plantilla[]; vence: number } | null = null;

export async function listYcloudTemplates(): Promise<PlantillasResult> {
  if (cache && cache.vence > Date.now()) {
    return { ok: true, plantillas: cache.plantillas };
  }

  const crudas = await pedirPlantillasCrudas();
  if (!crudas.ok) return crudas;

  const plantillas = normalizarPlantillas(crudas.cuerpo);

  // Una respuesta con contenido de la que no salió ninguna plantilla es casi
  // siempre un envoltorio que no esperábamos. Desde el CRM se vería como "no
  // hay plantillas", que es la conclusión equivocada, así que queda en el log.
  if (plantillas.length === 0) {
    console.warn("[ycloud] el listado no dio ninguna plantilla:", JSON.stringify(crudas.cuerpo).slice(0, 1000));
  }

  cache = { plantillas, vence: Date.now() + CACHE_MS };
  return { ok: true, plantillas };
}

/**
 * El listado tal como vino, sin interpretar.
 *
 * Lo usa el diagnóstico: cuando el selector aparece vacío, lo único que importa
 * es ver qué contestó YCloud de verdad.
 */
export async function pedirPlantillasCrudas(): Promise<
  { ok: true; cuerpo: unknown } | { ok: false; error: string }
> {
  const conexion = await conectar();
  if (!conexion.ok) return conexion;
  const { apiKey, baseUrl } = conexion;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/whatsapp/templates?limit=100`, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[ycloud] no se pudieron pedir las plantillas:", error);
    return { ok: false, error: "No se pudo conectar con YCloud." };
  }

  const detalle = await response.text().catch(() => "");

  if (!response.ok) {
    console.error("[ycloud] la API rechazó el listado", response.status, detalle);
    return { ok: false, error: `YCloud respondió ${response.status}: ${detalle || "sin cuerpo"}` };
  }

  try {
    return { ok: true, cuerpo: JSON.parse(detalle) };
  } catch {
    return { ok: false, error: "YCloud devolvió algo que no es JSON." };
  }
}

/** Vacía el caché. Para cuando alguien acaba de crear una plantilla y no la ve. */
export function olvidarPlantillas(): void {
  cache = null;
}

/**
 * Manda una plantilla ya aprobada.
 *
 * `components` sale de `componentesParaEnviar`: acá no se arma nada, porque
 * quien envía no tiene por qué saber en qué orden espera Meta los parámetros.
 */
export async function sendYcloudTemplate(
  input: Destino & { nombre: string; idioma: string; components: ComponenteSaliente[] },
): Promise<SendResult> {
  return post({
    from: input.from,
    to: input.to,
    type: "template",
    template: {
      name: input.nombre,
      language: { code: input.idioma },
      // Meta rechaza el mensaje si viene `components: []` en algunas
      // plantillas, así que el campo se omite cuando no hay nada que completar.
      ...(input.components.length > 0 ? { components: input.components } : {}),
    },
  });
}
