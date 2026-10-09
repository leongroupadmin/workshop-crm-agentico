"use client";

import { ExternalLink, Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";

import { adivinarMedia, type MediaKind } from "@/lib/media-kind";

/**
 * Lo ya averiguado, por URL.
 *
 * Vive fuera del componente a propósito: el hilo se re-renderiza en cada
 * mensaje nuevo y en cada vuelta del polling, y sin esto cada burbuja volvería
 * a pedir la misma imagen para adivinar de nuevo lo mismo.
 */
const averiguado = new Map<string, MediaKind>();

/** Si a los diez segundos no contestó ni la imagen ni el video, se da por archivo. */
const TIMEOUT_MS = 10_000;

/**
 * Averigua qué es una URL cargándola.
 *
 * Primero se prueba como imagen, que es lo más barato y lo más común. Si el
 * navegador no la puede decodificar, se prueba con un `<video>`: un elemento de
 * video reproduce también archivos que son sólo audio, y ahí `videoWidth` queda
 * en cero, así que la misma prueba distingue los dos casos.
 *
 * No se usa un HEAD al servidor porque sería una petición nuestra por cada
 * mensaje con adjunto, y porque muchos CDN de mensajería no responden HEAD.
 */
function probar(url: string): Promise<MediaKind> {
  return new Promise((resolve) => {
    let listo = false;
    const contestar = (tipo: MediaKind) => {
      if (listo) return;
      listo = true;
      resolve(tipo);
    };

    const reloj = setTimeout(() => contestar("archivo"), TIMEOUT_MS);
    const terminar = (tipo: MediaKind) => {
      clearTimeout(reloj);
      contestar(tipo);
    };

    const imagen = new Image();
    // Sin esto el CDN ve que el pedido viene de nuestro dominio y varios
    // (fbcdn entre ellos) devuelven 403 por hotlinking.
    imagen.referrerPolicy = "no-referrer";
    imagen.onload = () => terminar("imagen");
    imagen.onerror = () => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => terminar(video.videoWidth > 0 ? "video" : "audio");
      video.onerror = () => terminar("archivo");
      video.src = url;
    };
    imagen.src = url;
  });
}

/**
 * Qué tipo de adjunto es. Devuelve null mientras lo está averiguando.
 *
 * Es un hook aparte del componente porque la burbuja también necesita el dato:
 * abajo de una imagen no va el mismo texto que abajo de un audio.
 */
export function useMediaKind(url: string | null): MediaKind | null {
  // Lo que se puede saber sin pedir nada se resuelve en el render, no con un
  // estado: si no, la primera pintada muestra el esqueleto de carga aunque la
  // respuesta ya estuviera a mano.
  const conocido = url ? adivinarMedia(url) ?? averiguado.get(url) ?? null : "archivo";
  const [probado, setProbado] = useState<{ url: string; kind: MediaKind } | null>(null);

  useEffect(() => {
    if (!url || conocido) return;

    let vigente = true;
    void probar(url).then((resultado) => {
      averiguado.set(url, resultado);
      // El chat pudo cambiar de conversación mientras cargaba.
      if (vigente) setProbado({ url, kind: resultado });
    });

    return () => {
      vigente = false;
    };
  }, [url, conocido]);

  if (conocido) return conocido;
  // El resultado se guarda junto a su URL: sin eso, al pasar de un adjunto a
  // otro se mostraría por un instante el tipo del anterior.
  return probado?.url === url ? probado.kind : null;
}

/**
 * Muestra el adjunto adentro del chat.
 *
 * La idea es no tener que salir de la conversación: una foto se ve, un audio se
 * escucha y un video se mira acá mismo. El enlace queda sólo para lo que el
 * navegador no puede abrir —un PDF, un documento— y para cuando el archivo ya
 * no está disponible, que con las URL firmadas de Zernio pasa al vencerse.
 *
 * Hay dos caminos para llegar al archivo: el enlace del proveedor y el del CRM
 * (`/api/adjuntos/…`), que lo baja del lado del servidor.
 */
export function MediaAttachment({
  messageId,
  url,
  kind,
  mine,
}: {
  messageId: string;
  url: string;
  kind: MediaKind | null;
  mine: boolean;
}) {
  const [ampliada, setAmpliada] = useState(false);
  // Se guarda de qué URL son los fallos, no un número suelto: así al cambiar
  // de mensaje la cuenta se cae sola, sin un efecto que la reinicie.
  const [fallos, setFallos] = useState<{ url: string; veces: number } | null>(null);
  const veces = fallos?.url === url ? fallos.veces : 0;
  const fallar = () => setFallos({ url, veces: veces + 1 });
  const roto = veces > 0;

  const delCrm = `/api/adjuntos/${messageId}`;
  // Una foto o un video se piden primero al proveedor, que suele ser un CDN y
  // no carga al servidor; si no abre, se reintenta por el CRM antes de darlo
  // por perdido.
  const fuente = veces === 0 ? url : delCrm;
  const agotado = veces >= 2;

  // Esc cierra la imagen ampliada. Sin esto la única salida es el botón, y en
  // una foto a pantalla completa no siempre se ve dónde está.
  useEffect(() => {
    if (!ampliada) return;
    const salir = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAmpliada(false);
    };
    window.addEventListener("keydown", salir);
    return () => window.removeEventListener("keydown", salir);
  }, [ampliada]);

  if (kind === null) {
    return (
      <span
        className={`mt-1.5 block h-24 w-40 max-w-full animate-pulse rounded-lg ${
          mine ? "bg-neutral-200 dark:bg-white/10" : "bg-amber-500/25"
        }`}
      />
    );
  }

  // El audio va siempre por el CRM. Probarlo primero directo no sirve como en
  // la foto: el error recién aparece al tocar play, y para entonces habría que
  // pedirle a la persona que lo toque de nuevo. Son archivos chicos.
  //
  // `metadata` y no `none`: así se ve cuánto dura antes de darle play, y un
  // audio que ya no está se nota de entrada en vez de dejar un botón muerto.
  if (kind === "audio" && !roto) {
    return (
      <audio
        src={delCrm}
        controls
        preload="metadata"
        onError={fallar}
        className="mt-1.5 h-9 w-56 max-w-full"
      />
    );
  }

  if (kind === "video" && !agotado) {
    return (
      <video
        src={fuente}
        controls
        preload="metadata"
        onError={fallar}
        className="mt-1.5 max-h-72 w-64 max-w-full rounded-lg bg-black"
      />
    );
  }

  if (kind === "imagen" && !agotado) {
    return (
      <>
        <button
          type="button"
          onClick={() => setAmpliada(true)}
          className="mt-1.5 block cursor-zoom-in overflow-hidden rounded-lg"
          aria-label="Ampliar la imagen"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- el dominio del
              CDN de cada canal es distinto y cambia, así que no se puede
              declarar en next.config; next/image lo rechazaría. */}
          <img
            src={fuente}
            alt="Adjunto"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={fallar}
            className="max-h-72 w-auto max-w-full object-cover"
          />
        </button>

        {ampliada && (
          <div
            role="presentation"
            onClick={() => setAmpliada(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- mismo motivo */}
            <img
              src={fuente}
              alt="Adjunto ampliado"
              referrerPolicy="no-referrer"
              onClick={(evento) => evento.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setAmpliada(false)}
              aria-label="Cerrar"
              className="absolute right-4 top-4 grid size-10 cursor-pointer place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
            >
              <X className="size-5" />
            </button>
            <a
              href={fuente}
              target="_blank"
              rel="noreferrer"
              onClick={(evento) => evento.stopPropagation()}
              className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm text-white transition-colors hover:bg-white/25"
            >
              <ExternalLink className="size-3.5" />
              Abrir el original
            </a>
          </div>
        )}
      </>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
        mine
          ? "bg-neutral-100 hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/20"
          : "bg-amber-500/20 hover:bg-amber-500/30"
      }`}
    >
      <Paperclip className="size-3.5" />
      {roto ? "El archivo ya no está disponible" : "Abrir el adjunto"}
    </a>
  );
}
