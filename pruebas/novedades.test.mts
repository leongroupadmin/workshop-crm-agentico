/**
 * Pruebas del orden de la campana.
 *
 * Lo que importa es que lo último que pasó quede arriba sin importar de qué
 * tipo sea, y que un aviso sin fecha no le gane el lugar a uno reciente.
 */
import assert from "node:assert";
import { test } from "node:test";

import { masNuevasPrimero } from "../src/lib/novedades.ts";

type Aviso = { id: string; cuando: string | null };
const ordenar = (avisos: Aviso[]) =>
  masNuevasPrimero(avisos, (aviso) => aviso.cuando).map((aviso) => aviso.id);

test("lo más nuevo va arriba, mezclando tipos", () => {
  assert.deepEqual(
    ordenar([
      { id: "reserva-de-ayer", cuando: "2026-10-06T15:00:00Z" },
      { id: "tarea-de-recien", cuando: "2026-10-07T14:59:00Z" },
      { id: "derivacion-de-la-manana", cuando: "2026-10-07T12:00:00Z" },
    ]),
    ["tarea-de-recien", "derivacion-de-la-manana", "reserva-de-ayer"],
  );
});

test("la zona de la fecha no confunde el orden", () => {
  // 11:00 en Buenos Aires es 14:00 UTC: más nuevo que las 13:30 UTC.
  assert.deepEqual(
    ordenar([
      { id: "utc", cuando: "2026-10-07T13:30:00Z" },
      { id: "con-zona", cuando: "2026-10-07T11:00:00-03:00" },
    ]),
    ["con-zona", "utc"],
  );
});

test("un aviso sin fecha o con una fecha rota va al final", () => {
  assert.deepEqual(
    ordenar([
      { id: "sin-fecha", cuando: null },
      { id: "rota", cuando: "no es una fecha" },
      { id: "con-fecha", cuando: "2026-10-01T10:00:00Z" },
    ]),
    ["con-fecha", "sin-fecha", "rota"],
  );
});

test("no toca la lista que recibe", () => {
  const avisos: Aviso[] = [
    { id: "viejo", cuando: "2026-10-01T10:00:00Z" },
    { id: "nuevo", cuando: "2026-10-02T10:00:00Z" },
  ];
  ordenar(avisos);
  assert.deepEqual(
    avisos.map((aviso) => aviso.id),
    ["viejo", "nuevo"],
  );
});
