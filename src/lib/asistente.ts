import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { diaValido, rangoDelPeriodo } from "@/lib/asistente-rangos";
import {
  DEFAULT_TIMEZONE,
  dayKeyInZone,
  longDateInZone,
  safeTimeZone,
  shiftDayKey,
  startOfDayInZone,
} from "@/lib/fechas";
import { formatearDuracion } from "@/lib/metricas";
import type { Herramienta, Llamada } from "@/lib/openai-server";

/**
 * Las herramientas del asistente del CRM.
 *
 * Dos reglas gobiernan este archivo y explican casi todas las decisiones.
 *
 * La primera: **el modelo no cuenta**. Cada herramienta devuelve el número ya
 * calculado —por Postgres cuando se puede— y nunca filas crudas para que el
 * modelo las sume. Un modelo sumando cuatrocientas filas se equivoca y lo dice
 * con total seguridad, que es la peor combinación posible en un tablero.
 *
 * La segunda: **todo pasa por el cliente del usuario**. Acá no entra
 * `getSupabaseAdmin`. El `supabase` que llega es el de la sesión de quien
 * pregunta, así que las políticas de `202608170007_roles_y_permisos.sql`
 * aplican solas: un operario que sólo ve sus leads le pregunta al asistente y
 * obtiene los suyos. Si alguna vez alguien cambia esto por el cliente de
 * servicio "para que ande", el asistente pasa a contarle a cualquiera lo que
 * quiera.
 */

type Contexto = {
  supabase: SupabaseClient;
  workspaceId: string;
  timezone: string;
};

/** Techo de filas que puede devolver un listado. El modelo no necesita más. */
const MAX_FILAS = 25;

/**
 * Techo de leads que vuelven con sus mensajes.
 *
 * Es más bajo que el resto porque cada uno trae texto: doce leads con ocho
 * mensajes cada uno ya son varios miles de tokens que se pagan en esa
 * pregunta. Subirlo es la forma más rápida de que una consulta salga cara.
 */
const MAX_LEADS_ACTIVOS = 20;

/** Mensajes por lead. Los últimos alcanzan para ver de qué se habló. */
const MENSAJES_POR_LEAD = 8;

/** Los mensajes se recortan: el modelo necesita el sentido, no el texto entero. */
const LARGO_MENSAJE = 240;

export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: "metricas_del_periodo",
    descripcion:
      "Números del negocio en un rango de fechas: contactos totales, leads nuevos, mensajes sin leer, chats sin responder, derivaciones a una persona, monto ganado y tiempos de respuesta. Devuelve también el mismo tramo del período anterior para comparar. Si no se indican fechas usa el mes en curso. Usala para cualquier pregunta sobre cómo viene el negocio, cuánto se vendió o cuánto se tarda en responder.",
    parametros: {
      type: "object",
      properties: {
        desde: {
          type: "string",
          description: "Primer día del rango, en formato AAAA-MM-DD. Opcional.",
        },
        hasta: {
          type: "string",
          description:
            "Último día del rango incluido, en formato AAAA-MM-DD. Opcional; por defecto hoy.",
        },
      },
    },
  },
  {
    nombre: "estado_del_embudo",
    descripcion:
      "Cuántas oportunidades y cuánto dinero hay en cada columna del embudo, ahora mismo. Usala para preguntas sobre el pipeline, en qué etapa está trabada la gente, o cuánto hay en juego.",
    parametros: { type: "object", properties: {} },
  },
  {
    nombre: "buscar_leads",
    descripcion:
      // La descripción es el contrato que lee el modelo: si promete un dato que la
      // herramienta no devuelve, el modelo lo afirma igual y se lo inventa. Acá
      // decía "quién es el responsable y por qué canal escribieron", y lo que
      // vuelve es si tiene responsable —no quién— y ningún canal.
      "Busca contactos del CRM y devuelve su etapa en el embudo, el valor de la oportunidad, el teléfono, el email, la fecha de alta y si tiene responsable asignado o no. No devuelve el nombre del responsable ni el canal por el que escribieron. Sirve para 'quién es X', 'qué leads hay en tal etapa', 'qué leads no tienen responsable' o 'los leads que entraron esta semana'.",
    parametros: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          description: "Parte del nombre, el teléfono o el email a buscar. Opcional.",
        },
        etapa: {
          type: "string",
          description: "Nombre de la columna del embudo por la que filtrar. Opcional.",
        },
        sin_asignar: {
          type: "boolean",
          description: "Si es true devuelve sólo los leads sin responsable. Opcional.",
        },
        desde: {
          type: "string",
          description: "Sólo leads dados de alta a partir de esta fecha (AAAA-MM-DD). Opcional.",
        },
      },
    },
  },
  {
    nombre: "chats_pendientes",
    descripcion:
      "Los chats que esperan que los atienda una persona: las derivaciones que hizo la IA y los chats con mensajes sin leer. Devuelve el contacto, el canal, hace cuánto esperan y lo último que escribieron. Usala para 'qué tengo pendiente', 'quién está esperando' o 'qué hay sin contestar'.",
    parametros: { type: "object", properties: {} },
  },
  {
    nombre: "agenda",
    descripcion:
      "Los turnos agendados en un rango de fechas, con el contacto, el título y el estado. Si no se indican fechas devuelve los próximos.",
    parametros: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Desde esta fecha (AAAA-MM-DD). Opcional." },
        hasta: { type: "string", description: "Hasta esta fecha (AAAA-MM-DD). Opcional." },
      },
    },
  },
  {
    nombre: "leads_activos",
    descripcion:
      "Los leads que escribieron en los últimos días, cada uno con lo que dijo y con señales de conducta: cuántas veces escribió, cuánto le contestamos, si tiene turno agendado, en qué etapa está y cuánto vale. Es la herramienta para juzgar quién tiene interés real, a quién conviene llamar primero o quién se está enfriando: todo eso se decide leyendo lo que la persona escribió, no contando mensajes.",
    parametros: {
      type: "object",
      properties: {
        dias: {
          type: "number",
          description: "Cuántos días hacia atrás mirar. Por defecto 14.",
        },
        limite: {
          type: "number",
          description: `Cuántos leads traer, como mucho ${MAX_LEADS_ACTIVOS}. Por defecto 12.`,
        },
      },
    },
  },
  {
    nombre: "historial_de_contacto",
    descripcion:
      "Los últimos mensajes intercambiados con un contacto, para saber de qué se habló. Recibe el id del contacto, que devuelven buscar_leads o chats_pendientes. Usala cuando pregunten qué pasó con alguien en particular.",
    parametros: {
      type: "object",
      properties: {
        contacto_id: { type: "string", description: "El id del contacto." },
      },
      required: ["contacto_id"],
    },
  },
];

/** Ejecuta lo que el modelo pidió. Un nombre desconocido no tira: lo dice. */
export async function ejecutarHerramienta(
  contexto: Contexto,
  llamada: Llamada,
): Promise<unknown> {
  switch (llamada.nombre) {
    case "metricas_del_periodo":
      return metricasDelPeriodo(contexto, llamada.argumentos);
    case "estado_del_embudo":
      return estadoDelEmbudo(contexto);
    case "buscar_leads":
      return buscarLeads(contexto, llamada.argumentos);
    case "chats_pendientes":
      return chatsPendientes(contexto);
    case "leads_activos":
      return leadsActivos(contexto, llamada.argumentos);
    case "agenda":
      return agenda(contexto, llamada.argumentos);
    case "historial_de_contacto":
      return historialDeContacto(contexto, llamada.argumentos);
    default:
      return { error: `No existe la herramienta ${llamada.nombre}.` };
  }
}

/**
 * Las métricas salen del mismo RPC que el tablero.
 *
 * No se recalculan acá a propósito: si el asistente contara por su cuenta,
 * tarde o temprano diría un número distinto del que muestra la pantalla y no
 * habría forma de saber cuál está bien. `metricas_resumen` es `security
 * invoker`, así que además respeta lo que el usuario puede ver.
 */
async function metricasDelPeriodo(contexto: Contexto, args: Record<string, unknown>) {
  const rango = rangoDelPeriodo({
    desde: args.desde,
    hasta: args.hasta,
    hoyKey: dayKeyInZone(new Date(), contexto.timezone),
    timezone: contexto.timezone,
  });

  const { data, error } = await contexto.supabase.rpc("metricas_resumen", {
    p_workspace: contexto.workspaceId,
    p_desde: rango.desde.toISOString(),
    p_hasta: rango.hasta.toISOString(),
    p_previo_desde: rango.previoDesde.toISOString(),
    p_previo_hasta: rango.desde.toISOString(),
  });

  if (error) return { error: error.message };

  const fila = (Array.isArray(data) ? data[0] : data) as Record<string, number> | undefined;
  if (!fila) return { error: "No se pudieron calcular las métricas." };

  return {
    periodo: { desde: rango.desdeKey, hasta: rango.hastaKey },
    periodo_anterior_comparable: {
      desde: rango.previoDesdeKey,
      hasta: rango.previoHastaKey,
    },
    contactos_totales: Number(fila.contactos ?? 0),
    leads_nuevos: Number(fila.leads_nuevos ?? 0),
    leads_nuevos_periodo_anterior: Number(fila.leads_nuevos_previos ?? 0),
    mensajes_sin_leer: Number(fila.sin_leer ?? 0),
    chats_esperando_respuesta: Number(fila.sin_responder ?? 0),
    derivaciones_a_una_persona: Number(fila.derivaciones ?? 0),
    ganado: Number(fila.ganado ?? 0),
    ganado_operaciones: Number(fila.ganado_operaciones ?? 0),
    ganado_periodo_anterior: Number(fila.ganado_previo ?? 0),
    respuesta_mediana: formatearDuracion(Number(fila.replica_mediana ?? 0)),
    respuesta_mas_lenta: formatearDuracion(Number(fila.replica_peor ?? 0)),
    respuestas_medidas: Number(fila.replicas ?? 0),
    moneda: "USD",
  };
}

/** Cuántas y cuánto hay en cada columna. La suma la hace esta función, no el modelo. */
async function estadoDelEmbudo(contexto: Contexto) {
  const [stages, oportunidades] = await Promise.all([
    contexto.supabase
      .from("pipeline_stages")
      .select("id, name, position, kind, pipelines(name)")
      .eq("workspace_id", contexto.workspaceId)
      .order("position", { ascending: true }),
    contexto.supabase
      .from("opportunities")
      .select("stage_id, value, contacts!inner(archived_at)")
      .eq("workspace_id", contexto.workspaceId)
      .is("contacts.archived_at", null),
  ]);

  if (stages.error) return { error: stages.error.message };
  if (oportunidades.error) return { error: oportunidades.error.message };

  const porEtapa = new Map<string, { cantidad: number; valor: number }>();
  for (const fila of oportunidades.data ?? []) {
    const actual = porEtapa.get(fila.stage_id) ?? { cantidad: 0, valor: 0 };
    actual.cantidad += 1;
    actual.valor += Number(fila.value ?? 0);
    porEtapa.set(fila.stage_id, actual);
  }

  // El embudo de cada columna va en la respuesta porque el modelo suma lo que
  // le llega: sin distinguirlos, dos procesos distintos —vender y dar
  // posventa— se leían como un solo embudo con las columnas repetidas.
  const columnas = (stages.data ?? []).map((stage) => {
    const acumulado = porEtapa.get(stage.id) ?? { cantidad: 0, valor: 0 };
    return {
      embudo: relacion(stage.pipelines)?.name ?? "",
      etapa: stage.name,
      tipo: stage.kind,
      oportunidades: acumulado.cantidad,
      valor: acumulado.valor,
    };
  });

  return {
    columnas,
    total_oportunidades: columnas.reduce((suma, fila) => suma + fila.oportunidades, 0),
    total_valor: columnas.reduce((suma, fila) => suma + fila.valor, 0),
    moneda: "USD",
    nota: "El tipo 'won' es ganado y 'lost' es perdido; el resto son etapas abiertas. Las columnas son de embudos distintos: sumalas por embudo antes de comparar.",
  };
}

async function buscarLeads(contexto: Contexto, args: Record<string, unknown>) {
  const texto = typeof args.texto === "string" ? args.texto.trim() : "";
  const etapa = typeof args.etapa === "string" ? args.etapa.trim() : "";
  const desdeKey = diaValido(args.desde);

  let query = contexto.supabase
    .from("opportunities")
    .select(
      "id, value, stage_id, contacts!inner(id, name, phone, email, assigned_to, created_at, archived_at), pipeline_stages!inner(name)",
    )
    .eq("workspace_id", contexto.workspaceId)
    .is("contacts.archived_at", null)
    .limit(MAX_FILAS);

  if (texto) {
    // `or` con comas adentro del patrón rompe el filtro de PostgREST, así que
    // se limpia antes de armarlo.
    const patron = `%${texto.replace(/[,()]/g, " ")}%`;
    query = query.or(
      `name.ilike.${patron},phone.ilike.${patron},email.ilike.${patron}`,
      { referencedTable: "contacts" },
    );
  }
  if (etapa) query = query.ilike("pipeline_stages.name", `%${etapa}%`);
  if (args.sin_asignar === true) query = query.is("contacts.assigned_to", null);
  if (desdeKey) {
    query = query.gte(
      "contacts.created_at",
      startOfDayInZone(desdeKey, contexto.timezone).toISOString(),
    );
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  const filas = (data ?? []).map((fila) => {
    const contacto = relacion(fila.contacts);
    const stage = relacion(fila.pipeline_stages);
    return {
      contacto_id: contacto?.id ?? null,
      nombre: contacto?.name ?? "Sin nombre",
      telefono: contacto?.phone ?? null,
      email: contacto?.email ?? null,
      etapa: stage?.name ?? null,
      valor: Number(fila.value ?? 0),
      tiene_responsable: Boolean(contacto?.assigned_to),
      alta: contacto?.created_at ?? null,
    };
  });

  return {
    encontrados: filas.length,
    leads: filas,
    nota:
      filas.length === MAX_FILAS
        ? `Se muestran los primeros ${MAX_FILAS}. Puede haber más: acotá la búsqueda si hace falta el total exacto.`
        : undefined,
  };
}

/**
 * Lo que espera atención, en un solo lugar.
 *
 * Junta dos cosas que el CRM muestra separadas —las derivaciones de la IA y los
 * chats con mensajes sin leer— porque quien pregunta "qué tengo pendiente" no
 * está pensando en esa distinción.
 */
async function chatsPendientes(contexto: Contexto) {
  const { data, error } = await contexto.supabase
    .from("conversations")
    .select("id, status, unread_count, updated_at, channel, contacts!inner(id, name, archived_at)")
    .eq("workspace_id", contexto.workspaceId)
    .is("contacts.archived_at", null)
    .or("status.eq.pending,unread_count.gt.0")
    .order("updated_at", { ascending: false })
    .limit(MAX_FILAS);

  if (error) return { error: error.message };

  const filas = data ?? [];
  const ultimos = await ultimosMensajes(
    contexto,
    filas.map((fila) => fila.id),
  );

  return {
    pendientes: filas.map((fila) => {
      const contacto = relacion(fila.contacts);
      return {
        contacto_id: contacto?.id ?? null,
        nombre: contacto?.name ?? "Sin nombre",
        canal: fila.channel,
        derivado_a_una_persona: fila.status === "pending",
        mensajes_sin_leer: fila.unread_count ?? 0,
        esperando_desde: fila.updated_at,
        ultimo_mensaje: ultimos.get(fila.id) ?? null,
      };
    }),
    total: filas.length,
    nota: "'derivado_a_una_persona' significa que la IA pidió que siga alguien del equipo.",
  };
}

async function agenda(contexto: Contexto, args: Record<string, unknown>) {
  const hoy = dayKeyInZone(new Date(), contexto.timezone);
  const desdeKey = diaValido(args.desde) ?? hoy;
  const hastaKey = diaValido(args.hasta);

  let query = contexto.supabase
    .from("appointments")
    .select("id, title, start_time, end_time, status, contacts!inner(name, archived_at)")
    .eq("workspace_id", contexto.workspaceId)
    .is("contacts.archived_at", null)
    .gte("start_time", startOfDayInZone(desdeKey, contexto.timezone).toISOString())
    .order("start_time", { ascending: true })
    .limit(MAX_FILAS);

  if (hastaKey) {
    query = query.lt(
      "start_time",
      startOfDayInZone(shiftDayKey(hastaKey, 1), contexto.timezone).toISOString(),
    );
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    turnos: (data ?? []).map((fila) => ({
      titulo: fila.title,
      contacto: relacion(fila.contacts)?.name ?? "Sin contacto",
      desde: fila.start_time,
      hasta: fila.end_time,
      estado: fila.status,
    })),
    total: (data ?? []).length,
  };
}

/**
 * Los leads que se movieron, con lo que dijeron.
 *
 * Es la única herramienta que le da texto al modelo para que **opine**: quién
 * tiene interés real no es una cuenta, es una lectura de lo que la persona
 * escribió. "¿Tenés envío a Córdoba?" y "¿cuánto sale?" no pesan lo mismo, y
 * ningún contador los distingue.
 *
 * Por eso vuelven las dos cosas. Las señales de conducta —cuántas veces
 * escribió, si tiene turno, si le contestamos— las calcula esta función, para
 * que el modelo no las cuente mal. El texto va crudo, recortado, para que las
 * interprete. Lo que no se le pide es que invente un puntaje: la herramienta no
 * devuelve ninguno y las instrucciones le piden que cite lo que la persona dijo.
 */
async function leadsActivos(contexto: Contexto, args: Record<string, unknown>) {
  const dias = acotarNumero(args.dias, 14, 1, 90);
  const limite = acotarNumero(args.limite, 12, 1, MAX_LEADS_ACTIVOS);
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

  const { data: chats, error } = await contexto.supabase
    .from("conversations")
    .select("id, channel, updated_at, contacts!inner(id, name, phone, archived_at)")
    .eq("workspace_id", contexto.workspaceId)
    .is("contacts.archived_at", null)
    .gte("updated_at", desde)
    .order("updated_at", { ascending: false })
    .limit(limite);

  if (error) return { error: error.message };
  if (!chats?.length) {
    return { leads: [], nota: `Ningún lead escribió en los últimos ${dias} días.` };
  }

  const conversationIds = chats.map((fila) => fila.id);
  const contactIds = chats
    .map((fila) => relacion(fila.contacts)?.id)
    .filter((id): id is string => Boolean(id));

  const [mensajes, oportunidades, turnos] = await Promise.all([
    contexto.supabase
      .from("messages")
      .select("conversation_id, sender_type, content, created_at")
      .in("conversation_id", conversationIds)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(limite * 40),
    contexto.supabase
      .from("opportunities")
      .select("contact_id, value, pipeline_stages!inner(name)")
      .eq("workspace_id", contexto.workspaceId)
      .in("contact_id", contactIds),
    contexto.supabase
      .from("appointments")
      .select("contact_id, start_time")
      .eq("workspace_id", contexto.workspaceId)
      .in("contact_id", contactIds)
      .gte("start_time", new Date().toISOString()),
  ]);

  const porChat = new Map<string, { texto: string; quien: string; cuando: string }[]>();
  const entrantes = new Map<string, number>();
  const salientes = new Map<string, number>();

  // Vienen del más nuevo al más viejo, así que el corte por chat se queda con
  // los últimos, que es lo que interesa.
  for (const fila of mensajes.data ?? []) {
    const id = fila.conversation_id;
    if (fila.sender_type === "contact") entrantes.set(id, (entrantes.get(id) ?? 0) + 1);
    else salientes.set(id, (salientes.get(id) ?? 0) + 1);

    const lista = porChat.get(id) ?? [];
    if (lista.length < MENSAJES_POR_LEAD && typeof fila.content === "string" && fila.content.trim()) {
      lista.push({
        quien: quienEscribe(fila.sender_type),
        texto: fila.content.slice(0, LARGO_MENSAJE),
        cuando: fila.created_at,
      });
      porChat.set(id, lista);
    }
  }

  const oportunidadPorContacto = new Map<string, { etapa: string | null; valor: number }>();
  for (const fila of oportunidades.data ?? []) {
    oportunidadPorContacto.set(fila.contact_id, {
      etapa: relacion(fila.pipeline_stages)?.name ?? null,
      valor: Number(fila.value ?? 0),
    });
  }

  const turnoPorContacto = new Set((turnos.data ?? []).map((fila) => fila.contact_id));

  return {
    ventana_dias: dias,
    leads: chats.map((chat) => {
      const contacto = relacion(chat.contacts);
      const oportunidad = contacto ? oportunidadPorContacto.get(contacto.id) : undefined;
      return {
        contacto_id: contacto?.id ?? null,
        nombre: contacto?.name ?? "Sin nombre",
        telefono: contacto?.phone ?? null,
        canal: chat.channel,
        etapa: oportunidad?.etapa ?? null,
        valor: oportunidad?.valor ?? 0,
        mensajes_del_contacto: entrantes.get(chat.id) ?? 0,
        mensajes_nuestros: salientes.get(chat.id) ?? 0,
        tiene_turno_agendado: contacto ? turnoPorContacto.has(contacto.id) : false,
        ultima_actividad: chat.updated_at,
        // Del más viejo al más nuevo: es como se lee una conversación.
        ultimos_mensajes: (porChat.get(chat.id) ?? []).reverse(),
      };
    }),
    nota:
      "Para juzgar interés, leé lo que la persona escribió. Los contadores son contexto, no un puntaje: alguien que escribió una sola vez pidiendo precio y forma de pago tiene más interés que alguien que mandó seis mensajes de cortesía.",
  };
}

/** Quién mandó el mensaje, en palabras que el modelo no tenga que traducir. */
function quienEscribe(senderType: string): string {
  if (senderType === "contact") return "el contacto";
  return senderType === "ai" ? "la IA" : "el equipo";
}

/** Un número del modelo, acotado. Manda cualquier cosa y el tope evita el resto. */
function acotarNumero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(valor)));
}

/** Los últimos mensajes de un contacto, para saber de qué se habló. */
async function historialDeContacto(contexto: Contexto, args: Record<string, unknown>) {
  const contactoId = typeof args.contacto_id === "string" ? args.contacto_id : "";
  if (!contactoId) return { error: "Falta el id del contacto." };

  const { data: conversaciones, error } = await contexto.supabase
    .from("conversations")
    .select("id, channel")
    .eq("workspace_id", contexto.workspaceId)
    .eq("contact_id", contactoId);

  if (error) return { error: error.message };
  if (!conversaciones?.length) return { mensajes: [], nota: "Ese contacto no tiene chats." };

  const { data: mensajes, error: errorMensajes } = await contexto.supabase
    .from("messages")
    .select("content, sender_type, created_at")
    .in(
      "conversation_id",
      conversaciones.map((fila) => fila.id),
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (errorMensajes) return { error: errorMensajes.message };

  return {
    canales: conversaciones.map((fila) => fila.channel),
    // Del más viejo al más nuevo: es como se lee una conversación.
    mensajes: (mensajes ?? []).reverse().map((fila) => ({
      quien:
        fila.sender_type === "contact"
          ? "el contacto"
          : fila.sender_type === "ai"
            ? "la IA"
            : "el equipo",
      texto: fila.content,
      cuando: fila.created_at,
    })),
  };
}

/** El último mensaje del contacto en cada chat, en una sola consulta. */
async function ultimosMensajes(
  contexto: Contexto,
  conversationIds: string[],
): Promise<Map<string, string>> {
  const ultimos = new Map<string, string>();
  if (conversationIds.length === 0) return ultimos;

  const { data } = await contexto.supabase
    .from("messages")
    .select("conversation_id, content")
    .in("conversation_id", conversationIds)
    .eq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .limit(200);

  // Vienen del más nuevo al más viejo: el primero de cada chat es el último.
  for (const fila of data ?? []) {
    if (!ultimos.has(fila.conversation_id) && typeof fila.content === "string") {
      ultimos.set(fila.conversation_id, fila.content.slice(0, 200));
    }
  }
  return ultimos;
}

/**
 * Las instrucciones del asistente.
 *
 * La fecha de hoy va adentro porque el modelo no la sabe, y sin ella "esta
 * semana" se resuelve contra el día en que se entrenó. La zona horaria es la
 * del workspace, igual que en el resto del CRM: el servidor corre en UTC y no
 * puede opinar sobre cuándo empieza el día de este equipo.
 */
export function instruccionesDelAsistente(input: {
  workspaceName: string;
  timezone: string;
  rol: string;
}): string {
  const zona = safeTimeZone(input.timezone);
  const hoy = dayKeyInZone(new Date(), zona);

  return [
    `Sos el asistente interno del CRM de ${input.workspaceName}. Te consulta alguien del equipo, no un cliente.`,
    "",
    `Hoy es ${longDateInZone(new Date(), zona)} (${hoy}). Esa es la fecha contra la que se resuelven "hoy", "esta semana" y "este mes". Zona horaria: ${zona}.`,
    `Quien pregunta tiene el rol de ${input.rol}.`,
    "",
    "Cómo trabajás:",
    "- Consultá las herramientas antes de afirmar cualquier dato. No respondas de memoria ni estimes.",
    "- Los números salen de las herramientas tal como vienen. No los recalcules ni los sumes vos: si necesitás un total que ninguna herramienta devuelve, decí que no lo tenés en vez de sacar la cuenta.",
    "- Si una herramienta devuelve menos filas de las que hay, avisalo en lugar de dar el recorte como total.",
    "- Si no hay una herramienta para lo que te preguntan, decilo derecho. No inventes.",
    "",
    "Cuando te pidan un juicio —quién tiene interés real, a quién llamar primero, quién se está enfriando— ahí sí opinás, y es lo único que opinás:",
    "- Leé lo que la persona escribió con `leads_activos`. Un pedido de precio, una pregunta por formas de pago o una fecha propuesta valen más que seis mensajes de cortesía.",
    "- Fundamentá cada lead citando lo que dijo, en sus palabras. Sin la cita es una corazonada y no sirve.",
    "- No inventes puntajes ni porcentajes de probabilidad: ningún dato los respalda. Ordená y explicá por qué.",
    "- Decí que es tu lectura de la conversación, no un dato del CRM.",
    "",
    "Cómo escribís:",
    "- Español rioplatense, directo y breve. Sin saludos de más ni cierres protocolares.",
    "- Los montos en dólares, con separador de miles.",
    "- Listas cuando son varios ítems; un párrafo corto cuando es una sola cosa.",
    "- Si el resultado viene vacío, decilo en una línea y ofrecé la consulta más cercana que sí tenga datos.",
    "",
    "Lo que ves está acotado por los permisos de quien pregunta: si una consulta vuelve vacía puede ser que no haya nada o que esa persona no tenga acceso. Ante la duda, mencionalo.",
  ].join("\n");
}

/**
 * PostgREST devuelve el embebido como objeto o como array de uno según la
 * relación, y los tipos generados no siempre lo distinguen.
 */
function relacion<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const ZONA_POR_DEFECTO = DEFAULT_TIMEZONE;
