"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  can,
  isAdminRole,
  type MemberRole,
  type Permission,
  type PermissionMap,
} from "@/lib/permissions";

/**
 * Quién sos y qué podés hacer, disponible en cualquier parte de la app.
 *
 * Va por contexto y no por props porque los permisos se consultan hondo (el
 * botón de borrar de una columna del embudo, la caja de texto del chat) y
 * bajarlos a mano por cada capa hubiera tocado la firma de media docena de
 * componentes.
 *
 * Ojo: esto sólo decide qué se dibuja. La regla de verdad está en las políticas
 * RLS de Postgres, que se aplican aunque alguien llame a la API a mano.
 */
export type Access = {
  userId: string;
  role: MemberRole;
  isAdmin: boolean;
  can: (permission: Permission) => boolean;
};

const AccessContext = createContext<Access | null>(null);

export function AccessProvider({
  userId,
  role,
  permissions,
  children,
}: {
  userId: string;
  role: MemberRole;
  permissions: PermissionMap;
  children: ReactNode;
}) {
  const value = useMemo<Access>(
    () => ({
      userId,
      role,
      isAdmin: isAdminRole(role),
      can: (permission: Permission) => can(role, permissions, permission),
    }),
    [userId, role, permissions],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  const value = useContext(AccessContext);
  if (!value) throw new Error("useAccess necesita estar adentro de <AccessProvider>.");
  return value;
}
