/**
 * Lo que comparten el alta de una cita y el cambio de su enlace.
 *
 * Módulo puro, sin base ni red, para poder probarlo con el runner de Node.
 */

/** Cuánto dura una cita cuando no se dice cuándo termina. */
export const DURACION_POR_OMISION_MINUTOS = 30;

/** Lo que entra en la columna sin que a nadie le sirva leerlo. */
const MAX_ENLACE = 2000;

/**
 * El enlace de la cita —el de Meet, Zoom o el mapa del domicilio—, o null.
 *
 * Exige `http` o `https` y no cualquier texto: el enlace termina pegado en un
 * WhatsApp, y un "pasar por la oficina" escrito en ese campo sale como un link
 * roto. Lo que no tiene forma de enlace se guarda como nada, que es más honesto
 * que guardarlo a medias.
 */
export function leerEnlace(valor: unknown): string | null {
  const crudo = typeof valor === "string" ? valor.trim() : "";
  if (!crudo || crudo.length > MAX_ENLACE) return null;

  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    return null;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}
