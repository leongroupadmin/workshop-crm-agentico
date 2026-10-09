/**
 * Pruebas del filtro de fechas de la agenda.
 *
 * Lo que se afirma es el borde: que el rango incluya sus dos extremos, que una
 * fecha sola sea ese día y no "de ahí en adelante", y que un rango escrito al
 * revés se dé vuelta en vez de contestar una agenda vacía. Un filtro que recorta
 * de más esconde una visita, que es la falla cara de esta pantalla.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  ATAJOS_AGENDA,
  FILTRO_AGENDA_VACIO,
  atajoActivo,
  citaEnRango,
  esDia,
  hayFiltro,
  normalizarFiltro,
  rangoDeAtajo,
  textoDelDia,
  textoDelRango,
} from "../src/lib/agenda-filtros.ts";

const HOY = "2026-08-31";

/* ------------------------------------------------------------------- claves */

test("una clave de día se reconoce sólo si es una fecha de verdad", () => {
  assert.equal(esDia("2026-08-31"), true);
  assert.equal(esDia("2026-02-31"), false);
  assert.equal(esDia("2026-8-3"), false);
  assert.equal(esDia(""), false);
  assert.equal(esDia(null), false);
});

/* ---------------------------------------------------------------- normaliza */

test("sin fechas no hay filtro", () => {
  assert.deepEqual(normalizarFiltro(FILTRO_AGENDA_VACIO), FILTRO_AGENDA_VACIO);
  assert.equal(hayFiltro(FILTRO_AGENDA_VACIO), false);
});

test("una fecha sola es ese día, no de ahí en adelante", () => {
  assert.deepEqual(normalizarFiltro({ desde: "2026-09-03", hasta: null }), {
    desde: "2026-09-03",
    hasta: "2026-09-03",
  });
  assert.deepEqual(normalizarFiltro({ desde: null, hasta: "2026-09-03" }), {
    desde: "2026-09-03",
    hasta: "2026-09-03",
  });
});

test("un rango al revés se da vuelta", () => {
  assert.deepEqual(normalizarFiltro({ desde: "2026-09-10", hasta: "2026-09-03" }), {
    desde: "2026-09-03",
    hasta: "2026-09-10",
  });
});

test("una fecha a medio escribir no filtra nada", () => {
  assert.equal(hayFiltro({ desde: "2026-09", hasta: null }), false);
  assert.deepEqual(normalizarFiltro({ desde: "2026-09", hasta: "2026-09-03" }), {
    desde: "2026-09-03",
    hasta: "2026-09-03",
  });
});

/* -------------------------------------------------------------------- rango */

test("sin filtro entra cualquier cita", () => {
  assert.equal(citaEnRango("2020-01-01", FILTRO_AGENDA_VACIO), true);
});

test("el rango incluye sus dos extremos", () => {
  const filtro = { desde: "2026-09-03", hasta: "2026-09-05" };

  assert.equal(citaEnRango("2026-09-02", filtro), false);
  assert.equal(citaEnRango("2026-09-03", filtro), true);
  assert.equal(citaEnRango("2026-09-04", filtro), true);
  assert.equal(citaEnRango("2026-09-05", filtro), true);
  assert.equal(citaEnRango("2026-09-06", filtro), false);
});

test("un día solo deja pasar únicamente ese día", () => {
  const filtro = { desde: "2026-09-03", hasta: null };

  assert.equal(citaEnRango("2026-09-03", filtro), true);
  assert.equal(citaEnRango("2026-09-04", filtro), false);
});

test("una cita sin día legible queda afuera de cualquier rango", () => {
  assert.equal(citaEnRango("", { desde: "2026-09-03", hasta: "2026-09-05" }), false);
});

/* ------------------------------------------------------------------- atajos */

test("los atajos arman el rango que prometen", () => {
  assert.deepEqual(rangoDeAtajo("hoy", HOY), { desde: HOY, hasta: HOY });
  assert.deepEqual(rangoDeAtajo("manana", HOY), { desde: "2026-09-01", hasta: "2026-09-01" });
  assert.deepEqual(rangoDeAtajo("semana", HOY), { desde: HOY, hasta: "2026-09-06" });
});

test("los atajos cruzan el fin de mes sin desarmarse", () => {
  assert.deepEqual(rangoDeAtajo("manana", "2026-12-31"), {
    desde: "2027-01-01",
    hasta: "2027-01-01",
  });
});

test("un rango escrito a mano se reconoce como el atajo que equivale", () => {
  for (const { id } of ATAJOS_AGENDA) {
    assert.equal(atajoActivo(rangoDeAtajo(id, HOY), HOY), id);
  }
  assert.equal(atajoActivo({ desde: "2026-09-03", hasta: "2026-09-05" }, HOY), null);
  assert.equal(atajoActivo(FILTRO_AGENDA_VACIO, HOY), null);
});

/* ------------------------------------------------------------------- textos */

test("el día se lee en castellano", () => {
  assert.equal(textoDelDia("2026-09-03"), "jueves, 3 de septiembre");
  assert.equal(textoDelDia(""), "");
});

test("el rango se cuenta relativo a hoy cuando corresponde", () => {
  assert.equal(textoDelRango({ desde: HOY, hasta: HOY }, HOY), "hoy, lunes, 31 de agosto");
  assert.equal(
    textoDelRango({ desde: "2026-09-01", hasta: null }, HOY),
    "mañana, martes, 1 de septiembre",
  );
  assert.equal(
    textoDelRango({ desde: "2026-08-30", hasta: null }, HOY),
    "ayer, domingo, 30 de agosto",
  );
  assert.equal(textoDelRango({ desde: "2026-09-03", hasta: null }, HOY), "el jueves, 3 de septiembre");
  assert.equal(
    textoDelRango({ desde: "2026-09-03", hasta: "2026-09-05" }, HOY),
    "del jueves, 3 de septiembre al sábado, 5 de septiembre",
  );
  assert.equal(textoDelRango(FILTRO_AGENDA_VACIO, HOY), "");
});
