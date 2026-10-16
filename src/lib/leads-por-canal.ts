/**
 * La torta de "Por dónde llegan los leads" del Resumen.
 *
 * Vive aparte de `crm-data.ts` por lo mismo que `metricas.ts`: aquello es
 * `server-only` y esto lo necesita también el navegador para dibujar. De paso
 * queda probable sin base: `pruebas/leads-por-canal.test.mts`.
 *
 * Qué canal le toca a cada lead no se decide acá sino en Postgres —ver
 * `202610080001_leads_por_canal.sql`—, que es el único que puede mirar todos
 * los contactos. Acá sólo se ordena y se reparte el círculo.
 */
import type { Channel } from "@/types/database";

/** Los tres chats, más lo que entra sin chat de por medio. */
export type CanalDeEntrada = Channel | "web" | "manual";

/** Cuántos leads llegaron por un canal: desde siempre y en lo que va del mes. */
export type LeadsDeUnCanal = { canal: CanalDeEntrada; total: number; delMes: number };

export type PeriodoDeLaTorta = "mes" | "historico";

/**
 * El orden de la torta y de la leyenda. Es fijo y no por tamaño: cada canal
 * tiene su color y su lugar, así que de un mes al otro WhatsApp está siempre en
 * el mismo lado y se compara de un vistazo. La carga manual va última porque es
 * el resto: lo que no llegó solo.
 */
export const CANALES_DE_ENTRADA: CanalDeEntrada[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "web",
  "manual",
];

export const ETIQUETAS_DE_ENTRADA: Record<CanalDeEntrada, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  web: "Chat de la web",
  manual: "Carga manual",
};

function esCanalDeEntrada(valor: unknown): valor is CanalDeEntrada {
  return typeof valor === "string" && (CANALES_DE_ENTRADA as string[]).includes(valor);
}

function cantidad(valor: unknown): number {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero) : 0;
}

/**
 * Las filas de `leads_por_canal` como las devuelve la base: `bigint` puede
 * llegar como número o como texto. Un canal que no se conoce se descarta en vez
 * de pintarse sin color ni nombre: si algún día la base suma uno, aparece
 * cuando se lo agregue a la lista de arriba.
 */
export function leerLeadsPorCanal(filas: unknown): LeadsDeUnCanal[] {
  if (!Array.isArray(filas)) return [];

  return filas.flatMap((fila) => {
    const registro = (fila ?? {}) as Record<string, unknown>;
    if (!esCanalDeEntrada(registro.canal)) return [];
    return [
      {
        canal: registro.canal,
        total: cantidad(registro.total),
        delMes: cantidad(registro.del_tramo),
      },
    ];
  });
}

export type Porcion = {
  canal: CanalDeEntrada;
  etiqueta: string;
  cantidad: number;
  /** Entero. Entre todas las porciones suman 100 justo. */
  porcentaje: number;
  /** Dónde empieza y dónde termina en la vuelta, de 0 a 1, desde las doce. */
  desde: number;
  hasta: number;
};

/**
 * Los porcentajes, enteros y que sumen 100.
 *
 * Redondear cada uno por su lado da 33 + 33 + 33 = 99 con tres canales
 * parejos, y una leyenda que no suma cien parece un error de cuentas. Se
 * redondea todo para abajo y los puntos que faltan van a los que más perdieron
 * en el redondeo.
 */
function porcentajesEnteros(cantidades: number[], total: number): number[] {
  const exactos = cantidades.map((valor) => (valor / total) * 100);
  const enteros = exactos.map(Math.floor);
  const faltan = 100 - enteros.reduce((suma, valor) => suma + valor, 0);

  const porResto = exactos
    .map((valor, indice) => ({ indice, resto: valor - Math.floor(valor) }))
    .sort((a, b) => b.resto - a.resto || a.indice - b.indice);

  for (let i = 0; i < faltan; i += 1) enteros[porResto[i].indice] += 1;
  return enteros;
}

/**
 * Las porciones del período elegido, en el orden fijo de los canales.
 *
 * Los canales en cero no tienen porción: una tajada de ancho nulo no se ve en
 * la torta y en la leyenda sólo sería ruido para quien no usa ese canal.
 */
export function porcionesDeLaTorta(
  filas: LeadsDeUnCanal[],
  periodo: PeriodoDeLaTorta,
): { total: number; porciones: Porcion[] } {
  const porCanal = new Map<CanalDeEntrada, number>();
  for (const fila of filas) {
    const valor = periodo === "mes" ? fila.delMes : fila.total;
    porCanal.set(fila.canal, (porCanal.get(fila.canal) ?? 0) + valor);
  }

  const presentes = CANALES_DE_ENTRADA.filter((canal) => (porCanal.get(canal) ?? 0) > 0);
  const cantidades = presentes.map((canal) => porCanal.get(canal) ?? 0);
  const total = cantidades.reduce((suma, valor) => suma + valor, 0);
  if (total === 0) return { total: 0, porciones: [] };

  const porcentajes = porcentajesEnteros(cantidades, total);

  let acumulado = 0;
  const porciones = presentes.map((canal, indice) => {
    const desde = acumulado / total;
    acumulado += cantidades[indice];
    return {
      canal,
      etiqueta: ETIQUETAS_DE_ENTRADA[canal],
      cantidad: cantidades[indice],
      porcentaje: porcentajes[indice],
      desde,
      // La última cierra en 1 exacto: sumar fracciones deja 0.9999… y un hilo
      // sin pintar a las doce.
      hasta: indice === presentes.length - 1 ? 1 : acumulado / total,
    };
  });

  return { total, porciones };
}

/** Dos decimales: alcanza para el SVG y el servidor y el navegador escriben lo mismo. */
const redondear = (valor: number) => Math.round(valor * 100) / 100;

/** Un punto de la vuelta, en un círculo de radio `radio` con centro en (radio, radio). */
export function puntoDeLaVuelta(fraccion: number, radio: number, distancia = radio) {
  // Se arranca a las doce y se gira como el reloj: es como se lee una torta.
  const angulo = fraccion * 2 * Math.PI - Math.PI / 2;
  return {
    x: redondear(radio + distancia * Math.cos(angulo)),
    y: redondear(radio + distancia * Math.sin(angulo)),
  };
}

/**
 * El `d` de una tajada. No sirve para una sola porción del 100%: un arco que
 * empieza y termina en el mismo punto no dibuja nada, y ese caso es un círculo.
 */
export function caminoDePorcion(desde: number, hasta: number, radio: number): string {
  const inicio = puntoDeLaVuelta(desde, radio);
  const fin = puntoDeLaVuelta(hasta, radio);
  const arcoLargo = hasta - desde > 0.5 ? 1 : 0;
  return `M ${radio} ${radio} L ${inicio.x} ${inicio.y} A ${radio} ${radio} 0 ${arcoLargo} 1 ${fin.x} ${fin.y} Z`;
}
