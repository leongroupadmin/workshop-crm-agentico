"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_REPLY_DELAY_SECONDS, errorDeDemora, errorDePrompt } from "@/lib/agent-limits";
import { MAX_CAPTION, revisarAdjunto } from "@/lib/adjuntos";
import { webmOpusAOgg } from "@/lib/audio/webm-a-ogg";
import { DURACION_POR_OMISION_MINUTOS, leerEnlace } from "@/lib/calendar-citas";
import { etapaDeEntrada } from "@/lib/embudos";
import { separarMarcas } from "@/lib/marcas-del-agente";
import { INSTRUCCIONES_DE_ADJUNTOS, MEDIA_SALIENTE } from "@/lib/media-notes";
import {
  errorDeLasReglas,
  reglasAplicables,
  type Clasificacion,
  type ReglaConNombre,
  type ReglaDeMovimiento,
} from "@/lib/movimientos-del-agente";
import { clasificar, leerReglas } from "@/lib/movimientos-del-agente-server";
import { fichaDelLead, HISTORY_LIMIT } from "@/lib/ai-reply";
import {
  completeChatServer,
  completeWithToolsServer,
  describeImage,
  listChatModelsServer,
  transcribeAudio,
  type ChatTurn,
} from "@/lib/openai-server";
import {
  HERRAMIENTAS,
  ejecutarHerramienta,
  instruccionesDelAsistente,
} from "@/lib/asistente";
import {
  ROLE_LABELS,
  can,
  type MemberRole,
  type Permission,
  type PermissionMap,
} from "@/lib/permissions";
import {
  abrirConversacion,
  chatIdDelContacto,
  salidaParaEscribirPrimero,
} from "@/lib/conversacion-whatsapp";
import { normalizarTelefono } from "@/lib/telefono";
import { exportar } from "@/lib/exportar";
import { MAX_IMPORTADAS, type FilaImportada } from "@/lib/importar";
import { TABLAS, type TablaExportable } from "@/lib/exportables";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  MAX_VOICE_BYTES,
  uploadChatMedia,
  uploadVoiceNote,
} from "@/lib/supabase/storage";
import { errorDeContrasena } from "@/lib/password";
import { getWorkspaceContext } from "@/lib/workspace";
import { listYcloudTemplates } from "@/lib/ycloud-api";
import {
  enviarAudio,
  enviarMedia,
  enviarPlantilla,
  enviarTexto,
  proveedorDe,
} from "@/lib/mensajeria";
import {
  componentesParaEnviar,
  primerHuecoVacio,
  vistaPrevia,
  type Plantilla,
  type Valores,
} from "@/lib/plantillas";
import { isValidTimeZone, safeTimeZone, shiftDayKey, startOfDayInZone } from "@/lib/fechas";
import {
  avisoDeLaFila,
  errorDeAviso,
  errorDeHorario,
  franjasDelHorario,
  horarioDeLaFila,
  type HorarioDelAgente,
} from "@/lib/horario-del-agente";
import { filtroDeBusqueda, MAX_RECIENTES, MAX_RESULTADOS } from "@/lib/buscar-contactos";
import {
  CAMPOS_DE_TAREA,
  errorDeTarea,
  esEstadoDeTarea,
  filaATarea,
  validarTarea,
  type EstadoDeTarea,
  type TareaRow,
} from "@/lib/tareas";
import { avisarTareaAsignada } from "@/lib/tareas-server";
import { importFromZernio, type ImportSummary } from "@/lib/zernio-import";
import type {
  AppointmentStatus,
  Channel,
  SenderType,
  StageKind,
} from "@/types/database";

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const STAGE_KINDS: StageKind[] = ["open", "won", "lost"];
const MAX_STAGE_NAME = 40;
const MAX_PIPELINE_NAME = 40;

const APPOINTMENT_STATUSES: AppointmentStatus[] = ["scheduled", "completed", "cancelled"];

type WorkspaceScope =
  | { ok: false; error: string }
  | {
      ok: true;
      workspaceId: string;
      /** Nombre del equipo. Lo usa el asistente para presentarse. */
      workspaceName: string;
      supabase: SupabaseClient;
      userId: string;
      role: MemberRole;
      permissions: PermissionMap;
      isAdmin: boolean;
      /** Zona del workspace: con ella se decide dónde empieza y termina un día. */
      timezone: string;
    };

/**
 * Resuelve el workspace del usuario autenticado junto con un cliente con RLS.
 * Toda escritura pasa por acá: el cliente nunca elige el `workspace_id`.
 */
async function requireWorkspace(): Promise<WorkspaceScope> {
  const context = await getWorkspaceContext();
  if (context.status === "signed-out") {
    return { ok: false, error: "Tu sesión venció. Ingresá nuevamente." };
  }
  if (context.status === "needs-workspace") {
    return { ok: false, error: "Primero creá tu workspace." };
  }
  if (context.status === "no-access") {
    return {
      ok: false,
      error: "Tu mail no tiene acceso al CRM. Pedile a un administrador que te dé de alta.",
    };
  }
  if (context.status === "configuration-missing") {
    return { ok: false, error: "Falta configurar la conexión con Supabase." };
  }

  return {
    ok: true,
    workspaceId: context.workspaceId,
    workspaceName: context.workspaceName,
    supabase: await getSupabaseServer(),
    userId: context.userId,
    role: context.role,
    permissions: context.permissions,
    isAdmin: context.isAdmin,
    timezone: context.timezone,
  };
}

/**
 * Lo mismo, pero exigiendo un permiso.
 *
 * RLS ya rechaza la operación sin esto. Se hace igual para que el usuario lea
 * "no tenés permiso" en vez del error crudo de Postgres, que no le dice nada.
 */
async function requirePermission(permission: Permission): Promise<WorkspaceScope> {
  const scope = await requireWorkspace();
  if (!scope.ok) return scope;
  if (!can(scope.role, scope.permissions, permission)) {
    return { ok: false, error: "No tenés permiso para hacer eso. Pedíselo a un administrador." };
  }
  return scope;
}

/** Igual que la anterior, pero sólo para administradores. */
async function requireAdmin(
  accion = "gestionar los usuarios",
): Promise<WorkspaceScope> {
  const scope = await requireWorkspace();
  if (!scope.ok) return scope;
  if (!scope.isAdmin) {
    return { ok: false, error: `Sólo un administrador puede ${accion}.` };
  }
  return scope;
}

/**
 * El embudo de entrada: el primero de la lista.
 *
 * Se elige por posición y no por una columna `es_principal` para no tener que
 * sostener a mano la regla de que haya exactamente uno. `created_at` desempata,
 * porque la posición no es única y sin un segundo criterio el primero podría
 * cambiar entre dos consultas.
 */
async function primerEmbudoId(scope: {
  workspaceId: string;
  supabase: SupabaseClient;
}): Promise<string | null> {
  const { data } = await scope.supabase
    .from("pipelines")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Primera columna de un embudo. Es donde entra todo lead nuevo.
 *
 * Sin embudo pedido usa el de entrada, que es el caso de todo lo que crea leads
 * sin preguntar: el webhook, la importación y el alta a mano.
 */
async function firstStageId(
  scope: { workspaceId: string; supabase: SupabaseClient },
  pipelineId?: string,
) {
  // La misma que usan el webhook y la importación: si la regla de "dónde cae un
  // lead nuevo" viviera en dos lados, un lead cargado a mano y uno que entra por
  // chat podrían terminar en embudos distintos.
  return etapaDeEntrada(scope.supabase, scope.workspaceId, pipelineId);
}

/** El embudo al que pertenece una etapa, o null si la etapa no es del workspace. */
async function embudoDeLaEtapa(
  scope: { workspaceId: string; supabase: SupabaseClient },
  stageId: string,
): Promise<string | null> {
  if (!stageId) return null;
  const { data } = await scope.supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("id", stageId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  return (data?.pipeline_id as string | undefined) ?? null;
}

/**
 * Mismo control que `stageBelongsToWorkspace` pero para embudos: RLS impide
 * escribir en otro workspace y no impide apuntar a un embudo ajeno.
 */
async function pipelineBelongsToWorkspace(
  scope: { workspaceId: string; supabase: SupabaseClient },
  pipelineId: string,
): Promise<boolean> {
  if (!pipelineId) return false;
  const { data } = await scope.supabase
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * RLS ya impide escribir en otro workspace, pero no impide *apuntar* a una
 * etapa ajena: sin esta comprobación un id copiado movería una oportunidad a
 * una columna que el usuario no puede ver.
 */
async function stageBelongsToWorkspace(
  scope: { workspaceId: string; supabase: SupabaseClient },
  stageId: string,
): Promise<boolean> {
  if (!stageId) return false;
  const { data } = await scope.supabase
    .from("pipeline_stages")
    .select("id")
    .eq("id", stageId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  return Boolean(data);
}

/** Agrega una columna al final del embudo. */
/**
 * Guarda la zona horaria del workspace.
 *
 * Es lo que decide dónde corta el día en el resumen. Sin esto el corte lo
 * ponía el reloj del servidor —UTC en Vercel—, así que a la tarde el gráfico
 * ya abría la barra del día siguiente y contaba ahí los mensajes de hoy.
 *
 * Sólo un administrador: cambiarla mueve las métricas de todo el equipo.
 */
export async function updateWorkspaceTimezone(input: { timezone: string }): Promise<ActionResult> {
  const timezone = input.timezone?.trim() ?? "";
  if (!timezone) return { ok: false, error: "Elegí una zona horaria." };
  // Una zona inválida rompería `Intl` en cada render del resumen, así que no
  // llega a guardarse.
  if (!isValidTimeZone(timezone)) {
    return { ok: false, error: `No se reconoce la zona horaria "${timezone}".` };
  }

  const scope = await requireAdmin("cambiar la zona horaria");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("workspaces")
    .update({ timezone })
    .eq("id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/* ------------------------------------------------------------------ embudos */

/**
 * Crea un embudo con las columnas mínimas para que sirva.
 *
 * Nace con entrada, ganado y perdido y no vacío: un embudo sin columnas no
 * acepta una sola tarjeta, y las de ganado y perdido son las que alimentan el
 * valor y la tasa de conversión. Se pueden renombrar todas; agregar las del
 * medio es lo que queda para el usuario.
 */
export async function createPipeline(input: { name: string }): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, error: "Poné un nombre para el embudo." };
  if (name.length > MAX_PIPELINE_NAME) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_PIPELINE_NAME} caracteres.` };
  }

  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: last } = await scope.supabase
    .from("pipelines")
    .select("position")
    .eq("workspace_id", scope.workspaceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: creado, error } = await scope.supabase
    .from("pipelines")
    .insert({
      workspace_id: scope.workspaceId,
      name,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .maybeSingle();

  // 23505 es el único choque posible: la base exige que el nombre no se repita
  // dentro del workspace, y dos embudos con el mismo nombre no se distinguen en
  // ningún selector.
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "Ya tenés un embudo con ese nombre." : error.message,
    };
  }
  if (!creado) return { ok: false, error: "No se pudo crear el embudo." };

  const { error: sinColumnas } = await scope.supabase.from("pipeline_stages").insert([
    { workspace_id: scope.workspaceId, pipeline_id: creado.id, name: "Nuevo lead", position: 1, kind: "open" },
    { workspace_id: scope.workspaceId, pipeline_id: creado.id, name: "Ganado", position: 2, kind: "won" },
    { workspace_id: scope.workspaceId, pipeline_id: creado.id, name: "Perdido", position: 3, kind: "lost" },
  ]);

  // Un embudo sin columnas no sirve para nada y no se puede arreglar desde la
  // pantalla, así que se deshace en vez de dejarlo a medio crear.
  if (sinColumnas) {
    await scope.supabase.from("pipelines").delete().eq("id", creado.id);
    return { ok: false, error: sinColumnas.message };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function renamePipeline(input: { id: string; name: string }): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, error: "El nombre no puede quedar vacío." };
  if (name.length > MAX_PIPELINE_NAME) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_PIPELINE_NAME} caracteres.` };
  }

  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("pipelines")
    .update({ name })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "Ya tenés un embudo con ese nombre." : error.message,
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Borra un embudo entero, con sus columnas.
 *
 * Los leads que estaban adentro no se borran nunca: o pasan al embudo de
 * `moveToId`, o la acción falla. Entran por la columna de entrada del destino,
 * que es lo único que se puede afirmar sin inventar una equivalencia entre
 * columnas de dos procesos distintos.
 *
 * El último embudo no se borra: sin ninguno, un lead nuevo no tendría dónde
 * caer y el webhook empezaría a fallar en silencio.
 */
export async function deletePipeline(input: {
  id: string;
  moveToId?: string;
}): Promise<ActionResult> {
  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: pipelines } = await scope.supabase
    .from("pipelines")
    .select("id")
    .eq("workspace_id", scope.workspaceId);

  if ((pipelines ?? []).length <= 1) {
    return { ok: false, error: "Tiene que quedar al menos un embudo." };
  }
  if (!(pipelines ?? []).some((row) => row.id === input.id)) {
    return { ok: false, error: "Ese embudo no existe en tu workspace." };
  }

  const { count } = await scope.supabase
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .eq("pipeline_id", input.id);

  if ((count ?? 0) > 0) {
    if (!input.moveToId || input.moveToId === input.id) {
      return { ok: false, error: "Elegí a qué embudo pasan los leads que están adentro." };
    }
    if (!(pipelines ?? []).some((row) => row.id === input.moveToId)) {
      return { ok: false, error: "El embudo de destino no existe." };
    }

    const destino = await firstStageId(scope, input.moveToId);
    if (!destino) return { ok: false, error: "El embudo de destino no tiene columnas." };

    const { error: moveError } = await scope.supabase
      .from("opportunities")
      .update({ stage_id: destino })
      .eq("workspace_id", scope.workspaceId)
      .eq("pipeline_id", input.id);

    if (moveError) return { ok: false, error: moveError.message };
  }

  const { error } = await scope.supabase
    .from("pipelines")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Reordena los embudos. Recibe los ids en el orden final deseado.
 *
 * Importa más de lo que parece: el primero es donde caen los leads que entran
 * por chat, por importación o cargados a mano.
 */
export async function reorderPipelines(input: { ids: string[] }): Promise<ActionResult> {
  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: pipelines } = await scope.supabase
    .from("pipelines")
    .select("id")
    .eq("workspace_id", scope.workspaceId);

  const conocidos = new Set((pipelines ?? []).map((row) => row.id as string));
  if (input.ids.length !== conocidos.size || input.ids.some((id) => !conocidos.has(id))) {
    return { ok: false, error: "El orden recibido no coincide con tus embudos." };
  }

  // Sin transacción desde PostgREST, fila por fila. Un fallo a mitad de camino
  // deja un orden raro, nunca datos perdidos.
  for (const [index, id] of input.ids.entries()) {
    const { error } = await scope.supabase
      .from("pipelines")
      .update({ position: index + 1 })
      .eq("id", id)
      .eq("workspace_id", scope.workspaceId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function createStage(input: {
  name: string;
  kind?: StageKind;
  /** A qué embudo se le agrega. Sin esto se agrega al de entrada. */
  pipelineId?: string;
}): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  const kind = input.kind ?? "open";

  if (!name) return { ok: false, error: "Poné un nombre para la columna." };
  if (name.length > MAX_STAGE_NAME) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_STAGE_NAME} caracteres.` };
  }
  if (!STAGE_KINDS.includes(kind)) return { ok: false, error: "Tipo de columna inválido." };

  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const embudo = input.pipelineId ?? (await primerEmbudoId(scope));
  if (!embudo) return { ok: false, error: "El workspace no tiene ningún embudo." };
  if (input.pipelineId && !(await pipelineBelongsToWorkspace(scope, input.pipelineId))) {
    return { ok: false, error: "Ese embudo no existe en tu workspace." };
  }

  // La posición se cuenta dentro del embudo: dos embudos tienen los dos su
  // columna 1.
  const { data: last } = await scope.supabase
    .from("pipeline_stages")
    .select("position")
    .eq("workspace_id", scope.workspaceId)
    .eq("pipeline_id", embudo)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await scope.supabase.from("pipeline_stages").insert({
    workspace_id: scope.workspaceId,
    pipeline_id: embudo,
    name,
    kind,
    position: (last?.position ?? 0) + 1,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Cambia el nombre de una columna. El tipo (abierta/ganada/perdida) no se toca. */
export async function renameStage(input: { id: string; name: string }): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, error: "El nombre no puede quedar vacío." };
  if (name.length > MAX_STAGE_NAME) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_STAGE_NAME} caracteres.` };
  }

  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("pipeline_stages")
    .update({ name })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Borra una columna del embudo.
 *
 * Las oportunidades que estaban adentro no se borran nunca: o se reubican en
 * `moveToId`, o la acción falla. La clave foránea es `on delete restrict`
 * justamente para que un descuido acá no se lleve puesto el embudo.
 *
 * Tres columnas son estructurales y no se borran: la primera, porque es donde
 * caen los leads que entran por el webhook, por la importación o al cargar un
 * contacto a mano; y las de ganado y perdido, porque son las que alimentan el
 * valor del embudo y la tasa de conversión. Todas se pueden renombrar.
 */
export async function deleteStage(input: {
  id: string;
  moveToId?: string;
}): Promise<ActionResult> {
  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  // Las tres reglas de abajo —al menos una columna, la de entrada, ganado y
  // perdido— valen dentro de cada embudo. Miradas sobre el workspace entero,
  // un segundo embudo dejaría borrar la columna de entrada del primero.
  const embudo = await embudoDeLaEtapa(scope, input.id);
  if (!embudo) return { ok: false, error: "Esa columna no existe en tu embudo." };

  const { data: stages } = await scope.supabase
    .from("pipeline_stages")
    .select("id, position, kind")
    .eq("workspace_id", scope.workspaceId)
    .eq("pipeline_id", embudo)
    .order("position", { ascending: true });

  if ((stages ?? []).length <= 1) {
    return { ok: false, error: "El embudo tiene que quedarse con al menos una columna." };
  }

  const target = (stages ?? []).find((row) => row.id === input.id);
  if (!target) return { ok: false, error: "Esa columna no existe en tu embudo." };

  if (stages?.[0]?.id === input.id) {
    return {
      ok: false,
      error: "Esa es la columna de entrada: ahí caen los leads nuevos y no se puede borrar.",
    };
  }
  if (target.kind !== "open") {
    return {
      ok: false,
      error:
        target.kind === "won"
          ? "Ganado no se puede borrar: es la columna que alimenta el ganado del mes y la tasa de conversión."
          : "Perdido no se puede borrar: es la columna que alimenta la tasa de conversión.",
    };
  }

  const { count } = await scope.supabase
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .eq("stage_id", input.id);

  if ((count ?? 0) > 0) {
    if (!input.moveToId || input.moveToId === input.id) {
      return { ok: false, error: "Elegí a qué columna pasan los leads que están adentro." };
    }
    // El destino tiene que ser del mismo embudo: mover los leads a otro sería
    // cambiarlos de proceso sin que nadie lo haya pedido.
    if (!(stages ?? []).some((row) => row.id === input.moveToId)) {
      return { ok: false, error: "La columna de destino tiene que ser del mismo embudo." };
    }

    const { error: moveError } = await scope.supabase
      .from("opportunities")
      .update({ stage_id: input.moveToId })
      .eq("workspace_id", scope.workspaceId)
      .eq("stage_id", input.id);

    if (moveError) return { ok: false, error: moveError.message };
  }

  const { error } = await scope.supabase
    .from("pipeline_stages")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Saca oportunidades del embudo.
 *
 * Borra la tarjeta, no a la persona: el contacto, sus chats y su historial
 * quedan intactos. Para borrar al contacto entero está `deleteContacts`.
 */
export async function deleteOpportunities(input: { ids: string[] }): Promise<ActionResult> {
  if (input.ids.length === 0) return { ok: false, error: "No seleccionaste ninguna tarjeta." };

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("opportunities")
    .delete()
    .in("id", input.ids)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Reordena el embudo. Recibe los ids en el orden final deseado.
 *
 * La primera columna se queda donde está: es la de entrada, y moverla
 * cambiaría en silencio dónde aparecen los leads nuevos.
 */
export async function reorderStages(input: {
  ids: string[];
  /** El embudo que se reordena. Sin esto, el de entrada. */
  pipelineId?: string;
}): Promise<ActionResult> {
  const scope = await requirePermission("editar_embudo");
  if (!scope.ok) return { ok: false, error: scope.error };

  const embudo = input.pipelineId ?? (await primerEmbudoId(scope));
  if (!embudo) return { ok: false, error: "El workspace no tiene ningún embudo." };

  const { data: stages } = await scope.supabase
    .from("pipeline_stages")
    .select("id, position")
    .eq("workspace_id", scope.workspaceId)
    .eq("pipeline_id", embudo)
    .order("position", { ascending: true });

  const known = new Set((stages ?? []).map((row) => row.id as string));
  if (input.ids.length !== known.size || input.ids.some((id) => !known.has(id))) {
    return { ok: false, error: "El orden recibido no coincide con tu embudo." };
  }
  if (stages?.[0] && input.ids[0] !== stages[0].id) {
    return { ok: false, error: "La columna de entrada tiene que quedar primera." };
  }

  // Sin transacción disponible desde PostgREST, se actualiza fila por fila.
  // Un fallo a mitad de camino deja un orden raro, nunca datos perdidos.
  for (const [index, id] of input.ids.entries()) {
    const { error } = await scope.supabase
      .from("pipeline_stages")
      .update({ position: index + 1 })
      .eq("id", id)
      .eq("workspace_id", scope.workspaceId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Crea un contacto y, en el mismo paso, su oportunidad en el embudo: cargar
 * a alguien equivale a darlo de alta como lead. El `workspace_id` se resuelve
 * en el servidor; el cliente nunca lo elige.
 */
export async function createContact(input: {
  name: string;
  email?: string;
  phone?: string;
  stageId?: string;
  value?: number;
  notes?: string;
}): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const value = Number(input.value ?? 0);

  if (!name) return { ok: false, error: "El nombre es obligatorio." };
  if (name.length > 120) return { ok: false, error: "El nombre es demasiado largo." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "El email no tiene un formato válido." };
  }
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: "El valor debe ser un número mayor o igual a cero." };
  }

  const scope = await requirePermission("crear_contactos");
  if (!scope.ok) return { ok: false, error: scope.error };

  const stageId = input.stageId ?? (await firstStageId(scope));
  if (!stageId) return { ok: false, error: "El embudo no tiene columnas." };

  const { data: contact, error } = await scope.supabase
    .from("contacts")
    .insert({
      workspace_id: scope.workspaceId,
      name,
      email: email || null,
      phone: phone || null,
    })
    .select("id")
    .single();

  if (error || !contact) {
    return { ok: false, error: error?.message ?? "No se pudo crear el contacto." };
  }

  const { error: opportunityError } = await scope.supabase.from("opportunities").insert({
    workspace_id: scope.workspaceId,
    contact_id: contact.id,
    stage_id: stageId,
    value,
    notes: input.notes?.trim() || null,
  });

  revalidatePath("/");

  // El contacto ya existe: no lo revertimos por un fallo en el embudo, pero
  // avisamos para que se pueda cargar la oportunidad a mano.
  if (opportunityError) {
    return {
      ok: true,
      warning: `${name} se guardó, pero no se pudo crear su oportunidad: ${opportunityError.message}`,
    };
  }

  return { ok: true };
}

/**
 * Archiva un contacto. No se borra nada: los chats, mensajes y el historial
 * quedan en la base y el contacto desaparece de los listados.
 */
export async function archiveContact(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("contacts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Devuelve un contacto archivado a los listados activos. */
export async function restoreContact(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("contacts")
    .update({ archived_at: null })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export type ContactFootprint = {
  conversations: number;
  messages: number;
  appointments: number;
  opportunities: number;
};

/**
 * Cuenta todo lo que cuelga de un contacto antes de borrarlo.
 *
 * Las claves foráneas están declaradas `on delete cascade`, así que borrar el
 * contacto se lleva puesto esto sin preguntar. Se muestra en el cartel de
 * confirmación para que nadie borre un historial sin saber qué pierde.
 */
export async function loadContactFootprint(
  input: { ids: string[] },
): Promise<{ ok: true; footprint: ContactFootprint } | { ok: false; error: string }> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };
  if (input.ids.length === 0) {
    return {
      ok: true,
      footprint: { conversations: 0, messages: 0, appointments: 0, opportunities: 0 },
    };
  }

  const { data: conversations } = await scope.supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .in("contact_id", input.ids);

  const conversationIds = (conversations ?? []).map((row) => row.id as string);

  const countOf = async (
    table: "appointments" | "opportunities",
  ): Promise<number> => {
    const { count } = await scope.supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", scope.workspaceId)
      .in("contact_id", input.ids);
    return count ?? 0;
  };

  let messages = 0;
  if (conversationIds.length > 0) {
    const { count } = await scope.supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds);
    messages = count ?? 0;
  }

  return {
    ok: true,
    footprint: {
      conversations: conversationIds.length,
      messages,
      appointments: await countOf("appointments"),
      opportunities: await countOf("opportunities"),
    },
  };
}

/**
 * Borra contactos de la base, sin vuelta atrás.
 *
 * A diferencia de archivar, esto no se puede deshacer: el cascade arrastra
 * conversaciones, mensajes, turnos y oportunidades. Se expone sólo detrás de
 * una confirmación que enumera lo que se pierde.
 */
export async function deleteContacts(input: { ids: string[] }): Promise<ActionResult> {
  if (input.ids.length === 0) return { ok: false, error: "No seleccionaste ningún contacto." };

  const scope = await requirePermission("eliminar_contactos");
  if (!scope.ok) return { ok: false, error: scope.error };

  // El filtro por workspace no es decorativo: evita que un id de otro
  // workspace borre datos ajenos aunque RLS ya lo bloquearía.
  const { error } = await scope.supabase
    .from("contacts")
    .delete()
    .in("id", input.ids)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Archiva varios contactos de una. Es la alternativa reversible al borrado. */
export async function archiveContacts(input: { ids: string[] }): Promise<ActionResult> {
  if (input.ids.length === 0) return { ok: false, error: "No seleccionaste ningún contacto." };

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("contacts")
    .update({ archived_at: new Date().toISOString() })
    .in("id", input.ids)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Crea una oportunidad en el embudo del workspace del usuario. */
export async function createOpportunity(input: {
  contactId: string;
  stageId: string;
  value: number;
  notes?: string;
}): Promise<ActionResult> {
  if (!input.contactId) return { ok: false, error: "Elegí un contacto." };
  if (!input.stageId) return { ok: false, error: "Elegí una etapa." };
  if (!Number.isFinite(input.value) || input.value < 0) {
    return { ok: false, error: "El valor debe ser un número mayor o igual a cero." };
  }

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };
  if (!(await stageBelongsToWorkspace(scope, input.stageId))) {
    return { ok: false, error: "Esa etapa no existe en tu embudo." };
  }

  const { error } = await scope.supabase.from("opportunities").insert({
    workspace_id: scope.workspaceId,
    contact_id: input.contactId,
    stage_id: input.stageId,
    value: input.value,
    notes: input.notes?.trim() || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Mueve una oportunidad de etapa. */
export async function updateOpportunityStage(input: {
  id: string;
  stageId: string;
}): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };
  if (!(await stageBelongsToWorkspace(scope, input.stageId))) {
    return { ok: false, error: "Esa etapa no existe en tu embudo." };
  }

  const { error } = await scope.supabase
    .from("opportunities")
    .update({ stage_id: input.stageId })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Agenda una cita para un contacto del workspace.
 *
 * `enlace` es opcional y va a la misma columna que el de Calendar: es el que
 * sale en el `{link}` de los recordatorios. Una cita cargada acá no tiene el de
 * Calendar —nadie la reservó por ahí—, así que sin este campo el hueco salía
 * vacío en todos los avisos de las citas que carga el equipo.
 */
export async function createAppointment(input: {
  contactId: string;
  title: string;
  startTime: string;
  /** Opcional: sin él la cita dura lo de siempre. Ver abajo. */
  endTime?: string;
  enlace?: string;
}): Promise<ActionResult> {
  const title = input.title?.trim() ?? "";
  if (!input.contactId) return { ok: false, error: "Elegí un contacto." };
  if (!title) return { ok: false, error: "El título es obligatorio." };

  const enlace = leerEnlace(input.enlace);
  if (input.enlace?.trim() && !enlace) {
    return { ok: false, error: "El enlace tiene que empezar con http:// o https://." };
  }

  const start = new Date(input.startTime);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, error: "La fecha no es válida." };
  }

  // Sin hora de fin, la cita dura media hora, igual que un evento de Calendar
  // que llega sin fin. El formulario no la pide: nadie agenda pensando en
  // cuándo termina, y la columna no puede ir vacía —la base exige un fin
  // posterior al inicio—. Sigue aceptándose por si alguna vez la manda quien
  // sí la sabe.
  const end = input.endTime
    ? new Date(input.endTime)
    : new Date(start.getTime() + DURACION_POR_OMISION_MINUTOS * 60_000);
  if (Number.isNaN(end.getTime())) {
    return { ok: false, error: "La fecha no es válida." };
  }
  if (end <= start) return { ok: false, error: "El fin debe ser posterior al inicio." };

  const scope = await requirePermission("gestionar_agenda");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase.from("appointments").insert({
    workspace_id: scope.workspaceId,
    contact_id: input.contactId,
    title,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    calendar_link: enlace,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Cambia el enlace de una cita cargada a mano.
 *
 * Existe aparte del alta porque el enlace casi nunca está cuando se agenda: la
 * sala de Meet o el Zoom se crean después, y el recordatorio sale horas más
 * tarde. Sin esto habría que borrar la cita y volver a cargarla —perdiendo los
 * recordatorios ya anotados— para pegar un link.
 *
 * Las de Calendar no se tocan: ahí manda la sincronización y el próximo cambio
 * de horario pisaría lo que se escriba acá.
 */
export async function setAppointmentLink(input: {
  id: string;
  enlace: string;
}): Promise<ActionResult> {
  const crudo = input.enlace?.trim() ?? "";
  const enlace = leerEnlace(crudo);
  if (crudo && !enlace) {
    return { ok: false, error: "El enlace tiene que empezar con http:// o https://." };
  }

  const scope = await requirePermission("gestionar_agenda");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data, error } = await scope.supabase
    .from("appointments")
    .update({ calendar_link: enlace })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .neq("origen", "calendar")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return {
      ok: false,
      error: "No se pudo cambiar el enlace: la cita ya no está, o baja de Calendar y se cambia allá.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/** Marca una cita como realizada o cancelada. */
export async function updateAppointmentStatus(input: {
  id: string;
  status: AppointmentStatus;
}): Promise<ActionResult> {
  if (!APPOINTMENT_STATUSES.includes(input.status)) {
    return { ok: false, error: "Estado inválido." };
  }

  const scope = await requirePermission("gestionar_agenda");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("appointments")
    .update({ status: input.status })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Una cita como la muestra la agenda. Igual que la del tablero, para render
 * compartido. */
export type CitaAgendada = {
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

export type AgendaResult =
  | { ok: true; appointments: CitaAgendada[]; recortada: boolean }
  | { ok: false; error: string };

/** Cuántas citas trae como mucho un rango: más que eso no se lee de un scroll. */
const MAX_CITAS_DEL_RANGO = 200;

/**
 * Las citas de un rango de días, para el filtro de la agenda.
 *
 * El tablero trae sólo las que vienen —es lo que uno quiere ver al entrar—, así
 * que preguntarle a esa lista "qué tuve el martes pasado" contesta siempre que
 * no hubo nada. Cuando hay un rango puesto, la agenda vuelve a preguntar a la
 * base, y ahí sí entran las citas pasadas y las que quedaban afuera del corte
 * de las próximas.
 *
 * El rango llega en días de calendario (`YYYY-MM-DD`) y no en instantes: dónde
 * empieza el martes lo decide la zona del workspace, no el navegador de quien
 * filtra ni el reloj del servidor, que en Vercel corre en UTC.
 */
export async function listAppointmentsByRange(input: {
  desde: string;
  hasta: string;
}): Promise<AgendaResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const desde = normalizarDia(input.desde);
  const hasta = normalizarDia(input.hasta);
  if (!desde || !hasta) return { ok: false, error: "Elegí una fecha válida." };
  // Un rango dado vuelta es un error de tipeo, no una agenda vacía.
  const [primero, ultimo] = desde <= hasta ? [desde, hasta] : [hasta, desde];

  const timezone = safeTimeZone(scope.timezone);
  const inicio = startOfDayInZone(primero, timezone);
  // El último día entra entero: el corte es el arranque del siguiente.
  const fin = startOfDayInZone(shiftDayKey(ultimo, 1), timezone);

  const { data, error } = await scope.supabase
    .from("appointments")
    .select(
      "id, title, contact_id, origen, calendar_link, start_time, end_time, status, contacts!inner(name, archived_at)",
    )
    .eq("workspace_id", scope.workspaceId)
    .is("contacts.archived_at", null)
    .gte("start_time", inicio.toISOString())
    .lt("start_time", fin.toISOString())
    .order("start_time", { ascending: true })
    .limit(MAX_CITAS_DEL_RANGO + 1);

  if (error) return { ok: false, error: error.message };

  const filas = data ?? [];
  const recortada = filas.length > MAX_CITAS_DEL_RANGO;

  return {
    ok: true,
    recortada,
    appointments: filas.slice(0, MAX_CITAS_DEL_RANGO).map((row) => {
      // PostgREST devuelve la relación como objeto o como arreglo de uno.
      const contacto = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as
        | { name?: unknown }
        | null;
      const name = contacto?.name;
      return {
        id: row.id,
        title: row.title,
        contactId: row.contact_id,
        contactName: typeof name === "string" && name.length > 0 ? name : "Contacto sin nombre",
        origen: (row.origen as string | null) ?? null,
        enlace: (row.calendar_link as string | null) ?? null,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
      };
    }),
  };
}

/** `YYYY-MM-DD` que además exista en el calendario, o null. */
function normalizarDia(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  return fecha.getUTCFullYear() === year &&
    fecha.getUTCMonth() === month - 1 &&
    fecha.getUTCDate() === day
    ? value
    : null;
}

/**
 * Responde en una conversación: manda el mensaje por Zernio y recién ahí lo
 * guarda.
 *
 * El orden importa. Si se guardara primero, un fallo de Zernio dejaría en el
 * chat un mensaje que el contacto nunca recibió, que es peor que no mandarlo.
 */
type Enviable = {
  id: string;
  /** Para frenar la IA del lead cuando lo atiende una persona. */
  contact_id: string | null;
  channel: Channel;
  zernio_chat_id: string;
  zernio_account_id: string;
  provider: string | null;
};

/**
 * Busca la conversación y confirma que se pueda responder por ella.
 *
 * El filtro por workspace_id evita escribir en un chat ajeno aunque se adivine
 * el id; RLS lo cubre igual, pero acá el error es más claro. Los hilos que
 * quedaron sin cuenta son los importados antes de conectar el proveedor: no
 * tienen por dónde salir hasta que el contacto vuelva a escribir.
 */
async function conversacionParaEnviar(
  scope: Extract<WorkspaceScope, { ok: true }>,
  conversationId: string,
): Promise<{ ok: true; conversation: Enviable } | { ok: false; error: string }> {
  const { data, error } = await scope.supabase
    .from("conversations")
    .select("id, contact_id, channel, zernio_chat_id, zernio_account_id, provider")
    .eq("id", conversationId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No encontramos esa conversación." };
  if (!data.zernio_account_id) {
    return {
      ok: false,
      error: "Esta conversación es anterior a la conexión con Zernio. Va a poder responderse cuando el contacto escriba de nuevo.",
    };
  }

  return { ok: true, conversation: data as Enviable };
}

/**
 * Apaga la IA del contacto cuando una persona del equipo le escribe.
 *
 * Es opcional y por canal, en la configuración del agente. Existe porque el
 * interruptor de la ficha ya estaba pero había que acordarse de tocarlo *antes*
 * de escribir, que es justo cuando nadie se acuerda: el vendedor entra a la
 * conversación, escribe, y el agente le contesta encima al lead con otra voz.
 *
 * Queda apagada hasta que alguien la vuelva a prender a mano. Reactivarla sola
 * —a las N horas, o al mover la tarjeta— devolvería al agente en medio de una
 * negociación que alguien está llevando.
 *
 * Va después de que el mensaje salió y no antes: si el envío falla, nadie tomó
 * la conversación y no hay nada que frenar.
 *
 * No la llaman las automatizaciones ni las difusiones, aunque también guarden
 * sus mensajes como `user`: pasan por otro camino, y un follow-up automático no
 * es alguien tomando la charla.
 */
async function frenarAgenteSiEscribeUnaPersona(
  scope: Extract<WorkspaceScope, { ok: true }>,
  conversation: Enviable,
): Promise<void> {
  if (!conversation.contact_id) return;

  const { data, error } = await scope.supabase
    .from("ai_agent_configs")
    .select("pause_on_human_reply")
    .eq("workspace_id", scope.workspaceId)
    .eq("channel", conversation.channel)
    .maybeSingle();

  // Sin la migración la columna no existe y el select falla entero. Se sigue
  // como antes en vez de romper un envío que ya salió.
  if (error || !data?.pause_on_human_reply) return;

  await scope.supabase
    .from("contacts")
    .update({ bot_enabled: false })
    .eq("id", conversation.contact_id)
    .eq("workspace_id", scope.workspaceId);
}

export async function sendChatMessage(input: {
  conversationId: string;
  text: string;
}): Promise<ActionResult> {
  const text = input.text?.trim() ?? "";
  if (!text) return { ok: false, error: "Escribí un mensaje." };
  if (text.length > 4000) return { ok: false, error: "El mensaje es demasiado largo." };

  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const encontrada = await conversacionParaEnviar(scope, input.conversationId);
  if (!encontrada.ok) return encontrada;
  const conversation = encontrada.conversation;

  const sent = await enviarTexto({
    provider: conversation.provider,
    conversationId: conversation.zernio_chat_id,
    accountId: conversation.zernio_account_id,
    text,
  });

  if (!sent.ok) return { ok: false, error: sent.error };

  const { error: saveError } = await scope.supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender_type: "user",
    content: text,
    zernio_message_id: sent.messageId ?? null,
  });

  await frenarAgenteSiEscribeUnaPersona(scope, conversation);

  revalidatePath("/");

  // El contacto ya lo recibió: no es un fallo del envío, pero hay que avisarlo
  // porque el historial va a quedar incompleto.
  if (saveError) {
    return { ok: true, warning: "El mensaje salió, pero no se pudo guardar en el historial." };
  }

  return { ok: true };
}

export type StartConversationResult =
  | { ok: true; conversationId: string; provider: string }
  | { ok: false; error: string };

/**
 * Abre el chat de un contacto al que todavía nadie le escribió.
 *
 * Hasta acá esos contactos quedaban listados en la bandeja como "Esperando
 * primer mensaje" y no había forma de arrancarles la charla: el chat sólo
 * nacía con el webhook del primer mensaje entrante, así que a un contacto
 * cargado a mano o importado no se le podía escribir sin armarle una difusión.
 *
 * No manda nada: deja la conversación abierta para que quien atiende escriba
 * desde la bandeja. En WhatsApp ese primer mensaje tiene que ser una plantilla
 * aprobada, porque la ventana de 24 horas todavía no se abrió — el chat lo
 * avisa arriba de la caja de texto.
 */
export async function startContactConversation(input: {
  contactId: string;
}): Promise<StartConversationResult> {
  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: contacto, error } = await scope.supabase
    .from("contacts")
    .select("id, phone")
    .eq("id", input.contactId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!contacto) return { ok: false, error: "No encontramos ese contacto." };

  // Pudo abrirlo otra persona —o el propio contacto, escribiendo— entre que se
  // pintó la lista y llegó el clic. Se devuelve esa y no se crea una segunda.
  const { data: existente } = await scope.supabase
    .from("conversations")
    .select("id, provider")
    .eq("workspace_id", scope.workspaceId)
    .eq("contact_id", contacto.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existente?.id) {
    return {
      ok: true,
      conversationId: existente.id as string,
      provider: (existente.provider as string | null) ?? "",
    };
  }

  const salida = await salidaParaEscribirPrimero(scope.supabase, scope.workspaceId);
  if (!salida.ok) return salida;

  const chatId = chatIdDelContacto(salida, contacto.phone as string | null);
  if (!chatId) {
    return {
      ok: false,
      error: "Este contacto no tiene un teléfono válido para WhatsApp. Corregilo en su ficha.",
    };
  }

  const conversationId = await abrirConversacion(scope.supabase, {
    workspaceId: scope.workspaceId,
    contactId: contacto.id as string,
    provider: salida.provider,
    chatId,
    accountId: salida.accountId,
  });

  if (!conversationId) {
    return { ok: false, error: "No se pudo abrir el chat. Probá de nuevo en un momento." };
  }

  revalidatePath("/");
  return { ok: true, conversationId, provider: salida.provider };
}

export type PlantillasResult =
  | { ok: true; plantillas: Plantilla[] }
  | { ok: false; error: string };

/**
 * Trae las plantillas que se pueden mandar en esta conversación.
 *
 * Sólo las aprobadas: una plantilla rechazada o en revisión existe en el panel
 * de YCloud pero Meta la rebota al enviarla, con un error que no le dice nada a
 * quien está atendiendo.
 */
export async function loadWhatsappTemplates(input: {
  conversationId: string;
}): Promise<PlantillasResult> {
  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const encontrada = await conversacionParaEnviar(scope, input.conversationId);
  if (!encontrada.ok) return encontrada;

  if (proveedorDe(encontrada.conversation.provider) !== "ycloud") {
    return {
      ok: false,
      error: "Las plantillas son de WhatsApp: esta conversación no las admite.",
    };
  }

  const result = await listYcloudTemplates();
  if (!result.ok) return result;

  return { ok: true, plantillas: result.plantillas.filter((p) => p.estado === "APPROVED") };
}

/**
 * Manda una plantilla ya aprobada.
 *
 * Del navegador viene el nombre, el idioma y los valores de los huecos, nunca
 * el cuerpo armado: la definición se vuelve a leer acá y con ella se construye
 * el envío. Si viniera armado, cualquiera con la sesión abierta podría mandar
 * un texto arbitrario diciendo que es una plantilla.
 *
 * En el historial queda el mensaje ya completado y no el nombre de la
 * plantilla, porque quien abre el chat después quiere leer lo que se dijo.
 */
export async function sendTemplateMessage(input: {
  conversationId: string;
  nombre: string;
  idioma: string;
  valores: Valores;
}): Promise<ActionResult> {
  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const encontrada = await conversacionParaEnviar(scope, input.conversationId);
  if (!encontrada.ok) return encontrada;
  const conversation = encontrada.conversation;

  const disponibles = await listYcloudTemplates();
  if (!disponibles.ok) return disponibles;

  const plantilla = disponibles.plantillas.find(
    (p) => p.nombre === input.nombre && p.idioma === input.idioma && p.estado === "APPROVED",
  );
  if (!plantilla) {
    return { ok: false, error: "Esa plantilla ya no está disponible. Volvé a abrir la lista." };
  }

  const valores = input.valores ?? {};
  const hueco = primerHuecoVacio(plantilla, valores);
  if (hueco) {
    return {
      ok: false,
      error:
        hueco.clase === "link"
          ? "Falta el link del archivo del encabezado."
          : `Falta completar la variable {{${hueco.numero}}}.`,
    };
  }

  const sent = await enviarPlantilla({
    provider: conversation.provider,
    conversationId: conversation.zernio_chat_id,
    accountId: conversation.zernio_account_id,
    nombre: plantilla.nombre,
    idioma: plantilla.idioma,
    components: componentesParaEnviar(plantilla, valores),
  });

  if (!sent.ok) return { ok: false, error: sent.error };

  const { error: saveError } = await scope.supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender_type: "user",
    content: vistaPrevia(plantilla, valores),
    zernio_message_id: sent.messageId ?? null,
  });

  await frenarAgenteSiEscribeUnaPersona(scope, conversation);

  revalidatePath("/");

  if (saveError) {
    return { ok: true, warning: "La plantilla salió, pero no se pudo guardar en el historial." };
  }

  return { ok: true };
}

/**
 * Formatos que puede largar `MediaRecorder` según el navegador, con la
 * extensión que le corresponde al archivo.
 *
 * Chrome graba webm/opus, Safari mp4. Se acepta lo que mande el navegador en
 * vez de forzar uno: convertir de un formato a otro del lado del servidor pide
 * ffmpeg, que no está.
 */
const VOICE_FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  // Lo que el chat arma para Instagram y Messenger, que no aceptan OGG.
  "audio/wav": "wav",
};

/** Lo que se ve en el historial hasta que vuelve la transcripción. */
const VOICE_PLACEHOLDER = "Nota de voz";

type AudioListo = {
  ok: true;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  /** Si sale con onda y play en vez de como adjunto. Sólo OGG/Opus. */
  notaDeVoz: boolean;
};

/**
 * Deja el audio del navegador listo para subir.
 *
 * Lo usan la nota de voz del chat y el audio de un paso de automatización: es
 * el mismo camino —mismo tope, mismos formatos, misma traducción de envoltorio—
 * y conviene que lo siga siendo, porque un audio que se escucha en un lado y no
 * en el otro es el bug más caro de encontrar.
 *
 * Chrome sólo sabe grabar en WebM y WhatsApp sólo acepta OGG: en el medio se
 * cambia el envoltorio, que lleva los mismos paquetes Opus adentro. Si el
 * archivo no se entiende se manda como vino, que es peor pero no es nada.
 */
function prepararAudio(
  audio: string,
  mimeType: string,
): AudioListo | { ok: false; error: string } {
  // Chrome manda "audio/webm;codecs=opus": el códec no cambia la extensión.
  const baseMime = (mimeType ?? "").split(";")[0].trim();
  const extension = VOICE_FORMATS[baseMime];
  if (!extension) {
    return { ok: false, error: `Formato de audio no soportado: ${baseMime || "desconocido"}.` };
  }

  const crudo = new Uint8Array(Buffer.from(audio ?? "", "base64"));
  if (crudo.byteLength === 0) return { ok: false, error: "La grabación llegó vacía." };
  if (crudo.byteLength > MAX_VOICE_BYTES) {
    return { ok: false, error: "El audio es demasiado largo. Grabá uno más corto." };
  }

  const convertido = baseMime === "audio/webm" ? webmOpusAOgg(crudo) : null;
  if (baseMime === "audio/webm" && !convertido) {
    console.warn("[audio] no se pudo pasar el WebM a OGG; se manda tal cual");
  }

  const contentType = convertido ? "audio/ogg" : baseMime;
  return {
    ok: true,
    bytes: convertido ?? crudo,
    contentType,
    extension: convertido ? "ogg" : extension,
    // La nota de voz con onda y play sólo existe si el audio es OGG/Opus. En
    // Safari, que graba en mp4, sale como adjunto de audio: se escucha igual.
    notaDeVoz: contentType === "audio/ogg",
  };
}

/**
 * Manda una nota de voz grabada desde el CRM.
 *
 * Tres pasos: el audio se guarda en Supabase Storage —Zernio necesita una URL
 * que pueda descargar, no puede recibir el archivo de nuestra sesión—, se
 * intenta enviarlo como adjunto, y se guarda en el historial.
 *
 * Antes del envío hay una traducción de formato: Chrome graba en WebM y WhatsApp
 * sólo acepta OGG/Opus, así que se cambia el envoltorio sin tocar el audio.
 *
 * El plan B se queda igual: si el canal rechaza el audio, en vez de fallar se
 * transcribe y se manda como texto, avisando qué pasó. El cliente recibe algo
 * en los dos casos.
 */
export async function sendVoiceMessage(input: {
  conversationId: string;
  /** El audio en base64, sin el prefijo `data:`. */
  audio: string;
  mimeType: string;
}): Promise<ActionResult> {
  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const preparado = prepararAudio(input.audio, input.mimeType);
  if (!preparado.ok) return { ok: false, error: preparado.error };
  const { bytes, contentType: mimeFinal, extension: extensionFinal, notaDeVoz: esNotaDeVoz } =
    preparado;

  const encontrada = await conversacionParaEnviar(scope, input.conversationId);
  if (!encontrada.ok) return encontrada;
  const conversation = encontrada.conversation;

  const subida = await uploadVoiceNote({
    workspaceId: scope.workspaceId,
    bytes,
    contentType: mimeFinal,
    extension: extensionFinal,
  });

  if (!subida.ok) return { ok: false, error: subida.error };

  const sent = await enviarAudio({
    provider: conversation.provider,
    conversationId: conversation.zernio_chat_id,
    accountId: conversation.zernio_account_id,
    audioUrl: subida.url,
    voiceNote: esNotaDeVoz,
  });

  // Camino feliz: salió como audio. La transcripción se hace después, en
  // segundo plano, para no hacerte esperar por algo que es para el historial.
  if (sent.ok) {
    const { data: saved } = await scope.supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        sender_type: "user",
        content: VOICE_PLACEHOLDER,
        media_url: subida.url,
        zernio_message_id: sent.messageId ?? null,
      })
      .select("id")
      .maybeSingle();

    await frenarAgenteSiEscribeUnaPersona(scope, conversation);

    revalidatePath("/");

    if (saved?.id) {
      const messageId = saved.id as string;
      after(async () => {
        // Se transcribe también lo que mandamos nosotros: si no, el agente IA
        // no ve su propio lado de la charla y repite cosas ya dichas.
        const result = await transcribeAudio(subida.url);
        if (!result.ok) return;
        await scope.supabase
          .from("messages")
          .update({ content: result.text })
          .eq("id", messageId);
      });
    }

    return { ok: true };
  }

  // Plan B: el canal no se lo tragó como audio. Antes de darlo por perdido, se
  // manda lo que dijiste como texto.
  const transcripcion = await transcribeAudio(subida.url);
  if (!transcripcion.ok) {
    return { ok: false, error: `${sent.error} Y tampoco se pudo transcribir: ${transcripcion.error}` };
  }

  const texto = await enviarTexto({
    provider: conversation.provider,
    conversationId: conversation.zernio_chat_id,
    accountId: conversation.zernio_account_id,
    text: transcripcion.text,
  });

  if (!texto.ok) return { ok: false, error: texto.error };

  await scope.supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender_type: "user",
    content: transcripcion.text,
    media_url: subida.url,
    zernio_message_id: texto.messageId ?? null,
  });

  revalidatePath("/");
  // El error del canal va en el aviso, no sólo en los logs: cuando un audio no
  // sale, lo único que importa es ver qué contestó para poder corregirlo. Dice
  // "el canal" y no un nombre porque puede ser Zernio o YCloud.
  return {
    ok: true,
    warning: `El audio no salió como audio y se mandó la transcripción como texto. Respuesta del canal: ${sent.error}`,
  };
}

/**
 * Manda una imagen o un video desde el chat.
 *
 * Recibe un `FormData` y no un base64 como la nota de voz: pasar un archivo a
 * texto lo engorda un tercio, y en un video de dieciséis megas ese tercio es lo
 * que separa un envío de un "payload demasiado grande". El `File` del navegador
 * viaja tal cual.
 *
 * El caption va pegado al archivo y no como un segundo mensaje: de ese modo
 * llega en una sola burbuja y no puede llegar desordenado. Por eso también se
 * guarda una sola fila en el historial, con el texto y la URL juntos.
 *
 * No hay plan B como en el audio. Si el canal rechaza el archivo no se manda
 * nada en su lugar: una foto reemplazada por su epígrafe no es el mensaje que
 * alguien quiso mandar, y hacerlo dejaría al vendedor creyendo que la foto salió.
 */
export async function sendMediaMessage(form: FormData): Promise<ActionResult> {
  const scope = await requirePermission("responder_chats");
  if (!scope.ok) return { ok: false, error: scope.error };

  const archivo = form.get("archivo");
  if (!(archivo instanceof File)) return { ok: false, error: "No llegó ningún archivo." };

  // El navegador ya revisó lo mismo antes de subir, para avisar en el momento.
  // Acá se vuelve a revisar porque una Server Action es una ruta pública: lo que
  // valida el cliente no valida nada.
  const revision = revisarAdjunto(archivo.type, archivo.size);
  if (!revision.ok) return { ok: false, error: revision.error };
  const { adjunto } = revision;

  // El tope se revisa antes de subir: pasarse de largo con un video de dieciséis
  // megas significaría esperar toda la subida para que el canal lo rechace.
  const caption = String(form.get("caption") ?? "").trim();
  if (caption.length > MAX_CAPTION) {
    return { ok: false, error: "El texto que acompaña al archivo es demasiado largo." };
  }

  const encontrada = await conversacionParaEnviar(scope, String(form.get("conversationId") ?? ""));
  if (!encontrada.ok) return encontrada;
  const conversation = encontrada.conversation;

  const subida = await uploadChatMedia({
    workspaceId: scope.workspaceId,
    bytes: new Uint8Array(await archivo.arrayBuffer()),
    contentType: adjunto.mimeType,
    extension: adjunto.extension,
  });

  if (!subida.ok) return { ok: false, error: subida.error };

  const sent = await enviarMedia({
    provider: conversation.provider,
    conversationId: conversation.zernio_chat_id,
    accountId: conversation.zernio_account_id,
    kind: adjunto.kind,
    url: subida.url,
    mimeType: adjunto.mimeType,
    caption: caption || undefined,
  });

  if (!sent.ok) return { ok: false, error: sent.error };

  const { data: saved } = await scope.supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: "user",
      content: caption || MEDIA_SALIENTE[adjunto.kind],
      media_url: subida.url,
      zernio_message_id: sent.messageId ?? null,
    })
    .select("id")
    .maybeSingle();

  await frenarAgenteSiEscribeUnaPersona(scope, conversation);

  revalidatePath("/");

  // Una imagen sin epígrafe queda como «🖼️ Imagen» en el historial, y eso para
  // el agente IA no dice nada: no ve su propio lado de la charla y vuelve a
  // pedir la foto que ya se mandó. Se describe después de contestar, igual que
  // se transcribe la nota de voz, para no hacer esperar a quien la mandó.
  //
  // Con epígrafe no hace falta: el texto es el mensaje. Y en el video no hay
  // nada que leer, así que se queda con el marcador.
  if (saved?.id && adjunto.kind === "imagen" && !caption) {
    const messageId = saved.id as string;
    after(async () => {
      const descripcion = await describeImage(subida.url);
      if (!descripcion.ok) {
        console.warn("[chat] no se pudo describir la imagen enviada:", descripcion.error);
        return;
      }
      await scope.supabase
        .from("messages")
        .update({ content: descripcion.text })
        .eq("id", messageId);
    });
  }

  return { ok: true };
}

export type ThreadMessage = {
  id: string;
  senderType: SenderType;
  content: string;
  mediaUrl: string | null;
  createdAt: string;
};

export type ThreadResult =
  | { ok: true; messages: ThreadMessage[] }
  | { ok: false; error: string };

/**
 * Trae el hilo de una conversación. Se carga a demanda y no en `getCrmData`
 * para no arrastrar todos los mensajes de todos los chats en cada render.
 */
export async function loadThread(input: { conversationId: string }): Promise<ThreadResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data, error } = await scope.supabase
    .from("messages")
    .select("id, sender_type, content, media_url, created_at, conversations!inner(workspace_id)")
    .eq("conversation_id", input.conversationId)
    .eq("conversations.workspace_id", scope.workspaceId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    messages: (data ?? []).map((row) => ({
      id: row.id,
      senderType: row.sender_type,
      content: row.content,
      mediaUrl: row.media_url,
      createdAt: row.created_at,
    })),
  };
}

/** Marca como leída una conversación al abrirla. */
export async function markConversationRead(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Devuelve un chat a la pila de pendientes después de haberlo leído.
 *
 * Deja el contador en uno y no en lo que hubiera antes: lo que importa es que
 * el chat vuelva a aparecer sin leer, no cuántos mensajes quedaron sin mirar.
 * Recuperar la cuenta vieja tampoco se puede, se perdió al abrirlo.
 *
 * La marca es del workspace, igual que la de leído: si alguien deja un chat
 * para después, le queda pendiente a todo el equipo.
 */
export async function markConversationUnread(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("conversations")
    .update({ unread_count: 1 })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Pone o saca la estrella de un chat.
 *
 * La marca es del workspace: quien destaca un chat lo destaca para todo el
 * equipo, igual que una derivación atendida deja de aparecerle al resto.
 */
export async function setConversationStarred(input: {
  id: string;
  destacada: boolean;
}): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("conversations")
    .update({ destacada: input.destacada })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Saca un chat de la lista de derivaciones.
 *
 * Es lo contrario de lo que hace `ai-reply.ts` al derivar: vuelve el estado a
 * `open`. La marca es del workspace, no tuya — cuando alguien agarra la
 * derivación, deja de aparecer para todos. Es a propósito: si ya la está
 * atendiendo otro, que le siga apareciendo al resto es ruido.
 *
 * No frena ni prende la IA: eso se decide en la ficha del lead. Muchas veces
 * atendés vos y querés que la IA siga apagada para esa persona.
 */
export async function markConversationAttended(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("conversations")
    .update({ status: "open" })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export type LeadDetail = {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    tags: string[];
    avatarUrl: string | null;
    createdAt: string;
    botEnabled: boolean;
    /** Responsable del lead. Es lo que decide qué operario lo ve. */
    assignedTo: string | null;
  };
  opportunity: { id: string; stageId: string; value: number; notes: string | null } | null;
  conversations: {
    id: string;
    channel: Channel;
    provider: string | null;
    unreadCount: number;
    updatedAt: string;
  }[];
  /** Números del historial, para el bloque de estadísticas de la ficha. */
  stats: {
    messages: number;
    received: number;
    sent: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
  };
  /** Adjuntos que mandó o recibió el contacto, del más nuevo al más viejo. */
  files: { id: string; url: string; caption: string; createdAt: string; mine: boolean }[];
  appointments: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    status: AppointmentStatus;
  }[];
};

export type LeadResult = { ok: true; lead: LeadDetail } | { ok: false; error: string };

/**
 * Trae todo lo de un contacto en una sola llamada: ficha, oportunidad, chats y
 * citas. Es lo que alimenta la tarjeta de lead, donde todo eso convive.
 */
export async function loadLead(input: { contactId: string }): Promise<LeadResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const [contactResult, opportunityResult, conversationsResult, appointmentsResult] =
    await Promise.all([
      scope.supabase
        .from("contacts")
        .select("id, name, email, phone, tags, avatar_url, created_at, bot_enabled, assigned_to")
        .eq("id", input.contactId)
        .eq("workspace_id", scope.workspaceId)
        .maybeSingle(),
      scope.supabase
        .from("opportunities")
        .select("id, stage_id, value, notes")
        .eq("contact_id", input.contactId)
        .eq("workspace_id", scope.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      scope.supabase
        .from("conversations")
        .select("id, channel, provider, unread_count, updated_at")
        .eq("contact_id", input.contactId)
        .eq("workspace_id", scope.workspaceId)
        .order("updated_at", { ascending: false }),
      scope.supabase
        .from("appointments")
        .select("id, title, start_time, end_time, status")
        .eq("contact_id", input.contactId)
        .eq("workspace_id", scope.workspaceId)
        .order("start_time", { ascending: true })
        .limit(20),
    ]);

  const contact = contactResult.data;
  if (!contact) return { ok: false, error: "No encontramos ese contacto." };

  const opportunity = opportunityResult.data;

  // Los mensajes se piden después porque hacen falta los ids de conversación,
  // que recién se conocen acá.
  const conversationIds = (conversationsResult.data ?? []).map((row) => row.id as string);

  let messages: {
    id: string;
    sender_type: SenderType;
    media_url: string | null;
    content: string | null;
    created_at: string;
  }[] = [];

  if (conversationIds.length > 0) {
    const { data } = await scope.supabase
      .from("messages")
      .select("id, sender_type, media_url, content, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });
    messages = data ?? [];
  }

  const received = messages.filter((row) => row.sender_type === "contact").length;

  return {
    ok: true,
    lead: {
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        tags: contact.tags ?? [],
        avatarUrl: contact.avatar_url,
        createdAt: contact.created_at,
        botEnabled: contact.bot_enabled ?? true,
        assignedTo: contact.assigned_to ?? null,
      },
      opportunity: opportunity
        ? {
            id: opportunity.id,
            stageId: opportunity.stage_id,
            value: Number(opportunity.value ?? 0),
            notes: opportunity.notes,
          }
        : null,
      conversations: (conversationsResult.data ?? []).map((row) => ({
        id: row.id,
        channel: row.channel,
        provider: row.provider ?? null,
        unreadCount: row.unread_count ?? 0,
        updatedAt: row.updated_at,
      })),
      appointments: (appointmentsResult.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
      })),
      stats: {
        messages: messages.length,
        received,
        sent: messages.length - received,
        firstMessageAt: messages[0]?.created_at ?? null,
        lastMessageAt: messages[messages.length - 1]?.created_at ?? null,
      },
      files: messages
        .filter((row) => typeof row.media_url === "string" && row.media_url)
        .reverse()
        .map((row) => ({
          id: row.id,
          url: row.media_url as string,
          caption: row.content?.trim() || "",
          createdAt: row.created_at,
          mine: row.sender_type !== "contact",
        })),
    },
  };
}

/**
 * Frena o reactiva la IA para un contacto.
 *
 * Es el interruptor que lee el webhook antes de contestar solo. Se guarda en
 * `contacts.bot_enabled`, una columna booleana, en vez de una etiqueta de
 * texto: una cadena mal escrita dejaría a la IA hablando sin que se note.
 */
export async function setContactBot(input: {
  id: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("contacts")
    .update({ bot_enabled: input.enabled })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Edita los datos de contacto desde la tarjeta de lead. */
export async function updateContact(input: {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  /** Opcional: si no viene, las etiquetas quedan como estaban. */
  tags?: string[];
}): Promise<ActionResult> {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";

  if (!name) return { ok: false, error: "El nombre es obligatorio." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "El email no tiene un formato válido." };
  }

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  // Se limpian acá y no en la pantalla: las etiquetas se escriben separadas por
  // coma y siempre terminan con espacios de más, repetidas o vacías.
  const tags =
    input.tags === undefined
      ? undefined
      : [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);

  if (tags?.some((tag) => tag.length > 30)) {
    return { ok: false, error: "Cada etiqueta puede tener hasta 30 caracteres." };
  }

  const { error } = await scope.supabase
    .from("contacts")
    .update({
      name,
      email: email || null,
      phone: input.phone?.trim() || null,
      ...(tags === undefined ? {} : { tags }),
    })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Actualiza el valor y las notas de la oportunidad. */
export async function updateOpportunityDetails(input: {
  id: string;
  value: number;
  notes: string;
}): Promise<ActionResult> {
  if (!Number.isFinite(input.value) || input.value < 0) {
    return { ok: false, error: "El valor debe ser un número mayor o igual a cero." };
  }

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("opportunities")
    .update({ value: input.value, notes: input.notes.trim() || null })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export type AgentConfig = {
  id: string | null;
  channel: Channel;
  /** Interruptor general del canal. Manda sobre el `bot_enabled` de cada lead. */
  enabled: boolean;
  /**
   * Las instrucciones del canal. Se escriben en el panel de Agentes IA y se
   * guardan en `ai_agent_configs.system_prompt`. Vacías, el agente no contesta.
   */
  systemPrompt: string;
  modelVersion: string;
  tools: { handoff_to_human: boolean };
  /**
   * Cuánto tarda en contestar, en segundos.
   *
   * Es también la ventana en la que se agrupan los mensajes de una ráfaga —
   * ver `ai-reply.ts`.
   */
  replyDelaySeconds: number;
  /**
   * En qué embudos contesta. Vacío es "en todos".
   *
   * No elegir es no restringir, igual que los permisos por columna: la lista
   * vacía es el estado natural de un agente recién configurado, y ese estado
   * tiene que ser el que atiende a todo el mundo.
   */
  pipelineIds: string[];
  /**
   * Con qué criterio mueve la tarjeta de columna. Vacío es "no mueve nada".
   *
   * El criterio lo escribe quien configura, en castellano, porque es del negocio
   * y no del CRM: qué significa "Calificado" lo sabe quien vende. Ver
   * `movimientos-del-agente.ts`.
   */
  movimientos: ReglaDeMovimiento[];
  /** Si al escribir una persona en el chat se apaga la IA de ese contacto. */
  pauseOnHumanReply: boolean;
  /**
   * El horario en el que contesta, en la zona del workspace.
   *
   * Fuera de él el agente no contesta y el mensaje queda en la bandeja para que
   * lo atienda una persona. No se guarda para contestarlo al abrir: la respuesta
   * sale en el `after()` del webhook, que no vive ocho horas.
   */
  horario: HorarioDelAgente;
  /**
   * Lo que se le manda al contacto cuando escribe fuera de horario.
   *
   * Vacío es apagado, que es como nace: entonces fuera de horario no sale nada y
   * el mensaje espera en la bandeja. Es un texto fijo y no una respuesta del
   * modelo porque a esa hora lo único honesto que se puede decir es cuándo se
   * atiende.
   */
  avisoFueraDeHorario: string;
};

export type AgentsResult = { ok: true; agents: AgentConfig[] } | { ok: false; error: string };

const CHANNELS: Channel[] = ["whatsapp", "instagram", "messenger"];

/**
 * Las herramientas del agente.
 *
 * Hubo tres. `catalog_search` y `schedule_appointment` se sacaron porque nunca
 * llegaron a hacer nada: se guardaban y se dibujaban, pero ningún pedido a
 * OpenAI las miraba. Un interruptor que no apaga nada miente peor que uno que
 * no existe. La derivación quedó porque sí funciona — ver `ai-reply.ts`.
 *
 * Las filas viejas todavía traen las dos claves muertas: se descartan acá, así
 * que no vuelven a escribirse al guardar.
 */
const sanitizeTools = (tools: { handoff_to_human?: boolean }) => ({
  handoff_to_human: tools.handoff_to_human !== false,
});

const COLUMNAS_SIEMPRE = "id, channel, enabled, tools_config, model_version, system_prompt";
const COLUMNAS_DEMORA = "reply_delay_seconds, pause_on_human_reply";
const COLUMNAS_HORARIO = "dias, aviso_fuera_de_horario";

/**
 * Lo que se le pide a `ai_agent_configs`, de lo más completo a lo que seguro está.
 *
 * Pedir una columna que todavía no existe hace fallar el select entero, y con él
 * la pantalla de Agentes IA: antes se caía con un error de Postgres a la vista y
 * no se podían ni leer las instrucciones ya cargadas. Cada migración del horario
 * agrega un escalón, y el aviso dice qué quedó sin leer —un panel que muestra un
 * horario distinto del que el agente está usando es peor que uno que lo muestra
 * en blanco—.
 *
 * El segundo escalón existe para el despliegue a medias, con `202610010001`
 * corrida y `202610010003` todavía no: `horarioDeLaFila` sabe armar la franja
 * desde ese par de columnas viejas, así que el horario ya cargado se sigue
 * viendo.
 */
const INTENTOS: { columnas: string; aviso: string | null }[] = [
  {
    columnas: `${COLUMNAS_SIEMPRE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_HORARIO}, franjas, horario_excluye`,
    aviso: null,
  },
  {
    columnas: `${COLUMNAS_SIEMPRE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_HORARIO}, franjas`,
    aviso: "sin la columna del modo, las franjas se leen como cuándo contesta (falta la migración 202610010004)",
  },
  {
    columnas: `${COLUMNAS_SIEMPRE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_HORARIO}, hora_desde, hora_hasta`,
    aviso: "sin la columna de franjas, el horario se lee del par de horas viejo (falta la migración 202610010003)",
  },
  {
    columnas: `${COLUMNAS_SIEMPRE}, ${COLUMNAS_DEMORA}`,
    aviso: "sin las columnas de horario, contestan a toda hora (faltan las migraciones del horario)",
  },
  { columnas: COLUMNAS_SIEMPRE, aviso: "sin la columna de demora, se usa la de siempre" },
];

/**
 * Devuelve la config de agente de cada canal.
 *
 * Los canales sin fila en la base salen con valores por defecto y `id` en null:
 * así el panel muestra los tres siempre, y la fila se crea recién al guardar.
 */
export async function loadAgentConfigs(): Promise<AgentsResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  let ultimoError = "";

  for (const intento of INTENTOS) {
    const { data, error } = await scope.supabase
      .from("ai_agent_configs")
      .select(intento.columnas)
      .eq("workspace_id", scope.workspaceId);

    if (!error) {
      if (intento.aviso) console.error(`[agentes] ${intento.aviso}:`, ultimoError);
      // El cast reemplaza la inferencia de Supabase, que con el `select` en una
      // variable no puede deducir las columnas. No se pierde nada: las filas se
      // leen por `FilaDeAgente`, que es la única forma de que un escalón con
      // menos columnas y otro con más pasen por el mismo armado.
      return { ok: true, agents: await armarAgentes(scope, (data ?? []) as FilaDeAgente[]) };
    }
    ultimoError = error.message;
  }

  return { ok: false, error: ultimoError };
}

/**
 * Una fila de `ai_agent_configs` como vuelve de cualquiera de los escalones.
 *
 * Todo es opcional porque los selects de respaldo piden menos columnas: la que
 * no vino no está en el objeto, y cada campo cae en su valor por defecto. Así el
 * armado es uno solo y no hay cuatro copias que se desincronicen.
 */
type FilaDeAgente = {
  id?: string | null;
  channel?: unknown;
  enabled?: boolean | null;
  tools_config?: unknown;
  model_version?: string | null;
  system_prompt?: string | null;
  reply_delay_seconds?: number | null;
  pause_on_human_reply?: boolean | null;
  dias?: unknown;
  franjas?: unknown;
  horario_excluye?: unknown;
  hora_desde?: unknown;
  hora_hasta?: unknown;
  aviso_fuera_de_horario?: unknown;
};

/** Los tres canales, con lo que haya en la base y los defaults para el resto. */
async function armarAgentes(
  scope: { supabase: SupabaseClient; workspaceId: string },
  filas: FilaDeAgente[],
): Promise<AgentConfig[]> {
  const saved = new Map(filas.map((fila) => [fila.channel as Channel, fila]));
  const embudosPorConfig = await embudosDeLosAgentes(scope);
  const movimientosPorConfig = await movimientosDeLosAgentes(scope);

  return CHANNELS.map((channel) => {
    const row = saved.get(channel);
    return {
      id: row?.id ?? null,
      channel,
      enabled: row?.enabled ?? true,
      systemPrompt: row?.system_prompt ?? "",
      modelVersion: row?.model_version ?? "gpt-5",
      tools: sanitizeTools((row?.tools_config ?? {}) as { handoff_to_human?: boolean }),
      replyDelaySeconds: row?.reply_delay_seconds ?? DEFAULT_REPLY_DELAY_SECONDS,
      pipelineIds: (row?.id && embudosPorConfig.get(row.id)) || [],
      movimientos: (row?.id && movimientosPorConfig.get(row.id)) || [],
      pauseOnHumanReply: row?.pause_on_human_reply === true,
      // Sin las columnas del horario —o sin fila— el agente contesta siempre y
      // sin aviso, que es como venía antes de que el horario existiera.
      horario: horarioDeLaFila(row),
      avisoFueraDeHorario: avisoDeLaFila(row),
    };
  });
}

/**
 * Los embudos elegidos de cada agente, en una sola consulta.
 *
 * Sin la migración corrida la tabla no existe: se devuelven listas vacías, que
 * significan "contesta en todos". El panel se dibuja igual y lo único que no se
 * puede es recortarlo, que es lo que esa migración todavía no habilitó.
 */
async function embudosDeLosAgentes(scope: {
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<Map<string, string[]>> {
  const { data, error } = await scope.supabase
    .from("ai_agent_pipelines")
    .select("config_id, pipeline_id")
    .eq("workspace_id", scope.workspaceId);

  const porConfig = new Map<string, string[]>();
  if (error) {
    console.error("[agentes] sin la tabla de embudos, contestan en todos:", error.message);
    return porConfig;
  }

  for (const fila of (data ?? []) as { config_id: string; pipeline_id: string }[]) {
    porConfig.set(fila.config_id, [...(porConfig.get(fila.config_id) ?? []), fila.pipeline_id]);
  }
  return porConfig;
}

/**
 * Las reglas de movimiento de cada agente, en una sola consulta.
 *
 * Igual que los embudos: sin la migración corrida la tabla no existe y se
 * devuelven listas vacías, que es exactamente lo que el agente va a leer del
 * otro lado. El panel se dibuja igual y la sección aparece vacía con el aviso
 * de qué migración falta.
 */
async function movimientosDeLosAgentes(scope: {
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<Map<string, ReglaDeMovimiento[]>> {
  const { data, error } = await scope.supabase
    .from("ai_agent_stage_moves")
    .select("id, config_id, stage_id, desde_stage_id, criterio, activo")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: true });

  const porConfig = new Map<string, ReglaDeMovimiento[]>();
  if (error) {
    console.error("[agentes] sin la tabla de movimientos, no mueven tarjetas:", error.message);
    return porConfig;
  }

  for (const fila of (data ?? []) as {
    id: string;
    config_id: string;
    stage_id: string;
    desde_stage_id: string | null;
    criterio: string;
    activo: boolean | null;
  }[]) {
    porConfig.set(fila.config_id, [
      ...(porConfig.get(fila.config_id) ?? []),
      {
        id: fila.id,
        stageId: fila.stage_id,
        desdeStageId: fila.desde_stage_id ?? null,
        criterio: fila.criterio,
        activo: fila.activo !== false,
      },
    ]);
  }
  return porConfig;
}

/**
 * Guarda la config de un canal. `unique (workspace_id, channel)` evita duplicados.
 */
export async function saveAgentConfig(input: {
  channel: Channel;
  systemPrompt: string;
  modelVersion: string;
  tools: AgentConfig["tools"];
  replyDelaySeconds: AgentConfig["replyDelaySeconds"];
  pipelineIds: string[];
  movimientos: ReglaDeMovimiento[];
  pauseOnHumanReply: boolean;
  horario: HorarioDelAgente;
  avisoFueraDeHorario: string;
}): Promise<ActionResult> {
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: "Canal inválido." };

  // Se valida acá y no sólo en el check de Postgres: el error de la base habla
  // de constraints y de nombres de columna, y lo que hay que decirle a alguien
  // que puso 0 es por qué el 0 rompe el agrupamiento de la ráfaga.
  const demoraInvalida = errorDeDemora(input.replyDelaySeconds);
  if (demoraInvalida) return { ok: false, error: demoraInvalida };

  const promptInvalido = errorDePrompt(input.systemPrompt);
  if (promptInvalido) return { ok: false, error: promptInvalido };

  const horarioInvalido = errorDeHorario(input.horario);
  if (horarioInvalido) return { ok: false, error: horarioInvalido };

  const aviso = input.avisoFueraDeHorario.trim();
  const avisoInvalido = errorDeAviso(aviso);
  if (avisoInvalido) return { ok: false, error: avisoInvalido };

  const movimientosInvalidos = errorDeLasReglas(input.movimientos);
  if (movimientosInvalidos) return { ok: false, error: movimientosInvalidos };

  const scope = await requirePermission("gestionar_agentes");
  if (!scope.ok) return { ok: false, error: scope.error };

  // Los ids llegan del navegador: un embudo ajeno dejaría al agente contestando
  // sobre leads de otro workspace.
  const embudos = [...new Set(input.pipelineIds.filter(Boolean))];
  if (embudos.length > 0) {
    const { data: propios } = await scope.supabase
      .from("pipelines")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .in("id", embudos);

    if ((propios ?? []).length !== embudos.length) {
      return { ok: false, error: "Alguno de los embudos elegidos no existe en tu workspace." };
    }
  }

  const { data: guardada, error } = await scope.supabase
    .from("ai_agent_configs")
    .upsert(
      {
        workspace_id: scope.workspaceId,
        channel: input.channel,
        // Recortado: un espacio de más al final no tiene que dejar el panel
        // "sin guardar" para siempre.
        system_prompt: input.systemPrompt.trim(),
        model_version: input.modelVersion,
        tools_config: sanitizeTools(input.tools),
        reply_delay_seconds: input.replyDelaySeconds,
        pause_on_human_reply: input.pauseOnHumanReply,
        // Los días se ordenan y se limpian de repetidos antes de guardar: así la
        // fila dice lo mismo que el panel y el check no rechaza un día de más.
        dias: [...new Set(input.horario.dias)].sort((a, b) => a - b),
        // Las franjas también se guardan ordenadas por hora de apertura: es como
        // se leen, y deja la fila igual que la línea que muestra el panel.
        franjas: franjasDelHorario(input.horario),
        horario_excluye: input.horario.excluye,
        // Se guarda recortado: el aviso se compara con el hilo para no repetirlo,
        // y un espacio de más al final lo volvería un texto distinto.
        aviso_fuera_de_horario: aviso,
      },
      { onConflict: "workspace_id,channel" },
    )
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: errorAlGuardarElAgente(error.message) };
  if (!guardada?.id) return { ok: false, error: "No se pudo guardar la configuración." };

  const problema = await guardarEmbudosDelAgente(scope, guardada.id, embudos);
  if (problema) return { ok: false, error: problema };

  const problemaDeMovimientos = await guardarMovimientosDelAgente(
    scope,
    guardada.id,
    input.movimientos,
  );
  if (problemaDeMovimientos) return { ok: false, error: problemaDeMovimientos };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Reemplaza las reglas de movimiento de un agente.
 *
 * Se borra y se inserta de nuevo, igual que los embudos: son un puñado de filas
 * y un diferencial mal hecho deja al agente moviendo tarjetas con un criterio
 * que alguien ya borró de la pantalla.
 *
 * El borrado va primero porque sin transacción desde PostgREST hay que elegir
 * qué estado queda si falla la mitad. Acá el lado seguro es el contrario que en
 * los embudos: cero reglas significa "no mueve nada", así que una falla entre
 * medio deja al agente quieto y no moviendo con reglas a medias.
 */
async function guardarMovimientosDelAgente(
  scope: { supabase: SupabaseClient; workspaceId: string },
  configId: string,
  reglas: ReglaDeMovimiento[],
): Promise<string | null> {
  // Los ids de etapa llegan del navegador. Una etapa ajena dejaría al agente
  // moviendo tarjetas en el embudo de otro workspace.
  const etapas = [
    ...new Set(reglas.flatMap((regla) => [regla.stageId, regla.desdeStageId].filter(Boolean))),
  ] as string[];

  if (etapas.length > 0) {
    const { data: propias } = await scope.supabase
      .from("pipeline_stages")
      .select("id, kind")
      .eq("workspace_id", scope.workspaceId)
      .in("id", etapas);

    const encontradas = (propias ?? []) as { id: string; kind: string }[];
    if (encontradas.length !== etapas.length) {
      return "Alguna de las columnas elegidas no existe en tu workspace.";
    }

    // El trigger de la base también lo rechaza; acá el mensaje explica por qué.
    const cerrada = encontradas.find(
      (etapa) => etapa.kind !== "open" && reglas.some((regla) => regla.stageId === etapa.id),
    );
    if (cerrada) {
      return "El agente no puede mover a Ganado ni a Perdido: de esas columnas cuelgan las métricas y la conversión de Meta.";
    }
  }

  const { error: borrado } = await scope.supabase
    .from("ai_agent_stage_moves")
    .delete()
    .eq("config_id", configId);

  if (borrado) {
    return `No se pudieron guardar los movimientos del agente: ${borrado.message}. ¿Corriste la migración 202610030001?`;
  }
  if (reglas.length === 0) return null;

  const { error } = await scope.supabase.from("ai_agent_stage_moves").insert(
    reglas.map((regla) => ({
      workspace_id: scope.workspaceId,
      config_id: configId,
      stage_id: regla.stageId,
      desde_stage_id: regla.desdeStageId,
      criterio: regla.criterio.trim(),
      activo: regla.activo,
    })),
  );

  return error ? `No se pudieron guardar los movimientos del agente: ${error.message}` : null;
}

/** Lo que la prueba en seco devuelve al panel. */
export type PruebaDeMovimiento =
  | { ok: true; movimiento: Clasificacion | null; evaluadas: ReglaConNombre[] }
  | { ok: false; error: string };

/**
 * Prueba las reglas contra una conversación pegada, sin mover ninguna tarjeta.
 *
 * Es la diferencia entre ajustar un criterio en tres intentos de treinta
 * segundos y esperar dos días a ver qué pasó con leads de verdad. Usa la misma
 * función que la corrida real (`clasificar`), así que lo que muestra acá es lo
 * que va a hacer allá; lo único que no hace es escribir.
 *
 * Las reglas se leen de la base y no del borrador del panel a propósito: lo que
 * se prueba es lo que está guardado. Probar un borrador daría un resultado que
 * no le corresponde a ningún lead.
 */
export async function probarMovimientoDelAgente(input: {
  channel: Channel;
  /** La columna en la que estaría la tarjeta. Es lo que decide qué reglas aplican. */
  stageId: string;
  conversacion: string;
}): Promise<PruebaDeMovimiento> {
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: "Canal inválido." };

  const conversacion = input.conversacion.trim();
  if (!conversacion) return { ok: false, error: "Pegá una conversación para probar." };

  const scope = await requirePermission("gestionar_agentes");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: config } = await scope.supabase
    .from("ai_agent_configs")
    .select("id, model_version")
    .eq("workspace_id", scope.workspaceId)
    .eq("channel", input.channel)
    .maybeSingle();

  const fila = config as { id?: string; model_version?: string | null } | null;
  if (!fila?.id) {
    return { ok: false, error: "Guardá la configuración del agente antes de probar." };
  }

  const { data: etapa } = await scope.supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", input.stageId)
    .maybeSingle();

  if (!etapa) return { ok: false, error: "Esa columna no existe en tu workspace." };

  const reglas = reglasAplicables(
    await leerReglas(scope.supabase, scope.workspaceId, fila.id),
    input.stageId,
  );

  if (reglas.length === 0) {
    return { ok: true, movimiento: null, evaluadas: [] };
  }

  const nombres = await nombresDeEtapas(
    scope,
    reglas.map((regla) => regla.stageId),
  );

  const evaluadas: ReglaConNombre[] = reglas.flatMap((regla) => {
    const nombre = nombres.get(regla.stageId);
    return nombre ? [{ stageId: regla.stageId, nombre, criterio: regla.criterio }] : [];
  });

  const decidido = await clasificar({
    model: fila.model_version || "gpt-5",
    reglas: evaluadas,
    mensajes: leerConversacionPegada(conversacion),
  });

  if (!decidido.ok) return { ok: false, error: decidido.error };
  return { ok: true, movimiento: decidido.clasificacion, evaluadas };
}

/** Los nombres de un puñado de etapas, por id. */
async function nombresDeEtapas(
  scope: { supabase: SupabaseClient; workspaceId: string },
  ids: string[],
): Promise<Map<string, string>> {
  const { data } = await scope.supabase
    .from("pipeline_stages")
    .select("id, name")
    .eq("workspace_id", scope.workspaceId)
    .in("id", ids);

  return new Map(((data ?? []) as { id: string; name: string }[]).map((fila) => [fila.id, fila.name]));
}

/**
 * Lee la conversación que alguien pegó en el cuadro de prueba.
 *
 * Un renglón por mensaje. Si empieza con "Vendedor:" o "Agente:" es del lado del
 * equipo; cualquier otra cosa —con prefijo o sin él— es de la persona, que es el
 * default conveniente: lo que se pega casi siempre es lo que dijo el lead, y
 * atribuírselo al vendedor por error invertiría la prueba entera.
 */
function leerConversacionPegada(texto: string): { deLaPersona: boolean; texto: string }[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const match = /^(vendedor|agente|yo)\s*:\s*(.*)$/i.exec(linea);
      if (match) return { deLaPersona: false, texto: match[2] };

      const persona = /^(persona|lead|cliente)\s*:\s*(.*)$/i.exec(linea);
      return { deLaPersona: true, texto: persona ? persona[2] : linea };
    })
    .filter((mensaje) => Boolean(mensaje.texto));
}

/**
 * El error de Postgres, con la migración que falta cuando eso es lo que pasa.
 *
 * Guardar escribe columnas de tres migraciones distintas, así que un
 * `column "hora_desde" does not exist` es un despliegue a medias y no un dato
 * mal cargado. Sin la pista, el mensaje que llega al panel es un error de base
 * de datos que nadie sabe para dónde empujar.
 */
function errorAlGuardarElAgente(mensaje: string): string {
  const columnas = ["dias", "franjas", "horario_excluye", "aviso_fuera_de_horario"];
  const falta = columnas.some((columna) => mensaje.includes(columna));
  return falta
    ? `${mensaje}. ¿Corriste las cuatro migraciones del horario, de la 202610010001 a la 202610010004?`
    : mensaje;
}

/**
 * Reemplaza los embudos elegidos de un agente.
 *
 * Se borra y se vuelve a insertar en vez de calcular el diferencial: son un
 * puñado de filas, y un diferencial mal hecho deja al agente contestando donde
 * no debe, que es peor que un par de escrituras de más.
 *
 * Sin transacción desde PostgREST, el borrado va primero: un fallo entremedio
 * deja al agente contestando en todos los embudos, que es el estado abierto y
 * no uno donde se quede mudo sin motivo.
 */
async function guardarEmbudosDelAgente(
  scope: { supabase: SupabaseClient; workspaceId: string },
  configId: string,
  pipelineIds: string[],
): Promise<string | null> {
  const { error: borrado } = await scope.supabase
    .from("ai_agent_pipelines")
    .delete()
    .eq("config_id", configId);

  if (borrado) {
    return `No se pudieron guardar los embudos del agente: ${borrado.message}. ¿Corriste la migración 202609240003?`;
  }
  if (pipelineIds.length === 0) return null;

  const { error } = await scope.supabase.from("ai_agent_pipelines").insert(
    pipelineIds.map((pipelineId) => ({
      workspace_id: scope.workspaceId,
      config_id: configId,
      pipeline_id: pipelineId,
    })),
  );

  return error ? `No se pudieron guardar los embudos del agente: ${error.message}` : null;
}

/**
 * Prende o apaga el agente de un canal para todo el workspace.
 *
 * Se hace en dos pasos y no con un upsert a propósito: el upsert manda el
 * cuerpo completo y podría pisar las instrucciones ya guardadas con los
 * valores por defecto de la tabla. Acá el update sólo toca `enabled`, y el
 * insert corre únicamente si el canal todavía no tenía fila.
 */
export async function setAgentEnabled(input: {
  channel: Channel;
  enabled: boolean;
}): Promise<ActionResult> {
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: "Canal inválido." };

  const scope = await requirePermission("gestionar_agentes");
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data, error } = await scope.supabase
    .from("ai_agent_configs")
    .update({ enabled: input.enabled })
    .eq("workspace_id", scope.workspaceId)
    .eq("channel", input.channel)
    .select("id");

  if (error) return { ok: false, error: error.message };

  if ((data ?? []).length === 0) {
    const { error: insertError } = await scope.supabase.from("ai_agent_configs").insert({
      workspace_id: scope.workspaceId,
      channel: input.channel,
      enabled: input.enabled,
    });
    if (insertError) return { ok: false, error: insertError.message };
  }

  revalidatePath("/");
  return { ok: true };
}

/** Modelos de chat de la cuenta, para el desplegable de Agentes IA. */
export async function loadChatModels(): Promise<
  { ok: true; models: string[] } | { ok: false; error: string }
> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };
  return listChatModelsServer();
}

/**
 * Redacta una respuesta para un chat y la devuelve sin enviarla.
 *
 * Es el mismo motor que usa la respuesta automática, pero con el freno puesto:
 * acá el texto vuelve a la caja para que alguien lo lea y lo edite. Por eso no
 * mira `bot_enabled` ni el interruptor del canal — pedirla es un acto
 * deliberado, no algo que dispare un mensaje entrante.
 */
export async function suggestReply(input: {
  conversationId: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: conversation } = await scope.supabase
    .from("conversations")
    .select("id, channel, contacts(name, email, phone, tags)")
    .eq("id", input.conversationId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (!conversation) return { ok: false, error: "No se encontró la conversación." };

  // PostgREST entrega la relación "a uno" como objeto o como arreglo de uno,
  // según la versión.
  const related = Array.isArray(conversation.contacts)
    ? conversation.contacts[0]
    : conversation.contacts;

  const { data: config } = await scope.supabase
    .from("ai_agent_configs")
    .select("model_version, system_prompt")
    .eq("workspace_id", scope.workspaceId)
    .eq("channel", conversation.channel)
    .maybeSingle();

  const { data: history } = await scope.supabase
    .from("messages")
    .select("sender_type, content")
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Vienen del más nuevo al más viejo para que el límite recorte lo antiguo;
  // el modelo los necesita en orden cronológico.
  const turns: ChatTurn[] = [
    {
      role: "system",
      content:
        // El canal sin instrucciones cargadas igual redacta: pedir una
        // sugerencia es un acto deliberado de alguien del equipo, que la va a
        // leer antes de mandarla. Lo que no puede es salir en blanco.
        ((config?.system_prompt ?? "").trim() ||
          "Sos quien atiende a los clientes de esta empresa. Respondé en español rioplatense, breve y cordial.") +
        fichaDelLead(related ?? {}) +
        INSTRUCCIONES_DE_ADJUNTOS,
    },
    ...(history ?? [])
      .reverse()
      .filter((row) => typeof row.content === "string" && row.content.trim())
      .map((row) => ({
        role: row.sender_type === "contact" ? ("user" as const) : ("assistant" as const),
        content: row.content as string,
      })),
  ];

  if (turns.length === 1) return { ok: false, error: "No hay mensajes todavía para responder." };

  const completion = await completeChatServer({
    model: config?.model_version || "gpt-5",
    messages: turns,
  });

  if (!completion.ok) return completion;

  // Acá no se le explicaron las marcas —la sugerencia no deriva ni anota—, pero
  // el prompt las nombra y el modelo puede escribirlas igual. Van a una caja de
  // texto que alguien manda con un clic, así que se sacan: un "[DERIVAR]"
  // suelto llegándole al cliente es la forma más tonta de romper la conversación.
  return { ok: true, text: separarMarcas(completion.text).texto };
}

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

/**
 * Trae de Zernio las conversaciones que ya existen.
 *
 * Es idempotente: correrla dos veces no duplica nada, porque `zernio_chat_id`
 * y `zernio_message_id` son únicos.
 */
export async function importZernioConversations(): Promise<ImportResult> {
  const scope = await requirePermission("crear_contactos");
  if (!scope.ok) return { ok: false, error: scope.error };

  const result = await importFromZernio(scope.supabase, scope.workspaceId);
  if (!result.ok) return result;

  revalidatePath("/");
  return { ok: true, summary: result.summary };
}

// ---------------------------------------------------------------------------
// Usuarios del workspace
//
// No hay pantalla de usuarios: la cuenta se crea en Supabase y la primera vez
// que entra queda como administradora. Acá queda lo que usan las demás
// secciones: la lista para elegir responsable y el cambio de contraseña propia.
// ---------------------------------------------------------------------------

/**
 * El mail de cada usuario vive en `auth.users`, que no se puede leer con la
 * sesión del navegador ni con RLS. La única forma de resolverlo es el cliente
 * de servicio, y por eso todo lo de acá empieza comprobando que seas
 * administrador antes de tocarlo.
 */
async function emailsById(): Promise<Map<string, string>> {
  const { data } = await getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 200 });
  return new Map((data?.users ?? []).map((user) => [user.id, user.email ?? ""]));
}

/**
 * Cambia la contraseña propia.
 *
 * Va por el cliente con la sesión del usuario y no por la service role key: así
 * sólo puede tocar su propia cuenta, sin importar qué llegue en el pedido.
 */
export async function changeOwnPassword(input: { password: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const floja = errorDeContrasena(input.password ?? "");
  if (floja) return { ok: false, error: floja };

  const { error } = await scope.supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: error.message };

  return { ok: true, warning: "Listo, ya podés entrar con la contraseña nueva." };
}

export type WorkspaceUser = { userId: string; email: string; role: MemberRole };

/**
 * Los miembros del workspace con su mail, para el selector de responsable.
 *
 * La ve cualquier miembro: si un operario tiene un lead asignado necesita poder
 * leer de quién es, y los mails de los compañeros no son un dato reservado.
 */
export async function loadWorkspaceUsers(): Promise<
  { ok: true; users: WorkspaceUser[] } | { ok: false; error: string }
> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const [{ data, error }, emails] = await Promise.all([
    scope.supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: true }),
    emailsById(),
  ]);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    users: (data ?? []).map((row) => ({
      userId: row.user_id,
      email: emails.get(row.user_id) ?? "Usuario sin mail",
      role: row.role === "owner" || row.role === "admin" ? row.role : "agent",
    })),
  };
}

/**
 * Cambia el responsable de un lead.
 *
 * Es la acción con más peso del módulo: asignar un lead es lo que decide si un
 * operario lo ve o no. Pasar `null` lo devuelve a la bolsa de sin asignar.
 */
export async function assignLead(input: {
  contactId: string;
  userId: string | null;
}): Promise<ActionResult> {
  const scope = await requirePermission("asignar_leads");
  if (!scope.ok) return { ok: false, error: scope.error };

  if (input.userId) {
    const { data } = await scope.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (!data) return { ok: false, error: "Esa persona no es parte del workspace." };
  }

  const { error } = await scope.supabase
    .from("contacts")
    .update({ assigned_to: input.userId })
    .eq("id", input.contactId)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/* --------------------------------------------------------- descargar la base */

export type ExportResult =
  | { ok: true; nombre: string; csv: string; filas: number; recortado: boolean }
  | { ok: false; error: string };

/**
 * La base del workspace en un CSV para abrir en Excel.
 *
 * Sólo administradores: la base entera —con teléfonos, mails y el historial de
 * los chats— es el activo del negocio, y un operario con la sesión abierta no
 * tiene por qué poder llevársela en un archivo.
 *
 * El archivo se arma acá y viaja como texto; la descarga la dispara el
 * navegador. No hay un endpoint público con un link: un link se comparte por
 * WhatsApp sin pensarlo, y del otro lado no hay sesión que revisar.
 */
export async function exportTable(input: { tabla: TablaExportable }): Promise<ExportResult> {
  const scope = await requireAdmin("descargar la base");
  if (!scope.ok) return { ok: false, error: scope.error };

  if (!TABLAS.some((tabla) => tabla.clave === input.tabla)) {
    return { ok: false, error: "Esa tabla no existe." };
  }

  const { data: workspace } = await scope.supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", scope.workspaceId)
    .maybeSingle();

  try {
    const resultado = await exportar(scope.supabase, {
      tabla: input.tabla,
      workspaceId: scope.workspaceId,
      timezone: safeTimeZone(workspace?.timezone as string | null),
      emails: await emailsById(),
    });

    return { ok: true, ...resultado };
  } catch (error) {
    console.error("[exportar] no se pudo armar el archivo:", error);
    return { ok: false, error: "No se pudo armar el archivo. Probá de nuevo." };
  }
}

/* ------------------------------------------------------------ cargar la base */

export type ImportContactsResult =
  | { ok: true; nuevos: number; actualizados: number; salteados: number }
  | { ok: false; error: string };

/**
 * Carga contactos desde un archivo.
 *
 * El archivo se lee en la pantalla y acá llegan las filas ya limpias, pero se
 * valida todo de nuevo: la pantalla evita el error, esto evita el dato roto.
 *
 * `simular` es la vista previa. Hace exactamente las mismas cuentas —incluido
 * el cruce contra lo que ya está en la base— y no escribe nada, así lo que dice
 * el "vas a cargar 120 nuevos y actualizar 8" es lo que realmente va a pasar y
 * no una estimación aparte que puede no coincidir.
 *
 * Los contactos importados **no disparan automatizaciones**. Una importación de
 * cientos de filas con una automatización de "lead nuevo" prendida es una
 * ráfaga de mensajes a gente que no escribió nunca, y eso no se deshace.
 */
export async function importContacts(input: {
  filas: FilaImportada[];
  stageId: string;
  /** Qué hacer con los que ya están: completarlos o dejarlos como están. */
  actualizarExistentes: boolean;
  simular: boolean;
}): Promise<ImportContactsResult> {
  const scope = await requireAdmin("cargar la base");
  if (!scope.ok) return { ok: false, error: scope.error };

  const filas = (input.filas ?? []).filter((fila) => fila && typeof fila.nombre === "string");
  if (filas.length === 0) return { ok: false, error: "El archivo no tiene contactos para cargar." };
  if (filas.length > MAX_IMPORTADAS) {
    return {
      ok: false,
      error: `Son demasiados de una vez: el tope es ${MAX_IMPORTADAS} contactos por archivo.`,
    };
  }

  if (!(await stageBelongsToWorkspace(scope, input.stageId))) {
    return { ok: false, error: "Esa columna del embudo no existe." };
  }

  // Todo lo que ya está, de una sola consulta: cruzar fila por fila sería una
  // consulta por contacto del archivo.
  const { data: existentes, error: errorExistentes } = await scope.supabase
    .from("contacts")
    .select("id, phone, email, tags, name")
    .eq("workspace_id", scope.workspaceId)
    .limit(20000);

  if (errorExistentes) return { ok: false, error: errorExistentes.message };

  const porTelefono = new Map<string, Record<string, unknown>>();
  const porEmail = new Map<string, Record<string, unknown>>();
  for (const fila of existentes ?? []) {
    const telefono = normalizarTelefono(fila.phone as string | null);
    if (telefono && !porTelefono.has(telefono)) porTelefono.set(telefono, fila);
    const email = (fila.email as string | null)?.trim().toLowerCase();
    if (email && !porEmail.has(email)) porEmail.set(email, fila);
  }

  const nuevos: FilaImportada[] = [];
  const repetidos: { fila: FilaImportada; actual: Record<string, unknown> }[] = [];

  for (const fila of filas) {
    const actual =
      (fila.telefono ? porTelefono.get(fila.telefono) : undefined) ??
      (fila.email ? porEmail.get(fila.email) : undefined);

    if (actual) repetidos.push({ fila, actual });
    else nuevos.push(fila);
  }

  if (input.simular) {
    return {
      ok: true,
      nuevos: nuevos.length,
      actualizados: input.actualizarExistentes ? repetidos.length : 0,
      salteados: input.actualizarExistentes ? 0 : repetidos.length,
    };
  }

  // De a tandas: un insert de dos mil filas en una sola llamada es una consulta
  // enorme que, si falla, no deja saber por dónde iba.
  const TANDA = 200;
  let creados = 0;

  for (let desde = 0; desde < nuevos.length; desde += TANDA) {
    const tanda = nuevos.slice(desde, desde + TANDA);

    const { data: insertados, error } = await scope.supabase
      .from("contacts")
      .insert(
        tanda.map((fila) => ({
          workspace_id: scope.workspaceId,
          name: fila.nombre,
          phone: fila.telefono,
          email: fila.email,
          tags: fila.etiquetas,
        })),
      )
      .select("id");

    if (error) {
      revalidatePath("/");
      return {
        ok: false,
        error: `Se cargaron ${creados} contactos y ahí falló: ${error.message}`,
      };
    }

    creados += insertados?.length ?? 0;

    // La tarjeta del embudo va después del contacto y no en la misma
    // operación: si falla, el contacto igual quedó cargado y la tarjeta se
    // puede crear a mano, que es preferible a perder la fila entera.
    const { error: errorEmbudo } = await scope.supabase.from("opportunities").insert(
      (insertados ?? []).map((contacto) => ({
        workspace_id: scope.workspaceId,
        contact_id: contacto.id,
        stage_id: input.stageId,
        value: 0,
      })),
    );

    if (errorEmbudo) {
      console.error("[importar] contactos cargados sin tarjeta en el embudo:", errorEmbudo.message);
    }
  }

  let actualizados = 0;

  if (input.actualizarExistentes) {
    const PARALELAS = 25;

    for (let desde = 0; desde < repetidos.length; desde += PARALELAS) {
      const tanda = repetidos.slice(desde, desde + PARALELAS);

      const hechas = await Promise.all(
        tanda.map(async ({ fila, actual }) => {
          const cambios = camposACompletar(fila, actual);
          if (!cambios) return false;

          const { error } = await scope.supabase
            .from("contacts")
            .update(cambios)
            .eq("id", actual.id as string)
            .eq("workspace_id", scope.workspaceId);

          return !error;
        }),
      );

      actualizados += hechas.filter(Boolean).length;
    }
  }

  revalidatePath("/");

  return {
    ok: true,
    nuevos: creados,
    actualizados,
    salteados: input.actualizarExistentes ? repetidos.length - actualizados : repetidos.length,
  };
}

/**
 * Qué se le completa a un contacto que ya existía.
 *
 * El archivo completa huecos, no pisa lo que hay: el CRM es donde alguien
 * atendió a esa persona y corrigió su nombre, y una planilla vieja no tiene por
 * qué ganarle a eso. Las etiquetas son la excepción y se suman, porque son
 * justamente para clasificar en tandas.
 *
 * Devuelve `null` cuando no hay nada que cambiar, así no se gasta un update.
 */
function camposACompletar(
  fila: FilaImportada,
  actual: Record<string, unknown>,
): Record<string, unknown> | null {
  const cambios: Record<string, unknown> = {};

  if (fila.telefono && !(actual.phone as string | null)?.trim()) cambios.phone = fila.telefono;
  if (fila.email && !(actual.email as string | null)?.trim()) cambios.email = fila.email;

  if (fila.etiquetas.length > 0) {
    const actuales = Array.isArray(actual.tags) ? (actual.tags as string[]) : [];
    const juntas = [...new Set([...actuales, ...fila.etiquetas])];
    if (juntas.length !== actuales.length) cambios.tags = juntas;
  }

  return Object.keys(cambios).length > 0 ? cambios : null;
}

/** Cuántos turnos de la charla viajan al modelo. Alcanza para repreguntar. */
const ASISTENTE_HISTORIA = 12;

/** Tope de lo que se acepta por pregunta: una consulta, no un documento pegado. */
const ASISTENTE_MAX_CHARS = 2_000;

export type AsistenteTurno = { role: "user" | "assistant"; content: string };

export type AsistenteResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * El asistente interno del CRM.
 *
 * Contesta preguntas sobre los datos del workspace consultando herramientas.
 * Lo que hace que esto sea seguro está en una sola línea: `scope.supabase` es
 * el cliente de la sesión de quien pregunta, no el de servicio. Las políticas
 * de `202608170007_roles_y_permisos.sql` aplican solas, así que el asistente
 * no puede contar nada que esa persona no vería abriendo la pantalla.
 *
 * No guarda la conversación en ningún lado: la historia llega desde el
 * navegador y se descarta al responder.
 */
export async function preguntarAlAsistente(input: {
  mensajes: AsistenteTurno[];
}): Promise<AsistenteResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const mensajes = (input.mensajes ?? [])
    .filter((turno) => typeof turno?.content === "string" && turno.content.trim())
    .slice(-ASISTENTE_HISTORIA)
    .map((turno) => ({
      role: turno.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: turno.content.trim().slice(0, ASISTENTE_MAX_CHARS),
    }));

  if (mensajes.length === 0) return { ok: false, error: "Escribí una pregunta." };

  const config = await leerConfigAsistente(scope.supabase, scope.workspaceId);
  if (!config.enabled) {
    return { ok: false, error: "El asistente está apagado. Lo prende un administrador en Configuración." };
  }

  const timezone = safeTimeZone(scope.timezone);

  const turns: ChatTurn[] = [
    {
      role: "system",
      content: instruccionesDelAsistente({
        workspaceName: scope.workspaceName,
        timezone,
        rol: ROLE_LABELS[scope.role],
      }),
    },
    ...mensajes,
  ];

  return completeWithToolsServer({
    model: config.model,
    messages: turns,
    herramientas: HERRAMIENTAS,
    ejecutar: (llamada) =>
      ejecutarHerramienta(
        { supabase: scope.supabase, workspaceId: scope.workspaceId, timezone },
        llamada,
      ),
  });
}

export type AsistenteConfig = { enabled: boolean; model: string };

/**
 * Lee el interruptor y el modelo, tolerando la migración sin correr.
 *
 * Pedir una columna que no existe hace fallar el select entero, y eso dejaría
 * al asistente mudo en una instancia recién desplegada. Con el respaldo, anda
 * con los valores por defecto hasta que se corra `202609190003`.
 */
async function leerConfigAsistente(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AsistenteConfig> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("assistant_enabled, assistant_model")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("[asistente] sin las columnas de configuración:", error.message);
    return { enabled: true, model: "gpt-5" };
  }

  return {
    enabled: data?.assistant_enabled ?? true,
    model: (data?.assistant_model as string | null)?.trim() || "gpt-5",
  };
}

/** La config del asistente, para la pantalla de Configuración. */
export async function loadAssistantConfig(): Promise<
  { ok: true; config: AsistenteConfig } | { ok: false; error: string }
> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };
  return { ok: true, config: await leerConfigAsistente(scope.supabase, scope.workspaceId) };
}

/** Guarda el interruptor y el modelo. Sólo un administrador. */
export async function saveAssistantConfig(input: AsistenteConfig): Promise<ActionResult> {
  const scope = await requireAdmin("cambiar la configuración del asistente");
  if (!scope.ok) return { ok: false, error: scope.error };

  const model = input.model?.trim();
  if (!model) return { ok: false, error: "Elegí un modelo." };

  const { error } = await scope.supabase
    .from("workspaces")
    .update({ assistant_enabled: input.enabled, assistant_model: model })
    .eq("id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Cierra la sesión y limpia las cookies de auth. */
export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/");
}

/**
 * Saca una cita de la campana.
 *
 * El equivalente de `markConversationAttended` para las reservas: no cambia
 * nada de la cita, sólo anota que alguien ya la vio. Sin esto la campana
 * mostraría para siempre la misma reserva.
 */
export async function markAppointmentSeen(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("appointments")
    .update({ vista: true })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Borra una cita del CRM.
 *
 * No toca Google Calendar, y esa es la diferencia con cancelarla: cancelar es
 * afirmar que la reunión no va a pasar, y desde acá sería mentira porque el
 * evento sigue en el calendario del cliente. Borrar es decir "esto no lo sigo
 * en el CRM", que sí es una decisión de este lado.
 *
 * Se lleva sus recordatorios encolados por la clave foránea, así que no queda
 * ningún aviso apuntando a una cita que ya no existe.
 */
export async function deleteAppointment(input: { id: string }): Promise<ActionResult> {
  const scope = await requirePermission("gestionar_agenda");
  if (!scope.ok) return { ok: false, error: scope.error };

  // Las de Calendar no se borran desde acá, por lo mismo que no se cancelan:
  // el evento sigue en el calendario del cliente. Se comprueba en el servidor
  // y no sólo escondiendo el botón, porque la pantalla no es el candado.
  const { data: cita } = await scope.supabase
    .from("appointments")
    .select("origen")
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (cita?.origen === "calendar") {
    return {
      ok: false,
      error: "Esta cita vino de Google Calendar: cancelala ahí y el CRM se actualiza solo.",
    };
  }

  const { error } = await scope.supabase
    .from("appointments")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/* ================================================================= tareas */

/**
 * Si la hora del aviso ya pasó, el aviso nace dado por salido.
 *
 * Cargar a las 11 una llamada que era a las 10 es anotar algo atrasado a
 * sabiendas: un push de "es la hora" un minuto después no le dice nada nuevo
 * a quien la acaba de escribir.
 */
function avisadaAlGuardar(avisoAt: string | null): string | null {
  if (!avisoAt) return null;
  const ahora = new Date();
  return new Date(avisoAt).getTime() <= ahora.getTime() ? ahora.toISOString() : null;
}

/** El push a quien recibe una tarea, sin hacer esperar al formulario. */
function avisarAsignacion(workspaceId: string, tareaId: string) {
  after(async () => {
    try {
      await avisarTareaAsignada(getSupabaseAdmin(), { workspaceId, tareaId });
    } catch (problema) {
      // La tarea ya quedó guardada y la campana la va a mostrar igual.
      console.error("[tareas] no se pudo avisar la asignación:", problema);
    }
  });
}

export type DatosDeTarea = {
  titulo: string;
  notas?: string;
  tipo?: string;
  /** Instante en ISO: la conversión desde la hora de pared la hace el navegador. */
  venceAt: string;
  /** Cuántos minutos antes avisar. Null es sin aviso. */
  avisoMinutos?: number | null;
  /** Vacío o ausente: quien la crea. */
  asignadaA?: string | null;
  contactId?: string | null;
};

/**
 * Programa una tarea.
 *
 * Para uno mismo no hace falta ningún permiso: es la razón de ser del módulo.
 * Para otra persona sí, `asignar_tareas`. La base lo vuelve a controlar en su
 * guarda; esto existe para contestarlo en castellano antes de llegar ahí.
 */
export async function createTask(input: DatosDeTarea): Promise<ActionResult> {
  const validada = validarTarea(input);
  if (!validada.ok) return { ok: false, error: validada.error };
  const { tarea } = validada;

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const asignadaA = input.asignadaA || scope.userId;
  const paraOtro = asignadaA !== scope.userId;
  if (paraOtro && !can(scope.role, scope.permissions, "asignar_tareas")) {
    return {
      ok: false,
      error: "No tenés permiso para darle tareas a otra persona. Pedíselo a un administrador.",
    };
  }

  const { data, error } = await scope.supabase
    .from("tareas")
    .insert({
      workspace_id: scope.workspaceId,
      titulo: tarea.titulo,
      notas: tarea.notas,
      tipo: tarea.tipo,
      vence_at: tarea.venceAt,
      aviso_at: tarea.avisoAt,
      avisada_at: avisadaAlGuardar(tarea.avisoAt),
      asignada_a: asignadaA,
      creada_por: scope.userId,
      contact_id: input.contactId || null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: errorDeTarea(error.message) };

  if (paraOtro) avisarAsignacion(scope.workspaceId, data.id);

  revalidatePath("/");
  return { ok: true };
}

const SIN_PERMISO_PARA_CAMBIAR_LA_TAREA =
  "Sólo quien la tiene, quien la creó o un administrador puede cambiarla.";

const mismoInstante = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** Cambia todo lo que se carga en el formulario de una tarea. */
export async function updateTask(input: DatosDeTarea & { id: string }): Promise<ActionResult> {
  const validada = validarTarea(input);
  if (!validada.ok) return { ok: false, error: validada.error };
  const { tarea } = validada;

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data: actual } = await scope.supabase
    .from("tareas")
    .select("asignada_a, vence_at, aviso_at")
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (!actual) return { ok: false, error: "Esa tarea ya no existe o no la podés ver." };

  const asignadaA =
    input.asignadaA === undefined ? actual.asignada_a : input.asignadaA || scope.userId;
  const cambiaDeManos = asignadaA !== actual.asignada_a;
  if (
    cambiaDeManos &&
    asignadaA !== scope.userId &&
    !can(scope.role, scope.permissions, "asignar_tareas")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para darle tareas a otra persona. Pedíselo a un administrador.",
    };
  }

  const cambios: Record<string, unknown> = {
    titulo: tarea.titulo,
    notas: tarea.notas,
    tipo: tarea.tipo,
    vence_at: tarea.venceAt,
    aviso_at: tarea.avisoAt,
    asignada_a: asignadaA,
  };
  if (input.contactId !== undefined) cambios.contact_id = input.contactId || null;

  // El aviso se vuelve a armar sólo si cambió la hora: reescribir el título de
  // una tarea que ya avisó no tiene por qué volver a hacer sonar el teléfono.
  if (
    !mismoInstante(actual.vence_at, tarea.venceAt) ||
    !mismoInstante(actual.aviso_at, tarea.avisoAt)
  ) {
    cambios.avisada_at = avisadaAlGuardar(tarea.avisoAt);
  }

  const { data, error } = await scope.supabase
    .from("tareas")
    .update(cambios)
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .select("id");

  if (error) return { ok: false, error: errorDeTarea(error.message) };
  if (!data?.length) {
    return { ok: false, error: SIN_PERMISO_PARA_CAMBIAR_LA_TAREA };
  }

  if (cambiaDeManos && asignadaA && asignadaA !== scope.userId) {
    avisarAsignacion(scope.workspaceId, input.id);
  }

  revalidatePath("/");
  return { ok: true };
}

/** Marca una tarea como hecha, cancelada o de vuelta pendiente. */
export async function setTaskStatus(input: {
  id: string;
  estado: EstadoDeTarea;
}): Promise<ActionResult> {
  if (!esEstadoDeTarea(input.estado)) return { ok: false, error: "Ese estado no existe." };

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data, error } = await scope.supabase
    .from("tareas")
    .update({ estado: input.estado })
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .select("id");

  if (error) return { ok: false, error: errorDeTarea(error.message) };
  if (!data?.length) {
    return { ok: false, error: SIN_PERMISO_PARA_CAMBIAR_LA_TAREA };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Borra una tarea.
 *
 * Sólo quien la creó o un administrador: quien la recibió la puede cancelar,
 * que deja rastro, pero no hacerla desaparecer.
 */
export async function deleteTask(input: { id: string }): Promise<ActionResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { data, error } = await scope.supabase
    .from("tareas")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", scope.workspaceId)
    .select("id");

  if (error) return { ok: false, error: errorDeTarea(error.message) };
  if (!data?.length) {
    return {
      ok: false,
      error: "Sólo quien la creó o un administrador puede borrarla. Podés cancelarla.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Las tareas que te pasaron ya las viste: salen de la campana.
 *
 * Varias de una vez porque se marcan al entrar a la sección, y una consulta por
 * tarea sería un refresco de la página por cada una.
 */
export async function markTasksSeen(input: { ids: string[] }): Promise<ActionResult> {
  const ids = (input.ids ?? []).filter((id) => typeof id === "string" && id).slice(0, 200);
  if (ids.length === 0) return { ok: true };

  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const { error } = await scope.supabase
    .from("tareas")
    .update({ vista: true })
    .in("id", ids)
    .eq("workspace_id", scope.workspaceId)
    .eq("asignada_a", scope.userId);

  if (error) return { ok: false, error: errorDeTarea(error.message) };

  revalidatePath("/");
  return { ok: true };
}

export type TareasResult = { ok: true; tareas: TareaRow[] } | { ok: false; error: string };

/**
 * Trae tareas para una vista.
 *
 *   - `mias`: las que tiene quien mira.
 *   - `delegadas`: las que quien mira le dio a otros, para seguirlas.
 *   - `equipo`: las de todos, con `ver_tareas_del_equipo`. `persona` filtra.
 *   - `lead`: las de un contacto, para su ficha.
 *
 * Qué se ve de cada una lo decide RLS; los filtros sólo ordenan la vista.
 */
export async function listTasks(input: {
  alcance: "mias" | "delegadas" | "equipo" | "lead";
  estado: "pendientes" | "cerradas";
  contactId?: string;
  persona?: string;
}): Promise<TareasResult> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  let consulta = scope.supabase
    .from("tareas")
    .select(CAMPOS_DE_TAREA)
    .eq("workspace_id", scope.workspaceId);

  if (input.alcance === "mias") {
    consulta = consulta.eq("asignada_a", scope.userId);
  } else if (input.alcance === "delegadas") {
    consulta = consulta.eq("creada_por", scope.userId).neq("asignada_a", scope.userId);
  } else if (input.alcance === "equipo") {
    if (!can(scope.role, scope.permissions, "ver_tareas_del_equipo")) {
      return { ok: false, error: "No tenés permiso para ver las tareas del equipo." };
    }
    if (input.persona) consulta = consulta.eq("asignada_a", input.persona);
  } else {
    if (!input.contactId) return { ok: false, error: "Falta el contacto." };
    consulta = consulta.eq("contact_id", input.contactId);
  }

  // Las pendientes, de la más urgente a la menos; las cerradas, las últimas
  // primero y recortadas: el historial entero no le sirve a nadie en una lista.
  consulta =
    input.estado === "pendientes"
      ? consulta.eq("estado", "pendiente").order("vence_at", { ascending: true }).limit(300)
      : consulta.neq("estado", "pendiente").order("updated_at", { ascending: false }).limit(100);

  const { data, error } = await consulta;
  if (error) return { ok: false, error: errorDeTarea(error.message) };

  return {
    ok: true,
    tareas: (data ?? []).map((row) => filaATarea(row as Record<string, unknown>)),
  };
}

export type ContactoEncontrado = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

/**
 * Busca leads por nombre, mail o teléfono, para elegir uno sin recorrer una
 * lista de cientos.
 *
 * Sin texto devuelve los últimos que entraron. Qué leads aparecen lo decide
 * RLS: un operario encuentra los que puede ver y nada más, igual que en
 * Contactos. Los archivados no salen: a un lead archivado no se le programa
 * trabajo.
 */
export async function searchContacts(input: {
  texto: string;
}): Promise<{ ok: true; contactos: ContactoEncontrado[] } | { ok: false; error: string }> {
  const scope = await requireWorkspace();
  if (!scope.ok) return { ok: false, error: scope.error };

  const filtro = filtroDeBusqueda(typeof input.texto === "string" ? input.texto : "");

  let consulta = scope.supabase
    .from("contacts")
    .select("id, name, phone, email")
    .eq("workspace_id", scope.workspaceId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(filtro ? MAX_RESULTADOS : MAX_RECIENTES);

  if (filtro) consulta = consulta.or(filtro);

  const { data, error } = await consulta;
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    contactos: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
    })),
  };
}
