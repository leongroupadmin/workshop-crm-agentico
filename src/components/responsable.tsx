"use client";

import { useEffect, useState, useTransition } from "react";

import { assignLead, loadWorkspaceUsers, type WorkspaceUser } from "@/app/actions";
import { useAccess } from "@/components/access";

/**
 * Selector del responsable de un lead.
 *
 * Vive acá y no dentro de una vista porque se usa en dos: la ficha grande del
 * lead y el panel del inbox. La primera versión de la etiqueta de la IA se
 * escribió dos veces, y cuando cambió el color quedó de un color en un lado y
 * de otro en el otro. Con la asignación el riesgo es peor: son permisos.
 *
 * Sólo devuelve el control. La etiqueta y el envoltorio los pone cada vista,
 * que son lo único que cambia entre las dos.
 *
 * Montalo con `key={contactId}`: el estado del selector es de ese lead, y en el
 * inbox se pasa de una conversación a otra sin desmontar nada. La `key` es la
 * forma de que React lo reinicie, en vez de sincronizarlo a mano con un efecto.
 */
export function ResponsableSelect({
  contactId,
  assignedTo: inicial,
  onNotice,
  id,
  className,
  readOnlyClassName,
}: {
  contactId: string;
  assignedTo: string | null | undefined;
  onNotice: (message: string) => void;
  id: string;
  className: string;
  readOnlyClassName: string;
}) {
  const access = useAccess();
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [assignedTo, setAssignedTo] = useState(inicial ?? "");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let vigente = true;
    loadWorkspaceUsers().then((result) => {
      if (vigente && result.ok) setUsers(result.users);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const asignar = (userId: string) => {
    // Se pinta el cambio antes de que responda el servidor y se vuelve atrás si
    // falla: elegir a alguien de una lista y que tarde en reflejarse se siente
    // roto.
    const anterior = assignedTo;
    setAssignedTo(userId);
    startTransition(async () => {
      const result = await assignLead({ contactId, userId: userId || null });
      if (!result.ok) {
        setAssignedTo(anterior);
        onNotice(result.error);
        return;
      }
      onNotice(
        userId
          ? `Lead asignado a ${users.find((user) => user.userId === userId)?.email ?? "esa persona"}.`
          : "El lead volvió a la bolsa de sin asignar.",
      );
    });
  };

  if (!access.can("asignar_leads")) {
    const actual = users.find((user) => user.userId === assignedTo);
    return <p className={readOnlyClassName}>{actual?.email ?? "Sin asignar"}</p>;
  }

  return (
    <select
      id={id}
      value={assignedTo}
      disabled={pending}
      onChange={(event) => asignar(event.target.value)}
      className={className}
    >
      <option value="">Sin asignar</option>
      {users.map((user) => (
        <option key={user.userId} value={user.userId}>
          {user.email}
        </option>
      ))}
    </select>
  );
}
