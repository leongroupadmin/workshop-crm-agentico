"use client";

import { useEffect, useState, useTransition } from "react";

import {
  archiveContacts,
  deleteContacts,
  loadContactFootprint,
  type ContactFootprint,
} from "@/app/actions";
import { Modal } from "@/components/ui";

type DeletableContact = {
  id: string;
  name: string;
};

/**
 * Confirmación compartida para borrar contactos desde cualquier ficha o lista.
 *
 * Archivar y borrar se parecen desde afuera, así que el cartel enumera lo que
 * el cascade se lleva puesto y ofrece archivar como salida reversible.
 */
export function DeleteContactModal({
  contacts,
  close,
  onNotice,
  onCompleted,
}: {
  contacts: DeletableContact[];
  close: () => void;
  onNotice: (message: string) => void;
  onCompleted?: (mode: "delete" | "archive") => void;
}) {
  const [footprint, setFootprint] = useState<ContactFootprint | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const ids = contacts.map((contact) => contact.id);
  const key = ids.join(",");
  const varios = contacts.length > 1;
  const quienes = varios ? `${contacts.length} contactos` : contacts[0]?.name ?? "";

  useEffect(() => {
    let vigente = true;
    void loadContactFootprint({ ids: key.split(",") }).then((result) => {
      if (!vigente) return;
      if (result.ok) setFootprint(result.footprint);
      else setError(result.error);
    });
    return () => {
      vigente = false;
    };
  }, [key]);

  const confirm = () => {
    setError("");
    startTransition(async () => {
      const result = await deleteContacts({ ids });
      if (result.ok) {
        close();
        onCompleted?.("delete");
        onNotice(
          varios ? `Se borraron ${contacts.length} contactos.` : `${quienes} se borró de la base.`,
        );
      } else {
        setError(result.error);
      }
    });
  };

  const archive = () => {
    setError("");
    startTransition(async () => {
      const result = await archiveContacts({ ids });
      if (result.ok) {
        close();
        onCompleted?.("archive");
        onNotice(
          varios
            ? `Se archivaron ${contacts.length} contactos. Sus chats siguen guardados.`
            : `${quienes} fue archivado. Sus chats siguen guardados.`,
        );
      } else {
        setError(result.error);
      }
    });
  };

  const lines = footprint
    ? [
        [footprint.conversations, "conversación", "conversaciones"] as const,
        [footprint.messages, "mensaje", "mensajes"] as const,
        [footprint.appointments, "turno en la agenda", "turnos en la agenda"] as const,
        [footprint.opportunities, "oportunidad del embudo", "oportunidades del embudo"] as const,
      ].filter(([count]) => count > 0)
    : [];

  return (
    <Modal title={varios ? `Borrar ${contacts.length} contactos` : `Borrar a ${quienes}`} onClose={close}>
      <div className="mt-5">
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
          {varios ? "Esto los saca" : "Esto lo saca"} de la base para siempre. No se puede deshacer.
        </p>

        {varios && (
          <ul className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-white/[.04] dark:text-neutral-300">
            {contacts.map((contact) => (
              <li key={contact.id} className="truncate">
                {contact.name}
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">También se borra:</p>
            <ul className="mt-2 space-y-1 text-sm text-red-700 dark:text-red-200">
              {lines.map(([count, one, many]) => (
                <li key={many}>
                  {count} {count === 1 ? one : many}
                </li>
              ))}
            </ul>
          </div>
        )}

        {footprint && lines.length === 0 && (
          <p className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-white/[.04]">
            {varios ? "No tienen" : "No tiene"} chats ni turnos asociados.
          </p>
        )}

        <p className="mt-4 text-sm leading-6 text-neutral-500">
          Si sólo querés {varios ? "sacarlos" : "sacarlo"} de la vista, {varios ? "archivalos" : "archivalo"}:
          se {varios ? "ocultan" : "oculta"} pero {varios ? "conservan" : "conserva"} todo.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="min-h-11 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={archive}
            className="min-h-11 cursor-pointer rounded-xl border border-[#ddd8c9] px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
          >
            {pending ? "Procesando…" : "Archivar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className="min-h-11 cursor-pointer rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Procesando…" : "Borrar definitivamente"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
