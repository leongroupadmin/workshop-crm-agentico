"use client";

import {
  Ban,
  Check,
  ListTodo,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";

import {
  createTask,
  deleteTask,
  listTasks,
  loadWorkspaceUsers,
  markTasksSeen,
  searchContacts,
  setTaskStatus,
  updateTask,
  type ContactoEncontrado,
  type WorkspaceUser,
} from "@/app/actions";
import { useAccess, type Access } from "@/components/access";
import { Card, EmptyState, INPUT_CLASS, Modal, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/fechas";
import {
  AVISO_POR_OMISION,
  AVISOS_DE_TAREA,
  ETIQUETA_DEL_ESTADO,
  ETIQUETA_DEL_TIPO,
  MAX_NOTAS,
  MAX_TITULO,
  TIPO_POR_OMISION,
  TIPOS_DE_TAREA,
  agruparTareas,
  grupoDeTarea,
  minutosDeAviso,
  textoDeVencimiento,
  type EstadoDeTarea,
  type TareaRow,
  type TipoDeTarea,
} from "@/lib/tareas";

/* ---------------------------------------------------------- piezas comunes */

/**
 * La hora de ahora, que avanza sola cada minuto.
 *
 * Sin esto una tarea de las 10 seguiría en "Hoy" hasta que alguien recargue,
 * aunque sean las 11: el grupo "Vencidas" es justamente lo que tiene que
 * aparecer sin que nadie haga nada.
 */
export function useAhora(): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return ahora;
}

/**
 * Los miembros del workspace, pedidos una sola vez por carga de la página.
 *
 * Los usan la lista (para decir de quién es cada tarea) y el formulario (para
 * elegir a quién dársela), y se montan a la vez. Sin la promesa compartida
 * serían dos pedidos iguales cada vez que se abre una tarea.
 */
let usuariosEnCurso: Promise<WorkspaceUser[]> | null = null;

function pedirUsuarios(): Promise<WorkspaceUser[]> {
  usuariosEnCurso ??= loadWorkspaceUsers().then((result) => {
    if (result.ok) return result.users;
    // Un fallo no se guarda: el próximo que pregunte vuelve a intentar.
    usuariosEnCurso = null;
    return [];
  });
  return usuariosEnCurso;
}

export function useUsuarios(): WorkspaceUser[] {
  const [usuarios, setUsuarios] = useState<WorkspaceUser[]>([]);
  useEffect(() => {
    let vigente = true;
    pedirUsuarios().then((lista) => {
      if (vigente) setUsuarios(lista);
    });
    return () => {
      vigente = false;
    };
  }, []);
  return usuarios;
}

/** El mail sin el dominio: en una lista apretada "juan" se lee mejor. */
function nombreCorto(usuarios: WorkspaceUser[], userId: string | null): string {
  if (!userId) return "Sin asignar";
  const email = usuarios.find((usuario) => usuario.userId === userId)?.email;
  return email ? email.split("@")[0] : "Alguien del equipo";
}

/** Quién puede tocar una tarea, igual que la política de UPDATE. */
const puedeEditar = (access: Access, tarea: TareaRow) =>
  access.isAdmin || tarea.asignadaA === access.userId || tarea.creadaPor === access.userId;

/** Quién puede borrarla, igual que la política de DELETE. */
const puedeBorrar = (access: Access, tarea: TareaRow) =>
  access.isAdmin || tarea.creadaPor === access.userId;

/* ------------------------------------------------------------ la sección */

type Alcance = "mias" | "delegadas" | "equipo";
type Estado = "pendientes" | "cerradas";

/** El resultado de una búsqueda, atado a la clave que lo pidió. */
type Busqueda = { clave: string; tareas: TareaRow[]; error: string };

const BOTON_FILTRO =
  "cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition-colors";
const FILTRO_ACTIVO =
  "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300";
const FILTRO_INACTIVO =
  "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5";

export function TareasPanel({
  tareas,
  tareasError,
  timezone,
  onNotice,
  onOpenLead,
}: {
  /** Mis pendientes: es lo que se ve al entrar, sin pedir nada más. */
  tareas: TareaRow[];
  tareasError: string | null;
  /** Zona del workspace: define qué es "hoy" para todo el equipo. */
  timezone: string;
  onNotice: (message: string) => void;
  onOpenLead: (contactId: string) => void;
}) {
  const access = useAccess();
  const ahora = useAhora();
  const usuarios = useUsuarios();
  const [alcance, setAlcance] = useState<Alcance>("mias");
  const [estado, setEstado] = useState<Estado>("pendientes");
  const [persona, setPersona] = useState("");
  const [buscado, setBuscado] = useState<Busqueda | null>(null);
  // Se toca después de cada cambio: las listas que no son "mis pendientes" las
  // trajo esta pantalla y no las refresca el `revalidatePath` del servidor.
  const [version, setVersion] = useState(0);
  const [formulario, setFormulario] = useState<{ tarea: TareaRow | null } | null>(null);

  /* Las que te pasaron y todavía no viste se marcan vistas al entrar, pero la
     etiqueta de "Nueva" se queda mientras estés acá: si se borrara en el mismo
     instante en que aparece no serviría para nada. */
  const [nuevas] = useState(
    () => new Set(tareas.filter((tarea) => !tarea.vista).map((tarea) => tarea.id)),
  );
  useEffect(() => {
    if (nuevas.size > 0) void markTasksSeen({ ids: [...nuevas] });
  }, [nuevas]);

  const pestanas: { id: Alcance; label: string }[] = [
    { id: "mias", label: "Mías" },
    ...(access.can("asignar_tareas") ? [{ id: "delegadas" as const, label: "Que di" }] : []),
    ...(access.can("ver_tareas_del_equipo")
      ? [{ id: "equipo" as const, label: "Del equipo" }]
      : []),
  ];

  const porDefecto = alcance === "mias" && estado === "pendientes";
  const clave = porDefecto ? "" : `${alcance}|${estado}|${persona}|${version}`;
  const listo = buscado !== null && buscado.clave === clave;

  useEffect(() => {
    if (porDefecto) return;
    let vigente = true;
    const guardar = (resultado: Omit<Busqueda, "clave">) => {
      if (vigente) setBuscado({ clave, ...resultado });
    };

    listTasks({ alcance, estado, persona: persona || undefined })
      .then((result) =>
        guardar(
          result.ok
            ? { tareas: result.tareas, error: "" }
            : { tareas: [], error: result.error },
        ),
      )
      .catch(() => guardar({ tareas: [], error: "No pudimos traer esas tareas." }));

    return () => {
      vigente = false;
    };
  }, [clave, porDefecto, alcance, estado, persona]);

  const recargar = () => setVersion((actual) => actual + 1);

  const visibles = porDefecto ? tareas : listo ? buscado.tareas : [];
  const buscando = !porDefecto && !listo;
  const error = porDefecto ? (tareasError ?? "") : listo ? buscado.error : "";
  const grupos = agruparTareas(visibles, ahora, timezone);

  // En las listas de otros importa de quién es cada una; en las mías, quién me
  // la dio.
  const mostrar = alcance === "mias" ? "de" : "para";

  return (
    <>
      <div className="mb-5 flex justify-end">
        <button
          onClick={() => setFormulario({ tarea: null })}
          disabled={!!tareasError}
          className={`${PRIMARY_BUTTON_CLASS} h-11 max-md:w-full`}
        >
          <Plus className="size-4" />
          Nueva tarea
        </button>
      </div>

      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          {pestanas.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {pestanas.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={alcance === id}
                  onClick={() => {
                    setAlcance(id);
                    setPersona("");
                  }}
                  className={`${BOTON_FILTRO} ${alcance === id ? FILTRO_ACTIVO : FILTRO_INACTIVO}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {(
              [
                ["pendientes", "Pendientes"],
                ["cerradas", "Hechas"],
              ] as [Estado, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={estado === id}
                onClick={() => setEstado(id)}
                className={`${BOTON_FILTRO} ${estado === id ? FILTRO_ACTIVO : FILTRO_INACTIVO}`}
              >
                {label}
              </button>
            ))}
          </div>

          {alcance === "equipo" && (
            <label className="text-xs text-neutral-500 max-md:w-full">
              <span className="sr-only">Filtrar por persona</span>
              <select
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
                className={`${INPUT_CLASS} cursor-pointer px-3 py-2 text-sm`}
              >
                <option value="">Todo el equipo</option>
                {usuarios.map((usuario) => (
                  <option key={usuario.userId} value={usuario.userId}>
                    {usuario.email}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="mt-3 text-sm text-neutral-500">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : buscando ? (
            "Buscando tareas…"
          ) : alcance === "mias" ? (
            "Lo que tenés que hacer vos. Te avisamos en este dispositivo a la hora que elijas."
          ) : alcance === "delegadas" ? (
            "Las que le diste a otras personas, para seguirlas."
          ) : (
            "Lo que tiene cada uno. Sólo podés cambiar las tuyas y las que diste."
          )}
        </p>
      </Card>

      <Card className={grupos.length > 0 ? "p-5 sm:p-6" : ""}>
        {grupos.length > 0 ? (
          <div className="space-y-6">
            {grupos.map((grupo) => (
              <section key={grupo.grupo}>
                <h3
                  className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
                    grupo.grupo === "vencidas" ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                  }`}
                >
                  {grupo.label} · {grupo.tareas.length}
                </h3>
                <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-neutral-100 md:dark:divide-white/10">
                  {grupo.tareas.map((tarea) => (
                    <TareaItem
                      key={tarea.id}
                      tarea={tarea}
                      usuarios={usuarios}
                      ahora={ahora}
                      timezone={timezone}
                      mostrar={mostrar}
                      nueva={nuevas.has(tarea.id)}
                      onEdit={() => setFormulario({ tarea })}
                      onChanged={recargar}
                      onNotice={onNotice}
                      onOpenLead={onOpenLead}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListTodo}
            title={
              buscando
                ? "Buscando tareas…"
                : estado === "cerradas"
                  ? "Nada cerrado todavía"
                  : "Sin tareas pendientes"
            }
            description={
              tareasError
                ? "Cuando se corra la migración de tareas en Supabase, esta sección empieza a funcionar."
                : estado === "cerradas"
                  ? "Las tareas que marques como hechas o canceladas van a quedar acá."
                  : "Programá llamadas, seguimientos o lo que tengas que hacer, y el CRM te avisa a la hora."
            }
            action={
              !buscando && !tareasError && estado === "pendientes" ? (
                <button onClick={() => setFormulario({ tarea: null })} className={PRIMARY_BUTTON_CLASS}>
                  <Plus className="size-4" />
                  Nueva tarea
                </button>
              ) : undefined
            }
          />
        )}
      </Card>

      {formulario && (
        <TareaModal
          tarea={formulario.tarea}
          close={() => setFormulario(null)}
          onSaved={(mensaje) => {
            setFormulario(null);
            recargar();
            onNotice(mensaje);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------- una tarea */

export function TareaItem({
  tarea,
  usuarios,
  ahora,
  timezone,
  mostrar,
  nueva = false,
  onEdit,
  onChanged,
  onNotice,
  onOpenLead,
}: {
  tarea: TareaRow;
  usuarios: WorkspaceUser[];
  ahora: Date;
  timezone: string;
  /** Qué persona nombrar: quién te la dio, o para quién es. */
  mostrar: "de" | "para";
  nueva?: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onNotice: (message: string) => void;
  /** Sin esto no se ofrece el salto al lead: ya se está en su ficha. */
  onOpenLead?: (contactId: string) => void;
}) {
  const access = useAccess();
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  const editable = puedeEditar(access, tarea);
  const abierta = tarea.estado === "pendiente";
  const vencida = grupoDeTarea(tarea, ahora, timezone) === "vencidas";
  const hecha = tarea.estado === "hecha";

  const cambiarEstado = (estado: EstadoDeTarea) => {
    startTransition(async () => {
      const result = await setTaskStatus({ id: tarea.id, estado });
      if (result.ok) onChanged();
      onNotice(
        result.ok
          ? estado === "pendiente"
            ? "La tarea volvió a pendientes."
            : `Tarea marcada como ${ETIQUETA_DEL_ESTADO[estado].toLowerCase()}.`
          : result.error,
      );
    });
  };

  const borrar = () => {
    startTransition(async () => {
      const result = await deleteTask({ id: tarea.id });
      if (result.ok) {
        setConfirmando(false);
        onChanged();
      }
      onNotice(result.ok ? "Tarea borrada." : result.error);
    });
  };

  // Quién nombrar: en mis tareas, sólo si me la dio otro; en las de otros, de
  // quién es. Mientras llegan los usuarios no se nombra a nadie, para no
  // mostrar un "Alguien del equipo" que medio segundo después cambia.
  const persona =
    mostrar === "para"
      ? tarea.asignadaA === access.userId
        ? "Para vos"
        : usuarios.length > 0
          ? `Para ${nombreCorto(usuarios, tarea.asignadaA)}`
          : null
      : tarea.creadaPor && tarea.creadaPor !== access.userId && usuarios.length > 0
        ? `De ${nombreCorto(usuarios, tarea.creadaPor)}`
        : null;

  return (
    <li
      className={`flex gap-3 py-3 transition-opacity max-md:rounded-xl max-md:bg-neutral-100/70 max-md:px-3 max-md:dark:bg-white/[.04] ${
        pending ? "opacity-50" : ""
      }`}
    >
      {/* El tilde es lo más usado de la pantalla: va primero y grande, donde
          cae el pulgar, y no escondido entre los otros botones. */}
      <button
        type="button"
        disabled={!editable || pending || tarea.estado === "cancelada"}
        onClick={() => cambiarEstado(abierta ? "hecha" : "pendiente")}
        aria-label={abierta ? "Marcar como hecha" : "Volver a pendiente"}
        title={editable ? (abierta ? "Marcar como hecha" : "Volver a pendiente") : undefined}
        className={`mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed ${
          hecha
            ? "border-amber-500 bg-amber-500 text-neutral-950"
            : "border-neutral-300 text-transparent hover:border-amber-500 hover:text-amber-500 dark:border-white/25"
        }`}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong
            className={`text-sm ${abierta ? "" : "text-neutral-500 line-through decoration-neutral-400"}`}
          >
            {tarea.titulo}
          </strong>
          {nueva && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-neutral-950">
              Nueva
            </span>
          )}
          {tarea.estado === "cancelada" && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
              Cancelada
            </span>
          )}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          <span
            suppressHydrationWarning
            className={vencida ? "font-semibold text-red-600 dark:text-red-400" : ""}
          >
            {textoDeVencimiento(tarea.venceAt, ahora, timezone)}
          </span>
          <span aria-hidden>·</span>
          <span>{ETIQUETA_DEL_TIPO[tarea.tipo]}</span>
          {persona && (
            <>
              <span aria-hidden>·</span>
              <span>{persona}</span>
            </>
          )}
          {onOpenLead &&
            tarea.contactId &&
            (tarea.contactName ? (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => onOpenLead(tarea.contactId as string)}
                  title={`Abrir la ficha de ${tarea.contactName}`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md font-medium text-amber-700 hover:underline dark:text-amber-400"
                >
                  <MessageSquare className="size-3" aria-hidden />
                  {tarea.contactName}
                </button>
              </>
            ) : (
              <>
                <span aria-hidden>·</span>
                {/* RLS esconde el nombre de un lead que pasó a otra persona. */}
                <span className="italic">Un lead que ya no ves</span>
              </>
            ))}
        </p>

        {tarea.notas && (
          <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-xs text-neutral-600 dark:text-neutral-400">
            {tarea.notas}
          </p>
        )}
      </div>

      {editable && (
        <div className="flex shrink-0 items-start gap-0.5">
          {abierta && (
            <button
              type="button"
              disabled={pending}
              onClick={onEdit}
              aria-label="Editar la tarea"
              title="Editar"
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-300"
            >
              <Pencil className="size-4" />
            </button>
          )}

          {tarea.estado === "cancelada" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => cambiarEstado("pendiente")}
              aria-label="Volver a pendiente"
              title="Volver a pendiente"
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-300"
            >
              <Undo2 className="size-4" />
            </button>
          )}

          {/* Quien la creó la borra; quien sólo la recibió la cancela, que deja
              rastro de que no se hizo. */}
          {puedeBorrar(access, tarea) ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmando(true)}
              aria-label="Borrar la tarea"
              title="Borrar"
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              <Trash2 className="size-4" />
            </button>
          ) : (
            abierta && (
              <button
                type="button"
                disabled={pending}
                onClick={() => cambiarEstado("cancelada")}
                aria-label="Cancelar la tarea"
                title="Cancelar: no se va a hacer"
                className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Ban className="size-4" />
              </button>
            )
          )}
        </div>
      )}

      {confirmando && (
        <Modal title="Borrar la tarea" onClose={() => setConfirmando(false)}>
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
            Se borra <strong>{tarea.titulo}</strong> y no queda registro. Si no se va a hacer y
            querés que quede anotado, cancelala desde Editar.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="cursor-pointer rounded-xl border border-[#ddd8c9] px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              Dejarla
            </button>
            <button
              type="button"
              onClick={borrar}
              disabled={pending}
              className="cursor-pointer rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Borrando…" : "Borrar"}
            </button>
          </div>
        </Modal>
      )}
    </li>
  );
}

/* --------------------------------------------------------- el formulario */

/** Mañana a las 10, que es para cuando se programa casi todo. */
function horaSugerida(): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 1);
  fecha.setHours(10, 0, 0, 0);
  return toLocalInputValue(fecha);
}

const SIN_AVISO = "sin-aviso";

/**
 * Alta y edición de una tarea.
 *
 * `contactoFijo` es para cuando se abre desde la ficha de un lead: ahí la
 * tarea es de ese lead y elegir otro no tiene sentido.
 */
export function TareaModal({
  tarea,
  contactoFijo,
  close,
  onSaved,
}: {
  tarea: TareaRow | null;
  contactoFijo?: { id: string; name: string };
  close: () => void;
  onSaved: (mensaje: string) => void;
}) {
  const access = useAccess();
  const usuarios = useUsuarios();
  const [titulo, setTitulo] = useState(tarea?.titulo ?? "");
  const [tipo, setTipo] = useState<TipoDeTarea>(tarea?.tipo ?? TIPO_POR_OMISION);
  const [cuando, setCuando] = useState(() =>
    tarea ? toLocalInputValue(new Date(tarea.venceAt)) : horaSugerida(),
  );
  const [aviso, setAviso] = useState(() => {
    const minutos = tarea ? minutosDeAviso(tarea.venceAt, tarea.avisoAt) : AVISO_POR_OMISION;
    return minutos === null ? SIN_AVISO : String(minutos);
  });
  const [asignadaA, setAsignadaA] = useState(tarea?.asignadaA ?? access.userId);
  const [lead, setLead] = useState<LeadElegido | null>(() =>
    contactoFijo
      ? contactoFijo
      : tarea?.contactId
        ? { id: tarea.contactId, name: tarea.contactName ?? "Un lead que ya no ves" }
        : null,
  );
  const [notas, setNotas] = useState(tarea?.notas ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const puedeAsignar = access.can("asignar_tareas");

  const guardar = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      // La zona la resuelve el navegador, igual que al agendar una cita.
      const venceAt = fromLocalInputValue(cuando);
      if (!venceAt) {
        setError("Completá la fecha y la hora.");
        return;
      }

      const datos = {
        titulo,
        notas,
        tipo,
        venceAt,
        avisoMinutos: aviso === SIN_AVISO ? null : Number(aviso),
        asignadaA,
        contactId: lead?.id ?? null,
      };

      const result = tarea ? await updateTask({ id: tarea.id, ...datos }) : await createTask(datos);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const paraOtro = asignadaA !== access.userId;
      onSaved(
        tarea
          ? "Tarea guardada."
          : paraOtro
            ? `Tarea enviada a ${nombreCorto(usuarios, asignadaA)}.`
            : "Tarea programada.",
      );
    });
  };

  return (
    <Modal title={tarea ? "Editar tarea" : "Nueva tarea"} onClose={close} ancho="max-w-lg">
      <form onSubmit={guardar}>
        <label className="mt-6 block text-sm font-medium" htmlFor="tarea-titulo">
          Qué hay que hacer
        </label>
        <input
          autoFocus
          id="tarea-titulo"
          required
          maxLength={MAX_TITULO}
          value={titulo}
          onChange={(event) => setTitulo(event.target.value)}
          placeholder="Ej. Llamar a Juan para confirmar la propuesta"
          className={`${INPUT_CLASS} mt-2`}
        />

        <p className="mt-4 text-sm font-medium">Tipo</p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de tarea">
          {TIPOS_DE_TAREA.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              role="radio"
              aria-checked={tipo === opcion.id}
              onClick={() => setTipo(opcion.id)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tipo === opcion.id ? FILTRO_ACTIVO : FILTRO_INACTIVO
              }`}
            >
              {opcion.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Para cuándo
            <input
              type="datetime-local"
              required
              value={cuando}
              onChange={(event) => setCuando(event.target.value)}
              className={`${INPUT_CLASS} mt-2`}
            />
          </label>
          <label className="block text-sm font-medium">
            Avisarme
            <select
              value={aviso}
              onChange={(event) => setAviso(event.target.value)}
              className={`${INPUT_CLASS} mt-2 cursor-pointer`}
            >
              {AVISOS_DE_TAREA.map((opcion) => (
                <option
                  key={opcion.label}
                  value={opcion.minutos === null ? SIN_AVISO : String(opcion.minutos)}
                >
                  {opcion.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {puedeAsignar ? (
          <label className="mt-4 block text-sm font-medium">
            Para quién
            <select
              value={asignadaA}
              onChange={(event) => setAsignadaA(event.target.value)}
              className={`${INPUT_CLASS} mt-2 cursor-pointer`}
            >
              {/* La persona actual va siempre, aunque la lista de usuarios
                  todavía no haya llegado: si no, el selector arranca vacío y
                  guardar se la pasaría al primero de la lista. */}
              {!usuarios.some((usuario) => usuario.userId === asignadaA) && (
                <option value={asignadaA}>
                  {asignadaA === access.userId ? "Yo" : "Persona actual"}
                </option>
              )}
              {usuarios.map((usuario) => (
                <option key={usuario.userId} value={usuario.userId}>
                  {usuario.userId === access.userId ? `Yo (${usuario.email})` : usuario.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mt-4 text-sm">
            <p className="font-medium">Para quién</p>
            <p className="mt-2 text-neutral-500">
              {asignadaA === access.userId ? "Vos" : nombreCorto(usuarios, asignadaA)}. Para darle
              tareas a otras personas hace falta un permiso.
            </p>
          </div>
        )}

        {contactoFijo ? (
          <div className="mt-4 text-sm">
            <p className="font-medium">Lead</p>
            <p className="mt-2 text-neutral-500">{contactoFijo.name}</p>
          </div>
        ) : (
          <BuscadorDeLead valor={lead} onChange={setLead} />
        )}

        <label className="mt-4 block text-sm font-medium">
          Notas <span className="font-normal text-neutral-500">(opcional)</span>
          <textarea
            value={notas}
            maxLength={MAX_NOTAS}
            onChange={(event) => setNotas(event.target.value)}
            rows={3}
            placeholder="Lo que haga falta para hacerla sin buscar nada."
            className={`${INPUT_CLASS} mt-2 resize-y`}
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {tarea && tarea.estado === "pendiente" && puedeEditar(access, tarea) && (
            <CancelarTarea tareaId={tarea.id} onDone={onSaved} />
          )}
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            Cerrar
          </button>
          <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
            {pending ? "Guardando…" : tarea ? "Guardar" : "Programar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type LeadElegido = { id: string; name: string; detalle?: string | null };

/**
 * Elegir el lead de una tarea escribiendo, en vez de recorrer un desplegable.
 *
 * Busca en la base y no en los contactos que ya trajo el tablero: ésos son los
 * primeros doscientos, y con muchos leads el que se busca es justo el que quedó
 * afuera. Sin texto ofrece los últimos que entraron.
 *
 * Se maneja con el teclado como cualquier buscador: flechas para moverse,
 * Enter para elegir y Escape para cerrar.
 */
function BuscadorDeLead({
  valor,
  onChange,
}: {
  valor: LeadElegido | null;
  onChange: (lead: LeadElegido | null) => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [resultado, setResultado] = useState<{
    clave: string;
    contactos: ContactoEncontrado[];
    error: string;
  } | null>(null);

  const clave = texto.trim();
  const listo = resultado !== null && resultado.clave === clave;
  const contactos = listo ? resultado.contactos : [];

  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    // Una pausa corta mientras se escribe: buscar en cada tecla son diez
    // consultas para encontrar a una persona.
    const espera = window.setTimeout(
      () => {
        searchContacts({ texto: clave })
          .then((result) => {
            if (!vigente) return;
            setResultado(
              result.ok
                ? { clave, contactos: result.contactos, error: "" }
                : { clave, contactos: [], error: result.error },
            );
          })
          .catch(() => {
            if (vigente) setResultado({ clave, contactos: [], error: "No pudimos buscar." });
          });
      },
      clave ? 250 : 0,
    );
    return () => {
      vigente = false;
      window.clearTimeout(espera);
    };
  }, [clave, abierto]);

  const elegir = (contacto: ContactoEncontrado) => {
    onChange({
      id: contacto.id,
      name: contacto.name,
      detalle: contacto.phone ?? contacto.email,
    });
    setTexto("");
    setAbierto(false);
  };

  const teclas = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAbierto(true);
      setResaltado((actual) => Math.min(actual + 1, Math.max(contactos.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setResaltado((actual) => Math.max(actual - 1, 0));
    } else if (event.key === "Enter") {
      // Enter elige; no manda el formulario con la búsqueda a medio hacer.
      event.preventDefault();
      const contacto = contactos[resaltado];
      if (contacto) elegir(contacto);
    } else if (event.key === "Escape") {
      setAbierto(false);
    }
  };

  if (valor) {
    return (
      <div className="mt-4 text-sm">
        <p className="font-medium">
          Lead <span className="font-normal text-neutral-500">(opcional)</span>
        </p>
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{valor.name}</span>
            {valor.detalle && (
              <span className="block truncate text-xs text-neutral-500">{valor.detalle}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setAbierto(true);
            }}
            className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-white/5"
          >
            Cambiar
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Quitar el lead"
            title="Sin lead"
            className="grid size-7 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 text-sm">
      <label className="block font-medium" htmlFor={`${id}-buscar`}>
        Lead <span className="font-normal text-neutral-500">(opcional)</span>
      </label>
      <div className="relative mt-2">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
        <input
          id={`${id}-buscar`}
          role="combobox"
          aria-expanded={abierto}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          aria-activedescendant={
            abierto && contactos[resaltado] ? `${id}-opcion-${resaltado}` : undefined
          }
          autoComplete="off"
          value={texto}
          onChange={(event) => {
            setTexto(event.target.value);
            setResaltado(0);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setAbierto(false)}
          onKeyDown={teclas}
          placeholder="Buscá por nombre, teléfono o mail"
          className={`${INPUT_CLASS} pl-9`}
        />
      </div>

      {/* Va en el flujo del formulario y no flotando: adentro de un modal, una
          lista flotante se corta contra el borde en el celular. El
          `preventDefault` del mouse evita que el campo pierda el foco —y la
          lista se cierre— antes de que llegue el clic. */}
      {abierto && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] dark:border-white/10 dark:bg-[#231e15]"
        >
          {!listo ? (
            <p className="px-3 py-3 text-xs text-neutral-500">Buscando…</p>
          ) : resultado.error ? (
            <p className="px-3 py-3 text-xs text-red-600">{resultado.error}</p>
          ) : contactos.length === 0 ? (
            <p className="px-3 py-3 text-xs text-neutral-500">
              {clave ? `No encontramos leads con "${clave}".` : "Todavía no hay leads."}
            </p>
          ) : (
            <>
              {!clave && (
                <p className="px-3 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Los últimos que entraron
                </p>
              )}
              <ul id={`${id}-lista`} role="listbox" className="py-1">
                {contactos.map((contacto, indice) => (
                  <li
                    key={contacto.id}
                    id={`${id}-opcion-${indice}`}
                    role="option"
                    aria-selected={indice === resaltado}
                    onClick={() => elegir(contacto)}
                    onMouseEnter={() => setResaltado(indice)}
                    className={`cursor-pointer px-3 py-2 ${
                      indice === resaltado ? "bg-amber-50 dark:bg-amber-400/10" : ""
                    }`}
                  >
                    <span className="block truncate font-medium">{contacto.name}</span>
                    {(contacto.phone || contacto.email) && (
                      <span className="block truncate text-xs text-neutral-500">
                        {[contacto.phone, contacto.email].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Cancelar es distinto de borrar: queda anotado que no se hizo. */
function CancelarTarea({
  tareaId,
  onDone,
}: {
  tareaId: string;
  onDone: (mensaje: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <span className="mr-auto flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setTaskStatus({ id: tareaId, estado: "cancelada" });
            if (result.ok) onDone("Tarea cancelada.");
            else setError(result.error);
          })
        }
        className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
      >
        {pending ? "Cancelando…" : "Cancelar tarea"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/* ------------------------------------------------- la pestaña de la ficha */

/**
 * Las tareas de un lead, dentro de su ficha.
 *
 * Es donde más se van a cargar: se está hablando con alguien, queda algo
 * pendiente, y se anota ahí mismo sin salir del chat.
 */
export function TareasDelLead({
  contactId,
  contactName,
  timezone,
  conFormularioAbierto = false,
  compacto = false,
  onNotice,
  onVerTareas,
}: {
  contactId: string;
  contactName: string;
  timezone: string;
  /** Arranca con el alta abierta: se llegó desde el botón de "agregar tarea". */
  conFormularioAbierto?: boolean;
  /**
   * Para la columna angosta de la bandeja, que ya trae su propio margen: sin
   * relleno de más y con el botón de alta a lo ancho, debajo de los filtros.
   */
  compacto?: boolean;
  onNotice: (message: string) => void;
  /** Lleva a la sección Tareas, donde están las de todos los leads. */
  onVerTareas?: () => void;
}) {
  const ahora = useAhora();
  const usuarios = useUsuarios();
  const [estado, setEstado] = useState<Estado>("pendientes");
  const [version, setVersion] = useState(0);
  const [buscado, setBuscado] = useState<Busqueda | null>(null);
  const [formulario, setFormulario] = useState<{ tarea: TareaRow | null } | null>(() =>
    conFormularioAbierto ? { tarea: null } : null,
  );

  const clave = `${contactId}|${estado}|${version}`;
  const listo = buscado !== null && buscado.clave === clave;

  useEffect(() => {
    let vigente = true;
    listTasks({ alcance: "lead", estado, contactId })
      .then((result) => {
        if (!vigente) return;
        setBuscado(
          result.ok
            ? { clave, tareas: result.tareas, error: "" }
            : { clave, tareas: [], error: result.error },
        );
      })
      .catch(() => {
        if (vigente) setBuscado({ clave, tareas: [], error: "No pudimos traer las tareas." });
      });
    return () => {
      vigente = false;
    };
  }, [clave, contactId, estado]);

  const recargar = () => setVersion((actual) => actual + 1);
  const tareas = listo ? buscado.tareas : [];
  const grupos = agruparTareas(tareas, ahora, timezone);

  return (
    <div className={compacto ? "" : "px-5 py-4"}>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["pendientes", "Pendientes"],
            ["cerradas", "Hechas"],
          ] as [Estado, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={estado === id}
            onClick={() => setEstado(id)}
            className={`${BOTON_FILTRO} px-2.5 py-1.5 text-xs ${estado === id ? FILTRO_ACTIVO : FILTRO_INACTIVO}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFormulario({ tarea: null })}
          className={`${PRIMARY_BUTTON_CLASS} px-3 py-2 ${compacto ? "w-full" : "ml-auto"}`}
        >
          <Plus className="size-4" />
          Nueva tarea
        </button>
      </div>

      {listo && buscado.error && <p className="mt-4 text-sm text-red-600">{buscado.error}</p>}

      {!listo ? (
        <p className="py-8 text-center text-sm text-neutral-500">Cargando tareas…</p>
      ) : grupos.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          {estado === "pendientes"
            ? `No hay nada pendiente con ${contactName}. Anotá la próxima llamada o seguimiento y te avisamos.`
            : "Todavía no se cerró ninguna tarea de este lead."}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {grupos.map((grupo) => (
            <section key={grupo.grupo}>
              <h3
                className={`mb-1 text-xs font-semibold uppercase tracking-wide ${
                  grupo.grupo === "vencidas" ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                }`}
              >
                {grupo.label}
              </h3>
              <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-neutral-100 md:dark:divide-white/10">
                {grupo.tareas.map((tarea) => (
                  <TareaItem
                    key={tarea.id}
                    tarea={tarea}
                    usuarios={usuarios}
                    ahora={ahora}
                    timezone={timezone}
                    mostrar="para"
                    onEdit={() => setFormulario({ tarea })}
                    onChanged={recargar}
                    onNotice={onNotice}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {onVerTareas && (
        <button
          type="button"
          onClick={onVerTareas}
          className="mt-6 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400"
        >
          <ListTodo className="size-4" aria-hidden />
          Ver todas mis tareas en Tareas
        </button>
      )}

      {formulario && (
        <TareaModal
          tarea={formulario.tarea}
          contactoFijo={{ id: contactId, name: contactName }}
          close={() => setFormulario(null)}
          onSaved={(mensaje) => {
            setFormulario(null);
            recargar();
            onNotice(mensaje);
          }}
        />
      )}
    </div>
  );
}
