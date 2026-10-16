import "server-only";

import { after } from "next/server";

import { replyWithAi } from "@/lib/ai-reply";
import { formasDelTelefono } from "@/lib/telefono";
import { asegurarOportunidad } from "@/lib/embudos";
import {
  contenidoDelMensaje,
  MEDIA_LEGIBLE,
  vieneVacio,
  vistaPreviaDelMensaje,
  type MediaLegible,
} from "@/lib/media-notes";
import { type Proveedor } from "@/lib/mensajeria";
import { describeImage, transcribeAudio } from "@/lib/openai-server";
import { sendMensajePush } from "@/lib/push-notifications";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Channel } from "@/types/database";

/**
 * Procesamiento de mensajes entrantes, común a todos los proveedores.
 *
 * Vivía dentro del webhook de Zernio. Al sumar YCloud había dos caminos: copiar
 * las cuatrocientas líneas o darles una forma común y compartirlas. Copiarlas
 * significaba que cualquier arreglo —la deduplicación, el marcador de los
 * adjuntos, el lead que entra mandando un video— habría que hacerlo dos veces,
 * y tarde o temprano se harían una sola.
 *
 * Cada webhook traduce su payload a `MensajeEntrante` y esto hace el resto.
 */

type Supabase = ReturnType<typeof getSupabaseAdmin>;

/** Un mensaje entrante, ya despojado de la forma que le da su proveedor. */
export type MensajeEntrante = {
  provider: Proveedor;
  channel: Channel;
  /** Cuenta propia por la que entró. Es el puente al workspace. */
  cuenta: { id: string; plataforma?: string; usuario?: string };
  /** Id de la conversación en el proveedor. En YCloud, el teléfono del contacto. */
  chatId: string;
  /** Id único del mensaje. Es lo que hace idempotente el reintento del webhook. */
  mensajeId: string;
  direccion: "incoming" | "outgoing";
  texto: string | null;
  /** `url` puede faltar: hay proveedores que avisan del adjunto sin darlo. */
  adjunto: { type: string; url: string | null } | null;
  enviadoEl: string;
  remitente: {
    /** Identidad estable del remitente en el canal. */
    externalId?: string;
    nombre?: string;
    telefono?: string;
    foto?: string;
  };
  /**
   * Cómo llamó el proveedor a este evento. No se guarda ni se muestra: es lo
   * único que queda en el log cuando un evento se descarta por venir vacío, y
   * sin eso no hay forma de saber qué tipo de evento fue.
   */
  tipoCrudo?: string;
};

export type Resultado =
  | { estado: "ok" }
  | { estado: "ignorado"; motivo: string }
  | { estado: "error"; error: string };

export async function procesarEntrante(
  supabase: Supabase,
  entrante: MensajeEntrante,
): Promise<Resultado> {
  const log = `[${entrante.provider}]`;

  // Antes que nada: un evento sin texto ni adjunto no es un mensaje.
  //
  // Por el mismo webhook entran los avisos internos de WhatsApp —cambios de
  // clave de cifrado, mensajes de protocolo, el placeholder de uno que todavía
  // no se pudo descifrar—. En el teléfono no se ven, pero acá se guardaban
  // como «(mensaje sin texto)»: burbujas que el contacto no mandó, y que
  // encima despertaban a la IA para que contestara sobre la nada.
  //
  // Se descarta acá y no en cada webhook porque los tres proveedores pueden
  // mandar eventos así, cada uno con su forma.
  if (vieneVacio(entrante.texto, entrante.adjunto?.type)) {
    console.warn(`${log} evento sin texto ni adjunto`, {
      tipo: entrante.tipoCrudo ?? "sin tipo",
      mensajeId: entrante.mensajeId,
    });
    return { estado: "ignorado", motivo: "el evento no trae ni texto ni adjunto" };
  }

  const workspaceId = await resolveWorkspace(supabase, entrante);
  if (!workspaceId) {
    console.error(`${log} cuenta sin workspace asociado`, entrante.cuenta.id);
    return { estado: "ignorado", motivo: "cuenta sin workspace asociado" };
  }

  // La conversación del proveedor es la clave natural: `conversations` ya tiene
  // unique (workspace_id, zernio_chat_id).
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, contact_id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("zernio_chat_id", entrante.chatId)
    .maybeSingle();

  const incoming = entrante.direccion === "incoming";

  let conversationId: string;
  // Se guarda aparte del `if` para que la IA sepa a quién le está contestando.
  let contactId: string | null = null;

  if (existing) {
    conversationId = existing.id;
    contactId = existing.contact_id;
    await supabase
      .from("conversations")
      .update({
        updated_at: new Date().toISOString(),
        unread_count: incoming ? (existing.unread_count ?? 0) + 1 : existing.unread_count ?? 0,
        // Rellena la cuenta en los chats creados antes de que existiera la
        // columna: sin esto no se puede responder desde el CRM.
        zernio_account_id: entrante.cuenta.id,
        provider: entrante.provider,
      })
      .eq("id", conversationId);
  } else {
    const contacto = await findOrCreateContact(supabase, workspaceId, entrante);
    if (!contacto) return { estado: "error", error: "No se pudo crear el contacto." };
    contactId = contacto.id;

    // Un lead que entra por chat tiene que caer en el embudo igual que uno
    // cargado a mano; si no, el pipeline solo muestra la mitad de los leads.
    await asegurarOportunidad(supabase, workspaceId, contactId, log);

    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        contact_id: contactId,
        channel: entrante.channel,
        zernio_chat_id: entrante.chatId,
        zernio_account_id: entrante.cuenta.id,
        provider: entrante.provider,
        unread_count: incoming ? 1 : 0,
      })
      .select("id")
      .single();

    if (error || !created) {
      // Casi siempre es una carrera, no una falla.
      //
      // Quien escribe por primera vez manda tres mensajes seguidos, no uno: el
      // proveedor dispara un webhook por cada uno y los tres entran a la vez.
      // Los tres buscan la conversación, los tres ven que no está —ninguno
      // escribió todavía— y los tres crean un contacto. Después sólo uno puede
      // crear la conversación: la protege un unique (workspace, chat).
      //
      // Hasta acá los perdedores devolvían error y dejaban su contacto tirado:
      // sin chat, pero con su tarjeta en el embudo. La misma persona aparecía
      // dos o tres veces, y una cita podía engancharse a la ficha huérfana y
      // dejar el chat de un lado y la cita del otro.
      //
      // Así que el perdedor se suma a la conversación que ganó, en vez de
      // fallar, y se lleva puesto el contacto que acababa de crear.
      const { data: ganadora } = await supabase
        .from("conversations")
        .select("id, contact_id")
        .eq("workspace_id", workspaceId)
        .eq("zernio_chat_id", entrante.chatId)
        .maybeSingle();

      if (!ganadora) {
        console.error(`${log} no se pudo crear la conversación`, error?.message);
        return { estado: "error", error: "No se pudo crear la conversación." };
      }

      // Sólo se borra el que se creó recién en esta misma pasada. Uno que ya
      // estaba es de otra persona, o es el mismo de la conversación que ganó.
      if (contacto.creado && ganadora.contact_id !== contactId) {
        const { error: sobra } = await supabase
          .from("contacts")
          .delete()
          .eq("id", contactId)
          .eq("workspace_id", workspaceId);

        // No es fatal: queda un contacto de más, que es exactamente lo que
        // había antes de este arreglo. Pero tiene que verse en los logs.
        if (sobra) console.error(`${log} quedó un contacto duplicado:`, sobra.message);
      }

      console.warn(`${log} carrera al abrir el chat: se usa la conversación que ya estaba`);
      conversationId = ganadora.id;
      contactId = ganadora.contact_id;
    } else {
      conversationId = created.id;
    }
  }

  // Un reintento del proveedor trae el mismo id de mensaje. El unique ya
  // evitaba duplicar la fila, pero no alcanza: sin esta comprobación la IA
  // contestaría de nuevo el mismo mensaje en cada reintento.
  const { data: alreadySaved } = await supabase
    .from("messages")
    .select("id")
    .eq("zernio_message_id", entrante.mensajeId)
    .maybeSingle();

  if (alreadySaved) return { estado: "ignorado", motivo: "mensaje ya procesado" };

  const adjunto = entrante.adjunto;
  // Sin URL no hay nada que transcribir ni describir: queda la nota del tipo.
  const readable: MediaLegible | null =
    adjunto?.url && (adjunto.type === "audio" || adjunto.type === "image")
      ? adjunto.type
      : null;

  // Un audio o una foto entran sin texto. Se guardan ya con un marcador para
  // que aparezcan en el chat en el momento, y el texto real los reemplaza unos
  // segundos después: procesarlos antes de insertar demoraría la respuesta al
  // webhook y el proveedor daría la entrega por caída.
  //
  // Lo que no se puede leer —un video, un archivo— también deja su nota. Antes
  // se guardaba vacío, y un mensaje vacío no existe para la IA: el historial que
  // se le arma descarta las filas sin texto, así que un lead que entraba
  // mandando un video se quedaba sin respuesta.
  const { data: saved, error: messageError } = await supabase
    .from("messages")
    .upsert(
      {
        conversation_id: conversationId,
        sender_type: incoming ? "contact" : "user",
        content: contenidoDelMensaje(entrante.texto, adjunto?.type),
        media_url: adjunto?.url ?? null,
        zernio_message_id: entrante.mensajeId,
        created_at: entrante.enviadoEl,
      },
      { onConflict: "zernio_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (messageError) {
    console.error(`${log} no se pudo guardar el mensaje`, messageError.message);
    return { estado: "error", error: "No se pudo guardar el mensaje." };
  }

  console.log(`${log} mensaje guardado`, { conversationId, channel: entrante.channel });

  const guardado = saved?.id ?? null;

  // El aviso al equipo sale con cada mensaje que entra, lo conteste o no la IA.
  // En su propio `after` para no esperar la transcripción ni la respuesta, que
  // pueden tardar medio minuto, y sólo con un mensaje que se guardó recién: un
  // reintento del proveedor no vuelve a hacer sonar el teléfono.
  if (incoming && contactId && guardado) {
    const aviso = {
      workspaceId,
      conversationId,
      contactId,
      texto: vistaPreviaDelMensaje(entrante.texto, adjunto?.type),
    };
    after(() =>
      sendMensajePush(supabase, aviso).catch((error) =>
        console.error(`${log} no se pudo avisar el mensaje:`, error),
      ),
    );
  }

  // Solo se contesta lo que entra: un mensaje saliente es nuestro y
  // responderlo dispararía a la IA hablando consigo misma.
  //
  // Va en `after` para devolver el 200 ya mismo. Antes se esperaba a que la IA
  // terminara, y entre lo que tarda el modelo y la demora deliberada de
  // `replyWithAi` la respuesta al webhook se estiraba lo suficiente como para
  // que el proveedor la diera por caída y reintentara la entrega.
  if (incoming && contactId) {
    const pending = {
      workspaceId,
      conversationId,
      contactId,
      channel: entrante.channel,
      zernioChatId: entrante.chatId,
      zernioAccountId: entrante.cuenta.id,
      provider: entrante.provider,
    };
    const messageId = guardado;
    // Con qué mensaje entró esta corrida: es lo que le permite a la IA saber,
    // antes de contestar, si la persona siguió escribiendo.

    after(async () => {
      // El adjunto va primero: la IA lee el historial de la base, así que tiene
      // que encontrar ahí el texto y no el marcador.
      if (readable && messageId && adjunto?.url) {
        await readMediaInto(supabase, messageId, adjunto.url, readable);
      }
      await replyWithAi({ supabase, ...pending, triggerMessageId: messageId });
    });
  }

  return { estado: "ok" };
}

/**
 * Reemplaza el marcador de un adjunto por su texto: la transcripción de un
 * audio o la descripción de una imagen.
 *
 * El texto se guarda en el propio mensaje y no en una columna aparte, así el
 * audio también se lee y se busca desde el chat del CRM, no sólo lo aprovecha
 * la IA.
 *
 * Si falla deja constancia en lugar de dejarlo vacío: el chat muestra que llegó
 * algo que no se pudo leer, y la IA puede pedir que lo escriban en vez de
 * contestar como si no hubiera llegado nada.
 */
async function readMediaInto(
  supabase: Supabase,
  messageId: string,
  url: string,
  kind: MediaLegible,
): Promise<void> {
  const result = kind === "audio" ? await transcribeAudio(url) : await describeImage(url);

  if (!result.ok) console.error(`[ia] no se pudo leer el ${kind}:`, result.error);
  else console.log(`[ia] ${kind} leído`);

  const { error } = await supabase
    .from("messages")
    .update({ content: result.ok ? result.text : MEDIA_LEGIBLE[kind].failed })
    .eq("id", messageId);

  if (error) console.error("[ia] no se pudo guardar el texto del adjunto:", error.message);
}

/**
 * Resuelve el workspace de la cuenta que recibió el mensaje.
 *
 * Si la cuenta todavía no está mapeada y existe un único workspace, se asocia
 * sola: quien manda el webhook ya demostró conocer el secreto compartido, así
 * que no hay riesgo de que un tercero se enganche. Con más de un workspace la
 * asociación es ambigua y hay que cargarla a mano en `zernio_accounts`.
 *
 * La tabla se llama `zernio_accounts` por historia; hoy guarda las cuentas de
 * cualquier proveedor.
 */
async function resolveWorkspace(
  supabase: Supabase,
  entrante: MensajeEntrante,
): Promise<string | null> {
  const log = `[${entrante.provider}]`;

  const { data: mapped, error: lookupError } = await supabase
    .from("zernio_accounts")
    .select("workspace_id")
    .eq("zernio_account_id", entrante.cuenta.id)
    .maybeSingle();

  // Sin la migración 202608170002 la tabla no existe. No es fatal —el fallback
  // de abajo igual resuelve el workspace— pero hay que verlo en los logs.
  if (lookupError) console.error(`${log} no se pudo leer zernio_accounts:`, lookupError.message);
  if (mapped?.workspace_id) return mapped.workspace_id;

  const { data: workspaces, error: workspacesError } = await supabase
    .from("workspaces")
    .select("id")
    .limit(2);

  if (workspacesError) {
    console.error(`${log} no se pudo leer workspaces:`, workspacesError.message);
    return null;
  }
  if (!workspaces?.length) {
    console.error(`${log} no hay ningún workspace creado todavía`);
    return null;
  }
  if (workspaces.length !== 1) {
    console.error(`${log} hay varios workspaces: cargá el mapeo a mano en zernio_accounts`);
    return null;
  }

  const workspaceId = workspaces[0].id;
  const { error: bindError } = await supabase.from("zernio_accounts").insert({
    zernio_account_id: entrante.cuenta.id,
    workspace_id: workspaceId,
    platform: entrante.cuenta.plataforma,
    username: entrante.cuenta.usuario,
  });

  if (bindError) console.error(`${log} no se pudo asociar la cuenta:`, bindError.message);

  return workspaceId;
}

/**
 * Resuelve el contacto detrás del mensaje, sin duplicarlo entre canales.
 *
 * Se busca en tres pasos, del identificador más confiable al más débil:
 * 1. La identidad del remitente en ese canal (`contact_identities`), que es la
 *    única señal estable en Instagram y Messenger.
 * 2. El teléfono, que reconoce a alguien que ya estaba cargado a mano.
 * 3. Si no aparece, se crea.
 *
 * En todos los casos se registra la identidad, así el próximo mensaje del mismo
 * canal cae en el contacto que ya existe.
 */
async function findOrCreateContact(
  supabase: Supabase,
  workspaceId: string,
  entrante: MensajeEntrante,
): Promise<{ id: string; creado: boolean } | null> {
  const log = `[${entrante.provider}]`;
  const phone = entrante.remitente.telefono?.trim();
  const externalId = entrante.remitente.externalId;

  const encontrado =
    (await findByIdentity(supabase, workspaceId, entrante.channel, externalId, log)) ??
    (await findByPhone(supabase, workspaceId, phone));

  // Quién lo creó importa: si esta pasada pierde la carrera por la
  // conversación, sólo puede borrar el contacto que creó ella misma.
  const contactId = encontrado ?? (await createContact(supabase, workspaceId, entrante, phone));

  if (!contactId) return null;

  if (externalId) {
    // La PK es (workspace, platform, external_id): si ya estaba, no se duplica.
    const { error } = await supabase.from("contact_identities").upsert(
      {
        workspace_id: workspaceId,
        platform: entrante.channel,
        external_id: externalId,
        contact_id: contactId,
      },
      { onConflict: "workspace_id,platform,external_id", ignoreDuplicates: true },
    );
    if (error) console.error(`${log} no se pudo guardar la identidad:`, error.message);
  }

  return { id: contactId, creado: !encontrado };
}

async function findByIdentity(
  supabase: Supabase,
  workspaceId: string,
  channel: Channel,
  externalId: string | undefined,
  log: string,
): Promise<string | null> {
  if (!externalId) return null;

  const { data, error } = await supabase
    .from("contact_identities")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .eq("platform", channel)
    .eq("external_id", externalId)
    .maybeSingle();

  // Sin la migración 202608170003 la tabla no existe: se sigue con el teléfono.
  if (error) console.error(`${log} no se pudo leer contact_identities:`, error.message);
  return data?.contact_id ?? null;
}

/**
 * El contacto que ya tiene este teléfono, escrito como sea.
 *
 * No alcanza con comparar el texto: el mismo WhatsApp queda guardado de formas
 * distintas segun quien lo haya escrito: con o sin el `+`, y quien carga un
 * contacto a mano escribe el numero como se lo dictaron, sin el 9 argentino.
 *
 * Con la igualdad exacta, cada una de esas formas era una persona distinta: el
 * que cargaron a mano y despues escribio por WhatsApp terminaba con dos fichas,
 * dos chats y el historial partido al medio.
 */
async function findByPhone(
  supabase: Supabase,
  workspaceId: string,
  phone: string | undefined,
): Promise<string | null> {
  const formas = formasDelTelefono(phone);
  if (formas.length === 0) return null;

  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("phone", formas)
    // Si hubiera mas de uno —dos fichas creadas antes de este arreglo— se toma
    // una y no se falla: partir el chat es peor que elegir.
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

async function createContact(
  supabase: Supabase,
  workspaceId: string,
  entrante: MensajeEntrante,
  phone: string | undefined,
): Promise<string | null> {
  const name = entrante.remitente.nombre || phone || "Contacto sin nombre";

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name,
      phone: phone || null,
      avatar_url: entrante.remitente.foto ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[${entrante.provider}] no se pudo crear el contacto`, error?.message);
    return null;
  }

  return data.id;
}

/**
 * Crea la oportunidad del contacto si todavía no tiene ninguna.
 *
 * Es idempotente a propósito: un contacto que escribe por WhatsApp y después
 * por Instagram tiene que seguir siendo una sola tarjeta en el embudo.
 */
/**
 * Devuelve la etapa en la que quedó, pero sólo si la creó ahora.
 *
 * Ese "sólo si" es lo que distingue un lead nuevo de un contacto conocido que
 * vuelve a escribir, y es lo que decide si corresponde disparar una
 * automatización de bienvenida.
 */
