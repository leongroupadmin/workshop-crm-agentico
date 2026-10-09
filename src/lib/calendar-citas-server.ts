/**
 * Los tres flujos de Calendar, del lado de la base.
 *
 * Calendar es la fuente de la verdad; acá sólo se espeja. Lo que hace especiales
 * a los flujos de cambio y de baja es que **no son sobre la cita**: son sobre el
 * recordatorio ya encolado, que vive en `automation_runs`. Una cita puede quedar
 * impecablemente cancelada y el recordatorio salir igual, porque son dos tablas.
 * Esa es la razón de ser de `cancelarRecordatorios`.
 *
 * Corre con la clave de servicio desde el webhook, así que no pasa por RLS: cada
 * consulta filtra por `workspace_id` a mano.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formasDelTelefono } from "@/lib/difusiones";

import type { EventoDeCalendar } from "@/lib/calendar-citas";
import { asegurarOportunidad } from "@/lib/embudos";

type Supabase = SupabaseClient;

const LOG = "[calendar]";

type Aplicado = {
  ok: true;
  accion: EventoDeCalendar["accion"];
  citaId: string;
  creada: boolean;
  recordatoriosCancelados: number;
};

/**
 * Lo que devuelve cada paso, todavía sin el workspace.
 *
 * `alta`, `cambio` y `baja` ya lo reciben como argumento, así que repetirlo en
 * cada `return` sería ruido y una oportunidad de olvidarlo en uno solo.
 */
type ResultadoInterno = Aplicado | { ok: true; ignorado: string } | { ok: false; error: string; status: number };

export type Resultado =
  | (Aplicado & {
      /** Para que el webhook sepa a quién avisarle sin volver a resolverlo. */
      workspaceId: string;
    })
  | { ok: true; ignorado: string }
  | { ok: false; error: string; status: number };

/**
 * Aplica lo que pasó en Calendar.
 *
 * Devuelve `ignorado` —y no un error— cuando el evento no corresponde a ninguna
 * cita nuestra. Pasa de verdad y no es una falla: el disparador de
 * `eventUpdated` de n8n se activa con cualquier evento del calendario, incluida
 * la reunión interna que el vendedor se puso a mano y que nunca tuvo alta. Si
 * eso devolviera 404, n8n marcaría ejecuciones fallidas todo el día y el error
 * real se perdería entre el ruido. Queda en los logs, que es donde se lo busca.
 */
export async function aplicarEventoDeCalendar(
  supabase: Supabase,
  evento: EventoDeCalendar,
): Promise<Resultado> {
  const workspaceId = await resolverWorkspace(supabase);
  if (!workspaceId) {
    return { ok: false, error: "No se pudo resolver el workspace.", status: 500 };
  }

  const resultado =
    evento.accion === "alta"
      ? await alta(supabase, workspaceId, evento)
      : evento.accion === "cambio"
        ? await cambio(supabase, workspaceId, evento)
        : await baja(supabase, workspaceId, evento);

  // El workspace se resuelve una sola vez, acá: agregarlo al resultado le
  // ahorra al webhook una consulta para saber a quién avisarle.
  return "accion" in resultado ? { ...resultado, workspaceId } : resultado;
}

/* -------------------------------------------------------------------- alta */

async function alta(
  supabase: Supabase,
  workspaceId: string,
  evento: Extract<EventoDeCalendar, { accion: "alta" }>,
): Promise<ResultadoInterno> {
  const contactId = await buscarOCrearContacto(supabase, workspaceId, evento);
  if (!contactId) {
    return { ok: false, error: "No se pudo resolver el contacto.", status: 500 };
  }

  // Al embudo, igual que un lead que entra por chat.
  //
  // Un contacto que no está en el embudo no existe para el equipo: el tablero
  // es donde se mira quién está pendiente, y el que no aparece ahí no lo
  // persigue nadie. Quien reservó una llamada es, si algo, el más caliente de
  // todos: dejarlo afuera era perderlo justo cuando más cerca estaba.
  //
  // No frena el alta si falla: la cita y su recordatorio valen por sí solos, y
  // un embudo sin columnas —el único caso real— no es motivo para rechazar una
  // reserva. Queda en los logs.
  await asegurarOportunidad(supabase, workspaceId, contactId, LOG);

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      title: evento.titulo,
      start_time: evento.inicio.toISOString(),
      end_time: evento.fin.toISOString(),
      google_event_id: evento.eventId,
      origen: "calendar",
      tipo: evento.tipo,
      calendar_link: evento.link,
      telefono: evento.telefono,
      notas: evento.notas,
    })
    .select("id")
    .single();

  if (!error && data) {
    return { ok: true, accion: "alta", citaId: data.id, creada: true, recordatoriosCancelados: 0 };
  }

  // 23505 es la violación de `unique (workspace_id, google_event_id)`: la cita
  // ya estaba. No es un error, es el reintento de n8n —que va a pasar— o un
  // alta que llegó dos veces. Se trata como un cambio, que es lo que deja la
  // fila al día sin duplicarla.
  if (error?.code === "23505") {
    console.warn(`${LOG} alta repetida de ${evento.eventId}: se actualiza la cita que ya existía`);
    return await cambio(supabase, workspaceId, {
      accion: "cambio",
      eventId: evento.eventId,
      titulo: evento.titulo,
      inicio: evento.inicio,
      fin: evento.fin,
      link: evento.link,
    });
  }

  console.error(`${LOG} no se pudo crear la cita:`, error?.message);
  return { ok: false, error: error?.message ?? "No se pudo crear la cita.", status: 500 };
}

/* ------------------------------------------------------------------ cambio */

async function cambio(
  supabase: Supabase,
  workspaceId: string,
  evento: Extract<EventoDeCalendar, { accion: "cambio" }>,
): Promise<ResultadoInterno> {
  const cita = await buscarCita(supabase, workspaceId, evento.eventId);
  if (!cita) return { ok: true, ignorado: `No hay ninguna cita con el evento ${evento.eventId}.` };

  // El tipo no se toca: lo fija el alta a partir del título, y es una
  // adivinanza que alguien pudo haber corregido a mano en el CRM. Pisarlo en
  // cada cambio de horario perdería esa corrección.
  const cambios: Record<string, unknown> = {
    start_time: evento.inicio.toISOString(),
    end_time: evento.fin.toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (evento.titulo) cambios.title = evento.titulo;
  if (evento.link) cambios.calendar_link = evento.link;
  // Un evento que se había cancelado y se reactiva en Calendar vuelve a estar en
  // pie: sin esto quedaría cancelado para siempre y sin recordatorios.
  if (cita.status === "cancelled") cambios.status = "scheduled";

  const { error } = await supabase
    .from("appointments")
    .update(cambios)
    .eq("id", cita.id)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error(`${LOG} no se pudo actualizar la cita:`, error.message);
    return { ok: false, error: error.message, status: 500 };
  }

  // El corazón del flujo 2. Sólo se cancelan los recordatorios que quedaron
  // apuntando a un horario que ya no es: si el evento cambió de título o de
  // link pero no de hora, el recordatorio encolado sigue siendo correcto y
  // volver a encolarlo mandaría dos.
  const cancelados = await cancelarRecordatorios(supabase, cita.id, {
    salvoInicio: evento.inicio,
    motivo: "La cita se movió en Calendar.",
  });

  return {
    ok: true,
    accion: "cambio",
    citaId: cita.id,
    creada: false,
    recordatoriosCancelados: cancelados,
  };
}

/* -------------------------------------------------------------------- baja */

async function baja(
  supabase: Supabase,
  workspaceId: string,
  evento: Extract<EventoDeCalendar, { accion: "baja" }>,
): Promise<ResultadoInterno> {
  const cita = await buscarCita(supabase, workspaceId, evento.eventId);
  if (!cita) return { ok: true, ignorado: `No hay ninguna cita con el evento ${evento.eventId}.` };

  // Se cancela, no se borra. La pregunta que aparece después es "¿por qué no le
  // llegó el recordatorio?", y una fila borrada no la contesta. La agenda ya
  // muestra el estado con su propio color, así que desde la pantalla se ve
  // igual de claro que si hubiera desaparecido.
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", cita.id)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error(`${LOG} no se pudo cancelar la cita:`, error.message);
    return { ok: false, error: error.message, status: 500 };
  }

  // El punto del flujo 3: una llamada borrada que igual avisa es peor que no
  // avisar.
  const cancelados = await cancelarRecordatorios(supabase, cita.id, {
    motivo: "La cita se canceló en Calendar.",
  });

  return {
    ok: true,
    accion: "baja",
    citaId: cita.id,
    creada: false,
    recordatoriosCancelados: cancelados,
  };
}

/* ------------------------------------------------------------ recordatorios */

/**
 * Corta los recordatorios encolados de una cita.
 *
 * `salvoInicio` deja vivos los que ya apuntan al horario correcto, que es lo que
 * evita el recordatorio duplicado cuando el evento cambió de título pero no de
 * hora.
 *
 * Hoy no hay recordatorios configurados, así que esto no cancela nada: es la
 * parte del flujo que queda lista para cuando el disparador de citas exista, y
 * así ese trabajo no tiene que volver a pasar por el webhook.
 */
async function cancelarRecordatorios(
  supabase: Supabase,
  citaId: string,
  opciones: { motivo: string; salvoInicio?: Date },
): Promise<number> {
  const consulta = supabase
    .from("automation_runs")
    .update({
      estado: "cancelada",
      detalle: opciones.motivo,
      updated_at: new Date().toISOString(),
    })
    .eq("appointment_id", citaId)
    .eq("estado", "pendiente");

  // `neq` contra null no da verdadero en Postgres, así que las corridas sin
  // horario anotado no entran acá. Es deliberado: ésas son las confirmaciones
  // de reserva, y mover la cita de horario no deshace la reserva. Una baja sí
  // las cancela, porque llega sin `salvoInicio`.
  const { data, error } = await (opciones.salvoInicio
    ? consulta.neq("cita_inicio", opciones.salvoInicio.toISOString())
    : consulta
  ).select("id");

  if (error) {
    // Sin la migración de esta tanda las columnas no existen. No es fatal para
    // la cita, que ya quedó guardada, pero hay que verlo.
    console.error(`${LOG} no se pudieron cancelar los recordatorios:`, error.message);
    return 0;
  }

  return data?.length ?? 0;
}

/* ---------------------------------------------------------------- consultas */

type FilaCita = { id: string; status: string };

async function buscarCita(
  supabase: Supabase,
  workspaceId: string,
  eventId: string,
): Promise<FilaCita | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("google_event_id", eventId)
    .maybeSingle();

  if (error) console.error(`${LOG} no se pudo buscar la cita:`, error.message);
  return (data as FilaCita | null) ?? null;
}

/**
 * El contacto detrás de la reserva, por teléfono.
 *
 * Se busca por todas las formas en que el mismo número puede estar guardado
 * —con y sin `+`, con y sin el 9 argentino— porque una igualdad exacta contra
 * una sola forma no encuentra a alguien que ya estaba cargado, y el resultado
 * sería un contacto duplicado por cada reserva. Ver `formasDelTelefono`.
 */
/**
 * Cuál de varias fichas con el mismo teléfono es la persona.
 *
 * Lo normal es que haya una sola. Que haya dos es el rastro de una carrera al
 * abrir el chat —tres mensajes en el mismo segundo creaban tres contactos y
 * sólo uno se quedaba con la conversación; ver `procesarEntrante`—, y quedaron
 * fichas huérfanas en las bases que estuvieron andando antes de ese arreglo.
 *
 * Elegir cualquiera no da igual: si sale la huérfana, la cita queda colgada de
 * una ficha sin chat y el equipo ve la charla de un lado y el turno del otro.
 * Así que gana la que tiene conversación, que es donde va a salir el
 * recordatorio y donde el vendedor ya viene leyendo.
 */
async function elegirContacto(
  supabase: Supabase,
  candidatos: { id: string }[],
): Promise<string | null> {
  if (candidatos.length === 0) return null;
  // La de siempre: una sola ficha, sin nada que decidir.
  if (candidatos.length === 1) return candidatos[0].id;

  const ids = candidatos.map((c) => c.id);
  const { data: charlas } = await supabase
    .from("conversations")
    .select("contact_id")
    .in("contact_id", ids);

  const conChat = new Set(
    ((charlas ?? []) as { contact_id: string }[]).map((charla) => charla.contact_id),
  );
  console.warn(
    `${LOG} hay ${candidatos.length} fichas con ese teléfono: se usa la que tiene el chat`,
  );

  // Sin chat en ninguna no hay con qué desempatar: la más vieja es la que el
  // resto del CRM viene usando.
  return candidatos.find((c) => conChat.has(c.id))?.id ?? candidatos[0].id;
}

async function buscarOCrearContacto(
  supabase: Supabase,
  workspaceId: string,
  evento: Extract<EventoDeCalendar, { accion: "alta" }>,
): Promise<string | null> {
  const conMas = evento.telefono;
  const formas = formasDelTelefono(evento.telefono);

  const { data: candidatos } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("phone", formas)
    .order("created_at", { ascending: true })
    .limit(10);

  const encontrado = await elegirContacto(supabase, candidatos ?? []);

  if (encontrado) {
    // El mail de la reserva puede ser el único que se tenga de esa persona. Se
    // completa sólo si el contacto no tenía: lo cargado en el CRM manda.
    if (evento.email) {
      await supabase
        .from("contacts")
        .update({ email: evento.email })
        .eq("id", encontrado)
        .is("email", null);
    }
    return encontrado;
  }

  const { data: creado, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name: evento.nombre,
      phone: conMas,
      email: evento.email,
    })
    .select("id")
    .single();

  if (error || !creado) {
    console.error(`${LOG} no se pudo crear el contacto:`, error?.message);
    return null;
  }

  // A propósito no se llama a `programarPorLeadNuevo`: las automatizaciones de
  // "lead nuevo" se escribieron para quien llega por un anuncio o escribiendo
  // por WhatsApp, y dispararlas acá le mandaría el mensaje de bienvenida a
  // alguien que acaba de reservar una llamada, encimado con la confirmación de
  // la reserva. Si algún día se quiere, es una línea.
  return creado.id;
}

/**
 * En qué workspace entra lo que manda Calendar.
 *
 * Mismo criterio que el de los mensajes entrantes: con un solo workspace no hay
 * ambigüedad y se usa ése. Con varios hace falta decidir a cuál va cada
 * calendario, y eso todavía no está: mejor cortar con un log claro que repartir
 * citas al azar entre workspaces.
 */
async function resolverWorkspace(supabase: Supabase): Promise<string | null> {
  const { data, error } = await supabase.from("workspaces").select("id").limit(2);

  if (error) {
    console.error(`${LOG} no se pudo leer workspaces:`, error.message);
    return null;
  }
  if (!data?.length) {
    console.error(`${LOG} no hay ningún workspace creado todavía`);
    return null;
  }
  if (data.length !== 1) {
    console.error(`${LOG} hay varios workspaces: falta decidir a cuál entra cada calendario`);
    return null;
  }

  return data[0].id;
}
