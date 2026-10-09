"use client";

/**
 * Los recordatorios de las citas, configurados donde se los busca.
 *
 * Vive en la Agenda y no en Automatizaciones, y la razón está escrita en el
 * motor: a un recordatorio hubo que desactivarle la franja horaria, el corte
 * por respuesta, la IA frenada, el tope diario y la condición de etapa, más
 * bloquearle dos pasos. Cuando hay que apagar media pantalla para que entre un
 * caso, la pantalla no es la correcta. Un recordatorio no persigue a nadie:
 * avisa de algo que la persona ya pidió.
 *
 * Lo que queda es lo único que se edita de verdad: cuándo sale, qué dice, y si
 * está prendido. Por debajo cada uno sigue siendo una automatización, así que
 * el motor es el mismo.
 */

import { Bell, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  loadReminderHealth,
  loadReminders,
  saveReminders,
  type RecordatorioRow,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { Card, INPUT_CLASS, Modal, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import {
  diagnosticarRecordatorios,
  MOMENTOS_DE_CITA,
  RECORDATORIOS_SUGERIDOS,
  TOKENS,
  TOKENS_DE_CITA,
  type Diagnostico,
  type MomentoDeCita,
} from "@/lib/automatizaciones";
import { silenceLabelSince } from "@/lib/ventana-meta";

const NOMBRE_DEL_MOMENTO: Record<MomentoDeCita, string> = {
  al_agendar: "Al agendar",
  antes: "Antes de la cita",
};

/**
 * Las unidades en las que se piensa una anticipación.
 *
 * No están los minutos sueltos por debajo de la hora porque no es como se habla
 * de esto: nadie pone "un recordatorio 90 minutos antes", pone "una hora y
 * media" o "dos horas". Un valor guardado que no caiga justo se muestra igual,
 * en la unidad que mejor le quede.
 */
const UNIDADES = [
  { id: "minutos", nombre: "minutos", enMinutos: 1 },
  { id: "horas", nombre: "horas", enMinutos: 60 },
  { id: "dias", nombre: "días", enMinutos: 1440 },
] as const;

type Unidad = (typeof UNIDADES)[number]["id"];

/** Parte los minutos en la unidad más grande que dé un número redondo. */
function partir(minutos: number): { valor: number; unidad: Unidad } {
  for (const unidad of [...UNIDADES].reverse()) {
    if (minutos >= unidad.enMinutos && minutos % unidad.enMinutos === 0) {
      return { valor: minutos / unidad.enMinutos, unidad: unidad.id };
    }
  }
  return { valor: minutos, unidad: "minutos" };
}

function enMinutos(unidad: Unidad): number {
  return UNIDADES.find((u) => u.id === unidad)?.enMinutos ?? 1;
}

/**
 * Cómo se ve cada nivel del diagnóstico.
 *
 * El "ok" es a propósito el más callado de los tres —texto gris, sin color— para
 * que el cartel sólo llame la atención cuando hay algo que mirar. Un tablero
 * verde permanente se vuelve parte del fondo, y entonces el día que se pone rojo
 * tampoco se ve.
 */
const ESTILO_DEL_NIVEL: Record<Diagnostico["nivel"], { caja: string; punto: string }> = {
  ok: { caja: "bg-black/[0.03] text-neutral-500 dark:bg-white/5", punto: "bg-emerald-500" },
  aviso: {
    caja: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
    punto: "bg-amber-500",
  },
  alarma: {
    caja: "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200",
    punto: "bg-red-500",
  },
};

/**
 * Los huecos que se pueden meter con un clic, en el orden en que se escriben.
 *
 * La lista sale de las dos del motor para que no se desincronicen: acá sólo se
 * reordena. Primero los que casi siempre van en un recordatorio —el nombre y
 * los datos de la cita— y al final los que rara vez, como la etapa del embudo.
 * Uno nuevo que aparezca en el motor y no esté en este orden se agrega igual,
 * al final, en vez de quedar invisible.
 */
const ORDEN_DE_LOS_HUECOS = [
  "{nombre}",
  "{cita}",
  "{fecha}",
  "{hora}",
  "{link}",
  "{telefono}",
  "{email}",
  "{etapa}",
];

const HUECOS = (() => {
  const todos = [...TOKENS_DE_CITA, ...TOKENS];
  return [
    ...ORDEN_DE_LOS_HUECOS.flatMap((token) => todos.filter((hueco) => hueco.token === token)),
    ...todos.filter((hueco) => !ORDEN_DE_LOS_HUECOS.includes(hueco.token)),
  ];
})();

/** Uno nuevo arranca un día antes, que es el recordatorio de siempre. */
function recordatorioVacio(): RecordatorioRow {
  return { id: "", enabled: true, momento: "antes", anticipacionMinutos: 1440, texto: "" };
}

type Salud = { diagnostico: Diagnostico; ultimoAviso: string | null };

/**
 * Lee el diagnóstico, aparte del editor.
 *
 * Son dos preguntas distintas —qué está configurado y si está funcionando— y
 * una falla en la segunda no tiene por qué dejar la pantalla sin la primera:
 * ante un error devuelve null y el cartel simplemente no aparece.
 *
 * Vive afuera del componente porque no depende de nada suyo, y así el efecto
 * que la llama no necesita listarla como dependencia.
 */
async function revisar(): Promise<Salud | null> {
  const resultado = await loadReminderHealth();
  if (!resultado.ok) return null;
  return {
    diagnostico: diagnosticarRecordatorios(resultado.estado),
    ultimoAviso: resultado.estado.ultimoAviso,
  };
}

export function RecordatoriosDeCitas({ onNotice }: { onNotice: (mensaje: string) => void }) {
  const access = useAccess();
  const [recordatorios, setRecordatorios] = useState<RecordatorioRow[] | null>(null);
  const [error, setError] = useState("");
  const [guardando, guardar] = useTransition();
  const [salud, setSalud] = useState<Salud | null>(null);
  const [abierto, setAbierto] = useState(false);
  // Lo último que confirmó el servidor, para saber si quedó algo sin guardar.
  const [guardados, setGuardados] = useState("");
  // Una caja de texto por recordatorio, para meter el hueco donde está el
  // cursor y no al final de todo.
  const cajas = useRef<Record<number, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    let vivo = true;
    void loadReminders().then((resultado) => {
      if (!vivo) return;
      if (resultado.ok) {
        setRecordatorios(resultado.recordatorios);
        setGuardados(JSON.stringify(resultado.recordatorios));
      } else setError(resultado.error);
    });
    void revisar().then((estado) => {
      if (vivo) setSalud(estado);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!access.isAdmin) return null;

  const lista = recordatorios ?? [];
  const prendidos = lista.filter((recordatorio) => recordatorio.enabled).length;
  const sinGuardar = recordatorios !== null && JSON.stringify(lista) !== guardados;

  const cambiar = (indice: number, cambios: Partial<RecordatorioRow>) =>
    setRecordatorios(lista.map((fila, i) => (i === indice ? { ...fila, ...cambios } : fila)));

  const quitar = (indice: number) => setRecordatorios(lista.filter((_, i) => i !== indice));

  const agregar = () => setRecordatorios([...lista, recordatorioVacio()]);

  // Los sugeridos entran sin id, igual que uno recién agregado a mano: quedan
  // en pantalla para editar y se escriben recién al guardar.
  const usarSugeridos = () =>
    setRecordatorios(
      RECORDATORIOS_SUGERIDOS.map((sugerido) => ({ id: "", enabled: true, ...sugerido })),
    );

  /**
   * Mete un hueco donde está el cursor.
   *
   * Agregarlo siempre al final obligaría a cortar y pegar para ponerlo en el
   * medio de la frase, que es donde suele ir. Si la caja perdió el foco —o
   * todavía no lo tuvo— se cae al final, que es lo único razonable sin cursor.
   */
  const meterHueco = (indice: number, token: string) => {
    const caja = cajas.current[indice];
    const actual = lista[indice]?.texto ?? "";

    if (!caja) {
      cambiar(indice, { texto: actual + token });
      return;
    }

    const desde = caja.selectionStart ?? actual.length;
    const hasta = caja.selectionEnd ?? desde;
    cambiar(indice, { texto: actual.slice(0, desde) + token + actual.slice(hasta) });

    // Después de que React repinte: sin esto el cursor vuelve al final y el
    // hueco siguiente se escribiría en otro lado.
    requestAnimationFrame(() => {
      caja.focus();
      const cursor = desde + token.length;
      caja.setSelectionRange(cursor, cursor);
    });
  };

  const enviar = () =>
    guardar(async () => {
      setError("");
      const resultado = await saveReminders({ recordatorios: lista });
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      // Se vuelve a leer para quedarse con los ids de los recién creados: sin
      // eso, guardar dos veces seguidas duplicaría los nuevos.
      const releido = await loadReminders();
      if (releido.ok) {
        setRecordatorios(releido.recordatorios);
        setGuardados(JSON.stringify(releido.recordatorios));
      }
      // Prender o apagar uno cambia el diagnóstico, así que se vuelve a mirar.
      setSalud(await revisar());
      onNotice("Recordatorios guardados.");
      setAbierto(false);
    });

  const resumen =
    recordatorios === null
      ? "Cargando…"
      : prendidos === 0
        ? "Ninguno prendido: no se manda nada."
        : `${prendidos === 1 ? "1 recordatorio prendido" : `${prendidos} recordatorios prendidos`}.`;

  return (
    <>
      {/* Afuera del popup queda sólo una línea, pero incluye el diagnóstico: es
          lo que avisa que el sistema dejó de funcionar, y esconderlo adentro de
          una pantalla que se abre a propósito sería esconder justo la alarma. */}
      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* La campanita es decoración: en pantalla angosta se saca para
              que el título y el botón entren en el mismo renglón. */}
          <Bell
            className="size-4 shrink-0 text-amber-600 max-md:hidden dark:text-amber-400"
            aria-hidden
          />
          <h2 className="min-w-0 flex-1 text-sm font-semibold md:flex-none">
            Recordatorios de citas
          </h2>

          {/* En el celular el diagnóstico se va al renglón de abajo, entero y a
              lo ancho: apretado contra el título entraban tres palabras y
              justamente es el renglón que avisa que algo dejó de andar. */}
          {salud ? (
            <span
              className={`inline-flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1 text-sm max-md:order-last max-md:w-full ${ESTILO_DEL_NIVEL[salud.diagnostico.nivel].caja}`}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${ESTILO_DEL_NIVEL[salud.diagnostico.nivel].punto}`}
                aria-hidden
              />
              {/* Recortado al renglón donde comparte lugar con el título; en el
                  celular, donde tiene la tarjeta entera, se lee completo. */}
              <span className="truncate max-md:overflow-visible max-md:whitespace-normal">
                {salud.diagnostico.mensaje}
              </span>
            </span>
          ) : (
            <span className="text-sm text-neutral-500 max-md:order-last max-md:w-full">{resumen}</span>
          )}

          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ddd8c9] px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Settings2 className="size-4" aria-hidden />
            Configurar
            {sinGuardar && (
              <span className="size-1.5 rounded-full bg-amber-500" aria-label="sin guardar" />
            )}
          </button>
        </div>

        {salud?.ultimoAviso && (
          <p className="mt-2 text-xs text-neutral-500">
            Última cita de Calendar: {silenceLabelSince(salud.ultimoAviso)}.
          </p>
        )}
      </Card>

      {abierto && (
        <Modal title="Recordatorios de citas" onClose={() => setAbierto(false)} ancho="max-w-2xl">
          <p className="mt-1 text-sm text-neutral-500">
            Se mandan por WhatsApp a quien reservó. Valen para todas las citas de la agenda.
          </p>

          {recordatorios === null && !error && (
            <p className="mt-4 text-sm text-neutral-500">Cargando…</p>
          )}

          {lista.length === 0 && recordatorios !== null && (
            <div className="mt-4 rounded-xl border border-dashed border-[#ddd8c9] p-4 dark:border-white/10">
              <p className="text-sm text-neutral-500">
                Todavía no hay ninguno, así que no se está mandando nada. Estos tres son los de
                siempre: confirmación al reservar, aviso un día antes y otro una hora antes.
              </p>
              <button
                type="button"
                onClick={usarSugeridos}
                className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ddd8c9] px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <Sparkles className="size-4" aria-hidden />
                Usar los tres sugeridos
              </button>
              <p className="mt-2 text-xs text-neutral-500">
                Los vas a poder editar antes de guardar. Nada sale hasta que aprietes Guardar.
              </p>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {lista.map((recordatorio, indice) => {
              const { valor, unidad } = partir(recordatorio.anticipacionMinutos);

              return (
                <div
                  key={indice}
                  className="rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={recordatorio.enabled}
                        onChange={(evento) => cambiar(indice, { enabled: evento.target.checked })}
                        className="size-4 cursor-pointer accent-amber-500"
                      />
                      <span className="sr-only">Prendido</span>
                    </label>

                    <select
                      value={recordatorio.momento}
                      onChange={(evento) =>
                        cambiar(indice, {
                          momento: evento.target.value as MomentoDeCita,
                          anticipacionMinutos:
                            evento.target.value === "antes"
                              ? recordatorio.anticipacionMinutos || 1440
                              : 0,
                        })
                      }
                      className={`${INPUT_CLASS} min-w-0 flex-1 cursor-pointer md:w-48 md:flex-none`}
                      aria-label="Cuándo sale"
                    >
                      {MOMENTOS_DE_CITA.map((momento) => (
                        <option key={momento} value={momento}>
                          {NOMBRE_DEL_MOMENTO[momento]}
                        </option>
                      ))}
                    </select>

                    {/* Cuánto antes: en pantalla angosta es su propio renglón,
                        abajo de todo —el `order` lo manda al final sin tocar el
                        orden de tabulación—, así arriba quedan el interruptor,
                        cuándo sale y el tacho. De tablet para arriba el
                        `contents` desarma el grupo y es un renglón solo. */}
                    {recordatorio.momento === "antes" && (
                      <div className="flex w-full items-center gap-3 max-md:order-last md:contents">
                        <input
                          type="number"
                          min={1}
                          value={valor}
                          onChange={(evento) =>
                            cambiar(indice, {
                              anticipacionMinutos:
                                Math.max(1, Number(evento.target.value) || 1) * enMinutos(unidad),
                            })
                          }
                          /* Va por `basis` y no por un ancho: `INPUT_CLASS`
                             trae `w-full` y le ganaba, así que el campo del
                             número se estiraba a lo ancho del renglón y
                             empujaba la unidad al de abajo. */
                          className={`${INPUT_CLASS} shrink-0 basis-20`}
                          aria-label="Cuánto antes"
                        />
                        <select
                          value={unidad}
                          onChange={(evento) =>
                            cambiar(indice, {
                              anticipacionMinutos: valor * enMinutos(evento.target.value as Unidad),
                            })
                          }
                          className={`${INPUT_CLASS} min-w-0 flex-1 cursor-pointer md:w-28 md:flex-none`}
                          aria-label="Unidad"
                        >
                          {UNIDADES.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nombre}
                            </option>
                          ))}
                        </select>
                        <span className="text-sm text-neutral-500">antes</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => quitar(indice)}
                      className="ml-auto cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                      aria-label="Quitar este recordatorio"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>

                  <textarea
                    ref={(elemento) => {
                      cajas.current[indice] = elemento;
                    }}
                    value={recordatorio.texto}
                    onChange={(evento) => cambiar(indice, { texto: evento.target.value })}
                    rows={2}
                    placeholder="Hola {nombre}, te recuerdo {cita} el {fecha} a las {hora}."
                    className={`${INPUT_CLASS} mt-3`}
                    aria-label="Texto del recordatorio"
                  />

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {HUECOS.map((hueco) => (
                      <button
                        key={hueco.token}
                        type="button"
                        onMouseDown={(evento) => evento.preventDefault()}
                        onClick={() => meterHueco(indice, hueco.token)}
                        title={hueco.descripcion}
                        className="cursor-pointer rounded-lg border border-[#ddd8c9] px-2 py-1 font-mono text-xs text-neutral-600 transition-colors hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
                      >
                        {hueco.token}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={agregar}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ddd8c9] px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <Plus className="size-4" aria-hidden />
              Agregar recordatorio
            </button>

            <button
              type="button"
              onClick={enviar}
              disabled={guardando || recordatorios === null}
              className={PRIMARY_BUTTON_CLASS}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>

            {sinGuardar && !guardando && (
              <span className="text-sm text-amber-700 dark:text-amber-300">Sin guardar.</span>
            )}
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Tocá un hueco para meterlo donde está el cursor. El que no tenga dato —una cita sin
            enlace, un contacto sin email— se borra del mensaje al mandarlo, y si estaba solo en su
            renglón se va el renglón entero.
          </p>
          <p className="mt-1.5 text-xs text-neutral-500">
            <code className="font-mono">{"{link}"}</code> es el enlace de la cita: en las de
            Calendar viene solo, y en las que carga el equipo hay que pegarlo desde la agenda.
          </p>

          {error && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
        </Modal>
      )}
    </>
  );
}
