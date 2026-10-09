/**
 * Pruebas de los filtros del embudo.
 *
 * Un filtro que deja pasar de más no rompe nada en pantalla: muestra un embudo
 * que no es el que se pidió, y eso se descubre tarde y mal. Lo que se afirma acá
 * es cada condición por separado y que juntas se pidan todas a la vez, que es
 * donde se cuela el error de escribir un `or` donde iba un `and`.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  FILTRO_PIPELINE_VACIO,
  filtraAlgo,
  filtrosPuestos,
  pasaElFiltro,
  SIN_ASIGNAR,
  type TarjetaFiltrable,
} from "../src/lib/pipeline-filtros.ts";

function tarjeta(parcial: Partial<TarjetaFiltrable> = {}): TarjetaFiltrable {
  return {
    contactName: "Ana Pérez",
    contactPhone: "+5491122334455",
    channels: ["whatsapp"],
    assignedTo: "vendedora-1",
    dia: "2026-03-10",
    ...parcial,
  };
}

/* -------------------------------------------------------------------- texto */

test("sin filtros pasa cualquier tarjeta", () => {
  assert.equal(pasaElFiltro(tarjeta(), FILTRO_PIPELINE_VACIO), true);
});

test("el texto busca en el nombre y en el teléfono", () => {
  assert.equal(pasaElFiltro(tarjeta(), { ...FILTRO_PIPELINE_VACIO, texto: "ana" }), true);
  assert.equal(pasaElFiltro(tarjeta(), { ...FILTRO_PIPELINE_VACIO, texto: "2233" }), true);
  assert.equal(pasaElFiltro(tarjeta(), { ...FILTRO_PIPELINE_VACIO, texto: "carlos" }), false);
});

test("un contacto sin teléfono no rompe la búsqueda", () => {
  const sinTelefono = tarjeta({ contactPhone: null });

  assert.equal(pasaElFiltro(sinTelefono, { ...FILTRO_PIPELINE_VACIO, texto: "ana" }), true);
  assert.equal(pasaElFiltro(sinTelefono, { ...FILTRO_PIPELINE_VACIO, texto: "2233" }), false);
});

/* -------------------------------------------------------------- responsable */

test("filtrar por responsable deja sólo sus leads", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, responsables: ["vendedora-1"] };

  assert.equal(pasaElFiltro(tarjeta(), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ assignedTo: "vendedor-2" }), filtro), false);
  assert.equal(pasaElFiltro(tarjeta({ assignedTo: null }), filtro), false);
});

test("sin asignar es una opción más de la misma lista", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, responsables: [SIN_ASIGNAR] };

  assert.equal(pasaElFiltro(tarjeta({ assignedTo: null }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta(), filtro), false);
});

test("varios responsables suman", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, responsables: ["vendedora-1", SIN_ASIGNAR] };

  assert.equal(pasaElFiltro(tarjeta(), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ assignedTo: null }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ assignedTo: "vendedor-2" }), filtro), false);
});

/* --------------------------------------------------------------------- canal */

test("alcanza con haber escrito por uno de los canales elegidos", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, canales: ["instagram" as const] };

  assert.equal(pasaElFiltro(tarjeta({ channels: ["instagram"] }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ channels: ["whatsapp", "instagram"] }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ channels: ["whatsapp"] }), filtro), false);
});

test("un lead cargado a mano queda afuera al filtrar por canal", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, canales: ["whatsapp" as const] };

  assert.equal(pasaElFiltro(tarjeta({ channels: [] }), filtro), false);
});

/* ------------------------------------------------------------------- fechas */

test("el rango de alta incluye los dos extremos", () => {
  const filtro = { ...FILTRO_PIPELINE_VACIO, desde: "2026-03-01", hasta: "2026-03-31" };

  assert.equal(pasaElFiltro(tarjeta({ dia: "2026-03-01" }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ dia: "2026-03-31" }), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ dia: "2026-02-28" }), filtro), false);
  assert.equal(pasaElFiltro(tarjeta({ dia: "2026-04-01" }), filtro), false);
});

test("sin fecha legible sólo desaparece si hay rango", () => {
  const sinFecha = tarjeta({ dia: "" });

  assert.equal(pasaElFiltro(sinFecha, FILTRO_PIPELINE_VACIO), true);
  assert.equal(pasaElFiltro(sinFecha, { ...FILTRO_PIPELINE_VACIO, desde: "2026-01-01" }), false);
});

/* ------------------------------------------------------------------- juntos */

test("los filtros se piden todos a la vez, no uno cualquiera", () => {
  const filtro = {
    texto: "ana",
    responsables: ["vendedora-1"],
    canales: ["whatsapp" as const],
    desde: "2026-03-01",
    hasta: "2026-03-31",
  };

  assert.equal(pasaElFiltro(tarjeta(), filtro), true);
  assert.equal(pasaElFiltro(tarjeta({ contactName: "Carlos" }), filtro), false);
  assert.equal(pasaElFiltro(tarjeta({ assignedTo: "vendedor-2" }), filtro), false);
  assert.equal(pasaElFiltro(tarjeta({ channels: ["instagram"] }), filtro), false);
  assert.equal(pasaElFiltro(tarjeta({ dia: "2026-05-05" }), filtro), false);
});

/* ------------------------------------------------------------------- cuenta */

test("el botón cuenta filtros, no valores", () => {
  assert.equal(filtrosPuestos(FILTRO_PIPELINE_VACIO), 0);
  assert.equal(
    filtrosPuestos({ ...FILTRO_PIPELINE_VACIO, responsables: ["a", "b", "c"] }),
    1,
    "tres responsables siguen siendo un filtro",
  );
  assert.equal(filtrosPuestos({ ...FILTRO_PIPELINE_VACIO, desde: "2026-01-01" }), 1);
  assert.equal(
    filtrosPuestos({ ...FILTRO_PIPELINE_VACIO, desde: "2026-01-01", hasta: "2026-02-01" }),
    1,
    "las dos puntas son el mismo filtro de fechas",
  );
  assert.equal(
    filtrosPuestos({
      ...FILTRO_PIPELINE_VACIO,
      responsables: ["a"],
      canales: ["whatsapp"],
      hasta: "2026-02-01",
    }),
    3,
  );
});

test("el texto no cuenta en el botón pero sí filtra", () => {
  const soloTexto = { ...FILTRO_PIPELINE_VACIO, texto: "ana" };

  assert.equal(filtrosPuestos(soloTexto), 0, "tiene su propio campo a la vista");
  assert.equal(filtraAlgo(soloTexto), true);
  assert.equal(filtraAlgo(FILTRO_PIPELINE_VACIO), false);
  assert.equal(filtraAlgo({ ...FILTRO_PIPELINE_VACIO, texto: "   " }), false);
});
