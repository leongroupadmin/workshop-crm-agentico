/**
 * La búsqueda de leads por texto: nombre, mail o teléfono.
 *
 * Va contra la base y no contra los contactos que ya trajo el tablero, que son
 * los primeros doscientos: con una base grande, el lead que se busca es
 * justamente el que quedó afuera de ese recorte.
 */

/** Cuántos se muestran. Más que esto no se lee: hay que escribir un poco más. */
export const MAX_RESULTADOS = 20;

/** Sin texto se ofrecen los últimos que entraron, que suelen ser los que se buscan. */
export const MAX_RECIENTES = 8;

/**
 * El filtro `or` de PostgREST para un texto, o null si no hay nada que buscar.
 *
 * - Las comas, los paréntesis, las comillas y las barras rompen la sintaxis del
 *   `or`, así que se sacan antes de armarlo, igual que en el asistente.
 * - Los espacios pasan a ser comodines: "juan perez" encuentra a "Juan Carlos
 *   Perez", que es como se busca a alguien de quien uno se acuerda a medias.
 * - El teléfono se busca por los dígitos: la base lo guarda en E.164 y la gente
 *   lo escribe con espacios y guiones. Con menos de tres dígitos no se mira,
 *   porque "1" está en todos los teléfonos.
 */
export function filtroDeBusqueda(texto: string): string | null {
  const limpio = texto.replace(/[,()"\\:]/g, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return null;

  const patron = `%${limpio.replace(/ /g, "%")}%`;
  const partes = [`name.ilike.${patron}`, `email.ilike.${patron}`];

  const digitos = limpio.replace(/\D/g, "");
  if (digitos.length >= 3) partes.push(`phone.ilike.%${digitos}%`);

  return partes.join(",");
}
