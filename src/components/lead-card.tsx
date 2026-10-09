"use client";

import { Bot, BotOff, CalendarDays, ListPlus, Mail, Phone, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  loadLead,
  setContactBot,
  startContactConversation,
  updateContact,
  updateOpportunityDetails,
  updateOpportunityStage,
  type LeadDetail,
} from "@/app/actions";
import { ChatThread } from "@/components/chat-panel";
import { useAccess } from "@/components/access";
import { DeleteContactModal } from "@/components/delete-contact-modal";
import { OpcionesDeEtapa } from "@/components/opciones-de-etapa";
import { ResponsableSelect } from "@/components/responsable";
import { TareasDelLead } from "@/components/tareas-panel";
import {
  ChannelBadges,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  avatarColor,
  dateTime,
  initials,
} from "@/components/ui";
import type { StageRow } from "@/lib/crm-data";
import { sePuedeEscribirPrimero } from "@/lib/telefono";

type Tab = "chat" | "datos" | "agenda" | "tareas";

/**
 * Tarjeta de lead: la ficha, el embudo, el chat y la agenda de un contacto en
 * un solo panel.
 *
 * Es el modelo de Kommo, donde el lead es la unidad de trabajo y el chat vive
 * adentro. Antes lo mismo estaba repartido en cuatro secciones y había que
 * saltar entre ellas para atender a una persona.
 */
export function LeadCard({
  contactId,
  stages,
  timezone,
  onClose,
  onNotice,
  onOpenTareas,
}: {
  contactId: string;
  stages: StageRow[];
  /** Zona del workspace: las tareas del lead se agrupan por su "hoy". */
  timezone: string;
  onClose: () => void;
  onNotice: (message: string) => void;
  /** Cierra la ficha y lleva a la sección Tareas. */
  onOpenTareas: () => void;
}) {
  const access = useAccess();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  // El botón del encabezado abre la pestaña con el alta ya abierta. El
  // contador es la `key` de la pestaña, para que se vuelva a montar aunque ya
  // se estuviera en ella; y cambiar de pestaña a mano lo apaga, así volver a
  // Tareas después no abre el formulario solo.
  const [pedidosDeTarea, setPedidosDeTarea] = useState(0);
  const [abrirTarea, setAbrirTarea] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let active = true;
    loadLead({ contactId }).then((result) => {
      if (!active) return;
      if (result.ok) setLead(result.lead);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [contactId]);

  const activeConversation = lead?.conversations[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-neutral-950/45 backdrop-blur-sm">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Ficha del lead"
        className="flex h-full w-full max-w-xl flex-col bg-[#f9f8f3] shadow-2xl dark:bg-[#1c1811]"
      >
        <header className="flex items-center gap-3 border-b border-[#ddd8c9] px-5 py-4 dark:border-white/10">
          {lead ? (
            <>
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${avatarColor(
                  lead.contact.name,
                )}`}
              >
                {initials(lead.contact.name)}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-lg">{lead.contact.name}</strong>
                <span className="mt-2 flex flex-wrap items-center gap-1">
                  <BotTag lead={lead} onNotice={onNotice} />
                </span>
                <ChannelBadges channels={lead.conversations.map((item) => item.channel)} />
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm text-neutral-500">Cargando…</span>
          )}
          {/* Al alcance desde cualquier pestaña: lo más común es estar en el
              chat y querer anotar la próxima llamada sin perder la charla de
              vista por más de un momento. */}
          {lead && (
            <button
              type="button"
              aria-label={`Agregar una tarea para ${lead.contact.name}`}
              title="Agregar una tarea"
              onClick={() => {
                setTab("tareas");
                setAbrirTarea(true);
                setPedidosDeTarea((actual) => actual + 1);
              }}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-400 dark:hover:bg-white/5"
            >
              <ListPlus className="size-5" />
            </button>
          )}
          {lead && access.can("eliminar_contactos") && (
            <button
              type="button"
              aria-label={`Borrar a ${lead.contact.name}`}
              title="Borrar de la base (no se puede deshacer)"
              onClick={() => setConfirmingDelete(true)}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              <Trash2 className="size-5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </header>

        {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}

        {lead && (
          <>
            <StageBar lead={lead} stages={stages} onNotice={onNotice} />

            <nav className="flex gap-1 border-b border-[#ddd8c9] px-3 dark:border-white/10">
              {(["chat", "datos", "agenda", "tareas"] as Tab[]).map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    setTab(option);
                    setAbrirTarea(false);
                  }}
                  className={`cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                    tab === option
                      ? "border-amber-500 text-amber-700 dark:text-amber-400"
                      : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                  }`}
                >
                  {option}
                </button>
              ))}
            </nav>

            {/* El chat maneja su propio scroll: si además scrollea este panel,
                la barra para escribir se va con los mensajes en vez de quedarse
                abajo. Las otras dos pestañas sí son una columna larga. */}
            <div
              className={`flex-1 ${
                tab === "chat"
                  ? "flex min-h-0 flex-col overflow-hidden"
                  : "overflow-y-auto"
              }`}
            >
              {tab === "chat" &&
                (activeConversation ? (
                  <ChatThread
                    conversation={{
                      id: activeConversation.id,
                      contactName: lead.contact.name,
                      unreadCount: activeConversation.unreadCount,
                      channel: activeConversation.channel,
                      provider: activeConversation.provider,
                    }}
                    onNotice={onNotice}
                    className="min-h-0 flex-1"
                  />
                ) : (
                  <AbrirChat
                    contactId={contactId}
                    telefono={lead.contact.phone}
                    onNotice={onNotice}
                    onAbierto={(actualizado) => setLead(actualizado)}
                  />
                ))}

              {tab === "datos" && (
                <>
                  <ResponsableField lead={lead} onNotice={onNotice} />
                  <ContactForm lead={lead} onNotice={onNotice} />
                </>
              )}

              {tab === "agenda" && <AgendaTab lead={lead} timezone={timezone} />}

              {tab === "tareas" && (
                <TareasDelLead
                  key={pedidosDeTarea}
                  contactId={lead.contact.id}
                  contactName={lead.contact.name}
                  timezone={timezone}
                  conFormularioAbierto={abrirTarea}
                  onNotice={onNotice}
                  onVerTareas={onOpenTareas}
                />
              )}
            </div>
          </>
        )}

        {lead && confirmingDelete && (
          <DeleteContactModal
            contacts={[lead.contact]}
            close={() => setConfirmingDelete(false)}
            onCompleted={onClose}
            onNotice={onNotice}
          />
        )}
      </aside>
    </div>
  );
}

/**
 * Arranca la charla con alguien que nunca escribió.
 *
 * Antes acá sólo decía que el chat se abría solo cuando el contacto escribiera,
 * y para un lead cargado a mano eso era una espera sin salida. El botón abre la
 * conversación y recarga la ficha, que es lo que hace aparecer el hilo.
 */
function AbrirChat({
  contactId,
  telefono,
  onNotice,
  onAbierto,
}: {
  contactId: string;
  telefono: string | null;
  onNotice: (message: string) => void;
  onAbierto: (lead: LeadDetail) => void;
}) {
  const access = useAccess();
  const [abriendo, startAbrir] = useTransition();

  // Sin teléfono no hay por dónde arrancar: escribir primero es siempre por
  // WhatsApp. Ofrecer el botón igual era mandar a quien atiende a un error que
  // no se puede arreglar desde la ficha.
  if (!access.can("responder_chats") || !sePuedeEscribirPrimero(telefono)) {
    return (
      <p className="px-5 py-10 text-center text-sm text-neutral-500">
        Todavía no hay chat con esta persona. Se abre solo cuando te escriba.
      </p>
    );
  }

  const abrir = () => {
    startAbrir(async () => {
      const result = await startContactConversation({ contactId });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }

      const recargado = await loadLead({ contactId });
      if (recargado.ok) onAbierto(recargado.lead);
      else onNotice(recargado.error);
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <p className="text-sm text-neutral-500">
        Todavía no hay chat con esta persona. Podés abrirlo vos y escribirle primero.
      </p>
      <button
        type="button"
        onClick={abrir}
        disabled={abriendo}
        className={`${PRIMARY_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {abriendo ? "Abriendo el chat…" : "Abrir el chat"}
      </button>
      <p className="text-xs text-neutral-500">
        Si el WhatsApp es el oficial, el primer mensaje tiene que ser una plantilla aprobada. El
        chat lo avisa.
      </p>
    </div>
  );
}

/** Etapa del embudo y valor: lo que más se toca, siempre visible. */
function StageBar({
  lead,
  stages,
  onNotice,
}: {
  lead: LeadDetail;
  stages: StageRow[];
  onNotice: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  if (!lead.opportunity) {
    return (
      <p className="border-b border-[#ddd8c9] px-5 py-3 text-sm text-neutral-500 dark:border-white/10">
        Este contacto no tiene oportunidad en el embudo.
      </p>
    );
  }

  const opportunity = lead.opportunity;

  const move = (stageId: string) => {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage) return;
    startTransition(async () => {
      const result = await updateOpportunityStage({ id: opportunity.id, stageId });
      onNotice(result.ok ? `Movido a ${stage.name}.` : result.error);
    });
  };

  return (
    <div className="flex items-center gap-3 border-b border-[#ddd8c9] px-5 py-3 dark:border-white/10">
      <label className="sr-only" htmlFor="lead-stage">
        Etapa
      </label>
      <select
        id="lead-stage"
        defaultValue={opportunity.stageId}
        disabled={pending}
        onChange={(event) => move(event.target.value)}
        className="cursor-pointer rounded-lg border border-[#ddd8c9] bg-[#f9f8f3] px-2 py-1.5 text-sm outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-white/5"
      >
        <OpcionesDeEtapa stages={stages} />
      </select>
      <span className="text-sm text-neutral-500">
        US$ {opportunity.value.toLocaleString("es-AR")}
      </span>
    </div>
  );
}

/**
 * Etiqueta que frena la IA para este lead.
 *
 * Es el mismo interruptor que consulta el webhook antes de contestar solo: con
 * la etiqueta puesta, la IA no habla; sin ella, responde sola.
 */
function BotTag({ lead, onNotice }: { lead: LeadDetail; onNotice: (message: string) => void }) {
  const [frozen, setFrozen] = useState(!lead.contact.botEnabled);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !frozen;
    setFrozen(next);
    startTransition(async () => {
      const result = await setContactBot({ id: lead.contact.id, enabled: !next });
      if (result.ok) {
        onNotice(next ? "IA frenada para este lead." : "La IA vuelve a responder sola.");
      } else {
        setFrozen(!next);
        onNotice(result.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        frozen
          ? "La IA no responde a esta persona. Tocá para reactivarla."
          : "La IA responde sola. Tocá para frenarla."
      }
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        frozen
          ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      }`}
    >
      {frozen ? <BotOff className="size-3.5" /> : <Bot className="size-3.5" />}
      {frozen ? "IA frenada" : "IA activa"}
    </button>
  );
}

/**
 * Quién es el responsable del lead.
 *
 * No es un dato más de la ficha: es lo que decide qué operario lo ve. Por eso
 * guarda solo, apenas se elige, y no espera al botón de "Guardar cambios" que
 * está más abajo — reasignar un lead no debería quedar a medias porque alguien
 * cerró el panel.
 *
 * Sin el permiso `asignar_leads` se ve pero no se toca: saber de quién es un
 * lead sirve igual, aunque no puedas moverlo.
 */
function ResponsableField({
  lead,
  onNotice,
}: {
  lead: LeadDetail;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="border-b border-[#ddd8c9] px-5 py-4 dark:border-white/10">
      <label className="block text-sm font-medium" htmlFor="lead-responsable">
        Responsable
      </label>
      <ResponsableSelect
        key={lead.contact.id}
        id="lead-responsable"
        contactId={lead.contact.id}
        assignedTo={lead.contact.assignedTo}
        onNotice={onNotice}
        className={`${INPUT_CLASS} mt-2`}
        readOnlyClassName="mt-2 text-sm text-neutral-500"
      />
      <p className="mt-2 text-xs text-neutral-500">
        Un operario sólo ve los leads donde figura como responsable, salvo que le hayan dado
        permiso para ver más.
      </p>
    </div>
  );
}

function ContactForm({ lead, onNotice }: { lead: LeadDetail; onNotice: (message: string) => void }) {
  const [name, setName] = useState(lead.contact.name);
  const [email, setEmail] = useState(lead.contact.email ?? "");
  const [phone, setPhone] = useState(lead.contact.phone ?? "");
  const [tags, setTags] = useState(lead.contact.tags.join(", "));
  const [value, setValue] = useState(String(lead.opportunity?.value ?? 0));
  const [notes, setNotes] = useState(lead.opportunity?.notes ?? "");
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const contactResult = await updateContact({
        id: lead.contact.id,
        name,
        email,
        phone,
        tags: tags.split(","),
      });
      if (!contactResult.ok) {
        onNotice(contactResult.error);
        return;
      }

      if (lead.opportunity) {
        const details = await updateOpportunityDetails({
          id: lead.opportunity.id,
          value: Number(value || 0),
          notes,
        });
        if (!details.ok) {
          onNotice(details.error);
          return;
        }
      }

      onNotice("Ficha actualizada.");
    });
  };

  return (
    <form onSubmit={save} className="space-y-4 px-5 py-5">
      <div>
        <label className="block text-sm font-medium" htmlFor="lead-name">
          Nombre
        </label>
        <input
          id="lead-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${INPUT_CLASS} mt-2`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="lead-phone">
            Teléfono
          </label>
          <input
            id="lead-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={`${INPUT_CLASS} mt-2`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="lead-email">
            Email
          </label>
          <input
            id="lead-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={`${INPUT_CLASS} mt-2`}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="lead-tags">
          Etiquetas
        </label>
        <input
          id="lead-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="interesado, zona norte"
          className={`${INPUT_CLASS} mt-2`}
        />
        <p className="mt-1 text-xs text-neutral-500">Separadas por coma.</p>
      </div>

      {lead.opportunity && (
        <>
          <div>
            <label className="block text-sm font-medium" htmlFor="lead-value">
              Valor (US$)
            </label>
            <input
              id="lead-value"
              type="number"
              min="0"
              step="1000"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="lead-notes">
              Notas
            </label>
            <textarea
              id="lead-notes"
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Qué busca, presupuesto, zona…"
              className={`${INPUT_CLASS} mt-2 resize-y`}
            />
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-4 text-sm text-neutral-500">
        {lead.contact.phone && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-4" />
            {lead.contact.phone}
          </span>
        )}
        {lead.contact.email && (
          <span className="inline-flex items-center gap-1.5">
            <Mail className="size-4" />
            {lead.contact.email}
          </span>
        )}
      </div>

      <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>
    </form>
  );
}

function AgendaTab({ lead, timezone }: { lead: LeadDetail; timezone: string }) {
  if (lead.appointments.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-neutral-500">
        Sin citas para esta persona. Podés agendar una desde la sección Agenda.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100 px-5 dark:divide-white/10">
      {lead.appointments.map((appointment) => (
        <li key={appointment.id} className="flex items-center gap-3 py-3">
          <CalendarDays className="size-4 shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm">{appointment.title}</strong>
            <span suppressHydrationWarning className="text-sm text-neutral-500">
              {dateTime(appointment.startTime, timezone)}
            </span>
          </span>
          <span className="text-xs text-neutral-400">{appointment.status}</span>
        </li>
      ))}
    </ul>
  );
}
