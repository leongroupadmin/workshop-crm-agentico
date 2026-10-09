/**
 * Pruebas de la lectura del CSV de contactos.
 *
 * El archivo lo arma otra persona: sale de un Excel, de otro CRM o de una
 * planilla compartida. Lo que se cuida acá es que un archivo raro no se cargue
 * a medias en silencio —una columna corrida mete el teléfono en el nombre de
 * media base— y que lo que no se puede usar quede contado en vez de
 * desaparecer.
 */
import assert from "node:assert";
import { test } from "node:test";

import { leerContactos, leerCsv } from "../src/lib/importar.ts";

/* --------------------------------------------------------------- el formato */

test("lee un CSV separado por punto y coma", () => {
  const filas = leerCsv("Nombre;Teléfono\r\nAna;+5491122334455\r\n");

  assert.deepEqual(filas, [
    ["Nombre", "Teléfono"],
    ["Ana", "+5491122334455"],
  ]);
});

test("lee un CSV separado por comas", () => {
  const filas = leerCsv("Nombre,Teléfono\nAna,+5491122334455\n");

  assert.deepEqual(filas, [
    ["Nombre", "Teléfono"],
    ["Ana", "+5491122334455"],
  ]);
});

test("una coma adentro de comillas no parte la columna", () => {
  const filas = leerCsv('Nombre,Nota\n"Pérez, Juan",Cliente viejo\n');

  assert.deepEqual(filas[1], ["Pérez, Juan", "Cliente viejo"]);
});

test("un salto de línea adentro de comillas no parte la fila", () => {
  const filas = leerCsv('Nombre;Nota\nAna;"Llamó el lunes\ny el martes"\n');

  assert.equal(filas.length, 2);
  assert.equal(filas[1][1], "Llamó el lunes\ny el martes");
});

test("las comillas duplicadas son una comilla escrita", () => {
  const filas = leerCsv('Nombre;Nota\nAna;"Dijo ""sí"""\n');

  assert.equal(filas[1][1], 'Dijo "sí"');
});

test("el BOM del archivo no se cuela en el primer título", () => {
  const filas = leerCsv("﻿Nombre;Teléfono\nAna;123456789\n");

  assert.equal(filas[0][0], "Nombre");
});

test("los renglones en blanco del final no son filas", () => {
  const filas = leerCsv("Nombre;Teléfono\nAna;123456789\n\n;\n");

  assert.equal(filas.length, 2);
});

/* -------------------------------------------------------------- las columnas */

test("encuentra las columnas sin importar el orden ni los acentos", () => {
  const lectura = leerContactos("EMAIL;telefono;Nombre\nana@ejemplo.com;+5491122334455;Ana\n");

  assert.equal(lectura.error, null);
  assert.deepEqual(lectura.filas[0], {
    nombre: "Ana",
    telefono: "+5491122334455",
    email: "ana@ejemplo.com",
    etiquetas: [],
  });
});

test("acepta los títulos que usan otras herramientas", () => {
  const lectura = leerContactos("Full Name,Mobile,Tags\nAna,5491122334455,vip\n");

  assert.equal(lectura.error, null);
  assert.equal(lectura.filas[0].nombre, "Ana");
  assert.equal(lectura.filas[0].telefono, "+5491122334455");
  assert.deepEqual(lectura.filas[0].etiquetas, ["vip"]);
});

test("un archivo sin columna de nombre ni de teléfono se rechaza entero", () => {
  const lectura = leerContactos("Ciudad;Rubro\nRosario;Textil\n");

  assert.notEqual(lectura.error, null);
  assert.equal(lectura.filas.length, 0);
});

test("un archivo vacío no explota", () => {
  assert.notEqual(leerContactos("").error, null);
  assert.notEqual(leerContactos("   \n").error, null);
});

/* ----------------------------------------------------------------- las filas */

test("el teléfono pierde la puntuación con la que se cargó", () => {
  const lectura = leerContactos("Nombre;Teléfono\nAna;+54 9 11 2233-4455\n");

  assert.equal(lectura.filas[0].telefono, "+5491122334455");
});

test("los ceros y los quince de la forma local no se inventan ni se sacan", () => {
  // Deliberado: sacarle el 0 y el 15 a un número argentino es una regla de un
  // país, y aplicarla a ciegas rompería cualquier base con números de afuera.
  // El número queda como lo cargaron y, si no sirve, se ve en la ficha.
  const lectura = leerContactos("Nombre;Teléfono\nAna;(011) 15 2233-4455\n");

  assert.equal(lectura.filas[0].telefono, "+0111522334455");
});

test("un teléfono que no puede ser un número queda vacío, sin perder el contacto", () => {
  const lectura = leerContactos("Nombre;Teléfono\nAna;no tiene\n");

  assert.equal(lectura.filas.length, 1);
  assert.equal(lectura.filas[0].telefono, null);
});

test("sin nombre pero con teléfono, el teléfono hace de nombre", () => {
  const lectura = leerContactos("Nombre;Teléfono\n;+5491122334455\n");

  assert.equal(lectura.filas[0].nombre, "+5491122334455");
});

test("una fila sin nombre ni teléfono se cuenta y no se carga", () => {
  const lectura = leerContactos("Nombre;Teléfono;Email\nAna;+5491122334455;\n;;solo@mail.com\n");

  assert.equal(lectura.filas.length, 1);
  assert.equal(lectura.vacias, 1);
});

test("el mismo contacto dos veces en el archivo entra una sola vez", () => {
  const lectura = leerContactos(
    "Nombre;Teléfono\nAna;+5491122334455\nAna Pérez;+54 9 11 2233 4455\nJuan;+5491199887766\n",
  );

  assert.equal(lectura.filas.length, 2);
  assert.equal(lectura.repetidas, 1);
  assert.equal(lectura.filas[0].nombre, "Ana", "se queda el primero");
});

test("las etiquetas se parten por coma, punto y coma o barra", () => {
  const lectura = leerContactos('Nombre;Etiquetas\nAna;"vip, referido|frío"\n');

  assert.deepEqual(lectura.filas[0].etiquetas, ["vip", "referido", "frío"]);
});

test("el email se guarda en minúsculas para poder cruzarlo", () => {
  const lectura = leerContactos("Nombre;Email\nAna;ANA@Ejemplo.COM\n");

  assert.equal(lectura.filas[0].email, "ana@ejemplo.com");
});

test("dice qué columna usó para cada dato", () => {
  const lectura = leerContactos("Nombre y apellido;Celular\nAna;+5491122334455\n");

  assert.equal(lectura.columnas.nombre, "Nombre y apellido");
  assert.equal(lectura.columnas.telefono, "Celular");
  assert.equal(lectura.columnas.email, null);
});
