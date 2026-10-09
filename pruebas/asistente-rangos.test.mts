import assert from "node:assert/strict";
import test from "node:test";

import { diaValido, rangoDelPeriodo } from "../src/lib/asistente-rangos.ts";

const ZONA = "America/Argentina/Buenos_Aires";

const rango = (desde: unknown, hasta: unknown, hoy = "2026-09-19") =>
  rangoDelPeriodo({ desde, hasta, hoyKey: hoy, timezone: ZONA });

test("sin fechas usa el mes en curso hasta hoy", () => {
  const resultado = rango(undefined, undefined, "2026-09-19");
  assert.equal(resultado.desdeKey, "2026-09-01");
  assert.equal(resultado.hastaKey, "2026-09-19");
});

test("el último día pedido entra entero", () => {
  // El corte va al arranque del día siguiente: sin esto, preguntar por un solo
  // día devuelve cero.
  const resultado = rango("2026-09-19", "2026-09-19");
  assert.equal(resultado.hasta.getTime() - resultado.desde.getTime(), 86_400_000);
});

test("el tramo anterior es igual de largo y termina donde arranca el pedido", () => {
  // Del 1 al 19 son 19 días, así que atrás van del 13/8 al 31/8.
  const resultado = rango("2026-09-01", "2026-09-19");
  assert.equal(resultado.previoHastaKey, "2026-08-31");
  assert.equal(resultado.previoDesdeKey, "2026-08-13");
  assert.equal(
    resultado.desde.getTime() - resultado.previoDesde.getTime(),
    resultado.hasta.getTime() - resultado.desde.getTime(),
  );
});

test("el tramo anterior no es el mes pasado entero", () => {
  // Es la trampa que hace que todo parezca un derrumbe cada día 19: comparar
  // diecinueve días contra treinta y uno.
  const resultado = rango(undefined, undefined, "2026-09-19");
  assert.notEqual(resultado.previoDesdeKey, "2026-08-01");
});

test("una fecha de inicio posterior al final se descarta", () => {
  const resultado = rango("2026-09-30", "2026-09-19");
  assert.equal(resultado.desdeKey, "2026-09-01");
});

test("una fecha inventada por el modelo cae en el valor por defecto", () => {
  assert.equal(rango("la semana pasada", undefined, "2026-09-19").desdeKey, "2026-09-01");
  assert.equal(rango(undefined, "ayer", "2026-09-19").hastaKey, "2026-09-19");
});

test("diaValido acepta sólo una fecha real en AAAA-MM-DD", () => {
  assert.equal(diaValido("2026-09-19"), "2026-09-19");
  assert.equal(diaValido("2026-2-3"), null);
  assert.equal(diaValido("19/09/2026"), null);
  assert.equal(diaValido(""), null);
  assert.equal(diaValido(undefined), null);
  assert.equal(diaValido(20260919), null);
});

test("un día que no existe no se acepta aunque tenga el formato", () => {
  // `new Date("2026-02-30")` no falla: rueda al 2 de marzo, y una métrica de
  // un día inventado es peor que caer en el valor por defecto.
  assert.equal(diaValido("2026-02-30"), null);
  assert.equal(diaValido("2026-13-01"), null);
});

test("el 29 de febrero vale en un año bisiesto y no en uno común", () => {
  assert.equal(diaValido("2028-02-29"), "2028-02-29");
  assert.equal(diaValido("2027-02-29"), null);
});

test("un rango que cruza el cambio de mes conserva el largo", () => {
  const resultado = rango("2026-01-15", "2026-02-14");
  const dias = (resultado.hasta.getTime() - resultado.desde.getTime()) / 86_400_000;
  assert.equal(dias, 31);
  assert.equal(resultado.previoHastaKey, "2026-01-14");
});
