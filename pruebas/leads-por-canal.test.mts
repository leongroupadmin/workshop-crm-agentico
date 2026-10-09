/**
 * Prueba de la torta de canales del Resumen.
 *
 * Lo que se cuida es lo que la tarjeta le dice al usuario: que los porcentajes
 * sumen cien, que el mes y el histórico no se mezclen, y que los canales estén
 * siempre en el mismo orden, así WhatsApp no cambia de lado de un mes al otro.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  caminoDePorcion,
  leerLeadsPorCanal,
  porcionesDeLaTorta,
  puntoDeLaVuelta,
} from "../src/lib/leads-por-canal.ts";

test("lee las filas de la base, con bigint como texto o número", () => {
  const filas = leerLeadsPorCanal([
    { canal: "whatsapp", total: "12", del_tramo: 3 },
    { canal: "web", total: 2, del_tramo: "2" },
  ]);
  assert.deepEqual(filas, [
    { canal: "whatsapp", total: 12, delMes: 3 },
    { canal: "web", total: 2, delMes: 2 },
  ]);
});

test("un canal desconocido o una respuesta rara no rompen la tarjeta", () => {
  assert.deepEqual(leerLeadsPorCanal([{ canal: "tiktok", total: 4, del_tramo: 1 }]), []);
  assert.deepEqual(leerLeadsPorCanal(null), []);
  assert.deepEqual(leerLeadsPorCanal([{ canal: "manual", total: null, del_tramo: -3 }]), [
    { canal: "manual", total: 0, delMes: 0 },
  ]);
});

test("el mes cuenta los del mes y el histórico todos", () => {
  const filas = leerLeadsPorCanal([
    { canal: "whatsapp", total: 30, del_tramo: 6 },
    { canal: "instagram", total: 10, del_tramo: 0 },
  ]);

  const mes = porcionesDeLaTorta(filas, "mes");
  assert.equal(mes.total, 6);
  assert.deepEqual(
    mes.porciones.map((porcion) => porcion.canal),
    ["whatsapp"],
    "un canal en cero no tiene tajada",
  );

  const historico = porcionesDeLaTorta(filas, "historico");
  assert.equal(historico.total, 40);
  assert.deepEqual(
    historico.porciones.map((porcion) => [porcion.canal, porcion.porcentaje]),
    [
      ["whatsapp", 75],
      ["instagram", 25],
    ],
  );
});

test("el orden es el de los canales, no el del tamaño", () => {
  const { porciones } = porcionesDeLaTorta(
    leerLeadsPorCanal([
      { canal: "manual", total: 50, del_tramo: 50 },
      { canal: "web", total: 1, del_tramo: 1 },
      { canal: "whatsapp", total: 2, del_tramo: 2 },
    ]),
    "mes",
  );
  assert.deepEqual(
    porciones.map((porcion) => porcion.canal),
    ["whatsapp", "web", "manual"],
  );
});

test("los porcentajes suman cien aunque redondeados no den", () => {
  const { porciones } = porcionesDeLaTorta(
    leerLeadsPorCanal([
      { canal: "whatsapp", total: 1, del_tramo: 1 },
      { canal: "instagram", total: 1, del_tramo: 1 },
      { canal: "messenger", total: 1, del_tramo: 1 },
    ]),
    "mes",
  );
  assert.deepEqual(
    porciones.map((porcion) => porcion.porcentaje),
    [34, 33, 33],
  );
});

test("las tajadas cubren la vuelta entera, sin huecos", () => {
  const { porciones } = porcionesDeLaTorta(
    leerLeadsPorCanal([
      { canal: "whatsapp", total: 1, del_tramo: 1 },
      { canal: "instagram", total: 1, del_tramo: 1 },
      { canal: "calendar", total: 1, del_tramo: 1 },
    ]),
    "mes",
  );
  assert.equal(porciones[0].desde, 0);
  assert.equal(porciones[1].desde, porciones[0].hasta);
  assert.equal(porciones[2].desde, porciones[1].hasta);
  assert.equal(porciones.at(-1)?.hasta, 1);
});

test("sin leads no hay porciones", () => {
  assert.deepEqual(porcionesDeLaTorta([], "historico"), { total: 0, porciones: [] });
  assert.deepEqual(
    porcionesDeLaTorta(leerLeadsPorCanal([{ canal: "web", total: 3, del_tramo: 0 }]), "mes"),
    { total: 0, porciones: [] },
  );
});

test("la vuelta arranca a las doce y gira como el reloj", () => {
  assert.deepEqual(puntoDeLaVuelta(0, 80), { x: 80, y: 0 });
  assert.deepEqual(puntoDeLaVuelta(0.25, 80), { x: 160, y: 80 });
  assert.deepEqual(puntoDeLaVuelta(0.5, 80), { x: 80, y: 160 });
});

test("una tajada de más de media vuelta usa el arco largo", () => {
  assert.equal(caminoDePorcion(0, 0.25, 80), "M 80 80 L 80 0 A 80 80 0 0 1 160 80 Z");
  assert.match(caminoDePorcion(0, 0.75, 80), / A 80 80 0 1 1 /);
});
