/**
 * Qué se guarda de un mensaje entrante, y qué ni siquiera es un mensaje.
 *
 * El caso que originó esto: en el chat del CRM aparecían burbujas
 * «(mensaje sin texto)» que en el WhatsApp del contacto no existían. Eran los
 * avisos internos de WhatsApp —protocolo, cifrado— entrando por el mismo
 * webhook que los mensajes.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  contenidoDelMensaje,
  MEDIA_DESCONOCIDA,
  MEDIA_ILEGIBLE,
  MEDIA_LEGIBLE,
  SIN_TEXTO,
  vieneVacio,
  vistaPreviaDelMensaje,
} from "../src/lib/media-notes.ts";

test("un evento sin texto ni adjunto no es un mensaje", () => {
  assert.equal(vieneVacio(null, null), true);
  assert.equal(vieneVacio("", undefined), true);
  // Un texto que es sólo espacios tampoco dice nada.
  assert.equal(vieneVacio("   \n ", null), true);
});

test("un adjunto sin texto sí es un mensaje", () => {
  assert.equal(vieneVacio(null, "video"), false);
  assert.equal(vieneVacio(null, "audio"), false);
  // Un tipo que todavía no modelamos igual es algo que la persona mandó.
  assert.equal(vieneVacio("", "poll"), false);
});

test("un texto sin adjunto sí es un mensaje", () => {
  assert.equal(vieneVacio("Hola", null), false);
});

test("el contenido nunca queda vacío", () => {
  assert.equal(contenidoDelMensaje("  Hola  ", null), "Hola");
  assert.equal(contenidoDelMensaje(null, "audio"), MEDIA_LEGIBLE.audio.pending);
  assert.equal(contenidoDelMensaje(null, "video"), MEDIA_ILEGIBLE.video);
  assert.equal(contenidoDelMensaje(null, "poll"), MEDIA_DESCONOCIDA);
  // El último recurso: hoy estos eventos se descartan antes de llegar acá.
  assert.equal(contenidoDelMensaje(null, null), SIN_TEXTO);
});

test("con adjunto y texto se guarda el texto solo", () => {
  assert.equal(contenidoDelMensaje("mirá esto", "video"), "mirá esto");
});

test("el aviso dice qué llegó, sin el marcador de «leyendo»", () => {
  assert.equal(vistaPreviaDelMensaje(null, "audio"), "🎤 Audio");
  assert.equal(vistaPreviaDelMensaje("", "image"), "🖼️ Imagen");
  assert.equal(vistaPreviaDelMensaje(null, "video"), MEDIA_ILEGIBLE.video);
  // Si escribió algo, eso es lo que importa, venga o no con adjunto.
  assert.equal(vistaPreviaDelMensaje(" escuchá esto ", "audio"), "escuchá esto");
});
