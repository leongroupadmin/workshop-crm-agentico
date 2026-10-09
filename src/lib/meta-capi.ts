// Sin `server-only`: el armado del evento es puro y el hash es node:crypto, así
// que se prueba con los mismos datos que después viajan a Meta.
import { createHash } from "node:crypto";

import { normalizarTelefono } from "./difusiones.ts";
import type { EventoMeta } from "./meta-eventos.ts";

/**
 * Conversiones de Meta (CAPI) para los leads que entran por WhatsApp.
 *
 * El caso que resuelve: un lead llega por un anuncio de Click-to-WhatsApp y,
 * días después, alguien del equipo lo mueve a "Visita coordinada" o a
 * "Ganado". Ese paso es la conversión que importa, y pasa en el CRM, no en una
 * página web donde un píxel lo pueda ver. Se le avisa a Meta desde el servidor
 * con el identificador del clic (`ctwa_clid`) que vino en el primer mensaje, y
 * Meta la cuenta en la campaña, el conjunto y el anuncio que trajeron al lead.
 *
 * Sin ese identificador no se manda nada. Un lead que no vino de un anuncio no
 * tiene a qué atribuirse, y mandar el evento igual —cruzado sólo por teléfono—
 * mezclaría en el mismo dataset conversiones atribuidas con otras que no, y las
 * de la campaña dejarían de leerse limpias.
 */

/** Versión de la Graph API. Se cambia acá y en ningún otro lado. */
export const GRAPH_VERSION = "v21.0";

/* ----------------------------------------------------------------- origen */

/** De qué anuncio vino el lead, tal como se guarda en el contacto. */
export type OrigenAnuncio = {
  ctwaClid: string;
  adId: string | null;
  wabaId: string | null;
};

/**
 * Lee el `referral` del primer mensaje de un lead que tocó un anuncio.
 *
 * WhatsApp lo manda en snake_case (`ctwa_clid`, `source_id`) y YCloud lo
 * reenvía en camelCase. Se aceptan las dos formas: equivocarse de una no da
 * ningún error, sólo deja de guardar el clic, y eso no se nota hasta que la
 * campaña aparece sin conversiones.
 */
export function leerReferral(crudo: unknown, wabaId?: string | null): OrigenAnuncio | null {
  if (!crudo || typeof crudo !== "object") return null;
  const objeto = crudo as Record<string, unknown>;

  const ctwaClid = texto(objeto.ctwaClid ?? objeto.ctwa_clid);
  if (!ctwaClid) return null;

  // `source_id` es el id del anuncio sólo cuando el origen es un anuncio. Si
  // vino de una publicación, es el de la publicación y no sirve para esto.
  const tipo = texto(objeto.sourceType ?? objeto.source_type).toLowerCase();
  const fuente = texto(objeto.sourceId ?? objeto.source_id);

  return {
    ctwaClid,
    adId: fuente && (tipo === "" || tipo === "ad") ? fuente : null,
    wabaId: texto(wabaId) || null,
  };
}

/* ------------------------------------------------------------------ evento */

export function sha256(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

/**
 * Id del evento: el mismo contacto y el mismo evento dan siempre el mismo.
 *
 * Es lo que Meta usa para descartar repetidos. El CRM ya evita mandar dos
 * veces, pero si un envío salió y no se llegó a anotar —se cayó la función a
 * mitad de camino—, el reintento lleva el mismo id y Meta lo cuenta una sola
 * vez.
 */
export function idDelEvento(contactId: string, evento: EventoMeta): string {
  return `crm-${contactId}-${evento}`;
}

export type DatosDelEvento = {
  evento: EventoMeta;
  contactId: string;
  origen: OrigenAnuncio;
  telefono: string | null;
  /** Valor de la oportunidad. Null o cero: el evento sale sin valor. */
  valor: number | null;
  moneda: string;
  /** Segundos Unix. */
  instante: number;
};

/**
 * El cuerpo de un evento de CAPI para mensajería de negocios.
 *
 * `ctwa_clid` y la cuenta de WhatsApp Business son lo que ata el evento al
 * anuncio. El teléfono va además, hasheado: no hace falta para atribuir, pero
 * mejora la calidad de coincidencia que Meta muestra en el Administrador de
 * eventos.
 */
export function armarEvento(datos: DatosDelEvento): Record<string, unknown> {
  // Meta pide el teléfono con código de país, sin `+` ni separadores, antes
  // del hash: cada carácter de más da otro hash que no coincide con nadie.
  const telefono = normalizarTelefono(datos.telefono, "solo-digitos");

  const userData: Record<string, unknown> = { ctwa_clid: datos.origen.ctwaClid };
  if (datos.origen.wabaId) userData.whatsapp_business_account_id = datos.origen.wabaId;
  if (telefono) userData.ph = [sha256(telefono)];

  const evento: Record<string, unknown> = {
    event_name: datos.evento,
    event_time: datos.instante,
    event_id: idDelEvento(datos.contactId, datos.evento),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: userData,
  };

  // Una compra sin valor Meta la rechaza; con valor cero la acepta pero no le
  // sirve para optimizar. Se manda lo que haya y la pantalla avisa si la
  // oportunidad no tiene monto.
  const valor = datos.valor && datos.valor > 0 ? datos.valor : null;
  if (valor !== null || datos.evento === "Purchase") {
    evento.custom_data = { currency: datos.moneda, value: valor ?? 0 };
  }

  return evento;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
}
