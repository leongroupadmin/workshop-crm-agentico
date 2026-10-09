import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { esNotaInterna } from "@/lib/marcas-del-agente";
import {
  conversacionParaClasificar,
  instruccionesDeClasificacion,
  interpretarClasificacion,
  MENSAJES_PARA_CLASIFICAR,
  notaDeMovimiento,
  reglasAplicables,
  type Clasificacion,
  type ReglaConNombre,
  type ReglaDeMovimiento,
} from "@/lib/movimientos-del-agente";
import { completeChatServer } from "@/lib/openai-server";

/**
 * El agente mueve la tarjeta, con la base y la API de por medio.
 *
 * Lo que se puede decidir sin ninguna de las dos está en
 * `movimientos-del-agente.ts`. Acá está lo que no: leer las reglas, preguntarle
 * al modelo y escribir la oportunidad.
 *
 * La clasificación es un pedido aparte del que escribe la respuesta. Se paga una
 * entrada más por mensaje contestado —unos 900 tokens contra los 7.000 de la
 * respuesta— y se compra algo que en la misma llamada no se consigue: el modelo
 * con una sola tarea, y un motivo escrito que después explica cada movimiento en
 * el chat. Esa entrada se paga sólo cuando puede pasar algo: un lead sin tarjeta,
 * o en una columna sin reglas, no cuesta un token.
 */

type Supabase = SupabaseClient;

/** Dónde está la tarjeta del lead, y en qué embudo. */
type Tarjeta = { id: string; stageId: string; pipelineId: string | null };

/**
 * Mueve la tarjeta si alguna regla del agente se cumple.
 *
 * Nunca tira: es lo último de la corrida, después de que el mensaje ya salió, y
 * una falla acá no tiene por qué ensuciar una respuesta que la persona recibió
 * bien. Todo lo que puede ir mal termina en el log.
 */
export async function moverSiCorresponde(input: {
  supabase: Supabase;
  workspaceId: string;
  configId: string;
  contactId: string;
  conversationId: string;
  model: string;
}): Promise<void> {
  try {
    const tarjeta = await tarjetaDelLead(input.supabase, input.workspaceId, input.contactId);

    // Sin tarjeta no hay nada que mover. Es el caso del que reservó por Calendar
    // y todavía no entró al embudo: se va antes de gastar en leer las reglas.
    if (!tarjeta) return;

    const aplicables = await reglasParaClasificar(input.supabase, {
      workspaceId: input.workspaceId,
      configId: input.configId,
      tarjeta,
    });

    if (aplicables.length === 0) return;

    const mensajes = await ultimosMensajes(input.supabase, input.conversationId);
    if (mensajes.length === 0) return;

    const decidido = await clasificar({ model: input.model, reglas: aplicables, mensajes });

    if (!decidido.ok) {
      console.error("[ia] no se pudo clasificar el movimiento:", decidido.error);
      return;
    }
    if (!decidido.clasificacion) {
      console.log("[ia] ninguna regla de movimiento se cumple");
      return;
    }

    await aplicarMovimiento(input.supabase, {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      tarjeta,
      clasificacion: decidido.clasificacion,
    });
  } catch (error) {
    console.error("[ia] error inesperado al mover de columna:", error);
  }
}

/**
 * Las reglas del agente, con el nombre de la columna que el modelo va a leer.
 *
 * Exportada porque la usan los dos caminos: la corrida real y la prueba en seco
 * del panel. Que sean la misma función es lo que hace que la prueba valga: si
 * una armara la lista distinto, probar no diría nada de lo que va a pasar.
 */
export async function reglasParaClasificar(
  supabase: Supabase,
  input: { workspaceId: string; configId: string; tarjeta: Tarjeta },
): Promise<ReglaConNombre[]> {
  const reglas = await leerReglas(supabase, input.workspaceId, input.configId);
  const aplicables = reglasAplicables(reglas, input.tarjeta.stageId);
  if (aplicables.length === 0) return [];

  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, pipeline_id")
    .eq("workspace_id", input.workspaceId)
    .in(
      "id",
      aplicables.map((regla) => regla.stageId),
    );

  if (error) {
    console.error("[ia] no se pudieron leer los nombres de las columnas:", error.message);
    return [];
  }

  const columnas = new Map(
    ((data ?? []) as { id: string; name: string; pipeline_id: string | null }[]).map((fila) => [
      fila.id,
      fila,
    ]),
  );

  return aplicables.flatMap((regla) => {
    const columna = columnas.get(regla.stageId);

    // La etapa borrada no se ofrece. Es el lado seguro: la regla deja de disparar
    // en vez de apuntar a una columna que ya no está.
    if (!columna) return [];

    // Mover entre embudos no es mover: es sacar la tarjeta de un tablero y
    // ponerla en otro. El trigger de la base ya lo impide cuando la regla declara
    // su columna de origen; las reglas "desde cualquiera" se recortan acá, con la
    // tarjeta a la vista.
    if (input.tarjeta.pipelineId && columna.pipeline_id !== input.tarjeta.pipelineId) return [];

    return [{ stageId: regla.stageId, nombre: columna.name, criterio: regla.criterio }];
  });
}

/** Las reglas guardadas de un agente. */
export async function leerReglas(
  supabase: Supabase,
  workspaceId: string,
  configId: string,
): Promise<ReglaDeMovimiento[]> {
  const { data, error } = await supabase
    .from("ai_agent_stage_moves")
    .select("id, stage_id, desde_stage_id, criterio, activo")
    .eq("workspace_id", workspaceId)
    .eq("config_id", configId)
    .order("created_at", { ascending: true });

  // Sin la migración corrida la tabla no existe: cero reglas, y el agente se
  // comporta exactamente como antes de que esto existiera. Es lo que permite
  // desplegar el código sin esperar a que alguien pegue el SQL.
  if (error) {
    console.error("[ia] sin la tabla de movimientos, el agente no mueve tarjetas:", error.message);
    return [];
  }

  return ((data ?? []) as Fila[]).map((fila) => ({
    id: fila.id,
    stageId: fila.stage_id,
    desdeStageId: fila.desde_stage_id ?? null,
    criterio: fila.criterio,
    activo: fila.activo !== false,
  }));
}

type Fila = {
  id: string;
  stage_id: string;
  desde_stage_id: string | null;
  criterio: string;
  activo: boolean | null;
};

/** Dónde está la tarjeta del lead. Null si no tiene ninguna. */
export async function tarjetaDelLead(
  supabase: Supabase,
  workspaceId: string,
  contactId: string,
): Promise<Tarjeta | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, stage_id, pipeline_id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();

  const fila = data as { id?: string; stage_id?: string; pipeline_id?: string | null } | null;
  if (!fila?.id || !fila.stage_id) return null;

  // `opportunities.pipeline_id` puede venir null en filas viejas: ahí el embudo
  // se deduce de la columna, que es lo único que siempre está.
  const pipelineId = fila.pipeline_id ?? (await embudoDeLaEtapa(supabase, fila.stage_id));

  return { id: fila.id, stageId: fila.stage_id, pipelineId };
}

async function embudoDeLaEtapa(supabase: Supabase, stageId: string): Promise<string | null> {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("id", stageId)
    .maybeSingle();

  return (data as { pipeline_id?: string | null } | null)?.pipeline_id ?? null;
}

/** El resultado de preguntarle al modelo, con el error a la vista para el panel. */
export type Decision =
  | { ok: true; clasificacion: Clasificacion | null }
  | { ok: false; error: string };

/**
 * Le pregunta al modelo si alguna regla se cumple.
 *
 * No escribe nada: devuelve la decisión. Por eso la usan igual la corrida real y
 * la prueba en seco del panel, que es donde se ajusta un criterio sin esperar a
 * que pase con leads de verdad.
 */
export async function clasificar(input: {
  model: string;
  reglas: ReglaConNombre[];
  mensajes: { deLaPersona: boolean; texto: string }[];
}): Promise<Decision> {
  if (input.reglas.length === 0) return { ok: true, clasificacion: null };

  const completion = await completeChatServer({
    model: input.model,
    messages: [
      { role: "system", content: instruccionesDeClasificacion(input.reglas) },
      { role: "user", content: conversacionParaClasificar(input.mensajes) },
    ],
  });

  if (!completion.ok) return { ok: false, error: completion.error };

  return { ok: true, clasificacion: interpretarClasificacion(completion.text, input.reglas) };
}

/** Los últimos mensajes del hilo, en orden y sin las notas del sistema. */
export async function ultimosMensajes(
  supabase: Supabase,
  conversationId: string,
): Promise<{ deLaPersona: boolean; texto: string }[]> {
  const { data } = await supabase
    .from("messages")
    .select("sender_type, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    // Se piden algunos más de los que se usan: las notas internas que se
    // descartan abajo no tienen por qué comerse lugares de la ventana.
    .limit(MENSAJES_PARA_CLASIFICAR * 2);

  return ((data ?? []) as { sender_type: string; content: unknown }[])
    .reverse()
    .filter(
      (fila): fila is { sender_type: string; content: string } =>
        typeof fila.content === "string" && Boolean(fila.content.trim()) && !esNotaInterna(fila.content),
    )
    .map((fila) => ({ deLaPersona: fila.sender_type === "contact", texto: fila.content }))
    .slice(-MENSAJES_PARA_CLASIFICAR);
}

/** Escribe el movimiento: la tarjeta, la nota en el hilo y lo que la columna dispare. */
async function aplicarMovimiento(
  supabase: Supabase,
  input: {
    workspaceId: string;
    contactId: string;
    conversationId: string;
    tarjeta: Tarjeta;
    clasificacion: Clasificacion;
  },
): Promise<void> {
  // El `eq("stage_id")` es lo que hace que esto sea seguro: entre que se le
  // preguntó al modelo y ahora pasaron segundos, y en esos segundos un vendedor
  // puede haber arrastrado la tarjeta a otra columna. Sin esa condición, el
  // agente le pisaría la decisión con una que tomó mirando otro tablero.
  const { data: movida, error } = await supabase
    .from("opportunities")
    .update({ stage_id: input.clasificacion.stageId })
    .eq("id", input.tarjeta.id)
    .eq("workspace_id", input.workspaceId)
    .eq("stage_id", input.tarjeta.stageId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[ia] no se pudo mover la tarjeta:", error.message);
    return;
  }
  if (!movida) {
    console.log("[ia] la tarjeta se movió por otro lado mientras se clasificaba: no se toca");
    return;
  }

  // La nota deja en el hilo por qué la tarjeta cambió de columna.
  const { error: errorDeNota } = await supabase.from("messages").insert({
    conversation_id: input.conversationId,
    sender_type: "ai",
    content: notaDeMovimiento(input.clasificacion.nombre, input.clasificacion.motivo),
  });

  if (errorDeNota) {
    console.error("[ia] no se pudo dejar la nota del movimiento:", errorDeNota.message);
  }

  console.log(`[ia] movió la tarjeta a ${input.clasificacion.nombre}`);
}
