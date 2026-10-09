"use client";

import {
  Bot,
  BotOff,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Layers,
  LineChart,
  ListPlus,
  ListTodo,
  type LucideIcon,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  createContact,
  createOpportunity,
  createPipeline,
  createStage,
  deleteContacts,
  deleteOpportunities,
  deletePipeline,
  deleteStage,
  loadWorkspaceUsers,
  renamePipeline,
  renameStage,
  reorderPipelines,
  reorderStages,
  updateOpportunityStage,
  type WorkspaceUser,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { TareaModal, useAhora } from "@/components/tareas-panel";
import {
  Card,
  ChannelBadges,
  CHANNEL_LABELS,
  EmptyState,
  INPUT_CLASS,
  Modal,
  PRIMARY_BUTTON_CLASS,
  money,
} from "@/components/ui";
import type { ContactRow, OpportunityRow, PipelineRow, StageRow } from "@/lib/crm-data";
import { grupoDeTarea, textoDeVencimiento, type TareaRow } from "@/lib/tareas";
import { dayKeyInZone } from "@/lib/fechas";
import {
  FILTRO_PIPELINE_VACIO,
  filtraAlgo,
  filtrosPuestos,
  pasaElFiltro,
  SIN_ASIGNAR,
  type FiltroPipeline,
} from "@/lib/pipeline-filtros";
import type { Channel } from "@/types/database";

/** Tipo MIME propio: evita que el board acepte texto arrastrado de afuera. */
const DRAG_TYPE = "application/x-leon-opportunity";

/** Lo que comparten los botones de la barra de arriba del board. */
const SECONDARY_BUTTON_CLASS =
  "cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors";

/** Prendido —filtros puestos, selección abierta— se marca igual en todos. */
const TOOLBAR_TONES = {
  on: "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  off: "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5",
};

/**
 * Una acción de administración del embudo.
 *
 * Se arman una sola vez y se dibujan dos veces: botón suelto de `sm` para
 * arriba y renglón del menú en el celular. Separarlas en dos listas era la
 * forma segura de que una se quedara sin la acción nueva.
 */
type AccionDeEmbudo = {
  Icono: LucideIcon;
  etiqueta: string;
  /** Si la acción está en curso: la de seleccionar queda prendida. */
  activa?: boolean;
  alTocar: () => void;
};

/** Ganado y perdido se tiñen distinto: se leen de un vistazo sin abrir nada. */
const COLUMN_TONES: Record<StageRow["kind"], string> = {
  open: "bg-neutral-100/70 dark:bg-white/[.04]",
  won: "bg-amber-50/80 dark:bg-amber-400/[.07]",
  lost: "bg-red-50/70 dark:bg-red-400/[.06]",
};

/*
  La barra de desplazamiento del board, arriba de las columnas.

  El navegador la dibuja siempre al pie del elemento que scrollea, y el board
  mide todo el alto libre de la pantalla: con el embudo cargado la barra queda
  abajo de todo, lejos de las columnas y muchas veces fuera de la vista, así que
  para correrse una columna a la derecha había que bajar primero a buscarla.

  Acá se da vuelta: el board esconde su barra y arriba se pone otra, finita, que
  es una caja vacía del ancho total de las columnas. Las dos se siguen entre
  ellas, así que mover una mueve el board y al revés. Es un elemento aparte y no
  un truco de rotación sobre el board justamente porque las tarjetas se mueven
  arrastrando: cualquier `transform` encima del tablero le arruina al navegador
  las coordenadas del soltado.

  `firma` es lo que cambia el ancho total —cuántas columnas abiertas hay—: con
  eso se vuelve a medir, porque el `ResizeObserver` avisa cuando cambia el
  tamaño del board, no cuando cambia lo que tiene adentro. Las dos referencias
  entran por parámetro en vez de salir del hook porque devolverlas adentro de un
  objeto es leerlas en pleno render, y ahí React avisa con razón.
*/
/** Las dos cajas que se siguen entre ellas. */
type Caja = "board" | "barra";

function useBarraDeArriba(
  board: RefObject<HTMLDivElement | null>,
  barra: RefObject<HTMLDivElement | null>,
  firma: number,
) {
  const [ancho, setAncho] = useState(0);
  const [desborda, setDesborda] = useState(false);

  useEffect(() => {
    const nodo = board.current;
    if (!nodo) return;

    const medir = () => {
      /* La caja de adentro mide lo que se puede desplazar más lo que entra en
         pantalla: así el recorrido de la barra es igual al del board y el pulgar
         llega al final justo cuando se ve la última columna. Lo que sobra o
         falta no se calcula a mano porque el relleno del board ya viene dentro
         de su `scrollWidth`. */
      const recorrido = nodo.scrollWidth - nodo.clientWidth;
      setAncho(recorrido + (barra.current?.clientWidth ?? 0));
      // Un pixel de tolerancia: los anchos del navegador vienen con decimales y
      // sin el margen aparecía una barra que no tenía nada para desplazar.
      setDesborda(recorrido > 1);
    };

    medir();
    /* Las dos cajas se miran: el board porque de ahí sale el recorrido, y la
       barra porque cuando pasa de escondida a visible recién ahí se sabe cuánto
       mide la parte que entra en pantalla. */
    const observer = new ResizeObserver(medir);
    observer.observe(nodo);
    if (barra.current) observer.observe(barra.current);
    return () => observer.disconnect();
  }, [barra, board, firma]);

  /*
    Manda uno solo a la vez: el que el dedo —o el mouse— está moviendo. El otro
    lo copia y se queda callado; los `scroll` que dispara esa copia son un eco y
    no se contestan.

    Sin esto el celular se trababa al deslizar las columnas. El scroll del dedo
    lo lleva el compositor, aparte del hilo donde corre este código, así que el
    evento llega tarde y con una posición ya vieja: la barra le contestaba al
    board con ese valor atrasado y el board volvía para atrás. Y un `scrollLeft`
    escrito a mano en pleno envión no es un retoque, es un freno de mano: el
    navegador da por terminado el desplazamiento del dedo y lo deja clavado.

    Vale también para el otro lado: mientras se arrastra la barra, el imán de
    `.snap-tactil` acomoda la posición escrita a la columna más cercana, y ese
    ajuste volviendo a la barra le haría dar saltitos al pulgar abajo del
    cursor.
  */
  const mando = useRef<{ quien: Caja | null; cuando: number }>({ quien: null, cuando: 0 });

  const copiar = (quien: Caja, desde: HTMLDivElement | null, hacia: HTMLDivElement | null) => {
    if (!desde || !hacia) return;

    const ahora = Date.now();
    if (mando.current.quien && mando.current.quien !== quien && ahora - mando.current.cuando < 150) {
      return;
    }
    mando.current = { quien, cuando: ahora };

    /* Un pixel de tolerancia: las dos cajas miden en decimales que no caen
       iguales, y sin el margen se escribían posiciones de ida y vuelta por
       diferencias que nadie ve. */
    if (Math.abs(hacia.scrollLeft - desde.scrollLeft) <= 1) return;
    hacia.scrollLeft = desde.scrollLeft;
  };

  return {
    ancho,
    desborda,
    alScrollearElBoard: () => copiar("board", board.current, barra.current),
    alScrollearLaBarra: () => copiar("barra", barra.current, board.current),
  };
}

export function PipelinePanel({
  pipelines,
  stages: todasLasEtapas,
  opportunities: todasLasOportunidades,
  contacts,
  tareas,
  timezone,
  onNotice,
  onOpenLead,
  onOpenTareas,
}: {
  pipelines: PipelineRow[];
  stages: StageRow[];
  opportunities: OpportunityRow[];
  contacts: ContactRow[];
  /** Mis tareas pendientes: cada tarjeta muestra la próxima de su lead. */
  tareas: TareaRow[];
  /** Zona del workspace: con ella se decide en qué día entró cada lead. */
  timezone: string;
  onNotice: (message: string) => void;
  onOpenLead: (contactId: string) => void;
  /** Lleva a la sección Tareas. */
  onOpenTareas: () => void;
}) {
  const access = useAccess();
  const ahora = useAhora();
  // A qué lead se le está cargando una tarea desde su tarjeta.
  const [tareaPara, setTareaPara] = useState<{ id: string; name: string } | null>(null);

  // La próxima tarea de cada lead. Vienen ordenadas por vencimiento, así que
  // la primera que aparece de cada uno es la más urgente.
  const proximaTarea = useMemo(() => {
    const porLead = new Map<string, TareaRow>();
    for (const tarea of tareas) {
      if (tarea.contactId && !porLead.has(tarea.contactId)) porLead.set(tarea.contactId, tarea);
    }
    return porLead;
  }, [tareas]);
  const [showForm, setShowForm] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showEmbudos, setShowEmbudos] = useState(false);
  const [embudoElegido, setEmbudoElegido] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [viewing, setViewing] = useState<StageRow | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [filtro, setFiltro] = useState<FiltroPipeline>(FILTRO_PIPELINE_VACIO);
  const [showFiltros, setShowFiltros] = useState(false);

  // La tarjeta salta de columna apenas se suelta, sin esperar al servidor.
  // Si la acción falla, la entrada se borra y la tarjeta vuelve sola.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  /* Un embudo por vez. Todo lo de abajo —columnas, tarjetas, filtros, arrastre—
     ve sólo el embudo activo, así el tablero no cambió: lo que cambió es cuál
     le toca mirar. El elegido se guarda aparte del listado para que borrar un
     embudo o recargar la página caiga sola en el primero en vez de dejar la
     pantalla en blanco. */
  const embudo = pipelines.find((p) => p.id === embudoElegido) ?? pipelines[0] ?? null;
  const stages = todasLasEtapas.filter((stage) => stage.pipelineId === embudo?.id);

  const deEsteEmbudo = new Set(stages.map((stage) => stage.id));
  const opportunities = todasLasOportunidades.filter((item) => deEsteEmbudo.has(item.stageId));

  /* Quién puede "volver" al embudo: los contactos sin tarjeta en ninguno. Se
     mira contra todas las oportunidades y no contra las del embudo activo,
     porque alguien que está en Posventa no es alguien a quien haya que dar de
     alta de nuevo. */
  const conTarjeta = new Set(todasLasOportunidades.map((item) => item.contactId));
  const sinTarjeta = contacts.filter((contact) => !conTarjeta.has(contact.id));

  const stageOf = (item: OpportunityRow) => moved[item.id] ?? item.stageId;

  const openStages = stages.filter((stage) => stage.kind === "open");
  const closedStages = stages.filter((stage) => stage.kind !== "open");

  const board = useRef<HTMLDivElement | null>(null);
  const barraArriba = useRef<HTMLDivElement | null>(null);
  const barra = useBarraDeArriba(board, barraArriba, openStages.length);

  /* Los filtros recortan las tarjetas sin tocar las columnas: el embudo se sigue
     leyendo igual y las etapas vacías siguen aceptando soltado, que es lo que
     uno quiere cuando busca un lead justamente para moverlo de lugar. */
  const filtrando = filtraAlgo(filtro);
  const puestos = filtrosPuestos(filtro);

  const visible = useMemo(
    () =>
      opportunities.filter((item) =>
        pasaElFiltro(
          {
            contactName: item.contactName,
            contactPhone: item.contactPhone,
            channels: item.channels,
            assignedTo: item.assignedTo,
            dia: item.createdAt ? dayKeyInZone(item.createdAt, timezone) : "",
          },
          filtro,
        ),
      ),
    [opportunities, filtro, timezone],
  );

  const selectedSet = new Set(selected);
  // Sólo se puede borrar lo que se está viendo: si un lead quedó fuera del
  // filtro, tampoco entra en la selección que se manda a eliminar.
  const chosen = visible.filter((item) => selectedSet.has(item.id));

  const toggleCard = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  /** Marca o desmarca de un saque toda una columna. */
  const toggleColumn = (stageId: string) => {
    const ids = visible
      .filter((item) => stageOf(item) === stageId)
      .map((item) => item.id);
    const todas = ids.length > 0 && ids.every((id) => selectedSet.has(id));
    setSelected((current) =>
      todas
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])],
    );
  };

  const leaveSelection = () => {
    setSelecting(false);
    setSelected([]);
  };

  const move = (opportunityId: string, stageId: string, stageName: string) => {
    const previous = opportunities.find((item) => item.id === opportunityId);
    if (!previous || stageOf(previous) === stageId) return;

    setMoved((current) => ({ ...current, [opportunityId]: stageId }));
    startTransition(async () => {
      const result = await updateOpportunityStage({ id: opportunityId, stageId });
      if (result.ok) {
        onNotice(`Movida a ${stageName}.`);
      } else {
        setMoved((current) => {
          const next = { ...current };
          delete next[opportunityId];
          return next;
        });
        onNotice(result.error);
      }
    });
  };

  const drop = (event: DragEvent<HTMLDivElement>, stage: StageRow) => {
    event.preventDefault();
    setHovered(null);
    setDragging(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (id) move(id, stage.id, stage.name);
  };

  /* Lo que no se usa todos los días: de `sm` para arriba son tres botones a la
     derecha, y en el celular los renglones del menú `⋯`. */
  const acciones: AccionDeEmbudo[] = [
    ...(access.can("eliminar_contactos")
      ? [
          {
            Icono: CheckSquare,
            etiqueta: selecting ? "Cancelar" : "Eliminar varios",
            activa: selecting,
            alTocar: () => (selecting ? leaveSelection() : setSelecting(true)),
          },
        ]
      : []),
    ...(access.can("editar_embudo")
      ? [
          { Icono: Layers, etiqueta: "Embudos", alTocar: () => setShowEmbudos(true) },
          { Icono: Settings2, etiqueta: "Editar columnas", alTocar: () => setShowEditor(true) },
        ]
      : []),
  ];

  return (
    <>
      {/*
        La barra de arriba del board.

        De `sm` para arriba es la de siempre: buscador, embudo y filtros a la
        izquierda, las acciones contra el borde derecho. En el celular eso se
        desarmaba: el buscador y el selector se llevaban un renglón cada uno y
        los cinco botones se envolvían pegados a la derecha en dos o tres
        renglones más, desparejos y de distinto largo. Eran casi dos tercios de
        pantalla de controles arriba de las columnas, que es lo único que de
        verdad se mira en esta sección.

        Así que abajo de `sm` —y sólo ahí— se acomoda en dos renglones:

            [ buscar ................. ] [ filtros ] [ ⋯ ]
            [ embudo ................. ] [ + nuevo lead ]

        Todo lo del celular entra como agregado `max-sm:` sobre las clases de
        antes: el orden del DOM, los anchos y los tres botones sueltos quedan
        igual que siempre de `sm` para arriba, donde no había nada que arreglar.
      */}
      <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
        {/* El buscador va pegado al borde izquierdo del board y los botones
            quedan del otro lado: es lo primero que se lee al entrar y no
            compite por lugar con las acciones. En el celular comparte el
            renglón con filtros y el menú —se estira con lo que sobra— en vez de
            llevarse el ancho entero para él. */}
        <div className="relative w-full min-w-0 max-sm:order-1 max-sm:flex-1 max-sm:basis-40 sm:w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            aria-label="Buscar leads en el embudo"
            value={filtro.texto}
            onChange={(event) => setFiltro({ ...filtro, texto: event.target.value })}
            placeholder="Buscar por nombre o teléfono"
            className={`${INPUT_CLASS} py-2.5 pl-10 pr-9 text-sm`}
          />
          {filtro.texto.length > 0 && (
            <button
              type="button"
              onClick={() => setFiltro({ ...filtro, texto: "" })}
              aria-label="Limpiar la búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* El selector aparece recién con el segundo embudo: con uno solo sería
            un control que no hace nada, y la pantalla de antes no tenía por qué
            cambiar para quien no los usa. */}
        {pipelines.length > 1 && (
          <select
            value={embudo?.id ?? ""}
            onChange={(event) => setEmbudoElegido(event.target.value)}
            aria-label="Embudo"
            className={`${INPUT_CLASS} w-full cursor-pointer py-2.5 text-sm font-semibold max-sm:order-4 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-40 sm:w-52`}
          >
            {pipelines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}

        {/* El resto de los filtros vive en un popup y no en la barra: son tres
            controles que se usan de vez en cuando, y desplegados le comían al
            board media pantalla de alto justo arriba de las columnas. El número
            en el botón es lo que evita el malentendido de un embudo filtrado
            que se ve igual que un embudo vacío; en el celular queda sólo el
            ícono con ese número, porque la palabra al lado del buscador no
            aclaraba nada y ahí el lugar es lo que falta. */}
        <button
          onClick={() => setShowFiltros(true)}
          aria-label={puestos > 0 ? `Filtros (${puestos} puestos)` : "Filtros"}
          className={`${SECONDARY_BUTTON_CLASS} max-sm:order-2 max-sm:px-3 sm:mr-auto ${
            puestos > 0 ? TOOLBAR_TONES.on : TOOLBAR_TONES.off
          }`}
        >
          <SlidersHorizontal className="mr-1.5 inline size-4 align-[-3px] max-sm:mr-0" />
          <span className="max-sm:hidden">Filtros</span>
          {puestos > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-neutral-950">
              {puestos}
            </span>
          )}
        </button>

        {/* Las acciones de administración, en el celular, adentro de un botón
            del ancho de un ícono. */}
        {acciones.length > 0 && <MenuDeAcciones acciones={acciones} />}

        {/* Los mismos botones del menú, sueltos: de `sm` para arriba hay lugar y
            esconder un clic atrás de otro sería trabajo de más. */}
        {acciones.map((accion) => (
          <button
            key={accion.etiqueta}
            onClick={accion.alTocar}
            className={`${SECONDARY_BUTTON_CLASS} max-sm:hidden ${
              accion.activa ? TOOLBAR_TONES.on : TOOLBAR_TONES.off
            }`}
          >
            <accion.Icono className="mr-1.5 inline size-4 align-[-3px]" />
            {accion.etiqueta}
          </button>
        ))}

        <NewOpportunityButton onOpen={() => setShowForm(true)} />
      </div>

      {/* Las columnas se dibujan aunque el embudo esté vacío: son la estructura
          de trabajo, no un resumen de lo que hay adentro. Antes se escondían
          cuando no había oportunidades, y con el embudo editable eso dejaba la
          pantalla en blanco justo cuando había que armarlo. */}
      {stages.length === 0 ? (
        <Card>
          <EmptyState
            icon={LineChart}
            title="El embudo no tiene columnas"
            description="Falta correr las migraciones del embudo en Supabase: son las que crean los embudos y sus columnas."
          />
        </Card>
      ) : (
        <>
          {filtrando && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-white/[.04]">
              <span>
                {visible.length === 0
                  ? "Ningún lead del embudo entra en el filtro."
                  : `${visible.length} de ${opportunities.length} ${
                      opportunities.length === 1 ? "lead" : "leads"
                    } entran en el filtro.`}
              </span>
              <button
                type="button"
                onClick={() => setFiltro(FILTRO_PIPELINE_VACIO)}
                className="cursor-pointer font-medium underline-offset-2 hover:underline"
              >
                Limpiar todo
              </button>
            </div>
          )}

          {opportunities.length === 0 && (
            <div className="mb-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-white/[.04]">
              {contacts.length === 0
                ? "Todavía no hay leads. Cargá un contacto y entra solo a la primera columna."
                : "Todavía no hay leads en el embudo. Creá una oportunidad o esperá a que entre un mensaje."}
            </div>
          )}

          {/* Las columnas abiertas scrollean; las cerradas quedan ancladas a la
              derecha. Antes se iban con el scroll y había que arrastrar media
              pantalla para cerrar una operación.

              En escritorio el board ocupa el alto que queda libre en pantalla y
              las columnas se estiran hasta abajo, así cada una es un destino de
              soltado grande de verdad. Eso dejaba la barra de desplazamiento
              horizontal al pie de la pantalla: con el embudo cargado quedaba
              lejos de las columnas y había que bajar a buscarla, así que ahora
              el board esconde la suya y la finita va arriba (`useBarraDeArriba`).
              Sólo se muestra cuando las columnas no entran: si entran todas no
              hay nada que desplazar y una barra de adorno sería ruido. */}
          <div className="flex flex-col gap-4 lg:min-h-[max(26rem,calc(100dvh-17rem))] lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Siempre montada —se oculta con una clase— para no perder la
                  posición: desmontarla la haría volver en cero y el pulgar
                  mentiría la parte del embudo que se está mirando.

                  El alto mínimo es para poder agarrarla: adentro no hay nada
                  más que una caja del ancho total de las columnas, así que
                  donde el navegador dibuja la barra encima del contenido
                  —macOS— quedaba una tira de un pixel. Es mínimo y no fijo
                  porque donde la barra ocupa lugar propio es ella la que manda
                  el alto, y recortarla sería peor.

                  En pantallas táctiles no se dibuja —`.barra-de-arrastre`—: ahí
                  las columnas se empujan con el dedo y esto era sólo alto
                  gastado arriba de ellas. */}
              <div
                ref={barraArriba}
                onScroll={barra.alScrollearLaBarra}
                aria-hidden
                className={`barra-de-arrastre barra-fina min-h-2.5 overflow-x-auto ${
                  barra.desborda ? "mb-2" : "hidden"
                }`}
              >
                <div style={{ width: barra.ancho }} className="h-px" />
              </div>
              <div
                ref={board}
                onScroll={barra.alScrollearElBoard}
                className="sin-barra snap-tactil -mx-1 flex min-w-0 flex-1 gap-4 overflow-x-auto px-1"
              >
                {openStages.map((stage) => {
                  const items = visible.filter((item) => stageOf(item) === stage.id);
                  const total = items.reduce((sum, item) => sum + item.value, 0);
                  const active = hovered === stage.id && dragging !== null;

                  return (
                    <div
                      key={stage.id}
                      onDragOver={(event) => {
                        // Sin `preventDefault` el navegador rechaza el soltado.
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setHovered(stage.id);
                      }}
                      onDragLeave={() =>
                        setHovered((current) => (current === stage.id ? null : current))
                      }
                      onDrop={(event) => drop(event, stage)}
                      className={`w-72 shrink-0 snap-start rounded-xl p-4 transition-colors ${
                        active
                          ? "bg-amber-50 outline-2 outline-dashed outline-amber-500 dark:bg-amber-400/10"
                          : COLUMN_TONES[stage.kind]
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {selecting && items.length > 0 && (
                            <input
                              type="checkbox"
                              checked={items.every((item) => selectedSet.has(item.id))}
                              onChange={() => toggleColumn(stage.id)}
                              aria-label={`Seleccionar toda la columna ${stage.name}`}
                              className="size-4 shrink-0 cursor-pointer accent-amber-500"
                            />
                          )}
                          <p className="truncate text-sm font-semibold">{stage.name}</p>
                        </div>
                        <span className="text-xs text-neutral-500">{items.length}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">{money(total)}</p>
                      <div className="mt-4 space-y-3">
                        {items.map((item) => (
                          <OpportunityCard
                            key={item.id}
                            opportunity={item}
                            dragging={dragging === item.id}
                            selecting={selecting}
                            selected={selectedSet.has(item.id)}
                            onToggleSelected={() => toggleCard(item.id)}
                            onDragState={setDragging}
                            onOpenLead={onOpenLead}
                            proximaTarea={proximaTarea.get(item.contactId)}
                            ahora={ahora}
                            timezone={timezone}
                            onNuevaTarea={() =>
                              setTareaPara({ id: item.contactId, name: item.contactName })
                            }
                            onVerTareas={onOpenTareas}
                          />
                        ))}
                        {items.length === 0 && (
                          <p className="text-xs text-neutral-400">
                            {active ? "Soltá acá" : filtrando ? "Sin coincidencias" : "Vacío"}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {closedStages.length > 0 && (
              <div className="grid shrink-0 grid-cols-2 gap-4 lg:w-56 lg:grid-cols-1 lg:content-start">
                {closedStages.map((stage) => {
                  const items = visible.filter((item) => stageOf(item) === stage.id);
                  return (
                    <PinnedStage
                      key={stage.id}
                      stage={stage}
                      items={items}
                      filtering={filtrando}
                      active={hovered === stage.id && dragging !== null}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setHovered(stage.id);
                      }}
                      onDragLeave={() =>
                        setHovered((current) => (current === stage.id ? null : current))
                      }
                      onDrop={(event) => drop(event, stage)}
                      onOpen={() => setViewing(stage)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {selecting && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 px-4 py-3 dark:bg-white/[.04]">
              <span className="text-sm text-neutral-500">
                {selected.length === 0
                  ? "Marcá tarjetas, o el casillero del título para toda una columna."
                  : `${selected.length} ${selected.length === 1 ? "tarjeta seleccionada" : "tarjetas seleccionadas"}`}
              </span>
              {/* Salir de la selección, sólo en el celular: ahí el botón que la
                  abrió quedó adentro del menú `⋯`, y la salida tiene que estar
                  donde se está trabajando. */}
              <button
                type="button"
                onClick={leaveSelection}
                className="ml-auto cursor-pointer text-sm font-medium text-neutral-500 underline-offset-2 hover:underline sm:hidden"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setConfirming(true)}
                className="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
              >
                <Trash2 className="mr-1.5 inline size-4 align-[-3px]" />
                Eliminar {selected.length > 0 && `(${selected.length})`}
              </button>
            </div>
          )}

          <p className="mt-4 text-xs text-neutral-400">
            Arrastrá una tarjeta a otra columna para moverla. Ganado y Perdido
            quedan siempre a la vista: soltá ahí para cerrar, o tocá para ver qué
            hay adentro. Desde el celular, abrí la tarjeta y cambiá la etapa
            desde la ficha.
          </p>
        </>
      )}

      {showForm && (
        <NuevoLeadModal
          stages={stages}
          sinTarjeta={sinTarjeta}
          close={() => setShowForm(false)}
          onSaved={(mensaje) => {
            setShowForm(false);
            onNotice(mensaje);
          }}
        />
      )}

      {tareaPara && (
        <TareaModal
          tarea={null}
          contactoFijo={tareaPara}
          close={() => setTareaPara(null)}
          onSaved={(mensaje) => {
            setTareaPara(null);
            onNotice(mensaje);
          }}
        />
      )}

      {viewing && (
        <StageLeadsModal
          stage={viewing}
          items={visible.filter((item) => stageOf(item) === viewing.id)}
          filtering={filtrando}
          close={() => setViewing(null)}
          onOpenLead={(contactId) => {
            setViewing(null);
            onOpenLead(contactId);
          }}
        />
      )}

      {confirming && chosen.length > 0 && (
        <DeleteLeadsModal
          leads={chosen}
          close={() => setConfirming(false)}
          onDone={(message) => {
            setConfirming(false);
            leaveSelection();
            onNotice(message);
          }}
        />
      )}

      {showFiltros && (
        <FiltrosModal
          filtro={filtro}
          onCambiar={setFiltro}
          close={() => setShowFiltros(false)}
        />
      )}

      {showEditor && embudo && (
        <PipelineEditor
          pipelineId={embudo.id}
          pipelineName={embudo.name}
          stages={stages}
          opportunities={opportunities}
          close={() => setShowEditor(false)}
          onNotice={onNotice}
        />
      )}

      {showEmbudos && (
        <EmbudosModal
          pipelines={pipelines}
          stages={todasLasEtapas}
          opportunities={todasLasOportunidades}
          close={() => setShowEmbudos(false)}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ embudos */

/**
 * Alta, renombrado, reordenado y borrado de embudos.
 *
 * El orden importa más de lo que parece y por eso se dice en pantalla: el
 * primero es donde caen los leads que entran por chat, por importación o
 * cargados a mano. Es la misma regla que la primera columna adentro de cada
 * embudo, para que haya una sola que recordar.
 */
function EmbudosModal({
  pipelines,
  stages,
  opportunities,
  close,
  onNotice,
}: {
  pipelines: PipelineRow[];
  stages: StageRow[];
  opportunities: OpportunityRow[];
  close: () => void;
  onNotice: (message: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) => {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) done?.();
      else setError(result.error);
    });
  };

  /** Cuántos leads hay adentro de un embudo, para avisar antes de borrarlo. */
  const leadsDe = (pipelineId: string) => {
    const suyas = new Set(
      stages.filter((stage) => stage.pipelineId === pipelineId).map((stage) => stage.id),
    );
    return opportunities.filter((item) => suyas.has(item.stageId)).length;
  };

  const mover = (index: number, direccion: -1 | 1) => {
    const destino = index + direccion;
    if (destino < 0 || destino >= pipelines.length) return;
    const ids = pipelines.map((item) => item.id);
    [ids[index], ids[destino]] = [ids[destino], ids[index]];
    run(() => reorderPipelines({ ids }));
  };

  const agregar = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => createPipeline({ name: nombre }),
      () => {
        setNombre("");
        onNotice("Embudo creado, con sus columnas de entrada, ganado y perdido.");
      },
    );
  };

  return (
    <Modal title="Embudos" onClose={close}>
      <p className="mt-5 text-sm leading-6 text-neutral-500">
        Cada embudo tiene sus propias columnas. El primero es donde caen los leads
        nuevos: los que entran por chat, los que se importan y los que se cargan a
        mano.
      </p>

      <ul className="mt-4 space-y-2">
        {pipelines.map((item, index) => (
          <EmbudoRow
            key={item.id}
            pipeline={item}
            pipelines={pipelines}
            leads={leadsDe(item.id)}
            esEntrada={index === 0}
            esUltimo={index === pipelines.length - 1}
            soloUno={pipelines.length === 1}
            pending={pending}
            onSubir={() => mover(index, -1)}
            onBajar={() => mover(index, 1)}
            onRun={run}
            onNotice={onNotice}
          />
        ))}
      </ul>

      <form onSubmit={agregar} className="mt-4 flex gap-2">
        <input
          aria-label="Nombre del nuevo embudo"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          maxLength={40}
          placeholder="Nuevo embudo"
          className={`${INPUT_CLASS} flex-1`}
        />
        <button type="submit" disabled={pending || !nombre.trim()} className={PRIMARY_BUTTON_CLASS}>
          <Plus className="size-4" />
          Agregar
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}

function EmbudoRow({
  pipeline,
  pipelines,
  leads,
  esEntrada,
  esUltimo,
  soloUno,
  pending,
  onSubir,
  onBajar,
  onRun,
  onNotice,
}: {
  pipeline: PipelineRow;
  pipelines: PipelineRow[];
  leads: number;
  esEntrada: boolean;
  esUltimo: boolean;
  soloUno: boolean;
  pending: boolean;
  onSubir: () => void;
  onBajar: () => void;
  onRun: (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) => void;
  onNotice: (message: string) => void;
}) {
  const [nombre, setNombre] = useState(pipeline.name);
  const [borrando, setBorrando] = useState(false);
  const otros = pipelines.filter((item) => item.id !== pipeline.id);
  const [destino, setDestino] = useState(otros[0]?.id ?? "");

  const renombrar = () => {
    const limpio = nombre.trim();
    if (!limpio || limpio === pipeline.name) {
      setNombre(pipeline.name);
      return;
    }
    onRun(
      () => renamePipeline({ id: pipeline.id, name: limpio }),
      () => onNotice("Embudo renombrado."),
    );
  };

  return (
    <li className="rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`Nombre de ${pipeline.name}`}
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          onBlur={renombrar}
          maxLength={40}
          className={`${INPUT_CLASS} min-w-40 flex-1`}
        />
        <span className="text-sm text-neutral-500">
          {leads} {leads === 1 ? "lead" : "leads"}
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onSubir}
            disabled={pending || esEntrada}
            aria-label="Subir"
            className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:opacity-30 dark:hover:bg-white/10"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={onBajar}
            disabled={pending || esUltimo}
            aria-label="Bajar"
            className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:opacity-30 dark:hover:bg-white/10"
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setBorrando(true)}
            disabled={pending || soloUno}
            aria-label={`Borrar ${pipeline.name}`}
            title={soloUno ? "Tiene que quedar al menos un embudo." : undefined}
            className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-30 dark:hover:bg-red-500/10"
          >
            <Trash2 className="size-4" />
          </button>
        </span>
      </div>

      {esEntrada && (
        <p className="mt-2 text-xs text-neutral-500">
          Acá caen los leads nuevos. Para cambiarlo, subí otro embudo a este lugar.
        </p>
      )}

      {borrando && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm dark:bg-red-500/10">
          {leads > 0 ? (
            <>
              <p className="text-red-800 dark:text-red-200">
                Tiene {leads} {leads === 1 ? "lead adentro" : "leads adentro"}. No se
                borran: pasan a la columna de entrada del embudo que elijas.
              </p>
              <select
                value={destino}
                onChange={(event) => setDestino(event.target.value)}
                aria-label="Embudo de destino"
                className={`${INPUT_CLASS} mt-2 w-full cursor-pointer`}
              >
                {otros.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-red-800 dark:text-red-200">
              Se borra el embudo con todas sus columnas. No tiene leads adentro.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                onRun(
                  () =>
                    deletePipeline({
                      id: pipeline.id,
                      moveToId: leads > 0 ? destino : undefined,
                    }),
                  () => {
                    setBorrando(false);
                    onNotice("Embudo borrado.");
                  },
                )
              }
              className="cursor-pointer rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Borrar
            </button>
            <button
              type="button"
              onClick={() => setBorrando(false)}
              className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ filtros */

const CANALES: Channel[] = ["whatsapp", "instagram", "messenger"];

/**
 * Los filtros del embudo, en un popup.
 *
 * Se aplican mientras se tocan y no al cerrar: el número de arriba del board
 * cambia en el momento, así se ve enseguida si el filtro dejó demasiado poco.
 * Por eso tampoco hay botón de "Aplicar" — sólo se cierra.
 */
function FiltrosModal({
  filtro,
  onCambiar,
  close,
}: {
  filtro: FiltroPipeline;
  onCambiar: (filtro: FiltroPipeline) => void;
  close: () => void;
}) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);

  useEffect(() => {
    let vigente = true;
    // Los responsables se piden recién al abrir el popup: en el board no se
    // usan para nada, y el dashboard ya carga bastante de entrada.
    loadWorkspaceUsers().then((result) => {
      if (vigente && result.ok) setUsers(result.users);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const alternar = <T extends string>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor];

  return (
    <Modal title="Filtrar el embudo" onClose={close}>
      <div className="mt-5 space-y-5">
        <div>
          <p className="text-xs font-medium text-neutral-500">Responsable</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <FiltroChip
              activo={filtro.responsables.includes(SIN_ASIGNAR)}
              onClick={() =>
                onCambiar({
                  ...filtro,
                  responsables: alternar(filtro.responsables, SIN_ASIGNAR),
                })
              }
            >
              Sin asignar
            </FiltroChip>
            {users.map((user) => (
              <FiltroChip
                key={user.userId}
                activo={filtro.responsables.includes(user.userId)}
                onClick={() =>
                  onCambiar({
                    ...filtro,
                    responsables: alternar(filtro.responsables, user.userId),
                  })
                }
              >
                {user.email}
              </FiltroChip>
            ))}
          </div>
          {users.length === 0 && (
            <p className="mt-2 text-xs text-neutral-400">Buscando a los del workspace…</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-neutral-500">Canal por el que escribió</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CANALES.map((canal) => (
              <FiltroChip
                key={canal}
                activo={filtro.canales.includes(canal)}
                onClick={() => onCambiar({ ...filtro, canales: alternar(filtro.canales, canal) })}
              >
                {CHANNEL_LABELS[canal]}
              </FiltroChip>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            Un lead cargado a mano no escribió por ningún canal: con esto puesto queda afuera.
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-neutral-500">Fecha de alta del lead</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-xs text-neutral-500">
              Desde
              <input
                type="date"
                value={filtro.desde ?? ""}
                onChange={(event) => onCambiar({ ...filtro, desde: event.target.value || null })}
                className={`${INPUT_CLASS} mt-1 py-2 text-sm`}
              />
            </label>
            <label className="text-xs text-neutral-500">
              Hasta
              <input
                type="date"
                value={filtro.hasta ?? ""}
                onChange={(event) => onCambiar({ ...filtro, hasta: event.target.value || null })}
                className={`${INPUT_CLASS} mt-1 py-2 text-sm`}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => onCambiar({ ...FILTRO_PIPELINE_VACIO, texto: filtro.texto })}
          className="mr-auto cursor-pointer text-sm text-neutral-500 underline-offset-2 hover:underline"
        >
          Limpiar filtros
        </button>
        <button type="button" onClick={close} className={PRIMARY_BUTTON_CLASS}>
          Ver el embudo
        </button>
      </div>
    </Modal>
  );
}

function FiltroChip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`max-w-full cursor-pointer truncate rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        activo
          ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
          : "border-[#ddd8c9] text-neutral-600 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Ya no exige tener contactos cargados: el alta crea a la persona y su tarjeta
 * en el mismo paso, así que "primero cargá un contacto" era un rodeo para algo
 * que el propio botón resuelve.
 */
function NewOpportunityButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      /* En el celular comparte el segundo renglón con el selector de embudo, y
         si no hay selector se lleva el renglón entero. */
      className={`${PRIMARY_BUTTON_CLASS} max-sm:order-5 max-sm:flex-1 max-sm:basis-32`}
    >
      <Plus className="size-4" />
      Nuevo lead
    </button>
  );
}

/**
 * Las acciones de administración del embudo, en un menú. Sólo en el celular.
 *
 * Son tres botones que se usan de vez en cuando —eliminar varios, embudos,
 * editar columnas— y sueltos en una pantalla angosta se envolvían en dos
 * renglones más de barra arriba de las columnas. Acá entran en el ancho de un
 * ícono; de `sm` para arriba el menú no existe y los tres siguen a la vista.
 *
 * Se cierra tocando afuera o con Escape, como el desplegable de Difusiones: en
 * el celular, un menú que se queda abierto tapa justamente la primera columna.
 */
function MenuDeAcciones({ acciones }: { acciones: AccionDeEmbudo[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;

    const afuera = (event: MouseEvent) => {
      if (!caja.current?.contains(event.target as Node)) setAbierto(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };

    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", afuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const prendida = acciones.some((accion) => accion.activa);

  return (
    <div ref={caja} className="relative order-3 sm:hidden">
      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-label="Más acciones del embudo"
        aria-expanded={abierto}
        aria-haspopup="menu"
        className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center px-3 ${
          prendida ? TOOLBAR_TONES.on : TOOLBAR_TONES.off
        }`}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {abierto && (
        /* Se abre hacia la izquierda: el botón queda contra el borde derecho de
           la pantalla y un menú alineado al principio se sale de cuadro. */
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-60 rounded-xl border border-[#ddd8c9] bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          {acciones.map((accion) => (
            <button
              key={accion.etiqueta}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                accion.alTocar();
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-white/5 ${
                accion.activa ? "font-semibold text-amber-700 dark:text-amber-300" : ""
              }`}
            >
              <accion.Icono
                className={`size-4 shrink-0 ${accion.activa ? "" : "text-neutral-400"}`}
              />
              {accion.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Columna cerrada anclada al costado del board.
 *
 * No scrollea con el resto: cerrar una operación es lo último que pasa en el
 * embudo y tenía que quedar siempre a mano. Acepta soltado y, al tocarla,
 * abre la lista de lo que hay adentro.
 */
function PinnedStage({
  stage,
  items,
  filtering,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
}: {
  stage: StageRow;
  items: OpportunityRow[];
  filtering: boolean;
  active: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpen: () => void;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full cursor-pointer rounded-xl p-4 text-left transition-colors ${
          active
            ? "bg-amber-50 outline-2 outline-dashed outline-amber-500 dark:bg-amber-400/10"
            : `${COLUMN_TONES[stage.kind]} hover:brightness-95 dark:hover:brightness-125`
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{stage.name}</p>
          <span className="text-xs text-neutral-500">{items.length}</span>
        </div>
        <p
          className={`mt-1 text-lg font-semibold ${
            stage.kind === "won" ? "text-amber-700 dark:text-amber-400" : "text-neutral-500"
          }`}
        >
          {money(total)}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {active
            ? "Soltá acá"
            : items.length > 0
              ? "Tocá para ver"
              : filtering
                ? "Sin coincidencias"
                : "Vacío"}
        </p>
      </button>
    </div>
  );
}

/** Los leads de una columna cerrada, sin ocupar lugar en el board. */
function StageLeadsModal({
  stage,
  items,
  filtering,
  close,
  onOpenLead,
}: {
  stage: StageRow;
  items: OpportunityRow[];
  filtering: boolean;
  close: () => void;
  onOpenLead: (contactId: string) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <Modal title={stage.name} onClose={close}>
      {items.length === 0 ? (
        <p className="mt-5 text-sm text-neutral-500">
          {filtering
            ? "Ningún lead de esta columna coincide con la búsqueda."
            : "Todavía no hay leads en esta columna."}
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm text-neutral-500">
            {items.length} {items.length === 1 ? "lead" : "leads"} · {money(total)}
          </p>
          <ul className="mt-4 max-h-80 divide-y divide-neutral-100 overflow-y-auto dark:divide-white/10">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenLead(item.contactId)}
                  className="w-full cursor-pointer py-3 text-left"
                >
                  <strong className="block truncate text-sm hover:underline">
                    {item.contactName}
                  </strong>
                  <span className="text-xs text-neutral-500">{money(item.value)}</span>
                  <ChannelBadges channels={item.channels} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/** Los leads a borrar, con las dos salidas: sacarlos del embudo o borrarlos. */
function DeleteLeadsModal({
  leads,
  close,
  onDone,
}: {
  leads: OpportunityRow[];
  close: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const varias = leads.length > 1;

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) onDone(done);
      else setError(result.error);
    });
  };

  return (
    <Modal
      title={varias ? `Eliminar ${leads.length} tarjetas` : "Eliminar la tarjeta"}
      onClose={close}
    >
      <ul className="mt-5 max-h-32 overflow-y-auto rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-white/[.04] dark:text-neutral-300">
        {leads.map((lead) => (
          <li key={lead.id} className="truncate">
            {lead.contactName}
          </li>
        ))}
      </ul>

      {/* Dos acciones distintas que desde el board se parecen: la tarjeta es la
          oportunidad, no la persona. Se separan para que borrar un lead del
          embudo no se lleve puesto un historial de chat sin querer. */}
      <div className="mt-5 space-y-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => deleteOpportunities({ ids: leads.map((lead) => lead.id) }),
              varias
                ? `${leads.length} tarjetas salieron del embudo.`
                : "La tarjeta salió del embudo.",
            )
          }
          className="w-full cursor-pointer rounded-xl border border-[#ddd8c9] p-4 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
        >
          <span className="block text-sm font-semibold">Sacar del embudo</span>
          <span className="mt-1 block text-sm text-neutral-500">
            {varias ? "Los contactos siguen" : "El contacto sigue"} en el CRM con
            {varias ? " sus chats" : " su chat"} y {varias ? "sus turnos" : "su turno"}. Sólo
            desaparece{varias ? "n" : ""} del Pipeline.
          </span>
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => deleteContacts({ ids: leads.map((lead) => lead.contactId) }),
              varias
                ? `Se borraron ${leads.length} contactos.`
                : "El contacto se borró de la base.",
            )
          }
          className="w-full cursor-pointer rounded-xl border border-red-200 p-4 text-left transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:hover:bg-red-500/10"
        >
          <span className="block text-sm font-semibold text-red-700 dark:text-red-400">
            Borrar {varias ? "los contactos" : "el contacto"} de la base
          </span>
          <span className="mt-1 block text-sm text-neutral-500">
            Se lleva puesto todo: chats, mensajes, turnos y oportunidades. No se puede deshacer.
          </span>
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

function OpportunityCard({
  opportunity,
  dragging,
  selecting,
  selected,
  onToggleSelected,
  onDragState,
  onOpenLead,
  proximaTarea,
  ahora,
  timezone,
  onNuevaTarea,
  onVerTareas,
}: {
  opportunity: OpportunityRow;
  dragging: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onDragState: (id: string | null) => void;
  onOpenLead: (contactId: string) => void;
  /** Mi próxima tarea pendiente con este lead, si tengo alguna. */
  proximaTarea: TareaRow | undefined;
  ahora: Date;
  timezone: string;
  onNuevaTarea: () => void;
  onVerTareas: () => void;
}) {
  const vencida = proximaTarea
    ? grupoDeTarea(proximaTarea, ahora, timezone) === "vencidas"
    : false;

  return (
    <div
      draggable={!selecting}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, opportunity.id);
        event.dataTransfer.effectAllowed = "move";
        onDragState(opportunity.id);
      }}
      onDragEnd={() => onDragState(null)}
      className={`rounded-lg border bg-[#f9f8f3] p-3 text-sm shadow-sm transition-opacity dark:bg-[#1c1811] ${
        selecting ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      } ${
        selected
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-[#ddd8c9] dark:border-white/10"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={() => (selecting ? onToggleSelected() : onOpenLead(opportunity.contactId))}
        className="flex w-full cursor-pointer items-start gap-2 text-left"
      >
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Seleccionar a ${opportunity.contactName}`}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-500"
          />
        )}
        <span className="min-w-0 flex-1">
        <strong className="block truncate hover:underline">{opportunity.contactName}</strong>
        <span className="mt-1 block text-xs text-neutral-500">{money(opportunity.value)}</span>

        {/* El teléfono sólo si escribió por WhatsApp: en Instagram o Messenger
            no lo tenemos, y un renglón vacío en cada tarjeta es ruido. */}
        {opportunity.channels.includes("whatsapp") && opportunity.contactPhone && (
          <span className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
            <Phone className="size-3 shrink-0" />
            {opportunity.contactPhone}
          </span>
        )}

        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <ChannelBadges channels={opportunity.channels} />
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              opportunity.botEnabled
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
            }`}
            title={
              opportunity.botEnabled
                ? "La IA le contesta sola"
                : "La IA está frenada para este lead"
            }
          >
            {opportunity.botEnabled ? <Bot className="size-3" /> : <BotOff className="size-3" />}
            {opportunity.botEnabled ? "IA" : "IA off"}
          </span>
        </span>
        </span>
      </button>

      {/* Las tareas del lead, a mano desde el tablero: lo que falta hacer con
          él y cómo anotar lo próximo, sin abrir la ficha. Fuera del botón de
          arriba porque un botón no puede ir adentro de otro. Mientras se
          selecciona para borrar no aparece: ahí la tarjeta es una casilla. */}
      {!selecting && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-[#ddd8c9] pt-2 dark:border-white/10">
          {proximaTarea && (
            <button
              type="button"
              onClick={onVerTareas}
              title={`${proximaTarea.titulo} · ver en Tareas`}
              className={`flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                vencida ? "text-red-600 dark:text-red-400" : "text-neutral-500"
              }`}
            >
              <ListTodo className="size-3 shrink-0" aria-hidden />
              <span className="truncate" suppressHydrationWarning>
                {textoDeVencimiento(proximaTarea.venceAt, ahora, timezone)}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onNuevaTarea}
            aria-label={`Agregar una tarea para ${opportunity.contactName}`}
            title="Agregar una tarea"
            className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-white/5"
          >
            <ListPlus className="size-3.5" aria-hidden />
            Tarea
          </button>
        </div>
      )}
    </div>
  );
}

/** Alta, renombrado, reordenado y borrado de columnas de un embudo. */
function PipelineEditor({
  pipelineId,
  pipelineName,
  stages,
  opportunities,
  close,
  onNotice,
}: {
  pipelineId: string;
  pipelineName: string;
  stages: StageRow[];
  opportunities: OpportunityRow[];
  close: () => void;
  onNotice: (message: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const countOf = (stageId: string) =>
    opportunities.filter((item) => item.stageId === stageId).length;

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) => {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) done?.();
      else setError(result.error);
    });
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => createStage({ name: newName, pipelineId }),
      () => {
        setNewName("");
        onNotice("Columna agregada.");
      },
    );
  };

  // La columna de entrada se queda primera: nada puede subir por encima de
  // ella ni ella bajar.
  const swap = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 1 || target >= stages.length || index === 0) return;
    const ids = stages.map((stage) => stage.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderStages({ ids, pipelineId }));
  };

  return (
    <Modal title={`Columnas de "${pipelineName}"`} onClose={close}>
      <p className="mt-5 text-sm leading-6 text-neutral-500">
        Renombrá, reordená, agregá o sacá columnas. Tres son fijas y sólo se
        pueden renombrar: la de entrada, donde caen los leads nuevos, y las de
        ganado y perdido, que alimentan las métricas del panel.
      </p>

      <ul className="mt-4 space-y-2">
        {stages.map((stage, index) => (
          <StageEditorRow
            key={stage.id}
            stage={stage}
            stages={stages}
            count={countOf(stage.id)}
            isEntry={index === 0}
            isFirstMovable={index <= 1}
            isLast={index === stages.length - 1}
            pending={pending}
            onMoveUp={() => swap(index, -1)}
            onMoveDown={() => swap(index, 1)}
            onRun={run}
            onNotice={onNotice}
          />
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          aria-label="Nombre de la nueva columna"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={40}
          placeholder="Nueva columna"
          className={`${INPUT_CLASS} py-2.5 text-sm`}
        />
        <button disabled={pending || !newName.trim()} type="submit" className={`${PRIMARY_BUTTON_CLASS} shrink-0`}>
          <Plus className="size-4" />
          Agregar
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          Listo
        </button>
      </div>
    </Modal>
  );
}

function StageEditorRow({
  stage,
  stages,
  count,
  isEntry,
  isFirstMovable,
  isLast,
  pending,
  onMoveUp,
  onMoveDown,
  onRun,
  onNotice,
}: {
  stage: StageRow;
  stages: StageRow[];
  count: number;
  /** La columna de entrada: no se mueve ni se borra, sólo se renombra. */
  isEntry: boolean;
  isFirstMovable: boolean;
  isLast: boolean;
  pending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRun: (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: () => void,
  ) => void;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState(stage.name);
  const [confirming, setConfirming] = useState(false);
  // Entrada, ganado y perdido son estructurales: se renombran, no se borran.
  const locked = isEntry || stage.kind !== "open";
  const others = stages.filter((item) => item.id !== stage.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === stage.name) {
      setName(stage.name);
      return;
    }
    onRun(() => renameStage({ id: stage.id, name: trimmed }));
  };

  const remove = () => {
    onRun(
      () => deleteStage({ id: stage.id, moveToId: count > 0 ? moveTo : undefined }),
      () => {
        setConfirming(false);
        onNotice(`Columna "${stage.name}" eliminada.`);
      },
    );
  };

  return (
    <li className="rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10">
      <div className="flex items-center gap-2">
        <input
          aria-label={`Nombre de ${stage.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(stage.name);
          }}
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium outline-none transition focus:border-[#ddd8c9] focus:ring-2 focus:ring-amber-500 dark:focus:border-white/10"
        />
        {isEntry && (
          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500 dark:bg-white/10">
            Entrada
          </span>
        )}
        {stage.kind !== "open" && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              stage.kind === "won"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
                : "bg-neutral-100 text-neutral-500 dark:bg-white/10"
            }`}
          >
            {stage.kind === "won" ? "Ganada" : "Perdida"}
          </span>
        )}
        <span className="shrink-0 text-xs text-neutral-400">{count}</span>
        <button
          type="button"
          disabled={pending || isFirstMovable}
          onClick={onMoveUp}
          aria-label={`Subir ${stage.name}`}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          disabled={pending || isLast || isEntry}
          onClick={onMoveDown}
          aria-label={`Bajar ${stage.name}`}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
        >
          <ChevronDown className="size-4" />
        </button>
        <button
          type="button"
          disabled={pending || locked}
          onClick={() => setConfirming(true)}
          aria-label={`Eliminar ${stage.name}`}
          title={
            isEntry
              ? "Es la columna de entrada: acá caen los leads nuevos"
              : stage.kind !== "open"
                ? "Alimenta las métricas del panel y no se puede borrar"
                : "Eliminar columna"
          }
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-500/10"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {confirming && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3 dark:bg-white/[.04]">
          {count > 0 ? (
            <>
              <label className="block text-xs text-neutral-500" htmlFor={`move-${stage.id}`}>
                {count === 1 ? "Hay 1 lead adentro" : `Hay ${count} leads adentro`}. ¿A qué
                columna pasan?
              </label>
              <select
                id={`move-${stage.id}`}
                value={moveTo}
                onChange={(event) => setMoveTo(event.target.value)}
                className={`${INPUT_CLASS} mt-2 cursor-pointer py-2 text-sm`}
              >
                {others.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-xs text-neutral-500">La columna está vacía.</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="cursor-pointer rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Alta de un lead desde el embudo.
 *
 * Carga a la persona y le abre la tarjeta en un solo paso, que es lo que se
 * quiere hacer cuando alguien llega por fuera del chat: una recomendación, una
 * feria, una llamada. Antes esto era un selector de contactos ya cargados, y
 * como todo contacto entra al embudo apenas se lo crea, la lista eran los
 * mismos leads que ya estaban en el tablero: elegir uno le abría una segunda
 * tarjeta al mismo.
 *
 * El caso de traer a alguien que ya está en Contactos sigue existiendo, pero
 * sólo para los que quedaron sin tarjeta —a quien se la borraron desde el
 * embudo—, que es la única vez que tiene sentido.
 */
function NuevoLeadModal({
  stages,
  sinTarjeta,
  close,
  onSaved,
}: {
  stages: StageRow[];
  /** Contactos que hoy no tienen tarjeta en ningún embudo. */
  sinTarjeta: ContactRow[];
  close: () => void;
  onSaved: (mensaje: string) => void;
}) {
  const [modo, setModo] = useState<"nuevo" | "existente">("nuevo");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactId, setContactId] = useState(sinTarjeta[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result =
        modo === "nuevo"
          ? await createContact({
              name,
              phone,
              email,
              stageId,
              value: Number(value || 0),
              notes,
            })
          : await createOpportunity({
              contactId,
              stageId,
              value: Number(value || 0),
              notes,
            });

      if (result.ok) {
        onSaved(modo === "nuevo" ? "Lead cargado." : "El contacto volvió al embudo.");
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal title="Nuevo lead" onClose={close}>
      <form onSubmit={save}>
        {/* La segunda opción se ofrece sólo cuando hay a quién traer: con la
            lista vacía sería una pestaña que lleva a un selector sin nada. */}
        {sinTarjeta.length > 0 && (
          <div className="mt-5 flex gap-2">
            {(
              [
                ["nuevo", "Cargar uno nuevo"],
                ["existente", "Traer de Contactos"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setModo(valor)}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  modo === valor
                    ? "border-transparent bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "border-[#ddd8c9] text-neutral-500 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}

        {modo === "nuevo" ? (
          <>
            <label className="mt-5 block text-sm font-medium" htmlFor="lead-name">
              Nombre
            </label>
            <input
              id="lead-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              autoFocus
              placeholder="Lorena Cruz"
              className={`${INPUT_CLASS} mt-2`}
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium" htmlFor="lead-phone">
                  Teléfono <span className="font-normal text-neutral-400">(opcional)</span>
                </label>
                <input
                  id="lead-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+54 9 11 5555 5555"
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium" htmlFor="lead-email">
                  Email <span className="font-normal text-neutral-400">(opcional)</span>
                </label>
                <input
                  id="lead-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="lorena@ejemplo.com"
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="mt-5 block text-sm font-medium" htmlFor="lead-contact">
              Contacto
            </label>
            <select
              id="lead-contact"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className={`${INPUT_CLASS} mt-2 cursor-pointer`}
            >
              {sinTarjeta.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-neutral-500">
              Sólo aparecen los contactos que hoy no tienen tarjeta en ningún embudo.
            </p>
          </>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="lead-stage">
              Etapa
            </label>
            <select
              id="lead-stage"
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              className={`${INPUT_CLASS} mt-2 cursor-pointer`}
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
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
              placeholder="0"
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium" htmlFor="lead-notes">
          Notas <span className="font-normal text-neutral-400">(opcional)</span>
        </label>
        <textarea
          id="lead-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={`${INPUT_CLASS} mt-2 resize-y`}
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button disabled={pending} type="submit" className={PRIMARY_BUTTON_CLASS}>
            {pending ? "Guardando…" : "Crear lead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
