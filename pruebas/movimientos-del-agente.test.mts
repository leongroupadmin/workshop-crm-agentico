import assert from "node:assert/strict";
import test from "node:test";

import {
  conversacionParaClasificar,
  errorDeLasReglas,
  errorDeRegla,
  instruccionesDeClasificacion,
  interpretarClasificacion,
  MAX_CRITERIO_CHARS,
  MAX_REGLAS,
  MENSAJES_PARA_CLASIFICAR,
  notaDeMovimiento,
  reglasAplicables,
  SIN_MOVIMIENTO,
  type ReglaConNombre,
  type ReglaDeMovimiento,
} from "../src/lib/movimientos-del-agente.ts";

const NUEVO = "stage-nuevo";
const CONTACTADO = "stage-contactado";
const CALIFICADO = "stage-calificado";

const regla = (parcial: Partial<ReglaDeMovimiento> = {}): ReglaDeMovimiento => ({
  id: "r1",
  stageId: CONTACTADO,
  desdeStageId: null,
  criterio: "cuando responde algo más que un saludo",
  activo: true,
  ...parcial,
});

/* ------------------------------------------------------------ qué reglas aplican */

test("una regla sin origen aplica desde cualquier columna", () => {
  const aplicables = reglasAplicables([regla()], NUEVO);
  assert.equal(aplicables.length, 1);
});

test("una regla con origen no aplica desde otra columna", () => {
  const reglas = [regla({ desdeStageId: NUEVO })];
  assert.equal(reglasAplicables(reglas, NUEVO).length, 1);
  assert.equal(reglasAplicables(reglas, CALIFICADO).length, 0);
});

test("la regla que lleva a la columna donde ya está no aplica", () => {
  // Es el caso que hace que un criterio ya cumplido no devuelva la tarjeta a una
  // columna por la que ya pasó: "dijo su rubro" sigue siendo verdad para siempre.
  const aplicables = reglasAplicables([regla({ stageId: CONTACTADO })], CONTACTADO);
  assert.equal(aplicables.length, 0);
});

test("la regla apagada no aplica", () => {
  assert.equal(reglasAplicables([regla({ activo: false })], NUEVO).length, 0);
});

test("sin tarjeta en el embudo no aplica ninguna regla con origen", () => {
  // El que todavía no entró al embudo no tiene oportunidad: su etapa es null.
  const reglas = [regla({ desdeStageId: NUEVO }), regla({ id: "r2", stageId: CALIFICADO })];
  const aplicables = reglasAplicables(reglas, null);
  assert.deepEqual(
    aplicables.map((item) => item.id),
    ["r2"],
  );
});

/* ------------------------------------------------------------ validación */

test("un criterio vacío no se guarda: se cumpliría siempre", () => {
  const error = errorDeRegla({ stageId: CONTACTADO, desdeStageId: null, criterio: "   " });
  assert.match(error ?? "", /cuándo tiene que mover/i);
});

test("un criterio demasiado largo se rechaza con el tope a la vista", () => {
  const error = errorDeRegla({
    stageId: CONTACTADO,
    desdeStageId: null,
    criterio: "x".repeat(MAX_CRITERIO_CHARS + 1),
  });
  assert.match(error ?? "", new RegExp(String(MAX_CRITERIO_CHARS)));
});

test("mover a la misma columna de la que sale no es un movimiento", () => {
  const error = errorDeRegla({
    stageId: CONTACTADO,
    desdeStageId: CONTACTADO,
    criterio: "cuando responde",
  });
  assert.match(error ?? "", /no pueden ser la misma/i);
});

test("una regla bien cargada no da error", () => {
  assert.equal(errorDeRegla({ stageId: CONTACTADO, desdeStageId: NUEVO, criterio: "cuando responde" }), null);
});

test("dos reglas para el mismo movimiento se rechazan", () => {
  const error = errorDeLasReglas([
    regla({ id: "r1", stageId: CALIFICADO, desdeStageId: NUEVO }),
    regla({ id: "r2", stageId: CALIFICADO, desdeStageId: NUEVO, criterio: "otro criterio" }),
  ]);
  assert.match(error ?? "", /dos reglas para el mismo movimiento/i);
});

test("dos reglas sin origen hacia la misma columna también chocan", () => {
  // En Postgres dos nulls son distintos, así que sin `nulls not distinct` esto
  // pasaría el unique y el modelo recibiría dos criterios para una decisión.
  const error = errorDeLasReglas([
    regla({ id: "r1", stageId: CALIFICADO }),
    regla({ id: "r2", stageId: CALIFICADO, criterio: "otro criterio" }),
  ]);
  assert.match(error ?? "", /dos reglas para el mismo movimiento/i);
});

test("el mismo destino desde dos columnas distintas es válido", () => {
  assert.equal(
    errorDeLasReglas([
      regla({ id: "r1", stageId: CALIFICADO, desdeStageId: NUEVO }),
      regla({ id: "r2", stageId: CALIFICADO, desdeStageId: CONTACTADO }),
    ]),
    null,
  );
});

test("hay un tope de reglas porque todas viajan al modelo", () => {
  const muchas = Array.from({ length: MAX_REGLAS + 1 }, (_, i) =>
    regla({ id: `r${i}`, stageId: `stage-${i}` }),
  );
  assert.match(errorDeLasReglas(muchas) ?? "", new RegExp(String(MAX_REGLAS)));
});

/* ------------------------------------------------------------ el pedido */

test("las instrucciones llevan el nombre y el criterio de cada columna", () => {
  const texto = instruccionesDeClasificacion([
    { stageId: CALIFICADO, nombre: "Calificado", criterio: "cuando dijo su rubro" },
  ]);
  assert.match(texto, /"Calificado": cuando dijo su rubro/);
  assert.match(texto, new RegExp(SIN_MOVIMIENTO));
});

test("la conversación se recorta a los últimos mensajes", () => {
  const mensajes = Array.from({ length: MENSAJES_PARA_CLASIFICAR + 5 }, (_, i) => ({
    deLaPersona: i % 2 === 0,
    texto: `mensaje ${i}`,
  }));
  const texto = conversacionParaClasificar(mensajes);
  assert.equal(texto.split("\n").length, MENSAJES_PARA_CLASIFICAR);
  assert.match(texto, /mensaje 14$/);
  assert.doesNotMatch(texto, /mensaje 0\b/);
});

test("la conversación distingue quién habló", () => {
  const texto = conversacionParaClasificar([
    { deLaPersona: true, texto: "hola" },
    { deLaPersona: false, texto: "¡Hola! ¿En qué te ayudo?" },
  ]);
  assert.equal(texto, "Persona: hola\nVendedor: ¡Hola! ¿En qué te ayudo?");
});

/* ------------------------------------------------------------ la respuesta */

const APLICABLES: ReglaConNombre[] = [
  { stageId: CALIFICADO, nombre: "Calificado", criterio: "cuando dijo su rubro" },
];

test("una etapa de la lista se interpreta con su motivo", () => {
  const salida = interpretarClasificacion(
    '{"etapa": "Calificado", "motivo": "dijo que venden seguros y son 4"}',
    APLICABLES,
  );
  assert.deepEqual(salida, {
    stageId: CALIFICADO,
    nombre: "Calificado",
    motivo: "dijo que venden seguros y son 4",
  });
});

test("el nombre sin acentos ni mayúsculas es el mismo nombre", () => {
  const salida = interpretarClasificacion('{"etapa": "visita coordinada", "motivo": "x"}', [
    { stageId: "s", nombre: "Visita Coordinada", criterio: "c" },
  ]);
  assert.equal(salida?.stageId, "s");
});

test('"ninguna" no mueve nada', () => {
  assert.equal(
    interpretarClasificacion(`{"etapa": "${SIN_MOVIMIENTO}", "motivo": ""}`, APLICABLES),
    null,
  );
});

test("una columna que no está en la lista no mueve nada", () => {
  // Nunca la más parecida: el movimiento que no se hace se nota y se corrige, el
  // que se hace a la columna equivocada se descubre cuando ya es tarde.
  assert.equal(interpretarClasificacion('{"etapa": "Ganado", "motivo": "cerró"}', APLICABLES), null);
});

test("el JSON envuelto en un bloque de código se lee igual", () => {
  const salida = interpretarClasificacion(
    '```json\n{"etapa": "Calificado", "motivo": "ok"}\n```',
    APLICABLES,
  );
  assert.equal(salida?.stageId, CALIFICADO);
});

test("una respuesta que no es JSON no mueve nada", () => {
  assert.equal(interpretarClasificacion("Yo lo movería a Calificado", APLICABLES), null);
  assert.equal(interpretarClasificacion("", APLICABLES), null);
  assert.equal(interpretarClasificacion("{roto", APLICABLES), null);
});

test("sin motivo se mueve igual, con la nota más corta", () => {
  const salida = interpretarClasificacion('{"etapa": "Calificado"}', APLICABLES);
  assert.equal(salida?.motivo, "");
  assert.equal(notaDeMovimiento("Calificado", ""), "⚙️ El agente movió la tarjeta a Calificado");
});

test("la nota del movimiento es una nota interna", () => {
  const nota = notaDeMovimiento("Calificado", "dijo que son 4 vendedores");
  assert.ok(nota.startsWith("⚙️"));
  assert.match(nota, /dijo que son 4 vendedores/);
});
