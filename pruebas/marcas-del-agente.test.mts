import assert from "node:assert/strict";
import test from "node:test";

import {
  esNotaDeFalla,
  esNotaInterna,
  MARCA_DERIVAR,
  MARCA_RESUMEN,
  notaDeFalla,
  notaParaElEquipo,
  separarMarcas,
} from "../src/lib/marcas-del-agente.ts";

test("una respuesta sin marcas sale tal cual", () => {
  const { texto, derivar, resumen } = separarMarcas("¡Hola! ¿En qué te podemos ayudar?");
  assert.equal(texto, "¡Hola! ¿En qué te podemos ayudar?");
  assert.equal(derivar, false);
  assert.equal(resumen, null);
});

test("la marca de derivación no viaja en el mensaje", () => {
  const { texto, derivar } = separarMarcas(`En un rato te atiende alguien del equipo.\n${MARCA_DERIVAR}`);
  assert.equal(derivar, true);
  assert.equal(texto, "En un rato te atiende alguien del equipo.");
});

test("el resumen se guarda aparte y no le llega a la persona", () => {
  const { texto, resumen } = separarMarcas(
    `¡Listo! Nos vemos el jueves.\n${MARCA_RESUMEN}\nRubro: inmobiliaria\nVendedores: 4`,
  );
  assert.equal(texto, "¡Listo! Nos vemos el jueves.");
  assert.equal(resumen, "Rubro: inmobiliaria\nVendedores: 4");
});

test("todo lo que sigue a la primera marca es nota, aunque el modelo la repita", () => {
  // Es el caso que no se puede permitir: partir por la última dejaría el resto
  // del resumen dentro del mensaje que sale al cliente.
  const { texto, resumen } = separarMarcas(
    `Gracias.\n${MARCA_RESUMEN}\nVendedores: 2\n${MARCA_RESUMEN}\nUrgencia: alta`,
  );
  assert.equal(texto, "Gracias.");
  assert.equal(resumen, "Vendedores: 2\n\nUrgencia: alta");
});

test("derivar y resumir en la misma respuesta", () => {
  const { texto, derivar, resumen } = separarMarcas(
    `Te derivo con un asesor humano\n${MARCA_DERIVAR}\n${MARCA_RESUMEN}\nPidió hablar con una persona.`,
  );
  assert.equal(texto, "Te derivo con un asesor humano");
  assert.equal(derivar, true);
  assert.equal(resumen, "Pidió hablar con una persona.");
});

test("la marca de derivación puesta abajo del resumen igual deriva", () => {
  // El modelo la manda donde quiere. Buscarla sólo en el mensaje dejaba al lead
  // esperando a una persona que nunca se iba a enterar.
  const { texto, derivar, resumen } = separarMarcas(
    `Ahora te atiende alguien.\n${MARCA_RESUMEN}\nQuiere hablar con ventas.\n${MARCA_DERIVAR}`,
  );
  assert.equal(derivar, true);
  assert.equal(texto, "Ahora te atiende alguien.");
  assert.equal(resumen, "Quiere hablar con ventas.");
});

test("una marca de resumen sin nada abajo no deja una nota vacía", () => {
  const { texto, resumen } = separarMarcas(`Perfecto, te espero.\n${MARCA_RESUMEN}\n   `);
  assert.equal(texto, "Perfecto, te espero.");
  assert.equal(resumen, null);
});

test("un resumen sin mensaje no manda nada pero sí anota", () => {
  const { texto, resumen } = separarMarcas(`${MARCA_RESUMEN}\nVendedores: 3`);
  assert.equal(texto, "");
  assert.equal(resumen, "Vendedores: 3");
});

test("la nota se distingue del resto del hilo", () => {
  assert.match(notaParaElEquipo("Vendedores: 3"), /^⚙️ /);
});

test("la nota de falla dice el motivo y se reconoce después", () => {
  const nota = notaDeFalla("El modelo no devolvió texto (finish_reason: length).");
  assert.ok(nota.includes("finish_reason: length"));
  assert.equal(esNotaDeFalla(nota), true);
});

test("una nota de falla no se confunde con el resumen ni con un mensaje", () => {
  // Las dos empiezan con ⚙️: si se confundieran, el historial del modelo
  // perdería los resúmenes, que sí tiene que leer.
  assert.equal(esNotaDeFalla(notaParaElEquipo("Rubro: tatuajes")), false);
  assert.equal(esNotaDeFalla("¡Hola! ¿En qué te podemos ayudar?"), false);
});

test("las notas internas se distinguen de lo que el contacto recibió", () => {
  // Lo usa el aviso de fuera de horario para saber qué fue lo último que el lead
  // *recibió*: una nota de falla entre medio no tiene por qué habilitar un aviso
  // repetido, porque el lead nunca la vio.
  assert.equal(esNotaInterna(notaParaElEquipo("Rubro: tatuajes")), true);
  assert.equal(esNotaInterna(notaDeFalla("timeout")), true);
  assert.equal(esNotaInterna("Te leemos de lunes a viernes de 9 a 18."), false);
});
