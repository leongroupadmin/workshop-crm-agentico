import "server-only";

import { cifrar, descifrar, errorDeLaClave } from "@/lib/cifrado";
import {
  combinar,
  DEFINICIONES,
  INTEGRACIONES,
  leerFormulario,
  vistaDeLosCampos,
  type CampoVisible,
  type Combinadas,
  type Integracion,
} from "@/lib/integraciones";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Las credenciales de los proveedores, ya listas para usar.
 *
 * Todo lo que habla con un proveedor —responder un chat, transcribir un audio,
 * listar plantillas, verificar un webhook— pide acá sus credenciales. No hay
 * otro camino a una API key: lo cargado en Configuración → Conexiones manda, y
 * lo que falta se completa con las variables de entorno.
 *
 * Corre con la service role porque lo usan también los webhooks y el cron, que
 * no tienen sesión. Quien guarda o muestra credenciales desde el panel tiene
 * que haber comprobado antes que hay una sesión válida.
 */

const LOG = "[integraciones]";

/**
 * Cuánto se recuerda lo leído. Un mensaje entrante pide credenciales dos o tres
 * veces —descargar el adjunto, contestar, avisar—, y sin caché serían otras
 * tantas consultas. Un minuto es lo que tarda, en el peor caso, en verse un
 * cambio hecho desde otra instancia del servidor; en la misma, se ve enseguida.
 */
const TTL_MS = 60_000;

type Leida = { combinadas: Combinadas; ilegible: boolean; actualizada: string | null };

const cache = new Map<Integracion, Leida & { vence: number }>();

/** Vacía lo recordado. Lo llaman quienes acaban de cambiar una conexión. */
export function olvidarIntegraciones(): void {
  cache.clear();
}

type FilaDeIntegracion = {
  config: Record<string, unknown> | null;
  secretos: string | null;
  updated_at: string | null;
};

/** Lo guardado de una fila, con los secretos ya descifrados. */
function guardadosDeFila(fila: FilaDeIntegracion | null): {
  guardados: Record<string, string>;
  ilegible: boolean;
} {
  const guardados: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(fila?.config ?? {})) {
    if (typeof valor === "string") guardados[campo] = valor;
  }

  let ilegible = false;
  if (fila?.secretos) {
    const descifrados = descifrar(fila.secretos, process.env.INTEGRATIONS_ENCRYPTION_KEY ?? "");
    if (descifrados) Object.assign(guardados, descifrados);
    else ilegible = true;
  }

  return { guardados, ilegible };
}

/** Lee, descifra y combina con el entorno. Sin decidir todavía qué falta. */
async function leer(integracion: Integracion): Promise<Leida> {
  const recordado = cache.get(integracion);
  if (recordado && recordado.vence > Date.now()) return recordado;

  let fila: FilaDeIntegracion | null = null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("integraciones")
      .select("config, secretos, updated_at")
      .eq("provider", integracion)
      .maybeSingle();

    // Sin la tabla —la migración todavía no se corrió— todo sale del entorno,
    // como antes.
    if (error) console.error(`${LOG} no se pudo leer ${integracion}:`, error.message);
    fila = (data ?? null) as FilaDeIntegracion | null;
  } catch (error) {
    // Sin la service role key no hay base que leer: queda el entorno.
    console.error(`${LOG} sin acceso a la base:`, error instanceof Error ? error.message : error);
  }

  const { guardados, ilegible } = guardadosDeFila(fila);
  const combinadas = combinar({
    definicion: DEFINICIONES[integracion],
    guardados,
    entorno: process.env,
  });

  const resultado = { combinadas, ilegible, actualizada: fila?.updated_at ?? null };
  cache.set(integracion, { ...resultado, vence: Date.now() + TTL_MS });
  return resultado;
}

export type Credenciales =
  | { ok: true; valores: Record<string, string> }
  | { ok: false; error: string };

/**
 * Las credenciales de una integración, exigiendo los campos que hacen falta.
 *
 * Quien llama dice qué campos necesita: para responder alcanza con la API key,
 * para verificar un webhook alcanza con su secreto. Pedir todos haría que un
 * campo opcional para una cosa frene a la otra.
 */
export async function credenciales(
  integracion: Integracion,
  necesarios: string[],
): Promise<Credenciales> {
  const definicion = DEFINICIONES[integracion];
  const { combinadas, ilegible } = await leer(integracion);

  const faltan = necesarios
    .filter((campo) => !combinadas.valores[campo])
    .map((campo) => definicion.campos.find((item) => item.clave === campo)?.etiqueta ?? campo);

  if (faltan.length > 0) {
    if (ilegible) {
      return {
        ok: false,
        error: `Las credenciales guardadas de ${definicion.nombre} no se pueden leer: ¿cambió INTEGRATIONS_ENCRYPTION_KEY? Volvé a cargarlas en Configuración → Conexiones.`,
      };
    }
    return {
      ok: false,
      error: `Falta configurar ${faltan.join(" y ")} de ${definicion.nombre}: cargalo en Configuración → Conexiones.`,
    };
  }

  return { ok: true, valores: combinadas.valores };
}

/** Si una integración tiene cargado lo que necesita, sin decir el valor. */
export async function estaConfigurada(integracion: Integracion, necesarios: string[]): Promise<boolean> {
  return (await credenciales(integracion, necesarios)).ok;
}

/* ------------------------------------------------------------------ el panel */

export type EstadoDeIntegracion = {
  integracion: Integracion;
  campos: CampoVisible[];
  /** Con todos los campos requeridos cargados. */
  configurada: boolean;
  /** Hay secretos guardados que no se pueden descifrar. */
  ilegible: boolean;
  actualizada: string | null;
};

export async function estadoDeLasIntegraciones(): Promise<EstadoDeIntegracion[]> {
  return Promise.all(
    INTEGRACIONES.map(async (integracion) => {
      const { combinadas, ilegible, actualizada } = await leer(integracion);
      return {
        integracion,
        campos: vistaDeLosCampos(DEFINICIONES[integracion], combinadas),
        configurada: combinadas.faltan.length === 0,
        ilegible,
        actualizada,
      };
    }),
  );
}

/** Lo que falta para poder guardar credenciales, o null si se puede. */
export function problemaDeLaClave(): string | null {
  return errorDeLaClave(process.env.INTEGRATIONS_ENCRYPTION_KEY);
}

/** Guarda lo que llegó del panel. Un secreto vacío conserva el anterior. */
export async function guardarIntegracion(input: {
  integracion: Integracion;
  entrada: Record<string, unknown>;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const clave = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  const problema = errorDeLaClave(clave);
  if (problema) return { ok: false, error: problema };

  const supabase = getSupabaseAdmin();
  const { data: previa } = await supabase
    .from("integraciones")
    .select("secretos")
    .eq("provider", input.integracion)
    .maybeSingle();

  // Si los anteriores no se pueden descifrar se descartan: el formulario
  // tiene que volver a traerlos, y el panel lo pide.
  const previos = previa?.secretos ? (descifrar(previa.secretos, clave!) ?? {}) : {};

  const leido = leerFormulario(DEFINICIONES[input.integracion], input.entrada, previos);
  if (!leido.ok) return leido;

  const { error } = await supabase.from("integraciones").upsert(
    {
      provider: input.integracion,
      config: leido.config,
      secretos: Object.keys(leido.secretos).length > 0 ? cifrar(leido.secretos, clave!) : null,
      updated_by: input.userId,
    },
    { onConflict: "provider" },
  );

  olvidarIntegraciones();

  if (error) {
    return {
      ok: false,
      error: /integraciones/.test(error.message)
        ? "Falta correr en Supabase el SQL de las conexiones (202610160001_integraciones.sql)."
        : error.message,
    };
  }
  return { ok: true };
}

export async function borrarIntegracion(
  integracion: Integracion,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabaseAdmin().from("integraciones").delete().eq("provider", integracion);

  olvidarIntegraciones();
  return error ? { ok: false, error: error.message } : { ok: true };
}
