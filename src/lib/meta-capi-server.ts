import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { armarEvento, GRAPH_VERSION, type OrigenAnuncio } from "@/lib/meta-capi";
import { NOMBRE_DEL_EVENTO, type EventoMeta } from "@/lib/meta-eventos";

type Supabase = SupabaseClient;

export type ConfigMeta = {
  datasetId: string;
  accessToken: string;
  currency: string;
  testEventCode: string | null;
};

/** La cuenta de Meta del workspace. Se lee con la clave de servicio. */
export async function leerConfigMeta(
  supabase: Supabase,
  workspaceId: string,
): Promise<ConfigMeta | null> {
  const { data } = await supabase
    .from("meta_capi_configs")
    .select("dataset_id, access_token, currency, test_event_code")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) return null;
  return {
    datasetId: data.dataset_id,
    accessToken: data.access_token,
    currency: data.currency,
    testEventCode: data.test_event_code || null,
  };
}

/**
 * Guarda de qué anuncio vino el lead.
 *
 * Se pisa con el clic más reciente: si la persona volvió a entrar por otro
 * anuncio, la conversión es mérito del último, que es también el que Meta
 * espera recibir.
 */
export async function guardarOrigen(
  supabase: Supabase,
  contactId: string,
  origen: OrigenAnuncio,
  instante: string,
): Promise<void> {
  const { error } = await supabase
    .from("contacts")
    .update({
      meta_ctwa_clid: origen.ctwaClid,
      meta_ad_id: origen.adId,
      meta_waba_id: origen.wabaId,
      meta_clic_at: instante,
    })
    .eq("id", contactId);

  if (error) console.error("[meta] no se pudo guardar el origen del lead:", error.message);
}

export type ResultadoConversion =
  | { clase: "enviada" }
  | { clase: "omitida"; detalle: string }
  | { clase: "error"; detalle: string };

/**
 * Le avisa a Meta que el lead convirtió.
 *
 * "Omitida" no es un error: es el lead que no vino de un anuncio, o la
 * conversión que ya se había mandado. La secuencia sigue igual.
 */
export async function enviarConversion(
  supabase: Supabase,
  input: {
    workspaceId: string;
    contactId: string;
    automationId: string;
    evento: EventoMeta;
    conValor: boolean;
  },
): Promise<ResultadoConversion> {
  const config = await leerConfigMeta(supabase, input.workspaceId);
  if (!config) {
    return {
      clase: "error",
      detalle: "Falta cargar la cuenta de Meta en Configuración.",
    };
  }

  const { data: previa } = await supabase
    .from("meta_conversiones")
    .select("estado")
    .eq("contact_id", input.contactId)
    .eq("evento", input.evento)
    .maybeSingle();

  if (previa?.estado === "enviada") {
    return { clase: "omitida", detalle: "Esa conversión ya se había enviado." };
  }

  const { data: contacto } = await supabase
    .from("contacts")
    .select("phone, meta_ctwa_clid, meta_ad_id, meta_waba_id")
    .eq("id", input.contactId)
    .maybeSingle();

  if (!contacto) return { clase: "error", detalle: "El contacto ya no existe." };

  const valor = input.conValor ? await valorDe(supabase, input) : null;

  const anotar = (estado: "enviada" | "fallada" | "sin_anuncio", detalle: string | null) =>
    supabase.from("meta_conversiones").upsert(
      {
        workspace_id: input.workspaceId,
        contact_id: input.contactId,
        automation_id: input.automationId,
        evento: input.evento,
        estado,
        valor,
        detalle,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id,evento" },
    );

  if (!contacto.meta_ctwa_clid) {
    await anotar("sin_anuncio", null);
    return { clase: "omitida", detalle: "El lead no vino de un anuncio." };
  }

  const cuerpo: Record<string, unknown> = {
    data: [
      armarEvento({
        evento: input.evento,
        contactId: input.contactId,
        origen: {
          ctwaClid: contacto.meta_ctwa_clid,
          adId: contacto.meta_ad_id,
          wabaId: contacto.meta_waba_id,
        },
        telefono: contacto.phone,
        valor,
        moneda: config.currency,
        instante: Math.floor(Date.now() / 1000),
      }),
    ],
  };
  if (config.testEventCode) cuerpo.test_event_code = config.testEventCode;

  const enviado = await postearEventos(config, cuerpo);
  await anotar(enviado.ok ? "enviada" : "fallada", enviado.ok ? null : enviado.error);

  if (!enviado.ok) {
    console.error("[meta] Meta rechazó la conversión:", enviado.error);
    return {
      clase: "error",
      detalle: `Meta rechazó "${NOMBRE_DEL_EVENTO[input.evento]}": ${enviado.error}`,
    };
  }

  return { clase: "enviada" };
}

/** El monto de la oportunidad del lead. Null si no tiene. */
async function valorDe(
  supabase: Supabase,
  input: { workspaceId: string; contactId: string },
): Promise<number | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("value")
    .eq("contact_id", input.contactId)
    .eq("workspace_id", input.workspaceId)
    .limit(1)
    .maybeSingle();

  const valor = Number(data?.value ?? 0);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * El POST a la API de conversiones.
 *
 * El token viaja en el cuerpo y no en la URL: una URL con el token termina
 * escrita en los logs de cualquier proxy del camino.
 */
export async function postearEventos(
  config: Pick<ConfigMeta, "datasetId" | "accessToken">,
  cuerpo: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; codigo?: number }> {
  try {
    const respuesta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${config.datasetId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cuerpo, access_token: config.accessToken }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const json = (await respuesta.json().catch(() => null)) as {
      events_received?: number;
      error?: { message?: string; error_user_msg?: string; code?: number };
    } | null;

    if (!respuesta.ok || !json?.events_received) {
      const mensaje =
        json?.error?.error_user_msg || json?.error?.message || `HTTP ${respuesta.status}`;
      return { ok: false, error: mensaje.slice(0, 300), codigo: json?.error?.code };
    }

    return { ok: true };
  } catch (problema) {
    return { ok: false, error: String(problema).slice(0, 300) };
  }
}
