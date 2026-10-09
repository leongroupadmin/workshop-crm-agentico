"use client";

import { KeyRound, ShieldCheck, TriangleAlert, UserPlus, UserRound, UsersRound, X } from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  addMember,
  createUserAccount,
  loadMembers,
  removeMember,
  setMemberPassword,
  setMemberPermissions,
  setMemberRole,
  setMemberStages,
  type WorkspaceMember,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { hayVariosEmbudos, nombreCompletoDeEtapa } from "@/components/opciones-de-etapa";
import { Card, EmptyState, INPUT_CLASS, PRIMARY_BUTTON_CLASS, avatarColor, initials } from "@/components/ui";
import type { StageRow } from "@/lib/crm-data";
import { MIN_PASSWORD_CHARS } from "@/lib/password";
import {
  PERMISSIONS,
  ROLE_LABELS,
  isAdminRole,
  type MemberRole,
  type Permission,
  type PermissionGroup,
  type PermissionMap,
} from "@/lib/permissions";

const GROUPS: PermissionGroup[] = ["Leads", "Trabajo diario", "Configuración"];

/**
 * Gestión de usuarios del workspace.
 *
 * Sólo la ve un administrador. Desde acá se crean las cuentas, se les da un rol
 * y se les reparten los permisos.
 *
 * Hay dos puertas de alta y las dos terminan acá: esta pantalla, que crea la
 * cuenta y la membresía de una, y el panel de Supabase, que crea sólo la cuenta
 * —el CRM la suma solo, como operario sin permisos, la primera vez que entra—.
 *
 * Ninguna de las dos es registro público: en las dos hay que ser administrador
 * de algo para abrirlas. Lo que sí implica es que cualquier cuenta del proyecto
 * Supabase termina entrando, así que el registro abierto tiene que estar
 * apagado del lado de Supabase.
 *
 * Cada casilla guarda al toque, sin botón de "guardar". Son cambios de una sola
 * cosa y muy reversibles; juntarlos en un formulario sólo agregaba el riesgo de
 * marcarlos todos y perderlos por cerrar la pantalla.
 */
export function UsersPanel({
  stages,
  onNotice,
}: {
  stages: StageRow[];
  onNotice: (message: string) => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [disponibles, setDisponibles] = useState<{ userId: string; email: string }[]>([]);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [error, setError] = useState("");

  const refrescar = async () => {
    const result = await loadMembers();
    if (result.ok) {
      setMembers(result.members);
      setDisponibles(result.disponibles);
      setEstado("listo");
      return true;
    }
    setError(result.error);
    setEstado("error");
    return false;
  };

  useEffect(() => {
    let vigente = true;
    loadMembers().then((result) => {
      if (!vigente) return;
      if (result.ok) {
        setMembers(result.members);
        setDisponibles(result.disponibles);
        setEstado("listo");
      } else {
        setError(result.error);
        setEstado("error");
      }
    });
    return () => {
      vigente = false;
    };
  }, []);

  if (estado === "cargando") {
    return <p className="text-sm text-neutral-500">Cargando los usuarios…</p>;
  }

  if (estado === "error") {
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-sm text-red-600">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <AddMemberCard
        disponibles={disponibles}
        onNotice={onNotice}
        onDone={() => void refrescar()}
      />

      {members.length === 0 ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="Todavía no hay nadie más"
            description="Creá el primero con el formulario de arriba."
          />
        </Card>
      ) : (
        members.map((member) => (
          <MemberCard
            key={member.userId}
            member={member}
            stages={stages}
            onNotice={onNotice}
            onChanged={() => void refrescar()}
          />
        ))
      )}
    </div>
  );
}

function AddMemberCard({
  disponibles,
  onNotice,
  onDone,
}: {
  disponibles: { userId: string; email: string }[];
  onNotice: (message: string) => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<MemberRole>("agent");
  const [pending, startTransition] = useTransition();

  const listo = (result: { ok: true; warning?: string } | { ok: false; error: string }) => {
    if (!result.ok) {
      onNotice(result.error);
      return;
    }
    setEmail("");
    setPassword("");
    setUserId("");
    onNotice(result.warning ?? "Usuario agregado al workspace.");
    onDone();
  };

  const crear = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => listo(await createUserAccount({ email, password, role })));
  };

  const sumar = () => {
    startTransition(async () => listo(await addMember({ userId, role })));
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <UserPlus className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Crear un usuario</h2>
          <p className="text-sm text-neutral-500">
            Poné el mail, una contraseña y el rol. Después pasale esos datos a la persona: entra
            con eso, sin enlaces ni correos de por medio.
          </p>
        </div>
      </div>

      <form onSubmit={crear} className="mt-5 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="nuevo-usuario-mail">
            Mail del nuevo usuario
          </label>
          <input
            id="nuevo-usuario-mail"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nombre@ejemplo.com"
            className={INPUT_CLASS}
          />
          <label className="sr-only" htmlFor="nuevo-usuario-clave">
            Contraseña
          </label>
          <input
            id="nuevo-usuario-clave"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`Contraseña (mínimo ${MIN_PASSWORD_CHARS})`}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="nuevo-usuario-rol">
            Rol
          </label>
          <select
            id="nuevo-usuario-rol"
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
            className={INPUT_CLASS}
          >
            <option value="agent">Operario</option>
            <option value="admin">Administrador</option>
          </select>
          <button
            type="submit"
            disabled={pending || email.trim().length === 0 || password.length === 0}
            className={`${PRIMARY_BUTTON_CLASS} sm:w-40`}
          >
            {pending ? "Creando…" : "Crear"}
          </button>
        </div>
      </form>

      {/* Cuentas que ya existen en Supabase pero nunca entraron a este
          workspace. Es el caso de las que se crearon a mano antes de que esta
          pantalla existiera: se suman sin volver a crearlas. */}
      {disponibles.length > 0 && (
        <div className="mt-5 border-t border-[#ddd8c9] pt-5 dark:border-white/10">
          <p className="text-sm text-neutral-500">
            O sumá una cuenta que ya existe en Supabase pero todavía no está en el workspace.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="miembro-existente">
              Usuario existente
            </label>
            <select
              id="miembro-existente"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Elegí un usuario…</option>
              {disponibles.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={sumar}
              disabled={pending || !userId}
              className={`${PRIMARY_BUTTON_CLASS} sm:w-40`}
            >
              {pending ? "Sumando…" : "Sumar"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MemberCard({
  member,
  stages,
  onNotice,
  onChanged,
}: {
  member: WorkspaceMember;
  stages: StageRow[];
  onNotice: (message: string) => void;
  onChanged: () => void;
}) {
  const access = useAccess();
  const [role, setRole] = useState<MemberRole>(member.role);
  const [permissions, setPermissions] = useState<PermissionMap>(member.permissions);
  const [stageIds, setStageIds] = useState<string[]>(member.stageIds);
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [nuevaClave, setNuevaClave] = useState("");
  const [pending, startTransition] = useTransition();

  const esAdmin = isAdminRole(role);
  /* Una de entrada por embudo, no una sola en total: con varios embudos, la
     primera columna de cada uno es donde caen sus leads nuevos, y `can_see_stage()`
     las trata a todas igual. */
  const entryStageIds = new Set(
    [...new Set(stages.map((stage) => stage.pipelineId))].map(
      (pipelineId) => stages.find((stage) => stage.pipelineId === pipelineId)?.id ?? "",
    ),
  );
  const variosEmbudos = hayVariosEmbudos(stages);

  const cambiarRol = (next: MemberRole) => {
    const anterior = role;
    setRole(next);
    startTransition(async () => {
      const result = await setMemberRole({ userId: member.userId, role: next });
      if (!result.ok) {
        setRole(anterior);
        onNotice(result.error);
        return;
      }
      onNotice(`${member.email} ahora es ${ROLE_LABELS[next].toLowerCase()}.`);
      onChanged();
    });
  };

  const alternarPermiso = (permission: Permission) => {
    const next: PermissionMap = { ...permissions };
    if (next[permission]) delete next[permission];
    else next[permission] = true;

    const anterior = permissions;
    setPermissions(next);
    startTransition(async () => {
      const result = await setMemberPermissions({ userId: member.userId, permissions: next });
      if (!result.ok) {
        setPermissions(anterior);
        onNotice(result.error);
      }
    });
  };

  const alternarEtapa = (stageId: string) => {
    // Lista vacía quiere decir "ve todas". Destildar la primera de un embudo sin
    // restricciones tiene que dejar tildadas las demás, no borrar todo.
    const base = stageIds.length > 0 ? stageIds : stages.map((stage) => stage.id);
    const next = base.includes(stageId)
      ? base.filter((id) => id !== stageId)
      : [...base, stageId];

    const anterior = stageIds;
    setStageIds(next);
    startTransition(async () => {
      const result = await setMemberStages({ userId: member.userId, stageIds: next });
      if (!result.ok) {
        setStageIds(anterior);
        onNotice(result.error);
      }
    });
  };

  const guardarClave = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await setMemberPassword({ userId: member.userId, password: nuevaClave });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      setNuevaClave("");
      setCambiandoClave(false);
      onNotice(`Contraseña nueva para ${member.email}. Pasásela.`);
    });
  };

  const sacar = () => {
    startTransition(async () => {
      const result = await removeMember({ userId: member.userId });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      onNotice(`${member.email} ya no tiene acceso al CRM.`);
      onChanged();
    });
  };

  const veTodasLasEtapas = stageIds.length === 0;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${avatarColor(
            member.email,
          )}`}
        >
          {initials(member.email) || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            {member.email}
            {member.isYou && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-white/10">
                vos
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 text-sm text-neutral-500">
            {esAdmin ? <ShieldCheck className="size-3.5" /> : <UserRound className="size-3.5" />}
            {ROLE_LABELS[role]}
          </p>
        </div>

        <label className="sr-only" htmlFor={`rol-${member.userId}`}>
          Rol de {member.email}
        </label>
        <select
          id={`rol-${member.userId}`}
          value={esAdmin ? "admin" : "agent"}
          disabled={pending}
          onChange={(event) => cambiarRol(event.target.value as MemberRole)}
          className={`${INPUT_CLASS} w-44`}
        >
          <option value="agent">Operario</option>
          <option value="admin">Administrador</option>
        </select>

        <button
          type="button"
          onClick={() => setCambiandoClave(!cambiandoClave)}
          title="Cambiar la contraseña"
          aria-label={`Cambiar la contraseña de ${member.email}`}
          aria-expanded={cambiandoClave}
          className="cursor-pointer rounded-lg p-2 text-neutral-400 transition-colors hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
        >
          <KeyRound className="size-5" />
        </button>

        {!member.isYou && (
          <button
            type="button"
            onClick={sacar}
            disabled={pending}
            title="Sacar del workspace"
            aria-label={`Sacar a ${member.email} del workspace`}
            className="cursor-pointer rounded-lg p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-500/10"
          >
            <X className="size-5" />
          </button>
        )}
      </div>

      {/* El reemplazo del "olvidé mi contraseña": no hay mail de recupero, la
          resetea un administrador acá y se la pasa a la persona. Por eso el
          campo se ve mientras se escribe — hay que poder leerlo para dictarlo. */}
      {cambiandoClave && (
        <form onSubmit={guardarClave} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor={`clave-${member.userId}`}>
            Contraseña nueva de {member.email}
          </label>
          <input
            id={`clave-${member.userId}`}
            type="text"
            autoComplete="off"
            autoFocus
            value={nuevaClave}
            onChange={(event) => setNuevaClave(event.target.value)}
            placeholder={`Contraseña nueva (mínimo ${MIN_PASSWORD_CHARS})`}
            className={INPUT_CLASS}
          />
          <button
            type="submit"
            disabled={pending || nuevaClave.length === 0}
            className={`${PRIMARY_BUTTON_CLASS} sm:w-44`}
          >
            {pending ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      )}

      {esAdmin ? (
        <p className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500 dark:bg-white/5">
          Un administrador ve y hace todo, y puede configurar a los demás. No tiene permisos que
          marcar.
          {member.userId === access.userId &&
            " Si te bajás a operario perdés esta pantalla, salvo que quede otro administrador."}
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((group) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {group}
                </p>
                <div className="mt-2 space-y-2">
                  {PERMISSIONS.filter((item) => item.group === group).map((item) => (
                    <label key={item.key} className="flex cursor-pointer gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={permissions[item.key] === true}
                        disabled={pending}
                        onChange={() => alternarPermiso(item.key)}
                        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-500"
                      />
                      <span>
                        <span className="font-medium">{item.label}</span>
                        <span className="block text-xs text-neutral-500">{item.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-[#ddd8c9] pt-5 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Columnas del embudo que ve
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {veTodasLasEtapas
                ? "Ve el embudo completo. Destildá alguna para restringirlo."
                : "Los leads que estén en las columnas destildadas no le aparecen en ningún lado."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {stages.map((stage) => {
                const fija = entryStageIds.has(stage.id);
                // La de entrada se ve siempre, la marque o no el administrador:
                // así lo resuelve `can_see_stage()` en la base.
                const marcada = fija || veTodasLasEtapas || stageIds.includes(stage.id);
                return (
                  <label
                    key={stage.id}
                    title={
                      fija
                        ? "La columna de entrada se ve siempre: es donde caen los leads nuevos."
                        : undefined
                    }
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      fija ? "cursor-default opacity-70" : "cursor-pointer"
                    } ${
                      marcada
                        ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-[#ddd8c9] text-neutral-500 dark:border-white/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      disabled={pending || fija}
                      onChange={() => alternarEtapa(stage.id)}
                      className="size-4 cursor-pointer accent-amber-500 disabled:cursor-default"
                    />
                    {nombreCompletoDeEtapa(stage, variosEmbudos)}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
