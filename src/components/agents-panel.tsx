"use client";

import { Bot, BotOff, Check, ChevronDown, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from "react";

import {
  loadAgentConfigs,
  loadChatModels,
  probarMovimientoDelAgente,
  saveAgentConfig,
  setAgentEnabled,
  type AgentConfig,
} from "@/app/actions";
import { OpcionesDeEtapa, hayVariosEmbudos } from "@/components/opciones-de-etapa";
import { CHANNEL_LABELS, Card, Hora, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import {
  errorDeLasReglas,
  errorDeRegla,
  MAX_CRITERIO_CHARS,
  MAX_REGLAS,
  type ReglaDeMovimiento,
} from "@/lib/movimientos-del-agente";
import {
  MAX_REPLY_DELAY_SECONDS,
  MAX_SYSTEM_PROMPT_CHARS,
  MIN_REPLY_DELAY_SECONDS,
  SYSTEM_PROMPT_WARN_CHARS,
  aproxTokens,
  errorDeDemora,
  errorDePrompt,
} from "@/lib/agent-limits";
import { PLANTILLA_DE_INSTRUCCIONES } from "@/lib/plantilla-de-instrucciones";
import type { PipelineRow, StageRow } from "@/lib/crm-data";
import {
  JORNADA,
  MAX_AVISO_CHARS,
  MAX_FRANJAS,
  MINUTOS_DEL_DIA,
  SIESTA,
  contestaSiempre,
  describirHorario,
  errorDeAviso,
  errorDeHorario,
  horaEnTexto,
  type Franja,
  type HorarioDelAgente,
} from "@/lib/horario-del-agente";
import type { Channel } from "@/types/database";

/**
 * Lo que el agente sabe hacer además de conversar.
 *
 * Hubo tres casillas. Dos —catálogo y agendar visitas— no estaban conectadas a
 * nada: se guardaban y se dibujaban, pero el pedido a OpenAI nunca las miraba.
 * Se sacaron. Queda la única que hace algo de verdad, con la explicación al
 * lado para que se entienda qué pasa al prenderla.
 */
const TOOL_LABELS: Record<keyof AgentConfig["tools"], { label: string; hint: string }> = {
  handoff_to_human: {
    label: "Derivar a una persona",
    hint: "Si el lead pide un humano o pregunta algo que el agente no puede resolver, le avisa, frena la IA para ese contacto y deja el chat marcado como pendiente.",
  },
};

/** Lo editado y todavía sin guardar de un canal. */
type Borrador = {
  prompt: string;
  modelVersion: string;
  tools: AgentConfig["tools"];
  demora: string;
  horario: HorarioDelAgente;
  aviso: string;
};

/**
 * Los borradores viven fuera de React, a propósito.
 *
 * El panel se monta con `{view === "Agentes IA" && <AgentsPanel />}`: pasar a
 * Chats y volver lo desmonta y se lleva puesto todo lo cambiado sin siquiera un
 * aviso, que es la peor forma de perder trabajo porque no se nota hasta que ya
 * pasó.
 *
 * El módulo sobrevive al desmontaje mientras no se recargue la página, así que
 * alcanza un Map acá arriba. Para la recarga está el aviso de `beforeunload`:
 * guardar el borrador en el navegador taparía para siempre lo que otra persona
 * haya cambiado en el mismo canal, y eso es peor que preguntar antes de salir.
 */
const borradores = new Map<Channel, Borrador>();

/** Canales con cambios sin guardar. Lo mira el aviso de salida. */
const sucios = new Set<Channel>();

/**
 * Configuración del agente de cada canal.
 *
 * La tabla `ai_agent_configs` existía desde el esquema inicial pero no tenía
 * interfaz. Los canales sin fila se muestran igual, con valores por defecto: la
 * fila se crea recién al guardar.
 */
export function AgentsPanel({
  pipelines,
  stages,
  onNotice,
}: {
  pipelines: PipelineRow[];
  stages: StageRow[];
  onNotice: (message: string) => void;
}) {
  const [agents, setAgents] = useState<AgentConfig[] | null>(null);
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    loadAgentConfigs().then((result) => {
      if (!active) return;
      if (result.ok) setAgents(result.agents);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);

  // Los modelos se consultan en vivo a la cuenta de OpenAI: así el desplegable
  // nunca ofrece uno que la cuenta no tenga. Si la consulta falla, el campo
  // pasa a ser texto libre en vez de bloquear la pantalla.
  useEffect(() => {
    let active = true;
    loadChatModels().then((result) => {
      if (active && result.ok) setModels(result.models);
    });
    return () => {
      active = false;
    };
  }, []);

  // Cerrar la pestaña sí se lleva los borradores, porque el módulo se va con
  // ella. El navegador muestra su propio cartel; el texto no se puede elegir.
  useEffect(() => {
    const avisar = (event: BeforeUnloadEvent) => {
      if (sucios.size > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, []);

  /**
   * Deja en la lista lo que se acaba de guardar.
   *
   * Sin esto el encabezado seguía leyendo la fila que vino del servidor: se
   * cargaban las instrucciones, se guardaban bien, y la tarjeta seguía diciendo
   * "Sin instrucciones todavía" hasta recargar la página. Parecía que no se
   * había guardado nada.
   */
  const alGuardar = (guardado: AgentConfig) =>
    setAgents((current) =>
      (current ?? []).map((agent) => (agent.channel === guardado.channel ? guardado : agent)),
    );

  if (error) {
    return (
      <Card className="p-5 sm:p-6">
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    );
  }

  if (!agents) {
    return (
      <Card className="p-5 sm:p-6">
        <p className="text-sm text-neutral-500">Cargando la configuración…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <AgentForm
          key={agent.channel}
          agent={agent}
          models={models}
          pipelines={pipelines}
          stages={stages}
          onNotice={onNotice}
          onSaved={alGuardar}
        />
      ))}
    </div>
  );
}

function AgentForm({
  agent,
  models,
  pipelines,
  stages,
  onNotice,
  onSaved,
}: {
  agent: AgentConfig;
  models: string[];
  pipelines: PipelineRow[];
  stages: StageRow[];
  onNotice: (message: string) => void;
  onSaved: (agent: AgentConfig) => void;
}) {
  const borrador = borradores.get(agent.channel);

  const [prompt, setPrompt] = useState(borrador?.prompt ?? agent.systemPrompt);
  const [modelVersion, setModelVersion] = useState(borrador?.modelVersion ?? agent.modelVersion);
  const [tools, setTools] = useState(borrador?.tools ?? agent.tools);
  // La demora es texto y no número: un input numérico controlado no deja
  // borrar el campo para escribir otra cifra, porque el "" intermedio no es un
  // número.
  const [demora, setDemora] = useState(borrador?.demora ?? String(agent.replyDelaySeconds));
  const [horario, setHorario] = useState<HorarioDelAgente>(borrador?.horario ?? agent.horario);
  const [aviso, setAviso] = useState(borrador?.aviso ?? agent.avisoFueraDeHorario);
  const [embudos, setEmbudos] = useState<string[]>(agent.pipelineIds);
  const [movimientos, setMovimientos] = useState<ReglaDeMovimiento[]>(agent.movimientos);
  const [frenarConPersona, setFrenarConPersona] = useState(agent.pauseOnHumanReply);
  const [enabled, setEnabled] = useState(agent.enabled);
  // Al entrar los canales quedan plegados: la pantalla se lee de un vistazo y
  // cada uno se abre cuando se lo va a configurar. La excepción es un canal con
  // borrador, que se abre solo: si quedó a medio escribir, esconderlo es la
  // forma más rápida de que se pierda igual.
  const [abierto, setAbierto] = useState(borrador !== undefined);
  const [recienGuardado, setRecienGuardado] = useState(false);
  const [pending, startTransition] = useTransition();

  const segundos = Number(demora);
  const errorDemora = demora.trim() ? errorDeDemora(segundos) : "Falta la demora.";
  const errorHorario = errorDeHorario(horario);
  const errorAviso = errorDeAviso(aviso);
  const errorPrompt = errorDePrompt(prompt);

  const sinGuardar =
    prompt.trim() !== agent.systemPrompt.trim() ||
    modelVersion !== agent.modelVersion ||
    tools.handoff_to_human !== agent.tools.handoff_to_human ||
    segundos !== agent.replyDelaySeconds ||
    frenarConPersona !== agent.pauseOnHumanReply ||
    !mismoHorario(horario, agent.horario) ||
    aviso.trim() !== agent.avisoFueraDeHorario.trim() ||
    embudos.length !== agent.pipelineIds.length ||
    embudos.some((id) => !agent.pipelineIds.includes(id)) ||
    !mismosMovimientos(movimientos, agent.movimientos);

  // El borrador se guarda en cada cambio y se limpia cuando el formulario
  // vuelve a coincidir con lo guardado: así deshacer a mano también desarma el
  // aviso de salida.
  useEffect(() => {
    if (sinGuardar) {
      borradores.set(agent.channel, { prompt, modelVersion, tools, demora, horario, aviso });
      sucios.add(agent.channel);
    } else {
      borradores.delete(agent.channel);
      sucios.delete(agent.channel);
    }
  }, [sinGuardar, agent.channel, prompt, modelVersion, tools, demora, horario, aviso]);

  // La confirmación se apaga sola. El timer se limpia al desmontar para no
  // tocar el estado de un componente que ya no está.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // El interruptor se guarda solo, sin pasar por "Guardar": si alguien lo
  // apaga porque el agente está diciendo cualquier cosa, tiene que cortar ya.
  const toggleAgent = () => {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setAgentEnabled({ channel: agent.channel, enabled: next });
      if (result.ok) {
        onSaved({ ...agent, enabled: next });
        onNotice(
          next
            ? `El agente de ${CHANNEL_LABELS[agent.channel]} vuelve a responder.`
            : `El agente de ${CHANNEL_LABELS[agent.channel]} quedó apagado.`,
        );
      } else {
        setEnabled(!next);
        onNotice(result.error);
      }
    });
  };

  const toggle = (key: keyof AgentConfig["tools"]) =>
    setTools((current) => ({ ...current, [key]: !current[key] }));

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAgentConfig({
        channel: agent.channel,
        systemPrompt: prompt,
        modelVersion,
        tools,
        replyDelaySeconds: segundos,
        pipelineIds: embudos,
        movimientos,
        pauseOnHumanReply: frenarConPersona,
        horario,
        avisoFueraDeHorario: aviso,
      });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      // Lo guardado pasa a ser lo actual: el encabezado se pone al día y el
      // formulario deja de figurar como sin guardar, sin recargar nada.
      onSaved({
        ...agent,
        // Recortado, igual que lo guarda el servidor.
        systemPrompt: prompt.trim(),
        modelVersion,
        tools,
        replyDelaySeconds: segundos,
        pipelineIds: embudos,
        movimientos,
        pauseOnHumanReply: frenarConPersona,
        horario,
        // Lo que se guardó es el texto recortado: si no, el formulario quedaría
        // "sin guardar" para siempre por un espacio al final.
        avisoFueraDeHorario: aviso.trim(),
      });
      setRecienGuardado(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRecienGuardado(false), 2600);
    });
  };

  const panelId = `agente-${agent.channel}`;
  // El primer error de las reglas de movimiento, que frena el guardado igual que
  // los otros tres. Se calcula acá y no adentro del componente de la sección
  // porque el botón Guardar vive afuera. Es la misma función que valida la
  // action: así el panel avisa mientras se edita en vez de rechazar al guardar.
  const errorMovimientos = errorDeLasReglas(movimientos);

  const puedeGuardar =
    sinGuardar &&
    !errorPrompt &&
    !errorDemora &&
    !errorHorario &&
    !errorAviso &&
    !errorMovimientos &&
    !pending;

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={save}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAbierto((value) => !value)}
            aria-expanded={abierto}
            aria-controls={panelId}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                enabled
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-neutral-100 text-neutral-400 dark:bg-white/10"
              }`}
            >
              {enabled ? <Bot className="size-5" /> : <BotOff className="size-5" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{CHANNEL_LABELS[agent.channel]}</span>
                {sinGuardar && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                    Sin guardar
                  </span>
                )}
                {recienGuardado && !sinGuardar && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" />
                    Guardado
                  </span>
                )}
              </span>
              <span className="block truncate text-sm text-neutral-500">
                {resumen(agent, enabled)}
              </span>
            </span>
            <ChevronDown
              className={`ml-auto size-4 shrink-0 text-neutral-400 transition-transform ${
                abierto ? "rotate-180" : ""
              }`}
            />
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`Agente de ${CHANNEL_LABELS[agent.channel]}`}
            disabled={pending}
            onClick={toggleAgent}
            className={`flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors disabled:cursor-not-allowed ${
              enabled ? "bg-amber-500" : "bg-neutral-300 dark:bg-white/20"
            }`}
          >
            <span
              className={`size-5 rounded-full bg-[#f9f8f3] shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {abierto && (
          <div id={panelId} className="mt-5 border-t border-neutral-100 pt-5 dark:border-white/10">
            {!enabled && (
              <p className="mb-4 rounded-xl bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500 dark:bg-white/[.04]">
                Con el agente apagado podés seguir editando las instrucciones: se guardan igual y
                entran en vigencia cuando lo vuelvas a prender.
              </p>
            )}

            <Instrucciones channel={agent.channel} texto={prompt} onChange={setPrompt} />

            <DemoraField
              channel={agent.channel}
              value={demora}
              onChange={setDemora}
              error={errorDemora}
            />

            <div className="mt-5 sm:max-w-xs">
              <label className="block text-sm font-medium" htmlFor={`model-${agent.channel}`}>
                Modelo
              </label>
              {models.length > 0 ? (
                <select
                  id={`model-${agent.channel}`}
                  value={modelVersion}
                  onChange={(event) => setModelVersion(event.target.value)}
                  className={`${INPUT_CLASS} mt-2 cursor-pointer`}
                >
                  {/* El guardado puede no estar en la lista: se agrega para no perderlo. */}
                  {!models.includes(modelVersion) && (
                    <option value={modelVersion}>{modelVersion}</option>
                  )}
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    id={`model-${agent.channel}`}
                    value={modelVersion}
                    onChange={(event) => setModelVersion(event.target.value)}
                    className={`${INPUT_CLASS} mt-2`}
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    No se pudo consultar la lista de modelos: revisá que OPENAI_API_KEY esté
                    cargada en el entorno.
                  </p>
                </>
              )}
            </div>

            {/* El recorte por embudo se ofrece recién con el segundo: con uno
                solo, "contestá en todos" y "contestá en el único" son lo
                mismo, y la casilla sólo agrega una decisión que no existe. */}
            {pipelines.length > 1 && (
              <fieldset className="mt-5">
                <legend className="text-sm font-medium">En qué embudos contesta</legend>
                <p className="mt-1 text-xs text-neutral-500">
                  Sin marcar ninguno contesta en todos. El agente que califica leads de
                  ventas no tiene nada que decirle a alguien que ya está en posventa.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pipelines.map((pipeline) => {
                    const marcado = embudos.includes(pipeline.id);
                    return (
                      <label
                        key={pipeline.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                          marcado
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-400/10"
                            : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() =>
                            setEmbudos((actuales) =>
                              marcado
                                ? actuales.filter((id) => id !== pipeline.id)
                                : [...actuales, pipeline.id],
                            )
                          }
                          className="size-4 cursor-pointer accent-amber-500"
                        />
                        {pipeline.name}
                      </label>
                    );
                  })}
                </div>
                {embudos.length === 0 && (
                  <p className="mt-2 text-xs text-neutral-500">
                    Ahora contesta en todos los embudos.
                  </p>
                )}
              </fieldset>
            )}

            <HorarioField
              channel={agent.channel}
              horario={horario}
              onChange={setHorario}
              error={errorHorario}
              aviso={aviso}
              onAvisoChange={setAviso}
              errorAviso={errorAviso}
            />

            <fieldset className="mt-5">
              <legend className="text-sm font-medium">Cuándo se corre</legend>
              <label className="mt-2 flex cursor-pointer gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={frenarConPersona}
                  onChange={() => setFrenarConPersona((actual) => !actual)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-500"
                />
                <span>
                  <span className="font-medium">Frenar la IA si escribe una persona</span>
                  <span className="block text-xs text-neutral-500">
                    Apenas alguien del equipo manda un mensaje en el chat, la IA de ese
                    contacto se apaga y queda apagada hasta que alguien la vuelva a prender
                    desde la ficha del lead. Sin esto, el agente le sigue escribiendo encima
                    al lead mientras el vendedor lo atiende.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium">Herramientas</legend>
              <div className="mt-2 space-y-2">
                {(Object.keys(TOOL_LABELS) as (keyof AgentConfig["tools"])[]).map((key) => (
                  <label key={key} className="flex cursor-pointer gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={tools[key]}
                      onChange={() => toggle(key)}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-500"
                    />
                    <span>
                      <span className="font-medium">{TOOL_LABELS[key].label}</span>
                      <span className="block text-xs text-neutral-500">
                        {TOOL_LABELS[key].hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <MovimientosField
              channel={agent.channel}
              stages={stages}
              reglas={movimientos}
              onChange={setMovimientos}
              error={errorMovimientos}
              guardado={agent.id !== null}
            />

            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button disabled={!puedeGuardar} type="submit" className={PRIMARY_BUTTON_CLASS}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
              {/* Un botón apagado que no dice por qué es peor que no tenerlo:
                  el motivo va al lado y no en un aviso al apretarlo. */}
              <p
                className={`text-xs ${
                  errorDemora || errorHorario || errorAviso || errorMovimientos
                    ? "text-red-600 dark:text-red-400"
                    : "text-neutral-500"
                }`}
              >
                {errorDemora ??
                  errorHorario ??
                  errorAviso ??
                  errorMovimientos ??
                  (sinGuardar ? "Hay cambios sin guardar." : "Todo guardado.")}
              </p>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}

/**
 * Las instrucciones del agente, escritas acá mismo.
 *
 * Son todo lo que el agente sabe del negocio y de cómo hablar: viajan enteras en
 * cada respuesta. Vacías, el agente no contesta aunque esté prendido, que es el
 * freno para que no empiece a hablar solo apenas se carga la API key.
 *
 * El contador mide la plata, no sólo un límite: el prompt entero se paga una vez
 * por mensaje contestado.
 */
function Instrucciones({
  channel,
  texto,
  onChange,
}: {
  channel: Channel;
  texto: string;
  onChange: (texto: string) => void;
}) {
  const id = `prompt-${channel}`;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={id}>
          Instrucciones
        </label>
        {!texto.trim() && (
          <button
            type="button"
            onClick={() => onChange(PLANTILLA_DE_INSTRUCCIONES)}
            className="cursor-pointer text-xs font-medium text-amber-700 hover:underline dark:text-amber-300"
          >
            Empezar con una plantilla
          </button>
        )}
      </div>

      <p className="mt-1 text-xs leading-5 text-neutral-500">
        {texto.trim()
          ? `Es todo lo que el agente de ${CHANNEL_LABELS[channel]} sabe de tu negocio y de cómo tiene que hablar. Si está diciendo algo que hay que frenar ya, apagalo con el interruptor de arriba.`
          : "Este canal todavía no tiene instrucciones, así que el agente no responde aunque esté prendido. Escribilas acá o empezá con la plantilla y completá lo que está entre corchetes."}
      </p>

      <textarea
        id={id}
        value={texto}
        onChange={(event) => onChange(event.target.value)}
        rows={texto.trim() ? 14 : 4}
        // El `maxLength` del navegador va bastante arriba del tope real: cortar
        // el tipeo sin decir nada confunde. Se puede pasar, el contador dice
        // cuánto sobra y el botón de guardar espera.
        maxLength={MAX_SYSTEM_PROMPT_CHARS * 2}
        spellCheck
        placeholder="Ej: Sos el asistente de [tu negocio]. Tu objetivo es…"
        className={`${INPUT_CLASS} mt-2 min-h-24 resize-y font-mono text-xs leading-5`}
      />

      <PromptCounter length={texto.trim().length} />
    </section>
  );
}

/** Lo que dice la tarjeta cerrada. Es lo único que se ve sin abrirla. */
function resumen(agent: AgentConfig, enabled: boolean): string {
  if (!enabled) return "Apagado: no responde a nadie";
  if (!agent.systemPrompt.trim()) return "Sin instrucciones todavía";
  // El horario va en el encabezado y no escondido adentro: un agente que no
  // contestó a las 3 AM porque así se configuró y uno que no contestó porque
  // algo falló se ven igual desde el chat, y éste es el único lugar donde la
  // diferencia se puede leer sin abrir nada.
  if (contestaSiempre(agent.horario)) {
    return `Responde solo, a los ${agent.replyDelaySeconds} segundos`;
  }
  return `Responde ${describirHorario(agent.horario)}, a los ${agent.replyDelaySeconds} segundos`;
}

/** Dos horarios son el mismo si contestan los mismos días en las mismas franjas. */
function mismoHorario(uno: HorarioDelAgente, otro: HorarioDelAgente): boolean {
  if (uno.excluye !== otro.excluye) return false;
  if (uno.dias.length !== otro.dias.length) return false;
  if (!uno.dias.every((dia) => otro.dias.includes(dia))) return false;
  if (uno.franjas.length !== otro.franjas.length) return false;
  return uno.franjas.every(
    (franja, i) => franja.desde === otro.franjas[i].desde && franja.hasta === otro.franjas[i].hasta,
  );
}

/**
 * La franja que se propone al agregar una más.
 *
 * Arranca dos horas después de que cierra la última y dura cuatro, que es el
 * corte de siesta de cualquier comercio. Si no queda lugar en el día devuelve
 * null y el botón no se ofrece: proponer una franja invertida sería ofrecer un
 * error.
 */
function franjaSiguiente(franjas: Franja[]): Franja | null {
  const ultima = franjas[franjas.length - 1];
  if (!ultima) return JORNADA;


  const desde = ultima.hasta + 120;
  const hasta = Math.min(desde + 240, MINUTOS_DEL_DIA);
  return desde < hasta ? { desde, hasta } : null;
}

/**
 * Los días, de lunes a domingo.
 *
 * Arranca en lunes y no en domingo —que es el 0— porque así se lee una semana
 * de trabajo. El valor sí es el de `Date.getDay()`, que es lo que se guarda.
 */
const DIAS: { valor: number; letra: string; nombre: string }[] = [
  { valor: 1, letra: "L", nombre: "lunes" },
  { valor: 2, letra: "M", nombre: "martes" },
  { valor: 3, letra: "M", nombre: "miércoles" },
  { valor: 4, letra: "J", nombre: "jueves" },
  { valor: 5, letra: "V", nombre: "viernes" },
  { valor: 6, letra: "S", nombre: "sábado" },
  { valor: 0, letra: "D", nombre: "domingo" },
];

/**
 * El horario en el que el agente contesta.
 *
 * Son los mismos días y la misma franja que los turnos del reparto de leads, y
 * se cargan igual, porque es la misma pregunta hecha sobre otra cosa.
 *
 * La casilla de "todo el día" mira las horas y no `esTodoElDia`: una franja
 * invertida —abrir a las 18 y cerrar a las 2— también se lee como todo el día,
 * y si la casilla se marcara sola al escribirla, los dos campos desaparecerían
 * con lo que la persona acababa de cargar adentro. Así quedan a la vista con el
 * error al lado, que es lo que explica por qué eso no se puede guardar.
 */
function HorarioField({
  channel,
  horario,
  onChange,
  error,
  aviso,
  onAvisoChange,
  errorAviso,
}: {
  channel: Channel;
  horario: HorarioDelAgente;
  onChange: (horario: HorarioDelAgente) => void;
  error: string | null;
  aviso: string;
  onAvisoChange: (aviso: string) => void;
  errorAviso: string | null;
}) {
  // Sin franjas no hay recorte de horas, y eso es "todo el día". Se mira la lista
  // y no `esTodoElDia`, que además da true con una franja invertida: si la
  // casilla se marcara sola al escribir una, los campos desaparecerían con lo
  // que la persona acababa de cargar adentro. Así quedan a la vista con el error
  // al lado, que es lo que explica por qué eso no se puede guardar.
  const todoElDia = horario.franjas.length === 0;
  const siguiente = franjaSiguiente(horario.franjas);
  const jornada = horario.excluye ? SIESTA : JORNADA;

  const cambiarFranja = (indice: number, franja: Franja) =>
    onChange({
      ...horario,
      franjas: horario.franjas.map((actual, i) => (i === indice ? franja : actual)),
    });

  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-medium">Horario</legend>

      {/* Las mismas franjas, leídas al derecho o al revés. El agente de IA casi
          siempre arranca contestando a toda hora, así que lo que se quiere
          cargar es la excepción —"menos de 13 a 16"— y escribirla como lista
          blanca obliga al complemento: de 00 a 13 y de 16 a 24. */}
      <div className="mt-2 flex flex-wrap gap-2">
        <Opcion elegida={!horario.excluye} onClick={() => onChange({ ...horario, excluye: false })}>
          Contesta solo en
        </Opcion>
        <Opcion elegida={horario.excluye} onClick={() => onChange({ ...horario, excluye: true })}>
          No contesta en
        </Opcion>
      </div>

      <p className="mt-2 text-xs leading-5 text-neutral-500">
        {horario.excluye
          ? "Lo que marques es cuándo el agente se calla; el resto del tiempo contesta."
          : "Lo que marques es cuándo el agente contesta; el resto del tiempo se calla."}{" "}
        Cuando no contesta, el mensaje queda en la bandeja sin responder, para que lo atienda una
        persona: no se guarda para contestarlo más tarde. Las horas son las de la zona horaria del
        equipo, la que está en Configuración.
      </p>

      <div className="mt-2.5 flex flex-wrap items-end gap-3">
        <div>
          <span className="block text-xs font-medium text-neutral-500">Días</span>
          <div className="mt-1.5 flex gap-1">
            {DIAS.map((dia) => {
              const puesto = horario.dias.includes(dia.valor);
              return (
                <button
                  key={dia.valor}
                  type="button"
                  aria-pressed={puesto}
                  aria-label={dia.nombre}
                  onClick={() =>
                    onChange({
                      ...horario,
                      dias: puesto
                        ? horario.dias.filter((valor) => valor !== dia.valor)
                        : [...horario.dias, dia.valor].sort((a, b) => a - b),
                    })
                  }
                  className={`size-8 cursor-pointer rounded-lg border text-sm transition-colors ${
                    puesto
                      ? "border-transparent bg-amber-500 font-medium text-neutral-950"
                      : "border-[#ddd8c9] text-neutral-500 hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
                  }`}
                >
                  {dia.letra}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={todoElDia}
            onChange={(event) =>
              onChange({ ...horario, franjas: event.target.checked ? [] : [jornada] })
            }
            className="size-4 cursor-pointer accent-amber-500"
          />
          Todo el día
        </label>
      </div>

      {!todoElDia && (
        <div className="mt-2.5 space-y-2">
          {horario.franjas.map((franja, indice) => (
            // La clave es el índice porque las franjas no tienen id: son dos
            // números que se editan en el lugar, y reordenarlas no es una acción
            // de este formulario —se guardan ordenadas al salir—.
            <div key={indice} className="flex flex-wrap items-end gap-3">
              <Hora
                minutos={franja.desde}
                onChange={(desde) => cambiarFranja(indice, { ...franja, desde })}
                etiqueta={indice === 0 ? "Desde" : "Y desde"}
              />
              <Hora
                minutos={franja.hasta}
                onChange={(hasta) => cambiarFranja(indice, { ...franja, hasta })}
                etiqueta="Hasta"
              />
              {/* Sacar la única franja es lo mismo que marcar "todo el día", y
                  ahí está esa casilla: el tacho aparece recién con la segunda,
                  que es cuando sacar una significa algo distinto. */}
              {horario.franjas.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...horario,
                      franjas: horario.franjas.filter((_, i) => i !== indice),
                    })
                  }
                  aria-label={`Sacar la franja de ${horaEnTexto(franja.desde)} a ${horaEnTexto(franja.hasta)}`}
                  className="mb-1.5 cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}

          {horario.franjas.length < MAX_FRANJAS && siguiente && (
            <button
              type="button"
              onClick={() => onChange({ ...horario, franjas: [...horario.franjas, siguiente] })}
              className="cursor-pointer text-xs font-medium text-amber-700 hover:underline dark:text-amber-300"
            >
              + Agregar franja
            </button>
          )}
        </div>
      )}

      <p
        className={`mt-2 text-xs leading-5 ${
          error ? "text-red-600 dark:text-red-400" : "text-neutral-500"
        }`}
      >
        {error ?? `Contesta ${describirHorario(horario)}.`}
        {!error && horario.excluye && horario.franjas.length === 0 && " Esos días no atiende."}
        {/* Ningún día marcado se lee como todos y no como ninguno: un agente
            prendido y mudo es la falla más difícil de notar. Para que no hable
            está el interruptor de arriba, que además lo dice en la tarjeta. */}
        {!error &&
          horario.dias.length === 0 &&
          (horario.excluye
            ? " Sin ningún día marcado, la excepción corre todos los días."
            : " Sin ningún día marcado contesta todos los días.")}
      </p>

      {/* El aviso sólo aparece con un horario que recorte algo: un agente que
          contesta siempre no tiene cuándo mandarlo, y el campo sería una
          decisión que no existe. Lo ya cargado se guarda igual si después se
          vuelve a "todos los días, a toda hora". */}
      {!contestaSiempre(horario) && (
        <Aviso
          channel={channel}
          valor={aviso}
          onChange={onAvisoChange}
          error={errorAviso}
          horario={horario}
        />
      )}
    </fieldset>
  );
}

/**
 * El mensaje que sale cuando llega algo fuera de horario.
 *
 * Vacío es apagado, y es como nace: fuera de horario no sale nada y el mensaje
 * espera en la bandeja. Se ofrece porque del otro lado el silencio no se
 * distingue de un número que no existe: quien no sabe si lo leyeron escribe de
 * nuevo, o se va a la competencia.
 *
 * Es un texto fijo y no una respuesta del modelo a propósito, y el texto de
 * ayuda lo dice: a esa hora lo único honesto que se puede decir es cuándo se
 * atiende. Un modelo contestando de madrugada vuelve a prometer reuniones de
 * gente que no está, y ahora con el agravante de que nadie va a leer ese chat
 * hasta la mañana.
 */
function Aviso({
  channel,
  valor,
  onChange,
  error,
  horario,
}: {
  channel: Channel;
  valor: string;
  onChange: (valor: string) => void;
  error: string | null;
  horario: HorarioDelAgente;
}) {
  const id = `aviso-${channel}`;

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium" htmlFor={id}>
        Aviso fuera de horario <span className="font-normal text-neutral-500">(opcional)</span>
      </label>
      <p className="mt-1 text-xs leading-5 text-neutral-500">
        Lo que se le manda al contacto cuando escribe fuera del horario. Sale una sola vez por
        charla: si vuelve a escribir esa misma noche no se repite. Vacío no manda nada.
      </p>
      <textarea
        id={id}
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        // El `maxLength` del navegador va al doble del tope real: cortar el
        // tipeo en 300 sin decir nada es el silencio que ya se corrigió en el
        // contador de instrucciones. Acá se puede pasar, se ve por qué, y el
        // botón de guardar espera a que se acomode.
        maxLength={MAX_AVISO_CHARS * 2}
        placeholder={
          horario.excluye
            ? "Ej: ¡Hola! Ahora no estamos atendiendo. Te contestamos en cuanto volvamos."
            : `Ej: ¡Hola! Te leemos ${describirHorario(horario)}. Te contestamos en cuanto abramos.`
        }
        aria-invalid={error !== null}
        className={`${INPUT_CLASS} mt-2 ${error ? "border-red-400 dark:border-red-500/50" : ""}`}
      />
      <p
        className={`mt-1 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}
      >
        {error ??
          (valor.trim()
            ? `${valor.length} de ${MAX_AVISO_CHARS} caracteres. Es un texto fijo: no lo escribe el modelo, así que no promete nada que el equipo no haya escrito.`
            : "Sin aviso, el mensaje queda en la bandeja y el contacto no recibe nada.")}
      </p>
    </div>
  );
}

/**
 * Demoras de uso corriente.
 *
 * Están porque un campo suelto le pide un número a alguien que no tiene cómo
 * saber qué número poner. Tres opciones se eligen sin pensar; el que igual
 * quiere un valor exacto lo carga a mano con "Otro".
 */
const PRESETS = [
  { label: "Rápido", segundos: 3 },
  { label: "Normal", segundos: 5 },
  { label: "Pausado", segundos: 10 },
];

/**
 * Cuánto tarda el agente en contestar.
 *
 * Un solo número, porque lo que se quiere contestar es "¿cuánto tarda?". El
 * mínimo y el máximo son los límites de lo que se puede cargar y se leen al
 * lado del campo: no son dos cosas más para completar.
 *
 * La vista previa no es decorativa. Esta espera es también la ventana en la que
 * se juntan los mensajes sueltos de una ráfaga, así que quien la toca está
 * tocando dos cosas a la vez y tiene que verlo antes de bajarla al piso para
 * que el agente "responda más rápido".
 */
function DemoraField({
  channel,
  value,
  onChange,
  error,
}: {
  channel: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const segundos = Number(value);
  // Arranca a mano si lo guardado no coincide con ningún preset: si no, el
  // valor real no se vería por ningún lado.
  const [aMano, setAMano] = useState(!PRESETS.some((preset) => preset.segundos === segundos));
  const errorId = `demora-error-${channel}`;

  return (
    <div className="mt-5">
      <span className="block text-sm font-medium">Demora antes de responder</span>

      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Opcion
            key={preset.label}
            elegida={!aMano && segundos === preset.segundos}
            onClick={() => {
              setAMano(false);
              onChange(String(preset.segundos));
            }}
          >
            {preset.label}
            <span className="ml-1.5 text-neutral-500">{preset.segundos}s</span>
          </Opcion>
        ))}
        <Opcion elegida={aMano} onClick={() => setAMano(true)}>
          Otro
        </Opcion>
      </div>

      {aMano && (
        <div className="relative mt-2 sm:max-w-[12rem]">
          <input
            id={`demora-${channel}`}
            type="number"
            inputMode="numeric"
            min={MIN_REPLY_DELAY_SECONDS}
            max={MAX_REPLY_DELAY_SECONDS}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Demora en segundos"
            aria-invalid={error !== null}
            aria-describedby={errorId}
            className={`${INPUT_CLASS} pr-20 ${error ? "border-red-400 dark:border-red-500/50" : ""}`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-neutral-500">
            segundos
          </span>
        </div>
      )}

      <p
        id={errorId}
        className={`mt-2 text-xs leading-5 ${
          error ? "text-red-600 dark:text-red-400" : "text-neutral-500"
        }`}
      >
        {error ??
          `Responde a los ${segundos} segundos. Lo que el contacto mande dentro de esos ${segundos} segundos se contesta junto, en una sola respuesta.`}
      </p>
      {!error && aMano && (
        <p className="mt-1 text-xs text-neutral-500">
          Entre {MIN_REPLY_DELAY_SECONDS} y {MAX_REPLY_DELAY_SECONDS} segundos.
        </p>
      )}
    </div>
  );
}

/** Uno de los botones de demora. `aria-pressed` porque es un grupo de elección. */
function Opcion({
  elegida,
  onClick,
  children,
}: {
  elegida: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      onClick={onClick}
      className={`cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors ${
        elegida
          ? "border-amber-500 bg-amber-50 font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
          : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Cuánto ocupan las instrucciones y qué implica.
 *
 * Está porque el tope viejo fallaba en silencio: escribías un prompt largo,
 * apretabas Guardar y volvía un "demasiado largas" sin número. Ahora el dato se
 * ve mientras escribís, con el costo a la vista: el prompt entero viaja en cada
 * respuesta del agente, así que un prompt gordo se paga una vez por mensaje.
 */
function PromptCounter({ length }: { length: number }) {
  const pasado = length > MAX_SYSTEM_PROMPT_CHARS;
  const pesado = length > SYSTEM_PROMPT_WARN_CHARS;

  return (
    <p
      className={`mt-1.5 text-xs ${
        pasado ? "text-red-600 dark:text-red-400" : "text-neutral-500"
      }`}
    >
      {length.toLocaleString("es-AR")} de {MAX_SYSTEM_PROMPT_CHARS.toLocaleString("es-AR")}{" "}
      caracteres
      {pasado && ` · sacá ${(length - MAX_SYSTEM_PROMPT_CHARS).toLocaleString("es-AR")} para poder guardar`}
      {!pasado && pesado &&
        ` · son unos ${aproxTokens(length).toLocaleString("es-AR")} tokens que se pagan en cada respuesta`}
    </p>
  );
}

/**
 * Si dos listas de reglas dicen lo mismo.
 *
 * El id no se compara: una regla recién agregada en la pantalla todavía no tiene
 * el de la base. Lo que define si hay cambios sin guardar es qué movimiento
 * describe cada regla, no con qué fila se escribió.
 */
function mismosMovimientos(a: ReglaDeMovimiento[], b: ReglaDeMovimiento[]): boolean {
  if (a.length !== b.length) return false;
  const clave = (regla: ReglaDeMovimiento) =>
    `${regla.desdeStageId ?? ""}>${regla.stageId}|${regla.activo ? 1 : 0}|${regla.criterio.trim()}`;
  const ordenadas = (reglas: ReglaDeMovimiento[]) => reglas.map(clave).sort();
  return ordenadas(a).every((item, i) => item === ordenadas(b)[i]);
}

/** Un id para la regla nueva, que vive sólo en la pantalla hasta que se guarda. */
let nuevaRegla = 0;

/**
 * Con qué criterio el agente mueve la tarjeta de columna.
 *
 * El criterio es texto libre y no una lista de condiciones porque lo que decide
 * no es el CRM sino el modelo, leyendo la conversación. Qué significa
 * "Calificado" en este negocio sólo lo sabe quien vende, y escribirlo en una
 * línea es más honesto que armarlo con tres desplegables que nunca van a
 * alcanzar.
 *
 * Ganado y Perdido no se ofrecen. De esas columnas cuelgan las métricas y la
 * conversión de Meta: un cierre que el agente dedujo mal no se arregla moviendo
 * la tarjeta para atrás. La base lo rechaza igual, por si alguna vez alguien
 * recategoriza una columna que ya estaba elegida.
 */
function MovimientosField({
  channel,
  stages,
  reglas,
  onChange,
  error,
  guardado,
}: {
  channel: Channel;
  stages: StageRow[];
  reglas: ReglaDeMovimiento[];
  onChange: (reglas: ReglaDeMovimiento[]) => void;
  error: string | null;
  /** Si el canal ya tiene fila guardada. Sin eso no se puede probar. */
  guardado: boolean;
}) {
  const abiertas = stages.filter((stage) => stage.kind === "open");
  const varios = hayVariosEmbudos(stages);

  const cambiar = (indice: number, cambio: Partial<ReglaDeMovimiento>) =>
    onChange(reglas.map((regla, i) => (i === indice ? { ...regla, ...cambio } : regla)));

  const agregar = () => {
    nuevaRegla += 1;
    onChange([
      ...reglas,
      {
        id: `nueva-${nuevaRegla}`,
        stageId: abiertas[0]?.id ?? "",
        desdeStageId: null,
        criterio: "",
        activo: true,
      },
    ]);
  };

  // Sin columnas abiertas no hay movimiento posible, y una sección que ofrece
  // agregar una regla que no se va a poder guardar es peor que no estar.
  if (abiertas.length === 0) return null;

  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-medium">Movimientos de columna</legend>
      <p className="mt-1 text-xs text-neutral-500">
        El agente mueve la tarjeta cuando se cumple el criterio que escribas. Lee la
        conversación y deja en el chat el motivo de cada movimiento. Sin reglas no mueve
        nada. No puede mover a Ganado ni a Perdido.
      </p>

      <div className="mt-3 space-y-3">
        {reglas.map((regla, indice) => {
          const suyo = errorDeRegla(regla);
          return (
            <div
              key={regla.id}
              className="rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-500">Mover a</span>
                <select
                  value={regla.stageId}
                  onChange={(event) => cambiar(indice, { stageId: event.target.value })}
                  className={INPUT_CLASS}
                >
                  <OpcionesDeEtapa stages={abiertas} />
                </select>

                <span className="text-neutral-500">desde</span>
                <select
                  value={regla.desdeStageId ?? ""}
                  onChange={(event) =>
                    cambiar(indice, { desdeStageId: event.target.value || null })
                  }
                  className={INPUT_CLASS}
                >
                  {/* "Cualquiera" primero porque es el default, pero casi nunca es
                      lo que conviene: un criterio ya cumplido —"dijo su rubro"—
                      sigue siendo verdad para siempre, y sin columna de origen la
                      regla querría mover una tarjeta que ya pasó por ahí. */}
                  <option value="">cualquier columna</option>
                  <OpcionesDeEtapa stages={stages.filter((stage) => stage.id !== regla.stageId)} />
                </select>

                <button
                  type="button"
                  onClick={() => onChange(reglas.filter((_, i) => i !== indice))}
                  aria-label="Quitar la regla"
                  className="ml-auto cursor-pointer rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <textarea
                value={regla.criterio}
                onChange={(event) => cambiar(indice, { criterio: event.target.value })}
                rows={2}
                maxLength={MAX_CRITERIO_CHARS}
                placeholder="cuando ya dijo su rubro y cuántos vendedores tiene"
                className={`${INPUT_CLASS} mt-2 w-full`}
              />

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={regla.activo}
                    onChange={() => cambiar(indice, { activo: !regla.activo })}
                    className="size-3.5 cursor-pointer accent-amber-500"
                  />
                  Activa
                </label>
                <p
                  className={`text-xs ${
                    suyo ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                  }`}
                >
                  {suyo ?? `${regla.criterio.length} de ${MAX_CRITERIO_CHARS} caracteres`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {reglas.length < MAX_REGLAS && (
        <button
          type="button"
          onClick={agregar}
          className="mt-3 cursor-pointer rounded-xl border border-[#ddd8c9] px-3 py-2 text-sm transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          Agregar una regla
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {reglas.length > 0 && (
        <PruebaDeMovimientos
          channel={channel}
          stages={stages}
          varios={varios}
          guardado={guardado}
        />
      )}
    </fieldset>
  );
}

/**
 * Prueba las reglas guardadas contra una conversación pegada.
 *
 * Es lo que vuelve usable un criterio escrito en castellano: se ajusta en tres
 * intentos de treinta segundos en vez de esperar dos días a ver qué pasó con
 * leads de verdad. No mueve ninguna tarjeta, y usa la misma función que la
 * corrida real, así que lo que muestra es lo que va a hacer.
 *
 * Prueba lo guardado y no el borrador a propósito: si probara lo que está en
 * pantalla, el resultado no le correspondería a ningún lead.
 */
function PruebaDeMovimientos({
  channel,
  stages,
  varios,
  guardado,
}: {
  channel: Channel;
  stages: StageRow[];
  varios: boolean;
  guardado: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [conversacion, setConversacion] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const probar = () =>
    startTransition(async () => {
      setResultado(null);
      const salida = await probarMovimientoDelAgente({ channel, stageId, conversacion });

      if (!salida.ok) {
        setResultado(salida.error);
        return;
      }
      if (salida.evaluadas.length === 0) {
        setResultado(
          "Ninguna regla guardada aplica desde esa columna. Guardá los cambios o revisá el «desde».",
        );
        return;
      }
      setResultado(
        salida.movimiento
          ? `Movería la tarjeta a ${salida.movimiento.nombre}.${
              salida.movimiento.motivo ? ` Motivo: ${salida.movimiento.motivo}` : ""
            }`
          : "No movería la tarjeta: ningún criterio se cumple con esa conversación.",
      );
    });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 cursor-pointer text-xs text-amber-700 underline decoration-dotted dark:text-amber-300"
      >
        Probar con una conversación
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-neutral-50 p-3 dark:bg-white/5">
      <p className="text-xs text-neutral-500">
        Pegá una conversación, un mensaje por renglón. Los del equipo empiezan con
        «Vendedor:»; el resto se toma como lo que dijo la persona. No se mueve ninguna
        tarjeta: sólo dice qué haría con las reglas ya guardadas.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-500">La tarjeta está en</span>
        <select
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
          className={INPUT_CLASS}
        >
          <OpcionesDeEtapa stages={stages} />
        </select>
      </div>

      <textarea
        value={conversacion}
        onChange={(event) => setConversacion(event.target.value)}
        rows={4}
        placeholder={"Hola, vi el anuncio\nVendedor: ¡Hola! ¿A qué te dedicás?\nTengo una inmobiliaria, somos 4"}
        className={`${INPUT_CLASS} mt-2 w-full`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={probar}
          disabled={pending || !conversacion.trim() || !guardado}
          className="cursor-pointer rounded-xl border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
        >
          {pending ? "Probando…" : "Probar"}
        </button>
        {!guardado && (
          <p className="text-xs text-neutral-500">
            Guardá la configuración del canal antes de probar.
          </p>
        )}
      </div>

      {resultado && <p className="mt-2 text-xs">{resultado}</p>}

      {/* Sólo con varios embudos: el recorte existe siempre, pero con un embudo
          único no hay nada que aclarar. */}
      {varios && (
        <p className="mt-2 text-[11px] text-neutral-400">
          Las reglas sólo mueven dentro del embudo en el que está la tarjeta.
        </p>
      )}
    </div>
  );
}
