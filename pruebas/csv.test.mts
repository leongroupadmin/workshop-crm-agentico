/**
 * Pruebas del armado del CSV.
 *
 * Un CSV mal escapado no falla: abre igual, con las columnas corridas. El error
 * aparece cuando alguien ya trabajó media hora sobre la planilla equivocada, así
 * que las reglas del formato se afirman acá y no a ojo abriendo un archivo.
 */
import assert from "node:assert";
import { test } from "node:test";

import { aCsv, celda, nombreDeArchivo, type Columna } from "../src/lib/csv.ts";

const BOM = "﻿";

type Persona = { nombre: string; nota: string | null };

const COLUMNAS: Columna<Persona>[] = [
  { titulo: "Nombre", valor: (fila) => fila.nombre },
  { titulo: "Nota", valor: (fila) => fila.nota },
];

/* -------------------------------------------------------------------- celda */

test("un texto común viaja tal cual", () => {
  assert.equal(celda("Ana Pérez"), "Ana Pérez");
  assert.equal(celda(1500), "1500");
});

test("lo vacío es una celda vacía y no la palabra null", () => {
  assert.equal(celda(null), "");
  assert.equal(celda(undefined), "");
  assert.equal(celda(""), "");
});

test("el separador adentro de una celda no parte la columna", () => {
  assert.equal(celda("Pérez; Juan"), '"Pérez; Juan"');
});

test("las comillas se duplican, que es como las escribe el formato", () => {
  assert.equal(celda('Le dije "listo"'), '"Le dije ""listo"""');
});

test("un salto de línea no parte la fila", () => {
  assert.equal(celda("Hola\nQué tal"), '"Hola\nQué tal"');
  assert.equal(celda("Hola\r\nQué tal"), '"Hola\r\nQué tal"');
});

test("los espacios de las puntas se conservan entrecomillando", () => {
  assert.equal(celda("  con sangría"), '"  con sangría"');
});

test("una celda que parece fórmula se neutraliza", () => {
  // El nombre lo escribe el contacto: llega de WhatsApp tal cual lo puso él.
  for (const peligrosa of ["=1+1", "+34600000000", "-2", "@SUM(A1)"]) {
    assert.equal(
      celda(peligrosa).startsWith("'"),
      true,
      `${peligrosa} debería quedar como texto, no como fórmula`,
    );
  }
});

test("neutralizar no se lleva puesto un texto normal", () => {
  assert.equal(celda("Ana"), "Ana");
  assert.equal(celda("2 + 2"), "2 + 2");
});

/* --------------------------------------------------------------------- csv */

test("el archivo abre con el BOM y el encabezado", () => {
  const csv = aCsv(COLUMNAS, []);

  assert.equal(csv.startsWith(BOM), true, "sin BOM, Excel rompe los acentos");
  assert.equal(csv, `${BOM}Nombre;Nota\r\n`);
});

test("cada fila es una línea con las columnas en orden", () => {
  const csv = aCsv(COLUMNAS, [
    { nombre: "Ana", nota: "Interesada" },
    { nombre: "Juan", nota: null },
  ]);

  assert.equal(csv, `${BOM}Nombre;Nota\r\nAna;Interesada\r\nJuan;\r\n`);
});

test("una nota con separadores y comillas no corre las columnas", () => {
  const csv = aCsv(COLUMNAS, [{ nombre: "Ana", nota: 'Dijo "sí"; llamar el lunes' }]);
  const filas = csv.trimEnd().split("\r\n");

  assert.equal(filas.length, 2, "sigue siendo una sola fila de datos");
  assert.equal(filas[1], 'Ana;"Dijo ""sí""; llamar el lunes"');
});

/* ------------------------------------------------------------------ nombre */

test("el nombre del archivo arranca con la fecha, para que ordene", () => {
  assert.equal(nombreDeArchivo("contactos", "2026-08-21"), "2026-08-21-contactos.csv");
});
