import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { reemplazarTokens } from "@/lib/automatizaciones";
import { abrirConversacion, numeroPropio } from "@/lib/conversacion-whatsapp";
import { formatoDe, normalizarTelefono } from "@/lib/difusiones";
import { enviarPlantilla } from "@/lib/mensajeria";
import { componentesParaEnviar, vistaPrevia, type Plantilla, type Valores } from "@/lib/plantillas";
import { listYcloudTemplates } from "@/lib/ycloud-api";

/**
 * El despachador de las difusiones.
 *
 * Nadie le escribe a trescientas personas dentro de una request: no entra en el
 * tiempo y, si se corta a la mitad, no queda registro de por dónde iba. Por eso
 * la difusión sólo deja filas en `broadcast_recipients` y este módulo las va
 * mandando de a tandas, llamado por el cron y también apenas se crea, para que
 * las primeras salgan en el momento.
 *
 * Los envíos van de a uno y no en paralelo a propósito: del otro lado hay un
 * número de WhatsApp con reputación, y una ráfaga es exactamente lo que Meta
 * mira para bajarle la calificación.
 */

type Supabase = SupabaseClient;

/** Cuántos destinatarios se atienden por vuelta. */
const POR_VUELTA = 60;

export type Balance = { enviados: number; fallados: number };

type FilaDestinatario = {
  id: string;
  broadcast_id: string;
  workspace_id: string;
  contact_id: string;
  phone: string;
};

type FilaDifusion = {
  id: string;
  workspace_id: string;
  template_name: string;
  template_language: string;
  valores: unknown;
};

/**
 * Manda lo que haya pendiente.
 *
 * Devuelve el balance de la vuelta. No lanza: un destinatario que falla queda
 * anotado con el motivo en su fila y la vuelta sigue con el siguiente, porque
 * un número mal cargado no puede frenar la difusión entera.
 */
export async function enviarPendientes(supabase: Supabase, limite = POR_VUELTA): Promise<Balance> {
  const destinatarios = await reclamar(supabase, limite);
  if (destinatarios.length === 0) return { enviados: 0, fallados: 0 };

  const difusiones = await difusionesDe(supabase, destinatarios);
  const contactos = await contactosDe(supabase, destinatarios);
  const etapas = await etapasDe(supabase, destinatarios);
  const conversaciones = await conversacionesDe(supabase, destinatarios);
  const plantillas = await plantillasAprobadas();
  const numeros = new Map<string, string | null>();

  const balance: Balance = { enviados: 0, fallados: 0 };

  for (const destinatario of destinatarios) {
    const resultado = await despachar(supabase, {
      destinatario,
      difusion: difusiones.get(destinatario.broadcast_id) ?? null,
      contacto: contactos.get(destinatario.contact_id) ?? null,
      etapa: etapas.get(destinatario.contact_id) ?? null,
      conversacion: conversaciones.get(destinatario.contact_id) ?? null,
      plantillas,
      numeros,
    });

    if (resultado.ok) balance.enviados += 1;
    else balance.fallados += 1;
  }

  return balance;
}

/**
 * Se queda con las filas antes de tocarlas.
 *
 * El cron puede solaparse con el envío que dispara la creación de la difusión.
 * Pasar por 'enviando' es lo que evita que los dos manden el mismo mensaje: el
 * `update` sólo agarra las que siguen en 'pendiente', y Postgres resuelve el
 * empate cuando dos vueltas apuntan a la misma fila.
 */
async function reclamar(supabase: Supabase, limite: number): Promise<FilaDestinatario[]> {
  await rescatarTrabadas(supabase);

  const { data: candidatas, error } = await supabase
    .from("broadcast_recipients")
    .select("id")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(limite);

  if (error) {
    console.error("[difusiones] no se pudieron leer los pendientes:", error.message);
    return [];
  }

  const ids = (candidatas ?? []).map((fila) => fila.id as string);
  if (ids.length === 0) return [];

  const { data, error: errorClaim } = await supabase
    .from("broadcast_recipients")
    .update({ estado: "enviando", claimed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("estado", "pendiente")
    .select("id, broadcast_id, workspace_id, contact_id, phone");

  if (errorClaim) {
    console.error("[difusiones] no se pudieron reservar los pendientes:", errorClaim.message);
    return [];
  }

  return (data ?? []) as FilaDestinatario[];
}

/**
 * Devuelve a la cola lo que quedó reservado y nunca salió.
 *
 * Una vuelta puede morirse en el medio —la función se queda sin tiempo, el
 * proceso se cae— y esas filas quedarían en 'enviando' para siempre: ni
 * enviadas, ni falladas, ni a la vista. Como una vuelta entera tiene un minuto
 * de techo, algo reservado hace un cuarto de hora es una vuelta que no terminó.
 */
async function rescatarTrabadas(supabase: Supabase): Promise<void> {
  const limite = new Date(Date.now() - 15 * 60_000).toISOString();

  const { error } = await supabase
    .from("broadcast_recipients")
    .update({ estado: "pendiente", claimed_at: null })
    .eq("estado", "enviando")
    .lt("claimed_at", limite);

  if (error) console.error("[difusiones] no se pudieron rescatar las trabadas:", error.message);
}

async function difusionesDe(
  supabase: Supabase,
  destinatarios: FilaDestinatario[],
): Promise<Map<string, FilaDifusion>> {
  const ids = [...new Set(destinatarios.map((fila) => fila.broadcast_id))];
  const { data } = await supabase
    .from("broadcasts")
    .select("id, workspace_id, template_name, template_language, valores")
    .in("id", ids);

  return new Map((data ?? []).map((fila) => [fila.id as string, fila as FilaDifusion]));
}

type Contacto = { name: string; phone: string | null; email: string | null };

async function contactosDe(
  supabase: Supabase,
  destinatarios: FilaDestinatario[],
): Promise<Map<string, Contacto>> {
  const ids = [...new Set(destinatarios.map((fila) => fila.contact_id))];
  const { data } = await supabase.from("contacts").select("id, name, phone, email").in("id", ids);

  return new Map(
    (data ?? []).map((fila) => [
      fila.id as string,
      { name: fila.name as string, phone: fila.phone, email: fila.email },
    ]),
  );
}

/** La columna del embudo de cada contacto, para el token {etapa}. */
async function etapasDe(
  supabase: Supabase,
  destinatarios: FilaDestinatario[],
): Promise<Map<string, string>> {
  const ids = [...new Set(destinatarios.map((fila) => fila.contact_id))];
  const { data } = await supabase
    .from("opportunities")
    .select("contact_id, pipeline_stages(name)")
    .in("contact_id", ids);

  const etapas = new Map<string, string>();
  for (const fila of data ?? []) {
    const relacion = (fila as { pipeline_stages?: unknown }).pipeline_stages;
    const registro = Array.isArray(relacion) ? relacion[0] : relacion;
    const nombre = (registro as { name?: string } | null)?.name;
    if (nombre && !etapas.has(fila.contact_id as string)) {
      etapas.set(fila.contact_id as string, nombre);
    }
  }
  return etapas;
}

type Conversacion = {
  id: string;
  zernio_chat_id: string;
  zernio_account_id: string | null;
  provider: string | null;
};

/** La charla de WhatsApp que ya tiene cada contacto, si tiene alguna. */
async function conversacionesDe(
  supabase: Supabase,
  destinatarios: FilaDestinatario[],
): Promise<Map<string, Conversacion>> {
  const ids = [...new Set(destinatarios.map((fila) => fila.contact_id))];
  const { data } = await supabase
    .from("conversations")
    .select("id, contact_id, zernio_chat_id, zernio_account_id, provider, updated_at")
    .in("contact_id", ids)
    .eq("provider", "ycloud")
    .order("updated_at", { ascending: false });

  const charlas = new Map<string, Conversacion>();
  for (const fila of data ?? []) {
    // Vienen de la más nueva a la más vieja: la primera de cada contacto es la
    // que está en uso.
    if (!charlas.has(fila.contact_id as string)) {
      charlas.set(fila.contact_id as string, fila as unknown as Conversacion);
    }
  }
  return charlas;
}

async function plantillasAprobadas(): Promise<Plantilla[]> {
  const listado = await listYcloudTemplates();
  if (!listado.ok) {
    console.error("[difusiones] no se pudieron leer las plantillas:", listado.error);
    return [];
  }
  return listado.plantillas.filter((p) => p.estado === "APPROVED");
}

type Contexto = {
  destinatario: FilaDestinatario;
  difusion: FilaDifusion | null;
  contacto: Contacto | null;
  etapa: string | null;
  conversacion: Conversacion | null;
  plantillas: Plantilla[];
  numeros: Map<string, string | null>;
};

async function despachar(supabase: Supabase, contexto: Contexto): Promise<{ ok: boolean }> {
  const { destinatario, difusion, contacto } = contexto;

  if (!difusion) return fallar(supabase, destinatario, "La difusión ya no existe.");

  const plantilla = contexto.plantillas.find(
    (p) => p.nombre === difusion.template_name && p.idioma === difusion.template_language,
  );
  if (!plantilla) {
    return fallar(
      supabase,
      destinatario,
      `La plantilla "${difusion.template_name}" ya no está aprobada.`,
    );
  }

  if (!contexto.numeros.has(destinatario.workspace_id)) {
    contexto.numeros.set(
      destinatario.workspace_id,
      await numeroPropio(supabase, destinatario.workspace_id),
    );
  }
  const propio = contexto.numeros.get(destinatario.workspace_id) ?? null;
  if (!propio) {
    return fallar(
      supabase,
      destinatario,
      "No hay número de WhatsApp propio: esperá a que entre un mensaje o cargá YCLOUD_PHONE_NUMBER.",
    );
  }

  // La conversación existente manda: su `zernio_chat_id` es el número tal como
  // lo escribe YCloud, y copiarlo es lo que mantiene el chat en una sola pieza.
  const telefono =
    contexto.conversacion?.zernio_chat_id ??
    normalizarTelefono(destinatario.phone, formatoDe(propio));

  if (!telefono) {
    return fallar(supabase, destinatario, "El teléfono del contacto no es un número válido.");
  }

  const valores = valoresParaElContacto(difusion.valores, {
    nombre: contacto?.name ?? "",
    telefono: contacto?.phone ?? destinatario.phone,
    email: contacto?.email ?? null,
    etapa: contexto.etapa,
  });

  const salio = await enviarPlantilla({
    provider: "ycloud",
    conversationId: telefono,
    accountId: contexto.conversacion?.zernio_account_id ?? propio,
    nombre: plantilla.nombre,
    idioma: plantilla.idioma,
    components: componentesParaEnviar(plantilla, valores),
  });

  if (!salio.ok) {
    console.error("[difusiones] no salió la plantilla:", salio.error);
    return fallar(supabase, destinatario, salio.error, contexto.conversacion?.id ?? null);
  }

  // La conversación se abre recién ahora, con el mensaje ya entregado: si se
  // abriera antes, cada número mal cargado dejaría un chat vacío en la bandeja
  // de alguien a quien nunca le llegó nada.
  const conversacionId =
    contexto.conversacion?.id ??
    (await abrirConversacion(supabase, {
      workspaceId: destinatario.workspace_id,
      contactId: destinatario.contact_id,
      provider: "ycloud",
      chatId: telefono,
      accountId: contexto.conversacion?.zernio_account_id ?? propio,
    }));

  // El historial es lo que hace que la difusión no sea un envío a ciegas: quien
  // abre el chat después ve el mensaje que salió, y si el contacto contesta la
  // respuesta cuelga de la misma conversación.
  if (conversacionId) {
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversacionId,
      sender_type: "user",
      content: vistaPrevia(plantilla, valores),
      zernio_message_id: salio.messageId ?? null,
    });
    if (error) console.error("[difusiones] el mensaje salió pero no se guardó:", error.message);
  }

  await supabase
    .from("broadcast_recipients")
    .update({
      estado: "enviado",
      detalle: null,
      conversation_id: conversacionId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", destinatario.id);

  return { ok: true };
}

/**
 * Reemplaza {nombre}, {telefono}, {email} y {etapa} en cada hueco.
 *
 * Un hueco sin dato queda escrito tal cual y no se borra: una variable de
 * plantilla vacía hace que Meta rechace el envío, así que el contacto sin email
 * recibiría nada en vez de un mensaje con un `{email}` a la vista. En el texto
 * libre de las automatizaciones la decisión es la contraria; ver
 * `reemplazarTokens`.
 */
function valoresParaElContacto(
  guardados: unknown,
  datos: { nombre: string; telefono: string | null; email: string | null; etapa: string | null },
): Valores {
  const origen = (guardados ?? {}) as Record<string, unknown>;
  const valores: Valores = {};

  for (const [clave, valor] of Object.entries(origen)) {
    if (typeof valor === "string") valores[clave] = reemplazarTokens(valor, datos);
  }

  return valores;
}

async function fallar(
  supabase: Supabase,
  destinatario: FilaDestinatario,
  motivo: string,
  conversacionId: string | null = null,
): Promise<{ ok: false }> {
  await supabase
    .from("broadcast_recipients")
    .update({
      estado: "fallado",
      detalle: motivo.slice(0, 300),
      conversation_id: conversacionId,
    })
    .eq("id", destinatario.id);

  return { ok: false };
}
