/**
 * Prueba del remux WebM/Opus -> OGG/Opus.
 *
 * El WebM se arma a mano acá, siguiendo la especificación, para que la prueba
 * no dependa del mismo código que se está probando. Se imita lo que escribe
 * Chrome: Segment y Cluster con largo desconocido.
 */
import assert from "node:assert";
import { test } from "node:test";

import { webmOpusAOgg } from "../src/lib/audio/webm-a-ogg.ts";

const juntar = (...partes: Uint8Array[]) => {
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const parte of partes) {
    salida.set(parte, pos);
    pos += parte.length;
  }
  return salida;
};

const bytes = (...valores: number[]) => Uint8Array.from(valores);

/** Largo en vint EBML, con la codificación más corta posible. */
function largoVint(n: number): Uint8Array {
  if (n < 0x7f) return bytes(0x80 | n);
  if (n < 0x3fff) return bytes(0x40 | (n >> 8), n & 0xff);
  if (n < 0x1fffff) return bytes(0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff);
  return bytes(0x10 | (n >> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

const DESCONOCIDO = bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

const elemento = (id: number[], cuerpo: Uint8Array) =>
  juntar(Uint8Array.from(id), largoVint(cuerpo.length), cuerpo);

const abierto = (id: number[], cuerpo: Uint8Array) =>
  juntar(Uint8Array.from(id), DESCONOCIDO, cuerpo);

// --- Contenido de prueba --------------------------------------------------

/** OpusHead: 20 ms, mono, 48 kHz. */
const opusHead = (() => {
  const cabecera = new Uint8Array(19);
  cabecera.set(new TextEncoder().encode("OpusHead"), 0);
  cabecera[8] = 1;
  cabecera[9] = 1;
  new DataView(cabecera.buffer).setUint16(10, 312, true);
  new DataView(cabecera.buffer).setUint32(12, 48000, true);
  return cabecera;
})();

/** TOC 0xF8: fullband, 20 ms, un cuadro -> 960 muestras a 48 kHz. */
const paquete = (largo: number, relleno: number) =>
  Uint8Array.from({ length: largo }, (_, i) => (i === 0 ? 0xf8 : (relleno + i) & 0xff));

const simpleBlock = (datos: Uint8Array, tiempo: number) =>
  elemento([0xa3], juntar(bytes(0x81, (tiempo >> 8) & 0xff, tiempo & 0xff, 0x80), datos));

function armarWebm(paquetes: Uint8Array[]): Uint8Array {
  const pistas = elemento(
    [0x16, 0x54, 0xae, 0x6b],
    elemento(
      [0xae],
      juntar(
        elemento([0xd7], bytes(0x01)),
        elemento([0x86], new TextEncoder().encode("A_OPUS")),
        elemento([0x63, 0xa2], opusHead),
      ),
    ),
  );

  const bloques = paquetes.map((datos, i) => simpleBlock(datos, i * 20));
  const cluster = abierto([0x1f, 0x43, 0xb6, 0x75], juntar(elemento([0xe7], bytes(0x00)), ...bloques));

  return juntar(
    elemento([0x1a, 0x45, 0xdf, 0xa3], bytes(0x42, 0x86, 0x81, 0x01)),
    abierto([0x18, 0x53, 0x80, 0x67], juntar(pistas, cluster)),
  );
}

// --- Lector de Ogg, independiente del que escribe -------------------------

const TABLA = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let b = 0; b < 8; b++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    tabla[i] = r >>> 0;
  }
  return tabla;
})();

const crc = (datos: Uint8Array) => {
  let r = 0;
  for (const byte of datos) r = ((r << 8) ^ TABLA[((r >>> 24) ^ byte) & 0xff]) >>> 0;
  return r >>> 0;
};

type Pagina = { tipo: number; granulo: bigint; secuencia: number; serie: number; paquetes: Uint8Array[] };

function leerOgg(datos: Uint8Array): Pagina[] {
  const paginas: Pagina[] = [];
  let pos = 0;
  let arrastre: Uint8Array[] = [];

  while (pos < datos.length) {
    assert.deepEqual([...datos.subarray(pos, pos + 4)], [0x4f, 0x67, 0x67, 0x53], "falta la firma OggS");
    const vista = new DataView(datos.buffer, datos.byteOffset + pos);
    assert.equal(datos[pos + 4], 0, "versión de página inesperada");

    const tipo = datos[pos + 5];
    const granulo = vista.getBigInt64(6, true);
    const serie = vista.getUint32(14, true);
    const secuencia = vista.getUint32(18, true);
    const declarado = vista.getUint32(22, true);
    const cuantos = datos[pos + 26];
    const tabla = datos.subarray(pos + 27, pos + 27 + cuantos);
    const cuerpo = tabla.reduce((suma, valor) => suma + valor, 0);
    const fin = pos + 27 + cuantos + cuerpo;

    const copia = datos.slice(pos, fin);
    new DataView(copia.buffer).setUint32(22, 0, true);
    assert.equal(crc(copia), declarado, `CRC incorrecto en la página ${secuencia}`);

    // La tabla de largos se rearma en paquetes: un valor menor a 255 cierra uno.
    const paquetes: Uint8Array[] = [];
    let lectura = pos + 27 + cuantos;
    let actual: Uint8Array[] = [...arrastre];
    arrastre = [];
    for (const valor of tabla) {
      actual.push(datos.subarray(lectura, lectura + valor));
      lectura += valor;
      if (valor < 255) {
        paquetes.push(juntar(...actual));
        actual = [];
      }
    }
    if (actual.length > 0) arrastre = actual;

    paginas.push({ tipo, granulo, secuencia, serie, paquetes });
    pos = fin;
  }

  assert.equal(arrastre.length, 0, "quedó un paquete sin cerrar");
  return paginas;
}

// --- Pruebas --------------------------------------------------------------

test("un audio corto sale con sus paquetes intactos", () => {
  // Uno de 255 justos: obliga a cerrar con un segmento en cero.
  const paquetes = [paquete(80, 1), paquete(255, 2), paquete(600, 3)];
  const ogg = webmOpusAOgg(armarWebm(paquetes));
  assert.ok(ogg, "la conversión devolvió null");

  const paginas = leerOgg(ogg);
  assert.equal(paginas.length, 3, "se esperaban cabecera, tags y una de audio");

  assert.equal(paginas[0].tipo, 0x02, "la primera página tiene que abrir el flujo");
  assert.deepEqual([...paginas[0].paquetes[0]], [...opusHead], "el OpusHead no se copió igual");
  assert.equal(
    new TextDecoder().decode(paginas[1].paquetes[0].subarray(0, 8)),
    "OpusTags",
    "falta la página de tags",
  );

  const audio = paginas[2];
  assert.equal(audio.tipo, 0x04, "la última página tiene que cerrar el flujo");
  assert.equal(audio.paquetes.length, 3);
  paquetes.forEach((esperado, i) => {
    assert.deepEqual([...audio.paquetes[i]], [...esperado], `el paquete ${i} salió distinto`);
  });
  assert.equal(audio.granulo, 3n * 960n, "la duración acumulada no coincide");
  assert.equal(paginas.every((p) => p.serie === paginas[0].serie), true);
});

test("un audio largo se reparte en varias páginas", () => {
  // 300 paquetes de un segmento cada uno: no entran en una sola página.
  const paquetes = Array.from({ length: 300 }, (_, i) => paquete(40, i));
  const ogg = webmOpusAOgg(armarWebm(paquetes));
  assert.ok(ogg);

  const paginas = leerOgg(ogg);
  const audio = paginas.slice(2);
  assert.ok(audio.length >= 2, "tendría que haber más de una página de audio");
  assert.equal(
    audio.reduce((suma, pagina) => suma + pagina.paquetes.length, 0),
    300,
    "se perdieron paquetes en el camino",
  );
  assert.equal(audio[audio.length - 1].granulo, 300n * 960n);
  assert.equal(audio[audio.length - 1].tipo, 0x04);
  assert.equal(
    audio.slice(0, -1).every((pagina) => pagina.tipo === 0x00),
    true,
    "sólo la última página cierra el flujo",
  );
  // Las secuencias tienen que ser correlativas: un salto rompe el reproductor.
  paginas.forEach((pagina, i) => assert.equal(pagina.secuencia, i));
});

test("un paquete partido entre dos páginas se vuelve a unir", () => {
  // 254 paquetes de un segmento y después uno grande: el grande no entra entero.
  const paquetes = [...Array.from({ length: 254 }, (_, i) => paquete(40, i)), paquete(700, 9)];
  const ogg = webmOpusAOgg(armarWebm(paquetes));
  assert.ok(ogg);

  const paginas = leerOgg(ogg).slice(2);
  const todos = paginas.flatMap((pagina) => pagina.paquetes);
  assert.equal(todos.length, 255);
  assert.deepEqual([...todos[254]], [...paquetes[254]], "el paquete grande se cortó");
});

test("un archivo que no es Opus se rechaza en vez de salir roto", () => {
  const vorbis = juntar(
    abierto(
      [0x18, 0x53, 0x80, 0x67],
      elemento(
        [0x16, 0x54, 0xae, 0x6b],
        elemento(
          [0xae],
          juntar(elemento([0xd7], bytes(0x01)), elemento([0x86], new TextEncoder().encode("A_VORBIS"))),
        ),
      ),
    ),
  );
  assert.equal(webmOpusAOgg(vorbis), null);
  assert.equal(webmOpusAOgg(new Uint8Array(0)), null);
  assert.equal(webmOpusAOgg(Uint8Array.from([1, 2, 3, 4, 5])), null);
});
