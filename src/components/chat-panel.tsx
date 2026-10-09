"use client";

import { Bot, Clock3, FileText, MessageSquareMore, Send, Sparkles } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  loadThread,
  markConversationRead,
  sendChatMessage,
  sendMediaMessage,
  sendVoiceMessage,
  suggestReply,
  type ThreadMessage,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { MediaAttachment, useMediaKind } from "@/components/media-attachment";
import { MediaPicker } from "@/components/media-picker";
import { PlantillasPicker } from "@/components/plantillas-panel";
import { conPlantillas } from "@/lib/plantillas";
import { EmptyState } from "@/components/ui";
import { VoiceRecorder } from "@/components/voice-recorder";
import { grabacionAWav } from "@/lib/audio/a-wav";
import { usePolling, useRealtimeInserts } from "@/lib/use-realtime";
import {
  silenceLabelSince,
  silenceStateSince,
  ventanaCerrada,
  ventanaSinAbrir,
  type SilenceState,
} from "@/lib/ventana-meta";
import type { Channel, SenderType } from "@/types/database";

/** Lo mínimo que necesita el hilo: sirve tanto a la bandeja como al lead. */
export type ChatTarget = {
  id: string;
  contactName: string;
  unreadCount: number;
  channel: Channel;
  /** Por dónde sale. Decide si hay plantillas cuando la ventana está cerrada. */
  provider?: string | null;
  lastContactMessageAt?: string | null;
};

/**
 * Hilo de una conversación con su caja de respuesta.
 *
 * El historial se pide a demanda al abrir el chat: cargarlo junto al resto del
 * dashboard significaría traer todos los mensajes de todos los chats en cada
 * render.
 *
 * No trae encabezado propio a propósito: se usa embebido tanto en la tarjeta de
 * lead como en la bandeja, y cada una pone el suyo.
 */
export function ChatThread({
  conversation,
  onNotice,
  className = "h-[60vh]",
}: {
  conversation: ChatTarget;
  onNotice: (message: string) => void;
  className?: string;
}) {
  const access = useAccess();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [sending, startSending] = useTransition();
  // Con el grabador o el adjunto abiertos la barra es suya: la caja de texto y
  // los botones se corren para que el reloj, el reproductor o la vista previa
  // entren sin apretarse.
  const [grabando, setGrabando] = useState(false);
  const [adjuntando, setAdjuntando] = useState(false);
  const barraOcupada = grabando || adjuntando;
  const [suggesting, startSuggesting] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  // Las plantillas son la única salida cuando pasaron 24 horas del último
  // mensaje del contacto: WhatsApp rechaza el texto libre después de eso.
  const [plantillas, setPlantillas] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // El componente se monta de nuevo por cada conversación (`key` en el padre),
  // así que el estado ya arranca limpio y el efecto solo dispara la carga.
  useEffect(() => {
    let active = true;

    loadThread({ conversationId: conversation.id }).then((result) => {
      // El chat pudo cerrarse mientras cargaba: sin esto se escribiría sobre
      // el estado de otra conversación.
      if (!active) return;
      if (result.ok) setMessages(result.messages);
      else setLoadError(result.error);
      setLoading(false);
    });

    if (conversation.unreadCount > 0) void markConversationRead({ id: conversation.id });

    return () => {
      active = false;
    };
  }, [conversation.id, conversation.unreadCount]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /**
   * La caja crece con lo que se escribe, hasta el tope que le pone `max-h-32`.
   *
   * En el celular la caja mide media pantalla: con una sola línea, un mensaje de
   * tres renglones se leía por una ventanita que se iba corriendo sola. Se hace
   * a mano y no con `field-sizing`, que todavía no está en todos los
   * navegadores.
   */
  useEffect(() => {
    const box = composerRef.current;
    if (!box) return;
    box.style.height = "auto";
    // `scrollHeight` mide el contenido, que con una linea escrita es mas bajo
    // que el minimo de la caja en el celular. Sin este piso, escribir la
    // achicaria de golpe apenas se toca la primera tecla.
    box.style.height = `${Math.max(box.scrollHeight, box.clientHeight)}px`;
  }, [text, barraOcupada]);

  /**
   * Un mensaje que entra por el webhook aparece solo, sin recargar.
   *
   * También llegan UPDATE: un audio o una foto se guardan primero con un
   * marcador y unos segundos después el webhook los reemplaza por su
   * transcripción. Por eso la fila conocida se pisa en vez de descartarse.
   */
  const onRealtimeMessage = useCallback((row: Record<string, unknown>) => {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return;

    const incoming: ThreadMessage = {
      id,
      senderType: (row.sender_type as SenderType) ?? "contact",
      content: typeof row.content === "string" ? row.content : "",
      mediaUrl: typeof row.media_url === "string" ? row.media_url : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    };

    setMessages((current) =>
      current.some((message) => message.id === id)
        ? current.map((message) => (message.id === id ? incoming : message))
        : [...current, incoming],
    );
  }, []);

  const enVivo = useRealtimeInserts(
    "messages",
    `conversation_id=eq.${conversation.id}`,
    onRealtimeMessage,
  );

  /**
   * Red de seguridad del socket.
   *
   * Es una sola consulta al hilo abierto, pero cada una pasa por la sesión, la
   * membresía y el hilo: tres pedidos a Supabase. Cada ocho segundos con el
   * chat abierto todo el día llenaba los logs del plan gratis, así que con el
   * socket arriba —que es casi siempre— espacia a un minuto, y vuelve a ocho
   * apenas el canal se cae. No pisa la caja de texto ni el scroll: sólo
   * reemplaza la lista si de verdad cambió, para no re-renderizar de gusto.
   */
  usePolling(() => {
    void loadThread({ conversationId: conversation.id }).then((result) => {
      if (!result.ok) return;
      setMessages((current) =>
        current.length === result.messages.length &&
        current[current.length - 1]?.id === result.messages[result.messages.length - 1]?.id &&
        current[current.length - 1]?.content === result.messages[result.messages.length - 1]?.content
          ? current
          : result.messages,
      );
    });
  }, enVivo ? 60000 : 8000);

  /**
   * Pide una respuesta al modelo y la deja en la caja de texto.
   *
   * No la manda: la sugerencia se revisa y se edita antes de salir. El armado
   * del pedido vive en el servidor, igual que el de la respuesta automática,
   * así las dos usan las mismas instrucciones y el mismo historial.
   */
  const suggest = () => {
    startSuggesting(async () => {
      const result = await suggestReply({ conversationId: conversation.id });
      if (result.ok) setText(result.text);
      else onNotice(result.error);
    });
  };

  /**
   * Manda la nota de voz ya grabada.
   *
   * El audio viaja en base64 por una Server Action. Es más pesado que subirlo
   * directo desde el navegador —un tercio más— pero deja el guardado, el envío
   * a Zernio y la transcripción en un solo lugar del servidor, con el mismo
   * control de permisos que el resto.
   */
  const enviarAudio = useCallback(
    async (grabacion: Blob, mimeGrabado: string) => {
      // Instagram y Messenger rechazan el WebM y el OGG que graba el navegador:
      // para esos canales sale en WAV. WhatsApp se queda con el OGG, que es lo
      // que necesita para mostrarlo como nota de voz.
      let blob = grabacion;
      let mimeType = mimeGrabado;
      if (conversation.channel !== "whatsapp") {
        const wav = await grabacionAWav(grabacion);
        if (!wav) {
          onNotice("No se pudo preparar el audio para este canal.");
          return false;
        }
        blob = wav;
        mimeType = "audio/wav";
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onerror = () => reject(new Error("No se pudo leer la grabación."));
        // readAsDataURL devuelve "data:audio/webm;base64,AAAA…": sólo va la cola.
        lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
        lector.readAsDataURL(blob);
      }).catch(() => "");

      if (!base64) {
        onNotice("No se pudo leer la grabación.");
        return false;
      }

      const result = await sendVoiceMessage({
        conversationId: conversation.id,
        audio: base64,
        mimeType,
      });

      if (!result.ok) {
        onNotice(result.error);
        return false;
      }

      if (result.warning) onNotice(result.warning);

      const refreshed = await loadThread({ conversationId: conversation.id });
      if (refreshed.ok) setMessages(refreshed.messages);
      return true;
    },
    [conversation.id, conversation.channel, onNotice],
  );

  /**
   * Manda la imagen o el video ya elegidos.
   *
   * El archivo viaja en un `FormData` y no en base64 como la nota de voz: pasar
   * un video de dieciséis megas a texto lo deja en veintiuno, y el tope del
   * cuerpo de una Server Action no da para eso.
   */
  const enviarAdjunto = useCallback(
    async (archivo: File, caption: string) => {
      const form = new FormData();
      form.set("conversationId", conversation.id);
      form.set("archivo", archivo);
      form.set("caption", caption);

      const result = await sendMediaMessage(form);

      if (!result.ok) {
        onNotice(result.error);
        return false;
      }

      if (result.warning) onNotice(result.warning);

      const refreshed = await loadThread({ conversationId: conversation.id });
      if (refreshed.ok) setMessages(refreshed.messages);
      return true;
    },
    [conversation.id, onNotice],
  );

  const send = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    startSending(async () => {
      const result = await sendChatMessage({ conversationId: conversation.id, text: trimmed });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      setText("");
      if (result.warning) onNotice(result.warning);

      const refreshed = await loadThread({ conversationId: conversation.id });
      if (refreshed.ok) setMessages(refreshed.messages);
    });
  };

  const lastContactMessageAt =
    [...messages].reverse().find((message) => message.senderType === "contact")?.createdAt ??
    conversation.lastContactMessageAt ??
    null;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* `fondo-chat` son los dibujos de atrás, en globals.css. Van en el
          contenedor que scrollea y no en un div aparte: así el dibujo se queda
          quieto mientras los mensajes pasan por arriba. */}
      <div className="fondo-chat flex-1 space-y-3 overflow-y-auto bg-neutral-50 px-4 py-4 sm:px-5 dark:bg-black/20">
        {loading && <p className="text-center text-sm text-neutral-500">Cargando el historial…</p>}
        {loadError && <p className="text-center text-sm text-red-600">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <EmptyState
            icon={MessageSquareMore}
            title="Sin mensajes"
            description="Todavía no hay nada en este chat."
          />
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>

      <AvisoDeVentana
        lastContactMessageAt={lastContactMessageAt}
        now={now}
        channel={conversation.channel}
        plantillas={conPlantillas(conversation.provider)}
        cargado={!loading && !loadError}
      />

      {!access.can("responder_chats") ? (
        <p className="shrink-0 border-t border-[#ddd8c9] px-5 py-4 text-center text-sm text-neutral-500 dark:border-white/10">
          Podés leer esta conversación, pero no responderla. Es un permiso que da un administrador.
        </p>
      ) : (
        /* En el celular la caja se lleva la primera fila entera y los botones
           bajan a la segunda: apretados en una sola fila le quedaban cien
           píxeles y no entraba ni el placeholder. Por eso la caja va primera en
           el DOM y en escritorio vuelve a su lugar con `sm:order-*`, que además
           deja el foco en la caja al tabular. */
        <form
          onSubmit={send}
          className="flex shrink-0 flex-wrap items-end gap-2 border-t border-[#ddd8c9] p-3 sm:flex-nowrap sm:p-4 dark:border-white/10"
        >
          <label className="sr-only" htmlFor="chat-composer">
            Mensaje para {conversation.contactName}
          </label>

          {!barraOcupada && (
            <textarea
              id="chat-composer"
              ref={composerRef}
              rows={1}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Enter manda, como cuando esto era un `input`; Shift+Enter
                // corta la línea. El `isComposing` es por los teclados que
                // arman el caracter con Enter.
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              enterKeyHint="send"
              placeholder={suggesting ? "Pensando una respuesta…" : "Escribí tu respuesta…"}
              disabled={sending}
              className="max-h-32 min-h-16 w-full basis-full resize-none overflow-y-auto rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 text-base leading-6 outline-none transition focus:ring-2 focus:ring-amber-500 disabled:opacity-60 sm:order-1 sm:min-h-0 sm:basis-auto dark:border-white/10 dark:bg-white/5"
            />
          )}
          {!barraOcupada && (
            <button
              type="button"
              onClick={suggest}
              disabled={suggesting || sending}
              title="Sugerir una respuesta con IA"
              aria-label="Sugerir una respuesta con IA"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#ddd8c9] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
            >
              <Sparkles className={`size-4 ${suggesting ? "animate-pulse" : ""}`} />
            </button>
          )}

          {!barraOcupada && conversation.channel === "whatsapp" && (
            <button
              type="button"
              onClick={() => setPlantillas(true)}
              disabled={sending}
              title="Enviar una plantilla de WhatsApp"
              aria-label="Enviar una plantilla de WhatsApp"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#ddd8c9] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
            >
              <FileText className="size-4" />
            </button>
          )}

          {!adjuntando && (
            <VoiceRecorder
              disabled={sending}
              onSend={enviarAudio}
              onNotice={onNotice}
              onActiveChange={setGrabando}
            />
          )}

          {!grabando && (
            <MediaPicker
              disabled={sending}
              onSend={enviarAdjunto}
              onNotice={onNotice}
              onActiveChange={setAdjuntando}
            />
          )}

          {!barraOcupada && (
            <button
              type="submit"
              disabled={sending || text.trim().length === 0}
              aria-label="Enviar"
              className="ms-auto inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:ms-0"
            >
              <Send className="size-4" />
              {/* En el celular el botón queda suelto en la segunda fila, lejos
                  de la caja: con el sobre solo no se leía como "mandar". */}
              <span className="text-sm font-semibold sm:hidden">Enviar</span>
            </button>
          )}
        </form>
      )}

      {plantillas && (
        <PlantillasPicker
          conversationId={conversation.id}
          onClose={() => setPlantillas(false)}
          onNotice={onNotice}
          onSent={async () => {
            setPlantillas(false);
            const refreshed = await loadThread({ conversationId: conversation.id });
            if (refreshed.ok) setMessages(refreshed.messages);
          }}
        />
      )}
    </div>
  );
}

/**
 * Cuánto hace que no escribe el contacto, arriba del campo de texto.
 *
 * Con la ventana cerrada deja de ser un dato de color y pasa a ser la razón por
 * la que el mensaje no va a salir, así que lo dice en vez de sólo marcar el
 * tiempo: antes el aviso decía "escribió por última vez hace 2 d" y el motivo
 * recién aparecía después de mandar, en un error.
 *
 * Va en los tres canales. La ventana es de Meta, no de WhatsApp.
 */
function AvisoDeVentana({
  channel,
  lastContactMessageAt,
  now,
  plantillas,
  cargado,
}: {
  channel: Channel;
  lastContactMessageAt: string | null;
  now: number;
  /** Si esta conversación admite plantillas aprobadas. */
  plantillas: boolean;
  /** Si el historial ya está en pantalla. Sin esto el aviso parpadea al abrir. */
  cargado: boolean;
}) {
  const label = silenceLabelSince(lastContactMessageAt, now);
  const state = silenceStateSince(lastContactMessageAt, now);

  // El contacto nunca escribió, así que la ventana jamás se abrió. Pasa en los
  // chats que abrimos nosotros desde la bandeja, y según por dónde salgan hay
  // que decirlo antes de que escriban un mensaje que no va a salir.
  if (!label || !state) {
    const aviso = cargado ? ventanaSinAbrir(channel, plantillas) : null;
    if (!aviso) return null;
    return (
      <div className={`shrink-0 border-t px-4 py-2 text-xs font-medium sm:px-5 ${NOTICE_TONES.expired}`}>
        <Clock3 className="mr-1 inline size-3.5 align-text-bottom" />
        {aviso}
      </div>
    );
  }

  return (
    <div className={`shrink-0 border-t px-4 py-2 text-xs font-medium sm:px-5 ${NOTICE_TONES[state]}`}>
      {state === "expired" ? (
        <>
          <Clock3 className="mr-1 inline size-3.5 align-text-bottom" />
          {ventanaCerrada(channel)} El contacto escribió por última vez {label}.
        </>
      ) : (
        <>El contacto escribió por última vez {label}.</>
      )}
    </div>
  );
}

const NOTICE_TONES: Record<SilenceState, string> = {
  fresh: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  warm: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300",
  risk: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300",
  expired: "border-[#ddd8c9] bg-neutral-100 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-neutral-300",
};

/** A partir de acá el texto de una imagen se muestra plegado. */
const DESCRIPCION_LARGA = 140;

/**
 * "8 oct · 15:00" abajo de cada globito. Con la hora sola no se sabía de qué
 * día era un mensaje viejo. El año se agrega solo si no es el actual.
 */
function fechaDelMensaje(value: string) {
  const fecha = new Date(value);
  const dia = fecha.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: fecha.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  const hora = fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dia} · ${hora}`;
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const mine = message.senderType !== "contact";
  const kind = useMediaKind(message.mediaUrl);
  const [verTexto, setVerTexto] = useState(false);

  // Abajo de una foto, el texto no lo escribió nadie: es lo que la IA leyó en
  // ella, y puede ser un párrafo entero. Se deja a mano pero plegado, porque lo
  // que importa mirar es la imagen.
  const plegable = kind === "imagen" && message.content.length > DESCRIPCION_LARGA;
  const mostrarTexto = Boolean(message.content) && (!plegable || verTexto);

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl border px-3.5 py-2.5 text-sm shadow-sm ${
          mine
            ? "border-[#ddd8c9] bg-[#f9f8f3] text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
            : "border-amber-500/40 bg-amber-100 text-amber-950 dark:border-amber-500/25 dark:bg-[#3a2b0e] dark:text-amber-50"
        }`}
      >
        {message.senderType === "ai" && (
          <span className="mb-1 flex items-center gap-1 text-[11px] opacity-80">
            <Bot className="size-3" />
            Agente IA
          </span>
        )}
        {mostrarTexto && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        {message.mediaUrl && (
          <MediaAttachment
            messageId={message.id}
            url={message.mediaUrl}
            kind={kind}
            mine={mine}
          />
        )}
        {plegable && (
          <button
            type="button"
            onClick={() => setVerTexto((actual) => !actual)}
            className="mt-1 cursor-pointer text-[11px] underline opacity-80 transition-opacity hover:opacity-100"
          >
            {verTexto ? "Ocultar lo que dice la imagen" : "Ver lo que dice la imagen"}
          </button>
        )}
        <span
          suppressHydrationWarning
          className="mt-1 block text-[11px] text-neutral-500 dark:text-neutral-400"
        >
          {fechaDelMensaje(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
