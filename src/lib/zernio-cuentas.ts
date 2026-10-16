import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { listZernioConversations } from "@/lib/zernio-api";

/**
 * En qué terminó el intento de reatar la cuenta de una conversación.
 *
 * No alcanza con "se pudo o no se pudo": los tres motivos por los que no se
 * puede significan cosas distintas para quien está mirando el error, y son
 * justo lo que separa las causas del mismo 403. Que Zernio siga reportando la
 * misma cuenta descarta el id viejo; que no liste la conversación apunta a que
 * la key es de otro perfil; que no se pueda listar es un problema anterior.
 */
export type Reconciliacion =
  | { estado: "reatada"; cuenta: string }
  | { estado: "sin-cambios" }
  | { estado: "sin-conversacion" }
  | { estado: "sin-listado"; error: string };

/**
 * Vuelve a atar una conversación a la cuenta que Zernio tiene hoy.
 *
 * Cuando un perfil se desconecta y se vuelve a conectar en Zernio —Instagram,
 * Facebook, el número de WhatsApp—, la cuenta queda con un id nuevo. El CRM
 * sigue guardando el viejo en `conversations.zernio_account_id`, y al responder
 * Zernio contesta 403: la key es válida, pero esa cuenta ya no existe de su
 * lado. Desde la bandeja se ve como "la API no tiene permiso sobre esta
 * cuenta", sin nada que tocar para arreglarlo.
 *
 * El webhook ya rellena la cuenta nueva, pero recién cuando el contacto vuelve
 * a escribir: hasta entonces el hilo queda mudo. Esto lo destraba antes, en el
 * mismo envío que falló.
 *
 * El listado de Zernio es la fuente de verdad y viene filtrado por la propia
 * key, así que sólo trae cuentas sobre las que la key sí puede actuar: si la
 * conversación no aparece, no hay a qué reatar.
 */
export async function reconciliarCuentaZernio(input: {
  /** El `zernio_chat_id`, que es el id de la conversación en Zernio. */
  chatId: string;
  /** La cuenta que Zernio acaba de rechazar. */
  cuentaGuardada: string;
}): Promise<Reconciliacion> {
  const listed = await listZernioConversations(100);
  if (!listed.ok) {
    console.error("[zernio] no se pudo listar para reatar la cuenta:", listed.error);
    return { estado: "sin-listado", error: listed.error };
  }

  const actual = listed.conversations.find((item) => item.id === input.chatId);
  if (!actual) return { estado: "sin-conversacion" };

  const cuenta = actual.accountId?.trim();
  if (!cuenta || cuenta === input.cuentaGuardada) return { estado: "sin-cambios" };

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    // Sin service-role no se puede persistir, pero el envío igual puede salir
    // con la cuenta nueva: se devuelve para que el reintento la use.
    console.error("[zernio]", error);
    return { estado: "reatada", cuenta };
  }

  // Se acota también por la cuenta vieja: así el update no toca un hilo que
  // otro workspace pudiera tener con el mismo id de chat.
  const { data: filas, error } = await supabase
    .from("conversations")
    .update({ zernio_account_id: cuenta })
    .eq("zernio_chat_id", input.chatId)
    .eq("zernio_account_id", input.cuentaGuardada)
    .select("workspace_id");

  if (error) {
    console.error("[zernio] no se pudo reatar la conversación:", error.message);
    return { estado: "reatada", cuenta };
  }

  const workspaceId = filas?.[0]?.workspace_id;
  if (!workspaceId) return { estado: "reatada", cuenta };

  // Registrar la cuenta nueva también en el mapeo: si no, el próximo mensaje
  // entrante por ella llega sin workspace al que asociarse.
  const { error: bindError } = await supabase.from("zernio_accounts").upsert(
    {
      zernio_account_id: cuenta,
      workspace_id: workspaceId,
      platform: actual.platform ?? null,
    },
    { onConflict: "zernio_account_id", ignoreDuplicates: true },
  );

  if (bindError) console.error("[zernio] no se pudo registrar la cuenta nueva:", bindError.message);

  return { estado: "reatada", cuenta };
}

/**
 * Lo que hay que agregarle al 403 cuando no hubo nada que reatar.
 *
 * El error de Zernio dice que la cuenta fue rechazada, pero no por qué. Esto
 * completa la otra mitad con lo único que el CRM sí puede saber: si Zernio
 * reconoce o no esa conversación y esa cuenta.
 */
export function explicarReconciliacion(resultado: Reconciliacion): string {
  switch (resultado.estado) {
    case "reatada":
      return "";
    case "sin-cambios":
      return "Zernio sigue reportando esta misma cuenta, así que no es un id viejo: a la API key le falta permiso sobre ella.";
    case "sin-conversacion":
      return "Zernio no lista esta conversación entre las suyas: lo más probable es que la API key cargada en Conexiones sea de otro perfil de Zernio.";
    case "sin-listado":
      return `Tampoco se pudieron listar las conversaciones de Zernio: ${resultado.error}`;
  }
}
