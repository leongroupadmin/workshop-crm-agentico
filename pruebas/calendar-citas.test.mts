/**
 * Pruebas de lo que llega desde Calendar por n8n.
 *
 * Lo que se cuida acá es lo que en producción se descubre tarde y mal: un
 * teléfono que no se pudo raspar de la descripción del evento —y que deja un
 * recordatorio sin destino, sin error a la vista—, y una fecha sin zona, que en
 * este huso corre el aviso tres horas y lo hace llegar cuando el cliente ya
 * colgó.
 *
 * Las fechas se afirman contra instantes en UTC, así el resultado no depende de
 * dónde corra la prueba.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  DURACION_POR_OMISION_MINUTOS,
  leerEnlace,
  leerEvento,
  leerInstante,
  tipoDeCita,
} from "../src/lib/calendar-citas.ts";

/** Un alta como la va a mandar el flujo de n8n una vez adaptado. */
const ALTA = {
  accion: "alta",
  eventId: "abc123",
  titulo: "Llamada con Juan Pérez",
  nombre: "Juan",
  apellido: "Pérez",
  telefono: "+5491122334455",
  email: "juan@ejemplo.com",
  inicio: "2026-10-02T15:30:00-03:00",
  fin: "2026-10-02T16:00:00-03:00",
  link: "https://calendar.google.com/evento",
  notas: "Reservada por juan@ejemplo.com",
};

function alta(cambios: Record<string, unknown> = {}) {
  return leerEvento({ ...ALTA, ...cambios });
}

/* ------------------------------------------------------------------ lectura */

test("lee un alta completa", () => {
  const leido = alta();
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");

  assert.equal(leido.evento.eventId, "abc123");
  assert.equal(leido.evento.nombre, "Juan Pérez");
  assert.equal(leido.evento.telefono, "+5491122334455");
  assert.equal(leido.evento.email, "juan@ejemplo.com");
  assert.equal(leido.evento.tipo, "llamada");
  assert.equal(leido.evento.inicio.toISOString(), "2026-10-02T18:30:00.000Z");
  assert.equal(leido.evento.fin.toISOString(), "2026-10-02T19:00:00.000Z");
});

test("una acción que no existe se rechaza", () => {
  const leido = alta({ accion: "borrar" });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "accion");
});

test("sin el id del evento no hay nada que sincronizar", () => {
  const leido = alta({ eventId: "  " });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "eventId");
});

test("la baja sólo necesita el id: el evento ya no existe para contar más", () => {
  const leido = leerEvento({ accion: "baja", eventId: "abc123" });
  assert.equal(leido.ok, true);
  if (!leido.ok) return;
  assert.equal(leido.evento.accion, "baja");
  assert.equal(leido.evento.eventId, "abc123");
});

test("un cuerpo que no es objeto se rechaza sin explotar", () => {
  for (const basura of [null, undefined, "texto", 42, []]) {
    const leido = leerEvento(basura);
    assert.equal(leido.ok, false, `esperaba rechazo para ${JSON.stringify(basura)}`);
  }
});

/* ---------------------------------------------------------------- teléfono */

test("un alta sin teléfono se rechaza: el recordatorio no tendría a dónde salir", () => {
  const leido = alta({ telefono: "" });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "telefono");
});

test("un teléfono demasiado corto no pasa por válido", () => {
  const leido = alta({ telefono: "1234" });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "telefono");
});

test("el teléfono se normaliza a E.164 aunque venga con espacios y guiones", () => {
  const leido = alta({ telefono: "+54 9 11 2233-4455" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.telefono, "+5491122334455");
});

test("el cambio no exige teléfono: mover un turno no vuelve a decir con quién es", () => {
  const leido = leerEvento({
    accion: "cambio",
    eventId: "abc123",
    inicio: "2026-10-03T10:00:00-03:00",
  });
  assert.equal(leido.ok, true);
  if (!leido.ok) return;
  assert.equal(leido.evento.accion, "cambio");
});

/* -------------------------------------------------------------------- fecha */

test("una fecha sin zona se rechaza: corre el recordatorio tres horas", () => {
  for (const sinZona of ["2026-10-02T15:30:00", "2026-10-02 15:30", "02/10/2026 15:30"]) {
    assert.equal(leerInstante(sinZona), null, `${sinZona} no debería pasar`);
  }
});

test("acepta Z y acepta offset, con y sin dos puntos", () => {
  assert.equal(leerInstante("2026-10-02T18:30:00Z")?.toISOString(), "2026-10-02T18:30:00.000Z");
  assert.equal(leerInstante("2026-10-02T15:30:00-03:00")?.toISOString(), "2026-10-02T18:30:00.000Z");
  assert.equal(leerInstante("2026-10-02T15:30:00-0300")?.toISOString(), "2026-10-02T18:30:00.000Z");
});

test("un evento de todo el día no tiene hora de la que restar: se rechaza", () => {
  assert.equal(leerInstante("2026-10-02"), null);
  const leido = alta({ inicio: "2026-10-02" });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "inicio");
});

test("sin fin, la cita dura lo de por omisión", () => {
  const leido = alta({ fin: undefined });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");

  const minutos = (leido.evento.fin.getTime() - leido.evento.inicio.getTime()) / 60_000;
  assert.equal(minutos, DURACION_POR_OMISION_MINUTOS);
});

test("un fin anterior al inicio se corrige en vez de perder la cita", () => {
  const leido = alta({ fin: "2026-10-02T14:00:00-03:00" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.ok(leido.evento.fin > leido.evento.inicio, "el fin tiene que quedar después del inicio");
});

/* -------------------------------------------------------------------- nombre */

test("junta nombre y apellido como los manda el nodo que ya existe", () => {
  const leido = alta({ nombre: "María", apellido: "del Carmen López" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.nombre, "María del Carmen López");
});

test("acepta el nombre completo en un solo campo", () => {
  const leido = alta({ nombre: "", apellido: "", nombre_completo: "Ana Gómez" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.nombre, "Ana Gómez");
});

test("sin nombre se rechaza", () => {
  const leido = alta({ nombre: "", apellido: "", nombre_completo: "" });
  assert.equal(leido.ok, false);
  if (leido.ok) return;
  assert.equal(leido.rechazo.campo, "nombre");
});

test("un email que no tiene forma de email queda en null, no rechaza la cita", () => {
  const leido = alta({ email: "no-es-un-mail" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.email, null);
});

test("sin título, se arma uno con el nombre", () => {
  const leido = alta({ titulo: "" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.titulo, "Llamada con Juan Pérez");
});

/* --------------------------------------------------------- tipo de la cita */

test("reconoce una llamada por el título", () => {
  assert.equal(tipoDeCita("Llamada con Juan"), "llamada");
  assert.equal(tipoDeCita("Llamar a proveedor"), "llamada");
  assert.equal(tipoDeCita("Call con el equipo"), "llamada");
});

test("reconoce una visita", () => {
  assert.equal(tipoDeCita("Visita al depósito"), "visita");
  assert.equal(tipoDeCita("Ir al showroom"), "visita");
});

test("reconoce una reunión", () => {
  assert.equal(tipoDeCita("Reunión de equipo"), "reunion");
  assert.equal(tipoDeCita("Zoom con el cliente"), "reunion");
  assert.equal(tipoDeCita("Demo del producto"), "reunion");
});

test("lo que no se reconoce cae en reunión, que es el lado seguro", () => {
  assert.equal(tipoDeCita("Café"), "reunion");
  assert.equal(tipoDeCita(""), "reunion");
});

test("también mira las notas cuando el título no dice nada", () => {
  assert.equal(tipoDeCita("Juan Pérez", "Consulta telefónica de 30 min"), "llamada");
});

/* ------------------------------------------------------------- tolerancias */

test("un teléfono que vino como número desde un Code node igual se lee", () => {
  const leido = alta({ telefono: 5491122334455 });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.telefono, "+5491122334455");
});

/* ---------------------------------------------------------------- enlaces */

/**
 * El enlace lo escriben dos lados —Calendar y el formulario del CRM— y termina
 * en el `{link}` de un recordatorio de WhatsApp. Lo que no tiene forma de
 * enlace sale como un link roto, así que no se guarda.
 */
test("un enlace con forma de enlace se guarda", () => {
  assert.equal(leerEnlace("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(leerEnlace("  https://zoom.us/j/123  "), "https://zoom.us/j/123");
});

test("lo que no es un enlace no se guarda a medias", () => {
  assert.equal(leerEnlace("pasar por la oficina"), null);
  assert.equal(leerEnlace("meet.google.com/abc"), null);
  assert.equal(leerEnlace("javascript:alert(1)"), null);
  assert.equal(leerEnlace(""), null);
  assert.equal(leerEnlace(null), null);
  assert.equal(leerEnlace(`https://x.com/${"a".repeat(2100)}`), null);
});

test("el evento sin enlace no rompe: la cita queda sin él", () => {
  const leido = alta({ link: "no es un enlace" });
  assert.equal(leido.ok, true);
  if (!leido.ok || leido.evento.accion !== "alta") return assert.fail("esperaba un alta");
  assert.equal(leido.evento.link, null);
});
