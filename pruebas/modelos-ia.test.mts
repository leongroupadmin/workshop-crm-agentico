import assert from "node:assert/strict";
import test from "node:test";

import {
  razonaAntesDeEscribir,
  TECHO_RESPUESTA,
  TECHO_RESPUESTA_RAZONADOR,
  techoDelModelo,
} from "../src/lib/modelos-ia.ts";

test("la familia gpt-5 y las o razonan", () => {
  for (const modelo of ["gpt-5", "gpt-5-mini", "gpt-5.1", "o3", "o4-mini"]) {
    assert.equal(razonaAntesDeEscribir(modelo), true, modelo);
  }
});

test("los que escriben directo no razonan", () => {
  for (const modelo of ["gpt-4o", "gpt-4o-mini", "gpt-4.1"]) {
    assert.equal(razonaAntesDeEscribir(modelo), false, modelo);
  }
});

test("gpt-5-chat empieza igual que la familia pero no razona", () => {
  // Es el que rechaza `reasoning_effort`: mandárselo deja al agente mudo.
  assert.equal(razonaAntesDeEscribir("gpt-5-chat-latest"), false);
});

test("el nombre se compara sin espacios ni mayúsculas", () => {
  assert.equal(razonaAntesDeEscribir("  GPT-5  "), true);
});

test("al razonador se le da más techo, porque de ahí sale lo que piensa", () => {
  assert.equal(techoDelModelo("gpt-5"), TECHO_RESPUESTA_RAZONADOR);
  assert.equal(techoDelModelo("gpt-4o"), TECHO_RESPUESTA);
  assert.ok(TECHO_RESPUESTA_RAZONADOR > TECHO_RESPUESTA);
});
