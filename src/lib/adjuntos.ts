/**
 * Qué imagen o video se puede mandar desde el CRM, y hasta qué tamaño.
 *
 * Vive sin `server-only` a propósito: el navegador lo necesita tanto como el
 * servidor. El `accept` del selector de archivos y el tope que se revisa antes
 * de subir salen de acá, y es lo que evita el peor camino posible —esperar a
 * que suban catorce megas para que recién el servidor diga que no—. El servidor
 * lo vuelve a revisar igual: lo que decide el navegador no es una validación.
 *
 * No incluye audio. Las notas de voz tienen su propio camino, con grabador,
 * conversión de envoltorio y transcripción, y mezclarlos haría que un cambio en
 * los adjuntos pudiera romper las notas de voz.
 */

export type AdjuntoKind = "imagen" | "video";

/**
 * Los topes son los de WhatsApp, que es el más estricto de los tres canales y
 * el que más se usa: 5 MB una imagen, 16 MB un video. Poner uno más alto sería
 * dejar subir un archivo para que el proveedor lo rebote después.
 */
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

/** El más grande de los dos. Es el límite del bucket y el del cuerpo del pedido. */
export const MAX_ADJUNTO_BYTES = Math.max(MAX_IMAGEN_BYTES, MAX_VIDEO_BYTES);

/**
 * Lo que puede medir el epígrafe.
 *
 * Es el tope de WhatsApp. Se revisa de este lado porque el epígrafe viaja pegado
 * al archivo: pasarse de largo haría rebotar el envío entero después de haber
 * subido el video, y el error del proveedor hablaría del mensaje y no del texto.
 */
export const MAX_CAPTION = 1024;

/**
 * Los formatos aceptados, con la extensión que le toca al archivo guardado.
 *
 * La extensión importa más de lo que parece: el proveedor se descarga el
 * archivo de nuestra URL y varios deciden qué tipo de mensaje armar mirándola.
 *
 * La lista es corta a propósito —es la que los tres canales entienden—. Un
 * formato de más acá es un archivo que sube bien y que el contacto no puede
 * abrir, que es peor que no haberlo podido elegir.
 */
const IMAGENES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VIDEOS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
};

/** Para el `accept` del `<input type="file">`. */
export const ACEPTA_ADJUNTOS = [...Object.keys(IMAGENES), ...Object.keys(VIDEOS)].join(",");

export type Adjunto = {
  kind: AdjuntoKind;
  /** El mime sin parámetros, que es con el que se sube. */
  mimeType: string;
  extension: string;
  maxBytes: number;
};

/**
 * Qué es el archivo que eligieron, o null si no es algo que podamos mandar.
 *
 * Se mira el mime y no la extensión del nombre: un `.jpeg` renombrado a `.png`
 * sigue siendo un JPEG, y es el mime el que el navegador saca del contenido.
 */
export function clasificarAdjunto(mimeType: string | null | undefined): Adjunto | null {
  // Algunos navegadores agregan parámetros: `video/mp4;codecs=avc1`.
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();

  const imagen = IMAGENES[base];
  if (imagen) {
    return { kind: "imagen", mimeType: base, extension: imagen, maxBytes: MAX_IMAGEN_BYTES };
  }

  const video = VIDEOS[base];
  if (video) {
    return { kind: "video", mimeType: base, extension: video, maxBytes: MAX_VIDEO_BYTES };
  }

  return null;
}

const megas = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** El aviso de que no se puede mandar, o null si está todo bien. */
export function revisarAdjunto(
  mimeType: string | null | undefined,
  bytes: number,
): { ok: true; adjunto: Adjunto } | { ok: false; error: string } {
  const adjunto = clasificarAdjunto(mimeType);
  if (!adjunto) {
    return {
      ok: false,
      error:
        "Ese formato no se puede enviar por chat. Se pueden mandar imágenes JPG, PNG, WEBP o GIF y videos MP4, MOV o 3GP.",
    };
  }

  if (bytes === 0) return { ok: false, error: "El archivo está vacío." };

  if (bytes > adjunto.maxBytes) {
    return {
      ok: false,
      error:
        adjunto.kind === "imagen"
          ? `La imagen pesa más de ${megas(adjunto.maxBytes)}. Mandá una más liviana.`
          : `El video pesa más de ${megas(adjunto.maxBytes)}. Recortalo o bajale la calidad.`,
    };
  }

  return { ok: true, adjunto };
}
