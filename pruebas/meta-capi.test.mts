/**
 * Pruebas del armado de las conversiones de Meta.
 *
 * Lo que se cuida es lo que Meta no avisa cuando está mal: un clic leído del
 * campo equivocado, un teléfono hasheado con el `+` o un id de evento que
 * cambia entre reintentos no dan error, dan una campaña sin conversiones.
 */
import assert from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { armarEvento, idDelEvento, leerReferral } from "../src/lib/meta-capi.ts";
import { leerPaso, soloConversiones, type Paso } from "../src/lib/automatizaciones.ts";
import { aMensajeEntrante } from "../src/lib/ycloud.ts";

const ORIGEN = { ctwaClid: "ARAkLkA8rmlFeiCktEJQ", adId: "120200000", wabaId: "8125" };

test("lee el clic en camelCase, como lo reenvía YCloud", () => {
  assert.deepStrictEqual(
    leerReferral({ ctwaClid: "abc", sourceId: "999", sourceType: "ad" }, "8125"),
    { ctwaClid: "abc", adId: "999", wabaId: "8125" },
  );
});

test("lee el clic en snake_case, como lo manda WhatsApp", () => {
  assert.deepStrictEqual(
    leerReferral({ ctwa_clid: "abc", source_id: "999", source_type: "ad" }),
    { ctwaClid: "abc", adId: "999", wabaId: null },
  );
});

test("sin clic no hay origen", () => {
  assert.strictEqual(leerReferral({ sourceId: "999", sourceType: "ad" }), null);
  assert.strictEqual(leerReferral(undefined), null);
});

test("una publicación no es un anuncio: el clic queda, el id no", () => {
  assert.strictEqual(leerReferral({ ctwaClid: "abc", sourceId: "1", sourceType: "post" })?.adId, null);
});

test("el evento lleva el clic, la cuenta y el teléfono hasheado sin el +", () => {
  const evento = armarEvento({
    evento: "QualifiedLead",
    contactId: "c1",
    origen: ORIGEN,
    telefono: "+54 9 351 329-4032",
    valor: null,
    moneda: "USD",
    instante: 1_790_000_000,
  });

  assert.strictEqual(evento.action_source, "business_messaging");
  assert.strictEqual(evento.messaging_channel, "whatsapp");
  assert.strictEqual(evento.event_id, idDelEvento("c1", "QualifiedLead"));
  assert.deepStrictEqual(evento.user_data, {
    ctwa_clid: ORIGEN.ctwaClid,
    whatsapp_business_account_id: "8125",
    ph: [createHash("sha256").update("5493513294032").digest("hex")],
  });
  // Sin valor, no se inventa uno.
  assert.strictEqual(evento.custom_data, undefined);
});

test("una compra lleva moneda y valor aunque la oportunidad no tenga monto", () => {
  const base = { contactId: "c1", origen: ORIGEN, telefono: null, moneda: "USD", instante: 1 };
  assert.deepStrictEqual(armarEvento({ ...base, evento: "Purchase", valor: 1500 }).custom_data, {
    currency: "USD",
    value: 1500,
  });
  assert.deepStrictEqual(armarEvento({ ...base, evento: "Purchase", valor: null }).custom_data, {
    currency: "USD",
    value: 0,
  });
});

test("el id del evento es estable: el reintento no cuenta dos veces", () => {
  assert.strictEqual(idDelEvento("c1", "Purchase"), idDelEvento("c1", "Purchase"));
  assert.notStrictEqual(idDelEvento("c1", "Purchase"), idDelEvento("c1", "QualifiedLead"));
});

test("el paso de Meta se lee y descarta eventos que Meta no acepta", () => {
  assert.deepStrictEqual(leerPaso({ tipo: "meta", evento: "QualifiedLead", conValor: true }), {
    tipo: "meta",
    evento: "QualifiedLead",
    conValor: true,
  });
  // La compra lleva valor siempre.
  assert.deepStrictEqual(leerPaso({ tipo: "meta", evento: "Purchase" }), {
    tipo: "meta",
    evento: "Purchase",
    conValor: true,
  });
  assert.strictEqual(leerPaso({ tipo: "meta", evento: "Lead" }), null);
});

test("sólo una secuencia que únicamente avisa a Meta se saltea los cortes", () => {
  const meta: Paso = { tipo: "meta", evento: "QualifiedLead", conValor: false };
  const texto: Paso = { tipo: "texto", texto: "hola" };
  const esperar: Paso = { tipo: "esperar", minutos: 60 };

  assert.strictEqual(soloConversiones([meta]), true);
  assert.strictEqual(soloConversiones([esperar, meta]), true);
  assert.strictEqual(soloConversiones([meta, texto]), false);
  assert.strictEqual(soloConversiones([esperar]), false);
  assert.strictEqual(soloConversiones([]), false);
});

test("YCloud: el primer mensaje desde un anuncio trae el origen", () => {
  const entrante = aMensajeEntrante({
    type: "whatsapp.inbound_message.received",
    whatsappInboundMessage: {
      wamid: "wamid.1",
      wabaId: "8125",
      from: "+5493513294032",
      to: "+5493513127373",
      type: "text",
      text: { body: "Hola, vi el anuncio" },
      referral: { ctwaClid: "clic-1", sourceId: "ad-1", sourceType: "ad" },
    },
  });
  assert.deepStrictEqual(entrante?.origenAnuncio, {
    ctwaClid: "clic-1",
    adId: "ad-1",
    wabaId: "8125",
  });
});

test("YCloud: un mensaje común no trae origen", () => {
  const entrante = aMensajeEntrante({
    type: "whatsapp.inbound_message.received",
    whatsappInboundMessage: {
      wamid: "wamid.2",
      from: "+5493513294032",
      to: "+5493513127373",
      type: "text",
      text: { body: "Hola" },
    },
  });
  assert.strictEqual(entrante?.origenAnuncio, null);
});
