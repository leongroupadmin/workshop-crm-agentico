/**
 * Límites de las instrucciones de los agentes IA.
 *
 * Vive en su propio archivo porque lo necesitan los dos lados: el servidor para
 * validar y el panel para mostrar el contador. No puede ir en `actions.ts`, que
 * al ser `"use server"` sólo puede exportar funciones asíncronas.
 */

/**
 * Tope de las instrucciones, en caracteres.
 *
 * No lo pide Postgres —la columna es `text` y aguanta un libro— sino la
 * cordura: el prompt entero viaja en cada respuesta del agente, así que lo que
 * escribas acá se paga una vez por mensaje contestado.
 *
 * 40.000 caracteres son unos 10.000 tokens. Alcanza para un prompt largo de
 * verdad y deja el costo por respuesta en un número que se puede mirar sin
 * susto. Es un freno elegido a propósito, no el máximo que se podría.
 */
export const MAX_SYSTEM_PROMPT_CHARS = 40_000;

/**
 * A partir de acá conviene avisar. No es un error: es el punto donde el costo
 * por mensaje deja de ser despreciable y vale la pena saberlo.
 */
export const SYSTEM_PROMPT_WARN_CHARS = 20_000;

/** Cuentas redondas para mostrarle al usuario cuánto está gastando por mensaje. */
export const aproxTokens = (chars: number) => Math.round(chars / 4);

/**
 * Demora del agente antes de contestar, en segundos.
 *
 * Es un solo número —cuánto tarda en responder— y estos dos son los límites de
 * lo que se puede cargar, no dos cosas más para configurar.
 *
 * El piso no es 0 a propósito. Esa espera es, además del tono, la ventana en la
 * que se juntan los mensajes sueltos de una ráfaga: mientras el agente espera,
 * el mensaje que llega después lo pisa y contesta una sola corrida, la que vio
 * todo (ver `sigueSiendoElUltimo` en `ai-reply.ts`). Con la espera en cero no
 * hay ventana, y el lead que escribe de a pedazos recibe una respuesta por
 * pedazo. Dos segundos es lo mínimo que deja pasar el siguiente mensaje de
 * alguien que está escribiendo de corrido.
 *
 * El techo es 60 porque la espera corre en el `after()` del webhook: pasado el
 * límite de la función, el proveedor ya cerró y la respuesta se pierde.
 */
export const MIN_REPLY_DELAY_SECONDS = 2;
export const MAX_REPLY_DELAY_SECONDS = 60;

/**
 * Cinco segundos: lo que tarda alguien en leer un mensaje y escribir la
 * respuesta. Cae dentro de los 3 a 9 que estaban fijos antes de que esto fuera
 * configurable, así que ningún workspace nota el cambio.
 */
export const DEFAULT_REPLY_DELAY_SECONDS = 5;

/**
 * Valida la demora. Devuelve el error listo para mostrar, o null.
 *
 * Vive acá porque lo usan los dos lados: el panel para avisar mientras se
 * edita y la action para no guardar algo que el check de Postgres va a
 * rechazar con un mensaje que nadie entiende.
 */
export function errorDeDemora(segundos: number): string | null {
  if (!Number.isInteger(segundos)) return "La demora se carga en segundos enteros.";
  if (segundos < MIN_REPLY_DELAY_SECONDS) {
    return `La demora no puede bajar de ${MIN_REPLY_DELAY_SECONDS} segundos: es la ventana en la que se agrupan los mensajes de una ráfaga.`;
  }
  if (segundos > MAX_REPLY_DELAY_SECONDS) {
    return `La demora no puede pasar de ${MAX_REPLY_DELAY_SECONDS} segundos.`;
  }
  return null;
}
