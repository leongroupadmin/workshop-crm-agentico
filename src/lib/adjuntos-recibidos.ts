/**
 * La copia propia de los adjuntos que llegan por WAHA.
 *
 * WAHA borra lo que recibe a los tres minutos: es su `WHATSAPP_FILES_LIFETIME`,
 * que viene en 180 segundos. Alcanza para transcribir el audio, que pasa en el
 * momento, pero no para escucharlo después: al abrir el chat el archivo ya no
 * estaba, y la burbuja quedaba en «El archivo ya no está disponible». Por eso el
 * webhook se queda con una copia apenas entra el mensaje.
 *
 * La copia va a un bucket privado. Es la voz y las fotos de los clientes, y a
 * diferencia de lo que sale del CRM nadie de afuera tiene que poder bajarla: la
 * sirve `/api/adjuntos/<id>`, que antes mira con la sesión de quien pide si
 * puede ver ese chat.
 *
 * Vive sin `server-only` porque lo usan las dos puntas: el servidor arma la
 * dirección de la copia y el chat la reconoce para pedirla por el CRM.
 */

import { adivinarMedia } from "./media-kind.ts";

export const BUCKET_RECIBIDOS = "adjuntos-recibidos";

/**
 * Hasta cuánto se copia. Deja margen sobre los 16 MB que WhatsApp permite para
 * un audio o un video; lo que pese más queda con el enlace del proveedor.
 */
export const MAX_RECIBIDO_BYTES = 25 * 1024 * 1024;

/**
 * Los formatos que el chat sabe mostrar, con la extensión que le toca a la copia.
 *
 * La extensión no es un detalle: el chat decide si dibuja un reproductor, una
 * foto o un video mirándola (`adivinarMedia`), y a una copia privada no la puede
 * abrir para averiguarlo de otra forma.
 */
const EXTENSIONES: Record<string, string> = {
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
};

/**
 * Cómo guardar la copia, o null si no es algo que el chat muestre.
 *
 * Manda el `Content-Type`. El nombre del archivo sólo se mira cuando el
 * proveedor no dice qué es: si dice que es un PDF, un `.jpg` en la URL no lo
 * convierte en foto.
 *
 * Un documento no se copia. El chat no lo abre adentro, y con el enlace de
 * siempre queda igual que antes.
 */
export function formatoDeLaCopia(
  contentType: string | null | undefined,
  url: string,
): { extension: string; contentType: string } | null {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();

  const extension = EXTENSIONES[mime];
  if (extension) return { extension, contentType: mime };
  if (mime && mime !== "application/octet-stream") return null;

  const kind = adivinarMedia(url);
  if (kind !== "audio" && kind !== "imagen" && kind !== "video") return null;

  const camino = url.split("?")[0].split("#")[0];
  const desdeElPunto = camino.slice(camino.lastIndexOf(".") + 1).toLowerCase();
  return { extension: desdeElPunto, contentType: mime || "application/octet-stream" };
}

const prefijo = (supabaseUrl: string) =>
  `${supabaseUrl.trim().replace(/\/$/, "")}/storage/v1/object/authenticated/${BUCKET_RECIBIDOS}/`;

/**
 * La dirección de la copia.
 *
 * Es la que Supabase usa para los archivos privados, así que es una URL de
 * verdad con su extensión, y el resto del CRM la trata como a cualquier otra.
 * No abre sola: pide credenciales.
 */
export function urlDeLaCopia(supabaseUrl: string, ruta: string): string {
  return `${prefijo(supabaseUrl)}${ruta}`;
}

/**
 * Las rutas que arma el CRM: `<workspace>/<uuid>.<extensión>`.
 *
 * Se exige la forma exacta y no "algo adentro del bucket": la ruta sale de la
 * fila del mensaje, que cualquiera del equipo puede editar, y se firma con la
 * service role. Un `..` codificado podría sacarla del bucket.
 */
const RUTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/i;

/** La ruta dentro del bucket si la URL es de una copia del CRM, o null. */
export function rutaDeLaCopia(url: string, supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl?.trim()) return null;

  try {
    // Las dos pasan por el mismo parser, como en `esMediaDeWaha`: un host en
    // mayúsculas o un puerto explícito no tienen por qué romper la comparación.
    const base = new URL(prefijo(supabaseUrl)).href;
    const pedida = new URL(url);
    if (pedida.search || pedida.hash || !pedida.href.startsWith(base)) return null;

    const ruta = pedida.href.slice(base.length);
    return RUTA.test(ruta) ? ruta : null;
  } catch {
    return null;
  }
}

/**
 * Si la URL es de una copia del CRM, que el navegador no puede abrir directo.
 *
 * Lo pregunta el chat para ir derecho a `/api/adjuntos/<id>` en vez de probar
 * primero un enlace que va a rebotar.
 */
export function esCopiaGuardada(url: string): boolean {
  return rutaDeLaCopia(url, process.env.NEXT_PUBLIC_SUPABASE_URL) !== null;
}
