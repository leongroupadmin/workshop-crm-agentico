/**
 * Roles y permisos del workspace.
 *
 * Sin `server-only`: el mismo catálogo se usa en el servidor para validar y en
 * el navegador para dibujar las casillas. Duplicarlo era la forma segura de que
 * un día dijeran cosas distintas.
 *
 * Las claves tienen que coincidir letra por letra con las que leen las
 * funciones de Postgres en `202608170007_roles_y_permisos.sql` y, las de
 * tareas, en `202610070001_tareas.sql`. La verdad está en la base: esto sólo la
 * refleja.
 */

/** Los roles que guarda `workspace_members.role`. */
export type MemberRole = "owner" | "admin" | "agent";

export const MEMBER_ROLES: MemberRole[] = ["owner", "admin", "agent"];

/**
 * `owner` y `admin` son lo mismo de cara al usuario: administrador. La
 * diferencia es interna — el owner no se puede quedar sin workspace, así que
 * siempre tiene que quedar al menos uno.
 */
export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Administrador",
  admin: "Administrador",
  agent: "Operario",
};

export type Permission =
  | "ver_todos_los_leads"
  | "ver_leads_sin_asignar"
  | "asignar_leads"
  | "crear_contactos"
  | "eliminar_contactos"
  | "editar_embudo"
  | "responder_chats"
  | "gestionar_agenda"
  | "asignar_tareas"
  | "ver_tareas_del_equipo"
  | "gestionar_agentes";

export type PermissionMap = Partial<Record<Permission, boolean>>;

/** Cómo se agrupan los permisos. */
export type PermissionGroup = "Leads" | "Trabajo diario" | "Configuración";

export const PERMISSIONS: {
  key: Permission;
  group: PermissionGroup;
  label: string;
  hint: string;
}[] = [
  {
    key: "ver_todos_los_leads",
    group: "Leads",
    label: "Ver todos los leads",
    hint: "Sin esto sólo ve los leads donde figura como responsable.",
  },
  {
    key: "ver_leads_sin_asignar",
    group: "Leads",
    label: "Ver los leads sin asignar",
    hint: "Le deja tomar los que entran por WhatsApp y todavía no repartió nadie.",
  },
  {
    key: "asignar_leads",
    group: "Leads",
    label: "Cambiar el responsable",
    hint: "Puede pasarle un lead a otra persona, o quedárselo.",
  },
  {
    key: "crear_contactos",
    group: "Trabajo diario",
    label: "Cargar contactos",
    hint: "Alta manual de un lead nuevo.",
  },
  {
    key: "responder_chats",
    group: "Trabajo diario",
    label: "Responder chats",
    hint: "Sin esto lee las conversaciones pero no puede escribir.",
  },
  {
    key: "gestionar_agenda",
    group: "Trabajo diario",
    label: "Manejar la agenda",
    hint: "Crear, mover y cancelar turnos.",
  },
  {
    key: "asignar_tareas",
    group: "Trabajo diario",
    label: "Darle tareas a otros",
    hint: "Sin esto cada uno se programa sus propias tareas, pero no le puede pasar una a un compañero.",
  },
  {
    key: "ver_tareas_del_equipo",
    group: "Trabajo diario",
    label: "Ver las tareas del equipo",
    hint: "Ve lo que tiene pendiente cada uno, salvo las tareas de leads que no le tocan.",
  },
  {
    key: "eliminar_contactos",
    group: "Configuración",
    label: "Eliminar contactos",
    hint: "Borrado definitivo, con sus chats y sus turnos. Archivar no necesita permiso.",
  },
  {
    key: "editar_embudo",
    group: "Configuración",
    label: "Editar el embudo",
    hint: "Agregar, renombrar, reordenar y borrar columnas para todo el workspace.",
  },
  {
    key: "gestionar_agentes",
    group: "Configuración",
    label: "Configurar los agentes IA",
    hint: "Cambiar las instrucciones y prender o apagar la IA de cada canal.",
  },
];

export const PERMISSION_KEYS: Permission[] = PERMISSIONS.map((item) => item.key);

export const isAdminRole = (role: MemberRole) => role === "owner" || role === "admin";

/**
 * Si un miembro puede hacer algo. El administrador siempre puede: su rol vale
 * más que cualquier casilla, igual que en `has_permission()` de Postgres.
 */
export function can(role: MemberRole, permissions: PermissionMap, permission: Permission) {
  return isAdminRole(role) || permissions[permission] === true;
}

/** Limpia lo que llega del cliente: sólo claves conocidas, sólo booleanos. */
export function sanitizePermissions(input: unknown): PermissionMap {
  const source = (input ?? {}) as Record<string, unknown>;
  const clean: PermissionMap = {};
  for (const key of PERMISSION_KEYS) {
    if (source[key] === true) clean[key] = true;
  }
  return clean;
}
