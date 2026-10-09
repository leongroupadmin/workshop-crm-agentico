/**
 * Prueba de las conversiones del <input type="datetime-local">.
 *
 * Las afirmaciones son de ida y vuelta a propósito: una prueba con horas fijas
 * sólo pasaría en la zona donde se escribió, y lo que se quiere garantizar es
 * justamente que el instante no se corra según dónde estés.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_TIMEZONE,
  dayKeyInZone,
  fromLocalInputValue,
  monthStartKey,
  safeTimeZone,
  shiftDayKey,
  startOfDayInZone,
  toLocalInputValue,
  weekdayOfDayKey,
} from "../src/lib/fechas.ts";

test("ida y vuelta devuelve el mismo instante", () => {
  // El input trabaja al minuto, así que se compara sin segundos.
  const instante = new Date("2026-08-18T18:30:00.000Z");
  const vuelta = fromLocalInputValue(toLocalInputValue(instante));

  assert.equal(vuelta, instante.toISOString());
});

test("el texto del input se lee como hora local, no como UTC", () => {
  // Éste es el error que hacía que agendar no mostrara nada: interpretar la
  // hora de pared como si fuera UTC corre la cita según la zona del servidor.
  const texto = "2026-08-18T15:00";
  const esperado = new Date(2026, 7, 18, 15, 0).toISOString();

  assert.equal(fromLocalInputValue(texto), esperado);
});

test("una cita para dentro de una hora no queda en el pasado", () => {
  // La regresión concreta: el formulario propone la hora siguiente y el panel
  // sólo lista lo que viene. Si la conversión corre el instante hacia atrás,
  // la cita recién creada desaparece.
  const enUnaHora = new Date(Date.now() + 60 * 60 * 1000);
  const guardado = fromLocalInputValue(toLocalInputValue(enUnaHora));

  assert.ok(guardado);
  assert.ok(new Date(guardado).getTime() > Date.now());
});

test("un campo vacío o incompleto se rechaza en vez de guardar una fecha inválida", () => {
  assert.equal(fromLocalInputValue(""), null);
  assert.equal(fromLocalInputValue("no es una fecha"), null);
});

/**
 * Zona horaria del workspace.
 *
 * Las horas son fijas y en UTC a propósito: lo que se prueba es que el día lo
 * decida la zona pedida y no el reloj de quien corre las pruebas.
 */

test("el día lo decide la zona, no el servidor", () => {
  // 01:00 UTC del miércoles es todavía la noche del martes en Argentina. Es
  // exactamente el caso que mostraba una barra de miércoles en el resumen.
  const instante = new Date("2026-08-19T01:00:00.000Z");

  assert.equal(dayKeyInZone(instante, "America/Argentina/Buenos_Aires"), "2026-08-18");
  assert.equal(dayKeyInZone(instante, "UTC"), "2026-08-19");
});

test("un mensaje de la tarde cae en el día en que se escribió", () => {
  // 22:00 del martes en Córdoba llega a la base como miércoles UTC: recortar
  // el ISO lo contaba un día después.
  const guardado = "2026-08-19T01:30:00.000+00:00";

  assert.equal(dayKeyInZone(guardado, DEFAULT_TIMEZONE), "2026-08-18");
  assert.notEqual(dayKeyInZone(guardado, DEFAULT_TIMEZONE), guardado.slice(0, 10));
});

test("el arranque del día es medianoche en esa zona", () => {
  const inicio = startOfDayInZone("2026-08-18", "America/Argentina/Buenos_Aires");

  // Argentina está en UTC-3 todo el año: medianoche allá son las 03:00 UTC.
  assert.equal(inicio.toISOString(), "2026-08-18T03:00:00.000Z");
  assert.equal(dayKeyInZone(inicio, "America/Argentina/Buenos_Aires"), "2026-08-18");
});

test("el arranque del día sigue el cambio de horario", () => {
  // Santiago cambia de hora en septiembre, así que el mismo día calendario
  // arranca con desfasajes distintos según el mes.
  const invierno = startOfDayInZone("2026-08-18", "America/Santiago");
  const verano = startOfDayInZone("2026-12-18", "America/Santiago");

  assert.equal(dayKeyInZone(invierno, "America/Santiago"), "2026-08-18");
  assert.equal(dayKeyInZone(verano, "America/Santiago"), "2026-12-18");
  assert.notEqual(invierno.getUTCHours(), verano.getUTCHours());
});

test("restar días es aritmética de calendario y no de horas", () => {
  assert.equal(shiftDayKey("2026-08-18", -6), "2026-08-12");
  // Cruzar el fin de mes y el fin de año no puede quedar en manos de restar
  // 24 horas: hay días de 23 y de 25.
  assert.equal(shiftDayKey("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftDayKey("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDayKey("2026-08-18", 0), "2026-08-18");
});

test("la semana de siete días termina hoy y arranca seis atrás", () => {
  const hoy = "2026-08-18";
  const claves = Array.from({ length: 7 }, (_, i) => shiftDayKey(hoy, i - 6));

  assert.equal(claves.length, 7);
  assert.equal(claves[0], "2026-08-12");
  assert.equal(claves[6], hoy);
  assert.equal(new Set(claves).size, 7);
});

test("el día de la semana sale de la clave", () => {
  // 18 de agosto de 2026 fue martes: 2 con domingo en 0.
  assert.equal(weekdayOfDayKey("2026-08-18"), 2);
  assert.equal(weekdayOfDayKey("2026-08-19"), 3);
});

test("el mes arranca el primero", () => {
  assert.equal(monthStartKey("2026-08-18"), "2026-08-01");
  assert.equal(
    startOfDayInZone(monthStartKey("2026-08-18"), "America/Argentina/Buenos_Aires").toISOString(),
    "2026-08-01T03:00:00.000Z",
  );
});

test("una zona inválida no tira abajo el resumen", () => {
  // `Intl` lanza ante un nombre desconocido: si eso llegara al render, el
  // tablero entero dejaría de dibujarse por un campo mal cargado.
  assert.equal(safeTimeZone("Marte/Olympus"), DEFAULT_TIMEZONE);
  assert.equal(safeTimeZone(""), DEFAULT_TIMEZONE);
  assert.equal(safeTimeZone(null), DEFAULT_TIMEZONE);
  assert.equal(safeTimeZone("America/Montevideo"), "America/Montevideo");
});
