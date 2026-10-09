/**
 * Las marcas con las que el agente le habla al CRM.
 *
 * Son palabras sueltas dentro de la respuesta y no herramientas de OpenAI
 * porque las señales son pocas y simples: "esto no lo resuelvo yo" y "acá va lo
 * que el equipo tiene que saber". Function calling significaría una segunda
 * vuelta contra la API por cada mensaje, para averiguar un sí o un no.
 *
 * Viven acá, separadas de `ai-reply.ts`, porque son lo único de esa corrida que
 * se puede probar sin base ni API: lo que el modelo escribió entra por un lado
 * y por el otro salen el mensaje para la persona, la señal de derivación y la
 * nota para el equipo.
 */

/** La marca con la que el modelo pide que siga una persona. */
export const MARCA_DERIVAR = "[DERIVAR]";

/** La marca a partir de la cual lo que sigue es para el equipo, no para el lead. */
export const MARCA_RESUMEN = "[RESUMEN]";

/**
 * Lo que se le agrega al prompt cuando la derivación está prendida.
 *
 * Va al final, después de las instrucciones del negocio, para que no le tape el
 * tono ni sus reglas.
 *
 * No dicta con qué palabras despedirse: eso es del prompt, que suele tener una
 * frase elegida. Cuando estas líneas también la dictaban, ganaban ellas por ir
 * últimas y el agente se despedía distinto de lo que decían sus instrucciones.
 * Acá se explica el mecanismo —la marca— y la frase queda donde corresponde.
 */
export const INSTRUCCIONES_DE_DERIVACION = [
  "",
  "",
  "---",
  "Si la persona pide hablar con alguien del equipo, se muestra molesta, o te",
  `hace una consulta que no podés resolver con lo de arriba, escribí ${MARCA_DERIVAR}`,
  "al final de tu mensaje, en un renglón aparte. Antes de esa marca despedite con",
  "la frase de derivación que tengan tus instrucciones; si no tenés ninguna,",
  "decile en una línea que en un rato lo atiende alguien del equipo. La marca no",
  "se la mostramos: es una señal interna para el CRM. No la uses en ningún otro",
  "caso.",
].join("\n");

/**
 * Cómo se deja una nota para el equipo.
 *
 * El agente no tiene dónde escribir salvo el mensaje que sale al cliente: un
 * prompt que le pide "dejá registrado un resumen" sin esto termina mandándole
 * el resumen al lead por WhatsApp. La marca abre esa puerta: lo que va después
 * se guarda como nota en el hilo, donde lo ve quien atiende, y nunca se envía.
 *
 * Qué tiene que decir el resumen no se define acá: eso es del prompt, que sabe
 * de qué negocio se trata. Estas líneas sólo explican el mecanismo.
 */
export const INSTRUCCIONES_DE_RESUMEN = [
  "",
  "",
  "---",
  `Cuando tus instrucciones te pidan dejar algo anotado para el equipo, escribí ${MARCA_RESUMEN}`,
  "en un renglón aparte al final del mensaje y abajo el resumen. Todo lo que",
  "escribas después de esa marca lo guardamos como una nota interna en el chat y",
  "la persona no lo recibe; lo de arriba de la marca sí le llega. Si no hay nada",
  "que anotar, no la uses.",
].join("\n");

/** Lo que el modelo escribió, ya separado en sus tres partes. */
export type RespuestaDelAgente = {
  /** El mensaje que se le manda a la persona. Vacío significa que no hay nada que enviar. */
  texto: string;
  /** Si pidió que la conversación siga con alguien del equipo. */
  derivar: boolean;
  /** La nota para el equipo, o null si no dejó ninguna. */
  resumen: string | null;
};

/**
 * Parte la respuesta del modelo en lo que va a la persona y lo que va al CRM.
 *
 * El corte del resumen es por la primera marca: lo de antes es el mensaje y
 * todo lo de después es la nota, aunque el modelo escriba varias. Así una marca
 * repetida por error no devuelve media nota ni se le escapa el resto al lead,
 * que es el único desenlace que no se puede permitir.
 *
 * La marca de derivación se busca en el texto entero —el modelo la pone tanto
 * arriba como abajo del resumen— y se saca de las dos partes.
 */
export function separarMarcas(respuesta: string): RespuestaDelAgente {
  const derivar = respuesta.includes(MARCA_DERIVAR);
  const sinDerivar = (texto: string) => texto.split(MARCA_DERIVAR).join("").trim();

  const corte = respuesta.indexOf(MARCA_RESUMEN);
  if (corte === -1) {
    return { texto: sinDerivar(respuesta), derivar, resumen: null };
  }

  const nota = sinDerivar(respuesta.slice(corte + MARCA_RESUMEN.length).split(MARCA_RESUMEN).join(""));

  return {
    texto: sinDerivar(respuesta.slice(0, corte)),
    derivar,
    resumen: nota || null,
  };
}

/**
 * Cómo se guarda la nota en el hilo.
 *
 * Con el mismo engranaje que el aviso interno de las automatizaciones: una fila
 * de `messages` que empieza con ⚙️. Es la marca que ya distingue, para quien
 * mira el chat, lo que escribió el sistema de lo que se habló con el cliente.
 */
export function notaParaElEquipo(resumen: string): string {
  return `⚙️ Resumen para el equipo\n${resumen}`;
}

/** El encabezado de toda nota de falla, que es además cómo se la reconoce. */
const ENCABEZADO_DE_FALLA = "⚙️ La IA no pudo contestar este mensaje";

/**
 * Cómo se avisa en el hilo que el agente no pudo contestar.
 *
 * Toda falla de la corrida —el modelo que no devuelve texto, el envío que
 * rebota— volvía en silencio. Desde el chat se veía exactamente lo mismo que
 * si la IA hubiera decidido callarse, que si el lead no hubiera escrito, o que
 * si el webhook nunca hubiera llegado: nada. Tres causas muy distintas con el
 * mismo aspecto, y la única forma de separarlas eran los logs del servidor, que
 * quien atiende el chat no tiene.
 *
 * Usa el mismo engranaje que la nota del equipo —una fila de `messages` que
 * empieza con ⚙️— porque es para quien mira el chat: no se le envía al lead.
 */
export function notaDeFalla(motivo: string): string {
  return `${ENCABEZADO_DE_FALLA}\n${motivo}`;
}


/**
 * Si una fila del hilo es una nota interna y no algo que el contacto vio.
 *
 * El ⚙️ es la marca que comparten todas: el resumen para el equipo, el aviso de
 * falla y los avisos internos de las automatizaciones. Lo usa quien necesita
 * saber qué fue lo último que el lead *recibió* —el aviso de fuera de horario,
 * para no repetirlo— y no lo último que se escribió en el hilo.
 */
export function esNotaInterna(contenido: string): boolean {
  return contenido.trimStart().startsWith("⚙️");
}

/**
 * Si una fila del hilo es una de estas notas.
 *
 * El historial que se le arma al modelo manda a `assistant` todo lo que no
 * escribió el contacto. Sin esto, la corrida siguiente leería «la IA no pudo
 * contestar» como algo que dijo ella misma y se disculparía por una falla de
 * infraestructura que el lead nunca vio.
 */
export function esNotaDeFalla(contenido: string): boolean {
  return contenido.startsWith(ENCABEZADO_DE_FALLA);
}
