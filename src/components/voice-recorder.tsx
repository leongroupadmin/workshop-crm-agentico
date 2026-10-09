"use client";

import { Mic, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Tope de la grabación. Pasado esto se corta sola y queda lista para enviar. */
const MAX_SEGUNDOS = 180;

/**
 * Los formatos que sabe grabar cada navegador, en orden de preferencia.
 *
 * OGG/Opus va primero porque es el que WhatsApp acepta como nota de voz: el
 * navegador que lo grabe se ahorra la traducción del servidor. Firefox lo
 * ofrece; Chrome y Edge, no, y caen en webm/opus, que lleva los mismos paquetes
 * Opus adentro y se pasa a OGG antes de enviarlo. Safari sólo da mp4, que sale
 * como adjunto de audio en vez de nota de voz.
 */
const FORMATOS = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

const elegirFormato = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return FORMATOS.find((tipo) => MediaRecorder.isTypeSupported(tipo)) ?? null;
};

const reloj = (segundos: number) =>
  `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

type Estado =
  | { fase: "quieto" }
  | { fase: "grabando" }
  | { fase: "listo"; blob: Blob; url: string };

/**
 * Grabar una nota de voz y mandarla al chat.
 *
 * Usa `MediaRecorder`, que ya trae el navegador: no hay librería de audio ni
 * nada que instalar. Después de parar no se envía solo — primero se escucha, y
 * recién ahí se manda o se descarta. Una nota de voz que sale sin escuchar es
 * una nota de voz que sale mal.
 */
export function VoiceRecorder({
  disabled,
  onSend,
  onNotice,
  onActiveChange,
  sendLabel = "Enviar",
  sendingLabel = "Enviando…",
}: {
  disabled: boolean;
  /** Recibe el audio ya grabado. Devuelve si se pudo enviar. */
  onSend: (blob: Blob, mimeType: string) => Promise<boolean>;
  onNotice: (message: string) => void;
  /** Avisa cuando ocupa toda la barra, para que el compositor se corra. */
  onActiveChange: (active: boolean) => void;
  /**
   * Qué dice el botón que confirma la grabación.
   *
   * En el chat el audio sale ahí mismo y dice "Enviar". En una automatización
   * se guarda para mandarlo después, y llamarlo igual haría pensar que ya le
   * llegó a alguien.
   */
  sendLabel?: string;
  /** Lo que dice ese mismo botón mientras `onSend` está en curso. */
  sendingLabel?: string;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "quieto" });
  const [segundos, setSegundos] = useState(0);
  const [enviando, setEnviando] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const urlActual = useRef<string | null>(null);

  // El micrófono queda tomado hasta que se suelta la pista: sin esto el punto
  // rojo del navegador se queda prendido después de grabar.
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    };
  }, []);

  useEffect(() => {
    onActiveChange(estado.fase !== "quieto");
  }, [estado.fase, onActiveChange]);

  useEffect(() => {
    if (estado.fase !== "grabando") return;

    const timer = setInterval(() => {
      setSegundos((actual) => {
        if (actual + 1 >= MAX_SEGUNDOS) recorder.current?.stop();
        return actual + 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [estado.fase]);

  const arrancar = async () => {
    const formato = elegirFormato();
    if (!formato) {
      onNotice("Este navegador no puede grabar audio. Probá con Chrome.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // El navegador no distingue "dijo que no" de "no hay micrófono", así que
      // el aviso cubre los dos.
      onNotice("No se pudo usar el micrófono. Revisá el permiso del navegador.");
      return;
    }

    trozos.current = [];
    const grabador = new MediaRecorder(stream, { mimeType: formato });

    grabador.ondataavailable = (event) => {
      if (event.data.size > 0) trozos.current.push(event.data);
    };

    grabador.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(trozos.current, { type: formato });
      const url = URL.createObjectURL(blob);
      urlActual.current = url;
      setEstado({ fase: "listo", blob, url });
    };

    recorder.current = grabador;
    setSegundos(0);
    grabador.start();
    setEstado({ fase: "grabando" });
  };

  const parar = () => recorder.current?.stop();

  const descartar = () => {
    if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    urlActual.current = null;
    setEstado({ fase: "quieto" });
    setSegundos(0);
  };

  const enviar = async () => {
    if (estado.fase !== "listo") return;
    setEnviando(true);
    const salio = await onSend(estado.blob, estado.blob.type);
    setEnviando(false);
    if (salio) descartar();
  };

  if (estado.fase === "quieto") {
    return (
      <button
        type="button"
        onClick={() => void arrancar()}
        disabled={disabled}
        title="Grabar una nota de voz"
        aria-label="Grabar una nota de voz"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#ddd8c9] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
      >
        <Mic className="size-4" />
      </button>
    );
  }

  if (estado.fase === "grabando") {
    return (
      <div className="flex flex-1 items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3 dark:border-red-500/30 dark:bg-red-500/10">
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-600" />
        <span className="font-mono text-sm tabular-nums text-red-700 dark:text-red-300">
          {reloj(segundos)}
        </span>
        <span className="hidden text-xs text-red-700/70 dark:text-red-300/70 sm:block">
          Grabando… se corta sola a los {MAX_SEGUNDOS / 60} min
        </span>
        <button
          type="button"
          onClick={parar}
          aria-label="Terminar la grabación"
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          <Square className="size-3.5 fill-current" />
          Listo
        </button>
      </div>
    );
  }

  return (
    /* En el celular el reproductor se lleva una fila y los botones bajan a la
       siguiente: los tres al lado quedaban en un reproductor de dos dedos de
       ancho, donde no se podía ni buscar un segundo del audio. */
    <div className="flex flex-1 flex-wrap items-center gap-2 rounded-xl border border-[#ddd8c9] px-2 py-1.5 sm:flex-nowrap dark:border-white/10">
      {/* Se escucha antes de mandar: es la diferencia entre una nota de voz y
          un accidente. */}
      <audio src={estado.url} controls className="h-9 w-full min-w-0 basis-full sm:basis-auto" />
      <button
        type="button"
        onClick={descartar}
        disabled={enviando}
        aria-label="Descartar la grabación"
        title="Descartar"
        className="ms-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 sm:ms-0 dark:hover:bg-red-500/10"
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => void enviar()}
        disabled={enviando}
        aria-label={`${sendLabel} la nota de voz`}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send className="size-3.5" />
        {enviando ? sendingLabel : sendLabel}
      </button>
    </div>
  );
}
