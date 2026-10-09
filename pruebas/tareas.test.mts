/**
 * Pruebas de las tareas del equipo.
 *
 * Lo caro de equivocarse acá es una tarea en el grupo equivocado: una llamada
 * vencida que figura como "Próxima" es una llamada que no se hace. Por eso lo
 * que más se afirma son los bordes de los grupos, en la zona del workspace y no
 * en la del servidor.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  agruparTareas,
  calcularAviso,
  errorDeTarea,
  filaATarea,
  grupoDeTarea,
  minutosDeAviso,
  tareasUrgentes,
  textoDeVencimiento,
  validarTarea,
} from "../src/lib/tareas.ts";

const ZONA = "America/Argentina/Buenos_Aires";
// Martes 13 de octubre de 2026, 11:00 en Buenos Aires (UTC-3).
const AHORA = new Date("2026-10-13T14:00:00Z");

const pendiente = (venceAt: string) => ({ estado: "pendiente" as const, venceAt, completadaAt: null });

/* ------------------------------------------------------------------ grupos */

test("una tarea de hoy que ya pasó su hora está vencida, no es de hoy", () => {
  // 10:00 en Buenos Aires: una hora antes de AHORA.
  assert.equal(grupoDeTarea(pendiente("2026-10-13T13:00:00Z"), AHORA, ZONA), "vencidas");
});

test("lo que vence más tarde hoy es de hoy", () => {
  assert.equal(grupoDeTarea(pendiente("2026-10-13T20:00:00Z"), AHORA, ZONA), "hoy");
});

test("el día lo decide la zona del workspace, no UTC", () => {
  // 23:30 del martes en Buenos Aires ya es miércoles en UTC: sigue siendo hoy.
  assert.equal(grupoDeTarea(pendiente("2026-10-14T02:30:00Z"), AHORA, ZONA), "hoy");
  // 00:30 del miércoles en Buenos Aires: mañana.
  assert.equal(grupoDeTarea(pendiente("2026-10-14T03:30:00Z"), AHORA, ZONA), "manana");
});

test("pasado mañana en adelante son próximas", () => {
  assert.equal(grupoDeTarea(pendiente("2026-10-15T13:00:00Z"), AHORA, ZONA), "proximas");
});

test("una tarea hecha o cancelada no está vencida aunque su fecha haya pasado", () => {
  const vieja = "2026-10-01T13:00:00Z";
  assert.equal(grupoDeTarea({ estado: "hecha", venceAt: vieja }, AHORA, ZONA), "cerradas");
  assert.equal(grupoDeTarea({ estado: "cancelada", venceAt: vieja }, AHORA, ZONA), "cerradas");
});

test("los grupos salen en orden de urgencia y sin grupos vacíos", () => {
  const grupos = agruparTareas(
    [
      pendiente("2026-10-20T13:00:00Z"),
      pendiente("2026-10-13T20:00:00Z"),
      pendiente("2026-10-12T13:00:00Z"),
    ],
    AHORA,
    ZONA,
  );
  assert.deepEqual(
    grupos.map((grupo) => grupo.grupo),
    ["vencidas", "hoy", "proximas"],
  );
});

test("dentro de un grupo va primero la más urgente", () => {
  const [hoy] = agruparTareas(
    [pendiente("2026-10-13T22:00:00Z"), pendiente("2026-10-13T18:00:00Z")],
    AHORA,
    ZONA,
  );
  assert.deepEqual(
    hoy.tareas.map((tarea) => tarea.venceAt),
    ["2026-10-13T18:00:00Z", "2026-10-13T22:00:00Z"],
  );
});

test("en las cerradas va primero la última que se cerró", () => {
  const [cerradas] = agruparTareas(
    [
      { estado: "hecha", venceAt: "2026-10-10T13:00:00Z", completadaAt: "2026-10-10T15:00:00Z" },
      { estado: "hecha", venceAt: "2026-10-09T13:00:00Z", completadaAt: "2026-10-12T15:00:00Z" },
    ],
    AHORA,
    ZONA,
  );
  assert.equal(cerradas.tareas[0].completadaAt, "2026-10-12T15:00:00Z");
});

test("el número del menú cuenta vencidas y de hoy, nada más", () => {
  const total = tareasUrgentes(
    [
      pendiente("2026-10-12T13:00:00Z"),
      pendiente("2026-10-13T20:00:00Z"),
      pendiente("2026-10-14T13:00:00Z"),
      { estado: "hecha", venceAt: "2026-10-12T13:00:00Z" },
    ],
    AHORA,
    ZONA,
  );
  assert.equal(total, 2);
});

/* ------------------------------------------------------------------- aviso */

test("el aviso se calcula restando los minutos al vencimiento", () => {
  assert.equal(calcularAviso("2026-10-13T14:00:00.000Z", 15), "2026-10-13T13:45:00.000Z");
  assert.equal(calcularAviso("2026-10-13T14:00:00.000Z", 0), "2026-10-13T14:00:00.000Z");
  assert.equal(calcularAviso("2026-10-13T14:00:00.000Z", null), null);
});

test("al editar, el aviso guardado vuelve a ser una de las opciones", () => {
  assert.equal(minutosDeAviso("2026-10-13T14:00:00Z", "2026-10-13T13:00:00Z"), 60);
  assert.equal(minutosDeAviso("2026-10-13T14:00:00Z", null), null);
  // Una diferencia que no es opción cae en la más cercana.
  assert.equal(minutosDeAviso("2026-10-13T14:00:00Z", "2026-10-13T13:50:00Z"), 15);
});

/* -------------------------------------------------------------- validación */

test("una tarea válida sale limpia y con el aviso calculado", () => {
  const resultado = validarTarea({
    titulo: "  Llamar a Juan  ",
    notas: "  ",
    tipo: "llamada",
    venceAt: "2026-10-14T13:00:00.000Z",
    avisoMinutos: 15,
  });
  assert.deepEqual(resultado, {
    ok: true,
    tarea: {
      titulo: "Llamar a Juan",
      notas: null,
      tipo: "llamada",
      venceAt: "2026-10-14T13:00:00.000Z",
      avisoAt: "2026-10-14T12:45:00.000Z",
    },
  });
});

test("sin tipo ni aviso toma los de siempre: seguimiento y a la hora", () => {
  const resultado = validarTarea({ titulo: "Algo", venceAt: "2026-10-14T13:00:00.000Z" });
  assert.ok(resultado.ok);
  assert.equal(resultado.tarea.tipo, "seguimiento");
  assert.equal(resultado.tarea.avisoAt, "2026-10-14T13:00:00.000Z");
});

test("sin aviso se guarda sin aviso", () => {
  const resultado = validarTarea({
    titulo: "Algo",
    venceAt: "2026-10-14T13:00:00.000Z",
    avisoMinutos: null,
  });
  assert.ok(resultado.ok);
  assert.equal(resultado.tarea.avisoAt, null);
});

test("se rechaza lo que la base no aceptaría, en castellano", () => {
  assert.equal(validarTarea({ titulo: " ", venceAt: "2026-10-14T13:00:00Z" }).ok, false);
  assert.equal(validarTarea({ titulo: "x".repeat(201), venceAt: "2026-10-14T13:00:00Z" }).ok, false);
  assert.equal(validarTarea({ titulo: "Algo", venceAt: "no es fecha" }).ok, false);
  assert.equal(validarTarea({ titulo: "Algo" }).ok, false);
  assert.equal(
    validarTarea({ titulo: "Algo", venceAt: "2026-10-14T13:00:00Z", tipo: "fiesta" }).ok,
    false,
  );
  assert.equal(
    validarTarea({ titulo: "Algo", venceAt: "2026-10-14T13:00:00Z", avisoMinutos: 37 }).ok,
    false,
  );
});

/* ------------------------------------------------------------------- texto */

test("el vencimiento se lee como se dice", () => {
  assert.equal(textoDeVencimiento("2026-10-13T20:30:00Z", AHORA, ZONA), "Hoy 17:30");
  assert.equal(textoDeVencimiento("2026-10-14T12:00:00Z", AHORA, ZONA), "Mañana 09:00");
  assert.equal(textoDeVencimiento("2026-10-12T21:00:00Z", AHORA, ZONA), "Ayer 18:00");
  assert.match(textoDeVencimiento("2026-10-16T13:00:00Z", AHORA, ZONA), /^vie 16 oct 10:00$/);
});

/* -------------------------------------------------------------------- fila */

test("una fila con el lead embebido se arma completa", () => {
  const tarea = filaATarea({
    id: "t1",
    titulo: "Llamar",
    notas: null,
    tipo: "llamada",
    estado: "pendiente",
    vence_at: "2026-10-14T13:00:00Z",
    aviso_at: null,
    asignada_a: "u1",
    creada_por: "u2",
    contact_id: "c1",
    vista: false,
    completada_at: null,
    updated_at: "2026-10-13T12:00:00Z",
    contacts: [{ name: "Juan" }],
  });
  assert.equal(tarea.contactName, "Juan");
  assert.equal(tarea.actualizadaAt, "2026-10-13T12:00:00Z");
  assert.equal(tarea.vista, false);
  assert.equal(tarea.tipo, "llamada");
});

test("si RLS esconde el lead, la tarea queda sin nombre pero no se cae", () => {
  const tarea = filaATarea({
    id: "t1",
    titulo: "Llamar",
    tipo: "raro",
    estado: "raro",
    vence_at: "2026-10-14T13:00:00Z",
    contact_id: "c1",
    contacts: null,
  });
  assert.equal(tarea.contactId, "c1");
  assert.equal(tarea.contactName, null);
  assert.equal(tarea.tipo, "seguimiento");
  assert.equal(tarea.estado, "pendiente");
});

/* ------------------------------------------------------------------ errores */

test("los errores de la base se leen en castellano", () => {
  assert.equal(
    errorDeTarea('new row violates row-level security policy for table "tareas"'),
    "No tenés permiso para hacer eso con esta tarea.",
  );
  assert.match(
    errorDeTarea("Could not find the table 'public.tareas' in the schema cache"),
    /Falta correr la migración/,
  );
  assert.match(errorDeTarea('relation "public.tareas" does not exist'), /Falta correr la migración/);
  // Los de la guarda ya vienen escritos para la persona.
  assert.equal(
    errorDeTarea("Esa persona no es parte del equipo."),
    "Esa persona no es parte del equipo.",
  );
});
