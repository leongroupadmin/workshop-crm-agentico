/**
 * Pasa una grabación del navegador a WAV, para Instagram y Messenger.
 *
 * Instagram sólo acepta audio en AAC, M4A, WAV o MP4, y rechaza con un 400 el
 * WebM de Chrome y el OGG que sale de `webm-a-ogg`. De esos cuatro, el WAV es
 * el único que se puede armar en cualquier navegador sin un codificador: es el
 * audio crudo con una cabecera adelante.
 *
 * Se hace en el navegador porque es el único lugar donde hay con qué
 * decodificar Opus: el servidor no tiene ffmpeg ni un decodificador, y el
 * navegador trae los dos gratis en la Web Audio API.
 *
 * El WAV pesa mucho más que el Opus, por eso se baja a mono y 16 kHz, que es lo
 * que usa una nota de voz de WhatsApp y alcanza de sobra para una voz. Así los
 * tres minutos que deja grabar el chat quedan en 5,8 MB, debajo de los 6 MB que
 * acepta el servidor.
 */

/** Muestras por segundo del WAV. */
export const FRECUENCIA_WAV = 16000;

/**
 * Arma un WAV PCM de 16 bits, mono, con las muestras que recibe.
 *
 * Las muestras vienen como las da la Web Audio API, en coma flotante entre -1
 * y 1. Lo que se pasa de ese rango se recorta en vez de dar la vuelta, que
 * sonaría como un chasquido.
 */
export function wavDesdeMuestras(muestras: Float32Array, frecuencia = FRECUENCIA_WAV): Uint8Array {
  const datos = muestras.length * 2;
  const salida = new Uint8Array(44 + datos);
  const vista = new DataView(salida.buffer);
  const texto = (posicion: number, valor: string) => {
    for (let i = 0; i < valor.length; i++) salida[posicion + i] = valor.charCodeAt(i);
  };

  texto(0, "RIFF");
  vista.setUint32(4, 36 + datos, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  vista.setUint32(16, 16, true); // largo del bloque fmt
  vista.setUint16(20, 1, true); // PCM sin comprimir
  vista.setUint16(22, 1, true); // un canal
  vista.setUint32(24, frecuencia, true);
  vista.setUint32(28, frecuencia * 2, true); // bytes por segundo
  vista.setUint16(32, 2, true); // bytes por muestra
  vista.setUint16(34, 16, true); // bits por muestra
  texto(36, "data");
  vista.setUint32(40, datos, true);

  for (let i = 0; i < muestras.length; i++) {
    const muestra = Math.max(-1, Math.min(1, muestras[i]));
    vista.setInt16(44 + i * 2, muestra < 0 ? muestra * 0x8000 : muestra * 0x7fff, true);
  }

  return salida;
}

/**
 * Decodifica la grabación y la devuelve como WAV mono de 16 kHz.
 *
 * Null si el navegador no la pudo decodificar: quien llama avisa en vez de
 * mandar un archivo que el canal va a rechazar igual.
 */
export async function grabacionAWav(grabacion: Blob): Promise<Blob | null> {
  try {
    const contexto = new AudioContext();
    let audio: AudioBuffer;
    try {
      audio = await contexto.decodeAudioData(await grabacion.arrayBuffer());
    } finally {
      void contexto.close();
    }

    // El contexto offline hace las dos cosas de una vez: un destino de un solo
    // canal mezcla el estéreo, y renderizar a 16 kHz cambia la frecuencia.
    const largo = Math.max(1, Math.ceil(audio.duration * FRECUENCIA_WAV));
    const offline = new OfflineAudioContext(1, largo, FRECUENCIA_WAV);
    const fuente = offline.createBufferSource();
    fuente.buffer = audio;
    fuente.connect(offline.destination);
    fuente.start();
    const mezcla = await offline.startRendering();

    const wav = wavDesdeMuestras(mezcla.getChannelData(0));
    return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
  } catch (error) {
    console.error("[audio] no se pudo pasar la grabación a WAV:", error);
    return null;
  }
}
