/**
 * Tareas del equipo: lo que no depende de la base ni de la pantalla.
 *
 * Vive aparte por lo mismo que los filtros de la agenda: una tarea mal agrupada
 * no rompe nada a la vista, aparece en "Próximas" cuando ya venció, y eso se
 * descubre cuando el cliente pregunta por qué nadie lo llamó. Acá se puede
 * afirmar sin montar la pantalla.
 *
 * Los días se razonan en la zona del workspace, igual que en el resto del CRM:
 * "hoy" es el mismo para todo el equipo aunque alguien mire desde otro país.
 */
import { dayKeyInZone, shiftDayKey } from "./fechas.ts";

export type TipoDeTarea = "llamada" | "mensaje" | "seguimiento" | "reunion" | "otro";
export type EstadoDeTarea = "pendiente" | "hecha" | "cancelada";

/** El orden es el del selector: lo más común primero. */
export const TIPOS_DE_TAREA: { id: TipoDeTarea; label: string }[] = [
  { id: "llamada", label: "Llamada" },
  { id: "mensaje", label: "Mensaje" },
  { id: "seguimiento", label: "Seguimiento" },
  { id: "reunion", label: "Reunión" },
  { id: "otro", label: "Otro" },
];

export const TIPO_POR_OMISION: TipoDeTarea = "seguimiento";

export const ETIQUETA_DEL_TIPO: Record<TipoDeTarea, string> = Object.fromEntries(
  TIPOS_DE_TAREA.map((tipo) => [tipo.id, tipo.label]),
) as Record<TipoDeTarea, string>;

export const ETIQUETA_DEL_ESTADO: Record<EstadoDeTarea, string> = {
  pendiente: "Pendiente",
  hecha: "Hecha",
  cancelada: "Cancelada",
};

/**
 * Cuánto antes avisar, en minutos. Null es sin aviso.
 *
 * Una lista cerrada y no un número libre: nadie piensa "avisame 37 minutos
 * antes", y una lista corta es lo que hace que el formulario se llene en dos
 * toques.
 */
export const AVISOS_DE_TAREA: { minutos: number | null; label: string }[] = [
  { minutos: 0, label: "A la hora" },
  { minutos: 15, label: "15 min antes" },
  { minutos: 60, label: "1 hora antes" },
  { minutos: 1440, label: "1 día antes" },
  { minutos: null, label: "Sin aviso" },
];

export const AVISO_POR_OMISION = 0;

export const MAX_TITULO = 200;
export const MAX_NOTAS = 2000;

/** Una tarea tal como la usan las pantallas. */
export type TareaRow = {
  id: string;
  titulo: string;
  notas: string | null;
  tipo: TipoDeTarea;
  estado: EstadoDeTarea;
  venceAt: string;
  avisoAt: string | null;
  asignadaA: string | null;
  creadaPor: string | null;
  /** Null si es una tarea suelta, sin lead. */
  contactId: string | null;
  /** Null también si el lead existe pero quien mira ya no lo ve. */
  contactName: string | null;
  /** false si se la pasó otra persona y quien la tiene todavía no la vio. */
  vista: boolean;
  completadaAt: string | null;
  /**
   * El último cambio. En una tarea sin ver es cuándo te la pasaron, que es lo
   * que ordena la campana.
   */
  actualizadaAt: string | null;
};

/** Las columnas que hay que pedir para armar una `TareaRow`. */
export const CAMPOS_DE_TAREA =
  "id, titulo, notas, tipo, estado, vence_at, aviso_at, asignada_a, creada_por, contact_id, vista, completada_at, updated_at, contacts(name)";

const TIPOS = new Set<string>(TIPOS_DE_TAREA.map((tipo) => tipo.id));
const ESTADOS = new Set<string>(Object.keys(ETIQUETA_DEL_ESTADO));

export const esTipoDeTarea = (valor: unknown): valor is TipoDeTarea =>
  typeof valor === "string" && TIPOS.has(valor);

export const esEstadoDeTarea = (valor: unknown): valor is EstadoDeTarea =>
  typeof valor === "string" && ESTADOS.has(valor);

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.length > 0 ? valor : null;

/**
 * Fila cruda de PostgREST → `TareaRow`.
 *
 * El contacto llega embebido como objeto o como arreglo de uno, según cómo
 * resuelva la relación; y llega en null cuando RLS no deja ver el lead, que es
 * un caso real: el lead pudo pasar a otra persona después de crear la tarea.
 */
export function filaATarea(fila: Record<string, unknown>): TareaRow {
  const relacion = Array.isArray(fila.contacts) ? fila.contacts[0] : fila.contacts;
  const contacto = (relacion ?? null) as { name?: unknown } | null;

  return {
    id: String(fila.id),
    titulo: typeof fila.titulo === "string" ? fila.titulo : "",
    notas: texto(fila.notas),
    tipo: esTipoDeTarea(fila.tipo) ? fila.tipo : TIPO_POR_OMISION,
    estado: esEstadoDeTarea(fila.estado) ? fila.estado : "pendiente",
    venceAt: String(fila.vence_at),
    avisoAt: texto(fila.aviso_at),
    asignadaA: texto(fila.asignada_a),
    creadaPor: texto(fila.creada_por),
    contactId: texto(fila.contact_id),
    contactName: texto(contacto?.name),
    vista: fila.vista !== false,
    completadaAt: texto(fila.completada_at),
    actualizadaAt: texto(fila.updated_at),
  };
}

/**
 * El error de la base, en algo que se pueda leer.
 *
 * Los de la guarda de `tareas` ya vienen en castellano y se devuelven tal cual.
 * El de RLS viene en inglés y no le dice nada a quien está cargando una tarea,
 * y el de la tabla inexistente es el que aparece hasta que se corre la
 * migración.
 */
export function errorDeTarea(mensaje: string): string {
  if (/row-level security/i.test(mensaje)) {
    return "No tenés permiso para hacer eso con esta tarea.";
  }
  if (/tareas/.test(mensaje) && /does not exist|could not find/i.test(mensaje)) {
    return "Falta correr la migración de tareas en Supabase (202610070001_tareas.sql).";
  }
  return mensaje;
}

/* ---------------------------------------------------------------- el aviso */

/** El instante del aviso, o null si no hay que avisar. */
export function calcularAviso(venceAt: string, minutosAntes: number | null): string | null {
  if (minutosAntes === null) return null;
  const vence = new Date(venceAt).getTime();
  if (Number.isNaN(vence)) return null;
  return new Date(vence - minutosAntes * 60_000).toISOString();
}

/**
 * Lo contrario: de los dos instantes guardados, cuántos minutos antes avisa.
 *
 * Es lo que necesita el formulario al editar. Si la diferencia no es una de
 * las opciones —una tarea vieja, o editada por otro lado— se devuelve la más
 * cercana, que es lo que mejor representa lo que había.
 */
export function minutosDeAviso(venceAt: string, avisoAt: string | null): number | null {
  if (!avisoAt) return null;
  const diferencia = Math.round(
    (new Date(venceAt).getTime() - new Date(avisoAt).getTime()) / 60_000,
  );
  if (Number.isNaN(diferencia)) return AVISO_POR_OMISION;

  let elegido = AVISO_POR_OMISION;
  for (const opcion of AVISOS_DE_TAREA) {
    if (opcion.minutos === null) continue;
    if (Math.abs(opcion.minutos - diferencia) < Math.abs(elegido - diferencia)) {
      elegido = opcion.minutos;
    }
  }
  return elegido;
}

const AVISOS_VALIDOS = new Set(
  AVISOS_DE_TAREA.map((opcion) => opcion.minutos).filter((minutos) => minutos !== null),
);

/* ----------------------------------------------------------- la validación */

export type TareaEntrante = {
  titulo?: unknown;
  notas?: unknown;
  tipo?: unknown;
  venceAt?: unknown;
  avisoMinutos?: unknown;
};

export type TareaValida = {
  titulo: string;
  notas: string | null;
  tipo: TipoDeTarea;
  venceAt: string;
  avisoAt: string | null;
};

/**
 * Limpia lo que llega del formulario.
 *
 * La base vuelve a controlar el largo del título y de las notas; esto existe
 * para contestar en castellano antes de llegar ahí, igual que los permisos.
 */
export function validarTarea(
  entrada: TareaEntrante,
): { ok: true; tarea: TareaValida } | { ok: false; error: string } {
  const titulo = typeof entrada.titulo === "string" ? entrada.titulo.trim() : "";
  if (!titulo) return { ok: false, error: "Escribí qué hay que hacer." };
  if (titulo.length > MAX_TITULO) {
    return { ok: false, error: `El título no puede pasar de ${MAX_TITULO} caracteres.` };
  }

  const notas = typeof entrada.notas === "string" ? entrada.notas.trim() : "";
  if (notas.length > MAX_NOTAS) {
    return { ok: false, error: `Las notas no pueden pasar de ${MAX_NOTAS} caracteres.` };
  }

  const tipo = entrada.tipo === undefined ? TIPO_POR_OMISION : entrada.tipo;
  if (!esTipoDeTarea(tipo)) return { ok: false, error: "Ese tipo de tarea no existe." };

  const vence = typeof entrada.venceAt === "string" ? new Date(entrada.venceAt) : null;
  if (!vence || Number.isNaN(vence.getTime())) {
    return { ok: false, error: "Elegí para cuándo es." };
  }

  const aviso = entrada.avisoMinutos === undefined ? AVISO_POR_OMISION : entrada.avisoMinutos;
  if (aviso !== null && !(typeof aviso === "number" && AVISOS_VALIDOS.has(aviso))) {
    return { ok: false, error: "Ese aviso no es una de las opciones." };
  }

  const venceAt = vence.toISOString();
  return {
    ok: true,
    tarea: {
      titulo,
      notas: notas || null,
      tipo,
      venceAt,
      avisoAt: calcularAviso(venceAt, aviso),
    },
  };
}

/* -------------------------------------------------------------- los grupos */

export type GrupoDeTarea = "vencidas" | "hoy" | "manana" | "proximas" | "cerradas";

export const ETIQUETA_DEL_GRUPO: Record<GrupoDeTarea, string> = {
  vencidas: "Vencidas",
  hoy: "Hoy",
  manana: "Mañana",
  proximas: "Próximas",
  cerradas: "Hechas y canceladas",
};

const ORDEN_DE_GRUPOS: GrupoDeTarea[] = ["vencidas", "hoy", "manana", "proximas", "cerradas"];

/**
 * En qué grupo cae una tarea.
 *
 * "Vencida" es por hora y no por día: una llamada de las 10 que a las 11 sigue
 * pendiente ya está atrasada, aunque sea de hoy. Que se quede en "Hoy" hasta la
 * medianoche es justo lo que hace que se pase.
 */
export function grupoDeTarea(
  tarea: Pick<TareaRow, "estado" | "venceAt">,
  ahora: Date,
  zona: string,
): GrupoDeTarea {
  if (tarea.estado !== "pendiente") return "cerradas";
  if (new Date(tarea.venceAt).getTime() < ahora.getTime()) return "vencidas";

  const hoy = dayKeyInZone(ahora, zona);
  const dia = dayKeyInZone(tarea.venceAt, zona);
  if (dia === hoy) return "hoy";
  if (dia === shiftDayKey(hoy, 1)) return "manana";
  return "proximas";
}

/**
 * Las tareas en grupos, en el orden en que se leen, sin grupos vacíos.
 *
 * Las pendientes van de la más urgente a la menos; las cerradas al revés, la
 * última que se cerró primero, que es la que uno busca para deshacer.
 */
export function agruparTareas<T extends Pick<TareaRow, "estado" | "venceAt" | "completadaAt">>(
  tareas: T[],
  ahora: Date,
  zona: string,
): { grupo: GrupoDeTarea; label: string; tareas: T[] }[] {
  const porGrupo = new Map<GrupoDeTarea, T[]>();
  for (const tarea of tareas) {
    const grupo = grupoDeTarea(tarea, ahora, zona);
    porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), tarea]);
  }

  const momento = (valor: string | null) => (valor ? new Date(valor).getTime() : 0);

  return ORDEN_DE_GRUPOS.filter((grupo) => porGrupo.has(grupo)).map((grupo) => {
    const lista = [...(porGrupo.get(grupo) ?? [])];
    lista.sort((a, b) =>
      grupo === "cerradas"
        ? momento(b.completadaAt ?? b.venceAt) - momento(a.completadaAt ?? a.venceAt)
        : momento(a.venceAt) - momento(b.venceAt),
    );
    return { grupo, label: ETIQUETA_DEL_GRUPO[grupo], tareas: lista };
  });
}

/** Cuántas piden atención: vencidas o para hoy. Es el número del menú. */
export function tareasUrgentes(
  tareas: Pick<TareaRow, "estado" | "venceAt">[],
  ahora: Date,
  zona: string,
): number {
  return tareas.filter((tarea) => {
    const grupo = grupoDeTarea(tarea, ahora, zona);
    return grupo === "vencidas" || grupo === "hoy";
  }).length;
}

/* --------------------------------------------------------------- el texto */

/**
 * Para cuándo es, en corto: "Hoy 10:30", "Mañana 09:00", "Ayer 18:00" o
 * "mié 14 oct 10:00".
 *
 * En la zona del workspace, la misma con la que se arman los grupos: si el
 * texto dijera "mañana" adentro del grupo "Hoy" no se le creería a ninguno.
 */
export function textoDeVencimiento(venceAt: string, ahora: Date, zona: string): string {
  const vence = new Date(venceAt);
  if (Number.isNaN(vence.getTime())) return "";

  const hora = new Intl.DateTimeFormat("es-AR", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(vence);

  const hoy = dayKeyInZone(ahora, zona);
  const dia = dayKeyInZone(vence, zona);
  if (dia === hoy) return `Hoy ${hora}`;
  if (dia === shiftDayKey(hoy, 1)) return `Mañana ${hora}`;
  if (dia === shiftDayKey(hoy, -1)) return `Ayer ${hora}`;

  const fecha = new Intl.DateTimeFormat("es-AR", {
    timeZone: zona,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(vence)
    .replace(/[.,]/g, "");
  return `${fecha} ${hora}`;
}
