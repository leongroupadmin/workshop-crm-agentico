/**
 * La copia propia de lo que llega por WAHA.
 *
 * Importa por dos lados. El chat decide cómo mostrar la copia mirando su
 * extensión, así que una extensión mal puesta es un audio que se dibuja como
 * enlace. Y la ruta de la copia sale de una fila que el equipo puede editar y
 * se firma con la service role: lo que no tenga la forma exacta no se firma.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  formatoDeLaCopia,
  rutaDeLaCopia,
  urlDeLaCopia,
} from "../src/lib/adjuntos-recibidos.ts";
import { adivinarMedia } from "../src/lib/media-kind.ts";

const supabase = "https://abc.supabase.co";
const ruta = "0f8fad5b-d9cb-469f-a165-70867728950e/7c9e6679-7425-40de-944b-e07fc1f90ae7.ogg";
const waha = "http://127.0.0.1:3001/api/files/default/false_549351@c.us_AAA.oga";

test("una nota de voz de WhatsApp se guarda como ogg y el chat la ve como audio", () => {
  const formato = formatoDeLaCopia("audio/ogg; codecs=opus", waha);
  assert.deepEqual(formato, { extension: "ogg", contentType: "audio/ogg" });

  const url = urlDeLaCopia(supabase, `0f8fad5b-d9cb-469f-a165-70867728950e/x.${formato?.extension}`);
  assert.equal(adivinarMedia(url), "audio");
});

test("las fotos y los videos también se copian", () => {
  assert.equal(formatoDeLaCopia("image/jpeg", waha)?.extension, "jpg");
  assert.equal(formatoDeLaCopia("image/webp", waha)?.extension, "webp");
  assert.equal(formatoDeLaCopia("video/mp4", waha)?.extension, "mp4");
});

test("un documento no se copia, aunque la URL diga otra cosa", () => {
  assert.equal(formatoDeLaCopia("application/pdf", "http://x/api/files/a.pdf"), null);
  assert.equal(formatoDeLaCopia("application/pdf", "http://x/api/files/a.jpg"), null);
});

test("si el proveedor no dice qué es, decide la extensión del archivo", () => {
  assert.deepEqual(formatoDeLaCopia("application/octet-stream", waha), {
    extension: "oga",
    contentType: "application/octet-stream",
  });
  assert.deepEqual(formatoDeLaCopia(null, waha), {
    extension: "oga",
    contentType: "application/octet-stream",
  });
  assert.equal(formatoDeLaCopia(null, "http://x/api/files/sin-extension"), null);
  assert.equal(formatoDeLaCopia(null, "http://x/api/files/a.pdf"), null);
});

test("reconoce la copia que guardó el CRM", () => {
  assert.equal(rutaDeLaCopia(urlDeLaCopia(supabase, ruta), supabase), ruta);
  // La barra final o las mayúsculas en la variable de entorno no cambian nada.
  assert.equal(rutaDeLaCopia(urlDeLaCopia(supabase, ruta), `${supabase}/`), ruta);
  assert.equal(rutaDeLaCopia(urlDeLaCopia(supabase, ruta), "https://ABC.supabase.co"), ruta);
});

test("lo demás no es una copia", () => {
  assert.equal(rutaDeLaCopia(waha, supabase), null);
  assert.equal(rutaDeLaCopia(urlDeLaCopia(supabase, ruta), undefined), null);
  // Lo público de otro bucket, o la copia de otro proyecto de Supabase.
  assert.equal(
    rutaDeLaCopia(`${supabase}/storage/v1/object/public/notas-de-voz/${ruta}`, supabase),
    null,
  );
  assert.equal(rutaDeLaCopia(urlDeLaCopia("https://otro.supabase.co", ruta), supabase), null);
  assert.equal(rutaDeLaCopia("no es una url", supabase), null);
});

test("una fila editada no saca la firma del bucket", () => {
  // La ruta se firma con la service role: sólo pasa la forma que arma el CRM.
  const base = urlDeLaCopia(supabase, "");
  assert.equal(rutaDeLaCopia(`${base}../notas-de-voz/${ruta}`, supabase), null);
  assert.equal(rutaDeLaCopia(`${base}%2e%2e/notas-de-voz/${ruta}`, supabase), null);
  assert.equal(rutaDeLaCopia(`${base}a%2F..%2F..%2Fotro/${ruta}`, supabase), null);
  assert.equal(rutaDeLaCopia(`${base}${ruta}?download=1`, supabase), null);
  assert.equal(rutaDeLaCopia(`${base}${ruta}/extra`, supabase), null);
});
