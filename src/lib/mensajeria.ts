import "server-only";

import { conPlantillas, type ComponenteSaliente } from "@/lib/plantillas";
import { sendWahaAudio, sendWahaMedia, sendWahaMessage } from "@/lib/waha-api";
import {
  sendYcloudAudio,
  sendYcloudMedia,
  sendYcloudMessage,
  sendYcloudTemplate,
} from "@/lib/ycloud-api";
import { sendZernioAttachment, sendZernioMessage, type SendResult } from "@/lib/zernio-api";
import { explicarReconciliacion, reconciliarCuentaZernio } from "@/lib/zernio-cuentas";

/**
 * Despacho de mensajes salientes por proveedor.
 *
 * Hasta acá responder era llamar directo a la API de Zernio desde cada lugar
 * que enviaba. Con un segundo proveedor eso deja de servir: la misma bandeja
 * tiene conversaciones que se contestan por caminos distintos, y quien envía no
 * tiene por qué saber cuál.
 *
 * La coordenada de cada conversación vive en `conversations.provider`, que el
 * webhook escribe cuando la crea.
 */

export type Proveedor = "zernio" | "ycloud" | "waha";

export type { SendResult };

/**
 * Normaliza lo que vino de la base.
 *
 * Cae en Zernio ante `null` o cualquier valor desconocido: las conversaciones
 * anteriores a la columna no la tienen cargada, y son todas de Zernio. Un valor
 * que no reconocemos es un bug nuestro, no motivo para dejar de responder.
 */
export function proveedorDe(valor: string | null | undefined): Proveedor {
  if (valor === "ycloud" || valor === "waha") return valor;
  return "zernio";
}

/** Coordenadas de envío. Los nombres son de Zernio por historia; ver la migración. */
type Destino = {
  provider: string | null | undefined;
  /** Id de la conversación en el proveedor. En YCloud, el teléfono en E.164. */
  conversationId: string;
  /** Cuenta del proveedor por la que salir. En YCloud, el número propio. */
  accountId: string;
};

export async function enviarTexto(input: Destino & { text: string }): Promise<SendResult> {
  switch (proveedorDe(input.provider)) {
    case "zernio":
      return conCuentaAlDia(input, (accountId) =>
        sendZernioMessage({
          conversationId: input.conversationId,
          accountId,
          text: input.text,
        }),
      );
    case "ycloud":
      // En YCloud la conversación es el par de números: la cuenta es el
      // nuestro y el "id de conversación" es el del contacto.
      return sendYcloudMessage({
        from: input.accountId,
        to: input.conversationId,
        text: input.text,
      });
    case "waha":
      return sendWahaMessage({
        accountId: input.accountId,
        chatId: input.conversationId,
        text: input.text,
      });
  }
}

export async function enviarAudio(
  input: Destino & {
    audioUrl: string;
    /** Sólo para OGG/Opus. Manda el audio como nota de voz y no como adjunto. */
    voiceNote?: boolean;
    caption?: string;
  },
): Promise<SendResult> {
  switch (proveedorDe(input.provider)) {
    case "zernio":
      return conCuentaAlDia(input, (accountId) =>
        sendZernioAttachment({
          conversationId: input.conversationId,
          accountId,
          attachmentUrl: input.audioUrl,
          attachmentType: "audio",
          voiceNote: input.voiceNote,
          caption: input.caption,
        }),
      );
    case "ycloud":
      return sendYcloudAudio({
        from: input.accountId,
        to: input.conversationId,
        audioUrl: input.audioUrl,
      });
    case "waha":
      // WAHA no necesita el interruptor: convierte cualquier formato y lo
      // manda siempre como nota de voz.
      return sendWahaAudio({
        accountId: input.accountId,
        chatId: input.conversationId,
        audioUrl: input.audioUrl,
      });
  }
}

/**
 * Manda una imagen o un video a una conversación, por donde sea que salga.
 *
 * Va aparte de `enviarAudio` y no como un parámetro suyo porque lo que cambia
 * no es sólo el tipo: el audio lleva el interruptor de nota de voz y una
 * traducción de formato antes de salir, y la imagen lleva un caption que el
 * audio no tiene en los tres canales. Un solo `enviarAdjunto` con los dos
 * juegos de parámetros sería una función donde la mitad no aplica nunca.
 *
 * El caption viaja pegado al archivo en vez de mandarse como un segundo
 * mensaje: así llega en una sola burbuja y no puede llegar desordenado.
 */
export async function enviarMedia(
  input: Destino & {
    kind: "imagen" | "video";
    url: string;
    /** El mime del archivo. Lo necesita WAHA para armar el mensaje. */
    mimeType: string;
    caption?: string;
  },
): Promise<SendResult> {
  switch (proveedorDe(input.provider)) {
    case "zernio":
      return conCuentaAlDia(input, (accountId) =>
        sendZernioAttachment({
          conversationId: input.conversationId,
          accountId,
          attachmentUrl: input.url,
          attachmentType: input.kind === "imagen" ? "image" : "video",
          caption: input.caption,
        }),
      );
    case "ycloud":
      return sendYcloudMedia({
        from: input.accountId,
        to: input.conversationId,
        kind: input.kind,
        url: input.url,
        caption: input.caption,
      });
    case "waha":
      return sendWahaMedia({
        accountId: input.accountId,
        chatId: input.conversationId,
        kind: input.kind,
        url: input.url,
        mimeType: input.mimeType,
        caption: input.caption,
      });
  }
}

/**
 * Envía por Zernio y, si rechaza la cuenta, la reata y reintenta una vez.
 *
 * Reconectar un perfil en Zernio le cambia el id a la cuenta. Los hilos que ya
 * existían quedan apuntando al viejo y Zernio los rechaza con 403, así que la
 * bandeja entera deja de poder responder de un momento a otro sin que haya
 * cambiado nada en el CRM.
 *
 * El reintento es seguro porque el 403 es previo al envío: el mensaje no salió,
 * no hay forma de que el contacto lo reciba dos veces. Y es sólo uno: si la
 * cuenta nueva también falla, el problema es la key y no el id.
 *
 * Sólo Zernio lo necesita. En YCloud y WAHA la cuenta es el número propio o el
 * nombre de la sesión, y ninguno cambia solo.
 */
async function conCuentaAlDia(
  destino: Destino,
  enviar: (accountId: string) => Promise<SendResult>,
): Promise<SendResult> {
  const primero = await enviar(destino.accountId);
  // Sólo un rechazo por la cuenta se puede arreglar reatándola. El otro 403 que
  // devuelve Zernio es la ventana de 24 horas de Meta, y ahí reintentar con
  // otra cuenta no cambia nada: sería un pedido de más y, peor, un cartel
  // hablando de ids cuando el problema es que el contacto no escribe hace un día.
  if (primero.ok || primero.causa !== "cuenta") return primero;

  const reconciliacion = await reconciliarCuentaZernio({
    chatId: destino.conversationId,
    cuentaGuardada: destino.accountId,
  });

  // No había id viejo que arreglar. El 403 se devuelve con lo que averiguamos
  // en el camino: es lo que distingue esta causa de la otra.
  if (reconciliacion.estado !== "reatada") {
    return { ...primero, error: `${primero.error} ${explicarReconciliacion(reconciliacion)}`.trim() };
  }

  console.warn("[zernio] la cuenta cambió de id; se reintenta el envío", {
    antes: destino.accountId,
    ahora: reconciliacion.cuenta,
  });

  return enviar(reconciliacion.cuenta);
}

/**
 * Si el canal admite plantillas aprobadas.
 *
 * Sólo WhatsApp oficial. Quien envía lo pregunta antes para poder resolverlo a
 * su manera: la bandeja no ofrece el botón, y una automatización manda el texto
 * de la plantilla como mensaje común en vez de fallar.
 */
export function admitePlantillas(provider: string | null | undefined): boolean {
  return conPlantillas(provider);
}

/**
 * Manda una plantilla aprobada.
 *
 * Sólo existe en WhatsApp: es un mecanismo de Meta para poder escribir fuera de
 * la ventana de 24 horas, y ni Instagram ni Messenger tienen equivalente. Por
 * eso Zernio devuelve un error explicando el motivo en vez de intentarlo.
 */
export async function enviarPlantilla(
  input: Destino & { nombre: string; idioma: string; components: ComponenteSaliente[] },
): Promise<SendResult> {
  switch (proveedorDe(input.provider)) {
    case "zernio":
      return {
        ok: false,
        error: "Las plantillas son de WhatsApp: esta conversación no las admite.",
      };
    case "ycloud":
      return sendYcloudTemplate({
        from: input.accountId,
        to: input.conversationId,
        nombre: input.nombre,
        idioma: input.idioma,
        components: input.components,
      });
    case "waha":
      return {
        ok: false,
        error: "Las plantillas oficiales sólo están disponibles en las conversaciones de YCloud.",
      };
  }
}
