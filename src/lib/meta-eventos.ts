/**
 * Los eventos de Meta que puede mandar una automatización.
 *
 * Viven aparte de `meta-capi.ts` porque la pantalla también los necesita, y
 * aquel arrastra `node:crypto`, que no entra en el navegador.
 */

/**
 * Los eventos que Meta acepta para mensajería de negocios.
 *
 * No son los de un píxel web: para WhatsApp el lead es `LeadSubmitted`, no
 * `Lead`, y un nombre de la lista web lo rechaza la API.
 */
export const EVENTOS_META = ["LeadSubmitted", "QualifiedLead", "Purchase"] as const;
export type EventoMeta = (typeof EVENTOS_META)[number];

export const NOMBRE_DEL_EVENTO: Record<EventoMeta, string> = {
  LeadSubmitted: "Lead",
  QualifiedLead: "Lead calificado",
  Purchase: "Compra / venta cerrada",
};

export function esEventoMeta(valor: unknown): valor is EventoMeta {
  return EVENTOS_META.some((evento) => evento === valor);
}

export const MONEDAS_META = ["USD", "ARS"] as const;
