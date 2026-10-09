"use client";

import { X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { safeTimeZone } from "@/lib/fechas";
import type { Channel } from "@/types/database";

const AVATAR_COLORS = [
  "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function avatarColor(name: string) {
  const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

/**
 * "08 oct, 15:00" en la zona del workspace.
 *
 * La zona es obligatoria a propósito. Sin ella, la hora salía del reloj de
 * quien la formateaba: el servidor —Vercel corre en UTC— armaba la página con
 * la cita tres horas corrida, y el `suppressHydrationWarning` hacía que el
 * navegador se quedara con ese texto en vez de corregirlo. Los recordatorios,
 * que ya usaban la zona del workspace, decían la hora bien y la agenda no.
 */
export const dateTime = (value: string, timeZone: string) =>
  new Date(value).toLocaleString("es-AR", {
    timeZone: safeTimeZone(timeZone),
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const money = (amount: number) => `US$ ${amount.toLocaleString("es-AR")}`;

export const INPUT_CLASS =
  "w-full rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 text-base outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-white/5";

export const PRIMARY_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Una hora del día, cargada en minutos desde la medianoche.
 *
 * Vive acá porque la usan los dos lados que tienen horarios —la franja de envío
 * y los turnos del reparto en Automatizaciones, y el horario del agente en
 * Agentes IA— y los tres guardan lo mismo: minutos desde la medianoche, que es
 * la unidad de las columnas `hora_desde` y `hora_hasta`. Dos copias del mismo
 * `input type="time"` son dos formas de redondear los minutos.
 */
export function Hora({
  minutos,
  onChange,
  etiqueta,
}: {
  minutos: number;
  onChange: (minutos: number) => void;
  etiqueta: string;
}) {
  const texto = `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(
    minutos % 60,
  ).padStart(2, "0")}`;

  return (
    <label className="text-sm">
      <span className="block text-xs font-medium text-neutral-500">{etiqueta}</span>
      <input
        type="time"
        value={texto}
        onChange={(event) => {
          const [hora, minuto] = event.target.value.split(":").map(Number);
          if (Number.isFinite(hora) && Number.isFinite(minuto)) onChange(hora * 60 + minuto);
        }}
        className={`${INPUT_CLASS} mt-1.5 w-36`}
      />
    </label>
  );
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

const CHANNEL_TONES: Record<Channel, string> = {
  whatsapp: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  instagram: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  messenger: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
};

/** Canales por los que llegó un lead. Uno solo por canal, aunque escriba mil veces. */
export function ChannelBadges({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {channels.map((channel) => (
        <span
          key={channel}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CHANNEL_TONES[channel]}`}
        >
          {CHANNEL_LABELS[channel]}
        </span>
      ))}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-[#ddd8c9] bg-[#f9f8f3] shadow-sm dark:border-white/10 dark:bg-[#1c1811] ${className}`}
    >
      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-neutral-100 text-neutral-400 dark:bg-white/5">
        <Icon className="size-6" />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  ancho = "max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Clase de ancho máximo. El por omisión sirve para un formulario corto. */
  ancho?: string;
}) {
  const titleId = `modal-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-neutral-950/45 p-4 backdrop-blur-sm"
    >
      <div className={`w-full ${ancho} rounded-2xl bg-[#f9f8f3] p-6 shadow-2xl dark:bg-[#1c1811]`}>
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
