/**
 * Qué es un adjunto, para saber cómo mostrarlo en el chat.
 *
 * La fila de `messages` guarda la URL pero no el tipo: Zernio lo manda en el
 * webhook y se descarta al insertar. Averiguarlo del lado del navegador evita
 * una columna nueva y, sobre todo, arregla también los mensajes viejos, que ya
 * están guardados sin tipo y no se pueden completar hacia atrás.
 */
export type MediaKind = "imagen" | "audio" | "video" | "archivo";

const POR_EXTENSION: Record<string, MediaKind> = {
  jpg: "imagen",
  jpeg: "imagen",
  png: "imagen",
  gif: "imagen",
  webp: "imagen",
  avif: "imagen",
  bmp: "imagen",
  heic: "imagen",
  svg: "imagen",
  webm: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  m4a: "audio",
  mp3: "audio",
  wav: "audio",
  aac: "audio",
  amr: "audio",
  mp4: "video",
  mov: "video",
  m4v: "video",
  avi: "video",
  mkv: "video",
  "3gp": "video",
};

/**
 * Adivina el tipo por la extensión de la URL.
 *
 * Devuelve null cuando no hay extensión o no la conocemos, que es lo que pasa
 * con casi todos los enlaces de Zernio: la parte del archivo es un hash y el
 * formato real viaja en el `Content-Type`. Ese caso lo resuelve `useMediaKind`
 * probando la URL; acá sólo se atajan las que se pueden saber sin pedir nada.
 *
 * `.webm` cae en audio a propósito: es el formato en el que graba Chrome las
 * notas de voz, y es de lejos el .webm más frecuente en un CRM de chats. Si
 * alguna vez llega un video .webm, el reproductor de audio igual lo suena.
 */
export function adivinarMedia(url: string): MediaKind | null {
  // Los enlaces firmados traen la firma en la query: sin sacarla, la
  // "extensión" termina siendo el último parámetro.
  const camino = url.split("?")[0].split("#")[0];
  const ultimo = camino.slice(camino.lastIndexOf("/") + 1);
  const punto = ultimo.lastIndexOf(".");
  if (punto < 0) return null;

  return POR_EXTENSION[ultimo.slice(punto + 1).toLowerCase()] ?? null;
}
