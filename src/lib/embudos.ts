import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dónde cae un lead nuevo.
 *
 * Con varios embudos hay que elegir uno, y la regla es la misma que adentro de
 * cada embudo: lo que está primero es la entrada. Así hay una sola convención
 * que recordar, en vez de una marca "principal" que alguien tiene que sostener.
 *
 * `created_at` desempata porque la posición no es única: sin un segundo
 * criterio, dos embudos en la misma posición harían que los leads cayeran hoy
 * en uno y mañana en el otro, sin que nadie hubiera tocado nada.
 *
 * Devuelve null si el workspace no tiene embudos o el embudo no tiene columnas.
 * Quien llama decide qué hacer con eso: al lead se lo crea igual, sin tarjeta,
 * antes que perder el mensaje que lo trajo.
 */
export async function etapaDeEntrada(
  supabase: SupabaseClient,
  workspaceId: string,
  pipelineId?: string,
): Promise<string | null> {
  let embudo = pipelineId ?? null;

  if (!embudo) {
    const { data } = await supabase
      .from("pipelines")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    embudo = (data?.id as string | undefined) ?? null;
    if (!embudo) return null;
  }

  const { data } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("pipeline_id", embudo)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/**
 * Le da al contacto una oportunidad en el embudo, si todavía no tiene.
 *
 * Un lead que no está en el embudo no existe para el equipo: el tablero es
 * donde se mira quién está pendiente, y uno que no aparece ahí no lo persigue
 * nadie. Por eso entra igual el que escribió por WhatsApp que el que reservó
 * una llamada por Calendar —este último, si algo, más caliente— que el que
 * alguien cargó a mano.
 *
 * Devuelve la etapa en la que quedó, o null si ya tenía una o si no se pudo.
 * Es idempotente: llamarla de nuevo sobre el mismo contacto no crea una
 * segunda, así que puede correr en cada evento sin cuidar de dónde viene.
 */
export async function asegurarOportunidad(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
  log: string,
): Promise<string | null> {
  const { data: existente, error } = await supabase
    .from("opportunities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${log} no se pudo leer opportunities:`, error.message);
    return null;
  }
  if (existente) return null;

  const stageId = await etapaDeEntrada(supabase, workspaceId);
  if (!stageId) {
    console.error(`${log} el workspace no tiene columnas en el embudo`);
    return null;
  }

  const { error: insertError } = await supabase.from("opportunities").insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    stage_id: stageId,
  });

  if (insertError) {
    console.error(`${log} no se pudo crear la oportunidad:`, insertError.message);
    return null;
  }

  return stageId;
}
