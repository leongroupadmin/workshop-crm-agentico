import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { safeTimeZone } from "@/lib/fechas";
import { sendPushToUsers } from "@/lib/push-notifications";
import { textoDeVencimiento } from "@/lib/tareas";

/**
 * Un aviso que salió más tarde que esto ya no se manda.
 *
 * Pasa cuando el reloj estuvo parado: al volver encuentra todos los avisos de
 * la mañana juntos, y una ráfaga de "llamá a Juan a las 9" a las 18 no ayuda a
 * nadie. Se marcan como salidos igual, para no volver a mirarlos.
 */
const ATRASO_MAXIMO_MS = 6 * 60 * 60 * 1000;

const URL_DE_TAREAS = "/?vista=tareas";

type FilaParaAvisar = {
  id: string;
  workspace_id: string;
  titulo: string;
  vence_at: string;
  aviso_at: string | null;
  asignada_a: string | null;
  contact_id: string | null;
};

/** Las zonas de varios workspaces de una sola consulta. */
async function zonasDe(
  supabase: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, string>> {
  if (workspaceIds.length === 0) return new Map();
  const { data } = await supabase.from("workspaces").select("id, timezone").in("id", workspaceIds);
  return new Map(
    (data ?? []).map((row) => [String(row.id), safeTimeZone(row.timezone as string | undefined)]),
  );
}

/** Los nombres de los leads de las tareas, de una sola consulta. */
async function nombresDe(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();
  const { data } = await supabase.from("contacts").select("id, name").in("id", contactIds);
  return new Map(
    (data ?? [])
      .filter((row) => typeof row.name === "string" && row.name.trim())
      .map((row) => [String(row.id), String(row.name)]),
  );
}

const recortar = (texto: string, largo: number) =>
  texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto;

/**
 * Manda los avisos de las tareas que llegaron a su hora.
 *
 * Primero se reservan y después se avisa: el `update` marca `avisada_at` sólo
 * en las que todavía no la tenían y devuelve esas. Dos vueltas del reloj que se
 * pisen se reparten las tareas en vez de avisar dos veces cada una, que es la
 * misma idea que la reserva de las corridas de automatizaciones.
 *
 * Si la tabla no existe todavía —falta correr la migración— devuelve ceros y
 * deja seguir al resto del reloj.
 */
export async function avisarTareasVencidas(
  supabase: SupabaseClient,
  ahora: Date = new Date(),
): Promise<{ avisadas: number; atrasadas: number }> {
  const { data, error } = await supabase
    .from("tareas")
    .update({ avisada_at: ahora.toISOString() })
    .eq("estado", "pendiente")
    .is("avisada_at", null)
    .not("aviso_at", "is", null)
    .lte("aviso_at", ahora.toISOString())
    .select("id, workspace_id, titulo, vence_at, aviso_at, asignada_a, contact_id");

  if (error) {
    console.error("[tareas] no se pudieron reservar los avisos:", error.message);
    return { avisadas: 0, atrasadas: 0 };
  }

  const filas = (data ?? []) as FilaParaAvisar[];
  const aTiempo = filas.filter(
    (fila) =>
      fila.asignada_a &&
      fila.aviso_at &&
      ahora.getTime() - new Date(fila.aviso_at).getTime() <= ATRASO_MAXIMO_MS,
  );

  const [zonas, nombres] = await Promise.all([
    zonasDe(supabase, [...new Set(aTiempo.map((fila) => fila.workspace_id))]),
    nombresDe(supabase, [
      ...new Set(aTiempo.map((fila) => fila.contact_id).filter((id): id is string => !!id)),
    ]),
  ]);

  await Promise.all(
    aTiempo.map((fila) => {
      const zona = zonas.get(fila.workspace_id) ?? safeTimeZone(null);
      const cuando = textoDeVencimiento(fila.vence_at, ahora, zona);
      const lead = fila.contact_id ? nombres.get(fila.contact_id) : undefined;

      return sendPushToUsers(supabase, {
        workspaceId: fila.workspace_id,
        userIds: [fila.asignada_a as string],
        aviso: {
          title: recortar(fila.titulo, 80),
          body: lead ? `${cuando} · ${lead}` : cuando,
          // La tarea y no la persona: si se reprograma, el aviso nuevo pisa al
          // viejo en vez de apilarse.
          tag: `tarea-${fila.id}`,
          url: URL_DE_TAREAS,
        },
      });
    }),
  );

  return { avisadas: aTiempo.length, atrasadas: filas.length - aTiempo.length };
}

/**
 * Avisa a quien recibió una tarea que le pasó otra persona.
 *
 * Sale en el momento, no a la hora de la tarea: enterarse de que te dieron
 * algo para mañana a las 9 recién mañana a las 9 es enterarse tarde.
 */
export async function avisarTareaAsignada(
  supabase: SupabaseClient,
  input: { workspaceId: string; tareaId: string },
): Promise<void> {
  const { data: tarea, error } = await supabase
    .from("tareas")
    .select("titulo, vence_at, asignada_a, contact_id")
    .eq("id", input.tareaId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (error || !tarea?.asignada_a) {
    if (error) console.error("[tareas] no se pudo leer la tarea asignada:", error.message);
    return;
  }

  const [zonas, nombres] = await Promise.all([
    zonasDe(supabase, [input.workspaceId]),
    nombresDe(supabase, tarea.contact_id ? [String(tarea.contact_id)] : []),
  ]);

  const zona = zonas.get(input.workspaceId) ?? safeTimeZone(null);
  const cuando = textoDeVencimiento(String(tarea.vence_at), new Date(), zona);
  const lead = tarea.contact_id ? nombres.get(String(tarea.contact_id)) : undefined;

  await sendPushToUsers(supabase, {
    workspaceId: input.workspaceId,
    userIds: [String(tarea.asignada_a)],
    aviso: {
      title: "Te pasaron una tarea",
      body: [recortar(String(tarea.titulo), 80), cuando, lead].filter(Boolean).join(" · "),
      tag: `tarea-${input.tareaId}`,
      url: URL_DE_TAREAS,
    },
  });
}
