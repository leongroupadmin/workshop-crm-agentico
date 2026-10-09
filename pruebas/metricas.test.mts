/**
 * Prueba de los formatos y las comparaciones del Resumen.
 *
 * Lo que se cuida acá es lo que la tarjeta le dice al usuario: que una caída en
 * el lapso de réplica se vea como una buena noticia y no como una mala, y que
 * un lapso no se muestre nunca en una unidad que no se pueda leer de un vistazo.
 */
import assert from "node:assert";
import { test } from "node:test";

import { dineroCompacto, formatearDuracion, variacion } from "../src/lib/metricas.ts";

test("la variación redondea y trae el signo", () => {
  const arriba = variacion(120, 100, true);
  assert.equal(arriba?.text, "+20%");
  assert.equal(arriba?.direction, "up");

  const abajo = variacion(80, 100, true);
  assert.equal(abajo?.text, "−20%");
  assert.equal(abajo?.direction, "down");
});

test("subir no siempre es bueno", () => {
  // Veinte leads más que el mes pasado es una buena noticia; veinte minutos más
  // de demora en contestar es exactamente la contraria, y la tarjeta las pinta
  // con el mismo componente.
  assert.equal(variacion(120, 100, true)?.good, true);
  assert.equal(variacion(120, 100, false)?.good, false);
  assert.equal(variacion(80, 100, false)?.good, true);
});

test("una diferencia menor al punto se dice con palabras", () => {
  // Redondeado se vería "+0%", que se lee como un error de la pantalla.
  const igual = variacion(1003, 1000, true);
  assert.equal(igual?.text, "sin cambios");
  assert.equal(igual?.direction, "flat");
});

test("sin nada que comparar no hay tendencia", () => {
  assert.equal(variacion(0, 0, true), undefined);
});

test("sin período previo no se inventa un porcentaje", () => {
  // Dividir por cero da infinito y "+∞%" no le dice nada a nadie.
  assert.equal(variacion(40, 0, true)?.text, "sin base previa");
});

test("cada lapso se muestra en la unidad en la que uno lo diría", () => {
  assert.equal(formatearDuracion(45), "45 s");
  assert.equal(formatearDuracion(90), "2 min");
  assert.equal(formatearDuracion(3600), "1 h");
  assert.equal(formatearDuracion(4320), "1 h 12 min");
  assert.equal(formatearDuracion(86400), "1 d");
  assert.equal(formatearDuracion(97200), "1 d 3 h");
});

test("un lapso imposible no se dibuja", () => {
  assert.equal(formatearDuracion(-1), "—");
  assert.equal(formatearDuracion(Number.NaN), "—");
});

test("el dinero cambia de unidad arriba del millón", () => {
  // El formato viejo cortaba en miles y nada más: un embudo de un millón y
  // medio se mostraba como "US$ 1500.0k".
  assert.equal(dineroCompacto(0), "US$ 0");
  assert.equal(dineroCompacto(999), "US$ 999");
  assert.equal(dineroCompacto(1500), "US$ 1.5k");
  assert.equal(dineroCompacto(1_500_000), "US$ 1.5M");
});
