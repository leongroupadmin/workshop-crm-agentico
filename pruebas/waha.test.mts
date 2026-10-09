import assert from "node:assert";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { vieneVacio } from "../src/lib/media-notes.ts";
import {
  aMensajeEntranteWaha,
  diagnosticarSesion,
  esMediaDeWaha,
  leerEstadoDeSesion,
  verificarFirmaWaha,
} from "../src/lib/waha.ts";

const evento = {
  event: "message",
  session: "default",
  engine: "WEBJS",
  me: { id: "5493511111111@c.us", pushName: "León" },
  payload: {
    id: "false_5493512222222@c.us_AAA",
    timestamp: 1787664000,
    from: "5493512222222@c.us",
    to: "5493511111111@c.us",
    fromMe: false,
    body: "Hola",
    hasMedia: false,
    _data: { notifyName: "Consulta WAHA" },
  },
};

test("mapea un texto entrante de WAHA", () => {
  const entrante = aMensajeEntranteWaha(evento);
  assert.ok(entrante);
  assert.equal(entrante.provider, "waha");
  assert.equal(entrante.channel, "whatsapp");
  assert.equal(entrante.cuenta.id, "waha:default");
  assert.equal(entrante.chatId, "5493512222222@c.us");
  assert.equal(entrante.remitente.telefono, "+5493512222222");
  assert.equal(entrante.remitente.nombre, "Consulta WAHA");
  assert.equal(entrante.texto, "Hola");
});

test("descarta mensajes propios y grupos", () => {
  assert.equal(aMensajeEntranteWaha({ ...evento, payload: { ...evento.payload, fromMe: true } }), null);
  assert.equal(
    aMensajeEntranteWaha({ ...evento, payload: { ...evento.payload, from: "123@g.us" } }),
    null,
  );
});

test("descarta los avisos de la cuenta de WhatsApp, que no es un lead", () => {
  assert.equal(
    aMensajeEntranteWaha({ ...evento, payload: { ...evento.payload, from: "0@c.us" } }),
    null,
  );
});

/** Así empieza la miniatura de una foto: la firma de un JPEG, en base64. */
const MINIATURA = `/9j/4AAQSkZJRgABAgAAAQABAAD/4gKASUNDX1BST0ZJTEUAAQEAAAJw${"A".repeat(200)}`;

test("una foto que llega sin archivo no se muestra como texto", () => {
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: { ...evento.payload, body: MINIATURA, type: "image", hasMedia: false },
  });
  assert.ok(entrante);
  assert.equal(entrante.texto, null);
  assert.equal(entrante.adjunto?.type, "image");
});

test("la miniatura se descarta pero el epígrafe de la foto queda", () => {
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: {
      ...evento.payload,
      body: MINIATURA,
      hasMedia: false,
      _data: { ...evento.payload._data, caption: "Mirá esto" },
    },
  });
  assert.ok(entrante);
  assert.equal(entrante.texto, "Mirá esto");
  // Sin tipo declarado, igual es una foto.
  assert.equal(entrante.adjunto?.type, "image");
});

test("un texto largo de verdad no se confunde con una miniatura", () => {
  const largo = `/9j/ no es una foto si tiene espacios ${"y sigue ".repeat(30)}`;
  const entrante = aMensajeEntranteWaha({ ...evento, payload: { ...evento.payload, body: largo } });
  assert.ok(entrante);
  assert.equal(entrante.texto, largo.trim());
  assert.equal(entrante.adjunto, null);
});

test("mapea un adjunto aunque WAHA no lo haya descargado", () => {
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: {
      ...evento.payload,
      body: "",
      type: "ptt",
      hasMedia: true,
      media: null,
    },
  });
  assert.ok(entrante);
  assert.equal(entrante.adjunto?.type, "audio");
  assert.equal(entrante.adjunto?.url, null);
});

test("pide guardar una copia del adjunto, porque WAHA lo borra a los minutos", () => {
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: {
      ...evento.payload,
      body: "",
      type: "ptt",
      hasMedia: true,
      media: {
        url: "http://127.0.0.1:3001/api/files/default/audio.oga",
        mimetype: "audio/ogg; codecs=opus",
      },
    },
  });
  assert.ok(entrante);
  assert.equal(entrante.adjunto?.type, "audio");
  assert.equal(entrante.adjunto?.guardarCopia, true);
});

test("un aviso interno de WhatsApp queda sin nada que guardar", () => {
  // Los cambios de clave de cifrado y los mensajes de protocolo entran por el
  // mismo evento `message`, sin cuerpo y sin archivo. En el teléfono no se ven;
  // guardarlos dejaba burbujas «(mensaje sin texto)» en el chat del CRM.
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: {
      ...evento.payload,
      id: "false_5493512222222@c.us_BBB",
      body: "",
      type: "e2e_notification",
      hasMedia: false,
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.texto, null);
  assert.equal(entrante.adjunto, null);
  // Con eso `procesarEntrante` lo descarta, y el tipo queda en el log.
  assert.equal(vieneVacio(entrante.texto, entrante.adjunto?.type), true);
  assert.equal(entrante.tipoCrudo, "e2e_notification");
});

test("una imagen sin cuerpo sigue siendo un mensaje aunque falte hasMedia", () => {
  // Si se tomara sólo `hasMedia`, este mensaje quedaría vacío y el descarte de
  // los avisos internos se llevaría puesta una foto de verdad.
  const entrante = aMensajeEntranteWaha({
    ...evento,
    payload: {
      ...evento.payload,
      id: "false_5493512222222@c.us_CCC",
      body: "",
      type: "image",
      hasMedia: false,
      media: null,
    },
  });

  assert.ok(entrante);
  assert.equal(entrante.adjunto?.type, "image");
  assert.equal(vieneVacio(entrante.texto, entrante.adjunto?.type), false);
});

test("valida la firma HMAC-SHA512 de WAHA", () => {
  const body = JSON.stringify(evento);
  const secret = "secreto-de-prueba";
  const firma = createHmac("sha512", secret).update(body).digest("hex");
  assert.equal(verificarFirmaWaha(body, firma, secret), true);
  assert.equal(verificarFirmaWaha(`${body} `, firma, secret), false);
  assert.equal(verificarFirmaWaha(body, firma, "otro-secreto"), false);
});

test("reconoce los adjuntos que sirve nuestra instancia de WAHA", () => {
  const base = "http://127.0.0.1:3001";
  assert.equal(esMediaDeWaha(`${base}/api/files/audio.oga`, base), true);
  // La barra de más en la variable de entorno es el error de tipeo clásico.
  assert.equal(esMediaDeWaha(`${base}/api/files/audio.oga`, `${base}/`), true);
  // A un host ajeno no se le manda la key, aunque el adjunto venga en el mismo evento.
  assert.equal(esMediaDeWaha("https://cdn.ajeno.com/api/files/audio.oga", base), false);
  // Un prefijo que no termina en la base tampoco cuenta: `…:30011` no es `…:3001`.
  assert.equal(esMediaDeWaha("http://127.0.0.1:30011/api/files/audio.oga", base), false);
  assert.equal(esMediaDeWaha(`${base}/api/files/audio.oga`, undefined), false);
});

test("la key de WAHA sólo sale para sus adjuntos, no para el resto de su API", () => {
  // La URL sale de la fila del mensaje, que cualquiera del equipo puede editar:
  // con la key, la captura de pantalla de WAHA muestra el WhatsApp entero.
  const base = "http://127.0.0.1:3001";
  assert.equal(esMediaDeWaha(`${base}/api/default/files/x.oga`, base), false);
  assert.equal(esMediaDeWaha(`${base}/api/screenshot?session=default`, base), false);
  assert.equal(esMediaDeWaha(`${base}/api/files/../screenshot`, base), false);
  assert.equal(esMediaDeWaha(`${base}/api/files/%2e%2e/screenshot`, base), false);
  // Las carpetas por sesión de las versiones nuevas siguen contando.
  assert.equal(esMediaDeWaha(`${base}/api/files/default/audio.oga`, base), true);
});

// --- Estado de la sesión -----------------------------------------------------
//
// Lo que se afirma acá es el nivel, no el texto. Una sesión caída no rompe nada
// visible —el CRM anota el recordatorio, lo marca fallado y sigue—, así que si
// el nivel baja de alarma a aviso nadie se entera hasta que un cliente no
// recibe el aviso.

test("una sesión vinculada no pide nada y muestra el número", () => {
  const diagnostico = diagnosticarSesion({ estado: "WORKING", numero: "+5493511111111" });

  assert.equal(diagnostico.nivel, "ok");
  assert.equal(diagnostico.pideQr, false);
  assert.match(diagnostico.mensaje, /\+5493511111111/);
});

test("una sesión sin vincular es alarma y pide el QR", () => {
  // No es un aviso: sin teléfono vinculado no sale un solo recordatorio.
  const diagnostico = diagnosticarSesion({ estado: "SCAN_QR_CODE", numero: null });

  assert.equal(diagnostico.nivel, "alarma");
  assert.equal(diagnostico.pideQr, true);
});

test("una sesión detenida es alarma aunque no haya nada que escanear", () => {
  const diagnostico = diagnosticarSesion({ estado: "STOPPED", numero: null });

  assert.equal(diagnostico.nivel, "alarma");
  assert.equal(diagnostico.pideQr, false);
});

test("una sesión que falló ofrece volver a vincular", () => {
  // Es el caso de cerrar la sesión desde el teléfono: hay que escanear de nuevo.
  const diagnostico = diagnosticarSesion({ estado: "FAILED", numero: null });

  assert.equal(diagnostico.nivel, "alarma");
  assert.equal(diagnostico.pideQr, true);
});

test("mientras arranca no alarma a nadie", () => {
  // Es un estado de paso: pintarlo de rojo enseñaría a ignorar el rojo.
  const diagnostico = diagnosticarSesion({ estado: "STARTING", numero: null });

  assert.equal(diagnostico.nivel, "aviso");
  assert.equal(diagnostico.pideQr, false);
});

test("un estado que WAHA no nombra no se toma por bueno", () => {
  // Si una versión nueva inventa un estado, el CRM no puede decir que anda.
  assert.equal(leerEstadoDeSesion("ALGO_NUEVO"), "DESCONOCIDO");
  assert.equal(leerEstadoDeSesion(undefined), "DESCONOCIDO");
  assert.equal(diagnosticarSesion({ estado: "DESCONOCIDO", numero: null }).nivel, "aviso");
});

test("los estados que WAHA sí nombra se leen tal cual", () => {
  assert.equal(leerEstadoDeSesion("WORKING"), "WORKING");
  assert.equal(leerEstadoDeSesion("SCAN_QR_CODE"), "SCAN_QR_CODE");
});
