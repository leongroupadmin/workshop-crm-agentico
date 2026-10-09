/**
 * Lo que n8n manda cuando algo pasa en Google Calendar, ya validado.
 *
 * El módulo no toca la base ni la red: recibe el cuerpo crudo del webhook y
 * decide si se puede trabajar con él. Esa separación es la que permite probar
 * acá lo que en producción aparece tarde y mal —un teléfono que no se pudo
 * leer, una fecha sin zona, un evento de todo el día— en vez de descubrirlo
 * cuando un recordatorio no salió.
 *
 * La regla que ordena todo el archivo: **un evento que no se entiende se
 * rechaza con motivo, nunca se guarda a medias**. El teléfono no viaja en un
 * campo del evento sino raspado de la descripción, así que sale vacío más
 * seguido de lo que parece; y una cita sin teléfono es un recordatorio que no
 * sale nunca, sin error a la vista. Mejor que falle en n8n, donde se ve.
 */

import { normalizarTelefono } from "./telefono.ts";

export const ACCIONES = ["alta", "cambio", "baja"] as const;
export type Accion = (typeof ACCIONES)[number];

export const TIPOS_DE_CITA = ["reunion", "llamada", "visita", "otro"] as const;
export type TipoDeCita = (typeof TIPOS_DE_CITA)[number];

/** Cuánto dura una cita cuando el evento no trae fin. */
export const DURACION_POR_OMISION_MINUTOS = 30;

/**
 * Un evento de Calendar listo para guardar.
 *
 * `telefono` es obligatorio en el alta y opcional en el cambio: mover un turno
 * no vuelve a informar con quién es, y exigirlo haría fallar el flujo 2 sobre
 * citas que ya están bien guardadas.
 */
export type EventoDeCalendar =
  | {
      accion: "alta";
      eventId: string;
      titulo: string;
      nombre: string;
      telefono: string;
      email: string | null;
      inicio: Date;
      fin: Date;
      tipo: TipoDeCita;
      link: string | null;
      notas: string | null;
    }
  | {
      accion: "cambio";
      eventId: string;
      titulo: string | null;
      inicio: Date;
      fin: Date;
      link: string | null;
    }
  | { accion: "baja"; eventId: string };

/** Por qué no se pudo trabajar con lo que llegó. */
export type Rechazo = { campo: string; motivo: string };

export type Lectura =
  | { ok: true; evento: EventoDeCalendar }
  | { ok: false; rechazo: Rechazo };

/**
 * Lee el cuerpo del webhook.
 *
 * Devuelve el primer problema y no una lista: n8n muestra el mensaje de error
 * tal cual en la ejecución, y un solo motivo concreto se arregla más rápido que
 * cuatro a la vez.
 */
export function leerEvento(crudo: unknown): Lectura {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    return rechazo("cuerpo", "El cuerpo tiene que ser un objeto JSON.");
  }

  const objeto = crudo as Record<string, unknown>;

  const accion = ACCIONES.find((valor) => valor === objeto.accion);
  if (!accion) {
    return rechazo("accion", `Tiene que ser una de: ${ACCIONES.join(", ")}.`);
  }

  const eventId = texto(objeto.eventId).trim();
  if (!eventId) {
    return rechazo("eventId", "Falta el id del evento de Calendar, que es la clave de todo.");
  }

  // La baja no necesita nada más: el id alcanza para encontrar la cita, y el
  // resto de los campos pueden venir vacíos porque el evento ya no existe.
  if (accion === "baja") {
    return { ok: true, evento: { accion, eventId } };
  }

  const inicio = leerInstante(objeto.inicio);
  if (!inicio) {
    return rechazo(
      "inicio",
      "Tiene que ser una fecha ISO 8601 con zona, por ejemplo 2026-10-02T15:30:00-03:00.",
    );
  }

  const fin = leerInstante(objeto.fin) ?? sumarMinutos(inicio, DURACION_POR_OMISION_MINUTOS);
  // El fin anterior al inicio rompe el check de la base. Se corrige en vez de
  // rechazar: el dato que importa para el recordatorio es el inicio, y una
  // duración mal calculada en n8n no justifica perder la cita.
  const finValido = fin > inicio ? fin : sumarMinutos(inicio, DURACION_POR_OMISION_MINUTOS);

  const link = leerEnlace(objeto.link);

  if (accion === "cambio") {
    return {
      ok: true,
      evento: {
        accion,
        eventId,
        titulo: texto(objeto.titulo).trim() || null,
        inicio,
        fin: finValido,
        link,
      },
    };
  }

  const nombre = leerNombre(objeto);
  if (!nombre) {
    return rechazo("nombre", "No se pudo leer el nombre de quien reservó.");
  }

  // El corte importante del archivo. Ver el comentario de arriba.
  const telefono = normalizarTelefono(texto(objeto.telefono));
  if (!telefono) {
    return rechazo(
      "telefono",
      "No se pudo leer un teléfono válido de la reserva, así que el recordatorio no tendría a dónde salir. " +
        "Suele ser que el bloque de la descripción del evento cambió de formato.",
    );
  }

  const titulo = texto(objeto.titulo).trim() || `Llamada con ${nombre}`;

  return {
    ok: true,
    evento: {
      accion,
      eventId,
      titulo,
      nombre,
      telefono,
      email: leerEmail(objeto.email),
      inicio,
      fin: finValido,
      tipo: tipoDeCita(titulo, texto(objeto.notas)),
      link,
      notas: texto(objeto.notas).trim() || null,
    },
  };
}

/**
 * El nombre de quien reservó.
 *
 * Acepta `nombre` solo o partido en `nombre` y `apellido`, que es como lo deja
 * el nodo que ya existe en n8n. Los junta acá para no pedirle un cambio de
 * forma a un flujo que ya funciona.
 */
function leerNombre(objeto: Record<string, unknown>): string {
  const nombre = texto(objeto.nombre).trim();
  const apellido = texto(objeto.apellido).trim();
  const completo = texto(objeto.nombre_completo).trim();

  return (completo || [nombre, apellido].filter(Boolean).join(" ")).replace(/\s+/g, " ").trim();
}

/** Un email que al menos tenga forma de email, o null. */
function leerEmail(valor: unknown): string | null {
  const email = texto(valor).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

/**
 * Qué clase de cita es, a partir de cómo se llama el evento.
 *
 * Es una adivinanza, y se asume como tal: la gente escribe "Llamada con Juan" o
 * "Visita al depósito", y de ahí sale bien la mayoría de las veces. Cuando no,
 * queda editable en el CRM —por eso la sincronización sólo fija el tipo al
 * crear la cita y no al actualizarla, así una corrección a mano no se pierde en
 * el próximo cambio de horario—.
 *
 * `reunion` es el valor seguro por omisión: es el más genérico, y equivocarse
 * hacia él sólo significa que un recordatorio específico de llamadas no aplica.
 */
export function tipoDeCita(titulo: string, notas = ""): TipoDeCita {
  const texto = `${titulo} ${notas}`.toLowerCase();

  if (/\b(llamad|llamar|telef|tel[eé]fon|call)/.test(texto)) return "llamada";
  if (/\b(visita|visitar|domicilio|obra|dep[oó]sito|showroom)/.test(texto)) return "visita";
  if (/\b(reuni[oó]n|meet|zoom|entrevista|demo)/.test(texto)) return "reunion";

  return "reunion";
}

/**
 * Lee un instante ISO 8601.
 *
 * Exige zona —`Z` o un offset— y no la asume. Una fecha sin zona es ambigua por
 * tres horas en este huso, y un recordatorio corrido tres horas es peor que
 * ninguno: llega cuando el cliente ya colgó. Es más útil rechazarlo y que se
 * vea en n8n.
 *
 * Un evento de todo el día (`2026-10-02`, sin hora) cae por la misma regla, y
 * está bien: no tiene hora de la que restar "una hora antes".
 */
export function leerInstante(valor: unknown): Date | null {
  const crudo = texto(valor).trim();
  if (!crudo) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(crudo)) return null;

  const fecha = new Date(crudo);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

function sumarMinutos(instante: Date, minutos: number): Date {
  return new Date(instante.getTime() + minutos * 60_000);
}

/**
 * El enlace de una cita, o null.
 *
 * Lo usan los dos lados: el evento de Calendar —donde llega el `hangoutLink` o
 * el `htmlLink`— y el formulario del CRM, donde alguien pega el de Meet, Zoom o
 * el mapa del domicilio. Por eso vive acá y no en el webhook.
 *
 * Exige `http` o `https` y no cualquier texto: el enlace termina pegado en un
 * WhatsApp, y un "pasar por la oficina" escrito en ese campo sale como un link
 * roto. Lo que no tiene forma de enlace se guarda como nada, que es más honesto
 * que guardarlo a medias.
 */
export function leerEnlace(valor: unknown): string | null {
  const crudo = texto(valor).trim();
  if (!crudo || crudo.length > MAX_ENLACE) return null;

  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    return null;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}

/** Lo que entra en la columna sin que a nadie le sirva leerlo. */
const MAX_ENLACE = 2000;

function rechazo(campo: string, motivo: string): Lectura {
  return { ok: false, rechazo: { campo, motivo } };
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  // n8n manda números cuando el campo salió de un `Code` node sin comillas.
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return "";
}
