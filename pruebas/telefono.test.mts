/**
 * Pruebas de cómo se normaliza y se busca un teléfono.
 *
 * Un teléfono mal normalizado duplica contactos o manda un mensaje a un número
 * que no existe, así que se afirma acá y no se confía a la pantalla.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  formasDelTelefono,
  normalizarTelefono,
  sePuedeEscribirPrimero,
} from "../src/lib/telefono.ts";

test("el teléfono queda en E.164 sin importar cómo se cargó", () => {
  assert.equal(normalizarTelefono("+54 9 11 2233-4455"), "+5491122334455");
  assert.equal(normalizarTelefono("(011) 5555 6666"), "+01155556666");
  assert.equal(normalizarTelefono("5491122334455"), "+5491122334455");
});

test("normalizar un número ya normalizado no lo cambia", () => {
  const una = normalizarTelefono("+54 9 11 2233 4455");
  assert.equal(normalizarTelefono(una), una);
});

test("lo que no puede ser un teléfono no se manda", () => {
  for (const roto of [null, undefined, "", "sin números", "12345", "1".repeat(16)]) {
    assert.equal(normalizarTelefono(roto), null, `debería descartar ${JSON.stringify(roto)}`);
  }
});

test("un móvil argentino se busca con y sin el 9, con y sin el +", () => {
  // Es el caso que duplicaba contactos: WhatsApp guarda +549…, quien carga a
  // mano escribe el número sin el 9, y una igualdad exacta los trata como dos
  // personas distintas.
  const formas = formasDelTelefono("+5491122334455");

  assert.ok(formas.includes("+5491122334455"));
  assert.ok(formas.includes("5491122334455"));
  assert.ok(formas.includes("+541122334455"));
  assert.ok(formas.includes("541122334455"));
});

test("el mismo número escrito sin el 9 devuelve exactamente las mismas formas", () => {
  // Si no, encontrarse dependería de cuál de los dos se cargó primero.
  const con = [...formasDelTelefono("+5491122334455")].sort();
  const sin = [...formasDelTelefono("+541122334455")].sort();

  assert.deepEqual(con, sin);
});

test("da igual cómo venga escrito: espacios, guiones o paréntesis", () => {
  const esperado = [...formasDelTelefono("+5491122334455")].sort();

  for (const escrito of ["+54 9 11 2233-4455", "(54) 9 11 2233.4455", "54 9 1122334455"]) {
    assert.deepEqual([...formasDelTelefono(escrito)].sort(), esperado, escrito);
  }
});

test("a un número de otro país no se le toca el 9", () => {
  // Fuera de Argentina ese dígito es parte del número, y sacarlo apuntaría a
  // otro lado. Sólo se devuelven las dos formas del mismo número.
  const formas = formasDelTelefono("+34911223344");

  assert.deepEqual(formas.sort(), ["+34911223344", "34911223344"]);
});

test("un teléfono que no sirve no devuelve ninguna forma", () => {
  // Sin esto, un `.in()` con lista vacía o con basura buscaría cualquier cosa.
  assert.deepEqual(formasDelTelefono(null), []);
  assert.deepEqual(formasDelTelefono(""), []);
  assert.deepEqual(formasDelTelefono("123"), []);
});

test("se le puede escribir primero sólo a un teléfono útil", () => {
  assert.equal(sePuedeEscribirPrimero("+5491122334455"), true);
  assert.equal(sePuedeEscribirPrimero("123"), false);
  assert.equal(sePuedeEscribirPrimero(null), false);
});
