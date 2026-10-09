/**
 * Cómo el asistente resuelve un rango de fechas y con qué lo compara.
 *
 * Sin `server-only`: es aritmética de días, sin base ni red, y vive separado de
 * `asistente.ts` justamente para poder probarse. Es lo más fácil de arruinar de
 * todo el asistente —un corte corrido un día cambia todos los números— y lo
 * más difícil de notar mirando una respuesta.
 */

// Relativo y con extensión, a diferencia del resto del proyecto: las pruebas
// corren con `node --experimental-strip-types`, que no conoce el alias `@/`.
// Los módulos que ya se prueban se las arreglan sin importar nada en runtime;
// éste necesita las fechas, así que el import tiene que resolver también fuera
// de Next.
import { monthStartKey, shiftDayKey, startOfDayInZone } from "./fechas.ts";

export type Rango = {
  /** Primer día incluido, AAAA-MM-DD. */
  desdeKey: string;
  /** Último día incluido, AAAA-MM-DD. */
  hastaKey: string;
  desde: Date;
  /** Corte abierto: el arranque del día siguiente al último incluido. */
  hasta: Date;
  previoDesde: Date;
  previoDesdeKey: string;
  previoHastaKey: string;
};

/**
 * Arma el rango pedido y el tramo anterior con el que se compara.
 *
 * Dos decisiones que se ven en cada número que devuelve el asistente:
 *
 * El rango es **inclusivo** de cara a quien pregunta. "Del 1 al 21" incluye el
 * 21 entero, así que el corte va al arranque del 22. Sin esto, preguntar por
 * hoy devuelve cero.
 *
 * El tramo anterior es **igual de largo** y termina donde arranca éste, no el
 * mes pasado completo. Comparar veintiún días contra treinta y uno hace que
 * todo parezca un derrumbe el día 21 de cada mes.
 */
export function rangoDelPeriodo(input: {
  desde?: unknown;
  hasta?: unknown;
  hoyKey: string;
  timezone: string;
}): Rango {
  const hastaKey = diaValido(input.hasta) ?? input.hoyKey;
  const pedido = diaValido(input.desde);
  // Sin fecha de inicio, el mes de la fecha final: "¿cómo venimos?" se
  // pregunta sobre el mes en curso.
  const desdeKey = pedido && pedido <= hastaKey ? pedido : monthStartKey(hastaKey);

  const desde = startOfDayInZone(desdeKey, input.timezone);
  const hasta = startOfDayInZone(shiftDayKey(hastaKey, 1), input.timezone);

  const largo = hasta.getTime() - desde.getTime();
  const previoDesde = new Date(desde.getTime() - largo);

  return {
    desdeKey,
    hastaKey,
    desde,
    hasta,
    previoDesde,
    // El tramo previo se nombra en días para que el modelo pueda decir contra
    // qué está comparando sin tener que interpretar una fecha con hora.
    previoDesdeKey: shiftDayKey(desdeKey, -diasDe(largo)),
    previoHastaKey: shiftDayKey(desdeKey, -1),
  };
}

/**
 * Acepta sólo AAAA-MM-DD.
 *
 * El modelo manda fechas, y a veces manda "la semana pasada", "2024-13-45" o
 * un mes en inglés. Cualquier cosa que no sea una fecha real se descarta y la
 * herramienta cae en su valor por defecto, que es mejor que consultar un rango
 * inventado y devolver números de un período que nadie pidió.
 */
export function diaValido(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;

  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  // `new Date("2025-02-30")` no falla: rueda al 2 de marzo. Comparar contra lo
  // que se pidió es lo único que descarta un día que no existe.
  return fecha.toISOString().slice(0, 10) === valor ? valor : null;
}

/** Los días que abarca un lapso, redondeando al alza el cambio de hora. */
function diasDe(milisegundos: number): number {
  return Math.max(1, Math.round(milisegundos / 86_400_000));
}
