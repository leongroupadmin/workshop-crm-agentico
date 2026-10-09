"use client";

/**
 * El árbol de una automatización, dibujado.
 *
 * El editor apilado sigue existiendo y es el que se usa en el celular: un
 * lienzo con zoom y arrastre en una pantalla de teléfono es peor que una
 * lista. Acá la ventaja es otra —ver de un vistazo por dónde sale cada
 * camino—, y esa ventaja aparece recién cuando hay lugar para mostrarlo.
 *
 * El componente no sabe qué es un paso de plantilla ni cómo se edita: el
 * formulario, los nombres y los pasos nuevos llegan como props desde el panel,
 * que es quien los tiene. Sin eso, el panel importaría el lienzo y el lienzo
 * importaría al panel.
 */

import {
  ArrowRightLeft,
  Bell,
  BotOff,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  GitBranch,
  MessageSquare,
  Mic,
  Minus,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  contarPasos,
  describirEspera,
  escribirRuta,
  insertarEn,
  MAX_PASOS,
  MAX_PROFUNDIDAD,
  moverEn,
  pasoEn,
  quitarEn,
  reemplazarEn,
  type Paso,
  type Ruta,
  type TipoPaso,
} from "@/lib/automatizaciones";
import {
  ALTO_NODO,
  ANCHO_NODO,
  camino,
  disponer,
  puntoDeLaEtiqueta,
  puntoDelMas,
} from "@/lib/automatizaciones-lienzo";

const ICONO: Record<TipoPaso, typeof Clock> = {
  esperar: Clock,
  plantilla: MessageSquare,
  texto: MessageSquare,
  audio: Mic,
  ia: Sparkles,
  mover: ArrowRightLeft,
  avisar: Bell,
  meta: Target,
  asignar: Users,
  frenar_ia: BotOff,
  condicion: GitBranch,
};

const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 1.5;

/** Lo que el cajón de la derecha está mostrando. */
type Cajon =
  | { modo: "editar"; ruta: Ruta }
  | { modo: "agregar"; ruta: Ruta }
  | null;

export function Lienzo({
  pasos,
  minutos,
  nombreDelPaso,
  resumen,
  nuevoPaso,
  formulario,
  aviso,
  disparador,
  onChange,
}: {
  pasos: Paso[];
  /** Minutos desde el disparo hasta cada paso, por ruta escrita. */
  minutos: Map<string, number>;
  nombreDelPaso: Record<TipoPaso, string>;
  /** Una línea con lo que hace el paso, para la tarjeta. */
  resumen: (paso: Paso) => string;
  nuevoPaso: (tipo: TipoPaso) => Paso;
  /** El formulario del paso. Vive en el panel, que es quien lo sabe armar. */
  formulario: (paso: Paso, onChange: (paso: Paso) => void) => ReactNode;
  /** El aviso de "cae fuera de las 24 horas", si corresponde. */
  aviso: (paso: Paso, ruta: Ruta) => ReactNode;
  /** Qué dispara la automatización, en una línea. */
  disparador: string;
  onChange: (pasos: Paso[]) => void;
}) {
  const [cajon, setCajon] = useState<Cajon>(null);
  const [zoom, setZoom] = useState(1);
  const [desplazamiento, setDesplazamiento] = useState({ x: 0, y: 0 });
  const arrastre = useRef<{ x: number; y: number; desdeX: number; desdeY: number } | null>(null);

  const plano = useMemo(() => disponer(pasos), [pasos]);
  const total = contarPasos(pasos);

  /* El cajón guarda una ruta, y el árbol puede cambiar por abajo: el editor
     apilado del celular está montado al mismo tiempo y comparte el estado, así
     que de ahí puede desaparecer el paso que acá está abierto. Se descarta al
     renderizar en vez de sincronizarlo con un efecto, que además de una vuelta
     de más dejaría un fotograma mostrando el formulario de otro paso. */
  const abierto: Cajon =
    cajon?.modo === "editar" && !pasoEn(pasos, cajon.ruta) ? null : cajon;
  const seleccionada = abierto?.modo === "editar" ? escribirRuta(abierto.ruta) : null;

  // Centrar es volver el desplazamiento a cero: el dibujo ya nace centrado por
  // el `justify-center` del marco, así que no hay que medir nada.
  const centrar = () => {
    setZoom(1);
    setDesplazamiento({ x: 0, y: 0 });
  };

  const empezarArrastre = (evento: React.PointerEvent) => {
    // Sólo el fondo arrastra: desde una tarjeta o un botón, el gesto es un clic.
    if ((evento.target as HTMLElement).closest("[data-nodo]")) return;

    arrastre.current = {
      x: evento.clientX,
      y: evento.clientY,
      desdeX: desplazamiento.x,
      desdeY: desplazamiento.y,
    };
    evento.currentTarget.setPointerCapture(evento.pointerId);
  };

  const seguirArrastre = (evento: React.PointerEvent) => {
    const inicio = arrastre.current;
    if (!inicio) return;

    setDesplazamiento({
      x: inicio.desdeX + (evento.clientX - inicio.x),
      y: inicio.desdeY + (evento.clientY - inicio.y),
    });
  };

  const soltarArrastre = () => {
    arrastre.current = null;
  };

  const agregar = (tipo: TipoPaso, ruta: Ruta) => {
    onChange(insertarEn(pasos, ruta, nuevoPaso(tipo)));
    setCajon({ modo: "editar", ruta });
  };

  return (
    <div className="mt-2 flex gap-3">
      <div
        onPointerDown={empezarArrastre}
        onPointerMove={seguirArrastre}
        onPointerUp={soltarArrastre}
        onPointerCancel={soltarArrastre}
        className="relative flex h-[34rem] flex-1 cursor-grab touch-none justify-center overflow-hidden rounded-xl border border-[#ddd8c9] bg-[radial-gradient(circle,#d9d3c3_1px,transparent_1px)] [background-size:20px_20px] active:cursor-grabbing dark:border-white/10 dark:bg-[radial-gradient(circle,rgba(255,255,255,0.10)_1px,transparent_1px)]"
      >
        <div
          style={{
            width: plano.ancho,
            height: plano.alto,
            transform: `translate(${desplazamiento.x}px, ${desplazamiento.y}px) scale(${zoom})`,
            transformOrigin: "50% 0",
          }}
          className="relative shrink-0"
        >
          <svg
            width={plano.ancho}
            height={plano.alto}
            className="pointer-events-none absolute inset-0 text-neutral-400 dark:text-neutral-600"
            aria-hidden
          >
            {plano.aristas.map((arista) => (
              <path
                key={arista.clave}
                d={camino(arista.desde, arista.hasta)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              />
            ))}
          </svg>

          {/* El disparador: se edita arriba, en el formulario, así que acá
              sólo se muestra. Sin él, el árbol arranca en el aire. */}
          <div
            data-nodo
            style={{
              left: plano.raiz.x - ANCHO_NODO / 2,
              top: plano.raiz.y,
              width: ANCHO_NODO,
              minHeight: ALTO_NODO,
            }}
            className="absolute flex items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-left dark:border-amber-500/50 dark:bg-amber-500/10"
          >
            <Zap className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-amber-800 dark:text-amber-200">
                Disparador
              </span>
              <span className="block truncate text-xs text-amber-700 dark:text-amber-300/80">
                {disparador}
              </span>
            </span>
          </div>

          {plano.aristas.map((arista) =>
            arista.etiqueta ? (
              <span
                key={`rotulo:${arista.clave}`}
                style={{ left: puntoDeLaEtiqueta(arista).x, top: puntoDeLaEtiqueta(arista).y }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  arista.rama === "si"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                    : "bg-neutral-200 text-neutral-700 dark:bg-white/10 dark:text-neutral-300"
                }`}
              >
                {arista.etiqueta}
              </span>
            ) : null,
          )}

          {total < MAX_PASOS &&
            plano.aristas.map((arista) =>
              arista.insertar ? (
                <BotonMas
                  key={`mas:${arista.clave}`}
                  x={puntoDelMas(arista).x}
                  y={puntoDelMas(arista).y}
                  onClick={() => setCajon({ modo: "agregar", ruta: arista.insertar as Ruta })}
                />
              ) : null,
            )}

          {plano.nodos.map((puesto) => {
            const Icono = ICONO[puesto.paso.tipo];
            const elegido = puesto.clave === seleccionada;

            return (
              <button
                key={puesto.clave}
                data-nodo
                type="button"
                onClick={() => setCajon({ modo: "editar", ruta: puesto.ruta })}
                style={{
                  left: puesto.x - ANCHO_NODO / 2,
                  top: puesto.y,
                  width: ANCHO_NODO,
                  minHeight: ALTO_NODO,
                }}
                className={`absolute flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left shadow-sm transition-colors dark:bg-neutral-900 ${
                  elegido
                    ? "border-amber-400 ring-2 ring-amber-300 dark:border-amber-500/60 dark:ring-amber-500/30"
                    : "border-[#ddd8c9] hover:border-neutral-400 dark:border-white/10 dark:hover:border-white/25"
                }`}
              >
                <Icono className="size-4 shrink-0 text-neutral-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {nombreDelPaso[puesto.paso.tipo]}
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {resumen(puesto.paso)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                  {describirEspera(minutos.get(puesto.clave) ?? 0)}
                </span>
              </button>
            );
          })}

          {plano.finales.map((final) => (
            <span key={final.clave}>
              {final.fin && (
                <span
                  style={{ left: final.x, top: final.y + 26 }}
                  className="absolute -translate-x-1/2 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-600 dark:bg-white/10 dark:text-neutral-400"
                >
                  FIN
                </span>
              )}
              {total < MAX_PASOS && (
                <BotonMas
                  x={final.x}
                  y={final.y}
                  onClick={() => setCajon({ modo: "agregar", ruta: final.insertar })}
                />
              )}
            </span>
          ))}
        </div>

        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl border border-[#ddd8c9] bg-white/90 p-1 backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
          <BotonDeZoom
            etiqueta="Alejar"
            onClick={() => setZoom((z) => Math.max(ZOOM_MINIMO, Number((z - 0.1).toFixed(2))))}
          >
            <Minus className="size-4" />
          </BotonDeZoom>
          <span className="w-10 text-center text-xs tabular-nums text-neutral-500">
            {Math.round(zoom * 100)}%
          </span>
          <BotonDeZoom
            etiqueta="Acercar"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAXIMO, Number((z + 0.1).toFixed(2))))}
          >
            <Plus className="size-4" />
          </BotonDeZoom>
          <BotonDeZoom etiqueta="Centrar" onClick={centrar}>
            <Crosshair className="size-4" />
          </BotonDeZoom>
        </div>

        {pasos.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-16 text-center text-sm text-neutral-500">
            Todavía no hay pasos. Tocá el <Plus className="inline size-3.5" /> para agregar el
            primero.
          </p>
        )}
      </div>

      {abierto && (
        <CajonDelPaso
          cajon={abierto}
          pasos={pasos}
          nombreDelPaso={nombreDelPaso}
          formulario={formulario}
          aviso={aviso}
          onCerrar={() => setCajon(null)}
          onAgregar={agregar}
          onCambiar={(ruta, paso) => onChange(reemplazarEn(pasos, ruta, paso))}
          onQuitar={(ruta) => {
            onChange(quitarEn(pasos, ruta));
            setCajon(null);
          }}
          onMover={(ruta, salto) => {
            onChange(moverEn(pasos, ruta, salto));
            const indice = ruta[ruta.length - 1];
            if (typeof indice === "number") {
              setCajon({ modo: "editar", ruta: [...ruta.slice(0, -1), indice + salto] });
            }
          }}
        />
      )}
    </div>
  );
}

function BotonMas({ x, y, onClick }: { x: number; y: number; onClick: () => void }) {
  return (
    <button
      data-nodo
      type="button"
      onClick={onClick}
      aria-label="Agregar un paso acá"
      style={{ left: x, top: y }}
      className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[#ddd8c9] bg-white text-neutral-500 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 dark:border-white/15 dark:bg-neutral-900 dark:hover:border-amber-500/50 dark:hover:bg-amber-500/10"
    >
      <Plus className="size-3" />
    </button>
  );
}

function BotonDeZoom({
  etiqueta,
  onClick,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      data-nodo
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}

/**
 * El panel de la derecha: o se elige qué paso agregar, o se edita el que está
 * seleccionado.
 *
 * Es uno solo y con dos modos y no dos paneles porque nunca hacen falta los
 * dos a la vez, y porque abrir el formulario adentro de la tarjeta obligaría a
 * que la tarjeta fuera grande: con nueve campos adentro, el árbol deja de
 * entrar en la pantalla y se pierde lo único que el lienzo vino a dar.
 */
function CajonDelPaso({
  cajon,
  pasos,
  nombreDelPaso,
  formulario,
  aviso,
  onCerrar,
  onAgregar,
  onCambiar,
  onQuitar,
  onMover,
}: {
  cajon: NonNullable<Cajon>;
  pasos: Paso[];
  nombreDelPaso: Record<TipoPaso, string>;
  formulario: (paso: Paso, onChange: (paso: Paso) => void) => ReactNode;
  aviso: (paso: Paso, ruta: Ruta) => ReactNode;
  onCerrar: () => void;
  onAgregar: (tipo: TipoPaso, ruta: Ruta) => void;
  onCambiar: (ruta: Ruta, paso: Paso) => void;
  onQuitar: (ruta: Ruta) => void;
  onMover: (ruta: Ruta, salto: number) => void;
}) {
  const paso = cajon.modo === "editar" ? pasoEn(pasos, cajon.ruta) : null;

  // Cuántas condiciones hay por encima: el prefijo alterna índice y rama.
  const profundidad = (cajon.ruta.length - 1) / 2;
  const tipos = (Object.keys(nombreDelPaso) as TipoPaso[]).filter(
    (tipo) => tipo !== "condicion" || profundidad < MAX_PROFUNDIDAD,
  );

  return (
    <aside className="w-80 shrink-0 overflow-y-auto rounded-xl border border-[#ddd8c9] p-3 dark:border-white/10">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">
          {cajon.modo === "agregar" ? "Agregar un paso" : (paso && nombreDelPaso[paso.tipo]) || ""}
        </p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="cursor-pointer rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>

      {cajon.modo === "agregar" && (
        <div className="mt-3 flex flex-col gap-1.5">
          {tipos.map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => onAgregar(tipo, cajon.ruta)}
              className="cursor-pointer rounded-lg border border-[#ddd8c9] px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
            >
              <Plus className="mr-1.5 inline size-3.5" />
              {nombreDelPaso[tipo]}
            </button>
          ))}
        </div>
      )}

      {cajon.modo === "editar" && paso && (
        <>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              onClick={() => onMover(cajon.ruta, -1)}
              aria-label="Subir"
              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onMover(cajon.ruta, 1)}
              aria-label="Bajar"
              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onQuitar(cajon.ruta)}
              aria-label="Quitar el paso"
              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="mt-3">
            {formulario(paso, (nuevo) => onCambiar(cajon.ruta, nuevo))}
          </div>

          {paso.tipo === "condicion" && (
            <p className="mt-3 text-xs text-neutral-500">
              Los pasos de cada rama se agregan en el dibujo, con el{" "}
              <Plus className="inline size-3" /> de abajo de &ldquo;Sí&rdquo; y de
              &ldquo;No&rdquo;.
            </p>
          )}

          <div className="mt-2">{aviso(paso, cajon.ruta)}</div>
        </>
      )}
    </aside>
  );
}
