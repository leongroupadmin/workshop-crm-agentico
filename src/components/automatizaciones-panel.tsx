"use client";

import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  Mic,
  Plus,
  Trash2,
  Upload,
  Workflow,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  deleteAutomation,
  loadAutomations,
  loadTemplateCatalog,
  loadWorkspaceUsers,
  saveAutomation,
  setAutomationEnabled,
  uploadAutomationAudio,
  uploadAutomationAudioWav,
  type AutomatizacionesResult,
  type AutomatizacionRow,
  type WorkspaceUser,
} from "@/app/actions";
import {
  contarPasos,
  describirEspera,
  escribirRuta,
  MAX_CANDIDATOS,
  MAX_ETAPAS_DE_LA_PRUEBA,
  MAX_PASOS,
  MAX_PESO,
  MAX_PROFUNDIDAD,
  minutosPorRuta,
  MODOS_DE_REPARTO,
  pasoFueraDeLaVentana,
  peorDemora,
  TIPOS_DE_PRUEBA,
  TOKENS,
  validar,
  VENTANA_WHATSAPP_MINUTOS,
  type Candidato,
  type Disparador,
  type ModoDeReparto,
  type Paso,
  type Prueba,
  type Rama as TipoRama,
  type Ruta,
  type TipoDisparador,
  type TipoPaso,
  type TipoPrueba,
} from "@/lib/automatizaciones";
import type { StageRow } from "@/lib/crm-data";
import { EVENTOS_META, NOMBRE_DEL_EVENTO, type EventoMeta } from "@/lib/meta-eventos";
import { claveDe, faltantesDe, type Plantilla } from "@/lib/plantillas";
import {
  hayVariosEmbudos,
  nombreCompletoDeEtapa,
  OpcionesDeEtapa,
} from "@/components/opciones-de-etapa";
import { Lienzo } from "@/components/automatizaciones-lienzo";
import { Card, EmptyState, Hora, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import { VoiceRecorder } from "@/components/voice-recorder";
import { grabacionAWav } from "@/lib/audio/a-wav";

/* ------------------------------------------------------------------ duración */

type Unidad = "minutos" | "horas" | "dias";

const EN_MINUTOS: Record<Unidad, number> = { minutos: 1, horas: 60, dias: 1440 };

/** Elige la unidad más grande que deje un número entero: 1440 se lee "1 día". */
function partirDuracion(minutos: number): { valor: number; unidad: Unidad } {
  if (minutos > 0 && minutos % 1440 === 0) return { valor: minutos / 1440, unidad: "dias" };
  if (minutos > 0 && minutos % 60 === 0) return { valor: minutos / 60, unidad: "horas" };
  return { valor: minutos, unidad: "minutos" };
}

function Duracion({
  minutos,
  onChange,
}: {
  minutos: number;
  onChange: (minutos: number) => void;
}) {
  const { valor, unidad } = partirDuracion(minutos);

  return (
    <span className="flex gap-2">
      <input
        type="number"
        min={0}
        value={valor}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value)) * EN_MINUTOS[unidad])}
        className={`${INPUT_CLASS} w-24`}
        aria-label="Cantidad"
      />
      <select
        value={unidad}
        onChange={(event) => onChange(valor * EN_MINUTOS[event.target.value as Unidad])}
        className={`${INPUT_CLASS} w-32 cursor-pointer`}
        aria-label="Unidad"
      >
        <option value="minutos">minutos</option>
        <option value="horas">horas</option>
        <option value="dias">días</option>
      </select>
    </span>
  );
}

/* -------------------------------------------------------------------- panel */

export function AutomatizacionesPanel({
  stages,
  onNotice,
}: {
  stages: StageRow[];
  onNotice: (message: string) => void;
}) {
  const [automatizaciones, setAutomatizaciones] = useState<AutomatizacionRow[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [avisoPlantillas, setAvisoPlantillas] = useState("");
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<AutomatizacionRow | "nueva" | null>(null);
  const [guardando, empezarGuardado] = useTransition();

  const aplicar = useCallback(
    (result: AutomatizacionesResult) => {
      if (result.ok) setAutomatizaciones(result.automatizaciones);
      else onNotice(result.error);
      setCargando(false);
    },
    [onNotice],
  );

  // La carga se escribe con `.then` y no con await: el estado se toca en la
  // respuesta y no en el cuerpo del efecto, que es lo que dispara renders en
  // cascada.
  useEffect(() => {
    let activo = true;
    loadAutomations().then((result) => {
      if (activo) aplicar(result);
    });
    return () => {
      activo = false;
    };
  }, [aplicar]);

  /** Después de guardar, prender o borrar: la lista se vuelve a pedir entera. */
  const recargar = useCallback(async () => aplicar(await loadAutomations()), [aplicar]);

  // El catálogo se pide una sola vez: lo comparten todos los pasos de plantilla
  // de todas las automatizaciones que se editen en esta pantalla.
  useEffect(() => {
    let activo = true;
    loadTemplateCatalog().then((result) => {
      if (!activo) return;
      if (result.ok) setPlantillas(result.plantillas);
      else setAvisoPlantillas(result.error);
    });
    // Los usuarios son para el paso de reparto. Se piden acá junto con las
    // plantillas y no dentro del paso: un editor con tres repartos pediría la
    // misma lista tres veces.
    loadWorkspaceUsers().then((result) => {
      if (activo && result.ok) setUsers(result.users);
    });
    return () => {
      activo = false;
    };
  }, []);

  const prender = (fila: AutomatizacionRow, enabled: boolean) => {
    empezarGuardado(async () => {
      const result = await setAutomationEnabled({ id: fila.id, enabled });
      if (!result.ok) onNotice(result.error);
      await recargar();
    });
  };

  const borrar = (fila: AutomatizacionRow) => {
    if (!window.confirm(`¿Borrar "${fila.name}"? Se cortan las corridas en camino.`)) return;
    empezarGuardado(async () => {
      const result = await deleteAutomation({ id: fila.id });
      if (!result.ok) onNotice(result.error);
      await recargar();
    });
  };

  if (editando) {
    return (
      <Editor
        inicial={editando === "nueva" ? null : editando}
        stages={stages}
        plantillas={plantillas}
        avisoPlantillas={avisoPlantillas}
        users={users}
        onCancelar={() => setEditando(null)}
        onGuardado={async () => {
          setEditando(null);
          await recargar();
        }}
        onNotice={onNotice}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Automatizaciones</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Un disparador, una espera y una secuencia. Sirven para lo que se hace siempre igual: el
            seguimiento del presupuesto, la bienvenida, el lead que se enfrió.
          </p>
        </div>
        <button type="button" onClick={() => setEditando("nueva")} className={PRIMARY_BUTTON_CLASS}>
          <Plus className="size-4" />
          Nueva
        </button>
      </div>

      {cargando && <p className="text-sm text-neutral-500">Cargando…</p>}

      {!cargando && automatizaciones.length === 0 && (
        <EmptyState
          icon={Workflow}
          title="Todavía no hay ninguna"
          description="Creá la primera y va a quedar apagada hasta que la prendas vos."
        />
      )}

      <div className="grid gap-3">
        {automatizaciones.map((fila) => (
          <Card key={fila.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold">
                  {fila.name}
                  {fila.enCurso > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {fila.enCurso} en curso
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  {describirDisparador(fila.disparador, stages)}
                </p>
                {fila.etapaRequerida && (
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {describirCondicion(fila.etapaRequerida, stages)}
                  </p>
                )}
                <p className="mt-0.5 text-sm text-neutral-500">
                  {fila.pasos.length} {fila.pasos.length === 1 ? "paso" : "pasos"}
                  {fila.cancelarSiResponde ? " - se corta si responde" : ""}
                </p>
                {fila.atrasadas > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                    {fila.atrasadas === 1
                      ? "Hay una corrida que ya tendría que haber salido y sigue esperando."
                      : `Hay ${fila.atrasadas} corridas que ya tendrían que haber salido y siguen esperando.`}{" "}
                    Suele ser que el reloj de las automatizaciones no está corriendo.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fila.enabled}
                    disabled={guardando}
                    onChange={(event) => prender(fila, event.target.checked)}
                    className="size-4 cursor-pointer accent-emerald-500"
                  />
                  {fila.enabled ? "Activa" : "Apagada"}
                </label>
                <button
                  type="button"
                  onClick={() => setEditando(fila)}
                  className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => borrar(fila)}
                  aria-label={`Borrar ${fila.name}`}
                  className="cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function describirDisparador(disparador: Disparador | null, stages: StageRow[]): string {
  if (!disparador) return "Disparador incompleto.";
  const espera = describirEspera(disparador.esperaMinutos);

  switch (disparador.tipo) {
    case "etapa": {
      const encontrada = stages.find((s) => s.id === disparador.stageId);
      const etapa = encontrada
        ? nombreCompletoDeEtapa(encontrada, hayVariosEmbudos(stages))
        : "una etapa borrada";
      return `${espera} despues de entrar en "${etapa}", si sigue ahi`;
    }
    case "lead_nuevo":
      return `${espera} después de que entra un lead nuevo`;
    case "sin_respuesta":
      return `cuando pasan ${espera} sin que el contacto responda`;
    // Los recordatorios se configuran en la Agenda y no entran en esta lista,
    // así que esta rama no llega a mostrarse. Está para que el switch cubra
    // todos los tipos y agregar uno nuevo siga siendo un error de compilación.
    case "cita":
      return "cuando se acerca una cita";
  }
}

/**
 * El valor del `<select>` que significa "sin condición".
 *
 * Un `<option>` con `value=""` y uno con el value ausente se leen igual desde
 * el DOM, así que la ausencia de condición necesita un valor propio que no
 * pueda confundirse con el id de una etapa.
 */
const TODAS_LAS_ETAPAS = "todas";

/** Cómo se lee la condición de etapa en la lista. */
function describirCondicion(etapaRequerida: string | null, stages: StageRow[]): string {
  if (!etapaRequerida) return "en cualquier etapa del embudo";
  const etapa = stages.find((s) => s.id === etapaRequerida);
  // Una etapa borrada no coincide con ninguna, así que la automatización dejó
  // de disparar. Se dice con todas las letras: apagada en silencio es la falla
  // que nadie encuentra.
  if (!etapa) return "solo si está en una etapa borrada (no va a dispararse)";
  return `solo si está en "${nombreCompletoDeEtapa(etapa, hayVariosEmbudos(stages))}"`;
}

/* ------------------------------------------------------------------- editor */

const NOMBRE_DEL_DISPARADOR: Record<TipoDisparador, string> = {
  etapa: "Entra en una etapa del embudo",
  lead_nuevo: "Entra un lead nuevo",
  sin_respuesta: "El contacto deja de responder",
  cita: "Se acerca una cita agendada",
};

const NOMBRE_DEL_PASO: Record<TipoPaso, string> = {
  esperar: "Esperar",
  plantilla: "Enviar una plantilla",
  texto: "Enviar un texto",
  audio: "Enviar un audio",
  ia: "Que lo escriba la IA",
  mover: "Mover de etapa",
  avisar: "Dejar un aviso interno",
  meta: "Enviar conversión a Meta",
  asignar: "Repartir el lead",
  frenar_ia: "Parar la IA",
  condicion: "Partir en dos caminos",
};

/** Qué mira cada condición, dicho como se lee en la pantalla. */
const NOMBRE_DE_LA_PRUEBA: Record<TipoPrueba, string> = {
  etapa: "El lead está en una de estas etapas",
  respondio: "El contacto respondió desde que arrancó",
  ventana: "Todavía se puede mandar un mensaje libre (24 h)",
  con_responsable: "El lead ya tiene responsable",
};

/** Cómo se lee cada modo de reparto en la pantalla. */
const NOMBRE_DEL_MODO: Record<ModoDeReparto, string> = {
  equitativo: "Por turno, uno cada uno",
  peso: "Por peso, según lo que le toque a cada uno",
  carga: "Al que menos leads abiertos tenga",
};

const EXPLICACION_DEL_MODO: Record<ModoDeReparto, string> = {
  equitativo: "Le toca al que hace más que no recibe un lead.",
  peso: "Con Lucas en 2 y Ana en 1, a Lucas le entran dos leads por cada uno de Ana.",
  carga: "Cuenta los leads sin archivar que tiene cada uno ahora, no los que recibió.",
};

/** Los días de la semana, en el orden en que se leen acá. 0 es domingo. */
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
 * El disparador que queda al cambiar de tipo en el select.
 *
 * Cada tipo tiene campos propios, así que no alcanza con pisar `tipo`: hay que
 * armar la forma entera. La espera se arrastra entre tipos porque es lo que la
 * persona acaba de elegir y no tiene por qué volver a cargarla.
 */
function nuevoDisparador(
  tipo: TipoDisparador,
  anterior: Disparador,
  stages: StageRow[],
): Disparador {
  switch (tipo) {
    case "etapa":
      return { tipo, stageId: stages[0]?.id ?? "", esperaMinutos: anterior.esperaMinutos };
    case "cita":
      // Un día antes: el recordatorio que se pone en casi todos lados.
      return {
        tipo,
        momento: "antes",
        anticipacionMinutos: 1440,
        tipoDeCita: null,
        esperaMinutos: 0,
      };
    default:
      return { tipo, esperaMinutos: anterior.esperaMinutos };
  }
}

/** Lunes a viernes de 9 a 18: el turno que hay que cambiar menos veces. */
function candidatoVacio(userId: string): Candidato {
  return { userId, dias: [1, 2, 3, 4, 5], horaDesde: 540, horaHasta: 1080, peso: 1 };
}

function pasoVacio(tipo: TipoPaso, stages: StageRow[], users: WorkspaceUser[]): Paso {
  switch (tipo) {
    case "esperar":
      return { tipo, minutos: 1440 };
    case "plantilla":
      return { tipo, nombre: "", idioma: "", valores: {} };
    case "texto":
      return { tipo, texto: "" };
    case "audio":
      return { tipo, url: "", texto: "" };
    case "ia":
      return { tipo, instruccion: "" };
    case "mover":
      return { tipo, stageId: stages[0]?.id ?? "" };
    case "avisar":
      return { tipo, texto: "" };
    case "meta":
      return { tipo, evento: "QualifiedLead", conValor: false };
    case "asignar":
      // Arranca con el primer usuario ya puesto: un reparto vacío no se puede
      // guardar, y elegir a alguien es el paso que nadie se saltea.
      return {
        tipo,
        modo: "equitativo",
        candidatos: users[0] ? [candidatoVacio(users[0].userId)] : [],
      };
    case "frenar_ia":
      return { tipo };
    case "condicion":
      // Nace con una etapa ya elegida y las dos ramas vacías. La validación
      // pide que se llene al menos una: es el paso que define la condición y
      // no hay default razonable para inventarlo.
      return {
        tipo,
        prueba: { tipo: "etapa", stageIds: stages[0] ? [stages[0].id] : [] },
        siSi: [],
        siNo: [],
      };
  }
}

function Editor({
  inicial,
  stages,
  plantillas,
  avisoPlantillas,
  users,
  onCancelar,
  onGuardado,
  onNotice,
}: {
  inicial: AutomatizacionRow | null;
  stages: StageRow[];
  plantillas: Plantilla[];
  avisoPlantillas: string;
  users: WorkspaceUser[];
  onCancelar: () => void;
  onGuardado: () => void;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState(inicial?.name ?? "");
  const [disparador, setDisparador] = useState<Disparador>(
    inicial?.disparador ?? { tipo: "etapa", stageId: stages[0]?.id ?? "", esperaMinutos: 1440 },
  );
  // Nace sin condición: una automatización nueva alcanza a todo el embudo,
  // igual que las que ya existían antes de que esto existiera.
  const [etapaRequerida, setEtapaRequerida] = useState<string | null>(
    inicial?.etapaRequerida ?? null,
  );
  const [pasos, setPasos] = useState<Paso[]>(inicial?.pasos ?? []);
  const [cancelarSiResponde, setCancelar] = useState(inicial?.cancelarSiResponde ?? true);
  const [horaDesde, setHoraDesde] = useState(inicial?.horaDesde ?? 540);
  const [horaHasta, setHoraHasta] = useState(inicial?.horaHasta ?? 1260);
  const [guardando, empezar] = useTransition();

  const problema = validar({ name, disparador, etapaRequerida, pasos, horaDesde, horaHasta });

  // Todo lo que las listas anidadas necesitan y no cambia entre ellas, en un
  // solo objeto: sin esto cada nivel del árbol vuelve a pasar nueve props.
  const contexto: ContextoDelEditor = {
    stages,
    plantillas,
    avisoPlantillas,
    users,
    minutos: minutosPorRuta(disparador, pasos),
    franja: { horaDesde, horaHasta },
    total: contarPasos(pasos),
    onNotice,
  };

  const guardar = () => {
    empezar(async () => {
      const result = await saveAutomation({
        id: inicial?.id,
        name,
        disparador,
        etapaRequerida,
        pasos,
        cancelarSiResponde,
        horaDesde,
        horaHasta,
      });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      if (result.warning) onNotice(result.warning);
      onGuardado();
    });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">
        {inicial ? `Editar "${inicial.name}"` : "Nueva automatización"}
      </h2>

      <Card className="space-y-5 p-5">
        <label className="block">
          <span className="block text-xs font-medium text-neutral-500">Nombre</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seguimiento de presupuesto"
            className={`${INPUT_CLASS} mt-1.5`}
          />
        </label>

        <div>
          <p className="text-xs font-medium text-neutral-500">Cuándo se dispara</p>
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            <select
              value={disparador.tipo}
              onChange={(event) => {
                const tipo = event.target.value as TipoDisparador;
                setDisparador(nuevoDisparador(tipo, disparador, stages));
              }}
              className={`${INPUT_CLASS} w-72 cursor-pointer`}
              aria-label="Tipo de disparador"
            >
              {/* "cita" no está en la lista: los recordatorios se configuran
                  en la Agenda, con una pantalla donde todas las opciones que se
                  ven le aplican. Acá habría que apagarle la mitad. */}
              {(Object.keys(NOMBRE_DEL_DISPARADOR) as TipoDisparador[])
                .filter((tipo) => tipo !== "cita")
                .map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {NOMBRE_DEL_DISPARADOR[tipo]}
                  </option>
                ))}
            </select>

            {disparador.tipo === "etapa" && (
              <select
                value={disparador.stageId}
                onChange={(event) => setDisparador({ ...disparador, stageId: event.target.value })}
                className={`${INPUT_CLASS} w-56 cursor-pointer`}
                aria-label="Etapa del embudo"
              >
                <OpcionesDeEtapa stages={stages} />
              </select>
            )}

            <span>
              <span className="block text-xs font-medium text-neutral-500">
                {disparador.tipo === "sin_respuesta" ? "Silencio de" : "Esperar"}
              </span>
              <span className="mt-1.5 flex">
                <Duracion
                  minutos={disparador.esperaMinutos}
                  onChange={(esperaMinutos) => setDisparador({ ...disparador, esperaMinutos })}
                />
              </span>
            </span>
          </div>

          <p className="mt-2 text-sm text-neutral-500">{describirDisparador(disparador, stages)}.</p>
        </div>

        <div>
          <p className="text-xs font-medium text-neutral-500">En qué etapa tiene que estar</p>
          <select
            value={etapaRequerida ?? TODAS_LAS_ETAPAS}
            onChange={(event) =>
              setEtapaRequerida(
                event.target.value === TODAS_LAS_ETAPAS ? null : event.target.value,
              )
            }
            className={`${INPUT_CLASS} mt-1.5 w-72 cursor-pointer`}
            aria-label="Etapa en la que tiene que estar el lead"
          >
            <option value={TODAS_LAS_ETAPAS}>Todas las etapas</option>
            <OpcionesDeEtapa stages={stages} />
            {/* Si borraron la columna que tenía guardada, el select se quedaría
                en blanco y guardar fallaría sin que se entienda por qué. */}
            {etapaRequerida && !stages.some((etapa) => etapa.id === etapaRequerida) && (
              <option value={etapaRequerida}>Una etapa borrada</option>
            )}
          </select>

          <p className="mt-2 text-sm text-neutral-500">
            {etapaRequerida
              ? "Se revisa antes de cada paso: si el lead se mueve a otra columna, la secuencia se corta."
              : "Corre esté donde esté el lead en el embudo."}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-neutral-500">Secuencia</p>

          {pasos.length === 0 && (
            <p className="mt-1.5 text-sm text-neutral-500">
              Todavía no hay pasos. Agregá el primero abajo.
            </p>
          )}

          {/* El lienzo en pantalla grande y la lista apilada en el celular.
              Son dos vistas del mismo estado: lo que se toca en una queda en
              la otra. Un lienzo con zoom y arrastre en un teléfono es peor que
              una lista, y una lista en una pantalla de escritorio no deja ver
              por dónde sale cada camino. */}
          <div className="hidden lg:block">
            <Lienzo
              pasos={pasos}
              minutos={contexto.minutos}
              nombreDelPaso={NOMBRE_DEL_PASO}
              disparador={describirDisparador(disparador, stages)}
              resumen={(paso) => resumenDelPaso(paso, stages)}
              nuevoPaso={(tipo) => pasoVacio(tipo, stages, users)}
              formulario={(paso, alCambiar) => (
                <CamposDelPaso
                  paso={paso}
                  stages={stages}
                  plantillas={plantillas}
                  avisoPlantillas={avisoPlantillas}
                  users={users}
                  onChange={alCambiar}
                  onNotice={onNotice}
                />
              )}
              aviso={(paso, ruta) => (
                <AvisoDeVentana
                  paso={paso}
                  minutos={contexto.minutos.get(escribirRuta(ruta)) ?? 0}
                  franja={contexto.franja}
                />
              )}
              onChange={setPasos}
            />
          </div>

          <div className="lg:hidden">
            <ListaDePasos pasos={pasos} prefijo={[]} contexto={contexto} onChange={setPasos} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-5 border-t border-[#ddd8c9] pt-5 dark:border-white/10">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cancelarSiResponde}
              onChange={(event) => setCancelar(event.target.checked)}
              className="size-4 cursor-pointer accent-emerald-500"
            />
            Cortar la secuencia si el contacto responde
          </label>
          <Hora minutos={horaDesde} onChange={setHoraDesde} etiqueta="Enviar desde" />
          <Hora minutos={horaHasta} onChange={setHoraHasta} etiqueta="Enviar hasta" />
        </div>

        <p className="text-xs text-neutral-500">
          Huecos que podés escribir en los textos: {TOKENS.map((t) => t.token).join(", ")}. El
          que el contacto no tenga cargado se borra del mensaje al mandarlo.
        </p>

        {problema && <p className="text-sm text-amber-700 dark:text-amber-300">{problema}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || problema !== null}
            className={PRIMARY_BUTTON_CLASS}
          >
            <Zap className="size-4" />
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="cursor-pointer rounded-xl border border-[#ddd8c9] px-4 py-2.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
        </div>

        {!inicial && (
          <p className="text-xs text-neutral-500">
            Se guarda apagada. Revisala y prendela desde la lista.
          </p>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- la secuencia */

/** Lo que toda lista de pasos necesita y es igual en todos los niveles. */
type ContextoDelEditor = {
  stages: StageRow[];
  plantillas: Plantilla[];
  avisoPlantillas: string;
  users: WorkspaceUser[];
  /** Minutos desde el disparo hasta cada paso, por ruta escrita. */
  minutos: Map<string, number>;
  franja: { horaDesde: number; horaHasta: number };
  /** Cuántos pasos hay en todo el árbol, para el tope. */
  total: number;
  onNotice: (message: string) => void;
};

/**
 * Una lista de pasos, y adentro de cada condición las dos suyas.
 *
 * Es recursiva porque el modelo lo es: las ramas son listas de pasos y un paso
 * puede ser una condición. Un componente aparte por nivel no serviría, porque
 * no se sabe de antemano cuántos niveles hay.
 *
 * `prefijo` es dónde está parada esta lista dentro del árbol. Se usa para dos
 * cosas: buscar los minutos acumulados de cada paso —que dependen del camino,
 * no de la posición— y saber a qué profundidad estamos, para no ofrecer una
 * condición más cuando ya no se puede anidar.
 */
function ListaDePasos({
  pasos,
  prefijo,
  contexto,
  onChange,
}: {
  pasos: Paso[];
  prefijo: Ruta;
  contexto: ContextoDelEditor;
  onChange: (pasos: Paso[]) => void;
}) {
  // El prefijo alterna índice y rama, así que cada condición por encima suma
  // dos tramos.
  const profundidad = prefijo.length / 2;

  const cambiar = (indice: number, paso: Paso) =>
    onChange(pasos.map((p, i) => (i === indice ? paso : p)));

  const mover = (indice: number, delta: number) => {
    const destino = indice + delta;
    if (destino < 0 || destino >= pasos.length) return;
    const copia = [...pasos];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    onChange(copia);
  };

  const tipos = (Object.keys(NOMBRE_DEL_PASO) as TipoPaso[]).filter(
    (tipo) => tipo !== "condicion" || profundidad < MAX_PROFUNDIDAD,
  );

  return (
    <>
      <ol className="mt-2 space-y-3">
        {pasos.map((paso, indice) => {
          const ruta: Ruta = [...prefijo, indice];
          const minutos = contexto.minutos.get(escribirRuta(ruta)) ?? 0;

          return (
            <li
              key={indice}
              className="rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {paso.tipo === "condicion" && (
                    <GitBranch className="mr-1 inline size-3.5 text-neutral-500" />
                  )}
                  {indice + 1}. {NOMBRE_DEL_PASO[paso.tipo]}
                  <span className="ml-2 font-normal text-neutral-500">
                    - {describirEspera(minutos)} desde el disparo
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => mover(indice, -1)}
                    aria-label="Subir"
                    className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(indice, 1)}
                    aria-label="Bajar"
                    className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(pasos.filter((_, i) => i !== indice))}
                    aria-label="Quitar el paso"
                    className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </div>

              <div className="mt-2.5">
                <CamposDelPaso
                  paso={paso}
                  stages={contexto.stages}
                  plantillas={contexto.plantillas}
                  avisoPlantillas={contexto.avisoPlantillas}
                  users={contexto.users}
                  onChange={(nuevo) => cambiar(indice, nuevo)}
                  onNotice={contexto.onNotice}
                />
              </div>

              {paso.tipo === "condicion" && (
                // Lado a lado sólo en el nivel de arriba y en pantalla grande:
                // una rama adentro de otra ya viene angosta, y en el celular
                // dos columnas dejan los campos ilegibles. Apiladas se leen
                // igual —cada una tiene su riel de color y su título—, que es
                // lo que importa para entender por dónde sigue cada camino.
                <div
                  className={`mt-3 gap-3 ${
                    prefijo.length === 0 ? "flex flex-col lg:flex-row" : "flex flex-col"
                  }`}
                >
                  <Rama
                    etiqueta="Sí"
                    rama="si"
                    pasos={paso.siSi}
                    prefijo={[...ruta, "si"]}
                    contexto={contexto}
                    onChange={(siSi) => cambiar(indice, { ...paso, siSi })}
                  />
                  <Rama
                    etiqueta="No"
                    rama="no"
                    pasos={paso.siNo}
                    prefijo={[...ruta, "no"]}
                    contexto={contexto}
                    onChange={(siNo) => cambiar(indice, { ...paso, siNo })}
                  />
                </div>
              )}

              {paso.tipo === "plantilla" && (
                <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
                  Las plantillas son de WhatsApp. En Instagram y en Messenger sale este mismo
                  texto como mensaje común —sin botones ni imagen— y sólo dentro de las 24
                  horas.
                </p>
              )}

              <AvisoDeVentana paso={paso} minutos={minutos} franja={contexto.franja} />
            </li>
          );
        })}
      </ol>

      {contexto.total < MAX_PASOS && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tipos.map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => onChange([...pasos, pasoVacio(tipo, contexto.stages, contexto.users)])}
              className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
            >
              <Plus className="mr-1 inline size-3.5" />
              {NOMBRE_DEL_PASO[tipo]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * El aviso de que un paso puede quedar fuera de las 24 horas de Meta.
 *
 * Vive aparte porque lo muestran los dos editores: la lista apilada adentro
 * del paso, y el lienzo en el cajón de la derecha.
 */
function AvisoDeVentana({
  paso,
  minutos,
  franja,
}: {
  paso: Paso;
  minutos: number;
  franja: { horaDesde: number; horaHasta: number };
}) {
  if (!pasoFueraDeLaVentana(paso, minutos, franja)) return null;

  return (
    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
      {minutos >= VENTANA_WHATSAPP_MINUTOS ? (
        <>
          Cae fuera de las 24 horas: ni WhatsApp ni Instagram ni Messenger dejan mandar un
          mensaje libre tan tarde, y de audio no hay plantilla. En WhatsApp un texto se salva
          con una plantilla; en los otros canales no hay forma, hay que acortar la espera.
        </>
      ) : (
        <>
          La espera entra en las 24 horas, pero la franja lo puede demorar hasta{" "}
          {describirEspera(peorDemora(minutos, franja))} y dejarlo afuera: si el momento de
          enviar cae con la franja cerrada, el paso espera a que abra. Ampliá la franja o
          acortá la espera.
        </>
      )}
    </p>
  );
}

/**
 * La línea chica de una tarjeta del lienzo.
 *
 * En el lienzo la tarjeta es chica a propósito —si trajera el formulario, el
 * árbol no entraría en la pantalla—, así que esta línea es todo lo que se ve
 * de un paso sin abrirlo. Tiene que alcanzar para reconocerlo entre otros tres
 * del mismo tipo.
 */
function resumenDelPaso(paso: Paso, stages: StageRow[]): string {
  switch (paso.tipo) {
    case "esperar":
      return describirEspera(paso.minutos);
    case "texto":
    case "avisar":
      return paso.texto.trim() || "sin escribir";
    case "ia":
      return paso.instruccion.trim() || "sin instrucción";
    case "audio":
      return paso.texto.trim() || "nota de voz";
    case "plantilla":
      return paso.nombre || "sin elegir";
    case "mover":
      return nombreDeEtapa(stages, paso.stageId);
    case "meta":
      return NOMBRE_DEL_EVENTO[paso.evento];
    case "asignar":
      return paso.candidatos.length === 1
        ? "1 persona"
        : `${paso.candidatos.length} personas`;
    case "frenar_ia":
      return "deja de contestar sola";
    case "condicion":
      return paso.prueba.tipo === "etapa"
        ? paso.prueba.stageIds.map((id) => nombreDeEtapa(stages, id)).join(", ")
        : RESUMEN_DE_LA_PRUEBA[paso.prueba.tipo];
  }
}

/** Las pruebas sin datos, dichas corto para que entren en una tarjeta. */
const RESUMEN_DE_LA_PRUEBA: Record<Exclude<TipoPrueba, "etapa">, string> = {
  respondio: "si respondió",
  ventana: "si entra un mensaje libre",
  con_responsable: "si tiene responsable",
};

/** El nombre de una etapa, o el cartel de que la borraron. */
function nombreDeEtapa(stages: StageRow[], stageId: string): string {
  const stage = stages.find((etapa) => etapa.id === stageId);
  return stage ? nombreCompletoDeEtapa(stage, hayVariosEmbudos(stages)) : "una etapa borrada";
}

/**
 * Una de las dos salidas de una condición.
 *
 * El riel de color de la izquierda es lo único que separa visualmente una rama
 * de la secuencia que la contiene, así que no es decoración: sin él, mirando
 * un árbol con tres condiciones no se sabe dónde termina cada camino.
 */
function Rama({
  etiqueta,
  rama,
  pasos,
  prefijo,
  contexto,
  onChange,
}: {
  etiqueta: string;
  rama: TipoRama;
  pasos: Paso[];
  prefijo: Ruta;
  contexto: ContextoDelEditor;
  onChange: (pasos: Paso[]) => void;
}) {
  const riel =
    rama === "si"
      ? "border-emerald-400 dark:border-emerald-500/50"
      : "border-neutral-300 dark:border-white/20";
  const titulo = rama === "si" ? "text-emerald-700 dark:text-emerald-300" : "text-neutral-500";

  return (
    <div className={`min-w-0 flex-1 border-l-2 pl-3 ${riel}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${titulo}`}>{etiqueta}</p>

      {pasos.length === 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          Sin pasos: por acá no hace nada y la secuencia sigue con lo que venga después de la
          condición.
        </p>
      )}

      <ListaDePasos pasos={pasos} prefijo={prefijo} contexto={contexto} onChange={onChange} />
    </div>
  );
}

/**
 * Qué mira una condición.
 *
 * Las cuatro pruebas se evalúan cuando el paso llega, no cuando la
 * automatización se dispara, y eso es lo que hay que dejar claro en pantalla:
 * entre el disparo y la condición pueden haber pasado días.
 */
function CamposDeLaCondicion({
  prueba,
  stages,
  onChange,
}: {
  prueba: Prueba;
  stages: StageRow[];
  onChange: (prueba: Prueba) => void;
}) {
  const varios = hayVariosEmbudos(stages);
  const elegidas = prueba.tipo === "etapa" ? prueba.stageIds : [];

  const alternar = (stageId: string) => {
    if (prueba.tipo !== "etapa") return;
    const stageIds = elegidas.includes(stageId)
      ? elegidas.filter((id) => id !== stageId)
      : [...elegidas, stageId];
    if (stageIds.length > MAX_ETAPAS_DE_LA_PRUEBA) return;
    onChange({ tipo: "etapa", stageIds });
  };

  return (
    <div className="space-y-2">
      <select
        value={prueba.tipo}
        onChange={(event) => {
          const tipo = event.target.value as TipoPrueba;
          onChange(
            tipo === "etapa"
              ? { tipo, stageIds: stages[0] ? [stages[0].id] : [] }
              : { tipo },
          );
        }}
        className={`${INPUT_CLASS} cursor-pointer`}
        aria-label="Qué mira la condición"
      >
        {TIPOS_DE_PRUEBA.map((tipo) => (
          <option key={tipo} value={tipo}>
            {NOMBRE_DE_LA_PRUEBA[tipo]}
          </option>
        ))}
      </select>

      {prueba.tipo === "etapa" && (
        <div className="flex flex-wrap gap-1.5">
          {stages.map((stage) => {
            const puesta = elegidas.includes(stage.id);
            return (
              <button
                key={stage.id}
                type="button"
                aria-pressed={puesta}
                onClick={() => alternar(stage.id)}
                className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  puesta
                    ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-[#ddd8c9] text-neutral-600 hover:bg-neutral-100 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
                }`}
              >
                {nombreCompletoDeEtapa(stage, varios)}
              </button>
            );
          })}

          {/* Una etapa borrada seguiría guardada y la condición no se cumpliría
              nunca, sin nada en pantalla que lo explique. */}
          {elegidas
            .filter((id) => !stages.some((stage) => stage.id === id))
            .map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => alternar(id)}
                className="cursor-pointer rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200"
              >
                Una etapa borrada
              </button>
            ))}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        {prueba.tipo === "ventana"
          ? "Se mira al llegar a este paso. Por el sí entra un texto o un audio; por el no, sólo una plantilla de WhatsApp."
          : "Se mira al llegar a este paso, no al dispararse la automatización."}
      </p>
    </div>
  );
}

function CamposDelPaso({
  paso,
  stages,
  plantillas,
  avisoPlantillas,
  users,
  onChange,
  onNotice,
}: {
  paso: Paso;
  stages: StageRow[];
  plantillas: Plantilla[];
  avisoPlantillas: string;
  users: WorkspaceUser[];
  onChange: (paso: Paso) => void;
  onNotice: (message: string) => void;
}) {
  switch (paso.tipo) {
    case "esperar":
      return (
        <Duracion minutos={paso.minutos} onChange={(minutos) => onChange({ ...paso, minutos })} />
      );

    case "texto":
    case "avisar":
      return (
        <div className="space-y-2">
          <textarea
            value={paso.texto}
            onChange={(event) => onChange({ ...paso, texto: event.target.value })}
            rows={2}
            placeholder={
              paso.tipo === "texto" ? "Hola {nombre}, ¿pudiste verlo?" : "Llamar a {nombre}"
            }
            className={INPUT_CLASS}
          />
          {/* `avisar` no pasa por acá: es una nota interna, no le escribe a nadie. */}
          {paso.tipo === "texto" && <MarcaSinLeer paso={paso} onChange={onChange} />}
        </div>
      );

    case "audio":
      return (
        <div className="space-y-2">
          <PasoDeAudio paso={paso} onChange={onChange} onNotice={onNotice} />
          <MarcaSinLeer paso={paso} onChange={onChange} />
        </div>
      );

    case "ia":
      return (
        <div className="space-y-2">
          <textarea
            value={paso.instruccion}
            onChange={(event) => onChange({ ...paso, instruccion: event.target.value })}
            rows={2}
            placeholder="Preguntale si le quedó alguna duda del presupuesto, sin insistir."
            className={INPUT_CLASS}
          />
          <MarcaSinLeer paso={paso} onChange={onChange} />
        </div>
      );

    case "asignar":
      return <PasoDeReparto paso={paso} users={users} onChange={onChange} />;

    case "frenar_ia":
      return (
        <p className="text-xs text-neutral-500">
          La IA deja de contestarle sola a este contacto, igual que con el interruptor de la
          ficha, y se reactiva a mano desde ahí o desde el chat. No le escribe al contacto. Esta
          secuencia sigue con sus pasos; las demás automatizaciones que le escriban se cortan,
          como cuando alguien toma el chat a mano.
        </p>
      );

    case "mover":
      return (
        <select
          value={paso.stageId}
          onChange={(event) => onChange({ ...paso, stageId: event.target.value })}
          className={`${INPUT_CLASS} w-56 cursor-pointer`}
          aria-label="Etapa destino"
        >
          <OpcionesDeEtapa stages={stages} />
        </select>
      );

    case "meta":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={paso.evento}
              onChange={(event) => {
                const evento = event.target.value as EventoMeta;
                onChange({ ...paso, evento, conValor: evento === "Purchase" || paso.conValor });
              }}
              className={`${INPUT_CLASS} w-56 cursor-pointer`}
              aria-label="Evento de Meta"
            >
              {EVENTOS_META.map((evento) => (
                <option key={evento} value={evento}>
                  {NOMBRE_DEL_EVENTO[evento]}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={paso.conValor}
                disabled={paso.evento === "Purchase"}
                onChange={(event) => onChange({ ...paso, conValor: event.target.checked })}
                className="size-4 cursor-pointer accent-emerald-500"
              />
              Mandar el valor de la oportunidad
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Solo cuenta para leads que llegaron por un anuncio de WhatsApp, y una vez por lead. No
            le escribe al contacto.
          </p>
        </div>
      );

    case "plantilla":
      return (
        <div className="space-y-2">
          <PasoDePlantilla
            paso={paso}
            plantillas={plantillas}
            aviso={avisoPlantillas}
            onChange={onChange}
          />
          <MarcaSinLeer paso={paso} onChange={onChange} />
        </div>
      );

    // Acá va sólo lo que la condición mira. Las dos ramas las dibuja
    // `ListaDePasos`, que es la que sabe anidarse.
    case "condicion":
      return (
        <CamposDeLaCondicion
          prueba={paso.prueba}
          stages={stages}
          onChange={(prueba) => onChange({ ...paso, prueba })}
        />
      );
  }
}

/** Los pasos que le escriben al contacto, que son los que pueden dejar marca. */
type PasoQueEscribe = Extract<Paso, { tipo: "texto" | "audio" | "ia" | "plantilla" }>;

/**
 * La casilla que deja el chat marcado después de mandar el mensaje.
 *
 * Un mensaje automático no movía el contador de sin leer —eso lo hace sólo lo
 * que entra—, así que la secuencia escribía y el chat quedaba tan quieto como
 * antes. Para las que piden seguimiento humano eso es justo al revés de lo que
 * se necesita: mandaste la propuesta y alguien tiene que estar mirando si
 * contestan.
 *
 * Marcado, el chat sube a la bandeja con el mismo globito de siempre y se
 * apaga cuando alguien lo abre. Viene apagada: quien no la toque sigue
 * teniendo el comportamiento de antes.
 */
/**
 * El reparto: quiénes entran, cuándo recibe cada uno y con qué criterio.
 *
 * Los turnos son de cada persona y no del paso porque repartir es decidir quién
 * según cuándo: con una sola ventana para todos habría que armar una
 * automatización por turno y mantenerlas en paralelo.
 */
function PasoDeReparto({
  paso,
  users,
  onChange,
}: {
  paso: Extract<Paso, { tipo: "asignar" }>;
  users: WorkspaceUser[];
  onChange: (paso: Paso) => void;
}) {
  const cambiar = (indice: number, candidato: Candidato) =>
    onChange({
      ...paso,
      candidatos: paso.candidatos.map((c, i) => (i === indice ? candidato : c)),
    });

  const elegidos = new Set(paso.candidatos.map((c) => c.userId));
  const libres = users.filter((user) => !elegidos.has(user.userId));

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="block text-xs font-medium text-neutral-500">Cómo se reparte</span>
        <select
          value={paso.modo}
          onChange={(event) => onChange({ ...paso, modo: event.target.value as ModoDeReparto })}
          className={`${INPUT_CLASS} mt-1.5 w-full cursor-pointer sm:w-96`}
        >
          {MODOS_DE_REPARTO.map((modo) => (
            <option key={modo} value={modo}>
              {NOMBRE_DEL_MODO[modo]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-neutral-500">
          {EXPLICACION_DEL_MODO[paso.modo]}
        </span>
      </label>

      <ul className="space-y-2">
        {paso.candidatos.map((candidato, indice) => (
          <li
            key={indice}
            className="rounded-lg border border-[#ddd8c9] p-2.5 dark:border-white/10"
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-56 flex-1 text-sm">
                <span className="block text-xs font-medium text-neutral-500">Usuario</span>
                <select
                  value={candidato.userId}
                  onChange={(event) => cambiar(indice, { ...candidato, userId: event.target.value })}
                  className={`${INPUT_CLASS} mt-1.5 w-full cursor-pointer`}
                >
                  {/* El propio sigue en la lista: si no, el select se vaciaría
                      al abrirlo sobre alguien ya elegido. */}
                  {[...users.filter((user) => user.userId === candidato.userId), ...libres].map(
                    (user) => (
                      <option key={user.userId} value={user.userId}>
                        {user.email}
                      </option>
                    ),
                  )}
                  {!users.some((user) => user.userId === candidato.userId) && (
                    <option value={candidato.userId}>Usuario que ya no está</option>
                  )}
                </select>
              </label>

              {paso.modo === "peso" && (
                <label className="text-sm">
                  <span className="block text-xs font-medium text-neutral-500">Peso</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_PESO}
                    value={candidato.peso}
                    onChange={(event) =>
                      cambiar(indice, {
                        ...candidato,
                        peso: Math.min(MAX_PESO, Math.max(1, Number(event.target.value) || 1)),
                      })
                    }
                    className={`${INPUT_CLASS} mt-1.5 w-20`}
                  />
                </label>
              )}

              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...paso,
                    candidatos: paso.candidatos.filter((_, i) => i !== indice),
                  })
                }
                aria-label={`Sacar del reparto a ${candidato.userId}`}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-end gap-3">
              <div>
                <span className="block text-xs font-medium text-neutral-500">Días</span>
                <div className="mt-1.5 flex gap-1">
                  {DIAS.map((dia) => {
                    const puesto = candidato.dias.includes(dia.valor);
                    return (
                      <button
                        key={dia.valor}
                        type="button"
                        aria-pressed={puesto}
                        aria-label={dia.nombre}
                        onClick={() =>
                          cambiar(indice, {
                            ...candidato,
                            dias: puesto
                              ? candidato.dias.filter((d) => d !== dia.valor)
                              : [...candidato.dias, dia.valor].sort((a, b) => a - b),
                          })
                        }
                        className={`size-8 cursor-pointer rounded-lg border text-sm transition-colors ${
                          puesto
                            ? "border-transparent bg-emerald-500 font-medium text-white"
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
                  checked={candidato.horaDesde >= candidato.horaHasta}
                  onChange={(event) =>
                    cambiar(
                      indice,
                      event.target.checked
                        ? { ...candidato, horaDesde: 0, horaHasta: 0 }
                        : { ...candidato, horaDesde: 540, horaHasta: 1080 },
                    )
                  }
                  className="size-4 cursor-pointer accent-emerald-500"
                />
                Todo el día
              </label>

              {candidato.horaDesde < candidato.horaHasta && (
                <>
                  <Hora
                    minutos={candidato.horaDesde}
                    onChange={(horaDesde) => cambiar(indice, { ...candidato, horaDesde })}
                    etiqueta="Desde"
                  />
                  <Hora
                    minutos={candidato.horaHasta}
                    onChange={(horaHasta) => cambiar(indice, { ...candidato, horaHasta })}
                    etiqueta="Hasta"
                  />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {libres.length > 0 && paso.candidatos.length < MAX_CANDIDATOS && (
        <button
          type="button"
          onClick={() =>
            onChange({ ...paso, candidatos: [...paso.candidatos, candidatoVacio(libres[0].userId)] })
          }
          className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
        >
          <Plus className="mr-1 inline size-3.5" />
          Agregar usuario
        </button>
      )}

      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
        Sólo se reparten los leads que todavía no tienen responsable: a uno ya asignado no lo
        toca. Si en ese momento no hay nadie en turno —un domingo, de madrugada— el lead cae en el
        dueño del workspace, para que no quede sin dueño hasta el lunes. Los días y las horas se
        leen en la zona horaria de Configuración.
      </p>
    </div>
  );
}

function MarcaSinLeer({
  paso,
  onChange,
}: {
  paso: PasoQueEscribe;
  onChange: (paso: Paso) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={paso.marcarSinLeer === true}
        onChange={(event) => onChange({ ...paso, marcarSinLeer: event.target.checked })}
        className="mt-0.5 size-4 cursor-pointer accent-emerald-500"
      />
      <span>
        Dejar el chat sin leer
        <span className="block text-xs text-neutral-500">
          Queda marcado en la bandeja al mandarlo, sin esperar que el contacto conteste. Se apaga
          cuando alguien lo abre.
        </span>
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------- audio */

/**
 * 4 MB de archivo.
 *
 * La Server Action aguanta 6 MB de cuerpo y el audio viaja en base64, que pesa
 * un tercio más: un mp3 de 6 MB llegaría como 8 y lo cortaría el framework
 * antes de que el error se pueda explicar. Cortarlo acá deja avisar de qué se
 * trata. Para una nota de voz sobra: tres minutos en opus no llegan a 1 MB.
 */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * Tipos que sabemos subir, y la extensión con la que los reconocemos.
 *
 * Hace falta mirar el nombre y no sólo `file.type`: Windows manda los .m4a como
 * "audio/x-m4a" y a veces no manda tipo ninguno, y ahí el archivo se rechazaría
 * por algo que sí sabemos mandar.
 */
const TIPO_POR_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

const ACEPTADOS = new Set(Object.values(TIPO_POR_EXTENSION));

function tipoDelArchivo(archivo: File): string {
  const declarado = archivo.type.split(";")[0].trim();
  if (ACEPTADOS.has(declarado)) return declarado;
  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  return TIPO_POR_EXTENSION[extension] ?? declarado;
}

/** El archivo en base64, sin el prefijo `data:`. Vacío si no se pudo leer. */
function leerBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer el audio."));
    lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
    lector.readAsDataURL(blob);
  }).catch(() => "");
}

/** El grabador avisa cuándo ocupa la barra; acá siempre ocupa el mismo lugar. */
const SIN_AVISO = () => {};

/** El tope del servidor para un audio. Los tres minutos que deja grabar entran. */
const MAX_WAV_BYTES = 6 * 1024 * 1024;

const SIN_VERSION_WAV = "No se pudo preparar la versión para Instagram y Messenger.";

/**
 * Arma y sube la versión WAV de un audio, la que sale por Instagram y Messenger.
 *
 * Devuelve la URL o por qué no se pudo. Que falle no invalida el audio: sigue
 * saliendo por WhatsApp, que es el canal de casi todas las automatizaciones.
 */
async function subirVersionWav(audio: Blob): Promise<{ url: string } | { aviso: string }> {
  const wav = await grabacionAWav(audio);
  if (!wav) return { aviso: SIN_VERSION_WAV };
  if (wav.size > MAX_WAV_BYTES) {
    return {
      aviso:
        "Para Instagram y Messenger el audio no puede pasar de 3 minutos: por esos canales este paso no va a salir.",
    };
  }

  const base64 = await leerBase64(wav);
  if (!base64) return { aviso: SIN_VERSION_WAV };

  const result = await uploadAutomationAudioWav({ wav: base64 });
  return result.ok ? { url: result.url } : { aviso: result.error };
}

/**
 * El audio de un paso: se graba o se sube una sola vez, al armar la secuencia.
 *
 * No es la nota de voz del chat, que sale en el momento: acá el archivo queda
 * guardado y el mismo audio se manda en cada corrida. Por eso se escucha antes
 * de guardarlo y se muestra la transcripción —que hace el servidor al subirlo—
 * cuando ya está: es la única forma de saber cuál de dos audios quedó puesto en
 * qué paso sin tener que reproducirlos todos.
 */
function PasoDeAudio({
  paso,
  onChange,
  onNotice,
}: {
  paso: Extract<Paso, { tipo: "audio" }>;
  onChange: (paso: Paso) => void;
  onNotice: (message: string) => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [preparando, setPreparando] = useState(false);

  const subir = async (blob: Blob, mimeType: string) => {
    if (blob.size > MAX_AUDIO_BYTES) {
      onNotice("El audio es demasiado pesado: el tope son 4 MB.");
      return false;
    }

    const base64 = await leerBase64(blob);
    if (!base64) {
      onNotice("No se pudo leer el audio.");
      return false;
    }

    setSubiendo(true);
    // La transcripción se hace del lado del servidor y tarda unos segundos: por
    // eso el botón queda en "Guardando…" hasta que vuelve con la URL. La
    // versión para Instagram y Messenger se arma mientras tanto.
    const [result, wav] = await Promise.all([
      uploadAutomationAudio({ audio: base64, mimeType }),
      subirVersionWav(blob),
    ]);
    setSubiendo(false);

    if (!result.ok) {
      onNotice(result.error);
      return false;
    }

    onChange({
      ...paso,
      url: result.url,
      urlWav: "url" in wav ? wav.url : undefined,
      texto: result.texto,
    });
    if ("aviso" in wav) onNotice(wav.aviso);
    return true;
  };

  /**
   * Arma la versión WAV de un audio guardado antes de que existiera.
   *
   * Se baja el audio de su URL pública y se convierte acá, igual que al
   * subirlo: el servidor no tiene con qué decodificarlo.
   */
  const prepararWav = async () => {
    setPreparando(true);
    try {
      const respuesta = await fetch(paso.url);
      const wav = respuesta.ok
        ? await subirVersionWav(await respuesta.blob())
        : { aviso: "No se pudo bajar el audio guardado." };
      if ("url" in wav) {
        onChange({ ...paso, urlWav: wav.url });
        onNotice("Listo. Guardá la automatización para que quede.");
      } else {
        onNotice(wav.aviso);
      }
    } catch {
      onNotice("No se pudo bajar el audio guardado.");
    } finally {
      setPreparando(false);
    }
  };

  if (paso.url) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <audio src={paso.url} controls preload="none" className="h-9 min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => onChange({ ...paso, url: "", urlWav: undefined, texto: "" })}
            className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
          >
            Cambiar el audio
          </button>
        </div>
        <p className="text-sm text-neutral-500">
          En el historial queda: <span className="italic">“{paso.texto}”</span>
        </p>
        {!paso.urlWav && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              Este audio todavía no sale por Instagram ni Messenger.
            </span>
            <button
              type="button"
              disabled={preparando}
              onClick={() => void prepararWav()}
              className="cursor-pointer rounded-lg border border-amber-300 px-3 py-1.5 font-medium transition-colors hover:bg-amber-100 disabled:cursor-default disabled:opacity-60 dark:border-amber-500/30 dark:hover:bg-amber-500/20"
            >
              {preparando ? "Preparando…" : "Preparar para Instagram y Messenger"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <VoiceRecorder
          disabled={subiendo}
          onSend={subir}
          onNotice={onNotice}
          onActiveChange={SIN_AVISO}
          sendLabel="Usar este audio"
          sendingLabel="Guardando…"
        />
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ddd8c9] px-3 py-2.5 text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10">
          <Upload className="size-4" />
          {subiendo ? "Guardando…" : "Subir un archivo"}
          <input
            type="file"
            accept="audio/mpeg,audio/mp4,audio/ogg,audio/webm,.mp3,.m4a,.ogg,.opus,.webm"
            disabled={subiendo}
            className="hidden"
            onChange={(event) => {
              const archivo = event.target.files?.[0];
              // Se limpia el input para que elegir el mismo archivo otra vez,
              // después de un error, vuelva a disparar el cambio.
              event.target.value = "";
              if (archivo) void subir(archivo, tipoDelArchivo(archivo));
            }}
          />
        </label>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Mic className="size-3.5 shrink-0" />
        Grabalo o subí un mp3, m4a u ogg de hasta 4 MB. Sale el mismo audio para todos: los
        huecos como {"{nombre}"} no se completan en un archivo grabado.
      </p>
    </div>
  );
}

function PasoDePlantilla({
  paso,
  plantillas,
  aviso,
  onChange,
}: {
  paso: Extract<Paso, { tipo: "plantilla" }>;
  plantillas: Plantilla[];
  aviso: string;
  onChange: (paso: Paso) => void;
}) {
  if (aviso) return <p className="text-sm text-red-600">{aviso}</p>;
  if (plantillas.length === 0) {
    return <p className="text-sm text-neutral-500">No hay plantillas aprobadas en YCloud.</p>;
  }

  const clave = (p: Plantilla) => `${p.nombre} ${p.idioma}`;
  const elegida = plantillas.find((p) => p.nombre === paso.nombre && p.idioma === paso.idioma);

  return (
    <div className="space-y-2.5">
      <select
        value={elegida ? clave(elegida) : ""}
        onChange={(event) => {
          const nueva = plantillas.find((p) => clave(p) === event.target.value);
          // Los valores se vacían al cambiar de plantilla: los huecos de una no
          // significan nada en la otra.
          onChange({
            ...paso,
            nombre: nueva?.nombre ?? "",
            idioma: nueva?.idioma ?? "",
            valores: {},
          });
        }}
        className={`${INPUT_CLASS} cursor-pointer`}
        aria-label="Plantilla"
      >
        <option value="">Elegí una plantilla…</option>
        {plantillas.map((p) => (
          <option key={clave(p)} value={clave(p)}>
            {p.nombre} ({p.idioma})
          </option>
        ))}
      </select>

      {elegida &&
        faltantesDe(elegida).map((faltante) => {
          const id = claveDe(faltante);
          return (
            <input
              key={id}
              value={paso.valores[id] ?? ""}
              onChange={(event) =>
                onChange({ ...paso, valores: { ...paso.valores, [id]: event.target.value } })
              }
              placeholder={
                faltante.clase === "link" ? "https://…" : `Valor de la variable ${faltante.numero}`
              }
              className={INPUT_CLASS}
            />
          );
        })}
    </div>
  );
}
