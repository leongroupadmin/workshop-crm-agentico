import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REPLY_DELAY_SECONDS,
  MAX_REPLY_DELAY_SECONDS,
  MIN_REPLY_DELAY_SECONDS,
  errorDeDemora,
} from "../src/lib/agent-limits.ts";

test("la demora por defecto es válida", () => {
  assert.equal(errorDeDemora(DEFAULT_REPLY_DELAY_SECONDS), null);
});

test("la demora no puede bajar del piso que sostiene el agrupamiento", () => {
  // El 0 es el caso que importa: es lo que pone alguien que quiere que el
  // agente "responda más rápido" sin saber que con eso pierde la ventana en la
  // que se juntan los mensajes de una ráfaga.
  const error = errorDeDemora(0);
  assert.ok(error);
  assert.match(error, /ráfaga/);
});

test("los dos extremos permitidos se guardan", () => {
  assert.equal(errorDeDemora(MIN_REPLY_DELAY_SECONDS), null);
  assert.equal(errorDeDemora(MAX_REPLY_DELAY_SECONDS), null);
});

test("pasarse de cualquiera de los dos límites se rechaza", () => {
  assert.ok(errorDeDemora(MIN_REPLY_DELAY_SECONDS - 1));
  assert.ok(errorDeDemora(MAX_REPLY_DELAY_SECONDS + 1));
});

test("lo que no es un entero no se guarda", () => {
  // El campo del panel es texto: un `Number("abc")` da NaN y un "5.5" da un
  // decimal, y ninguno de los dos puede llegar al check de Postgres.
  assert.ok(errorDeDemora(Number.NaN));
  assert.ok(errorDeDemora(5.5));
});

test("un negativo se rechaza por el piso y no por el tipo", () => {
  const error = errorDeDemora(-3);
  assert.ok(error);
  assert.match(error, /ráfaga/);
});
