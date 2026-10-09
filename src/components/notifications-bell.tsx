"use client";

import {
  Bell,
  BellRing,
  CalendarPlus,
  Check,
  ListTodo,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  markAppointmentSeen,
  markConversationAttended,
  markConversationRead,
  markTasksSeen,
} from "@/app/actions";
import { CHANNEL_LABELS, avatarColor, dateTime, initials } from "@/components/ui";
import type { ChatSinLeerRow, CitaNuevaRow, HandoffRow } from "@/lib/crm-data";
import { masNuevasPrimero } from "@/lib/novedades";
import type { TareaRow } from "@/lib/tareas";
import { usePreference } from "@/lib/use-preference";

const PREF_SONIDO = "leon-crm:sonido-derivacion";

type PushState = "loading" | "off" | "on" | "denied" | "unsupported" | "unconfigured" | "error";

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function pushConfig(): Promise<{ configured: boolean; publicKey: string | null }> {
  const response = await fetch("/api/push-subscriptions", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "No se pudo comprobar la configuración.");
  return payload;
}

async function saveSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "No se pudo guardar este dispositivo.");
}

/** Un renglón de la campana, sea del tipo que sea. */
type Novedad =
  | { tipo: "cita"; cuando: string; cita: CitaNuevaRow }
  | { tipo: "tarea"; cuando: string | null; tarea: TareaRow }
  | { tipo: "derivacion"; cuando: string; handoff: HandoffRow }
  | { tipo: "mensaje"; cuando: string; chat: ChatSinLeerRow };

/** Cuánto hace, en corto. Lo que entra al costado de un nombre sin romper la fila. */
function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

/**
 * Un bip corto, generado en el momento.
 *
 * Sintetizado y no un archivo de audio para no meter un binario en el repo por
 * medio segundo de sonido. Se crea un contexto por vez y se cierra solo: los
 * navegadores limitan cuántos puede haber abiertos a la vez.
 */
function bip() {
  try {
    const contexto = new AudioContext();
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();

    oscilador.frequency.value = 880;
    volumen.gain.setValueAtTime(0.0001, contexto.currentTime);
    volumen.gain.exponentialRampToValueAtTime(0.2, contexto.currentTime + 0.01);
    volumen.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + 0.35);

    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.36);
    oscilador.onended = () => void contexto.close();
  } catch {
    // Sin permiso de audio o sin AudioContext: el aviso visual alcanza.
  }
}

/**
 * La campana del header: derivaciones, mensajes sin leer, reservas y tareas.
 *
 * Los mensajes sin leer están acá y también en el globito de "Conversaciones",
 * pero la campana no los mezcla con las derivaciones: un mensaje sin leer es
 * cola de trabajo, una derivación es alguien esperando. Por eso el número se
 * pone rojo apenas hay una derivación, y cada derivación lo dice en su renglón.
 */
export function NotificationsBell({
  handoffs,
  chatsSinLeer,
  citasNuevas,
  tareasNuevas,
  timezone,
  onOpenChat,
  onOpenLead,
  onOpenTareas,
}: {
  handoffs: HandoffRow[];
  /** Chats con mensajes que nadie leyó, sin contar los derivados. */
  chatsSinLeer: ChatSinLeerRow[];
  /** Reservas de Calendar que todavía nadie miró. */
  citasNuevas: CitaNuevaRow[];
  /** Tareas que te pasó otra persona y todavía no viste. */
  tareasNuevas: TareaRow[];
  /** La zona del workspace: el turno se lee con la misma hora que el recordatorio. */
  timezone: string;
  onOpenChat: (handoff: HandoffRow) => void;
  onOpenLead: (contactId: string) => void;
  onOpenTareas: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sonido, setSonido] = usePreference(PREF_SONIDO);
  const [pushState, setPushState] = useState<PushState>("loading");
  const [pushError, setPushError] = useState("");
  const [prueba, setPrueba] = useState("");
  const [probando, setProbando] = useState(false);
  const [pushPending, setPushPending] = useState(false);
  const [, startTransition] = useTransition();

  // Null hasta el primer efecto: sirve para distinguir "recién cargó la página"
  // de "entró una derivación". Sin esto, abrir el CRM con tres pendientes de
  // ayer dispararía tres avisos del navegador.
  const conocidas = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ids = handoffs.map((item) => item.conversationId);

    if (conocidas.current === null) {
      conocidas.current = new Set(ids);
      return;
    }

    const nuevas = handoffs.filter((item) => !conocidas.current?.has(item.conversationId));
    conocidas.current = new Set(ids);
    if (nuevas.length === 0) return;

    if (sonido) bip();

  }, [handoffs, sonido]);

  useEffect(() => {
    let cancelled = false;

    const inspect = async () => {
      if (
        typeof Notification === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPushState("denied");
        return;
      }

      try {
        const config = await pushConfig();
        if (!config.configured || !config.publicKey) {
          if (!cancelled) setPushState("unconfigured");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await saveSubscription(subscription);
        if (!cancelled) setPushState(subscription ? "on" : "off");
      } catch (error) {
        if (!cancelled) {
          setPushError(error instanceof Error ? error.message : "No se pudieron preparar los avisos.");
          setPushState("error");
        }
      }
    };

    void inspect();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * El permiso se pide acá, con el clic, y nunca al cargar la página.
   *
   * Un pedido de permisos que aparece solo se rechaza por reflejo, y una vez
   * rechazado el navegador no deja volver a pedirlo desde el código: hay que ir
   * a la configuración a mano. Se rompe para siempre por apurarse.
   */
  const alternarAvisos = async () => {
    if (pushPending || pushState === "unsupported" || pushState === "unconfigured") return;
    setPushPending(true);
    setPushError("");

    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const existing = await registration.pushManager.getSubscription();

      if (pushState === "on" && existing) {
        const response = await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "No se pudieron desactivar los avisos.");
        await existing.unsubscribe();
        setPushState("off");
        return;
      }

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "off");
        return;
      }

      const config = await pushConfig();
      if (!config.configured || !config.publicKey) {
        setPushState("unconfigured");
        return;
      }

      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.publicKey),
        }));
      await saveSubscription(subscription);
      setPushState("on");
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "No se pudieron cambiar los avisos.");
      setPushState("error");
    } finally {
      setPushPending(false);
    }
  };

  const atender = (item: HandoffRow) => {
    setOpen(false);
    onOpenChat(item);
    startTransition(async () => {
      await markConversationAttended({ id: item.conversationId });
    });
  };

  const hayAlgo =
    handoffs.length > 0 ||
    chatsSinLeer.length > 0 ||
    citasNuevas.length > 0 ||
    tareasNuevas.length > 0;

  // El número cuenta chats: los derivados y los que tienen mensajes sin leer.
  const chatsEnEspera = handoffs.length + chatsSinLeer.length;

  // Todo en una sola lista y lo último arriba, como se lee cualquier lista de
  // avisos. Antes iban en bloques por tipo y lo nuevo podía quedar al fondo.
  const novedades = masNuevasPrimero<Novedad>(
    [
      ...citasNuevas.map((cita) => ({ tipo: "cita" as const, cuando: cita.createdAt, cita })),
      ...tareasNuevas.map((tarea) => ({
        tipo: "tarea" as const,
        cuando: tarea.actualizadaAt,
        tarea,
      })),
      ...handoffs.map((handoff) => ({
        tipo: "derivacion" as const,
        cuando: handoff.updatedAt,
        handoff,
      })),
      ...chatsSinLeer.map((chat) => ({ tipo: "mensaje" as const, cuando: chat.updatedAt, chat })),
    ],
    (novedad) => novedad.cuando,
  );

  /* Se marca vista al ir a Tareas y no antes: la sección es la que muestra la
     etiqueta de "Nueva", y llegar con la tarea ya marcada la escondería. */
  const verTareas = () => {
    setOpen(false);
    onOpenTareas();
  };

  /* No hace falta marcarlo leído desde acá: el chat se marca solo al abrirse,
     igual que cuando se entra desde la bandeja. */
  const leerChat = (item: ChatSinLeerRow) => {
    setOpen(false);
    onOpenChat(item);
  };

  const verCita = (item: CitaNuevaRow) => {
    setOpen(false);
    onOpenLead(item.contactId);
    startTransition(async () => {
      await markAppointmentSeen({ id: item.appointmentId });
    });
  };

  const atenderTodas = () => {
    setOpen(false);
    startTransition(async () => {
      await Promise.all([
        ...handoffs.map((item) => markConversationAttended({ id: item.conversationId })),
        ...chatsSinLeer.map((item) => markConversationRead({ id: item.conversationId })),
        ...citasNuevas.map((item) => markAppointmentSeen({ id: item.appointmentId })),
        markTasksSeen({ ids: tareasNuevas.map((item) => item.id) }),
      ]);
    });
  };

  /**
   * Dispara un aviso a este mismo dispositivo y muestra lo que contestó Google.
   *
   * El resultado se escribe en pantalla incluso cuando sale bien, porque "salió
   * bien" y "me llegó" son dos cosas distintas: el servicio puede aceptar el
   * envío y el teléfono descartarlo igual por la configuración de Android. Sin
   * ver el primer tramo no hay forma de saber cuál de los dos falló.
   */
  const probarAviso = async () => {
    if (probando) return;
    setProbando(true);
    setPrueba("");

    try {
      const response = await fetch("/api/push-subscriptions/probar", { method: "POST" });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPrueba(payload.error ?? "No se pudo enviar la prueba.");
        return;
      }

      const resultados = (payload.resultados ?? []) as { dispositivo: string; ok: boolean; detalle: string }[];
      setPrueba(
        resultados
          .map((r) => `${r.ok ? "OK" : "Falló"} · ${r.dispositivo}: ${r.detalle}`)
          .join("\n"),
      );
    } catch (error) {
      setPrueba(error instanceof Error ? error.message : "No se pudo enviar la prueba.");
    } finally {
      setProbando(false);
    }
  };

  const pushHelp: Record<PushState, string> = {
    loading: "Comprobando este dispositivo…",
    off: "Activá los avisos para enterarte aunque el CRM esté cerrado.",
    on: "Este dispositivo recibe avisos aunque el CRM esté cerrado.",
    denied: "El navegador bloqueó los avisos. Habilitalos desde el candado de la barra.",
    unsupported: "Este navegador no admite avisos push. En iPhone, agregá el CRM a Inicio.",
    unconfigured: "Los avisos push todavía no están configurados en el servidor.",
    error: pushError || "No se pudo comprobar este dispositivo. Intentá nuevamente.",
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={
          chatsEnEspera > 0
            ? [
                handoffs.length > 0 && `${handoffs.length} chats derivados esperando`,
                chatsSinLeer.length > 0 && `${chatsSinLeer.length} chats con mensajes sin leer`,
              ]
                .filter(Boolean)
                .join(", ")
            : "Sin chats esperando"
        }
        className={`relative grid size-10 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-neutral-200 dark:hover:bg-white/10 ${
          handoffs.length > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-500"
        }`}
      >
        {chatsEnEspera > 0 ? <BellRing className="size-5" /> : <Bell className="size-5" />}
        {/* El número y no un punto: tres personas esperando es una decisión
            distinta a una sola, y el punto no deja distinguirlas. Rojo si
            alguna es una derivación; si son sólo mensajes, el color del globito
            de "Conversaciones". */}
        {chatsEnEspera > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold ${
              handoffs.length > 0 ? "bg-red-600 text-white" : "bg-amber-500 text-neutral-950"
            }`}
          >
            {chatsEnEspera > 9 ? "9+" : chatsEnEspera}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            aria-label="Cerrar notificaciones"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* En el celular ocupa el ancho de la pantalla: un desplegable de
              300px colgando de una esquina no se puede ni leer ni tocar. */}
          <div className="fixed inset-x-2 top-[4.5rem] z-30 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-[#ddd8c9] bg-[#f9f8f3] shadow-xl dark:border-white/10 dark:bg-[#1c1811] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem]">
            <div className="flex items-center gap-2 border-b border-[#ddd8c9] px-4 py-3 dark:border-white/10">
              <h2 className="font-semibold">Novedades</h2>
              {hayAlgo && (
                <button
                  onClick={atenderTodas}
                  className="ml-auto cursor-pointer text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
                >
                  Marcar todas
                </button>
              )}
              <button
                aria-label="Cerrar"
                onClick={() => setOpen(false)}
                className={`cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 ${
                  hayAlgo ? "" : "ml-auto"
                }`}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!hayAlgo ? (
                <p className="px-4 py-10 text-center text-sm text-neutral-500">
                  Todo al día. Acá aparecen los mensajes nuevos, las reservas, las tareas que
                  te pasan y los chats que la IA no pudo resolver.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-white/10">
                  {novedades.map((novedad) => {
                    if (novedad.tipo === "cita") {
                      const item = novedad.cita;
                      return (
                        <li key={`cita-${item.appointmentId}`}>
                          <button
                            onClick={() => verCita(item)}
                            className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              <CalendarPlus className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="truncate text-sm font-medium">
                                  {item.contactName} reservó una cita
                                </span>
                                <Hace iso={item.createdAt} />
                              </span>
                              <span className="block truncate text-xs text-neutral-500">
                                {item.title}
                              </span>
                              <span
                                className="block text-xs text-neutral-400"
                                suppressHydrationWarning
                              >
                                Turno: {dateTime(item.startTime, timezone)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    }

                    if (novedad.tipo === "tarea") {
                      const item = novedad.tarea;
                      return (
                        <li key={`tarea-${item.id}`}>
                          <button
                            onClick={verTareas}
                            className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                              <ListTodo className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="truncate text-sm font-medium">
                                  Te pasaron una tarea
                                </span>
                                {item.actualizadaAt && <Hace iso={item.actualizadaAt} />}
                              </span>
                              <span className="block truncate text-xs text-neutral-500">
                                {item.titulo}
                                {item.contactName ? ` · ${item.contactName}` : ""}
                              </span>
                              <span
                                className="block text-xs text-neutral-400"
                                suppressHydrationWarning
                              >
                                Para: {dateTime(item.venceAt, timezone)}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    }

                    if (novedad.tipo === "mensaje") {
                      const item = novedad.chat;
                      return (
                        <li key={`mensaje-${item.conversationId}`}>
                          <button
                            onClick={() => leerChat(item)}
                            className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
                          >
                            <span
                              className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${avatarColor(
                                item.contactName,
                              )}`}
                            >
                              {initials(item.contactName)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <strong className="truncate text-sm">{item.contactName}</strong>
                                <Hace iso={item.updatedAt} />
                              </span>
                              <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500">
                                {item.lastMessage ?? "Sin mensajes de texto en este chat."}
                              </span>
                              <span className="mt-1 block text-[11px] font-medium text-neutral-400">
                                {CHANNEL_LABELS[item.channel]} ·{" "}
                                {item.sinLeer === 1
                                  ? "1 mensaje sin leer"
                                  : `${item.sinLeer} mensajes sin leer`}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    }

                    const item = novedad.handoff;
                    return (
                      <li key={`chat-${item.conversationId}`}>
                        <button
                          onClick={() => atender(item)}
                          className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
                        >
                          <span
                            className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${avatarColor(
                              item.contactName,
                            )}`}
                          >
                            {initials(item.contactName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <strong className="truncate text-sm">{item.contactName}</strong>
                              <Hace iso={item.updatedAt} />
                            </span>
                            {/* Lo último que dijo, para poder elegir cuál atender
                                primero sin abrir las tres. */}
                            <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500">
                              {item.lastMessage ?? "Sin mensajes de texto en este chat."}
                            </span>
                            <span className="mt-1 block text-[11px] font-medium text-neutral-400">
                              {CHANNEL_LABELS[item.channel]} ·{" "}
                              <span className="text-red-600 dark:text-red-400">
                                Derivado por la IA
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-[#ddd8c9] px-4 py-3 dark:border-white/10">
              <p
                role={pushState === "error" ? "alert" : "status"}
                className={`mb-2 text-xs leading-5 ${
                  pushState === "error" || pushState === "denied"
                    ? "text-red-600 dark:text-red-300"
                    : "text-neutral-500"
                }`}
              >
                {pushHelp[pushState]}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void alternarAvisos()}
                  disabled={
                    pushPending ||
                    pushState === "loading" ||
                    pushState === "denied" ||
                    pushState === "unsupported" ||
                    pushState === "unconfigured"
                  }
                  className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                    pushState === "on"
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-neutral-500"
                  }`}
                >
                  {pushState === "on" ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Bell className="size-3.5" />
                  )}
                  {pushPending
                    ? "Guardando…"
                    : pushState === "on"
                      ? "Avisos activados"
                      : "Activar avisos"}
                </button>
                {pushState === "on" && (
                  <button
                    type="button"
                    onClick={() => void probarAviso()}
                    disabled={probando}
                    className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-xs font-medium text-neutral-500 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="size-3.5" />
                    {probando ? "Enviando…" : "Probar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSonido(!sonido)}
                  className={`ml-auto flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    sonido ? "text-amber-700 dark:text-amber-400" : "text-neutral-500"
                  }`}
                >
                  {sonido ? (
                    <Volume2 className="size-3.5" />
                  ) : (
                    <VolumeX className="size-3.5" />
                  )}
                  Sonido
                </button>
              </div>
              {prueba && (
                <p
                  role="status"
                  className="mt-2 whitespace-pre-wrap text-xs leading-5 text-neutral-500"
                >
                  {prueba}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** El "hace cuánto" de la esquina de cada aviso: es lo que explica el orden. */
function Hace({ iso }: { iso: string }) {
  return (
    <span suppressHydrationWarning className="ml-auto shrink-0 text-[11px] text-neutral-400">
      {haceCuanto(iso)}
    </span>
  );
}
