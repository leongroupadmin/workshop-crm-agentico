import "server-only";

import {
  DEFAULT_TIMEZONE,
  dayKeyInZone,
  monthStartKey,
  safeTimeZone,
  shiftDayKey,
  startOfDayInZone,
  weekdayOfDayKey,
} from "@/lib/fechas";
import {
  dineroCompacto,
  formatearDuracion,
  variacion,
  type Trend,
} from "@/lib/metricas";
import { leerLeadsPorCanal, type LeadsDeUnCanal } from "@/lib/leads-por-canal";
import { getSupabaseServer } from "@/lib/supabase/server";
import { CAMPOS_DE_TAREA, errorDeTarea, filaATarea, type TareaRow } from "@/lib/tareas";
import type {
  AppointmentStatus,
  Channel,
  ConversationStatus,
  StageKind,
} from "@/types/database";

export type Metric = {
  label: string;
  value: string;
  hint: string;
  /**
   * Cómo viene contra el mismo tramo del mes pasado. Ausente cuando no hay
   * con qué comparar: los dos períodos en cero.
   */
  trend?: Trend;
};

export type ActivityBar = { day: string; count: number };

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  createdAt: string;
};

export type ConversationRow = {
  id: string;
  contactId: string;
  contactName: string;
  channel: Channel;
  /** Por dónde sale el chat. Decide si hay plantillas y si corre la ventana. */
  provider: string | null;
  status: ConversationStatus;
  unreadCount: number;
  /** Fijada arriba de la bandeja con una estrella. */
  destacada: boolean;
  updatedAt: string;
  /** Ultima vez que escribio el contacto. En WhatsApp marca la ventana operativa. */
  lastContactMessageAt: string | null;
  /**
   * Último mensaje del hilo, lo haya escrito el contacto o el equipo.
   *
   * Es con lo que se ordena la bandeja. No sirve `updatedAt`: un trigger lo
   * pisa en cada `update` de la fila, así que abrir un chat, destacarlo o
   * apagarle el bot lo mandaba arriba de todo sin que nadie hubiera escrito.
   */
  lastMessageAt: string | null;
};

/**
 * Un embudo. El primero es donde entran los leads nuevos.
 *
 * Misma convención que la primera columna dentro de cada embudo, para que haya
 * una sola regla que recordar: lo que está primero es la entrada.
 */
export type PipelineRow = {
  id: string;
  name: string;
  position: number;
};

/** Una columna del embudo, tal como la ordenó el usuario. */
export type StageRow = {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  /** De qué embudo es. La posición se cuenta dentro del embudo. */
  pipelineId: string;
  /**
   * El nombre del embudo, repetido en cada etapa.
   *
   * Va acá y no se busca en la lista de embudos porque lo necesita cualquier
   * selector de etapas de la app —automatizaciones, difusiones, importación, el
   * inbox—, y pasarles la lista de embudos a todos sería plomería para mostrar
   * una palabra. Dos columnas que se llaman igual en dos embudos distintos son
   * indistinguibles sin esto.
   */
  pipelineName: string;
};

export type OpportunityRow = {
  id: string;
  contactId: string;
  contactName: string;
  /** Se muestra en la tarjeta del embudo cuando el lead vino por WhatsApp. */
  contactPhone: string | null;
  /** Si la IA le contesta sola. Se ve en la tarjeta sin tener que abrirla. */
  botEnabled: boolean;
  stageId: string;
  value: number;
  /** Canales por los que ese contacto ya escribió. Vacío si se cargó a mano. */
  channels: Channel[];
  /** Quién tiene el lead. `null` es la bolsa de sin asignar. */
  assignedTo: string | null;
  /** Cuándo entró el lead. Es la fecha de alta del contacto, no la de la tarjeta. */
  createdAt: string;
};

/**
 * Una derivación: la IA pidió que siga una persona.
 *
 * No sale de una tabla de notificaciones sino de `conversations.status`, que se
 * pone en `pending` en un solo lugar de todo el código — `ai-reply.ts`, cuando
 * el agente deriva. Mientras siga siendo el único que lo escribe, pendiente y
 * derivación son la misma cosa.
 *
 * Trae el último mensaje del contacto a propósito: la campana tiene que dejarte
 * elegir cuál atender primero sin abrir ninguna.
 */
export type HandoffRow = {
  conversationId: string;
  contactId: string;
  contactName: string;
  channel: Channel;
  /** Cuándo se derivó, o lo más cerca que tenemos: el último cambio del chat. */
  updatedAt: string;
  lastMessage: string | null;
};

/**
 * Un chat con mensajes que nadie del equipo leyó todavía.
 *
 * Tiene la forma de una derivación porque se abre igual, de la campana al
 * chat; acá `updatedAt` es la última vez que escribió el contacto. No incluye
 * los derivados: ésos ya están en la campana como lo que son, y repetirlos
 * como "mensaje nuevo" escondería que alguien pidió una persona.
 */
export type ChatSinLeerRow = HandoffRow & {
  /** Mensajes que entraron desde que alguien lo abrió por última vez. */
  sinLeer: number;
};

export type AppointmentRow = {
  id: string;
  title: string;
  /** Para abrir la ficha del contacto —y su chat— desde la cita. */
  contactId: string;
  contactName: string;
  /** `calendar` si bajó de Google Calendar; null si se cargó en el CRM. */
  origen: string | null;
  /** El enlace de la cita: el de Calendar, o el que se cargó a mano. */
  enlace: string | null;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
};

/**
 * Una cita que bajó de Calendar y que todavía nadie del equipo miró.
 *
 * Va en la campana junto a las derivaciones porque las dos responden a la
 * misma pregunta —"¿pasó algo que tenga que atender?"—, pero no son lo mismo:
 * una derivación es alguien esperando una respuesta ahora, y una reserva es
 * algo que hay que preparar. Por eso conviven en la lista y no en el contador.
 */
export type CitaNuevaRow = {
  appointmentId: string;
  contactId: string;
  contactName: string;
  title: string;
  startTime: string;
  /** Cuándo entró la reserva. Es lo que ordena la campana, no el turno. */
  createdAt: string;
};

export type CrmData = {
  metrics: Metric[];
  activity: ActivityBar[];
  /**
   * Por qué canal llegó cada lead, para la torta. `null` cuando la base no
   * tiene corrida la migración: el tablero sigue andando y la tarjeta lo dice.
   */
  leadsPorCanal: LeadsDeUnCanal[] | null;
  /**
   * Zona con la que se armaron las barras y las métricas del mes. Viaja al
   * navegador para que el encabezado muestre el mismo día que el gráfico.
   */
  timezone: string;
  contacts: ContactRow[];
  /** Contactos archivados: ocultos de los listados, pero conservados. */
  archivedContacts: ContactRow[];
  conversations: ConversationRow[];
  /** Contactos activos que todavía no iniciaron una conversación. */
  pendingContacts: ContactRow[];
  /** Chats donde la IA pidió que siga una persona. Alimenta la campana. */
  handoffs: HandoffRow[];
  /** Chats con mensajes sin leer que no están derivados. También van a la campana. */
  chatsSinLeer: ChatSinLeerRow[];
  citasNuevas: CitaNuevaRow[];
  /** Columnas del embudo, ya ordenadas. */
  pipelines: PipelineRow[];
  stages: StageRow[];
  opportunities: OpportunityRow[];
  appointments: AppointmentRow[];
  /**
   * Las tareas pendientes de quien mira, de la más urgente a la menos. Las del
   * equipo y las cerradas se piden aparte, desde la sección Tareas.
   */
  tareas: TareaRow[];
  /**
   * Por qué no se pudieron traer las tareas. Lo normal es que falte correr la
   * migración: el resto del tablero tiene que andar igual.
   */
  tareasError: string | null;
  totalUnread: number;
};

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const CONTACT_FIELDS = "id, name, email, phone, tags, created_at";

/**
 * Los contactos activos se traen con los ids de sus chats embebidos.
 *
 * Es para saber quién todavía no escribió nunca. Antes se deducía cruzando
 * contra las conversaciones cargadas, que vienen recortadas a las 50 más
 * recientes: alguien con un chat viejo aparecía como "sin conversación".
 */
const CONTACT_FIELDS_CON_CHATS = `${CONTACT_FIELDS}, conversations(id)`;

/** Registro embebido, tolerando objeto o arreglo de un elemento. */
function relatedRecord(related: unknown): Record<string, unknown> {
  const record = Array.isArray(related) ? related[0] : related;
  return (record ?? {}) as Record<string, unknown>;
}

function relatedName(related: unknown): string {
  const name = relatedRecord(related).name;
  return typeof name === "string" && name.length > 0 ? name : "Contacto sin nombre";
}

type RawContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  created_at: string;
};

/** La fila única que devuelve `metricas_resumen`. Todo llega en crudo. */
type ResumenRow = {
  contactos: number;
  leads_nuevos: number;
  leads_nuevos_previos: number;
  sin_leer: number;
  sin_responder: number;
  derivaciones: number;
  ganado: number;
  ganado_operaciones: number;
  ganado_previo: number;
  /** Segundos. La espera más larga que alguien aguantó en el mes. */
  replica_peor: number;
  replica_mediana: number;
  replicas: number;
  replica_peor_previa: number;
};

/**
 * Lo que devuelve la base es texto o número según el tipo de la columna, y
 * `numeric` puede llegar como string. Si la métrica no vino —la función
 * todavía no existe en esa base— vale el reemplazo.
 */
function numero(valor: unknown, porDefecto: number): number {
  if (valor === null || valor === undefined) return porDefecto;
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : porDefecto;
}

const toContactRow = (row: RawContact): ContactRow => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  tags: row.tags ?? [],
  createdAt: row.created_at,
});

/**
 * Últimos 7 días (incluye hoy) como buckets vacíos, del más viejo al más nuevo.
 *
 * Los días son los de la zona del workspace, no los del servidor. Con
 * `new Date()` a secas Vercel contestaba en UTC y después de las 21:00 en
 * Argentina la última barra ya era la de mañana.
 */
function emptyWeek(todayKey: string): { key: string; bar: ActivityBar }[] {
  return Array.from({ length: 7 }, (_, index) => {
    const key = shiftDayKey(todayKey, index - 6);
    return {
      key,
      bar: { day: WEEKDAYS[weekdayOfDayKey(key)], count: 0 },
    };
  });
}

export async function getCrmData(
  workspaceId: string,
  workspaceTimezone: string = DEFAULT_TIMEZONE,
  userId: string | null = null,
): Promise<CrmData> {
  const supabase = await getSupabaseServer();
  const timezone = safeTimeZone(workspaceTimezone);
  const now = new Date();

  // Todos los cortes salen del día calendario en la zona del workspace: el
  // servidor no opina sobre cuándo empieza "hoy".
  const todayKey = dayKeyInZone(now, timezone);
  const weekAgo = startOfDayInZone(shiftDayKey(todayKey, -6), timezone);
  const mesKey = monthStartKey(todayKey);
  const monthStart = startOfDayInZone(mesKey, timezone);

  // Con qué se compara: no el mes pasado entero sino su mismo tramo. Un 5
  // del mes contra treinta y un días mostraría un derrumbe donde lo único
  // que pasó es que van cinco días. Si el mes pasado fue más corto que lo
  // transcurrido de éste, el tramo se corta donde ese mes terminó.
  const previoInicio = startOfDayInZone(monthStartKey(shiftDayKey(mesKey, -1)), timezone);
  const previoFin = new Date(
    Math.min(
      previoInicio.getTime() + (now.getTime() - monthStart.getTime()),
      monthStart.getTime(),
    ),
  );

  // Todo se filtra por contacto activo: archivar un contacto lo oculta de
  // cada módulo sin borrar una sola fila.
  const [
    contactsResult,
    archivedResult,
    conversationsResult,
    opportunitiesResult,
    appointmentsResult,
    citasNuevasResult,
    messagesResult,
    stagesResult,
    pipelinesResult,
    metricasResult,
    leadsPorCanalResult,
    tareasResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(CONTACT_FIELDS_CON_CHATS)
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("contacts")
      .select(CONTACT_FIELDS)
      .eq("workspace_id", workspaceId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(100),
    supabase
      .from("conversations")
      .select(
        "id, contact_id, channel, provider, status, unread_count, destacada, updated_at, contacts!inner(name, archived_at)",
      )
      .eq("workspace_id", workspaceId)
      .is("contacts.archived_at", null)
      // Las destacadas primero y dentro del recorte de 50: si quedaran sujetas
      // al orden por actividad, la estrella se perdería apenas el chat pasa
      // unos días callado, que es justo cuando sirve.
      .order("destacada", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("opportunities")
      .select(
        "id, contact_id, stage_id, value, contacts!inner(name, phone, bot_enabled, assigned_to, created_at, archived_at)",
      )
      .eq("workspace_id", workspaceId)
      .is("contacts.archived_at", null),
    supabase
      .from("appointments")
      .select(
        "id, title, contact_id, origen, calendar_link, start_time, end_time, status, contacts!inner(name, archived_at)",
      )
      .eq("workspace_id", workspaceId)
      .is("contacts.archived_at", null)
      .gte("start_time", now.toISOString())
      .order("start_time", { ascending: true })
      .limit(25),
    // Las que bajaron de Calendar y nadie miró todavía. Sólo las de Calendar:
    // una cita cargada a mano en el CRM ya la vio quien la cargó.
    supabase
      .from("appointments")
      .select("id, title, contact_id, start_time, created_at, contacts!inner(name, archived_at)")
      .eq("workspace_id", workspaceId)
      .eq("origen", "calendar")
      .eq("vista", false)
      .is("contacts.archived_at", null)
      // Las últimas que entraron: si hay más de veinte sin ver, las que se
      // quedan afuera tienen que ser las viejas, igual que en la campana.
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("messages")
      .select("created_at, conversations!inner(workspace_id)")
      .eq("conversations.workspace_id", workspaceId)
      .gte("created_at", weekAgo.toISOString()),
    supabase
      .from("pipeline_stages")
      .select("id, name, position, kind, pipeline_id")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    supabase
      .from("pipelines")
      .select("id, name, position")
      .eq("workspace_id", workspaceId)
      // `created_at` desempata: la posición no es única, y sin un segundo
      // criterio el "primero" podría cambiar entre dos cargas.
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    // Las métricas no se sacan de las filas de arriba. Ésas vienen paginadas
    // para pintar los módulos, y contar sobre una página da números que se
    // congelan sin avisar: "Contactos" se quedaba en 200 para siempre. Acá
    // cuenta Postgres, que además es el único que puede mirar mensaje contra
    // mensaje sin traerse el mes entero a la memoria del servidor.
    supabase.rpc("metricas_resumen", {
      p_workspace: workspaceId,
      p_desde: monthStart.toISOString(),
      p_hasta: now.toISOString(),
      p_previo_desde: previoInicio.toISOString(),
      p_previo_hasta: previoFin.toISOString(),
    }),
    // Aparte de las métricas porque devuelve una fila por canal. El tramo es el
    // mismo, así que la torta del mes suma lo que dice "Leads nuevos".
    supabase.rpc("leads_por_canal", {
      p_workspace: workspaceId,
      p_desde: monthStart.toISOString(),
      p_hasta: now.toISOString(),
    }),
    // Todas las pendientes de quien mira, no sólo las de hoy: el número del
    // menú cuenta las vencidas, y una de hace una semana es la que más importa.
    // Sin lead embebido con `!inner`: una tarea suelta no tiene contacto, y una
    // de un lead archivado sigue siendo trabajo de alguien.
    userId
      ? supabase
          .from("tareas")
          .select(CAMPOS_DE_TAREA)
          .eq("workspace_id", workspaceId)
          .eq("asignada_a", userId)
          .eq("estado", "pendiente")
          .order("vence_at", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const rawContacts = contactsResult.data ?? [];
  const contacts = rawContacts.map(toContactRow);
  const archivedContacts = (archivedResult.data ?? []).map(toContactRow);

  const conversations: ConversationRow[] = (conversationsResult.data ?? []).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    contactName: relatedName(row.contacts),
    channel: row.channel,
    provider: row.provider ?? null,
    status: row.status,
    unreadCount: row.unread_count ?? 0,
    destacada: row.destacada ?? false,
    updatedAt: row.updated_at,
    lastContactMessageAt: null,
    lastMessageAt: null,
  }));

  const lastContactMessageByConversation = new Map<string, string>();
  const lastMessageByConversation = new Map<string, string>();
  if (conversations.length > 0) {
    const ids = conversations.map((item) => item.id);

    // Dos consultas y no una con los dos sentidos: la ventana de WhatsApp
    // necesita el último mensaje *del contacto*, y en un hilo donde el equipo
    // acaba de mandar veinte seguidos el recorte de mil se los come y la
    // ventana quedaría sin fecha.
    const [contacto, cualquiera] = await Promise.all([
      supabase
        .from("messages")
        .select("conversation_id, created_at")
        .in("conversation_id", ids)
        .eq("sender_type", "contact")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("messages")
        .select("conversation_id, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);

    for (const row of contacto.data ?? []) {
      if (!lastContactMessageByConversation.has(row.conversation_id)) {
        lastContactMessageByConversation.set(row.conversation_id, row.created_at);
      }
    }

    for (const row of cualquiera.data ?? []) {
      if (!lastMessageByConversation.has(row.conversation_id)) {
        lastMessageByConversation.set(row.conversation_id, row.created_at);
      }
    }

    for (const item of conversations) {
      item.lastContactMessageAt = lastContactMessageByConversation.get(item.id) ?? null;
      // Cuando el chat se queda afuera del recorte, el del contacto es la
      // mejor fecha que hay: peor es caer en `updatedAt`, que miente.
      item.lastMessageAt =
        lastMessageByConversation.get(item.id) ?? item.lastContactMessageAt ?? null;
    }
  }

  // Sale del embebido y no de `conversations`, que llega recortada: lo que
  // define a un contacto pendiente es no tener ni un chat, no faltar de la
  // página de los cincuenta más recientes.
  const pendingContacts = rawContacts
    .filter((row: { conversations?: unknown[] }) => (row.conversations ?? []).length === 0)
    .map(toContactRow);

  // Un contacto puede escribir por varios canales: la tarjeta del embudo los
  // muestra todos, porque es el mismo lead.
  const channelsByContact = new Map<string, Channel[]>();
  for (const item of conversations) {
    const list = channelsByContact.get(item.contactId) ?? [];
    if (!list.includes(item.channel)) list.push(item.channel);
    channelsByContact.set(item.contactId, list);
  }

  // Los chats que van a la campana: los derivados y los que tienen mensajes
  // sin leer. Un derivado no se repite como "sin leer" aunque lo esté.
  //
  // Se pide después del resto y sólo si hay alguno: es una consulta de más que
  // no tiene sentido pagar en cada carga del dashboard cuando la campana está
  // vacía. El recorte cubre varios mensajes por chat: con uno que mandó veinte
  // seguidos, uno de cien dejaba a los demás sin vista previa.
  const pendientes = conversations.filter((item) => item.status === "pending");
  const conMensajesNuevos = conversations.filter(
    (item) => item.status !== "pending" && item.unreadCount > 0,
  );
  const ultimoMensaje = new Map<string, string>();

  if (pendientes.length > 0 || conMensajesNuevos.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select("conversation_id, content")
      .in(
        "conversation_id",
        [...pendientes, ...conMensajesNuevos].map((item) => item.id),
      )
      .eq("sender_type", "contact")
      .order("created_at", { ascending: false })
      .limit(300);

    // Vienen del más nuevo al más viejo: el primero de cada chat es el último
    // que escribió esa persona.
    for (const row of data ?? []) {
      if (!ultimoMensaje.has(row.conversation_id)) {
        const content = typeof row.content === "string" ? row.content.trim() : "";
        if (content) ultimoMensaje.set(row.conversation_id, content);
      }
    }
  }

  const handoffs: HandoffRow[] = pendientes.map((item) => ({
    conversationId: item.id,
    contactId: item.contactId,
    contactName: item.contactName,
    channel: item.channel,
    updatedAt: item.updatedAt,
    lastMessage: ultimoMensaje.get(item.id) ?? null,
  }));

  const chatsSinLeer: ChatSinLeerRow[] = conMensajesNuevos.map((item) => ({
    conversationId: item.id,
    contactId: item.contactId,
    contactName: item.contactName,
    channel: item.channel,
    updatedAt: item.lastContactMessageAt ?? item.updatedAt,
    lastMessage: ultimoMensaje.get(item.id) ?? null,
    sinLeer: item.unreadCount,
  }));

  const citasNuevas: CitaNuevaRow[] = (citasNuevasResult.data ?? []).map((row) => ({
    appointmentId: row.id,
    contactId: row.contact_id,
    contactName: relatedName(row.contacts),
    title: row.title,
    startTime: row.start_time,
    createdAt: row.created_at,
  }));

  const pipelines: PipelineRow[] = (pipelinesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
  }));

  const nombreDelEmbudo = new Map(pipelines.map((item) => [item.id, item.name]));

  const stages: StageRow[] = (stagesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    kind: row.kind as StageKind,
    pipelineId: row.pipeline_id,
    pipelineName: nombreDelEmbudo.get(row.pipeline_id) ?? "",
  }));

  const rawOpportunities = opportunitiesResult.data ?? [];
  const opportunities: OpportunityRow[] = rawOpportunities.map((row) => {
    const contact = relatedRecord(row.contacts);
    return {
    id: row.id,
    contactId: row.contact_id,
    contactName: relatedName(row.contacts),
    contactPhone: typeof contact.phone === "string" ? contact.phone : null,
    botEnabled: contact.bot_enabled !== false,
    stageId: row.stage_id,
    value: Number(row.value ?? 0),
    channels: channelsByContact.get(row.contact_id) ?? [],
    assignedTo: typeof contact.assigned_to === "string" ? contact.assigned_to : null,
    createdAt: typeof contact.created_at === "string" ? contact.created_at : "",
    };
  });

  const appointments: AppointmentRow[] = (appointmentsResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    contactId: row.contact_id,
    contactName: relatedName(row.contacts),
    origen: row.origen ?? null,
    enlace: row.calendar_link ?? null,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
  }));

  const week = emptyWeek(todayKey);
  const buckets = new Map(week.map((entry) => [entry.key, entry.bar]));
  for (const row of messagesResult.data ?? []) {
    // Recortar el ISO leía la fecha en UTC: un mensaje de las 22:00 del martes
    // en Córdoba se anotaba el miércoles. Hay que preguntar por la zona.
    const bar = buckets.get(dayKeyInZone(String(row.created_at), timezone));
    if (bar) bar.count += 1;
  }

  // Las métricas se apoyan en `kind`, no en el nombre: el usuario puede
  // renombrar "Ganado" y la tasa de conversión sigue contándolo igual.
  const kindOf = new Map(stages.map((stage) => [stage.id, stage.kind]));

  const pipelineValue = opportunities
    .filter((item) => kindOf.get(item.stageId) === "open")
    .reduce((total, item) => total + item.value, 0);

  const closed = opportunities.filter((item) => kindOf.get(item.stageId) !== "open").length;
  const won = opportunities.filter((item) => kindOf.get(item.stageId) === "won").length;
  const conversionRate = closed > 0 ? (won / closed) * 100 : 0;
  const abiertas = opportunities.length - closed;

  // Si la base todavía no tiene corrida la migración de métricas, la función no
  // existe y la llamada falla. El tablero no puede quedar en blanco por eso: se
  // cae a lo que se puede contar con las filas ya traídas, que es exactamente
  // lo que mostraba antes.
  const resumen = (metricasResult.data?.[0] ?? null) as ResumenRow | null;

  const contactosTotal = numero(resumen?.contactos, contacts.length);
  const leadsNuevos = numero(resumen?.leads_nuevos, 0);
  const leadsPrevios = numero(resumen?.leads_nuevos_previos, 0);
  const ganadoMes = numero(resumen?.ganado, 0);
  const ganadoOperaciones = numero(resumen?.ganado_operaciones, 0);
  const ganadoPrevio = numero(resumen?.ganado_previo, 0);
  const sinResponder = numero(resumen?.sin_responder, 0);
  const derivaciones = numero(resumen?.derivaciones, handoffs.length);
  const replicas = numero(resumen?.replicas, 0);
  const replicaPeor = numero(resumen?.replica_peor, 0);
  const replicaMediana = numero(resumen?.replica_mediana, 0);
  const replicaPeorPrevia = numero(resumen?.replica_peor_previa, 0);
  const sinLeer = numero(
    resumen?.sin_leer,
    conversations.reduce((total, item) => total + item.unreadCount, 0),
  );

  return {
    metrics: [
      {
        label: "Contactos",
        value: String(contactosTotal),
        hint: contactosTotal === 0 ? "Todavía sin contactos" : "Activos en tu workspace",
      },
      {
        label: "Leads nuevos",
        value: String(leadsNuevos),
        hint: "Entraron este mes",
        trend: variacion(leadsNuevos, leadsPrevios, true),
      },
      {
        label: "Valor del embudo",
        value: dineroCompacto(pipelineValue),
        hint: `${abiertas} ${abiertas === 1 ? "oportunidad abierta" : "oportunidades abiertas"}`,
      },
      {
        label: "Ganado este mes",
        value: dineroCompacto(ganadoMes),
        hint: `${ganadoOperaciones} ${ganadoOperaciones === 1 ? "operación cerrada" : "operaciones cerradas"} con éxito`,
        trend: variacion(ganadoMes, ganadoPrevio, true),
      },
      {
        // Se queda como estaba: es acumulada desde siempre. Lo único que cambia
        // es que ahora la bajada lo dice, que era lo confuso de tenerla al lado
        // de una tarjeta mensual.
        label: "Tasa de conversión",
        value: closed > 0 ? `${conversionRate.toFixed(1)}%` : "—",
        hint: closed > 0 ? `${won} de ${closed} cerradas, histórico` : "Sin operaciones cerradas",
      },
      {
        label: "Sin responder",
        value: String(sinResponder),
        hint:
          sinResponder === 0
            ? "Ningún chat esperando"
            : "La última palabra la tiene el contacto",
      },
      {
        // El titular es la peor espera del mes y no el promedio: un promedio de
        // cuatro minutos con alguien esperando dos días sigue diciendo que todo
        // está bien. La mediana va en la bajada, que es la que cuenta cómo se
        // atiende habitualmente.
        label: "Peor lapso de réplica",
        value: replicas > 0 ? formatearDuracion(replicaPeor) : "—",
        hint:
          replicas > 0
            ? `Mediana ${formatearDuracion(replicaMediana)} · ${replicas} respuestas del mes`
            : "Sin respuestas registradas este mes",
        trend: replicas > 0 ? variacion(replicaPeor, replicaPeorPrevia, false) : undefined,
      },
      {
        label: "Derivaciones",
        value: String(derivaciones),
        hint: "La IA pidió que siga una persona",
      },
    ],
    activity: week.map((entry) => entry.bar),
    // Acá no hay a qué caer como con las métricas: contar sobre las filas
    // paginadas daría una torta que parece cierta y no lo es.
    leadsPorCanal: leadsPorCanalResult.error ? null : leerLeadsPorCanal(leadsPorCanalResult.data),
    timezone,
    contacts,
    archivedContacts,
    conversations,
    pendingContacts,
    handoffs,
    chatsSinLeer,
    citasNuevas,
    pipelines,
    stages,
    opportunities,
    appointments,
    tareas: (tareasResult.data ?? []).map((row) => filaATarea(row as Record<string, unknown>)),
    tareasError: tareasResult.error ? errorDeTarea(tareasResult.error.message) : null,
    totalUnread: sinLeer,
  };
}
