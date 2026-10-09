import "server-only";

import { formasDelTelefono } from "@/lib/difusiones";
import { asegurarOportunidad } from "@/lib/embudos";
import type { DatosDelLead } from "@/lib/landing-marca";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * El lead que sale de una charla en la landing.
 *
 * Entra como contacto y oportunidad, no como conversación. No es una limitación
 * que haya que arreglar después: la tabla de conversaciones exige un canal del
 * enum —`whatsapp`, `instagram`, `messenger`— y un proveedor de la lista, y
 * sumar `web` a los dos sería una migración a mano contra Supabase. Pero sobre
 * todo sería mentir: una conversación en el CRM es algo por donde se puede
 * contestar, y a un visitante de la web no se le puede escribir.
 *
 * Así que el equipo lo ve donde lo va a trabajar —en Contactos y en el
 * embudo—, con la charla completa guardada en la ficha, y la respuesta va por
 * WhatsApp, que es el único lugar donde esa persona existe de verdad.
 */

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const LOG = "[landing]";

/** La etiqueta con la que se reconoce de dónde salió. */
const ETIQUETA = "web";

/** Cómo se llama el que no dijo su nombre. */
const SIN_NOMBRE = "Consulta desde la web";

/** Cuántos mensajes de la charla se guardan en la ficha. */
const MAX_GUARDADOS = 24;

export type TurnoGuardado = { de: "visitante" | "agente"; texto: string };

/**
 * El workspace de esta instalación.
 *
 * El chat de la landing no tiene sesión, así que no hay contexto del que
 * sacarlo. Hay uno solo por instalación —el servidor rechaza crear un segundo,
 * y está documentado en el README— así que el más viejo es el único.
 */
async function workspaceUnico(supabase: Supabase): Promise<string | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`${LOG} no se pudo leer el workspace:`, error.message);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * El contacto que ya tiene este teléfono, escrito como sea.
 *
 * Es la misma búsqueda que hace el webhook de WhatsApp, y por el mismo motivo:
 * el número se guarda de formas distintas según quién lo haya escrito. Acá
 * importa el doble, porque es lo que evita que la persona que charló en la web
 * y después escribió al WhatsApp termine con dos fichas.
 */
async function porTelefono(
  supabase: Supabase,
  workspaceId: string,
  telefono: string | undefined,
): Promise<string | null> {
  const formas = formasDelTelefono(telefono);
  if (formas.length === 0) return null;

  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("phone", formas)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/**
 * El contacto que dejó esta misma charla, si ya se había creado.
 *
 * La sesión es un identificador que arma el navegador y manda en cada pedido.
 * Sin esto, cada mensaje nuevo de la misma persona crearía otra ficha: el chat
 * no tiene estado del lado del servidor, así que el único hilo entre un pedido
 * y el siguiente es ese número.
 *
 * Se guarda dentro de `notes`, que es jsonb y ya existe, en vez de una columna
 * nueva. Es lo que permite que todo esto no necesite tocar el esquema.
 */
async function porSesion(
  supabase: Supabase,
  workspaceId: string,
  sesion: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("notes->landing->>sesion", sesion)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/** Las etiquetas que tenía más la nuestra, sin repetirla. */
function conEtiqueta(previas: unknown): string[] {
  const lista = Array.isArray(previas) ? previas.filter((x): x is string => typeof x === "string") : [];
  return lista.includes(ETIQUETA) ? lista : [...lista, ETIQUETA];
}

/**
 * Deja el lead de esta charla en el CRM.
 *
 * Es idempotente por sesión: la primera vez crea la ficha y las siguientes
 * actualizan la misma, así la conversación se va completando a medida que la
 * persona escribe en vez de dejar cinco fichas sueltas.
 *
 * Nunca tira: es trabajo de fondo detrás de una página pública, y que falle no
 * puede romperle el chat a nadie. Pero sí cuenta qué pasó, en el log y en lo
 * que devuelve: cuando el lead no aparece en el CRM, desde afuera se ve igual
 * que si el agente hubiera decidido no marcarlo, y son dos problemas distintos
 * —uno se arregla con una variable de entorno y el otro tocando el prompt.
 */
export type ResultadoDelLead =
  | { ok: true; contactId: string; creado: boolean }
  | { ok: false; motivo: string };

export async function guardarLeadDeLanding(input: {
  sesion: string;
  datos: DatosDelLead;
  conversacion: TurnoGuardado[];
}): Promise<ResultadoDelLead> {
  try {
    const supabase = getSupabaseAdmin();

    const workspaceId = await workspaceUnico(supabase);
    if (!workspaceId) return { ok: false, motivo: "el workspace no existe o no se pudo leer" };

    const telefono = input.datos.telefono?.trim() || undefined;

    // El teléfono manda sobre la sesión: si la persona ya estaba en la base
    // —porque escribió por WhatsApp alguna vez— esta charla tiene que caer en
    // su ficha y no abrir una nueva.
    const existente =
      (await porTelefono(supabase, workspaceId, telefono)) ??
      (await porSesion(supabase, workspaceId, input.sesion));

    const landing = {
      sesion: input.sesion,
      actualizado: new Date().toISOString(),
      rubro: input.datos.rubro ?? null,
      resumen: input.datos.resumen ?? null,
      conversacion: input.conversacion.slice(-MAX_GUARDADOS),
    };

    if (existente) {
      const { data: previo } = await supabase
        .from("contacts")
        .select("name, phone, tags, notes")
        .eq("id", existente)
        .maybeSingle();

      const notas = (previo?.notes ?? {}) as Record<string, unknown>;

      await supabase
        .from("contacts")
        .update({
          // Lo que ya estaba cargado gana: un nombre puesto por el equipo vale
          // más que el que el visitante tipeó en un chat.
          name: previo?.name?.trim() || input.datos.nombre?.trim() || SIN_NOMBRE,
          phone: previo?.phone?.trim() || telefono || null,
          tags: conEtiqueta(previo?.tags),
          notes: { ...notas, landing },
        })
        .eq("id", existente);

      await asegurarOportunidad(supabase, workspaceId, existente, LOG);
      console.log(`${LOG} lead actualizado: ${existente}`);
      return { ok: true, contactId: existente, creado: false };
    }

    const { data: creado, error } = await supabase
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        name: input.datos.nombre?.trim() || SIN_NOMBRE,
        phone: telefono ?? null,
        tags: [ETIQUETA],
        notes: { landing },
      })
      .select("id")
      .single();

    if (error || !creado) {
      console.error(`${LOG} no se pudo crear el contacto:`, error?.message);
      return { ok: false, motivo: error?.message ?? "la base no devolvió el contacto" };
    }

    const contactId = creado.id as string;
    await asegurarOportunidad(supabase, workspaceId, contactId, LOG);
    console.log(`${LOG} lead creado: ${contactId}`);
    return { ok: true, contactId, creado: true };
  } catch (error) {
    console.error(`${LOG} no se pudo guardar el lead:`, error);
    return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
  }
}
