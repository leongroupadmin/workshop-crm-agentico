// Sin `server-only`: acá no hay nada que dependa del runtime de Next —el mapeo
// es puro y la firma es node:crypto—, y así se prueba con los payloads y las
// firmas reales.
import { createHmac, timingSafeEqual } from "node:crypto";

import type { MensajeEntrante } from "@/lib/entrante";

/**
 * Contrato de los webhooks de YCloud.
 *
 * YCloud es un BSP oficial de Meta: los mensajes llegan de la WhatsApp Business
 * Platform, no de un cliente no oficial. La forma la tomé de un evento real de
 * la cuenta —no de la documentación—, así que están mapeados los campos que vi
 * y los tipos de mensaje se traducen con tolerancia a lo que no vino.
 *
 * Evento de ejemplo:
 *   {
 *     "type": "whatsapp.inbound_message.received",
 *     "whatsappInboundMessage": {
 *       "wamid": "wamid.HBg…", "wabaId": "8125…",
 *       "from": "+5493513294032", "to": "+5493513127373",
 *       "customerProfile": { "name": "Lucas" },
 *       "sendTime": "2026-08-18T13:13:16.000Z",
 *       "type": "text", "text": { "body": "Hii" }
 *     }
 *   }
 */

export const EVENTO_ENTRANTE = "whatsapp.inbound_message.received";

type Media = { id?: string; link?: string; caption?: string; voice?: boolean };

export type YCloudInboundEvent = {
  id?: string;
  type?: string;
  apiVersion?: string;
  createTime?: string;
  whatsappInboundMessage?: {
    id?: string;
    wamid?: string;
    wabaId?: string;
    from?: string;
    fromUserId?: string;
    customerProfile?: { name?: string };
    to?: string;
    sendTime?: string;
    type?: string;
    text?: { body?: string };
    image?: Media;
    audio?: Media;
    video?: Media;
    document?: Media;
    sticker?: Media;
    /** Botón de respuesta rápida de una plantilla: el rótulo va en `text`. */
    button?: { text?: string; payload?: string };
    /** Botones y listas fuera de plantilla: el rótulo va en `title`. */
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string; description?: string };
      nfm_reply?: { name?: string; body?: string };
    };
    errors?: { code?: number; title?: string }[];
  };
};

/**
 * Traduce el tipo de mensaje de WhatsApp al vocabulario de adjuntos del CRM.
 *
 * Lo que no se reconoce cae en `null` y el mensaje queda como texto: es lo que
 * hace falta para que `contenidoDelMensaje` le deje igual una nota y la IA sepa
 * que llegó algo.
 */
const ADJUNTOS: Record<string, string> = {
  image: "image",
  audio: "audio",
  voice: "audio",
  video: "video",
  document: "file",
  sticker: "sticker",
  location: "location",
  contacts: "contact",
};

/**
 * Texto de una respuesta a botón o lista.
 *
 * Cuando el lead toca "Sí, hablemos" en una plantilla, WhatsApp no manda un
 * `text`: manda `type: "button"` con el rótulo adentro. Como no era texto, el
 * mapeo lo trataba como adjunto de tipo `button` y el chat mostraba un clip
 * "Adjunto" que no abría nada —el mensaje que más importa de todos, porque es
 * el que reabre la ventana de 24 horas—. Los botones interactivos fuera de
 * plantilla llegan igual, pero con el rótulo en otro lugar.
 *
 * Devuelve `null` si el evento no es una respuesta de estas.
 */
function textoDeRespuesta(mensaje: {
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
    nfm_reply?: { body?: string };
  };
}): string | null {
  const rotulo =
    mensaje.button?.text ??
    mensaje.interactive?.button_reply?.title ??
    mensaje.interactive?.list_reply?.title ??
    mensaje.interactive?.nfm_reply?.body;

  const limpio = rotulo?.trim();
  return limpio ? limpio : null;
}

/**
 * Pasa un evento de YCloud a la forma común de los entrantes.
 *
 * Devuelve `null` cuando el evento no es un mensaje que podamos procesar; el
 * webhook lo descarta con 200 para que YCloud no lo reintente para siempre.
 */
export function aMensajeEntrante(evento: YCloudInboundEvent): MensajeEntrante | null {
  const mensaje = evento.whatsappInboundMessage;
  if (!mensaje) return null;

  // `from` y `to` son la conversación entera: WhatsApp no tiene un id de chat
  // aparte, la charla es el par de números. `from` alcanza porque `to` siempre
  // es nuestro número, que ya viaja como cuenta.
  const de = mensaje.from?.trim();
  const para = mensaje.to?.trim();
  const id = mensaje.wamid || mensaje.id;
  if (!de || !para || !id) return null;

  const tipo = mensaje.type ?? "text";
  const media = mensaje.image ?? mensaje.audio ?? mensaje.video ?? mensaje.document ?? mensaje.sticker;

  // Una respuesta a botón es texto para todo lo que sigue: se lee en el chat,
  // la IA la contesta y no deja un adjunto fantasma.
  const respuesta = textoDeRespuesta(mensaje);
  const tipoAdjunto = tipo === "text" || respuesta ? null : (ADJUNTOS[tipo] ?? tipo);

  return {
    provider: "ycloud",
    // YCloud, al menos en esta cuenta, es sólo WhatsApp.
    channel: "whatsapp",
    cuenta: { id: para, plataforma: "whatsapp", usuario: para },
    chatId: de,
    mensajeId: id,
    // El evento existe únicamente para lo que entra; lo que sale tiene el suyo.
    direccion: "incoming",
    texto: mensaje.text?.body ?? respuesta ?? media?.caption ?? null,
    adjunto: tipoAdjunto ? { type: tipoAdjunto, url: media?.link ?? null } : null,
    enviadoEl: mensaje.sendTime ?? evento.createTime ?? new Date().toISOString(),
    remitente: {
      externalId: mensaje.fromUserId,
      nombre: mensaje.customerProfile?.name,
      telefono: de,
    },
    tipoCrudo: tipo,
  };
}

/**
 * Verificación de la firma de los webhooks.
 *
 * YCloud entrega por Svix, así que la firma sigue el esquema de Standard
 * Webhooks y no un HMAC del cuerpo pelado: se firma `id.timestamp.cuerpo`, y la
 * clave es el secreto sin el prefijo `whsec_`, **decodificado de base64**. Los
 * dos detalles son fáciles de pasar por alto y cada uno da el mismo 401 que una
 * firma falsa.
 *
 * El timestamp se controla contra el reloj para que una entrega vieja
 * interceptada no se pueda reenviar más tarde.
 */

const TOLERANCIA_MS = 5 * 60 * 1000;

export type FirmaYcloud = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  /** Con qué nombre llegó la firma. Para el diagnóstico cuando no valida. */
  signatureHeader: string | null;
  receivedHeaders: string[];
};

/**
 * Encuentra los headers de firma sin depender de cómo se llamen.
 *
 * Svix deja que cada marca renombre los suyos —`svix-…`, `webhook-…`,
 * `ycloud-…`— y una lista fija de nombres daba el mismo 401 que una firma
 * incorrecta cuando el nombre no estaba en la lista: dos causas muy distintas,
 * imposibles de distinguir desde afuera. Así que la firma se busca por su
 * terminación y de ahí sale el prefijo con el que se arman los otros dos.
 */
export function leerFirmaYcloud(request: Request): FirmaYcloud {
  const todos = [...request.headers.entries()].map(
    ([nombre, valor]) => [nombre.toLowerCase(), valor] as const,
  );

  // Vercel firma sus propias peticiones con `x-vercel-proxy-signature`, y
  // buscar por terminación lo agarraba a él en vez de al del proveedor: el
  // webhook se rechazaba solo, validando contra una firma que no era la suya.
  // Lo mismo vale para cualquier header que agregue la infraestructura.
  const DE_LA_INFRAESTRUCTURA = /^(x-vercel-|x-forwarded-|cf-|fly-)/;

  const firmado = todos.find(
    ([nombre]) =>
      !DE_LA_INFRAESTRUCTURA.test(nombre) &&
      (nombre === "signature" || nombre.endsWith("-signature")),
  );
  const prefijo = firmado?.[0].replace(/-?signature$/, "") ?? null;
  const buscar = (nombre: string) => todos.find(([n]) => n === nombre)?.[1] ?? null;

  return {
    id: prefijo ? buscar(`${prefijo}-id`) : null,
    timestamp: prefijo ? buscar(`${prefijo}-timestamp`) : null,
    signature: firmado?.[1] ?? null,
    signatureHeader: firmado?.[0] ?? null,
    receivedHeaders: todos.map(([nombre]) => nombre).sort(),
  };
}

export type Verificacion = { ok: true } | { ok: false; motivo: string };

/**
 * Valida la firma contra el secreto.
 *
 * YCloud firma al estilo de Stripe, no de Svix: un solo header con el
 * timestamp y la firma adentro, `t=<unix>,s=<hex>`, y se firma `t.cuerpo`.
 * Verificado contra una entrega real; el esquema de Svix —tres headers
 * separados— se mantiene abajo porque no cuesta nada y cubre el caso de que
 * cambien de biblioteca.
 *
 * Cuál de las formas del secreto es la clave no lo pude confirmar contra una
 * entrega nuestra: el ejemplo que teníamos venía firmado con el secreto de otro
 * endpoint. Se prueban las cuatro plausibles; todas son pruebas reales contra
 * el secreto, así que probar de más no debilita nada.
 */
export function verificarFirmaYcloud(
  rawBody: string,
  firma: Pick<FirmaYcloud, "id" | "timestamp" | "signature">,
  secret: string,
  ahora: number = Date.now(),
): Verificacion {
  const { id, timestamp, signature } = firma;
  if (!signature) return { ok: false, motivo: "no llegó ningún header de firma" };

  const claves = formasDelSecreto(secret);
  const conMarca = parsearFirmaConMarca(signature);

  if (conMarca) {
    const fuera = fueraDeVentana(conMarca.t, ahora);
    if (fuera) return { ok: false, motivo: fuera };

    // Se firma el timestamp junto al cuerpo: eso es lo que ata la firma a un
    // momento y evita que una entrega vieja se reenvíe.
    if (claves.some((clave) => coincide(conMarca.s, `${conMarca.t}.${rawBody}`, clave))) {
      return { ok: true };
    }
    return { ok: false, motivo: "la firma no coincide con el secreto del webhook de YCloud" };
  }

  if (id && timestamp) {
    const fuera = fueraDeVentana(timestamp, ahora);
    if (fuera) return { ok: false, motivo: fuera };

    if (claves.some((clave) => coincide(signature, `${id}.${timestamp}.${rawBody}`, clave))) {
      return { ok: true };
    }
    return { ok: false, motivo: "la firma no coincide con el secreto del webhook de YCloud" };
  }

  if (claves.some((clave) => coincide(signature, rawBody, clave))) return { ok: true };

  return {
    ok: false,
    motivo: "llegó una firma pero no coincide con ninguno de los esquemas conocidos",
  };
}

/** `t=1787061200,s=f978…` → sus dos partes. Devuelve null si no tiene esa forma. */
function parsearFirmaConMarca(header: string): { t: string; s: string } | null {
  const partes = new Map(
    header.split(",").map((parte) => {
      const corte = parte.indexOf("=");
      return corte === -1
        ? ([parte.trim(), ""] as const)
        : ([parte.slice(0, corte).trim(), parte.slice(corte + 1).trim()] as const);
    }),
  );

  const t = partes.get("t");
  const s = partes.get("s");
  return t && s ? { t, s } : null;
}

/**
 * Las formas en que un secreto `whsec_…` puede ser la clave del HMAC.
 *
 * Unos proveedores usan el texto entero, otros lo tratan como codificación de
 * unos bytes. Sin la documentación no se puede saber cuál, y equivocarse da un
 * 401 idéntico al de una firma falsa.
 */
function formasDelSecreto(secret: string): Buffer[] {
  const sinPrefijo = secret.replace(/^whsec_/, "");
  const formas = [Buffer.from(secret), Buffer.from(sinPrefijo)];

  if (/^[0-9a-f]+$/i.test(sinPrefijo) && sinPrefijo.length % 2 === 0) {
    formas.push(Buffer.from(sinPrefijo, "hex"));
  }
  formas.push(Buffer.from(sinPrefijo, "base64"));

  return formas.filter((forma) => forma.length > 0);
}

/** Sin esto, una entrega interceptada se puede reenviar cuando sea. */
function fueraDeVentana(timestamp: string, ahora: number): string | null {
  const enSegundos = Number(timestamp);
  if (!Number.isFinite(enSegundos)) return "el timestamp de la firma no es un número";
  if (Math.abs(ahora - enSegundos * 1000) > TOLERANCIA_MS) {
    return "la entrega está fuera de la ventana de tiempo aceptada";
  }
  return null;
}

/**
 * Compara la firma recibida contra el HMAC del contenido.
 *
 * El header trae una lista separada por espacios (`v1,<firma> v1,<firma>`):
 * puede haber más de una durante una rotación de secreto. Y se prueban base64 y
 * hex porque el mismo HMAC se escribe de las dos formas según el proveedor.
 */
function coincide(header: string, contenido: string, clave: Buffer): boolean {
  const esperada = createHmac("sha256", clave).update(contenido).digest();

  return header.split(" ").some((parte) => {
    // Se saca el `v1,` si está; si no, la parte entera es la firma.
    const valor = parte.includes(",") ? parte.slice(parte.indexOf(",") + 1) : parte;
    if (!valor) return false;

    return (["base64", "hex"] as const).some((codificacion) => {
      const recibida = Buffer.from(valor, codificacion);
      // timingSafeEqual exige longitudes iguales; distinta longitud ya es inválida.
      return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
    });
  });
}
