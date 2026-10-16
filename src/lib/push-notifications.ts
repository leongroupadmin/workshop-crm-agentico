import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

import { handoffRecipientIds, type PushMember } from "@/lib/push-recipients";

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function vapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** La clave pública se puede entregar al navegador; la privada nunca sale. */
export function getVapidPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

/**
 * Los dispositivos de quienes están de guardia para un contacto, y su nombre.
 *
 * Es la regla de las derivaciones —el responsable del lead, o quien pueda
 * atender los que no tienen dueño— y la usan también los mensajes nuevos: dos
 * reglas de a quién avisar terminarían con una desactualizada.
 *
 * Un contacto archivado no avisa: su chat no está en la bandeja ni en la
 * campana, y el aviso llevaría a una pantalla donde no aparece.
 */
async function deGuardia(
  supabase: SupabaseClient,
  input: { workspaceId: string; contactId: string },
): Promise<{ nombre: string; subscriptions: SubscriptionRow[] } | null> {
  const [{ data: contact, error: contactError }, { data: members, error: membersError }] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("name, assigned_to, archived_at")
        .eq("id", input.contactId)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle(),
      supabase
        .from("workspace_members")
        .select("user_id, role, permissions")
        .eq("workspace_id", input.workspaceId),
    ]);

  if (contactError || membersError || !contact) {
    console.error(
      "[push] no se pudieron resolver los destinatarios:",
      contactError?.message ?? membersError?.message ?? "contacto inexistente",
    );
    return null;
  }
  if (contact.archived_at) return null;

  const assignedTo = typeof contact.assigned_to === "string" ? contact.assigned_to : null;
  const recipients = handoffRecipientIds((members ?? []) as PushMember[], assignedTo);

  if (recipients.length === 0) return null;

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("workspace_id", input.workspaceId)
    .in("user_id", recipients);

  if (subscriptionError) {
    console.error("[push] no se pudieron leer las suscripciones:", subscriptionError.message);
    return null;
  }

  if (!subscriptions?.length) return null;

  const nombre =
    typeof contact.name === "string" && contact.name.trim() ? contact.name : "Un contacto";
  return { nombre, subscriptions: subscriptions as SubscriptionRow[] };
}

/**
 * Avisa una derivación sin poner en riesgo el webhook.
 *
 * Cualquier error se registra y se absorbe: frenar la IA y dejar el chat como
 * pendiente es más importante que la entrega del aviso. Las suscripciones que
 * el proveedor marca como vencidas se limpian para no intentar usarlas en cada
 * derivación futura.
 */
export async function sendHandoffPush(
  supabase: SupabaseClient,
  input: { workspaceId: string; conversationId: string; contactId: string },
): Promise<void> {
  const config = vapidConfig();
  if (!config) {
    console.warn("[push] faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT");
    return;
  }

  const guardia = await deGuardia(supabase, input);
  if (!guardia) return;

  await entregar(supabase, guardia.subscriptions, config, {
    title: "Nueva derivación",
    body: `${guardia.nombre} está esperando que lo atienda una persona.`,
    tag: input.conversationId,
    url: `/?vista=conversaciones&chat=${encodeURIComponent(input.conversationId)}`,
  });
}

/**
 * Avisa que un contacto escribió.
 *
 * Sale con cada mensaje que entra, lo conteste o no la IA, a los mismos que
 * reciben las derivaciones. El `tag` es el chat: quien manda tres mensajes
 * seguidos deja un solo aviso en el teléfono —el último— y no tres apilados.
 * No comparte el `tag` con la derivación a propósito: el "gracias" que llega
 * después no puede tapar el aviso de que alguien pidió una persona.
 */
export async function sendMensajePush(
  supabase: SupabaseClient,
  input: { workspaceId: string; conversationId: string; contactId: string; texto: string },
): Promise<void> {
  // Sin claves no hay aviso, y acá no se repite la advertencia: ya la dejan
  // las derivaciones, y escribirla con cada mensaje que entra taparía el log.
  const config = vapidConfig();
  if (!config) return;

  const guardia = await deGuardia(supabase, input);
  if (!guardia) return;

  const texto = input.texto.length > 140 ? `${input.texto.slice(0, 139)}…` : input.texto;

  await entregar(supabase, guardia.subscriptions, config, {
    title: guardia.nombre,
    body: texto,
    tag: `mensaje-${input.conversationId}`,
    url: `/?vista=conversaciones&chat=${encodeURIComponent(input.conversationId)}`,
  });
}

export type Aviso = { title: string; body: string; tag: string; url: string };

/**
 * Avisa a personas puntuales.
 *
 * Las derivaciones y las citas eligen a quién avisar con la regla de quién
 * está de guardia. Una tarea no: es de alguien con nombre y apellido, y el
 * aviso es sólo para esa persona.
 *
 * Igual que el resto, cualquier error se registra y se absorbe: el aviso es un
 * efecto secundario y no puede tirar abajo lo que lo disparó.
 */
export async function sendPushToUsers(
  supabase: SupabaseClient,
  input: { workspaceId: string; userIds: string[]; aviso: Aviso },
): Promise<void> {
  if (input.userIds.length === 0) return;

  const config = vapidConfig();
  if (!config) {
    console.warn("[push] faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT");
    return;
  }

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("workspace_id", input.workspaceId)
    .in("user_id", input.userIds);

  if (error) {
    console.error("[push] no se pudieron leer las suscripciones:", error.message);
    return;
  }
  if (!subscriptions?.length) return;

  await entregar(supabase, subscriptions as SubscriptionRow[], config, input.aviso);
}

/**
 * Manda el aviso a cada dispositivo y limpia los que ya no existen.
 *
 * Un `404` o un `410` no son una falla nuestra: es un navegador desinstalado o
 * un permiso revocado. Borrar esa suscripción en el momento evita que la lista
 * se llene de destinos muertos que hacen más lento cada aviso siguiente.
 */
async function entregar(
  supabase: SupabaseClient,
  subscriptions: SubscriptionRow[],
  config: { subject: string; publicKey: string; privateKey: string },
  aviso: Aviso,
): Promise<void> {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify(aviso);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 60 * 60, urgency: "high" },
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number(error.statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subscription.endpoint);
          return;
        }

        console.error("[push] no se pudo entregar un aviso:", error);
      }
    }),
  );
}

/** Lo que pasó con el dispositivo de alguien cuando se probó el aviso. */
export type ResultadoDePrueba = {
  dispositivo: string;
  ok: boolean;
  detalle: string;
};

/**
 * Manda un aviso de prueba a los dispositivos de una persona y cuenta qué pasó.
 *
 * Existe porque `sendHandoffPush` está escrito para no romper el webhook: se
 * traga cualquier fallo en un `console.error` que nadie mira desde un teléfono.
 * Eso está bien cuando el aviso es un efecto secundario de atender un mensaje,
 * y es inservible cuando lo que se quiere justamente es saber por qué no llega.
 *
 * Acá el error se devuelve tal cual lo manda el servicio de push, con su código
 * y su cuerpo. Es la diferencia entre "no me llega" y "Google rechaza la clave".
 */
export async function sendTestPush(
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string },
): Promise<{ configurado: boolean; resultados: ResultadoDePrueba[] }> {
  const config = vapidConfig();
  if (!config) return { configurado: false, resultados: [] };

  // Sólo los dispositivos de quien pide la prueba. Nadie puede hacer sonar el
  // teléfono de otra persona desde acá.
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId);

  if (error) {
    return { configurado: true, resultados: [{ dispositivo: "—", ok: false, detalle: error.message }] };
  }
  if (!subscriptions?.length) return { configurado: true, resultados: [] };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify({
    title: "Aviso de prueba",
    body: "Si ves esto, los avisos del CRM funcionan en este dispositivo.",
    tag: "prueba",
    url: "/",
  });

  return {
    configurado: true,
    resultados: await Promise.all(
      (subscriptions as SubscriptionRow[]).map(async (subscription) => {
        const dispositivo = nombreDelServicio(subscription.endpoint);
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: 60, urgency: "high" },
          );
          return { dispositivo, ok: true, detalle: "Aceptado por el servicio de push." };
        } catch (error) {
          return { dispositivo, ok: false, detalle: detalleDelError(error) };
        }
      }),
    ),
  };
}

/** De qué servicio es un endpoint, para distinguir dos dispositivos en la lista. */
function nombreDelServicio(endpoint: string): string {
  if (endpoint.includes("fcm.googleapis")) return "Android / Chrome";
  if (endpoint.includes("mozilla")) return "Firefox";
  if (endpoint.includes("windows.com")) return "Edge";
  if (endpoint.includes("push.apple")) return "Safari";
  return "Otro navegador";
}

/**
 * El error del servicio de push, en algo que se pueda leer en un teléfono.
 *
 * `web-push` tira un objeto con `statusCode` y el cuerpo de la respuesta. El
 * cuerpo es lo que dice de verdad qué pasó —una clave que no corresponde, un
 * registro vencido— así que se conserva recortado en vez de resumirlo a un
 * número.
 */
function detalleDelError(error: unknown): string {
  if (typeof error !== "object" || !error) return "Fallo desconocido al enviar.";

  const status = "statusCode" in error ? Number(error.statusCode) : 0;
  const cuerpo = "body" in error && typeof error.body === "string" ? error.body.trim() : "";
  const mensaje = error instanceof Error ? error.message : "";

  if (status === 403) return `403 — el servicio rechazó la clave VAPID. ${cuerpo}`.trim();
  if (status === 404 || status === 410) return `${status} — este dispositivo ya no existe, volvé a activar los avisos.`;
  if (status) return `${status} — ${cuerpo || mensaje || "sin detalle"}`.slice(0, 300);
  return (mensaje || "Fallo desconocido al enviar.").slice(0, 300);
}
