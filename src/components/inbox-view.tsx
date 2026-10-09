"use client";

import {
  ArrowLeft,
  BarChart3,
  Bot,
  BotOff,
  ChevronDown,
  Inbox,
  ListFilter,
  ListPlus,
  ListTodo,
  Mail,
  MailBadge,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Phone,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";

import {
  loadLead,
  markConversationUnread,
  setContactBot,
  setConversationStarred,
  startContactConversation,
  updateContact,
  updateOpportunityDetails,
  updateOpportunityStage,
  type LeadDetail,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { ChatThread, type ChatTarget } from "@/components/chat-panel";
import { DeleteContactModal } from "@/components/delete-contact-modal";
import { OpcionesDeEtapa } from "@/components/opciones-de-etapa";
import { ResponsableSelect } from "@/components/responsable";
import { TareasDelLead } from "@/components/tareas-panel";
import {
  CHANNEL_LABELS,
  ChannelBadges,
  EmptyState,
  avatarColor,
  dateTime,
  initials,
  money,
} from "@/components/ui";
import type { ContactRow, ConversationRow, StageRow } from "@/lib/crm-data";
import { sePuedeEscribirPrimero } from "@/lib/telefono";
import {
  silenceLabelSince,
  silenceStateSince,
  type SilenceState,
} from "@/lib/ventana-meta";

type Section = "principal" | "tareas" | "estadisticas" | "archivos";

/** Qué chats muestra la bandeja. */
type Orden = "reciente" | "sinResponder" | "favoritos";

const ORDENES: { id: Orden; label: string; vacio: string }[] = [
  { id: "reciente", label: "Todos", vacio: "Sin resultados." },
  { id: "sinResponder", label: "Solo sin responder", vacio: "No te queda ningún chat sin responder." },
  { id: "favoritos", label: "Solo favoritos", vacio: "Todavía no marcaste ningún chat con la estrella." },
];

const SECTIONS: { id: Section; label: string; icon: typeof UserRound }[] = [
  { id: "principal", label: "Principal", icon: UserRound },
  { id: "tareas", label: "Tareas", icon: ListTodo },
  { id: "estadisticas", label: "Estadísticas", icon: BarChart3 },
  { id: "archivos", label: "Archivos", icon: Paperclip },
];

/**
 * Bandeja de cuatro columnas: lista de chats, ficha del lead y conversación.
 *
 * Antes había que abrir la tarjeta de lead en un panel flotante para ver los
 * datos de quien te escribía, y eso tapaba el chat. Acá las tres cosas conviven:
 * se contesta mirando la ficha, que es como se trabaja de verdad.
 *
 * Debajo de xl no entran tres columnas, así que la ficha se pliega detrás de un
 * botón y quedan lista y chat.
 */
export function InboxView({
  conversations,
  pendingContacts,
  stages,
  timezone,
  openId,
  onOpenId,
  onNotice,
  onOpenTareas,
}: {
  conversations: ConversationRow[];
  pendingContacts: ContactRow[];
  stages: StageRow[];
  /** Zona del workspace: las tareas del lead se agrupan por su "hoy". */
  timezone: string;
  /** Qué chat mostrar. Lo decide el Workspace para que la campana pueda fijarlo. */
  openId: string | null;
  onOpenId: (conversationId: string | null) => void;
  onNotice: (message: string) => void;
  /** Lleva a la sección Tareas. */
  onOpenTareas: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [orden, setOrden] = useState<Orden>("reciente");

  // La estrella que acaba de tocar quien está mirando.
  //
  // El servidor ya la guardó, pero `conversations` llega del render anterior y
  // todavía la trae como estaba: sin esto la estrella se apaga sola por un
  // segundo hasta que vuelve el refresh, y parece que el clic no agarró.
  const [estrellas, setEstrellas] = useState<Record<string, boolean>>({});

  // Los chats que se acaban de dejar sin leer.
  //
  // Mismo motivo que las estrellas: `conversations` todavía los trae leídos y
  // sin esto el globito tarda un refresh en volver. Es un conjunto y no un id
  // suelto porque se marcan de a varios, uno atrás del otro.
  const [sinLeer, setSinLeer] = useState<Record<string, true>>({});

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // En un celular no entran la lista y el chat a la vez: cada uno ocupaba
  // media pantalla y los mensajes se apilaban en una columna de dos palabras de
  // ancho. Se muestra uno por vez, como en cualquier app de mensajería.
  //
  // Arranca en la lista a propósito: abrir el chat de alguien sin que lo hayan
  // pedido, además de tapar la lista, se lo marca como leído.
  const [panelMovil, setPanelMovil] = useState<"lista" | "chat">("lista");

  // Cuando el chat viene de afuera —el clic en una notificación de derivación—
  // hay que mostrarlo, no la lista. Se ajusta durante el render y no con un
  // efecto: así la primera pintada ya sale bien, sin el parpadeo de la lista.
  const [ultimoPedido, setUltimoPedido] = useState(openId);
  if (openId !== ultimoPedido) {
    setUltimoPedido(openId);
    if (openId !== null) setPanelMovil("chat");
  }

  // La conversación que acabamos de abrirle a un contacto pendiente.
  //
  // El servidor ya la creó, pero `conversations` viene del render anterior y
  // todavía no la tiene: sin esto la bandeja se abre en "ese chat ya no está
  // disponible" hasta que termina el refresh. Se pinta desde acá y el refresh
  // la reemplaza por la de verdad sin que se note.
  const [recienAbierta, setRecienAbierta] = useState<ConversationRow | null>(null);

  // La lista se mantiene al día sola: el dashboard escucha los cambios de
  // `conversations` en cualquier sección, porque la campana los necesita en
  // todas. Ver `useDatosEnVivo` en `dashboard-app.tsx`.

  /**
   * Deja el chat recién abierto seleccionado, como si acabara de entrar un
   * mensaje suyo.
   */
  const abrirPendiente = useCallback(
    (conversationId: string, provider: string, contact: ContactRow) => {
      setRecienAbierta({
        id: conversationId,
        contactId: contact.id,
        contactName: contact.name,
        channel: "whatsapp",
        provider,
        status: "open",
        unreadCount: 0,
        destacada: false,
        updatedAt: new Date().toISOString(),
        lastContactMessageAt: null,
        lastMessageAt: null,
      });
      onOpenId(conversationId);
      setPanelMovil("chat");
      router.refresh();
    },
    [onOpenId, router],
  );

  const chats =
    recienAbierta && !conversations.some((item) => item.id === recienAbierta.id)
      ? [recienAbierta, ...conversations]
      : conversations;

  // El contacto ya dejó de estar esperando: tiene chat, aunque la próxima carga
  // del dashboard todavía no lo haya notado.
  //
  // Los que no tienen teléfono quedan afuera de la lista: el botón sólo sabe
  // abrir chats de WhatsApp, así que a un contacto de Instagram lo ofrecía y
  // después el clic moría en "no tiene un teléfono válido". A ese no le falta
  // cargarle el número, le falta escribir.
  const pendientes = pendingContacts.filter(
    (item) => item.id !== recienAbierta?.contactId && sePuedeEscribirPrimero(item.phone),
  );

  const esDestacada = useCallback(
    (item: ConversationRow) => estrellas[item.id] ?? item.destacada,
    [estrellas],
  );

  const alternarEstrella = useCallback(
    async (item: ConversationRow) => {
      const destacada = !esDestacada(item);
      setEstrellas((previo) => ({ ...previo, [item.id]: destacada }));
      const result = await setConversationStarred({ id: item.id, destacada });
      if (!result.ok) {
        // Volver a lo que había: dejar la estrella encendida cuando no se
        // guardó es peor que no marcarla, porque el chat queda fijo arriba
        // sólo en esta pantalla.
        setEstrellas((previo) => ({ ...previo, [item.id]: !destacada }));
        onNotice(result.error);
        return;
      }
      router.refresh();
    },
    [esDestacada, onNotice, router],
  );

  /** Cuántos sin leer mostrar, contando el que se acaba de marcar a mano. */
  const noLeidos = useCallback(
    (item: ConversationRow) =>
      sinLeer[item.id] ? Math.max(item.unreadCount, 1) : item.unreadCount,
    [sinLeer],
  );

  /** Abrir un chat lo da por leído: deja de estar marcado a mano. */
  const olvidarMarca = useCallback((conversationId: string) => {
    setSinLeer((previo) => {
      if (!previo[conversationId]) return previo;
      const resto = { ...previo };
      delete resto[conversationId];
      return resto;
    });
  }, []);

  const term = query.trim().toLowerCase();
  const porNombre = term
    ? chats.filter((item) => item.contactName.toLowerCase().includes(term))
    : chats;

  /**
   * Qué chats deja pasar el desplegable.
   *
   * Recorta la lista en vez de sólo subir lo elegido: el pedido es ver una
   * bandeja con eso y nada más. Que quede vacía cuando no hay nada pendiente
   * es la respuesta correcta —no te queda nada por contestar—, y se vuelve a
   * la lista entera eligiendo "Todos".
   */
  const visibles = porNombre.filter((item) => {
    if (orden === "favoritos") return esDestacada(item);
    if (orden === "sinResponder") return noLeidos(item) > 0;
    return true;
  });

  // Por el último mensaje del hilo, no por `updatedAt`: ese lo pisa un trigger
  // en cada `update` de la fila, así que abrir un chat o ponerle la estrella
  // lo mandaba arriba de todo sin que nadie hubiera escrito. `updatedAt` queda
  // de respaldo para el chat que todavía no tiene ni un mensaje.
  const cuando = (item: ConversationRow) => item.lastMessageAt ?? item.updatedAt;
  const filtered = [...visibles].sort((a, b) => cuando(b).localeCompare(cuando(a)));

  const elegido = chats.find((item) => item.id === openId) ?? null;

  // Nada abierto hasta que alguien elige. La bandeja abría sola el primero de
  // la lista para no arrancar en blanco, pero abrir un chat lo marca leído:
  // entrar a la bandeja te borraba el globito del que estaba arriba sin que lo
  // hubieras mirado. Mejor el cartel de "elegí un chat" que un mensaje que se
  // pierde.
  const open = elegido;

  // El chat pudo reasignarse a otra persona, archivarse o cerrarse entre que
  // llegó la notificación y el clic. Sin este aviso la bandeja se abre en
  // blanco y parece un error de la app.
  const yaNoEsta = openId !== null && !elegido;

  /**
   * Devuelve un chat a la pila de pendientes.
   *
   * Se puede desde la lista, sin abrir nada: así se marcan varios de corrido.
   * El globito aparece en el acto y recién después vuelve el refresh con el
   * dato del servidor.
   *
   * Si el que se marca es el que estás mirando hay que soltarlo, porque el
   * panel lo da por leído apenas ve el contador en uno. Y con él se frena el
   * auto-abrir: si no, la bandeja agarraba el siguiente de la lista y le comía
   * el globito a ese.
   */
  const marcarSinLeer = async (conversationId: string) => {
    setSinLeer((previo) => ({ ...previo, [conversationId]: true }));

    if (conversationId === open?.id) {
      setShowDetail(false);
      setPanelMovil("lista");
      onOpenId(null);
    }

    const result = await markConversationUnread({ id: conversationId });
    if (!result.ok) {
      olvidarMarca(conversationId);
      onNotice(result.error);
      return;
    }
    router.refresh();
  };

  if (chats.length === 0 && pendientes.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Inbox}
          title="Bandeja vacía"
          description="Cargá un contacto y va a aparecer acá esperando su primer mensaje."
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100dvh-5rem)] overflow-hidden bg-[#f9f8f3] dark:bg-[#1c1811]">
      {/* Columna 1: la lista de chats. */}
      <div
        className={`w-full shrink-0 flex-col border-r border-[#ddd8c9] md:flex md:w-72 xl:w-80 dark:border-white/10 ${
          panelMovil === "chat" ? "hidden" : "flex"
        }`}
      >
        <div className="space-y-2 border-b border-[#ddd8c9] p-3 dark:border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              aria-label="Buscar conversaciones"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar"
              className="w-full rounded-lg border border-[#ddd8c9] bg-transparent py-2 pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10"
            />
          </div>

          <div className="relative">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <select
              aria-label="Filtrar conversaciones"
              value={orden}
              onChange={(event) => setOrden(event.target.value as Orden)}
              className="w-full cursor-pointer appearance-none rounded-lg border border-[#ddd8c9] bg-transparent py-2 pl-9 pr-8 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-[#1c1811]"
            >
              {ORDENES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {filtered.map((item) => {
            const destacada = esDestacada(item);
            return (
              <li
                key={item.id}
                className={`flex items-center border-b border-neutral-100 transition-colors dark:border-white/5 ${
                  item.id === openId
                    ? "bg-amber-50 dark:bg-amber-400/10"
                    : "hover:bg-neutral-50 dark:hover:bg-white/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    olvidarMarca(item.id);
                    onOpenId(item.id);
                    setPanelMovil("chat");
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-3 text-left"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-xl text-xs font-semibold ${avatarColor(item.contactName)}`}
                  >
                    {initials(item.contactName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.contactName}</span>
                    <span className="block text-xs text-neutral-500">
                      {CHANNEL_LABELS[item.channel]}
                    </span>
                    <SilenceBadge lastContactMessageAt={item.lastContactMessageAt} now={now} />
                  </span>
                  {noLeidos(item) > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-950">
                      {noLeidos(item)}
                    </span>
                  )}
                </button>
                {/* Afuera del botón del chat: uno adentro del otro no es HTML
                    válido y el clic en la estrella terminaba abriendo el chat.
                    Van en una columna angosta para que el nombre se quede con
                    el ancho, que es lo que se lee. */}
                <span className="flex shrink-0 flex-col items-center gap-0.5 px-1.5">
                  <button
                    type="button"
                    onClick={() => void marcarSinLeer(item.id)}
                    disabled={noLeidos(item) > 0}
                    title={noLeidos(item) > 0 ? "Ya figura sin leer" : "Marcar como no leído"}
                    className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-300 transition hover:text-amber-600 disabled:cursor-default disabled:opacity-0 dark:text-neutral-600"
                  >
                    <MailBadge className="size-4" />
                    <span className="sr-only">Marcar como no leído</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void alternarEstrella(item)}
                    aria-pressed={destacada}
                    title={destacada ? "Quitar de destacados" : "Destacar este chat"}
                    className={`grid size-7 cursor-pointer place-items-center rounded-lg transition ${
                      destacada
                        ? "text-amber-500"
                        : "text-neutral-300 hover:text-amber-500 dark:text-neutral-600"
                    }`}
                  >
                    <Star className={`size-4 ${destacada ? "fill-amber-500" : ""}`} />
                    <span className="sr-only">
                      {destacada ? "Quitar de destacados" : "Destacar este chat"}
                    </span>
                  </button>
                </span>
              </li>
            );
          })}

          {filtered.length === 0 && (
            <p className="p-4 text-center text-sm text-neutral-500">
              {term
                ? "Sin resultados."
                : (ORDENES.find((item) => item.id === orden)?.vacio ?? "Sin resultados.")}
            </p>
          )}

          {pendientes.length > 0 && !term && orden === "reciente" && (
            <li className="border-t border-[#ddd8c9] px-3 py-2 dark:border-white/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Esperando primer mensaje
              </p>
              <ul className="mt-1">
                {pendientes.slice(0, 10).map((contact) => (
                  <PendingContactRow
                    key={contact.id}
                    contact={contact}
                    onOpened={abrirPendiente}
                    onNotice={onNotice}
                  />
                ))}
              </ul>
            </li>
          )}
        </ul>
      </div>

      {open ? (
        <>
          {/* Columna 2: la ficha del lead, siempre al lado del chat. */}
          <LeadDetailColumn
            key={open.contactId}
            contactId={open.contactId}
            stages={stages}
            timezone={timezone}
            onNotice={onNotice}
            onOpenTareas={onOpenTareas}
            visible={showDetail}
            onHide={() => setShowDetail(false)}
            onRemoved={() => {
              onOpenId(null);
              setShowDetail(false);
              setPanelMovil("lista");
              router.refresh();
            }}
          />

          {/* Columna 3: la conversación. */}
          <div
            className={`min-w-0 flex-1 flex-col md:flex ${
              panelMovil === "lista" ? "hidden" : "flex"
            }`}
          >
            <div className="flex items-center gap-3 border-b border-[#ddd8c9] px-4 py-3 dark:border-white/10">
              <button
                type="button"
                onClick={() => setPanelMovil("lista")}
                aria-label="Volver a la lista de chats"
                className="-ml-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 md:hidden dark:hover:bg-white/10"
              >
                <ArrowLeft className="size-5" />
              </button>
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-xl text-xs font-semibold ${avatarColor(open.contactName)}`}
              >
                {initials(open.contactName)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{open.contactName}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs text-neutral-500">{CHANNEL_LABELS[open.channel]}</p>
                  <SilenceBadge lastContactMessageAt={open.lastContactMessageAt} now={now} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void marcarSinLeer(open.id)}
                aria-label="Marcar como no leído"
                title="Marcar como no leído"
                className="ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-amber-600 dark:hover:bg-white/10"
              >
                <MailBadge className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowDetail((current) => !current)}
                aria-label="Ver la ficha del lead"
                title="Ver la ficha del lead"
                className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 xl:hidden dark:hover:bg-white/10"
              >
                <SlidersHorizontal className="size-4" />
              </button>
            </div>

            <ChatThread
              key={open.id}
              conversation={open as ChatTarget}
              onNotice={onNotice}
              className="min-h-0 flex-1"
            />
          </div>
        </>
      ) : (
        <div
          className={`flex-1 flex-col items-center justify-center gap-3 px-6 text-center md:flex ${
            panelMovil === "lista" ? "hidden" : "flex"
          }`}
        >
          <p className="text-sm text-neutral-500">
            {yaNoEsta
              ? "Ese chat ya no está disponible. Puede que lo hayan archivado o reasignado a otra persona."
              : "Elegí un chat de la lista."}
          </p>
          {yaNoEsta && (
            <button
              type="button"
              onClick={() => onOpenId(null)}
              className="cursor-pointer text-sm font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              Volver a la bandeja
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Un contacto sin chat, listo para que le escribamos primero.
 *
 * Antes era una línea muerta en la lista: el chat sólo nacía cuando la persona
 * escribía, así que a un contacto cargado a mano no había por dónde arrancarle
 * la conversación. El botón la abre vacía y la deja seleccionada.
 *
 * No manda nada por su cuenta: el primer mensaje se escribe en el chat, que es
 * donde se ve lo que se está por mandar y si hace falta una plantilla.
 */
function PendingContactRow({
  contact,
  onOpened,
  onNotice,
}: {
  contact: ContactRow;
  onOpened: (conversationId: string, provider: string, contact: ContactRow) => void;
  onNotice: (message: string) => void;
}) {
  const access = useAccess();
  const [abriendo, startAbrir] = useTransition();

  if (!access.can("responder_chats")) {
    return <li className="truncate py-1.5 text-sm text-neutral-500">{contact.name}</li>;
  }

  const abrir = () => {
    startAbrir(async () => {
      const result = await startContactConversation({ contactId: contact.id });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      onOpened(result.conversationId, result.provider, contact);
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={abrir}
        disabled={abriendo}
        title={`Abrir el chat con ${contact.name} y escribirle primero`}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{contact.name}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <MessageSquarePlus className="size-3" />
          {abriendo ? "Abriendo…" : "Escribir"}
        </span>
      </button>
    </li>
  );
}

/** La ventana de 24 h corre igual en los tres canales, así que no filtra. */
function SilenceBadge({
  lastContactMessageAt,
  now,
}: {
  lastContactMessageAt: string | null;
  now: number;
}) {
  const label = silenceLabelSince(lastContactMessageAt, now);
  const state = silenceStateSince(lastContactMessageAt, now);
  if (!label || !state) return null;

  return (
    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${SILENCE_TONES[state]}`}>
      {label}
    </span>
  );
}

const SILENCE_TONES: Record<SilenceState, string> = {
  fresh: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  warm: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  risk: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300",
  expired: "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300",
};

function LeadDetailColumn({
  contactId,
  stages,
  timezone,
  onNotice,
  onOpenTareas,
  visible,
  onHide,
  onRemoved,
}: {
  contactId: string;
  stages: StageRow[];
  timezone: string;
  onNotice: (message: string) => void;
  onOpenTareas: () => void;
  visible: boolean;
  onHide: () => void;
  onRemoved: () => void;
}) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("principal");
  // Igual que en la ficha grande: el botón del encabezado abre la sección de
  // tareas con el alta lista, y elegir otra sección a mano lo apaga.
  const [pedidosDeTarea, setPedidosDeTarea] = useState(0);
  const [abrirTarea, setAbrirTarea] = useState(false);

  useEffect(() => {
    let active = true;
    loadLead({ contactId }).then((result) => {
      if (!active) return;
      if (result.ok) setLead(result.lead);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [contactId]);

  // Después de editar la ficha hay que volver a pedirla: el valor y las notas
  // que se acaban de guardar también alimentan las estadísticas y el encabezado.
  const recargar = useCallback(() => {
    void loadLead({ contactId }).then((result) => {
      if (result.ok) setLead(result.lead);
    });
  }, [contactId]);

  return (
    <div
      className={`w-full shrink-0 flex-col border-r border-[#ddd8c9] sm:w-72 xl:w-80 dark:border-white/10 ${
        // Debajo de xl no entra, así que se despliega sobre el chat.
        visible ? "absolute inset-y-0 right-0 z-20 flex bg-[#f9f8f3] dark:bg-[#1c1811]" : "hidden"
      } xl:relative xl:flex xl:bg-transparent`}
    >
      <div className="flex items-center justify-between border-b border-[#ddd8c9] px-4 py-3 dark:border-white/10">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {lead ? `Lead · ${lead.contact.name}` : "Lead"}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          {/* A la vista y con texto: los íconos de las secciones de abajo no
              dicen qué son hasta que se los toca, y anotar la próxima llamada
              mientras se chatea es lo que más se hace desde acá. */}
          {lead && (
            <button
              type="button"
              onClick={() => {
                setSection("tareas");
                setAbrirTarea(true);
                setPedidosDeTarea((actual) => actual + 1);
              }}
              aria-label={`Agregar una tarea para ${lead.contact.name}`}
              title="Agregar una tarea"
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-white/5"
            >
              <ListPlus className="size-4" aria-hidden />
              Tarea
            </button>
          )}
          <button
            type="button"
            onClick={onHide}
            aria-label="Cerrar la ficha"
            className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 xl:hidden dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </span>
      </div>

      <div className="flex border-b border-[#ddd8c9] dark:border-white/10">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setSection(id);
              setAbrirTarea(false);
            }}
            title={label}
            aria-label={label}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors ${
              section === id
                ? "border-amber-500 text-amber-700 dark:text-amber-400"
                : "border-transparent text-neutral-500 hover:bg-neutral-50 dark:hover:bg-white/5"
            }`}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!lead && !error && <p className="text-sm text-neutral-500">Cargando…</p>}

        {lead && section === "principal" && (
          <PrincipalSection
            key={lead.contact.id}
            lead={lead}
            stages={stages}
            onNotice={onNotice}
            onSaved={recargar}
            onRemoved={onRemoved}
          />
        )}
        {lead && section === "tareas" && (
          <TareasDelLead
            key={pedidosDeTarea}
            contactId={lead.contact.id}
            contactName={lead.contact.name}
            timezone={timezone}
            conFormularioAbierto={abrirTarea}
            compacto
            onNotice={onNotice}
            onVerTareas={onOpenTareas}
          />
        )}
        {lead && section === "estadisticas" && <StatsSection lead={lead} timezone={timezone} />}
        {lead && section === "archivos" && <FilesSection lead={lead} timezone={timezone} />}
      </div>
    </div>
  );
}

function PrincipalSection({
  lead,
  stages,
  onNotice,
  onSaved,
  onRemoved,
}: {
  lead: LeadDetail;
  stages: StageRow[];
  onNotice: (message: string) => void;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const access = useAccess();
  const [frozen, setFrozen] = useState(!lead.contact.botEnabled);
  const [editando, setEditando] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, startTransition] = useTransition();

  const toggleBot = () => {
    const next = !frozen;
    setFrozen(next);
    startTransition(async () => {
      const result = await setContactBot({ id: lead.contact.id, enabled: !next });
      if (!result.ok) {
        setFrozen(!next);
        onNotice(result.error);
      }
    });
  };

  const moveStage = (stageId: string) => {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage || !lead.opportunity) return;
    startTransition(async () => {
      const result = await updateOpportunityStage({ id: lead.opportunity!.id, stageId });
      onNotice(result.ok ? `Movido a ${stage.name}.` : result.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-12 shrink-0 place-items-center rounded-2xl text-sm font-semibold ${avatarColor(lead.contact.name)}`}
        >
          {initials(lead.contact.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{lead.contact.name}</p>
          <ChannelBadges channels={lead.conversations.map((item) => item.channel)} />
        </div>
        {!editando && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label="Editar la ficha"
              title="Editar la ficha"
              className="grid size-11 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <Pencil className="size-4" />
            </button>
            {access.can("eliminar_contactos") && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Borrar a ${lead.contact.name}`}
                title="Borrar de la base (no se puede deshacer)"
                className="grid size-11 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {editando ? (
        <EditarFicha
          lead={lead}
          onNotice={onNotice}
          onSaved={onSaved}
          onCancel={() => setEditando(false)}
        />
      ) : (
        <>
      <button
        type="button"
        onClick={toggleBot}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
          frozen
            ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        }`}
      >
        {frozen ? <BotOff className="size-4" /> : <Bot className="size-4" />}
        {frozen ? "IA frenada" : "IA activa"}
      </button>

      {lead.opportunity && (
        <div>
          <label className="block text-xs font-medium text-neutral-500" htmlFor="inbox-stage">
            Etapa
          </label>
          <select
            id="inbox-stage"
            defaultValue={lead.opportunity.stageId}
            onChange={(event) => moveStage(event.target.value)}
            className="mt-1.5 w-full cursor-pointer rounded-lg border border-[#ddd8c9] bg-transparent px-2 py-2 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10"
          >
            <OpcionesDeEtapa stages={stages} />
          </select>
          <p className="mt-2 text-sm font-semibold">{money(lead.opportunity.value)}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-neutral-500" htmlFor="inbox-responsable">
          Responsable
        </label>
        <ResponsableSelect
          key={lead.contact.id}
          id="inbox-responsable"
          contactId={lead.contact.id}
          assignedTo={lead.contact.assignedTo}
          onNotice={onNotice}
          className="mt-1.5 w-full cursor-pointer rounded-lg border border-[#ddd8c9] bg-transparent px-2 py-2 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10"
          readOnlyClassName="mt-1.5 text-sm text-neutral-500"
        />
      </div>

      <dl className="space-y-2 border-t border-[#ddd8c9] pt-4 text-sm dark:border-white/10">
        <Field icon={Phone} value={lead.contact.phone} />
        <Field icon={Mail} value={lead.contact.email} />
      </dl>

      {lead.contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lead.contact.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {lead.opportunity?.notes && (
        <div className="border-t border-[#ddd8c9] pt-4 dark:border-white/10">
          <p className="text-xs font-medium text-neutral-500">Notas</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{lead.opportunity.notes}</p>
        </div>
      )}
        </>
      )}

      {confirmingDelete && (
        <DeleteContactModal
          contacts={[lead.contact]}
          close={() => setConfirmingDelete(false)}
          onCompleted={onRemoved}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}

/**
 * La ficha, editable, sin salir de la bandeja.
 *
 * Antes esto era sólo de lectura y para corregir un teléfono había que abrir la
 * tarjeta de lead en un panel aparte, que tapaba el chat — justo lo que la
 * bandeja de tres columnas vino a resolver.
 *
 * La etapa, el interruptor de la IA y el responsable siguen guardándose solos,
 * fuera de este formulario: son de un clic y se entienden mejor aplicándose al
 * toque. Lo que se edita acá es lo que se escribe.
 */
function EditarFicha({
  lead,
  onNotice,
  onSaved,
  onCancel,
}: {
  lead: LeadDetail;
  onNotice: (message: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(lead.contact.name);
  const [phone, setPhone] = useState(lead.contact.phone ?? "");
  const [email, setEmail] = useState(lead.contact.email ?? "");
  const [tags, setTags] = useState(lead.contact.tags.join(", "));
  const [value, setValue] = useState(String(lead.opportunity?.value ?? 0));
  const [notes, setNotes] = useState(lead.opportunity?.notes ?? "");
  const [pending, startTransition] = useTransition();

  const guardar = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const contacto = await updateContact({
        id: lead.contact.id,
        name,
        email,
        phone,
        tags: tags.split(","),
      });

      if (!contacto.ok) {
        onNotice(contacto.error);
        return;
      }

      // La oportunidad puede no existir todavía: un contacto importado sin
      // oportunidad tiene ficha igual, y el valor y las notas viven ahí.
      if (lead.opportunity) {
        const detalle = await updateOpportunityDetails({
          id: lead.opportunity.id,
          value: Number(value || 0),
          notes,
        });
        if (!detalle.ok) {
          onNotice(detalle.error);
          return;
        }
      }

      onNotice("Ficha actualizada.");
      onSaved();
      onCancel();
    });
  };

  return (
    <form onSubmit={guardar} className="space-y-3">
      <Campo id="ficha-nombre" label="Nombre">
        <input
          id="ficha-nombre"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={CAMPO_CLASS}
        />
      </Campo>

      <Campo id="ficha-telefono" label="Teléfono">
        <input
          id="ficha-telefono"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={CAMPO_CLASS}
        />
      </Campo>

      <Campo id="ficha-email" label="Email">
        <input
          id="ficha-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={CAMPO_CLASS}
        />
      </Campo>

      <Campo id="ficha-tags" label="Etiquetas" hint="Separadas por coma.">
        <input
          id="ficha-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="interesado, zona norte"
          className={CAMPO_CLASS}
        />
      </Campo>

      {lead.opportunity && (
        <>
          <Campo id="ficha-valor" label="Valor (US$)">
            <input
              id="ficha-valor"
              type="number"
              min="0"
              step="1000"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={CAMPO_CLASS}
            />
          </Campo>

          <Campo id="ficha-notas" label="Notas">
            <textarea
              id="ficha-notas"
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Qué busca, presupuesto, lo que haga falta recordar…"
              className={`${CAMPO_CLASS} resize-y`}
            />
          </Campo>
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 cursor-pointer rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

const CAMPO_CLASS =
  "mt-1 w-full rounded-lg border border-[#ddd8c9] bg-transparent px-2 py-1.5 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10";

function Campo({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function Field({ icon: Icon, value }: { icon: typeof Phone; value: string | null }) {
  return (
    <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
      <Icon className="size-4 shrink-0 text-neutral-400" />
      <span className="truncate">{value || <span className="text-neutral-400">Sin cargar</span>}</span>
    </div>
  );
}

function StatsSection({ lead, timezone }: { lead: LeadDetail; timezone: string }) {
  const { stats } = lead;

  return (
    <dl className="space-y-3 text-sm">
      <Stat label="Mensajes" value={String(stats.messages)} />
      <Stat label="Recibidos" value={String(stats.received)} />
      <Stat label="Enviados" value={String(stats.sent)} />
      <Stat
        label="Primer mensaje"
        value={stats.firstMessageAt ? dateTime(stats.firstMessageAt, timezone) : "—"}
      />
      <Stat
        label="Último mensaje"
        value={stats.lastMessageAt ? dateTime(stats.lastMessageAt, timezone) : "—"}
      />
      <Stat label="Contacto creado" value={dateTime(lead.contact.createdAt, timezone)} />
      <Stat label="Turnos agendados" value={String(lead.appointments.length)} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 pb-2 dark:border-white/5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function FilesSection({ lead, timezone }: { lead: LeadDetail; timezone: string }) {
  if (lead.files.length === 0) {
    return <p className="text-sm text-neutral-500">Todavía no hay archivos en este chat.</p>;
  }

  return (
    <ul className="space-y-2">
      {lead.files.map((file) => (
        <li key={file.id}>
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 rounded-lg p-2 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
          >
            <Paperclip className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <span className="min-w-0">
              <span className="block truncate">
                {file.caption || (file.mine ? "Archivo enviado" : "Archivo recibido")}
              </span>
              <span className="block text-xs text-neutral-500">{dateTime(file.createdAt, timezone)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
