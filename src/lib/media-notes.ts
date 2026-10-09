/**
 * El texto que ocupa el lugar del mensaje cuando lo que llega no es texto.
 *
 * Un mensaje sin contenido es un mensaje que no existe para la IA: el historial
 * que se le arma descarta las filas vacías, así que un video suelto la dejaba
 * sin nada que contestar. Por eso todo adjunto deja una nota, aunque sea corta.
 *
 * Vive acá y no en el webhook porque las notas se escriben en un lado y se leen
 * en otro: el webhook las guarda y el prompt del agente le explica al modelo qué
 * significan. Si se separan, el modelo empieza a ver marcas que no reconoce.
 */

/**
 * Lo que la IA sí puede leer.
 *
 * Se guardan con la nota de "pendiente" para que el mensaje aparezca en el chat
 * en el momento, y unos segundos después el texto real la reemplaza.
 */
export const MEDIA_LEGIBLE = {
  audio: {
    pending: "🎤 Transcribiendo el audio…",
    failed: "🎤 Audio (no se pudo transcribir)",
  },
  image: {
    pending: "🖼️ Leyendo la imagen…",
    failed: "🖼️ Imagen (no se pudo leer)",
  },
} as const;

export type MediaLegible = keyof typeof MEDIA_LEGIBLE;

/**
 * Lo que no se puede convertir a texto.
 *
 * La nota es corta a propósito: se muestra arriba del adjunto en el chat, donde
 * el video o el archivo ya se ven solos. Lo que importa es que el modelo se
 * entere de que llegó algo.
 */
export const MEDIA_ILEGIBLE: Record<string, string> = {
  video: "🎥 Video",
  file: "📄 Archivo",
  sticker: "🙂 Sticker",
  location: "📍 Ubicación",
  contact: "👤 Contacto compartido",
  share: "🔗 Enlace compartido",
};

/**
 * El marcador de lo que mandamos nosotros con un adjunto y sin texto.
 *
 * No se reusa `MEDIA_ILEGIBLE` aunque el de video diga lo mismo: eso es lo que
 * se le explica al modelo sobre lo que *recibe* y no puede abrir, y una imagen
 * que mandamos nosotros no es ninguna de las dos cosas. Si algún día cambia el
 * texto de uno, no tiene por qué cambiar el del otro.
 *
 * En la imagen es provisorio: cuando vuelve la descripción de la IA la
 * reemplaza, igual que la transcripción reemplaza a «Nota de voz».
 */
export const MEDIA_SALIENTE = {
  imagen: "🖼️ Imagen",
  video: "🎥 Video",
} as const;

/** Para un adjunto de un tipo que Zernio agregue después de esto. */
export const MEDIA_DESCONOCIDA = "📎 Adjunto";

/**
 * Un mensaje que llegó sin texto y sin adjunto.
 *
 * Ya no debería llegar al chat: `procesarEntrante` descarta esos eventos antes
 * de guardarlos. Queda como último recurso del contrato de
 * `contenidoDelMensaje`, que nunca devuelve vacío, y para que si algún día se
 * cuela uno se vea qué pasó en vez de quedar una burbuja en blanco.
 */
export const SIN_TEXTO = "(mensaje sin texto)";

/**
 * Si un evento no trae nada que guardar.
 *
 * WhatsApp manda por el mismo webhook cosas que no son mensajes de la persona:
 * avisos de cambio de clave de cifrado, mensajes de protocolo, el placeholder
 * de uno que todavía no se pudo descifrar. En el teléfono no se ven —no son
 * mensajes—, pero llegan como eventos igual que los demás, y guardarlos dejaba
 * en el chat del CRM burbujas «(mensaje sin texto)» que el contacto jura no
 * haber mandado. Peor: cada una despertaba a la IA, que terminaba contestando
 * que le habían llegado mensajes vacíos.
 *
 * Un adjunto sin texto sí es un mensaje: el video o el audio son el contenido.
 * Lo que se descarta es lo que no trae ni una cosa ni la otra.
 */
export function vieneVacio(
  texto: string | null | undefined,
  tipoDeAdjunto: string | null | undefined,
): boolean {
  return !texto?.trim() && !tipoDeAdjunto;
}

/**
 * Qué guardar como contenido de un mensaje entrante.
 *
 * Nunca devuelve vacío: esa es toda la razón de ser de esta función.
 *
 * Cuando el adjunto viene con texto se guarda el texto solo. La nota sería
 * ruido —el video se ve igual abajo— y el texto suele decir para qué lo mandó.
 */
export function contenidoDelMensaje(
  texto: string | null | undefined,
  tipoDeAdjunto: string | null | undefined,
): string {
  const limpio = texto?.trim();
  if (limpio) return limpio;

  if (!tipoDeAdjunto) return SIN_TEXTO;
  if (tipoDeAdjunto in MEDIA_LEGIBLE) {
    return MEDIA_LEGIBLE[tipoDeAdjunto as MediaLegible].pending;
  }
  return MEDIA_ILEGIBLE[tipoDeAdjunto] ?? MEDIA_DESCONOCIDA;
}

/**
 * Qué mandó la persona, para el aviso push de un mensaje nuevo.
 *
 * No es `contenidoDelMensaje`: el aviso sale en el momento, antes de que
 * vuelva la transcripción, y un «Transcribiendo el audio…» en la pantalla del
 * teléfono se lee como algo que quedó colgado. Acá alcanza con decir qué llegó.
 */
export function vistaPreviaDelMensaje(
  texto: string | null | undefined,
  tipoDeAdjunto: string | null | undefined,
): string {
  if (tipoDeAdjunto === "audio" && !texto?.trim()) return "🎤 Audio";
  if (tipoDeAdjunto === "image" && !texto?.trim()) return "🖼️ Imagen";
  return contenidoDelMensaje(texto, tipoDeAdjunto);
}

/**
 * Lo que se le explica al modelo sobre los adjuntos.
 *
 * Sin esto ve "🎥 Video" y no sabe si es una marca del sistema o algo que la
 * persona escribió, así que lo más probable es que lo ignore y conteste
 * cualquier cosa. Peor todavía: podría inventar lo que el video decía.
 */
export const INSTRUCCIONES_DE_ADJUNTOS = [
  "",
  "",
  "---",
  "Los audios y las imágenes que te manden te llegan ya pasados a texto: eso lo",
  "podés leer con normalidad.",
  "",
  `Lo demás no. Cuando llegue un adjunto que no se puede leer vas a ver en su`,
  `lugar una nota corta del sistema, como «${MEDIA_ILEGIBLE.video}» o`,
  `«${MEDIA_ILEGIBLE.file}». No la escribió la persona: significa que mandó eso y`,
  "que vos no lo podés abrir. Nunca la ignores ni supongas qué había adentro.",
  "Contestá igual, en tu tono de siempre: decile que no podés ver ese formato y",
  "pedile que te escriba lo que necesita.",
  "",
  "Lo mismo si te habla de algo que no te llegó o que no podés ver: decilo en vez",
  "de responder como si lo hubieras visto.",
].join("\n");
