"use client";

import { ArrowUp, Sparkles, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { preguntarAlAsistente, type AsistenteTurno } from "@/app/actions";
import { INPUT_CLASS } from "@/components/ui";

/**
 * El asistente del CRM, en una burbuja.
 *
 * Va flotando y no como una sección del menú a propósito: se pregunta *sobre*
 * lo que estás mirando —"¿este lead ya me escribió antes?"— y mandar a la
 * persona a otra pantalla para preguntarlo rompe justamente eso.
 *
 * La conversación vive acá y nada más. No se guarda en la base: al recargar
 * arranca de cero. Es una decisión, no una deuda — un historial de preguntas
 * sobre leads es otro lugar donde se acumulan datos de personas, y el valor de
 * conservarlo no paga ese costo.
 */

/**
 * Dónde cuelga el panel.
 *
 * Es el div que lleva la clase del tema. No puede ser el `body`: el modo claro
 * vive en esa clase, y `globals.css` le da al body el texto casi blanco del
 * tema oscuro. Un panel colgado del body salía con `bg-[#f9f8f3]` y texto blanco
 * heredado — ilegible.
 */
export const RAIZ_DEL_TEMA = "crm-raiz";

type Turno = AsistenteTurno & { error?: boolean };

/** Lo que se ofrece cuando todavía no se preguntó nada. */
const EJEMPLOS = [
  "¿Cómo venimos este mes?",
  "¿Qué tengo pendiente?",
  "¿Cuánto hay en el embudo?",
];

export function AsistenteWidget() {
  const [abierto, setAbierto] = useState(false);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [pending, startTransition] = useTransition();

  const finRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // Al abrir, el foco va al campo: se abre para escribir, no para mirar.
  useEffect(() => {
    if (abierto) campoRef.current?.focus();
  }, [abierto]);

  // Cada respuesta baja la vista. Sin esto hay que arrastrar para leer lo que
  // acaba de llegar, que es lo único que interesa.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, pending]);

  // Escape cierra, como cualquier panel que se superpone.
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [abierto]);

  const preguntar = (pregunta: string) => {
    const limpia = pregunta.trim();
    if (!limpia || pending) return;

    // La historia que viaja es la de antes de esta pregunta más la pregunta:
    // leerla del estado dentro del transition daría la de la vuelta anterior.
    const historia: Turno[] = [...turnos, { role: "user", content: limpia }];
    setTurnos(historia);
    setTexto("");

    startTransition(async () => {
      const result = await preguntarAlAsistente({
        // Los turnos con error no viajan: son del CRM, no de la conversación.
        mensajes: historia
          .filter((turno) => !turno.error)
          .map(({ role, content }) => ({ role, content })),
      });
      setTurnos((actuales) => [
        ...actuales,
        result.ok
          ? { role: "assistant", content: result.text }
          : { role: "assistant", content: result.error, error: true },
      ]);
    });
  };

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    preguntar(texto);
  };

  const disparador = (
    <button
      type="button"
      onClick={() => setAbierto((value) => !value)}
      aria-expanded={abierto}
      aria-label="Asistente del CRM"
      className={`grid size-10 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-neutral-200 dark:hover:bg-white/10 ${
        abierto ? "text-amber-600 dark:text-amber-400" : "text-neutral-500"
      }`}
    >
      <Sparkles className="size-5" />
    </button>
  );

  if (!abierto) return disparador;

  return (
    <>
      {disparador}
      {/* El panel sale por un portal y no se dibuja acá adentro. El encabezado
          es `sticky` con `z-10`, y eso abre un contexto de apilamiento: el
          `z-40` del panel se resolvía dentro de ese 10, así que el menú lateral
          del teléfono (z-30) y la ficha de lead (z-50) le pasaban por encima.
          El destino es la raíz del tema y no el `body`, para no perder los
          colores; ese div no tiene posición ni z-index, así que no vuelve a
          encerrarlo. */}
      {createPortal(
        <>

        {/* Un fondo que sólo captura el clic: cerrar tocando fuera es lo que se
            espera de algo que cuelga del encabezado, igual que la campana. */}
        <button
          type="button"
          aria-label="Cerrar el asistente"
          onClick={() => setAbierto(false)}
          className="fixed inset-0 z-30 cursor-default"
        />

        <div
          role="dialog"
          aria-label="Asistente del CRM"
          /* Cuelga del encabezado y no del pie: abajo a la derecha tapaba el
             botón de enviar de la bandeja, que es justo donde más se usa el CRM.
             En el teléfono ocupa casi toda la pantalla, porque un panel angosto
             al lado de un teclado abierto no deja lugar para leer la respuesta. */
          className="fixed inset-x-3 bottom-3 top-20 z-40 flex flex-col overflow-hidden rounded-2xl border border-[#ddd8c9] bg-[#f9f8f3] shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-[4.5rem] sm:h-[min(34rem,calc(100vh-6.5rem))] sm:w-[26rem] dark:border-white/10 dark:bg-neutral-900"
        >
          <header className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-white/10">
            <span className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Asistente</h2>
              <p className="truncate text-xs text-neutral-500">Pregunta sobre tus leads y métricas</p>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar el asistente"
              className="ml-auto grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {turnos.length === 0 && (
              <div className="pt-6">
                <p className="text-sm text-neutral-500">
                  Preguntame lo que necesites saber del CRM. Consulto los datos en el momento y sólo
                  veo lo que vos podrías ver.
                </p>
                <div className="mt-4 space-y-2">
                  {EJEMPLOS.map((ejemplo) => (
                    <button
                      key={ejemplo}
                      type="button"
                      onClick={() => preguntar(ejemplo)}
                      className="block w-full cursor-pointer rounded-xl border border-[#ddd8c9] px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      {ejemplo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turnos.map((turno, indice) => (
              <Burbuja key={indice} turno={turno} />
            ))}

            {pending && (
              <p className="text-sm text-neutral-500" role="status">
                Consultando…
              </p>
            )}

            <div ref={finRef} />
          </div>

          <form onSubmit={enviar} className="border-t border-neutral-100 p-3 dark:border-white/10">
            <div className="flex items-end gap-2">
              <textarea
                ref={campoRef}
                rows={1}
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                // Enter manda y Shift+Enter hace un renglón: es lo que espera
                // cualquiera que viene de usar un chat.
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    preguntar(texto);
                  }
                }}
                placeholder="Preguntá algo…"
                aria-label="Tu pregunta"
                className={`${INPUT_CLASS} max-h-28 resize-none py-2 text-sm`}
              />
              <button
                type="submit"
                disabled={!texto.trim() || pending}
                aria-label="Enviar"
                className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-amber-500 text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="size-5" />
              </button>
              </div>
            </form>
        </div>
        </>,
        document.getElementById(RAIZ_DEL_TEMA) ?? document.body,
      )}
    </>
  );
}

/**
 * Un turno de la charla.
 *
 * La respuesta va en texto plano con los saltos respetados y no en Markdown
 * renderizado: meter un renderizador acá sería traer una dependencia y una
 * superficie de HTML inyectado para ganar unas negritas.
 */
function Burbuja({ turno }: { turno: Turno }) {
  if (turno.role === "user") {
    return (
      <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500 px-3 py-2 text-sm text-neutral-950">
        {turno.content}
      </p>
    );
  }

  return (
    <p
      className={`max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm px-3 py-2 text-sm ${
        turno.error
          ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
          : "bg-neutral-100 dark:bg-white/[.06]"
      }`}
    >
      {turno.content}
    </p>
  );
}
