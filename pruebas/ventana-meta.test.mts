import assert from "node:assert";
import { test } from "node:test";

import {
  silenceLabelSince,
  silenceStateSince,
  ventanaCerrada,
  ventanaSinAbrir,
} from "../src/lib/ventana-meta.ts";

const AHORA = new Date("2026-09-27T17:00:00Z").getTime();
const haceHoras = (horas: number) => new Date(AHORA - horas * 60 * 60 * 1000).toISOString();

test("la ventana se da por cerrada recién a las 24 h", () => {
  assert.equal(silenceStateSince(haceHoras(23.9), AHORA), "risk");
  assert.equal(silenceStateSince(haceHoras(24), AHORA), "expired");
  assert.equal(silenceStateSince(haceHoras(72), AHORA), "expired");
});

test("los tramos previos avisan antes de que se cierre", () => {
  assert.equal(silenceStateSince(haceHoras(1), AHORA), "fresh");
  assert.equal(silenceStateSince(haceHoras(10), AHORA), "warm");
  assert.equal(silenceStateSince(haceHoras(21), AHORA), "risk");
});

test("sin fecha del contacto no se inventa un estado", () => {
  assert.equal(silenceStateSince(null, AHORA), null);
  assert.equal(silenceLabelSince(undefined, AHORA), null);
  assert.equal(silenceStateSince("no es una fecha", AHORA), null);
});

test("una fecha futura no cuenta como tiempo negativo", () => {
  assert.equal(silenceStateSince(haceHoras(-5), AHORA), "fresh");
});

test("Instagram y Messenger no ofrecen salida: sólo esperar", () => {
  for (const canal of ["instagram", "messenger"] as const) {
    const texto = ventanaCerrada(canal);
    assert.match(texto, /24 h se cerró/);
    assert.match(texto, /vuelva a escribir/);
    assert.doesNotMatch(texto, /plantilla/i);
  }

  assert.match(ventanaCerrada("instagram"), /Instagram/);
  assert.match(ventanaCerrada("messenger"), /Messenger/);
});

test("en WhatsApp la salida es la plantilla, y el aviso lo dice", () => {
  assert.match(ventanaCerrada("whatsapp"), /plantilla aprobada/);
});

test("la etiqueta se lee como la diría una persona", () => {
  assert.equal(silenceLabelSince(new Date(AHORA - 30_000).toISOString(), AHORA), "hace menos de 1 min");
  assert.equal(silenceLabelSince(new Date(AHORA - 45 * 60_000).toISOString(), AHORA), "hace 45 min");
  assert.equal(silenceLabelSince(haceHoras(3), AHORA), "hace 3 h");
  assert.equal(silenceLabelSince(new Date(AHORA - 3.5 * 3_600_000).toISOString(), AHORA), "hace 3 h 30 min");
  assert.equal(silenceLabelSince(haceHoras(48), AHORA), "hace 2 d");
  assert.equal(silenceLabelSince(haceHoras(50), AHORA), "hace 2 d 2 h");
});

test("sin un solo mensaje del contacto no hay ventana que haya corrido", () => {
  assert.equal(silenceStateSince(null, AHORA), null);
  assert.equal(silenceLabelSince(null, AHORA), null);
});

test("al contacto que nunca escribió se le avisa la salida de cada canal", () => {
  assert.match(ventanaSinAbrir("whatsapp", true)!, /plantilla aprobada/);

  for (const canal of ["instagram", "messenger"] as const) {
    const texto = ventanaSinAbrir(canal, false)!;
    assert.match(texto, /todavía no escribió/);
    assert.doesNotMatch(texto, /plantilla/i);
  }

  assert.match(ventanaSinAbrir("instagram", false)!, /Instagram/);
  assert.match(ventanaSinAbrir("messenger", false)!, /Messenger/);
});

test("en un WhatsApp vinculado por QR no hay nada que advertir: se escribe y listo", () => {
  assert.equal(ventanaSinAbrir("whatsapp", false), null);
});
