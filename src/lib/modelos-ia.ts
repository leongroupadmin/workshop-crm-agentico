/**
 * Lo que hay que saber del modelo antes de pedirle una respuesta.
 *
 * Vive en su propio archivo, sin importar nada, porque lo necesitan los dos
 * lados: `openai-server.ts` para armar el pedido y las pruebas para verificar
 * la regla sin levantar medio Next. Es el mismo motivo por el que existe
 * `agent-limits.ts`.
 */

/**
 * Techo de la respuesta, en tokens.
 *
 * Es un tope, no un gasto: se paga lo que el modelo usa. Lo que lo hace
 * delicado es otra cosa —ver abajo—, no el costo.
 */
export const TECHO_RESPUESTA = 3000;

/**
 * El techo cuando el modelo piensa antes de escribir.
 *
 * Un razonador descuenta de este mismo presupuesto lo que piensa, y lo que
 * piensa no se ve en ningún lado. Si se le acaba razonando, la API devuelve el
 * `content` vacío con `finish_reason: "length"` y la corrida entera se pierde:
 * desde el chat se ve igual que si el mensaje nunca hubiera llegado.
 *
 * Pasa justo donde más duele —una consulta larga que da para pensar, que es la
 * del lead que más interesa— y no pasa nunca con un "hola": por eso se vive
 * como que el agente contesta casi siempre y se cuelga sin motivo de vez en
 * cuando.
 */
export const TECHO_RESPUESTA_RAZONADOR = 8000;

/**
 * Si el modelo piensa antes de escribir.
 *
 * Se decide por el nombre porque es lo único que hay: el modelo lo elige el
 * usuario de la lista de su cuenta y la fila de config no guarda de qué tipo
 * es. Errarle no rompe nada —quien llama reintenta sin el parámetro— así que
 * la regla puede ser simple.
 *
 * `-chat` queda afuera a propósito: `gpt-5-chat-latest` empieza igual que la
 * familia pero no razona, y rechaza `reasoning_effort`.
 */
export function razonaAntesDeEscribir(model: string): boolean {
  const nombre = model.trim().toLowerCase();
  return /^(gpt-5|o\d)/.test(nombre) && !nombre.includes("-chat");
}

/** El techo que le corresponde a un modelo. */
export function techoDelModelo(model: string): number {
  return razonaAntesDeEscribir(model) ? TECHO_RESPUESTA_RAZONADOR : TECHO_RESPUESTA;
}
