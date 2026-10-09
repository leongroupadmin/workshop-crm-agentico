/**
 * Pasa una grabación WebM/Opus a OGG/Opus.
 *
 * Chrome graba en WebM y es lo único que sabe grabar: `MediaRecorder` no ofrece
 * OGG. WhatsApp, en cambio, sólo acepta OGG con códec Opus para las notas de
 * voz, así que sin esta traducción el audio no llega como audio.
 *
 * No es una conversión de audio: adentro de los dos formatos van exactamente
 * los mismos paquetes Opus, cambia el envoltorio. Por eso no hace falta ffmpeg
 * ni nada que recodifique —que en Vercel además no habría cómo instalar—, y por
 * eso tampoco se pierde calidad: los bytes del audio salen idénticos a como
 * entraron.
 *
 * Ante cualquier cosa que no entienda devuelve null en vez de tirar un archivo
 * roto: quien llama manda el WebM original y, si tampoco va, la transcripción.
 */

// --- EBML, el formato de contenedor de WebM -------------------------------

/** Elementos que contienen otros elementos y hay que recorrer por dentro. */
const CONTENEDORES = new Set([
  0x18538067, // Segment
  0x1654ae6b, // Tracks
  0xae, //       TrackEntry
  0x1f43b675, // Cluster
  0xa0, //       BlockGroup
  0xe1, //       Audio
]);

const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

/**
 * Cuántos bytes ocupa un entero de longitud variable, según su primer byte.
 *
 * EBML marca el largo con la cantidad de ceros antes del primer uno: `1xxxxxxx`
 * ocupa un byte, `01xxxxxx` dos, y así. Un cero entero es inválido.
 */
function anchoVint(primero: number): number {
  for (let i = 0; i < 8; i++) {
    if (primero & (0x80 >> i)) return i + 1;
  }
  return 0;
}

type Vint = { valor: number; largo: number; desconocido: boolean };

/** Lee un largo. Los bits que marcan el ancho no son parte del número. */
function leerLargo(bytes: Uint8Array, pos: number): Vint | null {
  if (pos >= bytes.length) return null;
  const ancho = anchoVint(bytes[pos]);
  if (ancho === 0 || pos + ancho > bytes.length) return null;

  let valor = bytes[pos] & (0xff >> ancho);
  // Un largo con todos los bits en uno significa "no sé dónde termina": es lo
  // que escribe Chrome, que graba mientras transmite y no puede saber de
  // antemano el tamaño del Segment ni el de cada Cluster.
  let todosUno = valor === (0xff >> ancho);

  for (let i = 1; i < ancho; i++) {
    valor = valor * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) todosUno = false;
  }

  // El caso desconocido se resuelve antes de mirar el número: en su forma de
  // ocho bytes no entra en un entero exacto de JavaScript, y no hace falta que
  // entre porque el valor no se usa.
  if (todosUno) return { valor: 0, largo: ancho, desconocido: true };
  if (!Number.isSafeInteger(valor)) return null;
  return { valor, largo: ancho, desconocido: false };
}

/** Lee un identificador. Acá los bits del ancho sí forman parte del id. */
function leerId(bytes: Uint8Array, pos: number): Vint | null {
  if (pos >= bytes.length) return null;
  const ancho = anchoVint(bytes[pos]);
  if (ancho === 0 || ancho > 4 || pos + ancho > bytes.length) return null;

  let valor = 0;
  for (let i = 0; i < ancho; i++) valor = valor * 256 + bytes[pos + i];
  return { valor, largo: ancho, desconocido: false };
}

/**
 * Saca los paquetes de audio de un bloque.
 *
 * Devuelve null si el bloque usa un empaquetado que no manejamos. `MediaRecorder`
 * no lo usa —manda un paquete por bloque—, así que el caso es teórico, pero es
 * mejor rebotar el archivo entero que escribir uno mal armado.
 */
function paquetesDelBloque(bloque: Uint8Array, pista: number | null): Uint8Array[] | null {
  const numero = leerLargo(bloque, 0);
  if (!numero) return null;
  if (pista !== null && numero.valor !== pista) return [];

  // Después del número de pista van el tiempo (2 bytes con signo) y las banderas.
  let pos = numero.largo + 2;
  if (pos >= bloque.length) return null;
  const banderas = bloque[pos];
  pos += 1;

  const empaquetado = (banderas >> 1) & 0x03;
  const datos = bloque.subarray(pos);

  if (empaquetado === 0) return [datos];

  // Empaquetado de tamaño fijo: un byte con la cantidad y el resto en partes iguales.
  if (empaquetado === 2) {
    if (datos.length < 1) return null;
    const cuantos = datos[0] + 1;
    const cuerpo = datos.subarray(1);
    if (cuerpo.length % cuantos !== 0) return null;
    const tamaño = cuerpo.length / cuantos;
    return Array.from({ length: cuantos }, (_, i) => cuerpo.subarray(i * tamaño, (i + 1) * tamaño));
  }

  return null;
}

export type ContenidoOpus = {
  /** La cabecera OpusHead tal como venía en el WebM. */
  cabecera: Uint8Array | null;
  paquetes: Uint8Array[];
};

/**
 * Recorre el WebM y saca los paquetes Opus.
 *
 * El recorrido es plano a propósito: cuando llega a un contenedor sigue leyendo
 * adentro en vez de saltearlo, y cuando llega a cualquier otro elemento lo
 * saltea por su largo. Así los contenedores de largo desconocido —que son
 * justamente los que escribe Chrome— no necesitan ningún trato especial.
 */
export function leerWebmOpus(bytes: Uint8Array): ContenidoOpus | null {
  let cabecera: Uint8Array | null = null;
  let pistaOpus: number | null = null;
  let numeroEnCurso: number | null = null;
  let esOpus = false;
  const paquetes: Uint8Array[] = [];

  let pos = 0;
  while (pos < bytes.length) {
    const id = leerId(bytes, pos);
    if (!id) break;
    pos += id.largo;

    const largo = leerLargo(bytes, pos);
    if (!largo) break;
    pos += largo.largo;

    if (id.valor === TRACK_ENTRY) {
      numeroEnCurso = null;
      continue;
    }
    if (CONTENEDORES.has(id.valor)) continue;

    const fin = largo.desconocido ? bytes.length : pos + largo.valor;
    if (fin > bytes.length) break;
    const cuerpo = bytes.subarray(pos, fin);

    switch (id.valor) {
      case TRACK_NUMBER: {
        let numero = 0;
        for (const byte of cuerpo) numero = numero * 256 + byte;
        numeroEnCurso = numero;
        if (esOpus && pistaOpus === null) pistaOpus = numero;
        break;
      }
      case CODEC_ID: {
        if (new TextDecoder().decode(cuerpo).replace(/\0+$/, "") === "A_OPUS") {
          esOpus = true;
          if (numeroEnCurso !== null) pistaOpus = numeroEnCurso;
        }
        break;
      }
      case CODEC_PRIVATE:
        cabecera = cuerpo;
        break;
      case SIMPLE_BLOCK:
      case BLOCK: {
        const salidos = paquetesDelBloque(cuerpo, pistaOpus);
        if (!salidos) return null;
        for (const paquete of salidos) if (paquete.length > 0) paquetes.push(paquete);
        break;
      }
    }

    pos = fin;
  }

  if (!esOpus || paquetes.length === 0) return null;
  return { cabecera, paquetes };
}

// --- Ogg, el contenedor que espera WhatsApp -------------------------------

/**
 * CRC de Ogg. No es el CRC32 de siempre: usa el mismo polinomio pero sin
 * invertir los bits ni al entrar ni al salir, así que hay que hacerlo a mano.
 */
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let resto = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      resto = resto & 0x80000000 ? ((resto << 1) ^ 0x04c11db7) >>> 0 : (resto << 1) >>> 0;
    }
    tabla[i] = resto >>> 0;
  }
  return tabla;
})();

function crcOgg(datos: Uint8Array): number {
  let resto = 0;
  for (const byte of datos) {
    resto = ((resto << 8) ^ TABLA_CRC[((resto >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return resto >>> 0;
}

/** Cuántos segmentos de la tabla de largos ocupa un paquete. */
const segmentosDe = (largo: number) => Math.floor(largo / 255) + 1;

/**
 * Arma una página de Ogg.
 *
 * Cada página lleva los largos de sus paquetes en una tabla de bytes: un
 * paquete de 600 bytes entra como 255, 255 y 90. Que el último valor sea menor
 * a 255 es lo que le dice al lector que el paquete terminó ahí; por eso un
 * paquete múltiplo exacto de 255 necesita un cero al final.
 */
function armarPagina(
  paquetes: Uint8Array[],
  granulo: number,
  serie: number,
  secuencia: number,
  tipo: number,
): Uint8Array {
  const tabla: number[] = [];
  for (const paquete of paquetes) {
    let resto = paquete.length;
    while (resto >= 255) {
      tabla.push(255);
      resto -= 255;
    }
    tabla.push(resto);
  }

  const cuerpo = paquetes.reduce((total, paquete) => total + paquete.length, 0);
  const pagina = new Uint8Array(27 + tabla.length + cuerpo);
  const vista = new DataView(pagina.buffer);

  pagina.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  pagina[4] = 0; // versión
  pagina[5] = tipo;
  // La posición son 64 bits, pero se escribe en dos mitades de 32: tres
  // minutos de audio son ocho millones de muestras, muy lejos del límite de un
  // entero exacto de JavaScript, así que no hace falta BigInt.
  vista.setUint32(6, granulo >>> 0, true);
  vista.setUint32(10, Math.floor(granulo / 0x1_0000_0000), true);
  vista.setUint32(14, serie, true);
  vista.setUint32(18, secuencia, true);
  // El CRC se calcula sobre la página entera con su propio lugar en cero.
  vista.setUint32(22, 0, true);
  pagina[26] = tabla.length;
  pagina.set(tabla, 27);

  let escrito = 27 + tabla.length;
  for (const paquete of paquetes) {
    pagina.set(paquete, escrito);
    escrito += paquete.length;
  }

  vista.setUint32(22, crcOgg(pagina), true);
  return pagina;
}

/** Duración en milisegundos de cada configuración de Opus, según la tabla del RFC 6716. */
const DURACIONES = [
  10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 40, 60, 10, 20, 10, 20, 2.5, 5, 10, 20, 2.5, 5, 10, 20,
  2.5, 5, 10, 20, 2.5, 5, 10, 20,
];

/**
 * Cuántas muestras de 48 kHz dura un paquete.
 *
 * Hace falta para la posición de cada página: Ogg no guarda duraciones, guarda
 * cuánto audio va acumulado hasta el final de la página, y de ahí sale el
 * tiempo total que muestra el reproductor.
 */
function muestrasDe(paquete: Uint8Array): number {
  if (paquete.length === 0) return 0;
  const toc = paquete[0];
  const duracion = DURACIONES[toc >> 3];
  const codigo = toc & 0x03;

  const cuantos =
    codigo === 0 ? 1 : codigo === 1 || codigo === 2 ? 2 : paquete.length > 1 ? paquete[1] & 0x3f : 0;

  return Math.round(duracion * 48) * cuantos;
}

/** Cabecera mínima, para el caso raro de que el WebM no traiga la suya. */
function cabeceraPorDefecto(): Uint8Array {
  const cabecera = new Uint8Array(19);
  cabecera.set(new TextEncoder().encode("OpusHead"), 0);
  cabecera[8] = 1; // versión
  cabecera[9] = 1; // canales
  new DataView(cabecera.buffer).setUint16(10, 3840, true); // muestras a descartar
  new DataView(cabecera.buffer).setUint32(12, 48000, true);
  return cabecera;
}

function opusTags(): Uint8Array {
  const firma = new TextEncoder().encode("OpusTags");
  const autor = new TextEncoder().encode("crm-leon");
  const bloque = new Uint8Array(firma.length + 4 + autor.length + 4);
  const vista = new DataView(bloque.buffer);
  bloque.set(firma, 0);
  vista.setUint32(firma.length, autor.length, true);
  bloque.set(autor, firma.length + 4);
  vista.setUint32(firma.length + 4 + autor.length, 0, true); // sin comentarios
  return bloque;
}

/**
 * Convierte la grabación. Devuelve null si el WebM no se entiende.
 *
 * La `serie` identifica el flujo dentro del archivo; al ser uno solo alcanza
 * con que sea cualquier número, pero se pide desde afuera para que la
 * conversión sea reproducible y se pueda comparar byte a byte en una prueba.
 */
export function webmOpusAOgg(webm: Uint8Array, serie = 0x4c454f4e): Uint8Array | null {
  const contenido = leerWebmOpus(webm);
  if (!contenido) return null;

  const cabecera = contenido.cabecera ?? cabeceraPorDefecto();
  const paginas: Uint8Array[] = [
    armarPagina([cabecera], 0, serie, 0, 0x02), // 0x02: primera página del flujo
    armarPagina([opusTags()], 0, serie, 1, 0x00),
  ];

  // Las páginas se llenan hasta el tope de 255 segmentos, que es lo máximo que
  // entra en la tabla de largos.
  let secuencia = 2;
  let granulo = 0;
  let enCurso: Uint8Array[] = [];
  let segmentos = 0;

  const cerrar = (ultima: boolean) => {
    if (enCurso.length === 0) return;
    paginas.push(armarPagina(enCurso, granulo, serie, secuencia, ultima ? 0x04 : 0x00));
    secuencia += 1;
    enCurso = [];
    segmentos = 0;
  };

  for (const paquete of contenido.paquetes) {
    const necesita = segmentosDe(paquete.length);
    if (segmentos + necesita > 255) cerrar(false);
    enCurso.push(paquete);
    segmentos += necesita;
    granulo += muestrasDe(paquete);
  }
  cerrar(true);

  const total = paginas.reduce((suma, pagina) => suma + pagina.length, 0);
  const salida = new Uint8Array(total);
  let escrito = 0;
  for (const pagina of paginas) {
    salida.set(pagina, escrito);
    escrito += pagina.length;
  }

  return salida;
}
