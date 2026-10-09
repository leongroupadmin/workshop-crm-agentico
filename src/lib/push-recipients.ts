export type PushMember = {
  user_id: string;
  role: string;
  permissions: Record<string, unknown> | null;
};

function puedeRecibirSinAsignar(member: PushMember): boolean {
  if (member.role === "owner" || member.role === "admin") return true;
  const permissions = member.permissions ?? {};
  return (
    permissions.responder_chats === true &&
    (permissions.ver_leads_sin_asignar === true || permissions.ver_todos_los_leads === true)
  );
}

/** Destinatarios humanos de una derivación, antes de buscar sus dispositivos. */
export function handoffRecipientIds(members: PushMember[], assignedTo: string | null): string[] {
  return members
    .filter((member) =>
      assignedTo ? member.user_id === assignedTo : puedeRecibirSinAsignar(member),
    )
    .map((member) => member.user_id);
}
