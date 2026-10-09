/**
 * Prueba del WAV que el chat arma para Instagram y Messenger.
 *
 * La decodificación usa la Web Audio API y sólo corre en el navegador; acá se
 * prueba la parte que no depende de él: que la cabecera diga lo que Instagram
 * va a leer y que las muestras queden donde tienen que estar.
 */
import assert from "node:assert";
import { test } from "node:test";

import { FRECUENCIA_WAV, wavDesdeMuestras } from "../src/lib/audio/a-wav.ts";

const texto = (wav: Uint8Array, desde: number, largo: number) =>
  String.fromCharCode(...wav.subarray(desde, desde + largo));

test("la cabecera describe un WAV PCM mono de 16 bits", () => {
  const wav = wavDesdeMuestras(new Float32Array([0, 0.5, -0.5]));
  const vista = new DataView(wav.buffer);

  assert.equal(texto(wav, 0, 4), "RIFF");
  assert.equal(vista.getUint32(4, true), wav.length - 8);
  assert.equal(texto(wav, 8, 4), "WAVE");
  assert.equal(texto(wav, 12, 4), "fmt ");
  assert.equal(vista.getUint16(20, true), 1); // PCM
  assert.equal(vista.getUint16(22, true), 1); // mono
  assert.equal(vista.getUint32(24, true), FRECUENCIA_WAV);
  assert.equal(vista.getUint32(28, true), FRECUENCIA_WAV * 2);
  assert.equal(vista.getUint16(34, true), 16);
  assert.equal(texto(wav, 36, 4), "data");
  assert.equal(vista.getUint32(40, true), 6);
  assert.equal(wav.length, 44 + 6);
});

test("las muestras se pasan a enteros y lo que se pasa de rango se recorta", () => {
  const wav = wavDesdeMuestras(new Float32Array([0, 1, -1, 2, -2]));
  const vista = new DataView(wav.buffer);
  const muestra = (i: number) => vista.getInt16(44 + i * 2, true);

  assert.equal(muestra(0), 0);
  assert.equal(muestra(1), 32767);
  assert.equal(muestra(2), -32768);
  assert.equal(muestra(3), 32767);
  assert.equal(muestra(4), -32768);
});

test("tres minutos entran en el tope de 6 MB del servidor", () => {
  const wav = wavDesdeMuestras(new Float32Array(180 * FRECUENCIA_WAV));
  assert.ok(wav.length < 6 * 1024 * 1024);
});
