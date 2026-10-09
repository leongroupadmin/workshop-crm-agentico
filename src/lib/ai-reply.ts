import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_REPLY_DELAY_SECONDS,
  MAX_REPLY_DELAY_SECONDS,
  MIN_REPLY_DELAY_SECONDS,
} from "@/lib/agent-limits";
import { safeTimeZone } from "@/lib/fechas";
import {
  avisoDeLaFila,
  contestaSiempre,
  dentroDelHorario,
  describirHorario,
  hayAviso,
  horarioDeLaFila,
  yaSalioElAviso,
  type HorarioDelAgente,
} from "@/lib/horario-del-agente";
import {
  esNotaDeFalla,
  esNotaInterna,
  INSTRUCCIONES_DE_DERIVACION,
  INSTRUCCIONES_DE_RESUMEN,
  notaDeFalla,
  notaParaElEquipo,
  separarMarcas,
} from "@/lib/marcas-del-agente";
import { INSTRUCCIONES_DE_ADJUNTOS } from "@/lib/media-notes";
import { moverSiCorresponde } from "@/lib/movimientos-del-agente-server";
import { completeChatServer, type ChatTurn } from "@/lib/openai-server";
import { enviarTexto } from "@/lib/mensajeria";
import { promptDelCanal } from "@/lib/prompts-agentes";
import { sendHandoffPush } from "@/lib/push-notifications";
import type { Channel } from "@/types/database";

/** Mensajes de historial que se le pasan al modelo. */
export const HISTORY_LIMIT = 40;

/**
 * Espera antes de contestar los segundos configurados para el canal.
 *
 * Sin esto la respuesta sale en menos de un segundo, que es justo lo que
 * delata al bot: nadie lee y redacta cuatro renglones al instante.
 *
 * Antes la espera era proporcional al largo de la respuesta, entre 3 y 9
 * segundos. La fórmula se fue con el rango: ahora hay un solo número cargado a
 * mano y la espera es ese número, que es lo que espera ver quien lo configuró.
 *
 * El valor que llega de la base se recorta igual contra los límites duros: una
 * fila cargada a mano antes del check, o una migración sin correr, no tiene que
 * poder dejar al agente esperando media hora ni contestando al instante.
 */
function pausaNatural(segundos: number | null | undefined): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, acotar(segundos) * 1000));
}

/** Deja el valor dentro de los límites duros, o devuelve el default si no es un número. */
function acotar(valor: number | null | undefined): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return DEFAULT_REPLY_DELAY_SECONDS;
  return Math.min(MAX_REPLY_DELAY_SECONDS, Math.max(MIN_REPLY_DELAY_SECONDS, valor));
}

/**
 * Ficha del contacto, en el mismo pedido que el historial.
 *
 * Sin esto la IA sólo ve los mensajes y termina preguntando el nombre o el
 * teléfono de alguien que ya está cargado en el CRM.
 */
export function fichaDelLead(contact: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[] | null;
}): string {
  const lineas = [
    contact.name && `Nombre: ${contact.name}`,
    contact.phone && `Teléfono: ${contact.phone}`,
    contact.email && `Email: ${contact.email}`,
    contact.tags?.length && `Etiquetas: ${contact.tags.join(", ")}`,
  ].filter(Boolean);

  if (lineas.length === 0) return "";

  return [
    "",
    "Datos que el CRM ya tiene de esta persona. No se los vuelvas a preguntar:",
    ...lineas,
  ].join("\n");
}

/**
 * Responde automáticamente un mensaje entrante.
 *
 * El interruptor es `contacts.bot_enabled`: en la tarjeta de lead se muestra
 * como la etiqueta "Frenar IA". Con la etiqueta puesta la IA no habla; sin
 * ella, contesta sola.
 *
 * Nunca lanza: si algo falla se loguea y el webhook sigue devolviendo 200. Un
 * fallo de la IA no puede hacer que Zernio reintente y duplique el mensaje.
 */
export async function replyWithAi(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  conversationId: string;
  contactId: string;
  channel: Channel;
  zernioChatId: string;
  zernioAccountId: string | null;
  /** Proveedor por el que salir. Ausente equivale a Zernio. */
  provider?: string | null;
  /**
   * Fila de `messages` que disparó esta corrida.
   *
   * Sirve para saber, justo antes de enviar, si la persona siguió escribiendo:
   * ver `sigueSiendoElUltimo`. Sin esto no se puede agrupar una ráfaga.
   */
  triggerMessageId?: string | null;
}): Promise<void> {
  try {
    if (!input.zernioAccountId) return;

    const { data: contact } = await input.supabase
      .from("contacts")
      .select("bot_enabled, archived_at, name, email, phone, tags")
      .eq("id", input.contactId)
      .maybeSingle();

    if (!contact || contact.archived_at || contact.bot_enabled === false) {
      console.log("[ia] silenciada para este contacto");
      return;
    }

    const config = await leerConfig(input.supabase, input.workspaceId, input.channel);

    // El interruptor general va primero: apagado el canal, no importa cómo esté
    // la etiqueta de cada lead.
    if (config?.enabled === false) {
      console.log("[ia] canal apagado:", input.channel);
      return;
    }

    // Sin instrucciones no hay agente. El freno es el mismo de siempre —que la
    // IA no empiece a hablar sola apenas se carga la API key—, sólo que ahora
    // las instrucciones vienen del código y no de la base: ver
    // `prompts-agentes.ts`.
    const systemPrompt = promptDelCanal(input.channel);
    if (!systemPrompt) {
      console.log("[ia] sin instrucciones para el canal", input.channel);
      return;
    }

    if (config?.id && (await fueraDeSusEmbudos(input.supabase, input.workspaceId, config.id, input.contactId))) {
      console.log("[ia] el lead no está en un embudo de este agente");
      return;
    }

    // El horario va último de los recortes y antes de armar el pedido. Último
    // porque el aviso de fuera de horario sólo le corresponde a un lead que el
    // agente habría atendido: el canal sin instrucciones y el embudo ajeno
    // significan "este agente no habla con esta persona", y mandarle un "te
    // contestamos a las 9" sería prometer en nombre de nadie. Antes del pedido
    // porque un lead que escribe a las 3 AM no tiene que costar tokens.
    //
    // Fuera del horario el mensaje queda en la bandeja y lo atiende una persona
    // cuando abre: guardarlo para contestarlo a la mañana no se puede desde acá,
    // que corre en el `after()` del webhook y se muere con la función.
    const cerrado = config && (await horarioCerrado(input.supabase, input.workspaceId, config));
    if (cerrado) {
      console.log(`[ia] fuera de horario en ${input.channel}: contesta ${cerrado}`);
      await avisarFueraDeHorario(input, avisoDeLaFila(config), config.reply_delay_seconds);
      return;
    }

    const tools = (config?.tools_config ?? {}) as { handoff_to_human?: boolean };
    const puedeDerivar = tools.handoff_to_human !== false;

    const { data: history } = await input.supabase
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
          systemPrompt +
          fichaDelLead(contact) +
          INSTRUCCIONES_DE_ADJUNTOS +
          (puedeDerivar ? INSTRUCCIONES_DE_DERIVACION : "") +
          INSTRUCCIONES_DE_RESUMEN,
      },
      ...(history ?? [])
        .reverse()
        .filter(
          (row) =>
            typeof row.content === "string" &&
            row.content.trim() &&
            !esNotaDeFalla(row.content),
        )
        .map((row) => ({
          role: row.sender_type === "contact" ? ("user" as const) : ("assistant" as const),
          content: row.content as string,
        })),
    ];

    // Sin ningún mensaje de la persona no hay nada que contestar. Con la nota
    // que deja cada adjunto esto ya no debería pasar; queda como red por si
    // alguna vez entra una fila vacía.
    if (turns.length === 1) {
      console.log("[ia] la conversación no tiene ningún mensaje con texto");
      return;
    }

    const completion = await completeChatServer({
      model: config?.model_version || "gpt-5",
      messages: turns,
    });

    if (!completion.ok) {
      console.error("[ia] no se pudo generar la respuesta:", completion.error);
      // Sólo avisa la corrida a la que le tocaba contestar. En una ráfaga las
      // demás se descartan igual más abajo, y una nota por cada una sería una
      // falsa alarma: la que viene atrás todavía puede responder bien.
      if (await leTocabaContestar(input)) {
        await dejarNota(input, notaDeFalla(completion.error));
      }
      return;
    }

    // Las marcas salen del texto antes de cualquier otra cosa: son señales para
    // el CRM y el contacto no tiene por qué verlas.
    const respuesta = separarMarcas(completion.text);
    const derivar = puedeDerivar && respuesta.derivar;
    const texto = respuesta.texto;

    if (texto) {
      // La pausa va acá, con el texto ya listo: si el modelo falla, no se esperó
      // al pedo, y el largo real es lo que define cuánto tardaría una persona.
      await pausaNatural(config?.reply_delay_seconds);

      // La gente escribe de a pedazos: "hola", "una consulta", "por el precio".
      // Cada uno entra por su webhook y dispara su propia corrida, así que sin
      // esto salían tres respuestas casi iguales —y las últimas dos redactadas
      // sin ver las anteriores, porque la respuesta recién se guarda después de
      // enviarla—. Gana la corrida del último mensaje, que es la única que vio
      // la ráfaga entera; las demás se abandonan acá, ya con la pausa cumplida
      // haciendo de ventana de agrupamiento.
      if (input.triggerMessageId) {
        const ultimo = await sigueSiendoElUltimo(
          input.supabase,
          input.conversationId,
          input.triggerMessageId,
        );
        if (!ultimo) {
          console.log("[ia] la persona siguió escribiendo: contesta la corrida más nueva");
          return;
        }
      }

      const sent = await enviarTexto({
        provider: input.provider,
        conversationId: input.zernioChatId,
        accountId: input.zernioAccountId,
        text: texto,
      });

      if (!sent.ok) {
        console.error("[ia] no se pudo enviar la respuesta:", sent.error);
        // La respuesta estaba escrita y no salió: es la falla más cara de las
        // dos, porque el lead quedó esperando algo que el modelo ya redactó.
        await dejarNota(input, notaDeFalla(sent.error));
        return;
      }

      // Se guarda después de enviar, igual que una respuesta escrita a mano: si
      // el envío falla, el historial no debe mostrar algo que nadie recibió.
      const { error } = await input.supabase.from("messages").insert({
        conversation_id: input.conversationId,
        sender_type: "ai",
        content: texto,
        zernio_message_id: sent.messageId ?? null,
      });

      if (error) console.error("[ia] no se pudo guardar la respuesta:", error.message);
      else console.log("[ia] respondió automáticamente");
    }

    // La nota va después del envío y no antes: si el mensaje no salió, el hilo
    // no tiene por qué mostrar el resumen de una conversación que la persona
    // nunca recibió. Va igual cuando no hubo texto que mandar —el modelo puede
    // anotar sin contestar— porque entonces no hay envío que pueda fallar.
    if (respuesta.resumen) {
      const { error } = await input.supabase.from("messages").insert({
        conversation_id: input.conversationId,
        sender_type: "ai",
        content: notaParaElEquipo(respuesta.resumen),
      });

      if (error) console.error("[ia] no se pudo guardar el resumen:", error.message);
      else console.log("[ia] dejó un resumen para el equipo");
    }

    if (derivar) await derivarAUnaPersona(input);

    // Lo último, y después del envío a propósito: si el mensaje no salió, la
    // tarjeta no se mueve. Una columna que dice "Calificado" sobre una
    // conversación en la que el lead no recibió nada miente dos veces, al equipo
    // que la mira y a las automatizaciones que cuelgan de esa columna.
    //
    // Sin fila de config no hay reglas que leer: el agente contestó con el
    // prompt del código y nadie configuró movimientos.
    if (config?.id) {
      await moverSiCorresponde({
        supabase: input.supabase,
        workspaceId: input.workspaceId,
        configId: config.id,
        contactId: input.contactId,
        conversationId: input.conversationId,
        model: config.model_version || "gpt-5",
      });
    }
  } catch (error) {
    console.error("[ia] error inesperado:", error);
  }
}

/**
 * Deja una nota en el hilo, sin poder tumbar la corrida.
 *
 * Es lo último que pasa en un camino que ya falló: si además fallara el insert,
 * lo único que se puede hacer es dejarlo en el log y no tapar el error que la
 * nota venía a contar.
 */
async function dejarNota(
  input: { supabase: SupabaseClient; conversationId: string },
  contenido: string,
): Promise<void> {
  const { error } = await input.supabase.from("messages").insert({
    conversation_id: input.conversationId,
    sender_type: "ai",
    content: contenido,
  });

  if (error) console.error("[ia] no se pudo dejar la nota en el hilo:", error.message);
}

/**
 * Si a esta corrida le tocaba contestar, o la pisó un mensaje más nuevo.
 *
 * Sin `triggerMessageId` no hay con qué desempatar y se asume que sí: es el
 * mismo criterio que usa el envío.
 */
async function leTocabaContestar(input: {
  supabase: SupabaseClient;
  conversationId: string;
  triggerMessageId?: string | null;
}): Promise<boolean> {
  if (!input.triggerMessageId) return true;
  return sigueSiendoElUltimo(input.supabase, input.conversationId, input.triggerMessageId);
}

/**
 * La fila de config del canal, con lo que el agente necesita para contestar.
 *
 * Ya no trae las instrucciones: ésas vienen del código (`prompts-agentes.ts`).
 * Lo que queda acá es lo que se configura desde el panel —el interruptor, el
 * modelo, la demora, las herramientas y los embudos—, que sigue siendo de cada
 * workspace.
 */
type ConfigDelCanal = {
  id: string;
  enabled: boolean | null;
  model_version: string | null;
  tools_config: unknown;
  reply_delay_seconds?: number | null;
  /** El horario en el que contesta. Ausentes, contesta siempre. */
  dias?: unknown;
  franjas?: unknown;
  horario_excluye?: unknown;
  /** El par de horas que tuvo el horario antes de las franjas. */
  hora_desde?: number | null;
  hora_hasta?: number | null;
  /** Lo que sale fuera de horario. Vacío o ausente, no sale nada. */
  aviso_fuera_de_horario?: string | null;
};

const COLUMNAS_BASE = "id, enabled, model_version, tools_config";
const COLUMNAS_DEMORA = "reply_delay_seconds";
const COLUMNAS_HORARIO = "dias, franjas, horario_excluye, aviso_fuera_de_horario";
/** Lo mismo, sin el modo: las franjas se leen como cuándo contesta. */
const COLUMNAS_SIN_MODO = "dias, franjas, aviso_fuera_de_horario";
/** Lo mismo, como se guardaba antes de que el horario aceptara varias franjas. */
const COLUMNAS_HORARIO_VIEJO = "dias, hora_desde, hora_hasta, aviso_fuera_de_horario";

/**
 * Lo que se pide, de lo más completo a lo que seguro existe.
 *
 * Pedir una columna que no existe no devuelve la fila sin ese campo: falla el
 * select entero y `data` vuelve null. Sin estos respaldos, un despliegue con una
 * migración todavía sin correr dejaría a la config en null y al agente callado
 * en todos los canales, que es bastante peor que perder un recorte que nadie
 * configuró. El aviso dice qué quedó sin leer, porque un agente que contesta a
 * una hora que el panel dice que no es la falla más difícil de explicar.
 */
const INTENTOS: { columnas: string; aviso: string | null }[] = [
  { columnas: `${COLUMNAS_BASE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_HORARIO}`, aviso: null },
  {
    columnas: `${COLUMNAS_BASE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_SIN_MODO}`,
    aviso: "sin la columna del modo, las franjas se leen como cuándo contesta",
  },
  {
    // Para el despliegue a medias: `202610010001` corrida y `202610010003`
    // todavía no. `horarioDeLaFila` arma la franja desde ese par de horas, así
    // que el horario ya cargado sigue valiendo en vez de abrirse a toda hora.
    columnas: `${COLUMNAS_BASE}, ${COLUMNAS_DEMORA}, ${COLUMNAS_HORARIO_VIEJO}`,
    aviso: "sin la columna de franjas, el horario se lee del par de horas viejo",
  },
  {
    columnas: `${COLUMNAS_BASE}, ${COLUMNAS_DEMORA}`,
    aviso: "sin las columnas de horario, contesta a toda hora (faltan las migraciones del horario)",
  },
  { columnas: COLUMNAS_BASE, aviso: "sin la columna de demora, se usa la de siempre" },
];

/** Lee la config del canal, con reintentos sin las columnas que falten. */
async function leerConfig(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: Channel,
): Promise<ConfigDelCanal | null> {
  const pedir = (columnas: string) =>
    supabase
      .from("ai_agent_configs")
      .select(columnas)
      .eq("workspace_id", workspaceId)
      .eq("channel", channel)
      .maybeSingle();

  let ultimoError = "";

  for (const intento of INTENTOS) {
    const { data, error } = await pedir(intento.columnas);
    if (!error) {
      if (intento.aviso) console.error(`[ia] ${intento.aviso}:`, ultimoError);
      return data as ConfigDelCanal | null;
    }
    ultimoError = error.message;
  }

  console.error("[ia] no se pudo leer la config del canal:", ultimoError);
  return null;
}

/**
 * El horario del agente si está cerrado ahora, o null si le toca contestar.
 *
 * Devuelve el texto y no un booleano para que el log diga qué horario lo frenó:
 * "no contestó" sin el horario al lado es un reclamo que nadie puede verificar.
 *
 * La zona se lee recién cuando hay un horario que recortar. El caso normal es
 * el agente sin horario configurado —contesta siempre— y ahí no hay por qué
 * pagar una consulta más en cada mensaje que entra.
 */
async function horarioCerrado(
  supabase: SupabaseClient,
  workspaceId: string,
  config: ConfigDelCanal,
): Promise<string | null> {
  const horario: HorarioDelAgente = horarioDeLaFila(config);
  if (contestaSiempre(horario)) return null;

  const zona = await zonaDelWorkspace(supabase, workspaceId);
  return dentroDelHorario(new Date(), horario, zona) ? null : describirHorario(horario);
}

/**
 * Cuántos mensajes salientes se miran para saber qué fue lo último que el lead
 * recibió. Son pocos porque lo único que puede haber en el medio son notas
 * internas, y nadie deja cinco seguidas.
 */
const SALIENTES_QUE_SE_MIRAN = 5;

/**
 * Manda el aviso de fuera de horario, si hay uno cargado y todavía no salió.
 *
 * El aviso existe porque del otro lado el silencio no se distingue de un número
 * que no existe: quien no sabe si lo leyeron escribe de nuevo, o se va. Es un
 * texto fijo y no una respuesta del modelo a propósito —a esa hora lo único
 * honesto que se puede decir es cuándo se atiende, y un modelo suelto vuelve a
 * prometer gente que no está, con el agravante de que nadie va a leer ese chat
 * hasta la mañana—.
 *
 * Nunca lanza: es un extra sobre un camino que ya decidió no contestar.
 */
async function avisarFueraDeHorario(
  input: {
    supabase: SupabaseClient;
    conversationId: string;
    zernioChatId: string;
    zernioAccountId: string | null;
    provider?: string | null;
    triggerMessageId?: string | null;
  },
  aviso: string,
  demora: number | null | undefined,
): Promise<void> {
  const texto = aviso.trim();
  if (!hayAviso(texto) || !input.zernioAccountId) return;

  if (await yaAvisado(input.supabase, input.conversationId, texto)) {
    console.log("[ia] el aviso de fuera de horario ya fue lo último que recibió");
    return;
  }

  // La misma espera que una respuesta, y por el motivo que importa: es la
  // ventana en la que se agrupan los mensajes de una ráfaga. Sin ella, los tres
  // mensajes sueltos de las 3 AM entran por tres webhooks que no se ven entre
  // sí, ninguno encuentra el aviso todavía mandado, y el lead se come tres "te
  // contestamos a las 9" seguidos.
  await pausaNatural(demora);

  if (
    input.triggerMessageId &&
    !(await sigueSiendoElUltimo(input.supabase, input.conversationId, input.triggerMessageId))
  ) {
    console.log("[ia] la persona siguió escribiendo: avisa la corrida más nueva");
    return;
  }

  const sent = await enviarTexto({
    provider: input.provider,
    conversationId: input.zernioChatId,
    accountId: input.zernioAccountId,
    text: texto,
  });

  if (!sent.ok) {
    console.error("[ia] no se pudo mandar el aviso de fuera de horario:", sent.error);
    await dejarNota(input, notaDeFalla(sent.error));
    return;
  }

  // Se guarda después de enviar, como cualquier otra cosa que sale: el historial
  // no debe mostrar algo que nadie recibió. Y guardarlo es además lo que hace
  // que el aviso no se repita, porque es contra el hilo que se compara.
  const { error } = await input.supabase.from("messages").insert({
    conversation_id: input.conversationId,
    sender_type: "ai",
    content: texto,
    zernio_message_id: sent.messageId ?? null,
  });

  if (error) console.error("[ia] no se pudo guardar el aviso:", error.message);
  else console.log("[ia] avisó que está fuera de horario");
}

/**
 * Si lo último que el lead recibió de este lado ya es el aviso.
 *
 * Las notas internas se saltean: empiezan con ⚙️ y nunca se enviaron, así que
 * una nota de falla entre medio no tiene por qué habilitar un aviso repetido.
 */
async function yaAvisado(
  supabase: SupabaseClient,
  conversationId: string,
  aviso: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .neq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SALIENTES_QUE_SE_MIRAN);

  if (error) {
    // Al revés que en `sigueSiendoElUltimo`, acá la duda se resuelve callando:
    // un aviso que no sale deja al lead igual que antes de que esto existiera,
    // y dos "estamos fuera de horario" seguidos lo hacen parecer roto.
    console.error("[ia] no se pudo ver si el aviso ya salió, no se repite:", error.message);
    return true;
  }

  const recibido = (data ?? [])
    .map((fila) => (fila as { content?: string | null }).content)
    .find((contenido) => typeof contenido === "string" && !esNotaInterna(contenido));

  return yaSalioElAviso(typeof recibido === "string" ? recibido : null, aviso);
}

/**
 * La zona del workspace, que es la que manda para cualquier horario.
 *
 * Es `workspaces.timezone`, la misma que decide qué es "hoy" en el resumen y en
 * qué franja envían las automatizaciones: si fueran dos, cambiar la zona en
 * Configuración movería los gráficos y dejaría al agente abriendo a la hora de
 * antes. Se lee acá, con una consulta propia, para no arrastrar el motor de
 * automatizaciones al camino del webhook.
 */
async function zonaDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<string> {
  const { data } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", workspaceId)
    .maybeSingle();

  return safeTimeZone((data as { timezone?: string | null } | null)?.timezone);
}

/**
 * Si el lead queda fuera de los embudos en los que este agente contesta.
 *
 * Sin filas en `ai_agent_pipelines` el agente no está restringido y contesta en
 * todos: no elegir es no restringir, igual que los permisos por columna.
 *
 * Un lead sin tarjeta en ningún embudo queda afuera cuando el agente sí está
 * restringido. Es lo que dice la configuración —"contestá sólo en Ventas", y
 * este lead no está en Ventas— y no debería pasar por sí solo: el webhook le
 * crea la tarjeta antes de que la IA conteste. Pasa si alguien la borró a mano,
 * y por eso queda escrito en el log: un agente callado sin motivo visible es la
 * falla más difícil de encontrar.
 */
async function fueraDeSusEmbudos(
  supabase: SupabaseClient,
  workspaceId: string,
  configId: string,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_agent_pipelines")
    .select("pipeline_id")
    .eq("config_id", configId);

  // Sin la migración corrida la tabla no existe. Se contesta en todos los
  // embudos, que es como venía: dejar al agente mudo por una migración
  // pendiente es peor que ignorar un recorte que todavía nadie configuró.
  if (error) {
    console.error("[ia] sin la tabla de embudos del agente, contesta en todos:", error.message);
    return false;
  }

  const permitidos = new Set((data ?? []).map((fila) => (fila as { pipeline_id: string }).pipeline_id));
  if (permitidos.size === 0) return false;

  const { data: oportunidad } = await supabase
    .from("opportunities")
    .select("pipeline_id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();

  const embudo = (oportunidad as { pipeline_id?: string } | null)?.pipeline_id;
  return !embudo || !permitidos.has(embudo);
}

/**
 * Corta la IA para ese contacto y marca el chat como pendiente.
 *
 * Son dos señales a propósito, porque se leen en lugares distintos: la tarjeta
 * del embudo muestra "IA off" y la bandeja muestra el chat como pendiente. Con
 * una sola, la derivación quedaba visible nada más que si abrías la ficha.
 *
 * Frenar la IA es lo importante: si siguiera contestando, la persona seguiría
 * hablando con el bot justo después de haber pedido un humano.
 */
async function derivarAUnaPersona(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  conversationId: string;
  contactId: string;
}): Promise<void> {
  const [frenada, marcada] = await Promise.all([
    input.supabase.from("contacts").update({ bot_enabled: false }).eq("id", input.contactId),
    input.supabase
      .from("conversations")
      .update({ status: "pending" })
      .eq("id", input.conversationId)
      // Sólo la transición genera el aviso. Un reintento del webhook o dos
      // corridas simultáneas no deberían despertar dos veces al equipo.
      .neq("status", "pending")
      .select("id")
      .maybeSingle(),
  ]);

  if (frenada.error) console.error("[ia] no se pudo frenar la IA:", frenada.error.message);
  if (marcada.error) console.error("[ia] no se pudo marcar el chat:", marcada.error.message);
  if (!frenada.error && !marcada.error) {
    console.log("[ia] derivada a una persona");
    if (marcada.data) {
      await sendHandoffPush(input.supabase, input);
    }
  }
}

/**
 * ¿El mensaje que disparó esta corrida sigue siendo el último del contacto?
 *
 * Se compara contra la fila más nueva en vez de contar los posteriores para que
 * el desempate sea el mismo en todas las corridas: dos mensajes del mismo
 * segundo comparten `created_at`, y ordenar también por id deja una sola
 * ganadora. Ante un error de lectura se contesta igual: perder una respuesta es
 * peor que mandar una de más.
 */
async function sigueSiendoElUltimo(
  supabase: SupabaseClient,
  conversationId: string,
  triggerMessageId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[ia] no se pudo comprobar si llegaron mensajes nuevos:", error.message);
    return true;
  }

  return !data || data.id === triggerMessageId;
}
