/**
 * Qué imagen o video deja mandar el CRM.
 *
 * Importa que esto esté cubierto porque la misma función la usan los dos lados:
 * el navegador para avisar antes de subir y el servidor para no confiar en lo
 * que avisó el navegador. Si los dos dejaran de coincidir, un archivo podría
 * subir entero para que el servidor lo rechace al final, o peor, pasar sin que
 * nadie lo revise.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  ACEPTA_ADJUNTOS,
  clasificarAdjunto,
  MAX_ADJUNTO_BYTES,
  MAX_CAPTION,
  MAX_IMAGEN_BYTES,
  MAX_VIDEO_BYTES,
  revisarAdjunto,
} from "../src/lib/adjuntos.ts";

test("una imagen y un video se reconocen con su extensión", () => {
  assert.deepEqual(clasificarAdjunto("image/jpeg"), {
    kind: "imagen",
    mimeType: "image/jpeg",
    extension: "jpg",
    maxBytes: MAX_IMAGEN_BYTES,
  });

  assert.deepEqual(clasificarAdjunto("video/mp4"), {
    kind: "video",
    mimeType: "video/mp4",
    extension: "mp4",
    maxBytes: MAX_VIDEO_BYTES,
  });
});

test("el mime con parámetros y en mayúsculas sigue siendo el mismo", () => {
  // Varios navegadores agregan el códec: `video/mp4;codecs=avc1`.
  assert.equal(clasificarAdjunto("video/mp4;codecs=avc1.42E01E")?.kind, "video");
  assert.equal(clasificarAdjunto("IMAGE/PNG")?.extension, "png");
  // El mime se guarda limpio: es el que va al `Content-Type` del archivo subido.
  assert.equal(clasificarAdjunto("video/mp4;codecs=avc1")?.mimeType, "video/mp4");
});

test("lo que no se puede mandar no se clasifica", () => {
  // Un audio no va por acá: tiene su propio camino, con grabador y transcripción.
  assert.equal(clasificarAdjunto("audio/ogg"), null);
  assert.equal(clasificarAdjunto("application/pdf"), null);
  assert.equal(clasificarAdjunto(""), null);
  assert.equal(clasificarAdjunto(null), null);
  assert.equal(clasificarAdjunto(undefined), null);
});

test("el tope de la imagen es el de la imagen y no el del video", () => {
  // El caso que esto cuida: una imagen de 8 MB pasa el tope general pero no el
  // suyo, y WhatsApp la rechazaría después de subirla entera.
  const imagenGrande = revisarAdjunto("image/png", MAX_IMAGEN_BYTES + 1);
  assert.equal(imagenGrande.ok, false);
  assert.match(imagenGrande.ok === false ? imagenGrande.error : "", /liviana/);

  // Ese mismo tamaño en un video sí entra.
  assert.equal(revisarAdjunto("video/mp4", MAX_IMAGEN_BYTES + 1).ok, true);
});

test("el video tiene su propio tope y su propio aviso", () => {
  const pasado = revisarAdjunto("video/mp4", MAX_VIDEO_BYTES + 1);
  assert.equal(pasado.ok, false);
  assert.match(pasado.ok === false ? pasado.error : "", /Recortalo/);

  // Justo en el tope entra: el límite es "más de", no "a partir de".
  assert.equal(revisarAdjunto("video/mp4", MAX_VIDEO_BYTES).ok, true);
});

test("un archivo vacío no se manda", () => {
  const vacio = revisarAdjunto("image/jpeg", 0);
  assert.equal(vacio.ok, false);
  assert.match(vacio.ok === false ? vacio.error : "", /vacío/);
});

test("un formato que no aceptamos lo dice sin tecnicismos", () => {
  const malo = revisarAdjunto("application/zip", 1000);
  assert.equal(malo.ok, false);
  // El aviso lo lee un vendedor, no un programador: tiene que decir qué sí se
  // puede mandar, no sólo que ese mime no está en una lista.
  assert.match(malo.ok === false ? malo.error : "", /JPG/);
  assert.match(malo.ok === false ? malo.error : "", /MP4/);
});

test("el tope general es el más grande de los dos", () => {
  // De acá sale el límite del bucket y el del cuerpo de la Server Action: si
  // quedara por debajo del tope del video, el video más grande que el CRM
  // acepta rebotaría contra el almacenamiento.
  assert.equal(MAX_ADJUNTO_BYTES, MAX_VIDEO_BYTES);
  assert.ok(MAX_ADJUNTO_BYTES >= MAX_IMAGEN_BYTES);
});

test("el accept del selector ofrece lo mismo que se acepta", () => {
  // Sin esto el selector podría dejar elegir un archivo que después se rechaza,
  // o esconder uno que sí se puede mandar.
  for (const mime of ACEPTA_ADJUNTOS.split(",")) {
    assert.ok(clasificarAdjunto(mime), `el accept ofrece ${mime} pero no se acepta`);
  }
});

test("el tope del epígrafe es el de WhatsApp", () => {
  // El número importa: es el que el cliente le pone al `maxLength` del campo y
  // el que el servidor revisa antes de subir el archivo. Si quedaran distintos,
  // el campo dejaría escribir un texto que después hace rebotar el envío.
  assert.equal(MAX_CAPTION, 1024);
});
