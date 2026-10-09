"use client";

import { ImagePlus, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ACEPTA_ADJUNTOS,
  MAX_CAPTION,
  revisarAdjunto,
  type AdjuntoKind,
} from "@/lib/adjuntos";

type Estado =
  | { fase: "quieto" }
  | { fase: "listo"; archivo: File; url: string; kind: AdjuntoKind };

/**
 * Elegir una imagen o un video y mandarlo al chat.
 *
 * Igual que la nota de voz, no sale apenas se elige: primero se ve, y recién
 * ahí se manda o se descarta. Mandar una foto sin verla es mandar la foto
 * equivocada, y en un chat con un cliente eso no se puede deshacer.
 *
 * El epígrafe va acá y no en la caja de texto del chat porque viaja pegado al
 * archivo: es una sola burbuja del lado del contacto, no un mensaje aparte que
 * puede llegar antes o después de la foto.
 */
export function MediaPicker({
  disabled,
  onSend,
  onNotice,
  onActiveChange,
}: {
  disabled: boolean;
  /** Recibe el archivo elegido y su epígrafe. Devuelve si se pudo enviar. */
  onSend: (archivo: File, caption: string) => Promise<boolean>;
  onNotice: (message: string) => void;
  /** Avisa cuando ocupa toda la barra, para que el compositor se corra. */
  onActiveChange: (active: boolean) => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "quieto" });
  const [caption, setCaption] = useState("");
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urlActual = useRef<string | null>(null);

  // La vista previa es un object URL: si no se suelta, el archivo entero se
  // queda en memoria del navegador hasta que se recargue la página.
  useEffect(() => {
    return () => {
      if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    };
  }, []);

  useEffect(() => {
    onActiveChange(estado.fase !== "quieto");
  }, [estado.fase, onActiveChange]);

  const elegir = (archivo: File | undefined) => {
    // Se limpia el input en cualquier caso: sin esto, volver a elegir el mismo
    // archivo después de descartarlo no dispara el `change`.
    if (input.current) input.current.value = "";
    if (!archivo) return;

    // El tamaño y el formato se revisan antes de subir, no después: avisar
    // "pesa demasiado" cuando ya se fueron catorce megas por la red es el peor
    // momento posible para avisarlo. El servidor lo revisa de nuevo igual.
    const revision = revisarAdjunto(archivo.type, archivo.size);
    if (!revision.ok) {
      onNotice(revision.error);
      return;
    }

    if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    const url = URL.createObjectURL(archivo);
    urlActual.current = url;
    setCaption("");
    setEstado({ fase: "listo", archivo, url, kind: revision.adjunto.kind });
  };

  const descartar = () => {
    if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    urlActual.current = null;
    setCaption("");
    setEstado({ fase: "quieto" });
  };

  const enviar = async () => {
    if (estado.fase !== "listo") return;
    setEnviando(true);
    const salio = await onSend(estado.archivo, caption.trim());
    setEnviando(false);
    if (salio) descartar();
  };

  // El input vive en los dos estados, no sólo en el de reposo: si se desmontara
  // al elegir un archivo, el `change` quedaría disparándose sobre un nodo que ya
  // no está en el documento.
  const selector = (
    <input
      ref={input}
      type="file"
      accept={ACEPTA_ADJUNTOS}
      onChange={(evento) => elegir(evento.target.files?.[0])}
      className="hidden"
    />
  );

  if (estado.fase === "quieto") {
    return (
      <>
        {selector}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled}
          title="Enviar una imagen o un video"
          aria-label="Enviar una imagen o un video"
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#ddd8c9] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
        >
          <ImagePlus className="size-4" />
        </button>
      </>
    );
  }

  return (
    /* En el celular la vista previa y el epígrafe se llevan una fila cada uno y
       los botones bajan abajo: los cuatro al lado dejaban el epígrafe en un
       campo de dos dedos de ancho. */
    <div className="flex flex-1 flex-wrap items-center gap-2 rounded-xl border border-[#ddd8c9] p-2 sm:flex-nowrap dark:border-white/10">
      {selector}

      {estado.kind === "imagen" ? (
        /* eslint-disable-next-line @next/next/no-img-element -- es un object URL
           del archivo que se acaba de elegir: no hay un dominio que declarar en
           next.config y next/image lo rechazaría. */
        <img
          src={estado.url}
          alt="Lo que estás por enviar"
          className="size-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <video
          src={estado.url}
          controls
          preload="metadata"
          className="h-16 w-28 shrink-0 rounded-lg bg-black"
        />
      )}

      <label className="sr-only" htmlFor="media-caption">
        Epígrafe del adjunto
      </label>
      <input
        id="media-caption"
        value={caption}
        onChange={(evento) => setCaption(evento.target.value)}
        onKeyDown={(evento) => {
          // Enter manda, como en la caja de texto del chat. El `isComposing` es
          // por los teclados que arman el caracter con Enter.
          if (evento.key !== "Enter" || evento.nativeEvent.isComposing) return;
          evento.preventDefault();
          if (!enviando) void enviar();
        }}
        enterKeyHint="send"
        maxLength={MAX_CAPTION}
        placeholder="Agregá un texto (opcional)…"
        disabled={enviando}
        autoFocus
        className="min-w-0 flex-1 basis-full rounded-lg border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-amber-500 disabled:opacity-60 sm:basis-auto dark:border-white/10 dark:bg-white/5"
      />

      <button
        type="button"
        onClick={descartar}
        disabled={enviando}
        aria-label="Descartar el adjunto"
        title="Descartar"
        className="ms-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 sm:ms-0 dark:hover:bg-red-500/10"
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => void enviar()}
        disabled={enviando}
        aria-label={estado.kind === "imagen" ? "Enviar la imagen" : "Enviar el video"}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send className="size-3.5" />
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    </div>
  );
}
