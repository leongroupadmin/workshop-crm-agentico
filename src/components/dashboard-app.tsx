"use client";

import {
  Archive,
  Bot,
  CalendarDays,
  ChartPie,
  Check,
  ChevronDown,
  Inbox,
  Database,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  LineChart,
  LogOut,
  Menu,
  MessageSquareMore,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

import {
  archiveContact,
  changeOwnPassword,
  createContact,
  restoreContact,
  signOut,
} from "@/app/actions";
import { AccessProvider, useAccess } from "@/components/access";
import { AgendaPanel } from "@/components/agenda-panel";
import { AgentsPanel } from "@/components/agents-panel";
import { AsistenteWidget, RAIZ_DEL_TEMA } from "@/components/asistente-widget";
import { AuthGate } from "@/components/auth-gate";
import { BrandMark } from "@/components/brand";
import { InboxView } from "@/components/inbox-view";
import { LeadCard } from "@/components/lead-card";
import { NotificationsBell } from "@/components/notifications-bell";
import { BaseDeDatosPanel } from "@/components/base-de-datos-panel";
import { DeleteContactModal } from "@/components/delete-contact-modal";
import { PipelinePanel } from "@/components/pipeline-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { TareasPanel } from "@/components/tareas-panel";
import {
  CHANNEL_LABELS,
  Card,
  EmptyState,
  INPUT_CLASS,
  Modal,
  PRIMARY_BUTTON_CLASS,
  avatarColor,
  dateTime,
  initials,
} from "@/components/ui";
import { longDateInZone } from "@/lib/fechas";
import {
  caminoDePorcion,
  porcionesDeLaTorta,
  puntoDeLaVuelta,
  type CanalDeEntrada,
} from "@/lib/leads-por-canal";
import { grupoDeTarea, tareasUrgentes, textoDeVencimiento } from "@/lib/tareas";
import type { Trend } from "@/lib/metricas";
import { usePreference } from "@/lib/use-preference";
import { useAgrupado, usePolling, useRealtimeInserts } from "@/lib/use-realtime";
import type {
  ContactRow,
  ConversationRow,
  CrmData,
  HandoffRow,
  StageRow,
} from "@/lib/crm-data";
import type { Permission } from "@/lib/permissions";
import type { WorkspaceContext } from "@/lib/workspace";

type View =
  | "Resumen"
  | "Conversaciones"
  | "Pipeline"
  | "Contactos"
  | "Agenda"
  | "Tareas"
  | "Agentes IA"
  | "Base de datos"
  | "Configuración";

/**
 * La sección abierta viaja en la URL (`?vista=pipeline`).
 *
 * Antes vivía sólo en memoria y cualquier refresco devolvía al Resumen: se
 * perdía el lugar de trabajo justo cuando uno recarga para ver si entró algo
 * nuevo. El servidor lee el parámetro y ya dibuja la sección correcta, así no
 * hay un parpadeo de Resumen antes de acomodarse.
 *
 * Los slugs son fijos y sin acentos: son parte de la URL, se pegan en un chat
 * y tienen que sobrevivir a que alguien renombre una sección en el menú.
 */
const VIEW_SLUGS: Record<View, string> = {
  Resumen: "resumen",
  Conversaciones: "conversaciones",
  Pipeline: "pipeline",
  Contactos: "contactos",
  Agenda: "agenda",
  Tareas: "tareas",
  "Agentes IA": "agentes-ia",
  "Base de datos": "base-de-datos",
  Configuración: "configuracion",
};

/** Slug de la URL a sección. Cualquier cosa rara cae en el Resumen. */
function viewFromSlug(slug: string | null): View {
  const found = (Object.keys(VIEW_SLUGS) as View[]).find(
    (label) => VIEW_SLUGS[label] === slug?.trim().toLowerCase(),
  );
  return found ?? "Resumen";
}

/**
 * `permission` esconde la sección si el operario no la tiene; `adminOnly` la
 * reserva al administrador. Sin ninguna de las dos, la ve cualquiera.
 */
const NAVIGATION: {
  label: View;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  adminOnly?: boolean;
}[] = [
  { label: "Resumen", icon: LayoutDashboard },
  { label: "Conversaciones", icon: MessageSquareMore },
  { label: "Pipeline", icon: LineChart },
  { label: "Contactos", icon: UsersRound },
  { label: "Agenda", icon: CalendarDays },
  // Sin permiso: cualquiera del equipo se programa sus propias tareas.
  { label: "Tareas", icon: ListTodo },
  { label: "Agentes IA", icon: Bot, permission: "gestionar_agentes" },
  { label: "Base de datos", icon: Database, adminOnly: true },
  { label: "Configuración", icon: Settings, adminOnly: true },
];

const SIDEBAR_COLLAPSED_KEY = "leon-crm:menu-lateral-colapsado";

/**
 * Mantiene los datos del dashboard al día mientras el CRM está abierto.
 *
 * Vivía en la bandeja y sólo corría con "Conversaciones" en pantalla: en las
 * demás secciones la campana no se enteraba de un mensaje ni de una derivación
 * hasta recargar. Escucha `conversations`, que cambia con cada mensaje que
 * entra —sube el contador de sin leer— y con cada derivación.
 *
 * Más espaciado que el del chat: esto recarga los datos de todo el dashboard,
 * no un hilo —una quincena de pedidos a Supabase por vuelta—. Con el socket
 * arriba cada cambio ya dispara el refresh, así que el respaldo pasa cada dos
 * minutos; con el socket caído vuelve a ser lo que mantiene la pantalla al día.
 *
 * Los avisos del socket no recargan uno por uno: se agrupan, con quince
 * segundos como mínimo entre recargas, y con la pestaña oculta se ignoran. El
 * chat abierto no depende de esto —escucha sus mensajes por su cuenta—, así
 * que lo único que espera unos segundos más es la lista y los contadores.
 */
function useDatosEnVivo() {
  const router = useRouter();
  const refresh = () => router.refresh();
  const refreshAgrupado = useAgrupado(refresh, 15000);
  const enVivo = useRealtimeInserts("conversations", undefined, refreshAgrupado);
  usePolling(refresh, enVivo ? 120000 : 25000);
}

export function DashboardApp({
  context,
  data,
  authError,
  vista,
  chat,
}: {
  context: WorkspaceContext;
  data: CrmData | null;
  authError: string | null;
  /** Slug de la sección a abrir, tal cual vino en la URL. */
  vista: string | null;
  /** Chat de un enlace directo, por ejemplo desde una notificación push. */
  chat: string | null;
}) {
  // Arranca en claro. Se decide acá y no con `prefers-color-scheme` para que
  // el render del servidor y el del navegador coincidan: leer la preferencia
  // del sistema exige un efecto, y eso hace parpadear la pantalla entera.
  const [dark, setDark] = useState(false);

  if (context.status !== "ready" || !data) {
    return (
      <div className={dark ? "dark" : "claro"}>
        <AuthGate context={context} authError={authError} />
      </div>
    );
  }

  return (
    // El id es el destino del portal del asistente: su panel tiene que colgar
    // de acá y no del `body`, porque el modo claro vive en esta clase. Colgado
    // del body heredaba el texto casi blanco de `:root` sobre su fondo blanco.
    // Este div no crea contexto de apilamiento —no tiene posición ni z-index—
    // así que el panel igual escapa del encabezado.
    <div id={RAIZ_DEL_TEMA} className={dark ? "dark" : "claro"}>
      <AccessProvider
        userId={context.userId}
        role={context.role}
        permissions={context.permissions}
      >
        <Workspace
          context={context}
          data={data}
          vista={vista}
          chat={chat}
          dark={dark}
          onToggleDark={() => setDark(!dark)}
        />
      </AccessProvider>
    </div>
  );
}

function Workspace({
  context,
  data,
  vista,
  chat,
  dark,
  onToggleDark,
}: {
  context: Extract<WorkspaceContext, { status: "ready" }>;
  data: CrmData;
  vista: string | null;
  chat: string | null;
  dark: boolean;
  onToggleDark: () => void;
}) {
  const access = useAccess();
  useDatosEnVivo();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = usePreference(SIDEBAR_COLLAPSED_KEY);

  const toggleMenuCollapsed = () => {
    setMenuCollapsed(!menuCollapsed);
  };

  /* Una sección que el usuario no puede ver no se abre aunque venga en la URL:
     el menú la esconde y la sección tiene que responder igual. Lo que de
     verdad protege los datos siguen siendo las políticas RLS. */
  const allowed = (label: View) => {
    const entry = NAVIGATION.find((item) => item.label === label);
    if (!entry) return false;
    return (!entry.adminOnly || access.isAdmin) && (!entry.permission || access.can(entry.permission));
  };

  const [view, setView] = useState<View>(() => {
    const wanted = viewFromSlug(vista);
    return allowed(wanted) ? wanted : "Resumen";
  });
  const [showContactForm, setShowContactForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timerDelAviso = useRef<number | null>(null);
  // La ficha vive acá arriba para poder abrirse desde el embudo, la bandeja o
  // los contactos sin duplicar el panel en cada sección.
  const [openLead, setOpenLead] = useState<string | null>(null);
  // Cuál chat está abierto en la bandeja. Vive acá y no adentro de ella porque
  // la campana tiene que poder decir "abrí este" desde el header.
  const [openChat, setOpenChat] = useState<string | null>(() => {
    if (!chat) return null;
    return data.conversations.some((conversation) => conversation.id === chat) ? chat : null;
  });

  const selectView = (next: View) => {
    setView(next);
    setMenuOpen(false);

    /* Se reescribe la URL sin recargar ni agregar una entrada al historial:
       cambiar de sección no es navegar, pero al refrescar el navegador manda
       de vuelta este parámetro y el servidor abre donde estabas. */
    const url = new URL(window.location.href);
    url.searchParams.set("vista", VIEW_SLUGS[next]);
    window.history.replaceState(null, "", url);
  };

  /** Desde la campana: saltar a Conversaciones con ese chat en pantalla. */
  const abrirChat = (handoff: HandoffRow) => {
    setOpenChat(handoff.conversationId);
    selectView("Conversaciones");
  };

  const notify = (message: string) => {
    setNotice(message);
    // Un aviso largo casi siempre es un error con lo que contestó el canal, y
    // en tres segundos no se llega a leer, menos a copiar: se queda más cuanto
    // más largo es. El timer anterior se corta para que un aviso viejo no
    // cierre uno nuevo antes de tiempo.
    if (timerDelAviso.current !== null) window.clearTimeout(timerDelAviso.current);
    timerDelAviso.current = window.setTimeout(
      () => setNotice(null),
      Math.min(20000, Math.max(3200, message.length * 70)),
    );
  };

  // Las vencidas y las de hoy: lo que hay que hacer antes de irse. Las de la
  // semana que viene no son urgencia y un número que nunca baja se deja de
  // mirar.
  const tareasPorAtender = tareasUrgentes(data.tareas, new Date(), data.timezone);

  return (
    <div className="min-h-screen bg-[#eae5d6] text-neutral-900 dark:bg-[#100d08] dark:text-neutral-100">
      {menuOpen && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-20 bg-neutral-950/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* El `dark` no sigue al modo de la app: el menú es casi negro contra el
          crema, y ese contraste es lo que ordena la pantalla. Puesto acá activa
          los estilos oscuros que ya estaban escritos adentro, en vez de
          duplicar cada color del menú con su variante clara. */}
      <aside
        className={`dark fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-white/10 bg-[#17140c] px-4 py-5 transition-[transform,width,padding] duration-200 lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        } ${menuCollapsed ? "lg:w-20 lg:px-3" : "lg:w-72"}`}
      >
        <div className={`flex items-center gap-3 px-2 ${menuCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <BrandMark />
          <div className={`min-w-0 ${menuCollapsed ? "lg:hidden" : ""}`}>
            <p className="font-semibold">CRM</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{context.workspaceName}</p>
          </div>
          <button
            aria-label="Cerrar menú"
            className="ml-auto cursor-pointer rounded-lg p-2 lg:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={toggleMenuCollapsed}
          aria-label={menuCollapsed ? "Agrandar menú lateral" : "Achicar menú lateral"}
          title={menuCollapsed ? "Agrandar menú lateral" : "Achicar menú lateral"}
          className={`mt-6 hidden cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 lg:flex dark:text-neutral-300 dark:hover:bg-white/5 ${
            menuCollapsed ? "justify-center" : ""
          }`}
        >
          {menuCollapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          <span className={menuCollapsed ? "lg:hidden" : ""}>{menuCollapsed ? "Agrandar" : "Achicar"}</span>
        </button>

        <nav className={`${menuCollapsed ? "mt-6" : "mt-9"} space-y-1`} aria-label="Navegación principal">
          {/* Esconder una sección es sólo ordenar la pantalla: lo que de verdad
              la protege son las políticas RLS, que rechazan la consulta aunque
              alguien llegue igual. */}
          {NAVIGATION.filter(({ label }) => allowed(label)).map(({ label, icon: Icon }) => {
            const badge =
              label === "Conversaciones" && data.totalUnread > 0
                ? String(data.totalUnread)
                : label === "Tareas" && tareasPorAtender > 0
                  ? String(tareasPorAtender)
                  : null;
            return (
              <button
                key={label}
                onClick={() => selectView(label)}
                aria-current={view === label ? "page" : undefined}
                title={menuCollapsed ? label : undefined}
                className={`relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                  menuCollapsed ? "lg:justify-center" : ""
                } ${
                  view === label
                    ? "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/5"
                }`}
              >
                <Icon className="size-5 shrink-0" />
                <span className={menuCollapsed ? "lg:hidden" : ""}>{label}</span>
                {badge && (
                  <span
                    className={`rounded-full bg-amber-500 px-2 py-0.5 text-xs text-neutral-950 ${
                      menuCollapsed ? "lg:absolute lg:right-1.5 lg:top-1 lg:px-1.5" : "ml-auto"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

      </aside>

      {/* En Conversaciones el alto lo fija el `main` y nada scrollea de más.
          Antes la bandeja se media sola con `100dvh - 5rem`, contando que el
          encabezado midiera exactamente eso: cualquier diferencia —y en el
          celular la barra de direcciones del navegador aparece y desaparece—
          dejaba la pagina un poco mas alta que la pantalla, asi que scrolleaba
          entera y la barra para escribir se iba con los mensajes. */}
      <main
        className={`${menuCollapsed ? "lg:pl-20" : "lg:pl-72"} ${
          view === "Conversaciones" ? "h-dvh overflow-hidden" : ""
        }`}
      >
        <header className="sticky top-0 z-10 flex h-20 shrink-0 items-center gap-3 border-b border-[#ddd8c9]/80 bg-[#eae5d6]/90 px-5 backdrop-blur dark:border-white/10 dark:bg-[#100d08]/90 sm:px-8">
          <button
            aria-label="Abrir menú"
            className="cursor-pointer rounded-lg p-2 hover:bg-neutral-200 lg:hidden dark:hover:bg-white/10"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <button
              aria-label={dark ? "Usar modo claro" : "Usar modo oscuro"}
              onClick={onToggleDark}
              className="grid size-10 cursor-pointer place-items-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-200 dark:hover:bg-white/10"
            >
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            {/* Vive en el encabezado y no flotando abajo a la derecha: ahí
                tapaba el botón de enviar de la bandeja. */}
            <AsistenteWidget />
            <NotificationsBell
              handoffs={data.handoffs}
              chatsSinLeer={data.chatsSinLeer}
              tareasNuevas={data.tareas.filter((tarea) => !tarea.vista)}
              timezone={data.timezone}
              onOpenChat={abrirChat}
              onOpenTareas={() => selectView("Tareas")}
            />
            <AccountMenu email={context.userEmail} />
          </div>
        </header>

        {/* La bandeja va a sangre: es una vista de columnas con su propio
            scroll interno, y el ancho máximo con padding la encajonaba. */}
        <div
          className={
            view === "Conversaciones" ? "" : "mx-auto max-w-[1600px] p-5 sm:p-8"
          }
        >
          {view === "Resumen" ? (
            <Overview data={data} onNavigate={selectView} onOpenLead={setOpenLead} />
          ) : (
            <ModuleView
              view={view}
              data={data}
              openChat={openChat}
              onOpenChat={setOpenChat}
              onAdd={() => setShowContactForm(true)}
              onNotice={notify}
              onOpenLead={setOpenLead}
              onOpenTareas={() => selectView("Tareas")}
            />
          )}
        </div>
      </main>

      {notice && (
        <div
          role="status"
          // z-60: la tarjeta de lead es un panel fijo a la derecha en z-50 y
          // tapaba los avisos, incluidos los errores. Sin esto, un fallo del
          // chat abierto desde el lead se ve como que no pasó nada.
          className="fixed bottom-5 right-5 z-[60] flex max-w-sm items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-xl"
        >
          <Check className="size-4 text-amber-300" />
          {notice}
        </div>
      )}

      {showContactForm && (
        <ContactModal
          stages={data.stages}
          close={() => setShowContactForm(false)}
          onSaved={(name, warning) => {
            setShowContactForm(false);
            notify(warning ?? `${name} entró al embudo como lead.`);
          }}
        />
      )}

      {openLead && (
        <LeadCard
          key={openLead}
          contactId={openLead}
          stages={data.stages}
          timezone={data.timezone}
          onOpenTareas={() => {
            setOpenLead(null);
            selectView("Tareas");
          }}
          onClose={() => setOpenLead(null)}
          onNotice={notify}
        />
      )}
    </div>
  );
}

function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [nuevaClave, setNuevaClave] = useState("");
  const [avisoClave, setAvisoClave] = useState("");
  const [pending, startTransition] = useTransition();

  const guardarClave = (event: FormEvent) => {
    event.preventDefault();
    setAvisoClave("");
    startTransition(async () => {
      const result = await changeOwnPassword({ password: nuevaClave });
      if (!result.ok) {
        setAvisoClave(result.error);
        return;
      }
      setNuevaClave("");
      setCambiandoClave(false);
      setOpen(false);
    });
  };

  const cerrarSesion = () => {
    startTransition(async () => {
      // Un cierre explícito también suelta este dispositivo. Cerrar solamente
      // la pestaña no: ése es justamente el caso en que el push tiene que
      // seguir llegando.
      if ("serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration("/");
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) {
            await fetch("/api/push-subscriptions", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            }).catch(() => undefined);
            await subscription.unsubscribe();
          }
        } catch {
          // La sesión se cierra igual. Al quedar desuscripto, el proveedor
          // responderá 410 y el servidor limpiará cualquier fila que quede.
        }
      }
      await signOut();
    });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="ml-1 flex cursor-pointer items-center gap-2 rounded-xl p-1.5 pr-2 transition-colors hover:bg-neutral-200 dark:hover:bg-white/10"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-amber-500 text-xs font-bold text-neutral-950">
          {initials(email) || "LG"}
        </span>
        <ChevronDown className="size-4 text-neutral-500" />
      </button>
      {open && (
        <>
          <button aria-label="Cerrar menú de cuenta" className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] p-2 shadow-lg dark:border-white/10 dark:bg-[#1c1811]">
            <p className="truncate px-3 py-2 text-xs text-neutral-500">{email}</p>

            {cambiandoClave ? (
              <form onSubmit={guardarClave} className="px-3 py-2">
                <label className="sr-only" htmlFor="mi-clave-nueva">
                  Contraseña nueva
                </label>
                <input
                  id="mi-clave-nueva"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={nuevaClave}
                  onChange={(event) => setNuevaClave(event.target.value)}
                  placeholder="Contraseña nueva"
                  className="w-full rounded-lg border border-[#ddd8c9] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-white/5"
                />
                {avisoClave && <p className="mt-2 text-xs text-red-600">{avisoClave}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    type="submit"
                    disabled={pending || nuevaClave.length === 0}
                    className="flex-1 cursor-pointer rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
                  >
                    {pending ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCambiandoClave(false);
                      setAvisoClave("");
                      setNuevaClave("");
                    }}
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setCambiandoClave(true)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
              >
                <KeyRound className="size-4" />
                Cambiar mi contraseña
              </button>
            )}

            <button
              disabled={pending}
              onClick={cerrarSesion}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-white/10"
            >
              <LogOut className="size-4" />
              {pending ? "Cerrando…" : "Cerrar sesión"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * El Resumen es un tablero y nada más: se mira, no se opera.
 *
 * Tenía arriba un "Nuevo contacto" que además era el único que no pasaba por el
 * permiso de crear contactos, así que un operario sin ese permiso veía un botón
 * que la base le iba a rechazar. El alta vive en Contactos, que es donde se la
 * busca.
 */
function Overview({
  data,
  onNavigate,
  onOpenLead,
}: {
  data: CrmData;
  onNavigate: (view: View) => void;
  onOpenLead: (contactId: string) => void;
}) {
  const peak = Math.max(...data.activity.map((bar) => bar.count), 1);
  const hasActivity = data.activity.some((bar) => bar.count > 0);

  return (
    <>
      {/* La zona la pone el workspace: con la del dispositivo, el encabezado
          y el gráfico podían quedar en días distintos. */}
      <p className="text-sm font-medium text-amber-700 dark:text-amber-400" suppressHydrationWarning>
        {longDateInZone(new Date(), data.timezone)}
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-[#ddd8c9] bg-[#f9f8f3] p-5 shadow-sm dark:border-white/10 dark:bg-[#1c1811]"
          >
            <p className="text-sm font-medium text-neutral-500">{metric.label}</p>
            <div className="mt-4 flex flex-wrap items-baseline gap-2">
              <p className="text-2xl font-semibold">{metric.value}</p>
              {metric.trend && <TrendPill trend={metric.trend} />}
            </div>
            <p className="mt-2 text-xs text-neutral-500">{metric.hint}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">Actividad de conversaciones</h2>
                <p className="mt-1 text-sm text-neutral-500">Mensajes registrados en los últimos 7 días</p>
              </div>
              <button
                onClick={() => onNavigate("Conversaciones")}
                className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-2 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
              >
                Ver bandeja
              </button>
            </div>
            {hasActivity ? (
              <div className="mt-8 flex h-52 items-end gap-2">
                {data.activity.map((bar, index) => (
                  <div className="flex h-full flex-1 flex-col justify-end gap-2" key={index}>
                    <span className="h-4 text-center text-xs font-medium tabular-nums text-neutral-600 dark:text-neutral-300">
                      {bar.count}
                    </span>
                    <div className="flex min-h-0 flex-1 items-end">
                      <div
                        title={`${bar.count} mensajes`}
                        className={`w-full rounded-t-md transition-all ${
                          bar.count === peak ? "bg-amber-500" : "bg-amber-100 dark:bg-amber-400/15"
                        }`}
                        style={{ height: `${Math.max((bar.count / peak) * 100, 2)}%` }}
                      />
                    </div>
                    <span className="text-center text-xs text-neutral-400">{bar.day}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={MessageSquareMore}
                title="Sin mensajes esta semana"
                description="Cuando conectes los canales, la actividad diaria va a aparecer acá."
              />
            )}
          </Card>

          <LeadsPorCanalCard leadsPorCanal={data.leadsPorCanal} />
        </div>

        <div className="space-y-6">
          <MisTareasCard data={data} onNavigate={onNavigate} />

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Próximas citas</h2>
                <p className="mt-1 text-sm text-neutral-500">Agenda por delante</p>
              </div>
              <button
                onClick={() => onNavigate("Agenda")}
                className="cursor-pointer rounded-lg p-2 text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-white/5"
              >
                <CalendarDays className="size-5" />
              </button>
            </div>
            {data.appointments.length > 0 ? (
              <div className="mt-5 space-y-4">
                {data.appointments.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex gap-3 text-sm">
                    <i className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      <span className="block font-medium">{item.title}</span>
                      <span className="text-xs text-neutral-500" suppressHydrationWarning>
                        {dateTime(item.startTime, data.timezone)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={CalendarDays} title="Sin citas próximas" description="Las visitas que agendes aparecerán acá." />
            )}
          </Card>
        </div>
      </section>

      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Conversaciones recientes</h2>
            <p className="mt-1 text-sm text-neutral-500">Respondé antes de que un lead se enfríe.</p>
          </div>
          <button
            onClick={() => onNavigate("Conversaciones")}
            className="cursor-pointer text-sm font-semibold text-amber-700 dark:text-amber-400"
          >
            Abrir bandeja
          </button>
        </div>
        {data.conversations.length > 0 ? (
          <ConversationList
            conversations={data.conversations.slice(0, 5)}
            timezone={data.timezone}
            onOpen={(item) => onOpenLead(item.contactId)}
          />
        ) : data.pendingContacts.length > 0 ? (
          <PendingContactList contacts={data.pendingContacts.slice(0, 5)} onOpen={onOpenLead} />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Todavía no hay conversaciones"
            description="Se van a poblar cuando entren mensajes desde WhatsApp, Instagram o Messenger."
          />
        )}
      </Card>
    </>
  );
}

/**
 * Lo que tiene pendiente quien mira, las más urgentes primero.
 *
 * Se mira y nada más, como el resto del Resumen: tildar una tarea desde acá
 * sería operar desde el tablero. Tocar cualquier renglón lleva a Tareas.
 */
function MisTareasCard({
  data,
  onNavigate,
}: {
  data: CrmData;
  onNavigate: (view: View) => void;
}) {
  const ahora = new Date();
  const urgentes = tareasUrgentes(data.tareas, ahora, data.timezone);
  const primeras = data.tareas.slice(0, 4);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Mis tareas</h2>
          <p className="mt-1 text-sm text-neutral-500" suppressHydrationWarning>
            {data.tareas.length === 0
              ? "Nada pendiente"
              : urgentes > 0
                ? `${urgentes} para hoy o atrasadas`
                : "Al día con lo de hoy"}
          </p>
        </div>
        <button
          onClick={() => onNavigate("Tareas")}
          aria-label="Ir a Tareas"
          className="cursor-pointer rounded-lg p-2 text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-white/5"
        >
          <ListTodo className="size-5" />
        </button>
      </div>
      {primeras.length > 0 ? (
        <ul className="mt-5 space-y-4">
          {primeras.map((tarea) => {
            const vencida = grupoDeTarea(tarea, ahora, data.timezone) === "vencidas";
            return (
              <li key={tarea.id}>
                <button
                  type="button"
                  onClick={() => onNavigate("Tareas")}
                  className="flex w-full cursor-pointer gap-3 text-left text-sm"
                >
                  <i
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${vencida ? "bg-red-500" : "bg-amber-500"}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{tarea.titulo}</span>
                    <span
                      suppressHydrationWarning
                      className={`text-xs ${vencida ? "font-medium text-red-600 dark:text-red-400" : "text-neutral-500"}`}
                    >
                      {textoDeVencimiento(tarea.venceAt, ahora, data.timezone)}
                      {tarea.contactName ? ` · ${tarea.contactName}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-neutral-500">
          {data.tareasError
            ? "Las tareas se activan cuando se corra su migración en Supabase."
            : "Programá llamadas y seguimientos desde Tareas o desde la ficha de un lead."}
        </p>
      )}
    </Card>
  );
}

const PREF_TORTA_HISTORICA = "leon-crm:torta-de-canales-historica";

/**
 * El color de cada canal en la torta, en claro y en oscuro.
 *
 * Los tres chats van en el tono que ya los identifica en la app —verde,
 * fucsia, celeste—, pero no en el mismo paso: los de las etiquetas son pasteles
 * para fondo de texto y en una torta se confunden entre sí. Éstos están
 * medidos para que se distingan también con daltonismo, y el modo oscuro tiene
 * los suyos, no los mismos encendidos. La carga manual va en gris: es el resto.
 *
 * Las clases van escritas enteras para que Tailwind las encuentre.
 */
const TONO_DE_ENTRADA: Record<CanalDeEntrada, { porcion: string; punto: string }> = {
  whatsapp: { porcion: "fill-[#1baf7a] dark:fill-[#1f9d55]", punto: "bg-[#1baf7a] dark:bg-[#1f9d55]" },
  instagram: { porcion: "fill-[#d6338a] dark:fill-[#c8418f]", punto: "bg-[#d6338a] dark:bg-[#c8418f]" },
  messenger: { porcion: "fill-[#2a78d6] dark:fill-[#4a90e8]", punto: "bg-[#2a78d6] dark:bg-[#4a90e8]" },
  web: { porcion: "fill-[#4a3aa7] dark:fill-[#6a3fc4]", punto: "bg-[#4a3aa7] dark:bg-[#6a3fc4]" },
  manual: { porcion: "fill-[#a8a29e] dark:fill-[#78716c]", punto: "bg-[#a8a29e] dark:bg-[#78716c]" },
};

/** Radio de la torta en unidades del SVG. El tamaño real lo pone la clase. */
const RADIO_DE_TORTA = 80;

/**
 * Por qué canal llegan los leads.
 *
 * Arranca en el mes porque es lo que se mira al lado de "Leads nuevos" —y suma
 * lo mismo que esa tarjeta—, y el histórico queda a un toque para ver si el mes
 * es la norma o una excepción. La elección se recuerda en el navegador.
 *
 * Pasar el mouse por una tajada o por su renglón resalta las dos cosas: la
 * leyenda es la tabla con los números, y la torta sólo la forma.
 */
function LeadsPorCanalCard({ leadsPorCanal }: { leadsPorCanal: CrmData["leadsPorCanal"] }) {
  const [historico, setHistorico] = usePreference(PREF_TORTA_HISTORICA);
  const [activo, setActivo] = useState<CanalDeEntrada | null>(null);

  const { total, porciones } = porcionesDeLaTorta(leadsPorCanal ?? [], historico ? "historico" : "mes");
  const resaltada = porciones.find((porcion) => porcion.canal === activo) ?? null;
  const globo = resaltada
    ? puntoDeLaVuelta((resaltada.desde + resaltada.hasta) / 2, RADIO_DE_TORTA, RADIO_DE_TORTA * 0.6)
    : null;
  const leads = (cantidad: number) => `${cantidad} ${cantidad === 1 ? "lead" : "leads"}`;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Por dónde llegan los leads</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {leadsPorCanal === null || total === 0
              ? "Canal de entrada de cada lead"
              : historico
                ? `${leads(total)} activos, desde siempre`
                : `${leads(total)} ${total === 1 ? "entró" : "entraron"} este mes`}
          </p>
        </div>
        {leadsPorCanal !== null && (
          <div className="flex gap-1 rounded-xl border border-[#ddd8c9] p-1 dark:border-white/10">
            {[
              { etiqueta: "Este mes", elegido: !historico, valor: false },
              { etiqueta: "Histórico", elegido: historico, valor: true },
            ].map((opcion) => (
              <button
                key={opcion.etiqueta}
                type="button"
                aria-pressed={opcion.elegido}
                onClick={() => setHistorico(opcion.valor)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  opcion.elegido
                    ? "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                    : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-white/5"
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
        )}
      </div>

      {leadsPorCanal === null ? (
        <p className="mt-5 text-sm text-neutral-500">
          La torta se activa cuando se corra su migración en Supabase.
        </p>
      ) : total === 0 ? (
        <EmptyState
          icon={ChartPie}
          title={historico ? "Todavía no hay leads" : "Sin leads nuevos este mes"}
          description={
            historico
              ? "Cuando entren los primeros, acá vas a ver por qué canal llegó cada uno."
              : "En Histórico está cómo vienen llegando desde siempre."
          }
        />
      ) : (
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
          <div className="relative shrink-0">
            <svg
              viewBox={`0 0 ${RADIO_DE_TORTA * 2} ${RADIO_DE_TORTA * 2}`}
              role="img"
              aria-label={porciones
                .map((porcion) => `${porcion.etiqueta}: ${porcion.porcentaje}%`)
                .join(", ")}
              className="size-44"
              onMouseLeave={() => setActivo(null)}
            >
              {porciones.map((porcion) => {
                const tono = `${TONO_DE_ENTRADA[porcion.canal].porcion} transition-opacity ${
                  activo && activo !== porcion.canal ? "opacity-35" : ""
                }`;
                // Una sola porción es el círculo entero: un arco que empieza y
                // termina en el mismo punto no dibuja nada.
                return porciones.length === 1 ? (
                  <circle
                    key={porcion.canal}
                    cx={RADIO_DE_TORTA}
                    cy={RADIO_DE_TORTA}
                    r={RADIO_DE_TORTA}
                    className={tono}
                    onMouseEnter={() => setActivo(porcion.canal)}
                  />
                ) : (
                  // El trazo en el color del fondo es la separación entre
                  // tajadas, no un borde: sin él dos vecinas se funden.
                  <path
                    key={porcion.canal}
                    d={caminoDePorcion(porcion.desde, porcion.hasta, RADIO_DE_TORTA)}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    className={`${tono} stroke-[#f9f8f3] dark:stroke-[#1c1811]`}
                    onMouseEnter={() => setActivo(porcion.canal)}
                  />
                );
              })}
            </svg>
            {resaltada && globo && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
                style={{
                  left: `${(globo.x / (RADIO_DE_TORTA * 2)) * 100}%`,
                  top: `${(globo.y / (RADIO_DE_TORTA * 2)) * 100}%`,
                }}
              >
                <span className="block font-semibold">{resaltada.etiqueta}</span>
                <span className="tabular-nums text-neutral-300">
                  {leads(resaltada.cantidad)} · {resaltada.porcentaje}%
                </span>
              </div>
            )}
          </div>

          {/* Acotada: en la columna ancha del escritorio el número quedaba
              tan lejos del nombre que había que seguir el renglón con el dedo. */}
          <ul className="w-full min-w-0 flex-1 space-y-1 sm:max-w-sm">
            {porciones.map((porcion) => (
              <li
                key={porcion.canal}
                onMouseEnter={() => setActivo(porcion.canal)}
                onMouseLeave={() => setActivo(null)}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                  activo === porcion.canal ? "bg-neutral-100 dark:bg-white/5" : ""
                }`}
              >
                <i className={`size-2.5 shrink-0 rounded-full ${TONO_DE_ENTRADA[porcion.canal].punto}`} />
                <span className="min-w-0 flex-1 truncate">{porcion.etiqueta}</span>
                <span className="font-medium tabular-nums">{porcion.cantidad}</span>
                <span className="w-10 text-right tabular-nums text-neutral-500">{porcion.porcentaje}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * La variación contra el mismo tramo del mes pasado.
 *
 * El color no lo decide la flecha sino si el movimiento es bueno: subir es
 * verde en leads nuevos y rojo en el lapso de réplica. Por eso el dato trae
 * `good` resuelto desde el servidor y acá sólo se pinta.
 */
function TrendPill({ trend }: { trend: Trend }) {
  const Icon =
    trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;

  const tone =
    trend.direction === "flat"
      ? "bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400"
      : trend.good
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";

  return (
    <span
      title="Contra el mismo tramo del mes pasado"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      <Icon className="size-3" />
      {trend.text}
    </span>
  );
}

function ConversationList({
  conversations,
  timezone,
  onOpen,
}: {
  conversations: ConversationRow[];
  timezone: string;
  onOpen?: (conversation: ConversationRow) => void;
}) {
  return (
    <ul className="mt-4 divide-y divide-neutral-100 dark:divide-white/10">
      {conversations.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpen?.(item)}
            disabled={!onOpen}
            className="flex w-full items-center gap-3 py-3 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-neutral-50 dark:enabled:hover:bg-white/5"
          >
            <span className={`grid size-10 place-items-center rounded-xl text-xs font-semibold ${avatarColor(item.contactName)}`}>
              {initials(item.contactName)}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{item.contactName}</strong>
              <span className="text-sm text-neutral-500">
                {CHANNEL_LABELS[item.channel]} · <span suppressHydrationWarning>{dateTime(item.updatedAt, timezone)}</span>
              </span>
            </span>
            {item.unreadCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-neutral-950">{item.unreadCount}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ModuleView({
  view,
  data,
  openChat,
  onOpenChat,
  onAdd,
  onNotice,
  onOpenLead,
  onOpenTareas,
}: {
  view: View;
  data: CrmData;
  openChat: string | null;
  onOpenChat: (conversationId: string | null) => void;
  onAdd: () => void;
  onNotice: (message: string) => void;
  onOpenLead: (contactId: string) => void;
  onOpenTareas: () => void;
}) {
  const access = useAccess();

  // Sin encabezado: el menú lateral ya marca en qué sección estás, y repetirlo
  // acá con una bajada explicativa sólo empujaba el contenido hacia abajo.
  return (
    <>
      {view === "Contactos" && access.can("crear_contactos") && (
        <div className="mb-5 flex justify-end">
          <button onClick={onAdd} className={`${PRIMARY_BUTTON_CLASS} h-11`}>
            <Plus className="size-4" />
            Nuevo contacto
          </button>
        </div>
      )}

      <div>
        {view === "Contactos" && (
          <ContactsPanel
            contacts={data.contacts}
            archivedContacts={data.archivedContacts}
            onAdd={onAdd}
            onNotice={onNotice}
            onOpenLead={onOpenLead}
          />
        )}
        {view === "Conversaciones" && (
          <InboxView
            conversations={data.conversations}
            pendingContacts={data.pendingContacts}
            stages={data.stages}
            timezone={data.timezone}
            openId={openChat}
            onOpenId={onOpenChat}
            onNotice={onNotice}
            onOpenTareas={onOpenTareas}
          />
        )}
        {view === "Pipeline" && (
          <PipelinePanel
            pipelines={data.pipelines}
            stages={data.stages}
            opportunities={data.opportunities}
            contacts={data.contacts}
            tareas={data.tareas}
            timezone={data.timezone}
            onNotice={onNotice}
            onOpenLead={onOpenLead}
            onOpenTareas={onOpenTareas}
          />
        )}
        {view === "Agenda" && (
          <AgendaPanel
            appointments={data.appointments}
            contacts={data.contacts}
            timezone={data.timezone}
            onNotice={onNotice}
            onOpenLead={onOpenLead}
          />
        )}
        {view === "Tareas" && (
          <TareasPanel
            tareas={data.tareas}
            tareasError={data.tareasError}
            timezone={data.timezone}
            onNotice={onNotice}
            onOpenLead={onOpenLead}
          />
        )}
        {view === "Agentes IA" && (
          <AgentsPanel pipelines={data.pipelines} stages={data.stages} onNotice={onNotice} />
        )}
        {view === "Base de datos" && <BaseDeDatosPanel stages={data.stages} />}
        {view === "Configuración" && <SettingsPanel timezone={data.timezone} />}
      </div>
    </>
  );
}

function ContactRowItem({
  contact,
  archived,
  selecting,
  selected,
  onToggleSelected,
  onNotice,
  onOpenLead,
}: {
  contact: ContactRow;
  archived: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onNotice: (message: string) => void;
  onOpenLead: (contactId: string) => void;
}) {
  const access = useAccess();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = () => {
    startTransition(async () => {
      const result = archived
        ? await restoreContact({ id: contact.id })
        : await archiveContact({ id: contact.id });
      onNotice(
        result.ok
          ? archived
            ? `${contact.name} volvió a tus contactos.`
            : `${contact.name} fue archivado. Sus chats siguen guardados.`
          : result.error,
      );
    });
  };

  return (
    <li className={`flex items-center gap-3 py-4 transition-opacity ${pending ? "opacity-50" : ""}`}>
      {selecting && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`Seleccionar a ${contact.name}`}
          className="size-4 shrink-0 cursor-pointer accent-amber-500"
        />
      )}
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-xs font-semibold ${avatarColor(contact.name)}`}>
        {initials(contact.name)}
      </span>
      <button
        type="button"
        onClick={() => (selecting ? onToggleSelected() : onOpenLead(contact.id))}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <strong className="block truncate text-sm hover:underline">{contact.name}</strong>
        <span className="text-sm text-neutral-500">
          {contact.email || contact.phone || "Sin datos de contacto"}
        </span>
      </button>
      <span className="hidden text-xs text-neutral-400 sm:block" suppressHydrationWarning>
        {new Date(contact.createdAt).toLocaleDateString("es-AR")}
      </span>
      <button
        disabled={pending}
        onClick={run}
        hidden={selecting}
        aria-label={archived ? `Restaurar a ${contact.name}` : `Archivar a ${contact.name}`}
        title={archived ? "Restaurar" : "Archivar (no borra los chats)"}
        className="grid size-9 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed dark:hover:bg-white/10 dark:hover:text-neutral-200"
      >
        {archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
      </button>
      <button
        disabled={pending}
        onClick={() => setConfirmingDelete(true)}
        hidden={selecting || !access.can("eliminar_contactos")}
        aria-label={`Borrar a ${contact.name}`}
        title="Borrar de la base (no se puede deshacer)"
        className="grid size-9 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed dark:hover:bg-red-500/10 dark:hover:text-red-400"
      >
        <Trash2 className="size-4" />
      </button>

      {confirmingDelete && (
        <DeleteContactModal
          contacts={[contact]}
          close={() => setConfirmingDelete(false)}
          onNotice={onNotice}
        />
      )}
    </li>
  );
}

function ContactsPanel({
  contacts,
  archivedContacts,
  onAdd,
  onNotice,
  onOpenLead,
}: {
  contacts: ContactRow[];
  archivedContacts: ContactRow[];
  onAdd: () => void;
  onNotice: (message: string) => void;
  onOpenLead: (contactId: string) => void;
}) {
  const access = useAccess();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const source = showArchived ? archivedContacts : contacts;
  const term = query.trim().toLowerCase();
  const filtered = term
    ? source.filter((contact) =>
        [contact.name, contact.email ?? "", contact.phone ?? ""].some((field) => field.toLowerCase().includes(term)),
      )
    : source;

  const selectedSet = new Set(selected);
  const chosen = source.filter((contact) => selectedSet.has(contact.id));
  const allVisibleChosen = filtered.length > 0 && filtered.every((c) => selectedSet.has(c.id));

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  // "Todos" opera sobre lo que se está viendo, no sobre la lista entera: con un
  // filtro puesto, marcar contactos que no están en pantalla sería una trampa.
  const toggleAll = () =>
    setSelected(allVisibleChosen ? [] : filtered.map((contact) => contact.id));

  const leaveSelection = () => {
    setSelecting(false);
    setSelected([]);
  };

  if (contacts.length === 0 && archivedContacts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={UsersRound}
          title="Todavía no hay contactos"
          description={
            access.can("crear_contactos")
              ? "Creá el primero: se guarda en Supabase y entra al embudo como lead."
              : "Todavía no te asignaron ningún lead."
          }
          action={
            access.can("crear_contactos") ? (
              <button onClick={onAdd} className={PRIMARY_BUTTON_CLASS}>
                <Plus className="size-4" />
                Nuevo contacto
              </button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            aria-label="Buscar contactos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, email o teléfono"
            className={`${INPUT_CLASS} py-2.5 pl-10 pr-4 text-sm`}
          />
        </div>
        {access.can("eliminar_contactos") && (
          <button
            onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
            className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
              selecting
                ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
                : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            {selecting ? "Cancelar" : "Eliminar varios"}
          </button>
        )}
        {archivedContacts.length > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
              showArchived
                ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
                : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            {showArchived ? "Ver activos" : `Archivados (${archivedContacts.length})`}
          </button>
        )}
      </div>

      {selecting && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 px-4 py-3 dark:bg-white/[.04]">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allVisibleChosen}
              onChange={toggleAll}
              className="size-4 cursor-pointer accent-amber-500"
            />
            {allVisibleChosen ? "Desmarcar todos" : "Seleccionar todos"}
          </label>
          <span className="text-sm text-neutral-500">
            {selected.length === 0
              ? "Ninguno seleccionado"
              : `${selected.length} ${selected.length === 1 ? "seleccionado" : "seleccionados"}`}
          </span>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => setConfirming(true)}
            className="ml-auto cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="mr-1.5 inline size-4 align-[-3px]" />
            Eliminar {selected.length > 0 && `(${selected.length})`}
          </button>
        </div>
      )}

      {showArchived && (
        <p className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500 dark:bg-white/[.04]">
          Los contactos archivados no se borran. Sus conversaciones, mensajes y oportunidades
          siguen guardados y vuelven a aparecer si los restaurás.
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Sin resultados"
          description={
            term
              ? `Ningún contacto coincide con “${query}”.`
              : "No hay contactos archivados."
          }
        />
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100 dark:divide-white/10">
          {filtered.map((contact) => (
            <ContactRowItem
              key={contact.id}
              contact={contact}
              archived={showArchived}
              selecting={selecting}
              selected={selectedSet.has(contact.id)}
              onToggleSelected={() => toggle(contact.id)}
              onNotice={onNotice}
              onOpenLead={onOpenLead}
            />
          ))}
        </ul>
      )}

      {confirming && chosen.length > 0 && (
        <DeleteContactModal
          contacts={chosen}
          close={() => setConfirming(false)}
          onNotice={(message) => {
            leaveSelection();
            onNotice(message);
          }}
        />
      )}
    </Card>
  );
}

/** Contacto sin conversación abierta: figura en la bandeja como pendiente. */
function PendingContactList({
  contacts,
  onOpen,
}: {
  contacts: ContactRow[];
  onOpen: (contactId: string) => void;
}) {
  return (
    <ul className="mt-4 divide-y divide-neutral-100 dark:divide-white/10">
      {contacts.map((contact) => (
        <li key={contact.id}>
          <button
            type="button"
            onClick={() => onOpen(contact.id)}
            className="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
          >
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-xs font-semibold ${avatarColor(contact.name)}`}>
              {initials(contact.name)}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{contact.name}</strong>
              <span className="text-sm text-neutral-500">{contact.phone || contact.email || "Sin datos de contacto"}</span>
            </span>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 dark:bg-white/10 dark:text-neutral-300">
              Sin mensajes
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Trae los chats que Zernio ya tiene.
 *
 * Es idempotente, así que sirve tanto para la carga inicial del historial como
 * para ponerse al día si el webhook estuvo caído.
 */
function ContactModal({
  stages,
  close,
  onSaved,
}: {
  stages: StageRow[];
  close: () => void;
  onSaved: (name: string, warning?: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError("");

    startTransition(async () => {
      const result = await createContact({
        name: trimmed,
        email,
        phone,
        stageId,
        value: Number(value || 0),
      });
      if (result.ok) onSaved(trimmed, result.warning);
      else setError(result.error);
    });
  };

  return (
    <Modal title="Nuevo contacto" onClose={close}>
      <form onSubmit={save}>
        <label className="mt-6 block text-sm font-medium" htmlFor="contact-name">
          Nombre completo
        </label>
        <input
          autoFocus
          id="contact-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          placeholder="Ej. María Rodríguez"
          className={`${INPUT_CLASS} mt-2`}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="contact-email">
              Email <span className="font-normal text-neutral-400">(opcional)</span>
            </label>
            <input
              id="contact-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="contact-phone">
              Teléfono <span className="font-normal text-neutral-400">(opcional)</span>
            </label>
            <input
              id="contact-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-neutral-50 p-4 dark:bg-white/[.04]">
          <p className="text-sm font-medium">Oportunidad en el embudo</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Se crea junto con el contacto, así aparece en el Pipeline desde el arranque.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium" htmlFor="contact-stage">
                Etapa
              </label>
              <select
                id="contact-stage"
                value={stageId}
                onChange={(event) => setStageId(event.target.value)}
                className={`${INPUT_CLASS} mt-2 cursor-pointer`}
              >
                {stages.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="contact-value">
                Valor (US$)
              </label>
              <input
                id="contact-value"
                type="number"
                min="0"
                step="1000"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0"
                className={`${INPUT_CLASS} mt-2`}
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
            {pending ? "Guardando…" : "Guardar contacto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
