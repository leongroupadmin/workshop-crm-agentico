"use client";

import {
  CalendarDays,
  CalendarSearch,
  Check,
  Link2,
  MessageSquare,
  Plus,
  Trash2,
  Undo2,
  UsersRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  createAppointment,
  deleteAppointment,
  listAppointmentsByRange,
  setAppointmentLink,
  updateAppointmentStatus,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import {
  Card,
  EmptyState,
  INPUT_CLASS,
  Modal,
  PRIMARY_BUTTON_CLASS,
  dateTime,
} from "@/components/ui";
import {
  ATAJOS_AGENDA,
  FILTRO_AGENDA_VACIO,
  atajoActivo,
  normalizarFiltro,
  rangoDeAtajo,
  textoDelRango,
  type FiltroAgenda,
} from "@/lib/agenda-filtros";
import { dayKeyInZone, fromLocalInputValue, toLocalInputValue } from "@/lib/fechas";
import type { AppointmentRow, ContactRow } from "@/lib/crm-data";
import type { AppointmentStatus } from "@/types/database";

const HOUR = 60 * 60 * 1000;

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  completed: "Realizada",
  cancelled: "Cancelada",
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  completed: "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

/** El resultado de un rango, atado a la clave del rango que lo pidió. */
type Busqueda = {
  clave: string;
  citas: AppointmentRow[];
  /** La base devolvió más de las que entran: el rango es demasiado ancho. */
  recortada: boolean;
  error: string;
};

export function AgendaPanel({
  appointments,
  contacts,
  timezone,
  onNotice,
  onOpenLead,
}: {
  /** Las que vienen: es lo que se ve al entrar, sin filtro puesto. */
  appointments: AppointmentRow[];
  contacts: ContactRow[];
  /** Zona del workspace: define qué día es "hoy" para todo el equipo. */
  timezone: string;
  onNotice: (message: string) => void;
  /** Abre la ficha del contacto, que es donde está su chat. */
  onOpenLead: (contactId: string) => void;
}) {
  const access = useAccess();
  const [showForm, setShowForm] = useState(false);
  const [filtro, setFiltro] = useState<FiltroAgenda>(FILTRO_AGENDA_VACIO);
  const [buscado, setBuscado] = useState<Busqueda | null>(null);
  // Se toca al agendar o al cambiar un estado: con un filtro puesto la lista la
  // trajo esta pantalla y no la refresca el `revalidatePath` del servidor.
  const [version, setVersion] = useState(0);

  const disabled = contacts.length === 0;
  const puedeAgendar = access.can("gestionar_agenda");

  // El día de hoy sale de la zona del workspace, no del reloj del navegador:
  // dos personas en países distintos tienen que filtrar por el mismo "hoy".
  const hoy = dayKeyInZone(new Date(), timezone);
  const { desde, hasta } = normalizarFiltro(filtro);
  const filtrando = desde !== null && hasta !== null;
  const atajo = atajoActivo(filtro, hoy);

  /* Qué búsqueda corresponde a lo que hay puesto ahora. Guardar la clave con el
     resultado es lo que evita el estado de más: si no coinciden es que todavía
     no volvió, y eso ya es "buscando". De paso, una respuesta vieja que llega
     tarde queda descartada sola. */
  const clave = filtrando ? `${desde}|${hasta}|${version}` : "";
  const listo = buscado !== null && buscado.clave === clave;

  useEffect(() => {
    if (!desde || !hasta) return;

    // Al tablero sólo llegan las citas que vienen, y recortadas a las primeras:
    // preguntarle por el martes pasado contestaría siempre que no hubo nada. Con
    // un rango puesto se vuelve a la base, que sí tiene el historial completo.
    let vigente = true;
    const guardar = (resultado: Omit<Busqueda, "clave">) => {
      if (vigente) setBuscado({ clave, ...resultado });
    };

    listAppointmentsByRange({ desde, hasta })
      .then((result) =>
        guardar(
          result.ok
            ? { citas: result.appointments, recortada: result.recortada, error: "" }
            : { citas: [], recortada: false, error: result.error },
        ),
      )
      .catch(() =>
        guardar({
          citas: [],
          recortada: false,
          error: "No pudimos traer las citas de esas fechas.",
        }),
      );

    return () => {
      vigente = false;
    };
  }, [clave, desde, hasta]);

  const limpiar = () => setFiltro(FILTRO_AGENDA_VACIO);
  const recargar = () => setVersion((actual) => actual + 1);

  const buscando = filtrando && !listo;
  const errorBusqueda = listo ? buscado.error : "";
  const recortada = listo ? buscado.recortada : false;
  const visibles = filtrando ? (listo ? buscado.citas : []) : appointments;
  const mostrarLista = visibles.length > 0;

  return (
    <>
      {/* Agendar va en su propio renglón y no adentro de la tarjeta de filtros,
          que es donde estaba. Ahí se leía como un filtro más —todo lo que tiene
          al lado cambia qué estás viendo, y esto crea algo nuevo— y además se
          corría de lugar cada vez que aparecía "Limpiar". Arriba y contra el
          margen derecho es donde está en Contactos, así que el botón principal
          cae siempre en el mismo lugar se mire la sección que se mire. */}
      {puedeAgendar && (
        <div className="mb-5 flex justify-end">
          <button
            onClick={() => (disabled ? onNotice("Primero cargá un contacto.") : setShowForm(true))}
            title={disabled ? "Necesitás al menos un contacto" : undefined}
            className={`${PRIMARY_BUTTON_CLASS} h-11 max-md:w-full ${disabled ? "opacity-60" : ""}`}
          >
            <Plus className="size-4" />
            Agendar cita
          </button>
        </div>
      )}

      {/* Los filtros van arriba de todo y a la vista, no adentro de un popup:
          en la agenda la primera pregunta es por una fecha —"qué tengo el
          jueves"— y no una opción que se usa de vez en cuando. */}
      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {ATAJOS_AGENDA.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setFiltro((actual) =>
                    atajoActivo(actual, hoy) === id
                      ? FILTRO_AGENDA_VACIO
                      : rangoDeAtajo(id, hoy),
                  )
                }
                aria-pressed={atajo === id}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  atajo === id
                    ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
                    : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Una fecha sola ya filtra ese día: "hasta" es para estirarla a un
              rango, no un campo que haya que completar.

              En el celular van las dos a la par: una abajo de la otra cada
              campo se comía una pantalla entera, y son dos puntas de la misma
              pregunta. De tablet para arriba el `contents` las devuelve al
              renglón de los atajos, como si el grupo no existiera. */}
          <div className="grid w-full grid-cols-2 gap-3 md:contents">
            <label className="text-xs text-neutral-500">
              Desde
              <input
                type="date"
                aria-label="Filtrar citas desde esta fecha"
                value={filtro.desde ?? ""}
                onChange={(event) =>
                  setFiltro((actual) => ({ ...actual, desde: event.target.value || null }))
                }
                className={`${INPUT_CLASS} mt-1 px-2 py-2 text-sm md:px-3`}
              />
            </label>
            <label className="text-xs text-neutral-500">
              Hasta
              <input
                type="date"
                aria-label="Filtrar citas hasta esta fecha"
                value={filtro.hasta ?? ""}
                onChange={(event) =>
                  setFiltro((actual) => ({ ...actual, hasta: event.target.value || null }))
                }
                className={`${INPUT_CLASS} mt-1 px-2 py-2 text-sm md:px-3`}
              />
            </label>
          </div>

          {filtrando && (
            <button
              type="button"
              onClick={limpiar}
              className="cursor-pointer whitespace-nowrap rounded-xl border border-[#ddd8c9] px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-50 md:py-2 dark:border-white/10 dark:hover:bg-white/5"
            >
              <X className="mr-1.5 inline size-4 align-[-3px]" />
              Limpiar
            </button>
          )}
        </div>

        {/* Sin este renglón, una agenda filtrada se ve igual que una agenda
            vacía y no hay forma de saber cuál de las dos se está mirando. */}
        <p className="mt-3 text-sm text-neutral-500">
          {errorBusqueda ? (
            <span className="text-red-600">{errorBusqueda}</span>
          ) : filtrando ? (
            buscando ? (
              `Buscando las citas de ${textoDelRango(filtro, hoy)}…`
            ) : (
              `${visibles.length === 0 ? "No hay citas" : visibles.length === 1 ? "1 cita" : `${visibles.length} citas`} ${textoDelRango(filtro, hoy)}.${recortada ? " Se muestran las primeras: acotá el rango para verlas todas." : ""}`
            )
          ) : (
            "Estás viendo las próximas citas. Elegí una fecha para ver las de ese día, pasadas incluidas."
          )}
        </p>
      </Card>

      <Card className={mostrarLista ? "p-5 sm:p-6" : ""}>
        {mostrarLista ? (
          /* En el celular cada cita es su propia placa, separada de la de
             abajo. Con la línea divisoria sola —que es lo que va en escritorio,
             donde cada cita entra en un renglón— las citas de dos renglones se
             leían pegadas, como un bloque de texto corrido. */
          <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-neutral-100 md:dark:divide-white/10">
            {visibles.map((item) => (
              <AppointmentItem
                key={item.id}
                appointment={item}
                timezone={timezone}
                onNotice={onNotice}
                onChanged={recargar}
                onOpenLead={onOpenLead}
              />
            ))}
          </ul>
        ) : filtrando ? (
          <EmptyState
            icon={CalendarSearch}
            title={buscando ? "Buscando citas…" : "Sin citas en esas fechas"}
            description={
              buscando
                ? "Un segundo: estamos yendo a buscarlas."
                : `No hay ninguna cita ${textoDelRango(filtro, hoy)}. Probá con otro día o volvé a las próximas.`
            }
            action={
              buscando ? undefined : (
                <button
                  onClick={limpiar}
                  className="cursor-pointer rounded-xl border border-[#ddd8c9] px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                >
                  Ver las próximas
                </button>
              )
            }
          />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Agenda vacía"
            description={
              disabled
                ? "Primero cargá un contacto: toda cita se coordina con alguien."
                : "Las visitas y llamadas que coordines van a listarse acá."
            }
            action={
              !disabled && puedeAgendar ? (
                <button onClick={() => setShowForm(true)} className={PRIMARY_BUTTON_CLASS}>
                  <Plus className="size-4" />
                  Agendar cita
                </button>
              ) : undefined
            }
          />
        )}
      </Card>

      {showForm && (
        <AppointmentModal
          contacts={contacts}
          close={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            recargar();
            onNotice("Cita agendada.");
          }}
        />
      )}
    </>
  );
}

function AppointmentItem({
  appointment,
  timezone,
  onNotice,
  onChanged,
  onOpenLead,
}: {
  appointment: AppointmentRow;
  timezone: string;
  onNotice: (message: string) => void;
  /** Con un filtro puesto la lista es local: hay que volver a pedirla. */
  onChanged: () => void;
  onOpenLead: (contactId: string) => void;
}) {
  const access = useAccess();
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [editandoEnlace, setEditandoEnlace] = useState(false);
  const puedeEditarEnlace = access.can("gestionar_agenda");

  const borrar = () => {
    startTransition(async () => {
      const result = await deleteAppointment({ id: appointment.id });
      if (result.ok) {
        setConfirmando(false);
        onChanged();
      }
      onNotice(result.ok ? "Cita borrada." : result.error);
    });
  };

  const setStatus = (status: AppointmentStatus) => {
    startTransition(async () => {
      const result = await updateAppointmentStatus({ id: appointment.id, status });
      if (result.ok) onChanged();
      onNotice(result.ok ? `Cita marcada como ${STATUS_LABELS[status].toLowerCase()}.` : result.error);
    });
  };

  return (
    /* En el celular la cita ocupa dos renglones: arriba de qué se trata, abajo
       los botones. En uno solo, los botones —que no se achican— le dejaban al
       texto una columna de dos palabras de ancho, y el nombre con la fecha
       bajaban en fila india: el título quedaba cortado en "Vi…" y cada cita
       medía media pantalla. De tablet para arriba el `contents` desarma los dos
       grupos y vuelve el renglón único de siempre. */
    <li
      className={`flex flex-col gap-2 py-4 transition-opacity max-md:rounded-xl max-md:bg-neutral-100/70 max-md:px-4 md:flex-row md:flex-wrap md:items-center md:gap-3 max-md:dark:bg-white/[.04] ${
        pending ? "opacity-50" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-3 md:contents">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
          <CalendarDays className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          {/* Dos renglones como mucho: en el celular hay ancho de sobra para
              que el título entre entero, y recortarlo ahí no ahorra nada. */}
          <strong className="line-clamp-2 block text-sm md:truncate">{appointment.title}</strong>
          <span className="text-sm text-neutral-500">
            {appointment.contactName} · <span suppressHydrationWarning>{dateTime(appointment.startTime, timezone)}</span>
          </span>
        </span>
      </span>

      <span className="flex items-center gap-1 md:contents">
        {/* La conversación del contacto es donde cae la respuesta del cliente:
            el "no voy a poder" llega ahí y hay que poder saltar de la cita al
            chat sin buscar el nombre a mano. */}
        <button
          type="button"
          onClick={() => onOpenLead(appointment.contactId)}
          title={`Abrir el chat con ${appointment.contactName}`}
          className="shrink-0 cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <MessageSquare className="size-4" aria-hidden />
          <span className="sr-only">Abrir el chat</span>
        </button>

        {/* El enlace de la reunión se edita acá, porque la sala de Meet casi nunca
            existe todavía cuando se agenda. */}
        {puedeEditarEnlace ? (
          <button
            type="button"
            onClick={() => setEditandoEnlace(true)}
            title={appointment.enlace ? "Cambiar el enlace de la cita" : "Agregar un enlace a la cita"}
            className={`shrink-0 cursor-pointer rounded-lg p-2 transition-colors ${
              appointment.enlace
                ? "text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-white/5"
                : "text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/5 dark:hover:text-neutral-300"
            }`}
          >
            <Link2 className="size-4" aria-hidden />
            <span className="sr-only">
              {appointment.enlace ? "Cambiar el enlace" : "Agregar un enlace"}
            </span>
          </button>
        ) : (
          appointment.enlace && (
            <a
              href={appointment.enlace}
              target="_blank"
              rel="noreferrer"
              title="Abrir el enlace de la cita"
              className="shrink-0 rounded-lg p-2 text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-white/5"
            >
              <Link2 className="size-4" aria-hidden />
              <span className="sr-only">Abrir el enlace</span>
            </a>
          )
        )}

        {/* En el celular el estado abre el renglón y empuja los botones contra el
            margen derecho, que es donde cae el pulgar. */}
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium max-md:order-first max-md:mr-auto ${STATUS_STYLES[appointment.status]}`}
        >
          {STATUS_LABELS[appointment.status]}
        </span>
        {/* Realizada y vuelta atrás.
            "Realizada" es sólo un registro, así que tiene que poder deshacerse:
            marcar la equivocada de una lista de diez es cuestión de tiempo. */}
        {access.can("gestionar_agenda") && appointment.status === "scheduled" && (
          <button
            disabled={pending}
            onClick={() => setStatus("completed")}
            aria-label="Marcar como realizada"
            title="Marcar como realizada"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed dark:hover:bg-white/10"
          >
            <Check className="size-4" />
          </button>
        )}

        {access.can("gestionar_agenda") && appointment.status === "completed" && (
          <button
            disabled={pending}
            onClick={() => setStatus("scheduled")}
            aria-label="Ya no está realizada"
            title="Deshacer: volver a Agendada"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-700 disabled:cursor-not-allowed dark:hover:bg-white/10 dark:hover:text-neutral-300"
          >
            <Undo2 className="size-4" />
          </button>
        )}

        {access.can("gestionar_agenda") && (
          <button
            disabled={pending}
            onClick={() => setConfirmando(true)}
            aria-label="Borrar la cita"
            title="Borrar del CRM"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </span>

      {editandoEnlace && (
        <EnlaceModal
          appointment={appointment}
          close={() => setEditandoEnlace(false)}
          onSaved={(mensaje) => {
            setEditandoEnlace(false);
            onChanged();
            onNotice(mensaje);
          }}
        />
      )}

      {confirmando && (
        <Modal title="Borrar la cita" onClose={() => setConfirmando(false)}>
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
            Se va <strong>{appointment.title}</strong> con {appointment.contactName}.
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

/**
 * El enlace de una cita ya agendada.
 *
 * Vacío borra el que hubiera: una reunión que pasó a ser presencial no tiene
 * que seguir mostrando un Meet muerto.
 */
function EnlaceModal({
  appointment,
  close,
  onSaved,
}: {
  appointment: AppointmentRow;
  close: () => void;
  onSaved: (mensaje: string) => void;
}) {
  const [enlace, setEnlace] = useState(appointment.enlace ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await setAppointmentLink({ id: appointment.id, enlace });
      if (result.ok) onSaved(enlace.trim() ? "Enlace guardado." : "Enlace borrado.");
      else setError(result.error);
    });
  };

  return (
    <Modal title="Enlace de la cita" onClose={close}>
      <form onSubmit={save}>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
          El enlace de la reunión de <strong>{appointment.title}</strong> (Meet, Zoom…). Vacío,
          la cita queda sin enlace.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="appointment-link-edit">
          Enlace
        </label>
        <input
          autoFocus
          id="appointment-link-edit"
          type="url"
          inputMode="url"
          value={enlace}
          onChange={(event) => setEnlace(event.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
          className={`${INPUT_CLASS} mt-2`}
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppointmentModal({
  contacts,
  close,
  onSaved,
}: {
  contacts: ContactRow[];
  close: () => void;
  onSaved: () => void;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [enlace, setEnlace] = useState("");
  // Por defecto, dentro de una hora. Cuándo termina no se pregunta: lo pone el
  // servidor, que le da la duración de siempre.
  const [startTime, setStartTime] = useState(() => toLocalInputValue(new Date(Date.now() + HOUR)));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      // La zona la resuelve el navegador: el servidor no puede saber desde
      // dónde se está agendando.
      const inicio = fromLocalInputValue(startTime);
      if (!inicio) {
        setError("Completá la fecha y la hora.");
        return;
      }

      const result = await createAppointment({
        contactId,
        title,
        startTime: inicio,
        enlace,
      });
      if (result.ok) onSaved();
      else setError(result.error);
    });
  };

  if (contacts.length === 0) {
    return (
      <Modal title="Agendar cita" onClose={close}>
        <EmptyState
          icon={UsersRound}
          title="Necesitás un contacto"
          description="Toda cita se coordina con un contacto. Cargá uno primero desde la sección Contactos."
        />
      </Modal>
    );
  }

  return (
    <Modal title="Agendar cita" onClose={close}>
      <form onSubmit={save}>
        <label className="mt-6 block text-sm font-medium" htmlFor="appointment-title">
          Título
        </label>
        <input
          autoFocus
          id="appointment-title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ej. Visita a Palermo Soho"
          className={`${INPUT_CLASS} mt-2`}
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="appointment-contact">
          Contacto
        </label>
        <select
          id="appointment-contact"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          className={`${INPUT_CLASS} mt-2 cursor-pointer`}
        >
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium" htmlFor="appointment-start">
          Fecha y hora
        </label>
        <input
          id="appointment-start"
          type="datetime-local"
          required
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
          className={`${INPUT_CLASS} mt-2`}
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="appointment-link">
          Enlace <span className="font-normal text-neutral-500">(opcional)</span>
        </label>
        <input
          id="appointment-link"
          type="url"
          inputMode="url"
          value={enlace}
          onChange={(event) => setEnlace(event.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
          className={`${INPUT_CLASS} mt-2`}
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          El enlace de la reunión (Meet, Zoom…). Se puede cargar después.
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
            {pending ? "Guardando…" : "Agendar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
