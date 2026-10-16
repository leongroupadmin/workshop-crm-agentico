/**
 * Pruebas del enlace de una cita, que termina en el `{link}` de un
 * recordatorio de WhatsApp: lo que no tiene forma de enlace sale como un link
 * roto, así que no se guarda.
 */
import assert from "node:assert";
import { test } from "node:test";

import { leerEnlace } from "../src/lib/citas.ts";

test("un enlace con forma de enlace se guarda", () => {
  assert.equal(leerEnlace("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(leerEnlace("  https://zoom.us/j/123  "), "https://zoom.us/j/123");
});

test("lo que no es un enlace no se guarda a medias", () => {
  assert.equal(leerEnlace("pasar por la oficina"), null);
  assert.equal(leerEnlace("meet.google.com/abc"), null);
  assert.equal(leerEnlace("javascript:alert(1)"), null);
  assert.equal(leerEnlace(""), null);
  assert.equal(leerEnlace(null), null);
  assert.equal(leerEnlace(`https://x.com/${"a".repeat(2100)}`), null);
});
