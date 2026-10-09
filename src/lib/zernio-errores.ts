// Sin `server-only`: traducir el error de Zernio es una función pura, y es la
// que hay que poder probar con los cuerpos que Zernio devuelve de verdad.
//
// Vivía dentro del cliente REST. Se mudó acá cuando quedó claro que su forma de
// fallar importa tanto como la del envío: durante una tarde entera el CRM acusó
// a la API key de no tener permiso sobre una cuenta mientras Zernio venía
// diciendo, en el cuerpo del mismo 403, que el mensaje salía fuera de la
// ventana de Instagram. Un test con ese cuerpo lo habría mostrado de entrada.

/**
 * Por qué Zernio rechazó el envío, cuando se puede saber.
 *
 * `ventana` es una regla de Meta y no hay nada que reintentar; `otraApp` es una
 * configuración de Meta, y tampoco; `cuenta` es un problema del id o del
 * permiso, y ese sí puede arreglarse reatando la cuenta.
 */
export type CausaDeRechazo = "ventana" | "otraApp" | "cuenta";

const asText = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * Traduce el código HTTP a algo accionable, en vez de mostrar el crudo.
 *
 * El 403 no tiene un solo significado y suponerle uno costó caro. Antes se
 * traducía entero a "la API key no tiene permiso sobre esa cuenta", que era una
 * de las causas posibles presentada como la única: cuando Instagram rechazó un
 * envío por estar fuera de su ventana de 24 horas, el CRM acusó a la API key.
 * El motivo real venía en el cuerpo y se tiraba.
 *
 * Así que el cuerpo manda: se lo mira primero y recién si no dice nada
 * reconocible se cae en la explicación genérica, que ahora cita textual lo que
 * contestó Zernio en vez de reemplazarlo por una teoría.
 */
export function describeError(status: number, detail: string, accountId?: string): string {
  const motivo = motivoDeZernio(detail);

  // Va antes del código porque Zernio lo devolvió como 400, y nada asegura que
  // no llegue mañana como 403: lo que lo identifica es el motivo.
  if (esDeOtraApp(motivo)) {
    return [
      "Meta no deja responder esta conversación desde el CRM porque la está atendiendo otra",
      "app conectada a la cuenta (otra herramienta de mensajes o la bandeja de Meta). Para",
      "que el CRM pueda contestar, en Meta Business Suite buscá «Enrutamiento de",
      "conversaciones» (Conversation routing) y elegí Zernio como app predeterminada. Si la",
      "otra herramienta tiene que seguir atendiendo, este chat se responde desde ahí.",
      cita(motivo),
    ]
      .filter(Boolean)
      .join(" ");
  }

  switch (status) {
    case 401:
      return `Zernio rechazó la API key. Revisá ZERNIO_API_KEY. ${cita(motivo)}`.trim();
    case 403:
      // Meta solo deja responder dentro de las 24 horas del último mensaje del
      // contacto. Fuera de esa ventana no hay nada que arreglar en el CRM ni en
      // Zernio: es una regla de la plataforma y el chat se destraba cuando la
      // persona vuelve a escribir.
      if (esFueraDeVentana(motivo)) {
        return [
          "Instagram y Messenger solo permiten responder dentro de las 24 horas del último",
          "mensaje del contacto, y este chat quedó fuera de esa ventana. Hay que esperar a que",
          `vuelva a escribir. ${cita(motivo)}`,
        ].join(" ");
      }
      return [
        `Zernio rechazó el envío por la cuenta ${accountId ?? "de esta conversación"} (403).`,
        cita(motivo),
        "Si no dice por qué, revisá en /api/zernio/check qué cuentas reconoce la API key.",
      ]
        .filter(Boolean)
        .join(" ");
    case 404:
      return "Zernio no encontró esa conversación.";
    case 429:
      return "Zernio está limitando los envíos. Probá de nuevo en un momento.";
    default:
      return `Zernio devolvió ${status}. ${cita(motivo)}`.trim();
  }
}

/**
 * Si el rechazo fue por la ventana de mensajería de Meta.
 *
 * Se pregunta en dos lados —para redactar el error y para decidir si vale la
 * pena reintentar— así que vive suelto en vez de repetir la expresión.
 */
function esFueraDeVentana(motivo: string): boolean {
  return /allowed window|messaging window|24[- ]?hour/i.test(motivo);
}

/**
 * Si Meta rechazó el envío porque la conversación la atiende otra app.
 *
 * Instagram y Messenger dejan que varias apps lean los mensajes de una cuenta,
 * pero cada conversación la contesta una sola: la que Meta tiene como app
 * predeterminada en el enrutamiento de conversaciones, o la que tomó el hilo
 * después. Si es otra —otra herramienta de mensajes, la bandeja de Meta— el
 * envío de Zernio rebota con el subcódigo 2534037. No es la ventana ni la API
 * key, y reintentar no cambia nada: se arregla en la configuración de Meta.
 */
function esDeOtraApp(motivo: string): boolean {
  return /2534037|another receiver|conversation routing|thread owner/i.test(motivo);
}

/** La causa de un rechazo, para quien tenga que decidir si reintenta. */
export function causaDelRechazo(status: number, detail: string): CausaDeRechazo | undefined {
  const motivo = motivoDeZernio(detail);
  if (esDeOtraApp(motivo)) return "otraApp";
  if (status !== 403) return undefined;
  return esFueraDeVentana(motivo) ? "ventana" : "cuenta";
}

/**
 * El motivo que da Zernio, sacado de donde lo haya puesto.
 *
 * El cuerpo del error es JSON y el texto útil viene en `error_message`, pero no
 * siempre: hay respuestas que lo ponen en `message` y otras que no son JSON en
 * absoluto. Se prueban las formas conocidas y, si ninguna aparece, se devuelve
 * el cuerpo crudo, que es peor que un motivo pero mucho mejor que nada.
 */
function motivoDeZernio(detail: string): string {
  const crudo = detail.trim();
  if (!crudo) return "";

  try {
    const cuerpo = JSON.parse(crudo) as Record<string, unknown>;
    const anidado = (cuerpo.error ?? {}) as Record<string, unknown>;
    const texto =
      asText(cuerpo.error_message) ??
      asText(anidado.message) ??
      asText(cuerpo.message) ??
      asText(cuerpo.error);
    if (texto?.trim()) return texto.trim();
  } catch {
    // No era JSON: queda el cuerpo tal como vino.
  }

  return crudo;
}

/**
 * El motivo de Zernio, en una línea, acotado y entrecomillado.
 *
 * Va como cita y no integrado a la frase para que se distinga qué dijimos
 * nosotros de qué dijo Zernio: la confusión entre las dos cosas es justo lo que
 * hizo que este error se leyera mal durante toda una tarde.
 */
function cita(motivo: string): string {
  const limpio = motivo.replace(/\s+/g, " ").trim();
  if (!limpio) return "";
  return `Zernio dijo: "${limpio.slice(0, 200)}".`;
}
