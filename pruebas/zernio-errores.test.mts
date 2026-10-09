import assert from "node:assert";
import { test } from "node:test";

import { causaDelRechazo, describeError } from "../src/lib/zernio-errores.ts";

/**
 * El cuerpo es el que devolvió Zernio de verdad el 27/9, cuando la bandeja
 * quedó sin poder responder por Instagram. Está textual a propósito: es el caso
 * que el CRM tradujo mal.
 */
const FUERA_DE_VENTANA = JSON.stringify({
  status: "failed",
  status_code: 403,
  error_message: "This message is sent outside of allowed window.",
  error_code: "platform_api_error",
});

test("un 403 por la ventana de Meta no acusa a la API key", () => {
  const mensaje = describeError(403, FUERA_DE_VENTANA, "6ab3e9828d284ffb21354b28");

  assert.match(mensaje, /24 horas/);
  assert.match(mensaje, /vuelva a escribir/);
  // La acusación vieja: que aparezca de nuevo es el bug volviendo.
  assert.doesNotMatch(mensaje, /API key/i);
  assert.doesNotMatch(mensaje, /6ab3e9828d284ffb21354b28/);
});

test("el 403 por la ventana no se reintenta reatando la cuenta", () => {
  assert.equal(causaDelRechazo(403, FUERA_DE_VENTANA), "ventana");
});

test("un 403 sin motivo reconocible sí queda como problema de cuenta", () => {
  const cuerpo = JSON.stringify({ error_message: "Account not found for this key." });

  assert.equal(causaDelRechazo(403, cuerpo), "cuenta");
  assert.match(describeError(403, cuerpo, "abc123"), /abc123/);
});

test("solo el 403 tiene causa: los demás códigos no se reintentan", () => {
  assert.equal(causaDelRechazo(401, FUERA_DE_VENTANA), undefined);
  assert.equal(causaDelRechazo(429, ""), undefined);
});

test("el motivo de Zernio se cita textual, venga donde venga", () => {
  const formas = [
    JSON.stringify({ error_message: "Sin permiso." }),
    JSON.stringify({ error: { message: "Sin permiso." } }),
    JSON.stringify({ message: "Sin permiso." }),
    JSON.stringify({ error: "Sin permiso." }),
  ];

  for (const cuerpo of formas) {
    assert.match(describeError(403, cuerpo), /Zernio dijo: "Sin permiso\."/, cuerpo);
  }
});

test("un cuerpo que no es JSON se muestra igual, en vez de perderse", () => {
  assert.match(describeError(500, "<html>502 Bad Gateway</html>"), /502 Bad Gateway/);
});

test("un cuerpo vacío no deja la frase colgando", () => {
  const mensaje = describeError(500, "");

  assert.equal(mensaje, "Zernio devolvió 500.");
  assert.doesNotMatch(mensaje, /dijo/i);
});

test("el motivo se acota y se aplana para que entre en un cartel", () => {
  const largo = JSON.stringify({ error_message: `${"a".repeat(400)}\n\n   b` });
  const mensaje = describeError(403, largo);

  assert.doesNotMatch(mensaje, /\n/);
  assert.ok(mensaje.length < 400, `quedó en ${mensaje.length}`);
});

/**
 * El motivo es el que mostró el chat el 6/10, cuando la IA no pudo contestar un
 * Instagram. El chat lo cortó a los 200 caracteres, así que lo que sigue a
 * «under Faceb» no se conoce; la forma del cuerpo es la del rechazo del 27/9.
 */
const OTRA_APP = JSON.stringify({
  status: "failed",
  status_code: 400,
  error_message:
    "This conversation is controlled by another receiver in Meta's conversation routing, so it can't be replied to from here right now (Meta subcode 2534037). Make this app the default receiver under Faceb",
  error_code: "platform_api_error",
});

test("si otra app atiende la conversación, dice qué cambiar en Meta", () => {
  const mensaje = describeError(400, OTRA_APP, "6ab3e9828d284ffb21354b28");

  assert.match(mensaje, /otra\s+app/);
  assert.match(mensaje, /Enrutamiento de\s+conversaciones/);
  assert.match(mensaje, /Zernio como app predeterminada/);
  // Ni la ventana ni la cuenta: son otras causas, con otros arreglos.
  assert.doesNotMatch(mensaje, /24 horas/);
  assert.doesNotMatch(mensaje, /6ab3e9828d284ffb21354b28/);
});

test("el rechazo por otra app no se reintenta, llegue con el código que llegue", () => {
  assert.equal(causaDelRechazo(400, OTRA_APP), "otraApp");
  // Como 403 se reataría la cuenta, que no tiene nada que ver.
  assert.equal(causaDelRechazo(403, OTRA_APP), "otraApp");
  assert.match(describeError(403, OTRA_APP), /Zernio como app predeterminada/);
});
