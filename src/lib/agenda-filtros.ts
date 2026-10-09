/**
 * El filtro de fechas de la agenda.
 *
 * Vive fuera del panel por lo mismo que el del embudo: un rango mal armado no
 * rompe nada en pantalla, muestra una agenda que no es la que se pidió y eso se
 * descubre tarde —normalmente cuando alguien da por libre un día que tenía una
 * visita—. Acá se puede afirmar sin montar la pantalla.
 *
 * Todo se razona sobre claves `YYYY-MM-DD` de la zona del workspace, nunca
 * sobre instantes: los días de la agenda son los del equipo, no los del reloj
 * del servidor ni los del navegador de quien mira.
 */

/** Lo elegido en la barra de filtros. Las dos fechas en null es "sin filtrar". */
export type FiltroAgenda = {
  /** Primer día del rango, `YYYY-MM-DD`. */
  desde: string | null;
  /** Último día, incluido. `null` con `desde` puesto es un día solo. */
  hasta: string | null;
};

export const FILTRO_AGENDA_VACIO: FiltroAgenda = { desde: null, hasta: null };

/** Los botones de un toque de la barra. */
export type AtajoAgenda = "hoy" | "manana" | "semana";

export const ATAJOS_AGENDA: { id: AtajoAgenda; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "manana", label: "Mañana" },
  { id: "semana", label: "Próx. 7 días" },
];

/** Suma días sobre la clave, sin pasar por instantes ni husos. */
function correr(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** ¿Es una clave de día usable? Un input vacío o a medio escribir no lo es. */
export function esDia(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  // Descarta un 31 de febrero, que el formato deja pasar y el calendario no.
  return (
    fecha.getUTCFullYear() === year &&
    fecha.getUTCMonth() === month - 1 &&
    fecha.getUTCDate() === day
  );
}

export function rangoDeAtajo(atajo: AtajoAgenda, hoyKey: string): FiltroAgenda {
  if (atajo === "hoy") return { desde: hoyKey, hasta: hoyKey };
  if (atajo === "manana") {
    const manana = correr(hoyKey, 1);
    return { desde: manana, hasta: manana };
  }
  return { desde: hoyKey, hasta: correr(hoyKey, 6) };
}

/** Qué atajo dejó puesto este rango, para que el botón quede marcado. */
export function atajoActivo(filtro: FiltroAgenda, hoyKey: string): AtajoAgenda | null {
  const actual = normalizarFiltro(filtro);
  for (const { id } of ATAJOS_AGENDA) {
    const rango = rangoDeAtajo(id, hoyKey);
    if (rango.desde === actual.desde && rango.hasta === actual.hasta) return id;
  }
  return null;
}

/**
 * El rango tal como hay que aplicarlo.
 *
 * Dos arreglos que el usuario no tiene por qué hacer a mano: una fecha sola
 * significa ese día —que es la pregunta que se hace en la agenda, "qué tengo el
 * jueves"— y un "hasta" anterior al "desde" se da vuelta en vez de devolver una
 * lista vacía sin explicación.
 */
export function normalizarFiltro(filtro: FiltroAgenda): FiltroAgenda {
  const desde = esDia(filtro.desde) ? filtro.desde : null;
  const hasta = esDia(filtro.hasta) ? filtro.hasta : null;

  if (desde === null && hasta === null) return FILTRO_AGENDA_VACIO;
  if (desde === null) return { desde: hasta, hasta };
  if (hasta === null) return { desde, hasta: desde };
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

/** ¿Hay algo que filtrar? */
export function hayFiltro(filtro: FiltroAgenda): boolean {
  return normalizarFiltro(filtro).desde !== null;
}

/** ¿La cita de ese día entra en el rango? `YYYY-MM-DD` ordena como el calendario. */
export function citaEnRango(dia: string, filtro: FiltroAgenda): boolean {
  const { desde, hasta } = normalizarFiltro(filtro);
  if (!desde || !hasta) return true;
  if (!dia) return false;
  return dia >= desde && dia <= hasta;
}

const DIA_LARGO = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "jueves, 3 de septiembre" a partir de la clave, sin husos de por medio. */
export function textoDelDia(dayKey: string): string {
  if (!esDia(dayKey)) return "";
  const [year, month, day] = dayKey.split("-").map(Number);
  return DIA_LARGO.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Cómo se lee el filtro puesto: es lo que evita el malentendido de una agenda
 * filtrada que se ve igual que una agenda vacía.
 */
export function textoDelRango(filtro: FiltroAgenda, hoyKey: string): string {
  const { desde, hasta } = normalizarFiltro(filtro);
  if (!desde || !hasta) return "";
  if (desde === hasta) {
    if (desde === hoyKey) return `hoy, ${textoDelDia(desde)}`;
    if (desde === correr(hoyKey, 1)) return `mañana, ${textoDelDia(desde)}`;
    if (desde === correr(hoyKey, -1)) return `ayer, ${textoDelDia(desde)}`;
    return `el ${textoDelDia(desde)}`;
  }
  return `del ${textoDelDia(desde)} al ${textoDelDia(hasta)}`;
}
