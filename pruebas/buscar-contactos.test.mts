/**
 * Pruebas del buscador de leads.
 *
 * Lo que se cuida es que cualquier cosa que alguien escriba arme un filtro
 * válido para PostgREST —una coma suelta rompía la consulta entera— y que se
 * encuentre a la persona como se la recuerda: por un pedazo del nombre o por
 * el teléfono escrito con espacios.
 */
import assert from "node:assert";
import { test } from "node:test";

import { filtroDeBusqueda } from "../src/lib/buscar-contactos.ts";

test("sin texto no hay filtro", () => {
  assert.equal(filtroDeBusqueda(""), null);
  assert.equal(filtroDeBusqueda("   "), null);
  assert.equal(filtroDeBusqueda(",()"), null);
});

test("un nombre se busca en el nombre y en el mail, no en el teléfono", () => {
  assert.equal(filtroDeBusqueda("julian"), "name.ilike.%julian%,email.ilike.%julian%");
});

test("los espacios hacen de comodín entre palabras", () => {
  assert.equal(
    filtroDeBusqueda("juan   perez"),
    "name.ilike.%juan%perez%,email.ilike.%juan%perez%",
  );
});

test("un teléfono escrito con espacios y guiones se busca por sus dígitos", () => {
  assert.equal(
    filtroDeBusqueda("11 2345-678"),
    "name.ilike.%11%2345-678%,email.ilike.%11%2345-678%,phone.ilike.%112345678%",
  );
});

test("con menos de tres dígitos el teléfono no entra en la búsqueda", () => {
  assert.doesNotMatch(filtroDeBusqueda("ana 2") ?? "", /phone/);
});

test("lo que rompe la sintaxis del filtro se saca", () => {
  const filtro = filtroDeBusqueda('perez, (juan) "x" a:b \\') ?? "";
  // Exactamente dos comas: las que separan las condiciones.
  assert.equal(filtro.split(",").length, 2);
  assert.doesNotMatch(filtro, /[()"\\:]/);
});
