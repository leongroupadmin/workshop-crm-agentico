/**
 * Prueba del adaptador de webhooks de YCloud.
 *
 * Los dos payloads son eventos reales de la cuenta, copiados del panel: uno de
 * texto y uno que WhatsApp no pudo entregar. Están acá tal cual llegaron
 * porque el contrato de YCloud no lo tomamos de su documentación sino de estos
 * eventos, y si cambia, esto es lo que tiene que avisar.
 */
import assert from "node:assert";
import { test } from "node:test";

import { aMensajeEntrante, EVENTO_ENTRANTE } from "../src/lib/ycloud.ts";

const textoReal = {
  id: "evt_6a845a6eb05c520aafd016ad",
  type: "whatsapp.inbound_message.received",
  apiVersion: "v2",
  createTime: "2026-08-18T13:13:18.455Z",
  whatsappInboundMessage: {
    id: "6a845a6eec06686d7d82a244",
    wamid: "wamid.HBgNNTQ5MzUxMzI5NDAzMhUCABIYIEFDQjgwQ0Y1OEYxNENFMDFGQjc3NjBGQzgyRUNBQjhEAA==",
    wabaId: "812501641857850",
    from: "+5493513294032",
    fromUserId: "AR.1662914271596420",
    customerProfile: { name: "Lucas" },
    to: "+5493513127373",
    sendTime: "2026-08-18T13:13:16.000Z",
    type: "text",
    text: { body: "Hii" },
  },
};

const noDisponibleReal = {
  id: "evt_6a8456b8cdd614424b083c57",
  type: "whatsapp.inbound_message.received",
  apiVersion: "v2",
  createTime: "2026-08-18T12:57:28.450Z",
  whatsappInboundMessage: {
    id: "6a8456b8ec06686d7d8176d0",
    wamid: "wamid.HBgNNTQ5MzUxMzUzOTE1NhUCABIYFjNFQjAxNDY2OEZGOUZDNEY5QzUxMjkA",
    wabaId: "812501641857850",
    from: "+5493513539156",
    fromUserId: "AR.1663697221518125",
    customerProfile: { name: "León Consultor" },
    to: "+5493513127373",
    sendTime: "2026-08-18T12:57:26.000Z",
    type: "unsupported",
    errors: [{ code: 131060, title: "This message is unavailable." }],
    unsupported: { type: "unknown" },
  },
};

test("un texto real se mapea entero", () => {
  const entrante = aMensajeEntrante(textoReal);
  assert.ok(entrante);

  assert.equal(entrante.provider, "ycloud");
  assert.equal(entrante.channel, "whatsapp");
  assert.equal(entrante.texto, "Hii");
  assert.equal(entrante.direccion, "incoming");
  // El wamid es lo que deduplica el reintento del webhook.
  assert.equal(entrante.mensajeId, textoReal.whatsappInboundMessage.wamid);
  assert.equal(entrante.enviadoEl, "2026-08-18T13:13:16.000Z");
  assert.equal(entrante.adjunto, null);
});

test("la conversación es el par de números, no un id aparte", () => {
  const entrante = aMensajeEntrante(textoReal);
  assert.ok(entrante);

  // El contacto es el chat; nuestro número es la cuenta por la que se responde.
  assert.equal(entrante.chatId, "+5493513294032");
  assert.equal(entrante.cuenta.id, "+5493513127373");
  assert.equal(entrante.remitente.telefono, "+5493513294032");
  assert.equal(entrante.remitente.nombre, "Lucas");
  assert.equal(entrante.remitente.externalId, "AR.1662914271596420");
});

test("un mensaje que WhatsApp no pudo entregar igual entra", () => {
  // Sin esto el lead se pierde en silencio: llegó algo, no sabemos qué, y la
  // conversación tiene que existir para poder contestarle.
  const entrante = aMensajeEntrante(noDisponibleReal);
  assert.ok(entrante);

  assert.equal(entrante.texto, null);
  assert.equal(entrante.adjunto?.type, "unsupported");
  assert.equal(entrante.adjunto?.url, null);
});

test("un evento sin mensaje no se procesa", () => {
  assert.equal(aMensajeEntrante({ type: EVENTO_ENTRANTE }), null);
  // Sin wamid no hay forma de deduplicar: mejor descartarlo que duplicarlo.
  assert.equal(
    aMensajeEntrante({ whatsappInboundMessage: { from: "+549351", to: "+549351" } }),
    null,
  );
});

/**
 * Firma de los webhooks.
 *
 * YCloud entrega por Svix: se firma `id.timestamp.cuerpo` y la clave son los
 * bytes del secreto en base64, no su texto. Los vectores se arman acá con el
 * mismo algoritmo del lado que firma, así la prueba falla si alguno de esos dos
 * detalles se pierde en una refactorización.
 */
import { createHmac } from "node:crypto";

import { leerFirmaYcloud, verificarFirmaYcloud } from "../src/lib/ycloud.ts";

const SECRETO = "whsec_" + Buffer.from("un-secreto-de-prueba-cualquiera").toString("base64");
const CUERPO = JSON.stringify(textoReal);
const AHORA = 1_766_000_000_000;

const firmar = (id: string, timestamp: string, cuerpo: string, secreto = SECRETO) => {
  const clave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", clave).update(`${id}.${timestamp}.${cuerpo}`).digest("base64");
};

const enSegundos = String(Math.floor(AHORA / 1000));

test("una firma válida pasa", () => {
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: "msg_1", timestamp: enSegundos, signature: firmar("msg_1", enSegundos, CUERPO) },
    SECRETO,
    AHORA,
  );
  assert.deepEqual(resultado, { ok: true });
});

test("el cuerpo alterado invalida la firma", () => {
  const resultado = verificarFirmaYcloud(
    CUERPO.replace("Hii", "Otra cosa"),
    { id: "msg_1", timestamp: enSegundos, signature: firmar("msg_1", enSegundos, CUERPO) },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("una entrega vieja se rechaza aunque la firma sea correcta", () => {
  // Sin esto, una entrega interceptada se puede reenviar cuando sea.
  const viejo = String(Math.floor((AHORA - 60 * 60 * 1000) / 1000));
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: "msg_1", timestamp: viejo, signature: firmar("msg_1", viejo, CUERPO) },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("otro secreto no valida", () => {
  const otro = "whsec_" + Buffer.from("otro-secreto-distinto-del-real").toString("base64");
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: "msg_1", timestamp: enSegundos, signature: firmar("msg_1", enSegundos, CUERPO, otro) },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("sin headers de firma no se valida nada", () => {
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: null, timestamp: null, signature: null },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("los headers se leen con el nombre de marca y con el de Svix", () => {
  const conMarca = new Request("https://ejemplo.test", {
    headers: { "ycloud-id": "a", "ycloud-timestamp": "1", "ycloud-signature": "v1,x" },
  });
  assert.equal(leerFirmaYcloud(conMarca).id, "a");

  const conSvix = new Request("https://ejemplo.test", {
    headers: { "svix-id": "b", "svix-timestamp": "2", "svix-signature": "v1,y" },
  });
  assert.equal(leerFirmaYcloud(conSvix).id, "b");
});

test("la firma se encuentra sin importar el prefijo de marca", () => {
  // Una lista fija de nombres daba el mismo 401 que una firma incorrecta
  // cuando el proveedor renombraba sus headers.
  const inventado = new Request("https://ejemplo.test", {
    headers: {
      "proveedor-nuevo-id": "a",
      "proveedor-nuevo-timestamp": "1",
      "proveedor-nuevo-signature": "v1,x",
    },
  });
  const firma = leerFirmaYcloud(inventado);
  assert.equal(firma.id, "a");
  assert.equal(firma.timestamp, "1");
  assert.equal(firma.signatureHeader, "proveedor-nuevo-signature");
});

test("sin id ni timestamp se valida el HMAC del cuerpo pelado", () => {
  // El respaldo para un proveedor que firma sin marca de tiempo.
  const clave = Buffer.from(SECRETO.replace(/^whsec_/, ""), "base64");
  const sola = createHmac("sha256", clave).update(CUERPO).digest("base64");

  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: null, timestamp: null, signature: sola },
    SECRETO,
    AHORA,
  );
  assert.deepEqual(resultado, { ok: true });
});

test("una firma en hexadecimal también se reconoce", () => {
  const clave = Buffer.from(SECRETO.replace(/^whsec_/, ""), "base64");
  const enHex = createHmac("sha256", clave).update(CUERPO).digest("hex");

  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: null, timestamp: null, signature: enHex },
    SECRETO,
    AHORA,
  );
  assert.deepEqual(resultado, { ok: true });
});

/**
 * El esquema real de YCloud: `t=<unix>,s=<hex>` en un solo header.
 *
 * El header de abajo es el de una entrega real. No valida contra nuestro
 * secreto —lo firmó otro endpoint, y cada uno tiene el suyo— pero fija el
 * formato, que es lo que se estaba interpretando mal.
 */
const HEADER_REAL =
  "t=1787061200,s=f978296022c58d15eae96e038b84ed896667a6f0f026b0482c2996d2c9125864";

const firmarConMarca = (t: string, cuerpo: string, clave: Buffer) =>
  `t=${t},s=${createHmac("sha256", clave).update(`${t}.${cuerpo}`).digest("hex")}`;

test("valida el esquema con timestamp y firma en un solo header", () => {
  // La clave se prueba en varias formas porque no está documentada cuál usa.
  for (const clave of [
    Buffer.from(SECRETO),
    Buffer.from(SECRETO.replace(/^whsec_/, "")),
    Buffer.from(SECRETO.replace(/^whsec_/, ""), "base64"),
  ]) {
    const resultado = verificarFirmaYcloud(
      CUERPO,
      { id: null, timestamp: null, signature: firmarConMarca(enSegundos, CUERPO, clave) },
      SECRETO,
      AHORA,
    );
    assert.deepEqual(resultado, { ok: true }, `no validó con la clave ${clave.toString("hex").slice(0, 12)}`);
  }
});

test("el cuerpo alterado invalida la firma con marca de tiempo", () => {
  const firma = firmarConMarca(enSegundos, CUERPO, Buffer.from(SECRETO));
  const resultado = verificarFirmaYcloud(
    CUERPO.replace("Hii", "Otra cosa"),
    { id: null, timestamp: null, signature: firma },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("una entrega vieja se rechaza aunque la firma sea correcta", () => {
  const viejo = String(Math.floor((AHORA - 60 * 60 * 1000) / 1000));
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: null, timestamp: null, signature: firmarConMarca(viejo, CUERPO, Buffer.from(SECRETO)) },
    SECRETO,
    AHORA,
  );
  assert.equal(resultado.ok, false);
});

test("el formato real se reconoce como esquema con marca de tiempo", () => {
  // Si se leyera como firma pelada, el motivo del rechazo sería otro y el
  // timestamp no se controlaría.
  const resultado = verificarFirmaYcloud(
    CUERPO,
    { id: null, timestamp: null, signature: HEADER_REAL },
    SECRETO,
    1787061200 * 1000,
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /no coincide con el secreto del webhook de YCloud/);
});

/**
 * Respuestas a botones.
 *
 * Es el mensaje que más importa de la charla: cuando el lead toca el botón de
 * la plantilla, reabre la ventana de 24 horas. Llegaba como adjunto de tipo
 * `button`, así que el chat mostraba un clip "Adjunto" que no abría nada y la
 * IA no tenía texto que contestar.
 */

const botonDePlantilla = {
  id: "evt_6a845a6eb05c520aafd016ae",
  type: "whatsapp.inbound_message.received",
  apiVersion: "v2",
  createTime: "2026-08-19T00:07:20.455Z",
  whatsappInboundMessage: {
    id: "6a845a6eec06686d7d82a245",
    wamid: "wamid.HBgNNTQ5MzUxMzI5NDAzMhUCABIYIDBBMkUxRUYwQjJEQzQ4RTk5RTIzQTUxQzE5QUY1RDMzAA==",
    wabaId: "812501641857850",
    from: "+5493513294032",
    fromUserId: "AR.1662914271596420",
    customerProfile: { name: "Lucas" },
    to: "+5493513127373",
    sendTime: "2026-08-19T00:07:18.000Z",
    type: "button",
    button: { text: "Si, hablemos", payload: "Si, hablemos" },
  },
};

test("tocar el botón de una plantilla llega como texto, no como adjunto", () => {
  const entrante = aMensajeEntrante(botonDePlantilla);

  assert.ok(entrante);
  assert.equal(entrante.texto, "Si, hablemos");
  assert.equal(entrante.adjunto, null);
});

test("un botón interactivo fuera de plantilla llega igual", () => {
  const entrante = aMensajeEntrante({
    ...botonDePlantilla,
    whatsappInboundMessage: {
      ...botonDePlantilla.whatsappInboundMessage,
      type: "interactive",
      button: undefined,
      interactive: {
        type: "button_reply",
        button_reply: { id: "si", title: "Si, hablemos" },
      },
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.texto, "Si, hablemos");
  assert.equal(entrante.adjunto, null);
});

test("elegir una opción de una lista llega como texto", () => {
  const entrante = aMensajeEntrante({
    ...botonDePlantilla,
    whatsappInboundMessage: {
      ...botonDePlantilla.whatsappInboundMessage,
      type: "interactive",
      button: undefined,
      interactive: {
        type: "list_reply",
        list_reply: { id: "turno-manana", title: "Por la mañana" },
      },
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.texto, "Por la mañana");
  assert.equal(entrante.adjunto, null);
});

test("un botón sin rótulo no se hace pasar por texto vacío", () => {
  // Sin rótulo no hay nada que mostrar; que siga marcado como adjunto es
  // preferible a un globo en blanco que nadie entiende.
  const entrante = aMensajeEntrante({
    ...botonDePlantilla,
    whatsappInboundMessage: {
      ...botonDePlantilla.whatsappInboundMessage,
      button: { text: "   ", payload: "vacio" },
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.texto, null);
  assert.equal(entrante.adjunto?.type, "button");
});

test("una imagen sigue siendo un adjunto", () => {
  // La red de contención del arreglo: tratar botones como texto no puede
  // haberse llevado puesto el resto de los tipos.
  const entrante = aMensajeEntrante({
    ...botonDePlantilla,
    whatsappInboundMessage: {
      ...botonDePlantilla.whatsappInboundMessage,
      type: "image",
      button: undefined,
      image: { id: "media-1", link: "https://example.com/foto.jpg", caption: "Mirá" },
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.texto, "Mirá");
  assert.equal(entrante.adjunto?.type, "image");
  assert.equal(entrante.adjunto?.url, "https://example.com/foto.jpg");
});
