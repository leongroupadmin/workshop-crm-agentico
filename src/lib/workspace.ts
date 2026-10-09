import "server-only";

import { safeTimeZone } from "@/lib/fechas";
import {
  isAdminRole,
  sanitizePermissions,
  type MemberRole,
  type PermissionMap,
} from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export type WorkspaceContext =
  | { status: "configuration-missing" }
  | { status: "signed-out" }
  /** Instalación nueva: todavía no existe ningún workspace y hay que crearlo. */
  | { status: "needs-workspace"; userEmail: string }
  /** La sesión es válida, pero ese mail no está dado de alta en el CRM. */
  | { status: "no-access"; userEmail: string }
  | {
      status: "ready";
      userId: string;
      userEmail: string;
      workspaceId: string;
      workspaceName: string;
      /**
       * Zona horaria del equipo. Define qué es "hoy" en el resumen, que si no
       * lo resuelve el reloj del servidor —UTC en Vercel— y adelanta el día.
       */
      timezone: string;
      /** Administrador u operario. Decide qué se puede tocar y qué se ve. */
      role: MemberRole;
      /** Sólo cuentan para el operario: el administrador puede todo. */
      permissions: PermissionMap;
      isAdmin: boolean;
    };

type WorkspaceUnico =
  | { estado: "ok"; id: string }
  /** No hay ninguno todavía: recién instalado. */
  | { estado: "vacio" }
  /** No se pudo averiguar (falta la service role key). */
  | { estado: "desconocido" };

/**
 * El workspace ya resuelto. Una vez que existe, el más antiguo no cambia nunca,
 * así que alcanza con buscarlo una vez por proceso en vez de en cada request.
 *
 * Sólo se guarda el caso "ok": cachear "vacio" dejaría la instalación nueva
 * pidiendo crear el workspace para siempre, incluso después de haberlo creado.
 */
let workspaceCacheado: string | undefined;

/**
 * El único workspace del CRM.
 *
 * Esta instalación es de una sola empresa: hay un workspace y todos los
 * usuarios entran a ése. El esquema admite varios —viene de un diseño
 * multi-tenant— y esa libertad de más causaba dos problemas que se cierran acá.
 *
 * Uno: alguien entraba con un mail sin alta, la pantalla le ofrecía crear un
 * workspace propio y terminaba dentro de un CRM vacío, creyendo que había
 * perdido los chats y las instrucciones de los agentes. Ahora sin alta no se
 * entra, y la pantalla lo dice con todas las letras.
 *
 * Dos: la membresía se elegía por la más antigua *del usuario*. A quien le
 * hubiera quedado colgada una de un workspace viejo, agregarlo al bueno no
 * alcanzaba: seguía cayendo en el viejo, sin forma de cambiarlo desde la
 * interfaz. Fijando el workspace, la única membresía que se mira es la de ése.
 *
 * Va con la service role key porque RLS sólo deja ver los workspaces donde el
 * usuario ya es miembro, que es justo lo que acá hay que averiguar desde
 * afuera.
 */
async function workspaceUnico(): Promise<WorkspaceUnico> {
  if (workspaceCacheado) return { estado: "ok", id: workspaceCacheado };

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("workspaces")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return { estado: "desconocido" };
    if (!data?.id) return { estado: "vacio" };

    workspaceCacheado = data.id;
    return { estado: "ok", id: data.id };
  } catch {
    // Falta SUPABASE_SERVICE_ROLE_KEY. No es motivo para dejar al equipo
    // afuera: se sigue con la membresía del usuario, como antes de este cambio.
    return { estado: "desconocido" };
  }
}

/**
 * Suma al usuario al workspace como administrador.
 *
 * Es lo que hace que crear la cuenta en el panel de Supabase alcance: ahí sólo
 * nace la cuenta de acceso, y la membresía —que es lo que de verdad abre el
 * CRM— vive en otra tabla.
 *
 * En esta versión no hay pantalla de Usuarios ni roles para repartir: toda
 * cuenta que entra ve y puede todo. Por eso es clave dejar apagado el registro
 * público en Supabase (ver el README): cualquier cuenta del proyecto entra como
 * administradora.
 *
 * Va con la service role key porque todavía no es miembro, y la política de
 * `workspace_members` sólo deja escribir a los administradores del workspace.
 */
async function autoAlta(workspaceId: string, userId: string): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "admin", permissions: {} });
  } catch {
    // Si falla —por ejemplo, dos pestañas entrando a la vez y una gana la
    // clave primaria—, la lectura siguiente decide. No hay nada que reportar.
  }
}

/** Resuelve la sesión y el workspace del usuario en el servidor. */
export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { status: "configuration-missing" };
  }

  const supabase = await getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "signed-out" };

  const userEmail = user.email ?? "";

  const unico = await workspaceUnico();

  // Nadie instaló nada todavía: el primero que entra crea el CRM. Es el único
  // momento en que se puede crear un workspace.
  if (unico.estado === "vacio") return { status: "needs-workspace", userEmail };

  // La membresía se pide dos veces como mucho: con la zona horaria y, si esa
  // columna todavía no existe, sin ella.
  //
  // No es paranoia: el código llega a producción cuando termina el deploy, y
  // la migración cuando alguien la corre a mano. En esa ventana PostgREST
  // rechaza el select entero por una columna que no encuentra, y como acá un
  // error y un usuario sin alta se ven igual —`data` en null—, el CRM le
  // mostraba la pantalla equivocada a todo el equipo. Una zona horaria no
  // puede tirar abajo el ingreso.
  const membership = async (conZona: boolean) => {
    const query = supabase
      .from("workspace_members")
      .select(
        `workspace_id, role, permissions, workspaces(name${conZona ? ", timezone" : ""})`,
      )
      .eq("user_id", user.id);

    return unico.estado === "ok"
      ? query.eq("workspace_id", unico.id).maybeSingle()
      : query.order("created_at", { ascending: true }).limit(1).maybeSingle();
  };

  const leer = async () => {
    const conZona = await membership(true);
    return conZona.error ? (await membership(false)).data : conZona.data;
  };

  let data = await leer();

  // Sin membresía: se la damos y volvemos a leer. Así alcanza con crear la
  // cuenta en el panel de Supabase, sin un segundo paso.
  if (!data?.workspace_id && unico.estado === "ok") {
    await autoAlta(unico.id, user.id);
    data = await leer();
  }

  // Quedó sin membresía igual: sólo pasa si el alta falló o si no se pudo
  // resolver el workspace. Se avisa en vez de mostrar un CRM a medias.
  if (!data?.workspace_id) return { status: "no-access", userEmail };

  // PostgREST devuelve un objeto para relaciones "a uno", pero algunas
  // versiones lo entregan como arreglo de un elemento.
  //
  // Los campos van sueltos porque la consulta de arriba tiene dos formas: sin
  // la migración corrida, `timezone` no viene.
  const relacionado = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  const related = (relacionado ?? {}) as { name?: string | null; timezone?: string | null };

  // Ante la duda, operario. Un rol desconocido nunca debería dar privilegios.
  const role: MemberRole =
    data.role === "owner" || data.role === "admin" ? data.role : "agent";

  return {
    status: "ready",
    userId: user.id,
    userEmail,
    workspaceId: data.workspace_id,
    workspaceName: related.name ?? "Workspace",
    timezone: safeTimeZone(related.timezone),
    role,
    permissions: sanitizePermissions(data.permissions),
    isAdmin: isAdminRole(role),
  };
}
