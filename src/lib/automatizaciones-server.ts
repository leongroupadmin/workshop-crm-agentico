import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  correspondeSeguimiento,
  dentroDeLaFranja,
  describirRuta,
  disponibles,
  elegirResponsable,
  escribirRuta,
  esNotaDeVoz,
  esperaDelReintento,
  esRecordatorioDeCita,
  leerDisparador,
  leerRuta,
  momentoDelRecordatorio,
  leerEtapaRequerida,
  leerPasos,
  marcaSinLeer,
  MAX_AUTOMATICOS_POR_DIA,
  pasoEn,
  pasosRestantes,
  proximaApertura,
  reemplazarTokens,
  rutaDeLaRama,
  rutaSiguiente,
  sinMensajes,
  soloConversiones,
  VENTANA_WHATSAPP_MINUTOS,
  yaFrenoLaIA,
  type Candidato,
  type DatosDeLaCita,
  type DatosDelContacto,
  type Disparador,
  type EstadoDelReparto,
  type Franja,
  type ModoDeReparto,
  type Paso,
  type Prueba,
  type Ruta,
} from "@/lib/automatizaciones";
import { chatDeWhatsapp } from "@/lib/difusiones";
import { safeTimeZone } from "@/lib/fechas";
import { admitePlantillas, enviarAudio, enviarPlantilla, enviarTexto } from "@/lib/mensajeria";
import { enviarConversion } from "@/lib/meta-capi-server";
import { completeChatServer, type ChatTurn } from "@/lib/openai-server";
import { componentesParaEnviar, type Plantilla } from "@/lib/plantillas";
import { promptDelCanal } from "@/lib/prompts-agentes";
import { listYcloudTemplates } from "@/lib/ycloud-api";
import type { Channel } from "@/types/database";

type Supabase = SupabaseClient;

/** Cuántas corridas se atienden por vuelta del cron. */
const POR_VUELTA = 40;
/**
 * Cuánto se reserva una corrida mientras se la atiende.
 *
 * Tiene que ser mayor que lo que tarda un envío con todos sus reintentos de
 * red, y bastante menor que la paciencia de alguien esperando el aviso: si el
 * proceso se cae a mitad, este es el tiempo que la corrida queda congelada
 * antes de que otra vuelta la retome.
 */
const RESERVA_DE_LA_CORRIDA_MINUTOS = 10;
/** Cuántas conversaciones mira el barrido del silencio, por automatización. */
const POR_BARRIDO = 200;
/** Historial que lee el paso de IA. */
const HISTORIAL = 20;
/**
 * Cuántas asignaciones pasadas mira la rotación.
 *
 * Es una ventana móvil y no todo el historial a propósito: cambiarle el peso a
 * alguien, o sacarlo y volverlo a poner, tiene que notarse en los próximos
 * leads y no quedar sepultado bajo meses de reparto viejo.
 */
const HISTORIAL_REPARTO = 200;
/**
 * Cuánto mira el barrido de recordatorios: cuántas citas, y hasta cuándo.
 *
 * Los dos se exportan porque el diagnóstico de la Agenda tiene que mirar
 * exactamente lo mismo. Una cita más allá del horizonte no tiene corrida anotada
 * por buenos motivos, y contarla como desatendida sería acusar al reloj de no
 * haber hecho algo que no le toca. Dos copias del número se separan con el
 * tiempo, y el día que se separan el cartel empieza a mentir.
 */
export const CITAS_POR_BARRIDO = 300;
export const HORIZONTE_DE_CITAS_DIAS = 90;

type FilaAutomatizacion = {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  disparador: unknown;
  pasos: unknown;
  etapa_requerida: unknown;
  cancelar_si_responde: boolean;
  hora_desde: number;
  hora_hasta: number;
  zona: string;
};

const CAMPOS =
  "id, workspace_id, name, enabled, disparador, pasos, etapa_requerida, cancelar_si_responde, hora_desde, hora_hasta, zona";

/**
 * La franja de envío, en la zona del workspace.
 *
 * La zona la manda `workspaces.timezone`, la misma que decide el corte del día
 * en el resumen, y no la columna propia de la automatización. Si fueran dos,
 * cambiar la zona en Configuración movería los gráficos y dejaría los envíos
 * donde estaban, que es la clase de desfasaje que nadie relaciona con lo que
 * tocó. La columna queda de reserva para cuando la migración de la zona todavía
 * no corrió.
 */
async function franjaDe(supabase: Supabase, fila: FilaAutomatizacion): Promise<Franja> {
  return {
    horaDesde: fila.hora_desde,
    horaHasta: fila.hora_hasta,
    zona: await zonaDelWorkspace(supabase, fila.workspace_id, fila.zona),
  };
}

/**
 * La zona del workspace, que es la que manda para cualquier horario.
 *
 * La usan la franja de envío y los turnos del reparto: si fueran dos zonas
 * distintas, mover la de Configuración correría una y dejaría la otra donde
 * estaba.
 */
async function zonaDelWorkspace(
  supabase: Supabase,
  workspaceId: string,
  reserva?: string,
): Promise<string> {
  const { data } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", workspaceId)
    .maybeSingle();

  return safeTimeZone(data?.timezone ?? reserva);
}

/* --------------------------------------------------------------- programar */

/**
 * Anota una corrida para la hora que se le pida.
 *
 * La espera la calcula quien llama y no esta función, porque no siempre falta
 * esperar: en `etapa` y en `lead_nuevo` el disparador es un hecho que acaba de
 * pasar y la cuenta arranca ahí, pero en `sin_respuesta` el barrido ya
 * encontró el silencio cumplido —para eso lo buscó— y lo que corresponde es
 * mandar ahora. Sumarle la espera de nuevo hacía que un follow-up de 12 h
 * intentara salir a las 24 h, justo cuando la ventana de Meta ya se cerró: el
 * mensaje no llegaba tarde, no llegaba nunca.
 *
 * `conversationId` deja anotado por dónde entró. Un contacto puede tener
 * abierto WhatsApp e Instagram, y el follow-up del silencio de uno no se manda
 * por el otro.
 *
 * El índice único parcial de la base es el que impide dos corridas activas de
 * la misma automatización sobre el mismo contacto, así que acá alcanza con
 * tragarse el choque: significa que ya estaba programada, que es exactamente lo
 * que se quería.
 *
 * Devuelve el id de la corrida nueva, o null si no se anotó: es lo que necesita
 * quien quiera atenderla ya mismo en vez de esperar al reloj.
 */
async function programar(
  supabase: Supabase,
  automatizacion: FilaAutomatizacion,
  contactId: string,
  cuando: {
    corre: Date;
    conversationId?: string;
    /** De qué cita sale, cuando es un recordatorio. */
    appointmentId?: string;
    /** El horario que tenía la cita al anotarla: si se mueve, deja de coincidir. */
    citaInicio?: Date;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      workspace_id: automatizacion.workspace_id,
      automation_id: automatizacion.id,
      contact_id: contactId,
      conversation_id: cuando.conversationId ?? null,
      corre_en: cuando.corre.toISOString(),
      appointment_id: cuando.appointmentId ?? null,
      cita_inicio: cuando.citaInicio?.toISOString() ?? null,
    })
    .select("id")
    .maybeSingle();

  // 23505 es la violación del índice único: ya hay una corrida activa.
  if (error && error.code !== "23505") {
    console.error("[automatizaciones] no se pudo programar:", error.message);
  }

  return (data as { id?: string } | null)?.id ?? null;
}

/** Cuándo toca el primer paso de un disparador que acaba de ocurrir. */
function despuesDeLaEspera(disparador: Disparador): Date {
  return new Date(Date.now() + disparador.esperaMinutos * 60_000);
}

async function activas(
  supabase: Supabase,
  workspaceId: string,
  tipo: Disparador["tipo"],
): Promise<{ fila: FilaAutomatizacion; disparador: Disparador }[]> {
  const { data, error } = await supabase
    .from("automations")
    .select(CAMPOS)
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  if (error) {
    console.error("[automatizaciones] no se pudieron leer:", error.message);
    return [];
  }

  return (data ?? []).flatMap((fila) => {
    const disparador = leerDisparador((fila as FilaAutomatizacion).disparador);
    return disparador?.tipo === tipo ? [{ fila: fila as FilaAutomatizacion, disparador }] : [];
  });
}

/**
 * En qué columna del embudo está el lead ahora.
 *
 * Toma una sola oportunidad sin ordenarlas: un contacto con dos abiertas es
 * raro y, cuando pasa, cualquiera de las dos alcanza para decidir si la
 * automatización todavía le corresponde. Null es tanto "no tiene ninguna" como
 * "no se pudo leer", y las dos cortan igual: sin saber dónde está, no se le
 * escribe.
 */
async function etapaActual(
  supabase: Supabase,
  workspaceId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("stage_id")
    .eq("contact_id", contactId)
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  return (data as { stage_id?: string } | null)?.stage_id ?? null;
}

/**
 * ¿La condición de etapa deja arrancar esta automatización para este lead?
 *
 * Sin condición guardada devuelve true sin consultar nada: es el caso de todas
 * las automatizaciones que ya existían, y no tienen por qué pagar una consulta
 * de más en cada disparo.
 *
 * Se mira acá y no sólo al ejecutar porque una corrida que nace condenada
 * ocupa el índice que impide programar la buena, y engorda el "en curso" de la
 * lista con leads a los que no se les va a escribir nunca.
 *
 * `etapaConocida` es para quien ya sabe dónde está el lead —programar por
 * etapa acaba de recibir la columna— y así se ahorra la consulta.
 */
async function pasaLaCondicion(
  supabase: Supabase,
  fila: FilaAutomatizacion,
  contactId: string,
  etapaConocida?: string | null,
): Promise<boolean> {
  const requerida = leerEtapaRequerida(fila.etapa_requerida);
  if (!requerida) return true;

  const etapa =
    etapaConocida === undefined
      ? await etapaActual(supabase, fila.workspace_id, contactId)
      : etapaConocida;

  return etapa === requerida;
}

/**
 * La oportunidad entró en una etapa: arranca lo que dependa de esa columna.
 *
 * Devuelve las corridas que quedaron para ya —las de espera cero—, para que
 * quien llama las atienda con `ejecutarYa` en vez de dejarlas esperando al
 * reloj. Ver `ejecutarYa`.
 */
export async function programarPorEtapa(
  supabase: Supabase,
  input: { workspaceId: string; contactId: string; stageId: string },
): Promise<string[]> {
  const paraYa: string[] = [];

  for (const { fila, disparador } of await activas(supabase, input.workspaceId, "etapa")) {
    if (disparador.tipo !== "etapa" || disparador.stageId !== input.stageId) continue;
    // La columna en la que acaba de entrar es la etapa actual: no hace falta ir
    // a buscarla de nuevo.
    if (!(await pasaLaCondicion(supabase, fila, input.contactId, input.stageId))) continue;

    const id = await programar(supabase, fila, input.contactId, {
      corre: despuesDeLaEspera(disparador),
    });
    if (id && disparador.esperaMinutos === 0) paraYa.push(id);
  }

  return paraYa;
}

/** Se creó un contacto, por el webhook o a mano. Devuelve lo mismo que `programarPorEtapa`. */
export async function programarPorLeadNuevo(
  supabase: Supabase,
  input: { workspaceId: string; contactId: string },
): Promise<string[]> {
  const paraYa: string[] = [];

  for (const { fila, disparador } of await activas(supabase, input.workspaceId, "lead_nuevo")) {
    if (!(await pasaLaCondicion(supabase, fila, input.contactId))) continue;

    const id = await programar(supabase, fila, input.contactId, {
      corre: despuesDeLaEspera(disparador),
    });
    if (id && disparador.esperaMinutos === 0) paraYa.push(id);
  }

  return paraYa;
}

/**
 * El contacto escribió: corta lo que estuviera en camino.
 *
 * Se llama desde el webhook, en el mismo lugar donde entra el mensaje. Es lo
 * que evita que el "¿seguís interesado?" salga después de que contestó.
 */
export async function cancelarPorRespuesta(
  supabase: Supabase,
  input: { workspaceId: string; contactId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, automation_id, automations!inner(cancelar_si_responde)")
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId)
    .eq("estado", "pendiente");

  if (error) {
    console.error("[automatizaciones] no se pudieron leer las corridas:", error.message);
    return;
  }

  const cortar = (data ?? [])
    .filter((fila) => {
      const relacion = (fila as { automations?: unknown }).automations;
      const config = Array.isArray(relacion) ? relacion[0] : relacion;
      return (config as { cancelar_si_responde?: boolean } | null)?.cancelar_si_responde !== false;
    })
    .map((fila) => (fila as { id: string }).id);

  if (cortar.length === 0) return;

  await supabase
    .from("automation_runs")
    .update({ estado: "cancelada", detalle: "El contacto respondió.", updated_at: new Date().toISOString() })
    .in("id", cortar);
}

/* ------------------------------------------------------------------- barrido */

/**
 * Busca los contactos que dejaron de contestar.
 *
 * Este disparador no es un hecho sino un estado —"hace N horas que no
 * responde"— así que no hay dónde engancharlo: se busca en cada vuelta. Se
 * programa una sola vez por silencio: si ya hay una corrida posterior al último
 * mensaje, no se vuelve a anotar hasta que la persona escriba de nuevo.
 */
export async function programarSinRespuesta(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase
    .from("automations")
    .select(CAMPOS)
    .eq("enabled", true);

  if (error) {
    console.error("[automatizaciones] no se pudo barrer:", error.message);
    return 0;
  }

  let anotadas = 0;

  for (const cruda of data ?? []) {
    const fila = cruda as FilaAutomatizacion;
    const disparador = leerDisparador(fila.disparador);
    if (disparador?.tipo !== "sin_respuesta") continue;

    // Se compara como número y no como texto: Postgres devuelve las fechas con
    // `+00:00` y `toISOString()` las escribe con `Z`, y comparar esas dos formas
    // como cadenas no siempre da lo mismo que comparar los instantes.
    const ahora = Date.now();

    for (const charla of await silenciosDe(supabase, fila)) {
      // La decisión la toma `correspondeSeguimiento`, que no toca la base y por
      // eso se puede probar.
      const corresponde = correspondeSeguimiento({
        ahora,
        esperaMinutos: disparador.esperaMinutos,
        ultimoMensaje: charla.ultimoMensaje,
        ultimoMensajeDelContacto: charla.ultimoMensajeDelContacto,
        ultimaCorrida: charla.ultimaCorrida,
      });

      if (!corresponde) continue;

      // Lo último que se mira: el resto de los filtros es más barato y descarta
      // casi todas las conversaciones antes de llegar acá.
      if (!(await pasaLaCondicion(supabase, fila, charla.contactId))) continue;

      // Ahora, no dentro de otras `esperaMinutos`: el silencio que pide el
      // disparador ya está cumplido, es la condición con la que se lo buscó.
      await programar(supabase, fila, charla.contactId, {
        corre: new Date(),
        conversationId: charla.conversationId,
      });
      anotadas += 1;
    }
  }

  return anotadas;
}

/** Lo que el barrido necesita saber de cada conversación para decidir. */
type Silencio = {
  conversationId: string;
  contactId: string;
  ultimoMensaje: { deElContacto: boolean; en: number } | null;
  ultimoMensajeDelContacto: number | null;
  ultimaCorrida: number | null;
};

const enMilisegundos = (valor: string | null | undefined) =>
  valor ? new Date(valor).getTime() : null;

/**
 * Las conversaciones del workspace, las movidas más recientemente primero, con
 * quién habló último y cuándo.
 *
 * No se filtra por `updated_at`: la columna no dice lo que parece. Un trigger
 * de la base la pisa con `now()` en *cualquier* update de la fila, y abrir el
 * chat en el CRM lo marca como leído, que es un update. Así que cada vez que
 * alguien miraba la conversación quedaba "recién movida" y el barrido la
 * salteaba otras N horas: fijarse si el follow-up había salido era justamente
 * lo que impedía que saliera, y en un chat que se mira todos los días no salía
 * nunca. Quién habló último y cuándo lo dicen los mensajes; `updated_at` queda
 * sólo para ordenar, que es para lo único que sirve.
 *
 * Sale de `seguimiento_silencios`, una sola consulta. Antes eran tres por
 * conversación —seiscientas por automatización, cada cinco minutos, con o sin
 * movimiento—: lo que más pedidos le hacía a Supabase de todo el CRM, y cada
 * uno deja su línea en los logs, que en el plan gratis tienen tope. Si la función todavía no está en la base —el
 * código llega con el deploy y la migración cuando alguien la corre a mano—,
 * se vuelve al camino de antes para que el seguimiento no deje de salir.
 */
async function silenciosDe(supabase: Supabase, fila: FilaAutomatizacion): Promise<Silencio[]> {
  const { data, error } = await supabase.rpc("seguimiento_silencios", {
    p_workspace: fila.workspace_id,
    p_automation: fila.id,
    p_limite: POR_BARRIDO,
  });

  if (!error) {
    return ((data ?? []) as FilaSilencio[]).map((charla) => ({
      conversationId: charla.conversacion,
      contactId: charla.contacto,
      ultimoMensaje: charla.ultimo_en
        ? { deElContacto: charla.ultimo_de_contacto === true, en: new Date(charla.ultimo_en).getTime() }
        : null,
      ultimoMensajeDelContacto: enMilisegundos(charla.ultimo_del_contacto_en),
      ultimaCorrida: enMilisegundos(charla.ultima_corrida_en),
    }));
  }

  console.warn(
    "[automatizaciones] sin seguimiento_silencios, se barre consulta por consulta:",
    error.message,
  );
  return silenciosUnoPorUno(supabase, fila);
}

type FilaSilencio = {
  conversacion: string;
  contacto: string;
  ultimo_de_contacto: boolean | null;
  ultimo_en: string | null;
  ultimo_del_contacto_en: string | null;
  ultima_corrida_en: string | null;
};

/** El camino de antes de `seguimiento_silencios`: tres consultas por conversación. */
async function silenciosUnoPorUno(
  supabase: Supabase,
  fila: FilaAutomatizacion,
): Promise<Silencio[]> {
  const { data: charlas } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("workspace_id", fila.workspace_id)
    .order("updated_at", { ascending: false })
    .limit(POR_BARRIDO);

  const silencios: Silencio[] = [];

  for (const charla of charlas ?? []) {
    const [{ data: ultimo }, { data: delContacto }, { data: previa }] = await Promise.all([
      supabase
        .from("messages")
        .select("sender_type, created_at")
        .eq("conversation_id", charla.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", charla.id)
        .eq("sender_type", "contact")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("automation_runs")
        .select("created_at")
        .eq("automation_id", fila.id)
        .eq("contact_id", charla.contact_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    silencios.push({
      conversationId: charla.id,
      contactId: charla.contact_id,
      ultimoMensaje: ultimo
        ? { deElContacto: ultimo.sender_type === "contact", en: new Date(ultimo.created_at).getTime() }
        : null,
      ultimoMensajeDelContacto: enMilisegundos(
        (delContacto as { created_at?: string } | null)?.created_at,
      ),
      ultimaCorrida: enMilisegundos((previa as { created_at?: string } | null)?.created_at),
    });
  }

  return silencios;
}

/* ------------------------------------------------- recordatorios de citas */

type FilaCita = {
  id: string;
  contact_id: string;
  start_time: string;
  tipo: string | null;
};

/**
 * Anota los recordatorios de las citas que vienen.
 *
 * Es el reverso de `programarSinRespuesta`: aquél busca un hecho que ya pasó
 * —el silencio— y manda ahora; éste busca un hecho que todavía no pasó —la
 * cita— y anota para cuándo. Por eso la corrida nace con `corre_en` en el
 * futuro y se queda quieta hasta que llega el momento.
 *
 * Dos cosas sostienen todo esto:
 *
 * 1. **`cita_inicio` es parte de la identidad del recordatorio.** No se vuelve
 *    a anotar una cita que ya tiene corrida *para ese horario*. Cuando la cita
 *    se mueve en Calendar, el horario deja de coincidir y corresponde un
 *    recordatorio nuevo —el cliente tiene que enterarse del jueves—, mientras
 *    el webhook cancela el que apuntaba al martes.
 *
 * 2. **Un momento que ya pasó no se anota.** Una reserva cargada dos horas
 *    antes de la llamada no dispara el aviso de "24 horas antes": ese momento
 *    nunca existió. Sin esta regla saldría igual, al instante, diciendo
 *    "mañana" sobre algo que es hoy.
 */
export async function programarRecordatoriosDeCitas(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase.from("automations").select(CAMPOS).eq("enabled", true);

  if (error) {
    console.error("[automatizaciones] no se pudieron barrer las citas:", error.message);
    return 0;
  }

  let anotadas = 0;
  const ahora = Date.now();
  const hasta = new Date(ahora + HORIZONTE_DE_CITAS_DIAS * 24 * 60 * 60_000).toISOString();

  for (const cruda of data ?? []) {
    const fila = cruda as FilaAutomatizacion;
    const disparador = leerDisparador(fila.disparador);
    if (disparador?.tipo !== "cita") continue;

    // Sólo las que siguen en pie y todavía no empezaron. Una cita cancelada no
    // manda nada, y una que ya pasó tampoco: el índice parcial de la migración
    // está armado justo para esta consulta.
    const { data: citas } = await supabase
      .from("appointments")
      .select("id, contact_id, start_time, tipo")
      .eq("workspace_id", fila.workspace_id)
      .eq("status", "scheduled")
      .gt("start_time", new Date(ahora).toISOString())
      .lt("start_time", hasta)
      .order("start_time", { ascending: true })
      .limit(CITAS_POR_BARRIDO);

    const candidatas = ((citas ?? []) as FilaCita[]).filter(
      (cita) => !disparador.tipoDeCita || cita.tipo === disparador.tipoDeCita,
    );

    if (candidatas.length === 0) continue;

    const yaAnotadas = await recordatoriosYaAnotados(
      supabase,
      fila.id,
      candidatas.map((cita) => cita.id),
    );

    for (const cita of candidatas) {
      const inicio = new Date(cita.start_time);
      if (!Number.isFinite(inicio.getTime())) continue;

      // Qué cuenta como "ya anotado" depende del momento, y la diferencia
      // importa. Un recordatorio *antes* de la cita es de un horario: si la
      // cita se mueve al jueves, el del martes ya no sirve y corresponde uno
      // nuevo. La confirmación *al agendar* es de la reserva: se manda una vez
      // y punto. Sin esta distinción, cada cambio de horario le mandaba al
      // cliente una confirmación de reserva más.
      const anotado =
        disparador.momento === "al_agendar"
          ? yaAnotadas.porCita.has(cita.id)
          : yaAnotadas.porHorario.has(claveDeRecordatorio(cita.id, inicio));

      if (anotado) continue;

      // La cita se movió y quedó un recordatorio pendiente apuntando al horario
      // viejo. Normalmente lo cancela el webhook de Calendar al recibir el
      // cambio, pero no siempre pasa por ahí: la cita se puede mover desde el
      // CRM, o n8n puede estar caído. Y mientras esa corrida siga pendiente, el
      // índice único rechaza la nueva y el recordatorio del horario correcto no
      // se anota nunca. Así que el barrido no depende del webhook: cancela lo
      // desfasado antes de anotar.
      for (const vieja of yaAnotadas.pendientes.get(cita.id) ?? []) {
        // Sin horario anotado es una confirmación de reserva, que no apunta a
        // ningún horario y no queda desfasada por un cambio.
        if (!Number.isFinite(vieja.inicio) || vieja.inicio === inicio.getTime()) continue;
        await cerrar(supabase, vieja.id, "cancelada", "La cita se movió de horario.");
      }

      const corre = momentoDelRecordatorio(disparador, inicio, ahora);
      if (!corre) continue;

      await programar(supabase, fila, cita.contact_id, {
        corre,
        appointmentId: cita.id,
        // La confirmación de reserva va sin horario anotado, y no por
        // prolijidad: `cancelarRecordatorios` cancela lo que apunte a un
        // horario distinto del nuevo, y en Postgres una comparación contra null
        // no da verdadero, así que la confirmación sobrevive al cambio. Es lo
        // correcto —moverla de horario no deshace la reserva— y además evita el
        // caso que la perdía: reservar y mover en el mismo minuto cancelaba la
        // confirmación antes de que saliera, y el barrido ya no la volvía a
        // anotar porque esa cita figuraba como atendida.
        citaInicio: disparador.momento === "antes" ? inicio : undefined,
      });
      anotadas += 1;
    }
  }

  return anotadas;
}

/** La identidad de un recordatorio: de qué cita y para qué horario. */
function claveDeRecordatorio(appointmentId: string, inicio: Date): string {
  return `${appointmentId}|${inicio.getTime()}`;
}

/**
 * Los recordatorios que esta automatización ya anotó para estas citas.
 *
 * Mira todas las corridas y no sólo las pendientes: el índice único parcial
 * frena la segunda pendiente, pero en cuanto la primera se marca como hecha el
 * índice deja de proteger y el barrido de la vuelta siguiente volvería a
 * anotarla. El resultado sería el mismo recordatorio cada minuto hasta la hora
 * de la cita.
 *
 * Vuelven los dos cortes que hacen falta: por cita —se anotó algo alguna vez— y
 * por horario —se anotó *para este* horario—. Cuál usar lo decide el momento
 * del disparador; ver el comentario en el barrido.
 */
async function recordatoriosYaAnotados(
  supabase: Supabase,
  automationId: string,
  citas: string[],
): Promise<{
  porCita: Set<string>;
  porHorario: Set<string>;
  /** Las que todavía no salieron, por cita, para poder cancelar las desfasadas. */
  pendientes: Map<string, { id: string; inicio: number }[]>;
}> {
  const { data } = await supabase
    .from("automation_runs")
    .select("id, appointment_id, cita_inicio, estado")
    .eq("automation_id", automationId)
    .in("appointment_id", citas);

  const porCita = new Set<string>();
  const porHorario = new Set<string>();
  const pendientes = new Map<string, { id: string; inicio: number }[]>();

  for (const cruda of data ?? []) {
    const fila = cruda as {
      id: string;
      appointment_id?: string;
      cita_inicio?: string;
      estado?: string;
    };
    if (!fila.appointment_id) continue;

    porCita.add(fila.appointment_id);
    if (fila.cita_inicio) {
      porHorario.add(claveDeRecordatorio(fila.appointment_id, new Date(fila.cita_inicio)));
    }

    if (fila.estado === "pendiente") {
      const lista = pendientes.get(fila.appointment_id) ?? [];
      lista.push({
        id: fila.id,
        inicio: fila.cita_inicio ? new Date(fila.cita_inicio).getTime() : NaN,
      });
      pendientes.set(fila.appointment_id, lista);
    }
  }

  return { porCita, porHorario, pendientes };
}

/* ------------------------------------------------------------------ ejecutar */

export type Balance = {
  atendidas: number;
  enviadas: number;
  canceladas: number;
  falladas: number;
  /** Las que no salieron y van a volver a intentarse. */
  reintentos: number;
};

type FilaCorrida = {
  id: string;
  workspace_id: string;
  automation_id: string;
  contact_id: string;
  /** Por dónde entró el disparo, cuando se lo pudo saber. */
  conversation_id: string | null;
  /** De qué cita sale, cuando es un recordatorio. */
  appointment_id: string | null;
  /** El horario que tenía la cita al anotar la corrida. */
  cita_inicio: string | null;
  paso: number;
  /**
   * Por dónde va dentro del árbol: `"2.si.1"`. Null en las corridas anotadas
   * antes de que existieran las ramas, que se ubican con `paso`.
   */
  ruta: string | null;
  /** Cuántas veces ya falló el envío de esta corrida. */
  intentos: number;
  created_at: string;
};

const CAMPOS_CORRIDA =
  "id, workspace_id, automation_id, contact_id, conversation_id, appointment_id, cita_inicio, paso, ruta, intentos, created_at";

function balanceVacio(): Balance {
  return { atendidas: 0, enviadas: 0, canceladas: 0, falladas: 0, reintentos: 0 };
}

export async function ejecutarPendientes(supabase: Supabase): Promise<Balance> {
  // La misma marca para leer y para reservar: lo que se reserva es exactamente
  // lo que se leyó, y no lo que haya vencido entre una consulta y la otra.
  const vencidasHasta = new Date().toISOString();

  const { data, error } = await supabase
    .from("automation_runs")
    .select(CAMPOS_CORRIDA)
    .eq("estado", "pendiente")
    .lte("corre_en", vencidasHasta)
    .order("corre_en", { ascending: true })
    .limit(POR_VUELTA);

  if (error) {
    console.error("[automatizaciones] no se pudieron leer las pendientes:", error.message);
    return balanceVacio();
  }

  return atenderVencidas(supabase, (data ?? []) as FilaCorrida[], vencidasHasta);
}

/**
 * Atiende ya mismo las corridas recién anotadas, sin esperar al reloj.
 *
 * "Al instante" decía al instante y quería decir "en la próxima vuelta del
 * cron": cinco minutos si el reloj anda, nunca si no está programado. Para un
 * reparto eso es un lead nuevo sin dueño justo cuando más rápido hay que
 * contestarle, y desde la pantalla se ve igual que una automatización rota: la
 * corrida queda "en curso" y el lead "Sin asignar".
 *
 * Recibe ids y no barre la cola entera: quien llama es un webhook o una acción
 * de la pantalla, y lo único que le toca es lo que acaba de disparar. Lo demás
 * sigue siendo trabajo del cron.
 *
 * La reserva de siempre es la que hace seguro correrlo al mismo tiempo que una
 * vuelta del cron: de dos que intentan tomar la misma corrida, una sola la
 * atiende. Y atender es el mismo camino que recorre el cron —la franja, la
 * etapa, el tope diario—, así que adelantarla no saltea ninguna regla.
 */
export async function ejecutarYa(supabase: Supabase, ids: string[]): Promise<Balance> {
  if (ids.length === 0) return balanceVacio();

  const vencidasHasta = new Date().toISOString();

  const { data, error } = await supabase
    .from("automation_runs")
    .select(CAMPOS_CORRIDA)
    .in("id", ids)
    .eq("estado", "pendiente")
    .lte("corre_en", vencidasHasta);

  if (error) {
    // No se pierde nada: las corridas ya están anotadas y el cron las levanta.
    console.error("[automatizaciones] no se pudieron adelantar:", error.message);
    return balanceVacio();
  }

  return atenderVencidas(supabase, (data ?? []) as FilaCorrida[], vencidasHasta);
}

async function atenderVencidas(
  supabase: Supabase,
  corridas: FilaCorrida[],
  vencidasHasta: string,
): Promise<Balance> {
  const balance = balanceVacio();

  for (const corrida of corridas) {
    // Sin esto, dos vueltas simultáneas leen la misma fila y el contacto recibe
    // el mismo recordatorio dos veces. Pasa en cuanto una vuelta tarda más que
    // el intervalo del cron —cuarenta envíos con el proveedor lento alcanzan— y
    // desde que el webhook de Calendar también dispara el motor hay dos
    // corredores de verdad, no uno solo puntual.
    if (!(await reservar(supabase, corrida.id, vencidasHasta))) continue;

    balance.atendidas += 1;
    try {
      const resultado = await atender(supabase, corrida);
      if (resultado === "cancelada") balance.canceladas += 1;
      if (resultado === "fallada") balance.falladas += 1;
      if (resultado === "reintento") balance.reintentos += 1;
      if (resultado === "envio") balance.enviadas += 1;
    } catch (problema) {
      balance.falladas += 1;
      console.error("[automatizaciones] la corrida se cayó:", problema);
      await cerrar(supabase, corrida.id, "fallada", String(problema).slice(0, 300));
    }
  }

  return balance;
}

type Desenlace = "cancelada" | "fallada" | "reintento" | "envio" | "espera" | "hecha";

async function atender(supabase: Supabase, corrida: FilaCorrida): Promise<Desenlace> {
  const { data: cruda } = await supabase
    .from("automations")
    .select(CAMPOS)
    .eq("id", corrida.automation_id)
    .maybeSingle();

  const automatizacion = cruda as FilaAutomatizacion | null;
  if (!automatizacion || !automatizacion.enabled) {
    await cerrar(supabase, corrida.id, "cancelada", "La automatización está apagada.");
    return "cancelada";
  }

  const disparador = leerDisparador(automatizacion.disparador);
  const pasos = leerPasos(automatizacion.pasos);
  if (!disparador || pasos.length === 0) {
    await cerrar(supabase, corrida.id, "fallada", "La automatización quedó mal guardada.");
    return "fallada";
  }

  const arranque = arranqueDe(corrida, pasos);
  if (arranque.clase === "terminada") {
    await cerrar(supabase, corrida.id, "hecha", null);
    return "hecha";
  }
  if (arranque.clase === "perdida") {
    await cerrar(
      supabase,
      corrida.id,
      "cancelada",
      "Se editó la automatización mientras esta corrida estaba en curso.",
    );
    return "cancelada";
  }
  const inicio = arranque.ruta;

  // Lo que todavía puede llegar a ejecutarse, contando las dos ramas de cada
  // condición que falte resolver: cuál se va a tomar no se sabe hasta llegar.
  const restantes = pasosRestantes(pasos, inicio);
  // Lo que queda es sólo avisarle a Meta: no le escribe a nadie, así que no le
  // tocan los cortes ni la franja pensados para no molestar al lead.
  const soloMeta = soloConversiones(restantes);
  // Lo que queda no le escribe al contacto: ni la franja ni el corte por
  // respuesta tienen a quién proteger.
  const mudo = sinMensajes(restantes);
  const recordatorio = esRecordatorioDeCita(disparador);

  const motivo = await motivoParaCortar(supabase, corrida, automatizacion, disparador, {
    soloMeta,
    mudo,
    frenoLaIA: yaFrenoLaIA(pasos, inicio),
  });
  if (motivo) {
    await cerrar(supabase, corrida.id, "cancelada", motivo);
    return "cancelada";
  }

  // Fuera de horario no se cancela: se corre para cuando abra. Un lead no se
  // pierde porque el paso cayó a las tres de la mañana.
  //
  // El recordatorio de una cita se saltea la franja, y no por comodidad: la
  // franja lo rompería. Un aviso de "una hora antes" para una llamada de las
  // nueve sale a las ocho, antes de que abra; posponerlo hasta las nueve lo
  // haría llegar cuando el cliente ya está esperando en la llamada. La hora de
  // la cita es su propia franja.
  const ahora = new Date();
  const franja = await franjaDe(supabase, automatizacion);
  if (!mudo && !recordatorio && !dentroDeLaFranja(ahora, franja)) {
    await posponer(supabase, corrida.id, inicio, proximaApertura(ahora, franja));
    return "espera";
  }

  const destino = await destinoDe(supabase, corrida);
  let hubo = false;

  // El recorrido avanza siempre hacia adelante: al hermano siguiente, adentro
  // de una rama, o afuera de la que se terminó. Nunca hacia arriba a un paso
  // ya ejecutado, porque las ramas son listas anidadas y no hay forma de
  // escribir un "volver a". Por eso esto no necesita tope de vueltas.
  let actual: Ruta | null = inicio;

  while (actual) {
    const paso = pasoEn(pasos, actual);
    // La ruta dejó de existir. `pasos` se leyó una sola vez al entrar, así que
    // no debería pasar; cortar es más barato que confiar en que no pase.
    if (!paso) break;

    if (paso.tipo === "esperar") {
      const siguiente = rutaSiguiente(pasos, actual);
      // Una espera sin nada después no espera nada. La validación no la deja
      // guardar, pero una automatización editada con corridas en vuelo puede
      // dejarla: se cierra ahora en vez de dormir para despertar a no hacer
      // nada.
      if (!siguiente) break;

      await posponer(
        supabase,
        corrida.id,
        siguiente,
        new Date(Date.now() + paso.minutos * 60_000),
      );
      return hubo ? "envio" : "espera";
    }

    if (paso.tipo === "condicion") {
      const cumple = await evaluarPrueba(supabase, paso.prueba, corrida);
      actual = rutaDeLaRama(pasos, actual, cumple ? "si" : "no");
      continue;
    }

    const salio = await ejecutarPaso(supabase, {
      paso,
      automatizacion,
      corrida,
      destino,
    });

    if (salio.clase === "corta") {
      await cerrar(supabase, corrida.id, "cancelada", "Se alcanzó el tope de mensajes del día.");
      return "cancelada";
    }
    // Un paso que no pudo salir corta la secuencia. Seguir con los siguientes
    // mandaría un "¿pudiste verlo?" sobre algo que nunca se envió.
    if (salio.clase === "error") {
      const intentos = (corrida.intentos ?? 0) + 1;
      const espera = esperaDelReintento(intentos);
      const detalle = `${describirRuta(actual)}: ${salio.detalle}`;

      if (espera === null) {
        await cerrar(supabase, corrida.id, "fallada", `${detalle} (tras ${intentos} intentos)`);
        return "fallada";
      }

      // Vuelve a quedar en el paso que falló, no en el siguiente: los pasos
      // que ya salieron en esta vuelta no se repiten, y el que no salió se
      // intenta de nuevo. Sigue pendiente, así que no toca el índice único.
      await reintentar(supabase, corrida.id, actual, intentos, espera, detalle);
      return "reintento";
    }
    if (salio.clase === "envio") hubo = true;

    actual = rutaSiguiente(pasos, actual);
  }

  await cerrar(supabase, corrida.id, "hecha", null);
  return hubo ? "envio" : "hecha";
}

/**
 * Dónde retoma una corrida.
 *
 * Son tres casos y no dos porque "la ruta no resuelve" significa cosas
 * distintas según de dónde venga:
 *
 * - Con ruta guardada que no existe, alguien editó la automatización con la
 *   corrida a mitad de camino. Seguir desde otro lado sería mandar un paso que
 *   no es el que venía, así que se cancela y se dice por qué.
 * - Sin ruta, la corrida es anterior a las ramas y su cursor es el índice de
 *   siempre. Pasado el final no está perdida: está terminada, que es como
 *   quedaba una espera que era el último paso.
 */
type Arranque = { clase: "sigue"; ruta: Ruta } | { clase: "terminada" } | { clase: "perdida" };

function arranqueDe(corrida: FilaCorrida, pasos: Paso[]): Arranque {
  const guardada = leerRuta(corrida.ruta);

  if (guardada.length > 0) {
    return pasoEn(pasos, guardada) ? { clase: "sigue", ruta: guardada } : { clase: "perdida" };
  }

  if (corrida.paso >= pasos.length) return { clase: "terminada" };
  return { clase: "sigue", ruta: [corrida.paso] };
}

/**
 * Razones por las que ya no corresponde seguir.
 *
 * La condición de la etapa es la que hace útil a cualquier disparador con
 * espera: "a las 24 horas de entrar en Nuevo lead" quiere decir *si todavía
 * sigue ahí*. Si alguien ya lo atendió y lo movió, perseguirlo sería
 * contraproducente.
 *
 * Se vuelve a mirar en cada paso y no sólo al arrancar la corrida: entre un
 * paso y el siguiente pueden pasar días, y es justo ahí donde alguien mueve la
 * tarjeta de columna.
 */
async function motivoParaCortar(
  supabase: Supabase,
  corrida: FilaCorrida,
  automatizacion: FilaAutomatizacion,
  disparador: Disparador,
  {
    soloMeta,
    mudo,
    frenoLaIA,
  }: {
    soloMeta: boolean;
    mudo: boolean;
    /** La IA la frenó un paso de esta misma corrida, no una persona. */
    frenoLaIA: boolean;
  },
): Promise<string | null> {
  const { data: contacto } = await supabase
    .from("contacts")
    .select("archived_at, bot_enabled")
    .eq("id", corrida.contact_id)
    .maybeSingle();

  if (!contacto) return "El contacto ya no existe.";
  // Una conversión cuenta aunque el lead ya haya pasado a la columna siguiente
  // o alguien lo haya tomado a mano: llegó, y eso es lo que se mide.
  if (soloMeta) return null;
  if (contacto.archived_at) return "El contacto está archivado.";

  // Un recordatorio de cita se corta por lo que le pase a la cita, y por nada
  // más. Todos los cortes de abajo existen para no molestar a alguien que no
  // pidió nada; quien reservó una llamada sí pidió, y cada uno de ellos lo
  // único que lograría es que el aviso no llegue. Ver `esRecordatorioDeCita`.
  if (esRecordatorioDeCita(disparador)) {
    return await motivoParaCortarElRecordatorio(supabase, corrida);
  }

  // Los dos cortes que siguen existen para no escribirle a destiempo a alguien.
  // Sobre pasos que el lead no ve —repartirlo, avisarle a Meta— sólo hacen
  // daño: el que contesta enseguida es justo el que más falta que le hace tener
  // un responsable.
  if (!mudo) {
    // La IA frenada es alguien que tomó la conversación a mano. Mandar un
    // automático encima pisaría ese trabajo. Salvo que la haya frenado esta
    // misma secuencia: ahí seguir con sus pasos es justamente lo que se armó.
    if (contacto.bot_enabled === false && !frenoLaIA) {
      return "Alguien tomó la conversación a mano.";
    }

    if (automatizacion.cancelar_si_responde) {
      const { data: respuesta } = await supabase
        .from("messages")
        .select("id, conversations!inner(contact_id, workspace_id)")
        .eq("conversations.contact_id", corrida.contact_id)
        .eq("conversations.workspace_id", corrida.workspace_id)
        .eq("sender_type", "contact")
        .gt("created_at", corrida.created_at)
        .limit(1)
        .maybeSingle();

      if (respuesta) return "El contacto respondió.";
    }
  }

  // Las dos condiciones de etapa se resuelven con una sola lectura: el
  // disparador por columna exige la suya y la condición de alcance la suya, y
  // pueden estar las dos puestas.
  const exigidas = [
    disparador.tipo === "etapa" ? disparador.stageId : null,
    leerEtapaRequerida(automatizacion.etapa_requerida),
  ].filter((valor): valor is string => valor !== null);

  if (exigidas.length > 0) {
    const etapa = await etapaActual(supabase, corrida.workspace_id, corrida.contact_id);
    if (exigidas.some((exigida) => etapa !== exigida)) return "El lead ya no está en esa etapa.";
  }

  return null;
}

/**
 * Razones por las que un recordatorio ya no corresponde.
 *
 * Son tres, y las tres miran la cita:
 *
 * - **La cita ya no está o se canceló.** El webhook de Calendar cancela las
 *   corridas al dar de baja, así que llegar acá quiere decir que la cancelaron
 *   desde el CRM, o que el webhook no llegó. Se mira igual: el flujo 3 entero
 *   existe para que una llamada borrada no avise.
 *
 * - **La cita se movió.** Misma idea: el horario guardado en la corrida ya no
 *   es el de la cita, así que este aviso hablaría de un horario que no existe.
 *   El recordatorio del horario nuevo lo anota el barrido.
 *
 * - **La cita ya empezó.** Un "te recuerdo tu llamada de las 10" a las 10:20 no
 *   es un recordatorio tarde: es una molestia. Se descarta.
 */
async function motivoParaCortarElRecordatorio(
  supabase: Supabase,
  corrida: FilaCorrida,
): Promise<string | null> {
  if (!corrida.appointment_id) return null;

  const { data: cita } = await supabase
    .from("appointments")
    .select("start_time, status")
    .eq("id", corrida.appointment_id)
    .maybeSingle();

  if (!cita) return "La cita ya no existe.";
  if (cita.status !== "scheduled") return "La cita está cancelada.";

  const inicio = new Date(cita.start_time as string).getTime();
  if (!Number.isFinite(inicio)) return "La cita tiene un horario ilegible.";

  const anotado = corrida.cita_inicio ? new Date(corrida.cita_inicio).getTime() : null;
  if (anotado !== null && anotado !== inicio) {
    return "La cita se movió: este recordatorio hablaba del horario viejo.";
  }

  if (Date.now() >= inicio) return "La cita ya empezó.";

  return null;
}

/* ---------------------------------------------------------------- condición */

/**
 * Por qué rama sigue una condición.
 *
 * Las cuatro pruebas miran el estado de *ahora*, no el de cuando la corrida
 * arrancó: entre el disparo y la condición pueden haber pasado días, y eso es
 * justamente lo que las hace valer la pena.
 *
 * Una consulta que no trae nada se lee como que no se cumple, igual que en
 * `motivoParaCortar`. No es una elección cómoda sino la única que no inventa:
 * la rama del sí es la del desvío —"está en Ganado", "contestó"—, así que
 * ante la duda la secuencia sigue derecho, que es lo que venía haciendo antes
 * de que la condición existiera.
 */
async function evaluarPrueba(
  supabase: Supabase,
  prueba: Prueba,
  corrida: FilaCorrida,
): Promise<boolean> {
  switch (prueba.tipo) {
    case "etapa": {
      const etapa = await etapaActual(supabase, corrida.workspace_id, corrida.contact_id);
      return etapa !== null && prueba.stageIds.includes(etapa);
    }

    case "respondio": {
      const ultimo = await ultimoDelContacto(supabase, corrida);
      if (ultimo === null) return false;

      const arranque = new Date(corrida.created_at).getTime();
      // Una corrida con fecha ilegible no puede decidir si el mensaje es
      // posterior a ella: cuenta como que no respondió.
      return Number.isFinite(arranque) && ultimo > arranque;
    }

    case "ventana": {
      const ultimo = await ultimoDelContacto(supabase, corrida);
      if (ultimo === null) return false;
      return Date.now() - ultimo < VENTANA_WHATSAPP_MINUTOS * 60_000;
    }

    case "con_responsable": {
      const { data } = await supabase
        .from("contacts")
        .select("assigned_to")
        .eq("id", corrida.contact_id)
        .maybeSingle();

      return Boolean((data as { assigned_to?: string | null } | null)?.assigned_to);
    }
  }
}

/**
 * Cuándo habló el contacto por última vez, en milisegundos. Null si nunca.
 *
 * Es el ancla de dos pruebas: `respondio` la compara con el arranque de la
 * corrida y `ventana` con las 24 horas de Meta. Mira los mensajes del contacto
 * en todas sus conversaciones del workspace y no sólo en la del disparo,
 * porque la ventana es del contacto: si escribió por el otro canal, escribió.
 */
async function ultimoDelContacto(
  supabase: Supabase,
  corrida: FilaCorrida,
): Promise<number | null> {
  const { data } = await supabase
    .from("messages")
    .select("created_at, conversations!inner(contact_id, workspace_id)")
    .eq("conversations.contact_id", corrida.contact_id)
    .eq("conversations.workspace_id", corrida.workspace_id)
    .eq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cuando = (data as { created_at?: string } | null)?.created_at;
  if (!cuando) return null;

  const momento = new Date(cuando).getTime();
  return Number.isFinite(momento) ? momento : null;
}

/* --------------------------------------------------------------------- pasos */

type Destino = {
  datos: DatosDelContacto;
  conversationId: string | null;
  /** Por qué canal sale. Decide con qué instrucciones redacta la IA. */
  channel: Channel | null;
  chatId: string | null;
  accountId: string | null;
  provider: string | null;
};

async function destinoDe(supabase: Supabase, corrida: FilaCorrida): Promise<Destino> {
  const contactId = corrida.contact_id;
  const workspaceId = corrida.workspace_id;

  const { data: contacto } = await supabase
    .from("contacts")
    .select("name, phone, email")
    .eq("id", contactId)
    .maybeSingle();

  // El que reservó por Calendar nunca escribió por WhatsApp, así que no tiene
  // conversación: sin esto, *todos* los recordatorios fallarían con "el
  // contacto no tiene por dónde recibir". Ver `charlaParaElRecordatorio`.
  const charla = corrida.appointment_id
    ? await charlaParaElRecordatorio(supabase, corrida, contacto?.phone ?? null)
    : await conversacionDe(supabase, corrida);

  const { data: oportunidad } = await supabase
    .from("opportunities")
    .select("pipeline_stages(name)")
    .eq("contact_id", contactId)
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  const etapa = (oportunidad as { pipeline_stages?: unknown } | null)?.pipeline_stages;
  const nombreEtapa = Array.isArray(etapa) ? etapa[0]?.name : (etapa as { name?: string } | null)?.name;

  return {
    datos: {
      nombre: contacto?.name ?? "",
      telefono: contacto?.phone ?? null,
      email: contacto?.email ?? null,
      etapa: nombreEtapa ?? null,
      cita: await datosDeLaCita(supabase, corrida),
    },
    conversationId: charla?.id ?? null,
    channel: charla?.channel ?? null,
    chatId: charla?.zernio_chat_id ?? null,
    accountId: charla?.zernio_account_id ?? null,
    provider: charla?.provider ?? null,
  };
}

/**
 * Por dónde sale un recordatorio.
 *
 * Quien reserva por Calendar entra al CRM por el webhook, no por un mensaje: no
 * tiene conversación, y `enviar` sin conversación falla. Así que si no hay, se
 * abre una de WAHA con el teléfono de la reserva.
 *
 * **Por qué WAHA y no la conversación que ya exista.** Un recordatorio tiene
 * que salir sí o sí, y las 24 horas de Meta lo hacen imposible por el canal
 * oficial: quien reservó por un formulario nunca escribió, así que la ventana
 * está cerrada desde el primer día y sólo entraría una plantilla aprobada.
 * WAHA no tiene esa restricción. El costo es real y conviene tenerlo a la
 * vista: si el contacto ya venía hablando por YCloud, el recordatorio sale por
 * el otro canal y en el CRM quedan dos conversaciones —del lado del cliente es
 * el mismo WhatsApp si el número es el mismo—. Cuando estén aprobadas las
 * plantillas, esto es lo que hay que cambiar.
 */
async function charlaParaElRecordatorio(
  supabase: Supabase,
  corrida: FilaCorrida,
  telefono: string | null,
): Promise<Charla | null> {
  // La IA queda frenada en este contacto, salga por el chat que salga.
  //
  // Lo que viene después de un recordatorio es la respuesta a un recordatorio:
  // "no voy a poder", "¿lo pasamos al jueves?", "¿dónde era?". Eso lo tiene que
  // leer alguien, no un agente de ventas que no sabe de la cita y va a
  // contestar cualquier cosa.
  //
  // Se apaga en cada aviso y no sólo al abrir la conversación: quien ya venía
  // hablando por WhatsApp —el caso más común en cuanto el CRM lleva un tiempo
  // andando— tiene su chat de antes, y ahí la rama de creación nunca corría.
  //
  // El costo es que, si alguien prende la IA a mano, el próximo recordatorio se
  // la vuelve a apagar. Se prende de nuevo con un clic en la ficha, y es
  // preferible a que el bot conteste una cancelación de turno.
  await supabase
    .from("contacts")
    .update({ bot_enabled: false })
    .eq("id", corrida.contact_id)
    .eq("workspace_id", corrida.workspace_id);

  const { data } = await supabase
    .from("conversations")
    .select(CAMPOS_CHARLA)
    .eq("contact_id", corrida.contact_id)
    .eq("workspace_id", corrida.workspace_id)
    .eq("provider", "waha")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) return data as Charla;

  const chatId = chatDeWhatsapp(telefono);
  if (!chatId) return null;

  const cuenta = `waha:${(process.env.WAHA_SESSION ?? "default").trim() || "default"}`;

  // Se abre antes de mandar y no después —al revés que en difusiones— porque
  // acá el mensaje se guarda en el historial de esa misma conversación, y hace
  // falta tenerla. Un número inválido deja un chat vacío; a cambio, cuando el
  // cliente conteste el recordatorio, la respuesta cae en el chat que ya está.
  const { data: creada, error } = await supabase
    .from("conversations")
    .insert({
      workspace_id: corrida.workspace_id,
      contact_id: corrida.contact_id,
      channel: "whatsapp",
      provider: "waha",
      zernio_chat_id: chatId,
      zernio_account_id: cuenta,
      status: "open",
    })
    .select(CAMPOS_CHARLA)
    .single();

  if (!error) return creada as Charla;

  // El número ya estaba tomado por otra conversación del workspace: es el mismo
  // WhatsApp aunque figure con dos fichas.
  const { data: existente } = await supabase
    .from("conversations")
    .select(CAMPOS_CHARLA)
    .eq("workspace_id", corrida.workspace_id)
    .eq("zernio_chat_id", chatId)
    .maybeSingle();

  if (existente) return existente as Charla;

  console.error("[automatizaciones] no se pudo abrir la conversación:", error.message);
  return null;
}

/**
 * La cita de la que habla el recordatorio, ya escrita para leer.
 *
 * La fecha y la hora se arman en la zona del workspace y no en UTC: un
 * "mañana a las 15:00" corrido tres horas es peor que no mandar nada.
 */
async function datosDeLaCita(
  supabase: Supabase,
  corrida: FilaCorrida,
): Promise<DatosDeLaCita | null> {
  if (!corrida.appointment_id) return null;

  const { data } = await supabase
    .from("appointments")
    .select("title, start_time, calendar_link")
    .eq("id", corrida.appointment_id)
    .maybeSingle();

  if (!data) return null;

  const inicio = new Date(data.start_time as string);
  if (!Number.isFinite(inicio.getTime())) return null;

  const zona = await zonaDelWorkspace(supabase, corrida.workspace_id);

  return {
    fecha: new Intl.DateTimeFormat("es-AR", {
      timeZone: zona,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(inicio),
    hora: new Intl.DateTimeFormat("es-AR", {
      timeZone: zona,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(inicio),
    titulo: (data.title as string) ?? "",
    link: (data.calendar_link as string | null) ?? null,
  };
}

type Charla = {
  id: string;
  channel: Channel | null;
  zernio_chat_id: string | null;
  zernio_account_id: string | null;
  provider: string | null;
};

const CAMPOS_CHARLA = "id, channel, zernio_chat_id, zernio_account_id, provider";

/**
 * Por qué conversación sale la corrida.
 *
 * Manda la que quedó anotada al programarla. La misma persona puede tener
 * abierto WhatsApp e Instagram —el CRM las une en un solo contacto a
 * propósito— y elegir siempre la última movida mandaba el follow-up del
 * silencio de un canal por el otro, que además es el que sigue vivo y por eso
 * quedó más reciente.
 *
 * Sin anotar —`etapa` y `lead_nuevo` disparan sobre el contacto, no sobre una
 * charla— o si esa conversación ya no está, se cae a la última movida: es la
 * que la persona tiene a la vista.
 */
async function conversacionDe(supabase: Supabase, corrida: FilaCorrida): Promise<Charla | null> {
  if (corrida.conversation_id) {
    const { data } = await supabase
      .from("conversations")
      .select(CAMPOS_CHARLA)
      .eq("id", corrida.conversation_id)
      .maybeSingle();

    if (data) return data as Charla;
  }

  const { data } = await supabase
    .from("conversations")
    .select(CAMPOS_CHARLA)
    .eq("contact_id", corrida.contact_id)
    .eq("workspace_id", corrida.workspace_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Charla | null) ?? null;
}

/**
 * Cómo terminó un paso.
 *
 * `error` lleva el motivo escrito. Antes un envío que no salía devolvía "nada"
 * y la corrida se cerraba como hecha: desde afuera, un mensaje entregado y uno
 * que nunca salió se veían igual, y la única pista quedaba en los logs de
 * Vercel. Ahora el motivo queda en la fila, que es donde se lo busca.
 */
type Salida =
  | { clase: "envio" }
  | { clase: "nada" }
  | { clase: "corta" }
  | { clase: "error"; detalle: string };

async function ejecutarPaso(
  supabase: Supabase,
  contexto: {
    paso: Paso;
    automatizacion: FilaAutomatizacion;
    corrida: FilaCorrida;
    destino: Destino;
  },
): Promise<Salida> {
  const { paso, automatizacion, corrida, destino } = contexto;

  switch (paso.tipo) {
    // Los dos pasos que no hacen nada acá: el recorrido los resuelve antes de
    // llamar —la espera posponiendo la corrida, la condición eligiendo rama—.
    // Están igual para que el switch siga cubriendo todos los tipos, que es lo
    // que hace que agregar uno nuevo falle al compilar en vez de en el cron.
    case "esperar":
    case "condicion":
      return { clase: "nada" };

    case "mover": {
      const antes = await etapaActual(supabase, corrida.workspace_id, corrida.contact_id);
      await supabase
        .from("opportunities")
        .update({ stage_id: paso.stageId })
        .eq("contact_id", corrida.contact_id)
        .eq("workspace_id", corrida.workspace_id);

      // Entrar en la columna por una automatización es entrar igual. Sin esto
      // lo que depende de esa columna —la conversión de Meta, sobre todo— se
      // enteraba sólo si la tarjeta la movía una persona. Si ya estaba ahí no
      // se dispara nada, igual que al soltar una tarjeta en su misma columna.
      //
      // Lo que se anote acá espera al reloj aunque sea "al instante", y no se
      // adelanta con `ejecutarYa`: sería atender una corrida adentro de otra, y
      // la de afuera todavía tiene pasos por delante.
      if (antes !== paso.stageId) {
        await programarPorEtapa(supabase, {
          workspaceId: corrida.workspace_id,
          contactId: corrida.contact_id,
          stageId: paso.stageId,
        });
      }
      return { clase: "nada" };
    }

    case "meta": {
      const resultado = await enviarConversion(supabase, {
        workspaceId: corrida.workspace_id,
        contactId: corrida.contact_id,
        automationId: automatizacion.id,
        evento: paso.evento,
        conValor: paso.conValor,
      });
      return resultado.clase === "error"
        ? { clase: "error", detalle: resultado.detalle }
        : { clase: "nada" };
    }

    case "avisar": {
      // El aviso interno viaja como una nota en el propio hilo: es donde lo va
      // a ver quien atienda, sin inventar otra bandeja para mirar.
      if (!destino.conversationId) {
        return { clase: "error", detalle: "El contacto no tiene ninguna conversación abierta." };
      }
      await supabase.from("messages").insert({
        conversation_id: destino.conversationId,
        sender_type: "ai",
        content: `⚙️ ${reemplazarTokens(paso.texto, destino.datos, "borrar")}`,
        automation_id: automatizacion.id,
      });
      return { clase: "nada" };
    }

    case "asignar":
      return repartir(supabase, { paso, automatizacion, corrida });

    case "frenar_ia": {
      const { error } = await supabase
        .from("contacts")
        .update({ bot_enabled: false })
        .eq("id", corrida.contact_id)
        .eq("workspace_id", corrida.workspace_id);
      // Sale por el reintento como un envío fallido: si no quedó frenada, lo
      // que siga en la secuencia daría por hecho algo que no pasó, y el agente
      // le contestaría al contacto lo que tenía que leer una persona.
      return error
        ? { clase: "error", detalle: `No se pudo frenar la IA: ${error.message}` }
        : { clase: "nada" };
    }

    case "texto":
    case "audio":
    case "ia":
    case "plantilla": {
      // El tope diario frena secuencias de venta que se solapan. Un
      // recordatorio no compite por esa cuota: tres avisos de una cita —al
      // reservar, 24 horas antes y una hora antes— son exactamente lo pedido, y
      // el tope descartaría en silencio el último, que es el que más importa.
      if (!corrida.appointment_id && (await llegoAlTope(supabase, corrida.contact_id))) {
        return { clase: "corta" };
      }
      return enviar(supabase, { ...contexto, paso });
    }
  }
}

/* ------------------------------------------------------------------ reparto */

/**
 * Le pone responsable al lead.
 *
 * Tres cosas que este paso no hace, y cada una tiene su motivo:
 *
 * No pisa un responsable que ya esté puesto. Repartir sirve para los leads que
 * no tiene nadie; sobre uno ya asignado, reasignarlo es sacárselo a quien lo
 * está atendiendo.
 *
 * No se salta el turno de nadie. Quien está fuera de sus días u horas no entra
 * en la rotación: se le repartiría un lead que no va a mirar hasta el lunes.
 *
 * No deja un lead sin dueño. Si no hay nadie en horario —el domingo, la
 * madrugada— cae en el responsable de respaldo. Un lead sin dueño no aparece en
 * la bandeja de nadie, que es peor que caerle al que no le tocaba.
 */
async function repartir(
  supabase: Supabase,
  contexto: {
    paso: Extract<Paso, { tipo: "asignar" }>;
    automatizacion: FilaAutomatizacion;
    corrida: FilaCorrida;
  },
): Promise<Salida> {
  const { paso, automatizacion, corrida } = contexto;

  const { data: contacto } = await supabase
    .from("contacts")
    .select("assigned_to")
    .eq("id", corrida.contact_id)
    .maybeSingle();

  if (contacto?.assigned_to) return { clase: "nada" };

  // Alguien que salió del workspace sigue escrito en el paso —nadie edita las
  // automatizaciones al dar de baja a una persona— y asignarle leads los
  // mandaría a una bandeja que ya no mira nadie.
  const miembros = await miembrosDe(supabase, corrida.workspace_id);
  const enLaCasa = paso.candidatos.filter((candidato) => miembros.has(candidato.userId));

  const zona = await zonaDelWorkspace(supabase, corrida.workspace_id, automatizacion.zona);
  const enTurno = disponibles(enLaCasa, new Date(), zona);

  const elegido = enTurno.length
    ? await rotar(supabase, {
        workspaceId: corrida.workspace_id,
        automationId: automatizacion.id,
        modo: paso.modo,
        candidatos: enTurno,
      })
    : null;

  const responsable = elegido ?? (await respaldoDe(supabase, corrida.workspace_id, miembros));
  if (!responsable) {
    return { clase: "error", detalle: "No hay a quién asignarle el lead." };
  }

  const { error } = await supabase
    .from("contacts")
    .update({ assigned_to: responsable })
    .eq("id", corrida.contact_id)
    .eq("workspace_id", corrida.workspace_id);

  if (error) return { clase: "error", detalle: error.message.slice(0, 300) };

  // El registro es el estado de la rotación: sin esto la próxima vuelta vuelve
  // a elegir a la misma persona.
  const { error: sinRegistro } = await supabase.from("automation_asignaciones").insert({
    workspace_id: corrida.workspace_id,
    automation_id: automatizacion.id,
    contact_id: corrida.contact_id,
    user_id: responsable,
    respaldo: elegido === null,
  });

  if (sinRegistro) {
    console.error("[automatizaciones] el lead se asignó pero no se registró:", sinRegistro.message);
  }

  return { clase: "nada" };
}

/** Los ids de quienes siguen siendo parte del workspace. */
async function miembrosDe(supabase: Supabase, workspaceId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId);

  return new Set((data ?? []).map((fila) => (fila as { user_id: string }).user_id));
}

/**
 * Quién se queda con los leads que la rotación no puede colocar.
 *
 * El dueño del workspace primero y un admin después: es quien puede reasignarlo
 * a mano el lunes a la mañana. Se elige el más antiguo para que dos admins no
 * se turnen el respaldo según cómo venga ordenada la consulta.
 */
async function respaldoDe(
  supabase: Supabase,
  workspaceId: string,
  miembros: Set<string>,
): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"])
    .order("created_at", { ascending: true });

  const filas = (data ?? []) as { user_id: string; role: string }[];
  const elegible = filas.filter((fila) => miembros.has(fila.user_id));

  return (
    elegible.find((fila) => fila.role === "owner")?.user_id ?? elegible[0]?.user_id ?? null
  );
}

/**
 * Le pregunta al registro a quién le toca.
 *
 * El modo `carga` cuenta leads activos y los otros dos leen el historial del
 * reparto, así que se consulta sólo lo que el modo elegido necesita.
 */
async function rotar(
  supabase: Supabase,
  input: {
    workspaceId: string;
    automationId: string;
    modo: ModoDeReparto;
    candidatos: Candidato[];
  },
): Promise<string | null> {
  const { workspaceId, automationId, modo, candidatos } = input;
  const estados = new Map<string, EstadoDelReparto>();
  const vacio: EstadoDelReparto = { asignados: 0, ultima: null, carga: 0 };
  const guardar = (userId: string, cambio: Partial<EstadoDelReparto>) =>
    estados.set(userId, { ...(estados.get(userId) ?? vacio), ...cambio });

  if (modo === "carga") {
    // Una consulta por persona y no un agrupado: son pocas, PostgREST no
    // agrupa, y traer todos los contactos del workspace para contarlos en
    // memoria es peor a medida que la base crece.
    await Promise.all(
      candidatos.map(async (candidato) => {
        const { count } = await supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("assigned_to", candidato.userId)
          .is("archived_at", null);

        guardar(candidato.userId, { carga: count ?? 0 });
      }),
    );
  } else {
    const { data } = await supabase
      .from("automation_asignaciones")
      .select("user_id, created_at")
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(HISTORIAL_REPARTO);

    for (const fila of (data ?? []) as { user_id: string; created_at: string }[]) {
      const previo = estados.get(fila.user_id) ?? vacio;
      guardar(fila.user_id, {
        asignados: previo.asignados + 1,
        // Vienen de la más nueva a la más vieja: la primera de cada persona es
        // su última asignación.
        ultima: previo.ultima ?? new Date(fila.created_at).getTime(),
      });
    }
  }

  return elegirResponsable(modo, candidatos, (userId) => estados.get(userId) ?? vacio);
}

/**
 * Tope de mensajes automáticos por contacto y por día.
 *
 * Se cuenta sobre `messages.automation_id` y no sobre las corridas porque una
 * corrida puede mandar varios. Es un tope de toda la cuenta, no de cada
 * automatización: dos secuencias que se solapan son justamente el caso que hay
 * que frenar.
 */
async function llegoAlTope(supabase: Supabase, contactId: string): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const { count } = await supabase
    .from("messages")
    .select("id, conversations!inner(contact_id)", { count: "exact", head: true })
    .eq("conversations.contact_id", contactId)
    .not("automation_id", "is", null)
    .gte("created_at", desde);

  return (count ?? 0) >= MAX_AUTOMATICOS_POR_DIA;
}

/** Los pasos que hablan con el contacto. Los otros no pasan por acá. */
type PasoDeEnvio = Extract<Paso, { tipo: "texto" | "audio" | "ia" | "plantilla" }>;

async function enviar(
  supabase: Supabase,
  contexto: {
    paso: PasoDeEnvio;
    automatizacion: FilaAutomatizacion;
    corrida: FilaCorrida;
    destino: Destino;
  },
): Promise<Salida> {
  const { paso, automatizacion, destino } = contexto;

  if (!destino.conversationId || !destino.chatId || !destino.accountId) {
    return {
      clase: "error",
      detalle: "El contacto no tiene por dónde recibir: falta la conversación o la cuenta.",
    };
  }

  const coordenadas = {
    provider: destino.provider,
    conversationId: destino.chatId,
    accountId: destino.accountId,
  };

  if (paso.tipo === "audio") {
    // El archivo ya está guardado desde que se armó la automatización: acá sólo
    // se pasa el enlace. Los tokens no entran —un audio grabado no se completa
    // con el nombre de nadie— y lo que queda en el historial es la
    // transcripción que se hizo al subirlo.
    //
    // Instagram y Messenger rechazan el OGG: para ellos sale la versión WAV.
    const porWhatsapp = (destino.channel ?? "whatsapp") === "whatsapp";
    const audioUrl = porWhatsapp ? paso.url : paso.urlWav;
    if (!audioUrl) {
      return {
        clase: "error",
        detalle:
          "Este audio no tiene versión para Instagram ni Messenger: abrí la automatización, tocá «Preparar para Instagram y Messenger» en el paso y guardá.",
      };
    }

    const salio = await enviarAudio({
      ...coordenadas,
      audioUrl,
      voiceNote: porWhatsapp && esNotaDeVoz(audioUrl),
    });

    if (!salio.ok) {
      console.error("[automatizaciones] no salió el audio:", salio.error);
      return { clase: "error", detalle: salio.error.slice(0, 300) };
    }

    await guardar(supabase, {
      conversationId: destino.conversationId,
      automationId: automatizacion.id,
      texto: paso.texto,
      mediaUrl: audioUrl,
      messageId: salio.messageId,
      marcarSinLeer: marcaSinLeer(paso),
    });
    return { clase: "envio" };
  }

  if (paso.tipo === "plantilla") {
    const plantilla = await buscarPlantilla(paso.nombre, paso.idioma);
    if (!plantilla) {
      return { clase: "error", detalle: `La plantilla "${paso.nombre}" ya no está aprobada.` };
    }

    // Acá los huecos sin dato se dejan escritos, al revés que en el texto
    // libre: una variable de plantilla no puede ir vacía —Meta rechaza el
    // envío entero— y un recordatorio que no sale es peor que uno con un hueco
    // a la vista. Se arregla de verdad el día que el dato no falte.
    const valores = Object.fromEntries(
      Object.entries(paso.valores).map(([clave, valor]) => [
        clave,
        reemplazarTokens(valor, destino.datos),
      ]),
    );

    const armado = textoDePlantilla(plantilla, valores);

    // Las plantillas aprobadas son de WhatsApp oficial. En Instagram y en
    // Messenger no existen, y hasta acá el paso fallaba y cortaba la secuencia
    // entera: la misma automatización servía o no según por dónde hubiera
    // escrito la persona, que es exactamente lo que no tiene que decidir el
    // canal. Se manda el texto ya resuelto, que es lo que la plantilla iba a
    // decir. Pierde los botones y la imagen del encabezado, y necesita estar
    // dentro de las 24 horas: fuera de eso esos canales no admiten nada, con
    // plantilla o sin ella.
    const comoTexto = !admitePlantillas(destino.provider);
    if (comoTexto && !armado) {
      return {
        clase: "error",
        detalle: `La plantilla "${paso.nombre}" no tiene texto que mandar por este canal.`,
      };
    }

    const salio = comoTexto
      ? await enviarTexto({ ...coordenadas, text: armado })
      : await enviarPlantilla({
          ...coordenadas,
          nombre: plantilla.nombre,
          idioma: plantilla.idioma,
          components: componentesParaEnviar(plantilla, valores),
        });

    if (!salio.ok) {
      console.error("[automatizaciones] no salió la plantilla:", salio.error);
      return { clase: "error", detalle: salio.error.slice(0, 300) };
    }

    await guardar(supabase, {
      conversationId: destino.conversationId,
      automationId: automatizacion.id,
      texto: armado,
      messageId: salio.messageId,
      marcarSinLeer: marcaSinLeer(paso),
    });
    return { clase: "envio" };
  }

  const texto =
    paso.tipo === "texto"
      ? reemplazarTokens(paso.texto, destino.datos, "borrar")
      : await redactar(supabase, contexto.corrida, destino, paso.instruccion);

  if (!texto) {
    return { clase: "error", detalle: "No hubo texto que mandar: el modelo no contestó." };
  }

  const salio = await enviarTexto({ ...coordenadas, text: texto });
  if (!salio.ok) {
    console.error("[automatizaciones] no salió el mensaje:", salio.error);
    return { clase: "error", detalle: salio.error.slice(0, 300) };
  }

  await guardar(supabase, {
    conversationId: destino.conversationId,
    automationId: automatizacion.id,
    texto,
    messageId: salio.messageId,
    marcarSinLeer: marcaSinLeer(paso),
  });
  return { clase: "envio" };
}

function textoDePlantilla(plantilla: Plantilla, valores: Record<string, string>): string {
  // Se arma acá y no se importa `vistaPrevia` para no arrastrar la dependencia
  // de UI: es la misma cuenta.
  return plantilla.componentes
    .filter((c) => (c.tipo === "header" ? c.formato === "text" : c.tipo !== "buttons"))
    .map((c) =>
      c.texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (original, numero: string) => {
        const clave = c.tipo === "header" ? `header.${numero}` : `body.${numero}`;
        return valores[clave] || original;
      }),
    )
    .filter(Boolean)
    .join("\n\n");
}

async function buscarPlantilla(nombre: string, idioma: string): Promise<Plantilla | null> {
  const listado = await listYcloudTemplates();
  if (!listado.ok) {
    console.error("[automatizaciones] no se pudieron leer las plantillas:", listado.error);
    return null;
  }
  return (
    listado.plantillas.find(
      (p) => p.nombre === nombre && p.idioma === idioma && p.estado === "APPROVED",
    ) ?? null
  );
}

/**
 * Le pide al modelo el texto del paso.
 *
 * Usa las mismas instrucciones del agente del workspace más la consigna del
 * paso, para que un mensaje automático no suene distinto a los que la IA manda
 * contestando. Si algo falta —no hay agente configurado, no hay historial— no
 * inventa: devuelve vacío y el paso pasa sin enviar.
 */
async function redactar(
  supabase: Supabase,
  corrida: FilaCorrida,
  destino: Destino,
  instruccion: string,
): Promise<string> {
  const { data: config } = await supabase
    .from("ai_agent_configs")
    .select("model_version")
    .eq("workspace_id", corrida.workspace_id)
    .limit(1)
    .maybeSingle();

  // Las instrucciones salen del canal por el que va a salir el mensaje, que es
  // el mismo criterio que usa la respuesta automática. Sin conversación —el que
  // reservó por Calendar y nunca escribió— el recordatorio sale por WhatsApp,
  // así que ése es el agente que corresponde.
  const base = promptDelCanal(destino.channel ?? "whatsapp");
  if (!base) {
    console.log("[automatizaciones] el canal no tiene instrucciones para redactar");
    return "";
  }

  const { data: historial } = await supabase
    .from("messages")
    .select("sender_type, content")
    .eq("conversation_id", destino.conversationId ?? "")
    .order("created_at", { ascending: false })
    .limit(HISTORIAL);

  const turnos: ChatTurn[] = [
    {
      role: "system",
      content:
        `${base}\n\n` +
        "Estás escribiendo vos primero, sin que la persona haya dicho nada nuevo. " +
        "Mandá un solo mensaje, breve y natural, sin saludar como si fuera el " +
        `primer contacto si el historial muestra que ya hablaron.\n\nConsigna: ${reemplazarTokens(instruccion, destino.datos, "borrar")}`,
    },
    ...(historial ?? [])
      .reverse()
      .filter((fila) => typeof fila.content === "string" && fila.content.trim())
      .map((fila) => ({
        role: fila.sender_type === "contact" ? ("user" as const) : ("assistant" as const),
        content: fila.content as string,
      })),
  ];

  const respuesta = await completeChatServer({
    model: config?.model_version || "gpt-5",
    messages: turnos,
  });

  if (!respuesta.ok) {
    console.error("[automatizaciones] el modelo no contestó:", respuesta.error);
    return "";
  }

  return respuesta.text.trim();
}

async function guardar(
  supabase: Supabase,
  input: {
    conversationId: string;
    automationId: string;
    texto: string;
    /** El audio enviado, para que la bandeja lo muestre con su reproductor. */
    mediaUrl?: string;
    messageId?: string;
    /** Dejar el chat marcado en la bandeja, sin esperar que el contacto conteste. */
    marcarSinLeer?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: input.conversationId,
    sender_type: "user",
    content: input.texto,
    media_url: input.mediaUrl ?? null,
    zernio_message_id: input.messageId ?? null,
    automation_id: input.automationId,
  });

  if (error) {
    console.error("[automatizaciones] el mensaje salió pero no se guardó:", error.message);
    // Sin mensaje guardado no se marca nada: el chat quedaría llamando la
    // atención sobre algo que no está en el historial.
    return;
  }

  if (input.marcarSinLeer) await marcarChat(supabase, input.conversationId);
}

/**
 * Sube en uno el contador de sin leer de la conversación.
 *
 * Es el mismo contador que mueve un mensaje entrante, a propósito: así el chat
 * aparece en la bandeja con el globito de siempre y se apaga solo cuando
 * alguien lo abre, sin inventar un segundo estado que haya que aprender a
 * mirar.
 *
 * Va con lectura y escritura por separado, igual que `entrante.ts`. Dos
 * mensajes a la vez sobre el mismo chat podrían pisarse y contar uno en vez de
 * dos; el costo de ese empate es un número, no el aviso, que es lo que
 * importa.
 */
async function marcarChat(supabase: Supabase, conversationId: string): Promise<void> {
  const { data } = await supabase
    .from("conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .maybeSingle();

  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: (data?.unread_count ?? 0) + 1 })
    .eq("id", conversationId);

  if (error) console.error("[automatizaciones] no se pudo marcar el chat:", error.message);
}

/* -------------------------------------------------------------------- estado */

/**
 * Toma la corrida para esta vuelta, o devuelve false si otra se le adelantó.
 *
 * El candado es la propia hora: correrla hacia adelante la saca del alcance de
 * cualquier otra vuelta. Postgres resuelve un `update ... where` de a una, así
 * que de dos corredores simultáneos exactamente uno cambia la fila y el otro no
 * toca ninguna.
 *
 * No hace falta soltarla: toda salida de `atender` reescribe `corre_en` —al
 * posponer o al reintentar— o cierra la corrida. Si el proceso se cae a mitad,
 * la reserva vence sola y la corrida vuelve a la cola.
 */
async function reservar(supabase: Supabase, id: string, vencidaHasta: string): Promise<boolean> {
  const { data } = await supabase
    .from("automation_runs")
    .update({
      corre_en: new Date(Date.now() + RESERVA_DE_LA_CORRIDA_MINUTOS * 60_000).toISOString(),
    })
    .eq("id", id)
    .eq("estado", "pendiente")
    .lte("corre_en", vencidaHasta)
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

async function posponer(
  supabase: Supabase,
  id: string,
  ruta: Ruta,
  corre: Date,
): Promise<void> {
  await supabase
    .from("automation_runs")
    .update({
      ...cursor(ruta),
      corre_en: corre.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Las dos columnas que ubican la corrida.
 *
 * `ruta` es la que se lee. `paso` se sigue escribiendo con el índice del nivel
 * de arriba porque deja la fila legible mirándola a mano, y porque si hubiera
 * que volver atrás el deploy las corridas en curso retoman más o menos donde
 * estaban en vez de quedarse mudas.
 */
function cursor(ruta: Ruta): { paso: number; ruta: string } {
  const cabeza = ruta[0];
  return { paso: typeof cabeza === "number" ? cabeza : 0, ruta: escribirRuta(ruta) };
}

/**
 * Deja la corrida lista para volver a intentar el paso que no salió.
 *
 * Se queda en `pendiente` y sólo se mueve `corre_en`, así que el índice único
 * de "una sola corrida activa" ni se entera. El detalle se escribe igual que
 * en un cierre: si al final se agota, lo último que se lea va a ser el motivo
 * real y no un "falló" pelado.
 */
async function reintentar(
  supabase: Supabase,
  id: string,
  ruta: Ruta,
  intentos: number,
  esperaMinutos: number,
  detalle: string,
): Promise<void> {
  console.warn(
    `[automatizaciones] no salió, se reintenta en ${esperaMinutos} min (intento ${intentos}):`,
    detalle,
  );

  await supabase
    .from("automation_runs")
    .update({
      ...cursor(ruta),
      intentos,
      corre_en: new Date(Date.now() + esperaMinutos * 60_000).toISOString(),
      detalle: `${detalle} — se reintenta en ${esperaMinutos} min.`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function cerrar(
  supabase: Supabase,
  id: string,
  estado: "hecha" | "cancelada" | "fallada",
  detalle: string | null,
): Promise<void> {
  await supabase
    .from("automation_runs")
    .update({ estado, detalle, updated_at: new Date().toISOString() })
    .eq("id", id);
}
