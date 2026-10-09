/**
 * Pruebas de la marca del lead en la landing.
 *
 * Del otro lado de esta función hay un modelo escribiendo texto libre, que es
 * lo menos predecible del sistema: a veces manda el JSON pegado, a veces con
 * saltos de línea, a veces con una coma de más. Y lo que está en juego no es
 * que se pierda un lead —eso se recupera— sino que el visitante llegue a ver la
 * marca con su propio teléfono adentro.
 */
import assert from "node:assert";
import { test } from "node:test";

import { separarMarcaDeLead } from "../src/lib/landing-marca.ts";

/* ------------------------------------------------------ cuando no hay marca */

test("un mensaje común viaja entero y no anuncia ningún lead", () => {
  const { limpio, datos } = separarMarcaDeLead("Hola, ¿a qué te dedicás?");
  assert.equal(limpio, "Hola, ¿a qué te dedicás?");
  assert.equal(datos, null);
});

test("los espacios de los bordes se van", () => {
  assert.equal(separarMarcaDeLead("  Hola  \n").limpio, "Hola");
});

/* --------------------------------------------------------- cuando sí la hay */

test("la marca no llega al visitante", () => {
  const crudo =
    'Genial, te escribo por WhatsApp.\n[LEAD]{"nombre":"Ana","rubro":"inmobiliaria","telefono":"3518592937","resumen":"60 mensajes por día"}';
  const { limpio } = separarMarcaDeLead(crudo);

  assert.equal(limpio, "Genial, te escribo por WhatsApp.");
  assert.ok(!limpio.includes("LEAD"));
  assert.ok(!limpio.includes("3518592937"), "el teléfono nunca vuelve al chat");
});

test("los datos salen parseados", () => {
  const { datos } = separarMarcaDeLead(
    'Listo.\n[LEAD]{"nombre":"Ana","rubro":"inmobiliaria","telefono":"3518592937","resumen":"60 por día"}',
  );

  assert.deepEqual(datos, {
    nombre: "Ana",
    rubro: "inmobiliaria",
    telefono: "3518592937",
    resumen: "60 por día",
  });
});

test("los campos vacíos no se guardan como texto vacío", () => {
  const { datos } = separarMarcaDeLead('Ok.\n[LEAD]{"nombre":"","rubro":"taller","telefono":"  "}');

  assert.equal(datos?.rubro, "taller");
  assert.equal(datos?.nombre, undefined);
  assert.equal(datos?.telefono, undefined, "un teléfono en blanco no es un teléfono");
});

test("el JSON pegado a la marca, sin salto de línea, se lee igual", () => {
  const { limpio, datos } = separarMarcaDeLead('Perfecto. [LEAD]{"rubro":"gimnasio"}');
  assert.equal(limpio, "Perfecto.");
  assert.equal(datos?.rubro, "gimnasio");
});

/* ------------------------------------------------- cuando el modelo se manda */

test("un JSON roto no vuelve al chat y el aviso se conserva", () => {
  const { limpio, datos } = separarMarcaDeLead('Listo.\n[LEAD]{"rubro":"taller",,}');

  assert.equal(limpio, "Listo.");
  assert.deepEqual(datos, {}, "reconoció el lead aunque haya tipeado mal");
});

test("la marca sin ningún JSON tampoco se filtra", () => {
  const { limpio, datos } = separarMarcaDeLead("Listo.\n[LEAD]");
  assert.equal(limpio, "Listo.");
  assert.deepEqual(datos, {});
});

test("un valor que no es texto se descarta en vez de romper", () => {
  const { datos } = separarMarcaDeLead('Ok.\n[LEAD]{"rubro":"bar","telefono":3518592937}');
  assert.equal(datos?.rubro, "bar");
  assert.equal(datos?.telefono, undefined);
});

test("si el modelo pone la marca arriba, el mensaje es lo que sigue", () => {
  const { limpio, datos } = separarMarcaDeLead('[LEAD]{"rubro":"bar"}\nHola, ¿cuántos mozos son?');

  assert.equal(limpio, "Hola, ¿cuántos mozos son?", "nunca una burbuja vacía en el hero");
  assert.equal(datos?.rubro, "bar");
});

test("con la marca arriba y sin JSON, el mensaje tampoco se pierde", () => {
  const { limpio, datos } = separarMarcaDeLead("[LEAD]\nHola");
  assert.equal(limpio, "Hola");
  assert.deepEqual(datos, {});
});
