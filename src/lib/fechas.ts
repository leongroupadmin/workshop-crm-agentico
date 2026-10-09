/**
 * Conversiones entre `<input type="datetime-local">` y un instante real.
 *
 * El input trabaja en hora de pared y no lleva zona: escribe `2026-08-18T15:00`
 * tanto para las tres de la tarde en Córdoba como en Madrid. Mandar ese texto
 * crudo al servidor lo dejaba interpretarlo con **su** zona —Vercel corre en
 * UTC— así que una cita a las 15:00 se guardaba tres horas antes de lo pedido.
 *
 * Peor todavía: como el formulario propone la hora siguiente, la cita recién
 * creada quedaba en el pasado, y el panel sólo muestra las que vienen. Agendar
 * parecía no hacer nada.
 *
 * La conversión tiene que pasar en el navegador, que es el único que conoce la
 * zona de quien la está cargando.
 */

/** Instante → texto de hora de pared, para llenar el input. */
export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Texto del input → instante en ISO con zona.
 *
 * Devuelve null si el campo está vacío o incompleto, para que el formulario lo
 * avise en vez de mandar una fecha inválida.
 */
export function fromLocalInputValue(value: string): string | null {
  // `new Date("2026-08-18T15:00")` sin zona se lee como hora local, que en el
  // navegador es exactamente lo que se quiere.
  const fecha = new Date(value);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Zona horaria del workspace.
 *
 * El mismo problema de arriba, pero al revés y en el resumen: el servidor
 * arma los días con *su* reloj, y Vercel corre en UTC. A las 21:00 de
 * Argentina allá ya es el día siguiente, así que el gráfico de actividad
 * abría una barra de mañana y le cargaba los mensajes de hoy.
 *
 * Acá no alcanza con resolverlo en el navegador: el corte del día decide qué
 * cuenta como "hoy" para todo el equipo, y dos personas mirando el mismo
 * tablero desde distintos países tienen que ver el mismo número. Por eso la
 * zona se guarda en el workspace y no se toma del dispositivo.
 */

/** El CRM nació operando en Argentina; ahí sigue el grueso del uso. */
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** Lo que ofrece el selector de Configuración. */
export const TIMEZONE_OPTIONS: { zone: string; label: string }[] = [
  { zone: "America/Argentina/Buenos_Aires", label: "Argentina (Buenos Aires)" },
  { zone: "America/Montevideo", label: "Uruguay (Montevideo)" },
  { zone: "America/Santiago", label: "Chile (Santiago)" },
  { zone: "America/Asuncion", label: "Paraguay (Asunción)" },
  { zone: "America/La_Paz", label: "Bolivia (La Paz)" },
  { zone: "America/Sao_Paulo", label: "Brasil (São Paulo)" },
  { zone: "America/Lima", label: "Perú (Lima)" },
  { zone: "America/Bogota", label: "Colombia (Bogotá)" },
  { zone: "America/Caracas", label: "Venezuela (Caracas)" },
  { zone: "America/Guayaquil", label: "Ecuador (Guayaquil)" },
  { zone: "America/Mexico_City", label: "México (CDMX)" },
  { zone: "America/New_York", label: "EE.UU. (Nueva York)" },
  { zone: "America/Chicago", label: "EE.UU. (Chicago)" },
  { zone: "America/Denver", label: "EE.UU. (Denver)" },
  { zone: "America/Los_Angeles", label: "EE.UU. (Los Ángeles)" },
  { zone: "Europe/Madrid", label: "España (Madrid)" },
  { zone: "UTC", label: "UTC" },
];

/** ¿La conoce el motor de fechas del navegador o del server? */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zona utilizable, siempre.
 *
 * Una zona vacía o desconocida no puede tirar abajo el tablero entero:
 * `Intl` lanza ante un nombre inválido y el resumen dejaría de renderizar.
 */
export function safeTimeZone(zone: string | null | undefined): string {
  return typeof zone === "string" && zone.length > 0 && isValidTimeZone(zone)
    ? zone
    : DEFAULT_TIMEZONE;
}

/** Un formateador por zona: construirlos es lo caro, formatear no. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const built = build();
  formatterCache.set(key, built);
  return built;
}

function partsOf(formatter: Intl.DateTimeFormat, instant: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/**
 * Instante → día calendario en esa zona, como `YYYY-MM-DD`.
 *
 * Es la pieza que faltaba: un mensaje de las 22:00 del martes en Córdoba llega
 * a la base como `2026-08-19T01:00Z`, y recortar el ISO lo mandaba al
 * miércoles. Preguntarle a `Intl` en qué día cayó lo deja donde el usuario lo
 * escribió.
 */
export function dayKeyInZone(instant: Date | string, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = cachedFormatter(`day:${timeZone}`, () =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  );
  const { year, month, day } = partsOf(formatter, date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Cuánto adelanta la zona respecto de UTC en ese instante, en milisegundos. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const formatter = cachedFormatter(`offset:${timeZone}`, () =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
  const { year, month, day, hour, minute, second } = partsOf(formatter, instant);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // El instante puede traer milisegundos y el formateador no: se truncan los
  // dos al segundo para que la resta dé el desfasaje limpio.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * `YYYY-MM-DD` de esa zona → el instante en que ese día arranca.
 *
 * Se resuelve dos veces porque el desfasaje se pide para un instante, y el de
 * la conjetura inicial puede ser el del otro lado de un cambio de horario.
 */
export function startOfDayInZone(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day);
  const guess = wallClock - offsetMsAt(new Date(wallClock), timeZone);
  return new Date(wallClock - offsetMsAt(new Date(guess), timeZone));
}

/**
 * Aritmética de calendario sobre la clave, sin zonas de por medio.
 *
 * Restarle días a un instante es lo que rompe en los cambios de horario: hay
 * días de 23 y de 25 horas. Sobre `YYYY-MM-DD` la cuenta es exacta.
 */
export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Día de la semana de la clave, 0 = domingo. */
export function weekdayOfDayKey(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Primer día del mes al que pertenece la clave. */
export function monthStartKey(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

/** "martes, 18 de agosto", con el día que corresponde a la zona del workspace. */
export function longDateInZone(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString("es-AR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
