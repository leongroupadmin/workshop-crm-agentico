/**
 * Formato y comparación de las métricas del Resumen.
 *
 * Vive aparte de `crm-data.ts` porque aquello es `server-only` —abre la
 * conexión a Supabase— y esto son funciones puras que también necesita el
 * navegador para pintar las tarjetas. De paso quedan probables sin base:
 * `pruebas/metricas.test.mts`.
 */

/** Cómo le fue a una métrica contra el mismo tramo del mes pasado. */
export type Trend = {
  /** "+18%", "-9%" o "sin cambios". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Si el movimiento es bueno para el negocio. Es lo que decide el color. */
  good: boolean;
};

/**
 * Variación contra el período anterior.
 *
 * `subirEsBueno` existe porque no todas las flechas para arriba son verdes: más
 * leads es una buena noticia y más demora en contestar es exactamente la
 * contraria.
 *
 * Devuelve `undefined` cuando no hay nada que comparar —los dos períodos en
 * cero—: una tarjeta sin dato es más honesta que un "0%" que parece una medición.
 */
export function variacion(
  actual: number,
  previo: number,
  subirEsBueno: boolean,
): Trend | undefined {
  if (!Number.isFinite(actual) || !Number.isFinite(previo)) return undefined;
  if (actual === 0 && previo === 0) return undefined;

  // Sin período anterior no hay porcentaje posible: dividir por cero da
  // infinito y "+∞%" no le dice nada a nadie.
  if (previo === 0) {
    return { text: "sin base previa", direction: "flat", good: subirEsBueno };
  }

  const porcentaje = ((actual - previo) / Math.abs(previo)) * 100;

  // Menos de un punto es ruido: redondeado se vería "+0%", que se lee como un
  // error de la pantalla y no como "quedó igual".
  if (Math.abs(porcentaje) < 1) {
    return { text: "sin cambios", direction: "flat", good: true };
  }

  const direction = porcentaje > 0 ? "up" : "down";
  const redondeado = Math.round(Math.abs(porcentaje));

  return {
    // Arriba de diez veces el número deja de aportar y sólo desarma la tarjeta.
    text: `${porcentaje > 0 ? "+" : "−"}${redondeado > 999 ? "999+" : redondeado}%`,
    direction,
    good: direction === "up" ? subirEsBueno : !subirEsBueno,
  };
}

/**
 * Segundos → la unidad en la que uno lo diría en voz alta.
 *
 * Un lapso de réplica puede ir de veinte segundos a tres días, y ninguna unidad
 * fija sirve para las dos puntas: "0,3 min" y "4320 min" son igual de ilegibles.
 */
export function formatearDuracion(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "—";

  const total = Math.round(segundos);
  if (total < 60) return `${total} s`;

  const minutos = Math.round(total / 60);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(total / 3600);
  if (horas < 24) {
    const resto = Math.round((total % 3600) / 60);
    return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
  }

  const dias = Math.floor(total / 86400);
  const restoHoras = Math.floor((total % 86400) / 3600);
  return restoHoras > 0 ? `${dias} d ${restoHoras} h` : `${dias} d`;
}

/**
 * Dinero corto, para que entre en la tarjeta.
 *
 * Antes cortaba en miles y nada más, así que un embudo de un millón y medio se
 * mostraba como "1500.0k". Arriba del millón la unidad tiene que cambiar.
 */
export function dineroCompacto(monto: number): string {
  const valor = Number.isFinite(monto) ? monto : 0;
  const signo = valor < 0 ? "-" : "";
  const absoluto = Math.abs(valor);

  if (absoluto >= 1_000_000) return `${signo}US$ ${(absoluto / 1_000_000).toFixed(1)}M`;
  if (absoluto >= 1000) return `${signo}US$ ${(absoluto / 1000).toFixed(1)}k`;
  return `${signo}US$ ${absoluto.toFixed(0)}`;
}
