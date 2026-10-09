/**
 * Reglas de la contraseña.
 *
 * Sin `server-only`: las valida el servidor antes de tocar la cuenta y las
 * muestra el navegador en el formulario de alta. Un solo lugar para las dos
 * cosas, igual que `agent-limits.ts`.
 *
 * No vive en `actions.ts` porque ése es un archivo `"use server"` y ahí sólo se
 * pueden exportar funciones async: una constante rompe el build.
 */

/**
 * Largo mínimo. Supabase acepta seis; acá se piden ocho, que no molesta a nadie
 * y saca de la mesa las de cuatro dígitos.
 */
export const MIN_PASSWORD_CHARS = 8;

/** Por qué no sirve una contraseña, o cadena vacía si sirve. */
export function errorDeContrasena(password: string): string {
  // Los espacios al borde son el error tipeado más común al dictar una
  // contraseña, y el más difícil de ver después: se rechazan al ponerla, no al
  // intentar entrar con ella.
  if (password.trim().length !== password.length) {
    return "La contraseña no puede empezar ni terminar con espacios.";
  }
  if (password.length < MIN_PASSWORD_CHARS) {
    return `La contraseña tiene que tener al menos ${MIN_PASSWORD_CHARS} caracteres.`;
  }
  return "";
}
