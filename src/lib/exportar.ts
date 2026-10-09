import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { aCsv, nombreDeArchivo, type Columna } from "@/lib/csv";
import type { TablaExportable } from "@/lib/exportables";
import { dayKeyInZone } from "@/lib/fechas";

/**
 * La base del workspace, en planillas.
 *
 * Es una exportación de trabajo y no un respaldo del motor: sale lo que el CRM
 * muestra —con los nombres de las columnas en castellano, las fechas en la zona
 * del workspace y los ids resueltos a nombres— porque quien la descarga la va a
 * abrir en Excel, no a restaurarla en un Postgres.
 *
 * Cada tabla es una consulta y un mapeo de columnas. Nada de esto arma texto:
 * el CSV lo escribe `@/lib/csv`, que es donde viven las reglas del formato.
 */

type Supabase = SupabaseClient;

/**
 * Tope de filas por archivo.
 *
 * Todo esto viaja por una acción de servidor y se arma en memoria: sin un techo,
 * un workspace con años de chats devuelve una respuesta que el navegador no
 * puede recibir, y el síntoma sería una descarga que nunca empieza. Cuando se
 * recorta, el archivo lo dice en la respuesta.
 */
const MAX_FILAS = 20000;

export type Exportacion = { nombre: string; csv: string; filas: number; recortado: boolean };

export async function exportar(
  supabase: Supabase,
  input: {
    tabla: TablaExportable;
    workspaceId: string;
    timezone: string;
    /** Mails de los miembros, para resolver el responsable. */
    emails: Map<string, string>;
  },
): Promise<Exportacion> {
  const dia = dayKeyInZone(new Date(), input.timezone);
  const momento = (valor: string | null | undefined) => enZona(valor, input.timezone);
  const responsable = (userId: string | null | undefined) =>
    userId ? (input.emails.get(userId) ?? "Usuario sin mail") : "Sin asignar";

  switch (input.tabla) {
    case "contactos": {
      const [{ data: contactos }, { data: oportunidades }, { data: charlas }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, tags, assigned_to, bot_enabled, created_at, archived_at")
          .eq("workspace_id", input.workspaceId)
          .order("created_at", { ascending: false })
          .limit(MAX_FILAS),
        supabase
          .from("opportunities")
          .select("contact_id, value, pipeline_stages(name)")
          .eq("workspace_id", input.workspaceId),
        supabase
          .from("conversations")
          .select("contact_id, channel")
          .eq("workspace_id", input.workspaceId),
      ]);

      const etapaPorContacto = new Map<string, string>();
      const valorPorContacto = new Map<string, number>();
      for (const fila of oportunidades ?? []) {
        const id = fila.contact_id as string;
        if (!etapaPorContacto.has(id)) {
          etapaPorContacto.set(id, nombreRelacionado(fila.pipeline_stages));
          valorPorContacto.set(id, Number(fila.value ?? 0));
        }
      }

      const canalesPorContacto = new Map<string, string[]>();
      for (const fila of charlas ?? []) {
        const id = fila.contact_id as string;
        const lista = canalesPorContacto.get(id) ?? [];
        if (!lista.includes(fila.channel as string)) lista.push(fila.channel as string);
        canalesPorContacto.set(id, lista);
      }

      type Fila = Record<string, unknown>;
      const columnas: Columna<Fila>[] = [
        { titulo: "Nombre", valor: (f) => texto(f.name) },
        { titulo: "Teléfono", valor: (f) => texto(f.phone) },
        { titulo: "Email", valor: (f) => texto(f.email) },
        { titulo: "Etiquetas", valor: (f) => (Array.isArray(f.tags) ? f.tags.join(", ") : "") },
        { titulo: "Responsable", valor: (f) => responsable(f.assigned_to as string | null) },
        { titulo: "Etapa", valor: (f) => etapaPorContacto.get(f.id as string) ?? "Fuera del embudo" },
        { titulo: "Valor", valor: (f) => valorPorContacto.get(f.id as string) ?? 0 },
        {
          titulo: "Canales",
          valor: (f) => (canalesPorContacto.get(f.id as string) ?? []).join(", "),
        },
        { titulo: "IA", valor: (f) => (f.bot_enabled === false ? "Frenada" : "Activa") },
        { titulo: "Alta", valor: (f) => momento(f.created_at as string) },
        { titulo: "Archivado", valor: (f) => (f.archived_at ? momento(f.archived_at as string) : "") },
      ];

      return armar("contactos", dia, columnas, (contactos ?? []) as Fila[]);
    }

    case "oportunidades": {
      const { data } = await supabase
        .from("opportunities")
        .select(
          "value, created_at, updated_at, pipeline_stages(name), contacts!inner(name, phone, assigned_to)",
        )
        .eq("workspace_id", input.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(MAX_FILAS);

      type Fila = Record<string, unknown>;
      const columnas: Columna<Fila>[] = [
        { titulo: "Contacto", valor: (f) => nombreRelacionado(f.contacts) },
        { titulo: "Teléfono", valor: (f) => texto(registro(f.contacts).phone) },
        { titulo: "Etapa", valor: (f) => nombreRelacionado(f.pipeline_stages) },
        { titulo: "Valor", valor: (f) => Number(f.value ?? 0) },
        {
          titulo: "Responsable",
          valor: (f) => responsable(registro(f.contacts).assigned_to as string | null),
        },
        { titulo: "Creada", valor: (f) => momento(f.created_at as string) },
        { titulo: "Último movimiento", valor: (f) => momento(f.updated_at as string) },
      ];

      return armar("oportunidades", dia, columnas, (data ?? []) as Fila[]);
    }

    case "conversaciones": {
      const { data } = await supabase
        .from("conversations")
        .select("channel, provider, status, unread_count, updated_at, contacts!inner(name, phone)")
        .eq("workspace_id", input.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(MAX_FILAS);

      type Fila = Record<string, unknown>;
      const columnas: Columna<Fila>[] = [
        { titulo: "Contacto", valor: (f) => nombreRelacionado(f.contacts) },
        { titulo: "Teléfono", valor: (f) => texto(registro(f.contacts).phone) },
        { titulo: "Canal", valor: (f) => texto(f.channel) },
        { titulo: "Proveedor", valor: (f) => texto(f.provider) },
        { titulo: "Estado", valor: (f) => ESTADOS_CHARLA[texto(f.status)] ?? texto(f.status) },
        { titulo: "Sin leer", valor: (f) => Number(f.unread_count ?? 0) },
        { titulo: "Último movimiento", valor: (f) => momento(f.updated_at as string) },
      ];

      return armar("conversaciones", dia, columnas, (data ?? []) as Fila[]);
    }

    case "mensajes": {
      const { data } = await supabase
        .from("messages")
        .select(
          "created_at, sender_type, content, media_url, conversations!inner(channel, workspace_id, contacts!inner(name))",
        )
        .eq("conversations.workspace_id", input.workspaceId)
        .order("created_at", { ascending: false })
        .limit(MAX_FILAS);

      type Fila = Record<string, unknown>;
      const columnas: Columna<Fila>[] = [
        { titulo: "Fecha", valor: (f) => momento(f.created_at as string) },
        {
          titulo: "Contacto",
          valor: (f) => nombreRelacionado(registro(f.conversations).contacts),
        },
        { titulo: "Canal", valor: (f) => texto(registro(f.conversations).channel) },
        { titulo: "Quién", valor: (f) => QUIEN[texto(f.sender_type)] ?? texto(f.sender_type) },
        { titulo: "Mensaje", valor: (f) => texto(f.content) },
        { titulo: "Adjunto", valor: (f) => texto(f.media_url) },
      ];

      return armar("mensajes", dia, columnas, (data ?? []) as Fila[]);
    }

    case "turnos": {
      const { data } = await supabase
        .from("appointments")
        .select("title, start_time, end_time, status, contacts!inner(name, phone)")
        .eq("workspace_id", input.workspaceId)
        .order("start_time", { ascending: false })
        .limit(MAX_FILAS);

      type Fila = Record<string, unknown>;
      const columnas: Columna<Fila>[] = [
        { titulo: "Título", valor: (f) => texto(f.title) },
        { titulo: "Contacto", valor: (f) => nombreRelacionado(f.contacts) },
        { titulo: "Teléfono", valor: (f) => texto(registro(f.contacts).phone) },
        { titulo: "Desde", valor: (f) => momento(f.start_time as string) },
        { titulo: "Hasta", valor: (f) => momento(f.end_time as string) },
        { titulo: "Estado", valor: (f) => ESTADOS_TURNO[texto(f.status)] ?? texto(f.status) },
      ];

      return armar("turnos", dia, columnas, (data ?? []) as Fila[]);
    }
  }
}

const ESTADOS_CHARLA: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
  pending: "Derivada a una persona",
};

const ESTADOS_TURNO: Record<string, string> = {
  scheduled: "Agendado",
  completed: "Cumplido",
  cancelled: "Cancelado",
};

const QUIEN: Record<string, string> = {
  contact: "Cliente",
  user: "Nosotros",
  ai: "IA",
};

function armar<T>(
  base: string,
  dia: string,
  columnas: Columna<T>[],
  filas: T[],
): Exportacion {
  return {
    nombre: nombreDeArchivo(base, dia),
    csv: aCsv(columnas, filas),
    filas: filas.length,
    recortado: filas.length >= MAX_FILAS,
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : typeof valor === "number" ? String(valor) : "";
}

/** PostgREST devuelve la relación como objeto o como arreglo de uno. */
function registro(related: unknown): Record<string, unknown> {
  const fila = Array.isArray(related) ? related[0] : related;
  return (fila ?? {}) as Record<string, unknown>;
}

function nombreRelacionado(related: unknown): string {
  const nombre = registro(related).name;
  return typeof nombre === "string" && nombre.length > 0 ? nombre : "Sin nombre";
}

/**
 * Una fecha legible en la zona del workspace.
 *
 * En ISO —`2026-03-10T21:00:00Z`— Excel no la reconoce como fecha y además está
 * en UTC: un turno de las 18:00 de Buenos Aires se lee como si fuera a las 21.
 */
function enZona(valor: string | null | undefined, timeZone: string): string {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "";

  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);

  const buscar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${buscar("day")}/${buscar("month")}/${buscar("year")} ${buscar("hour")}:${buscar("minute")}`;
}
