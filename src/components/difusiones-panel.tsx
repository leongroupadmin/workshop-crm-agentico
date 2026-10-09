"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  createBroadcast,
  loadBroadcastRecipients,
  loadBroadcasts,
  loadBroadcastTemplates,
  retryBroadcastFailed,
  type BroadcastRecipientRow,
  type BroadcastRow,
} from "@/app/actions";
import { hayVariosEmbudos, nombreCompletoDeEtapa } from "@/components/opciones-de-etapa";
import { Card, dateTime, EmptyState, INPUT_CLASS, Modal, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import { reemplazarTokens } from "@/lib/automatizaciones";
import type { ContactRow, OpportunityRow, StageRow } from "@/lib/crm-data";
import {
  aplicarFiltros,
  etiquetasDisponibles,
  FILTRO_VACIO,
  MAX_DESTINATARIOS,
  motivoLegible,
  nombrePorOmision,
  tieneTelefonoUtil,
  type Candidato,
  type FiltroDifusion,
} from "@/lib/difusiones";
import { dayKeyInZone } from "@/lib/fechas";
import {
  claveDe,
  componenteDe,
  faltantesDe,
  vistaPrevia,
  type Faltante,
  type Plantilla,
  type Valores,
} from "@/lib/plantillas";

/**
 * Difusiones: una plantilla de WhatsApp a muchos contactos de una vez.
 *
 * La pantalla es una sola secuencia de tres pasos —a quién, qué, revisar— y no
 * un asistente con pantallas que se tapan: elegir la audiencia y elegir el
 * mensaje se corrigen mutuamente, y con un asistente había que volver atrás
 * para ver a quién le estabas por escribir.
 *
 * El envío no ocurre acá. La difusión queda anotada y sale de a poco por
 * atrás: nadie se queda con la pantalla abierta esperando trescientos mensajes,
 * y el historial de abajo muestra cómo va.
 */
export function DifusionesPanel({
  contacts,
  opportunities,
  stages,
  timezone,
  onNotice,
}: {
  contacts: ContactRow[];
  opportunities: OpportunityRow[];
  stages: StageRow[];
  timezone: string;
  onNotice: (message: string) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDifusion>(FILTRO_VACIO);
  const [excluidos, setExcluidos] = useState<string[]>([]);
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [nombre, setNombre] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, empezarEnvio] = useTransition();

  /* Los candidatos salen de lo que el dashboard ya trajo: el embudo, las fichas
     y las etiquetas están todas en pantalla, y volver a pedirlas al servidor
     para filtrar sería esperar por algo que ya está. */
  const candidatos = useMemo<Candidato[]>(() => {
    const etapaPorContacto = new Map(
      opportunities.map((oportunidad) => [oportunidad.contactId, oportunidad.stageId]),
    );

    return contacts.map((contacto) => ({
      contactId: contacto.id,
      nombre: contacto.name,
      telefono: contacto.phone,
      etiquetas: contacto.tags,
      stageId: etapaPorContacto.get(contacto.id) ?? null,
      dia: dayKeyInZone(contacto.createdAt, timezone),
    }));
  }, [contacts, opportunities, timezone]);

  const etiquetas = useMemo(() => etiquetasDisponibles(candidatos), [candidatos]);
  const filtrados = useMemo(() => aplicarFiltros(candidatos, filtro), [candidatos, filtro]);

  // Un contacto sin teléfono no es un error del filtro: es una ficha incompleta.
  // Se cuenta aparte para que el número de arriba no mienta y para que se sepa
  // qué hay que corregir.
  const alcanzables = filtrados.filter(tieneTelefonoUtil);
  const sinTelefono = filtrados.length - alcanzables.length;

  const excluidosSet = new Set(excluidos);
  const elegidos = alcanzables.filter((candidato) => !excluidosSet.has(candidato.contactId));

  const alternar = (contactId: string) =>
    setExcluidos((actuales) =>
      actuales.includes(contactId)
        ? actuales.filter((id) => id !== contactId)
        : [...actuales, contactId],
    );

  // Actúan sobre las filas que se ven: con una búsqueda activa, "Ninguno" no
  // debe desmarcar también a quien quedó escondido por la búsqueda.
  const todos = (ids: string[]) => {
    const visibles = new Set(ids);
    setExcluidos((actuales) => actuales.filter((id) => !visibles.has(id)));
  };
  const ninguno = (ids: string[]) =>
    setExcluidos((actuales) => [...new Set([...actuales, ...ids])]);

  const faltantes = plantilla ? faltantesDe(plantilla) : [];
  const completo = faltantes.every((f) => (valores[claveDe(f)] ?? "").trim().length > 0);
  const excedido = elegidos.length > MAX_DESTINATARIOS;

  const listo = plantilla !== null && completo && elegidos.length > 0 && !excedido;
  const huecosSinCompletar = faltantes.filter(
    (f) => (valores[claveDe(f)] ?? "").trim().length === 0,
  ).length;

  const [recargar, setRecargar] = useState(0);

  const enviar = () => {
    if (!plantilla) return;

    empezarEnvio(async () => {
      const result = await createBroadcast({
        nombre: nombre.trim() || nombrePorOmision(plantilla.nombre, elegidos.length),
        plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma },
        valores,
        contactIds: elegidos.map((candidato) => candidato.contactId),
      });

      setConfirmando(false);

      if (!result.ok) {
        onNotice(result.error);
        return;
      }

      const afuera = [
        result.sinTelefono > 0 ? `${result.sinTelefono} sin teléfono` : null,
        result.repetidos > 0 ? `${result.repetidos} con el número repetido` : null,
      ].filter(Boolean);

      onNotice(
        afuera.length > 0
          ? `Difusión creada para ${result.total} contactos. Quedaron afuera ${afuera.join(" y ")}.`
          : `Difusión creada para ${result.total} ${result.total === 1 ? "contacto" : "contactos"}. Ya está saliendo.`,
      );

      setPlantilla(null);
      setValores({});
      setNombre("");
      setExcluidos([]);
      setRecargar((vuelta) => vuelta + 1);
    });
  };

  return (
    <div className="space-y-5">
      <Paso numero={1} titulo="A quién le llega" icono={Users} hecho={elegidos.length > 0 && !excedido}>
        <Filtros
          filtro={filtro}
          stages={stages}
          etiquetas={etiquetas}
          onCambiar={(siguiente) => {
            setFiltro(siguiente);
            // Las exclusiones son sobre la lista que se estaba mirando: al
            // cambiar el filtro dejan de tener sentido y confundirían el total.
            setExcluidos([]);
          }}
        />

        <Audiencia
          alcanzables={alcanzables}
          elegidos={elegidos.length}
          sinTelefono={sinTelefono}
          excluidos={excluidosSet}
          onAlternar={alternar}
          onTodos={todos}
          onNinguno={ninguno}
        />

        {excedido && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            Son {elegidos.length} contactos y el tope es {MAX_DESTINATARIOS} por difusión. Recortá
            con los filtros o desmarcá algunos.
          </p>
        )}
      </Paso>

      <Paso numero={2} titulo="Qué les mandás" icono={FileText} hecho={plantilla !== null && completo}>
        <Mensaje
          plantilla={plantilla}
          valores={valores}
          ejemplo={elegidos[0] ?? null}
          onElegir={(elegida) => {
            setPlantilla(elegida);
            setValores({});
          }}
          onValores={setValores}
        />
      </Paso>

      <Paso numero={3} titulo="Revisar y enviar" icono={Send}>
        <label className="block text-xs font-medium text-neutral-500" htmlFor="nombre-difusion">
          Nombre de la difusión (sólo para vos, para encontrarla después)
        </label>
        <input
          id="nombre-difusion"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder={
            plantilla ? nombrePorOmision(plantilla.nombre, elegidos.length) : "Promo de octubre"
          }
          className={`${INPUT_CLASS} mt-1.5 text-sm`}
        />

        <button
          type="button"
          onClick={() => setConfirmando(true)}
          disabled={!listo || enviando}
          className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full disabled:opacity-50`}
        >
          <Megaphone className="size-4" />
          {enviando
            ? "Creando la difusión…"
            : `Enviar a ${elegidos.length} ${elegidos.length === 1 ? "contacto" : "contactos"}`}
        </button>

        <ul className="mt-4 space-y-1.5 text-xs">
          <Requisito cumplido={elegidos.length > 0 && !excedido}>
            {excedido
              ? `Son demasiados contactos (tope ${MAX_DESTINATARIOS})`
              : elegidos.length === 0
                ? "Elegí al menos un contacto"
                : `${elegidos.length} ${elegidos.length === 1 ? "contacto elegido" : "contactos elegidos"}`}
          </Requisito>
          <Requisito cumplido={plantilla !== null}>
            {plantilla ? `Plantilla ${plantilla.nombre}` : "Elegí una plantilla"}
          </Requisito>
          {plantilla && (
            <Requisito cumplido={completo}>
              {completo
                ? "Huecos de la plantilla completos"
                : `Falta completar ${huecosSinCompletar} ${huecosSinCompletar === 1 ? "hueco" : "huecos"} de la plantilla`}
            </Requisito>
          )}
        </ul>

        {listo && (
          <p className="mt-3 text-xs text-neutral-400">
            Los mensajes salen de a uno por atrás. Podés cerrar la pantalla: el envío sigue.
          </p>
        )}
      </Paso>

      <Historial recargar={recargar} timezone={timezone} onNotice={onNotice} />

      {confirmando && plantilla && (
        <Confirmacion
          cantidad={elegidos.length}
          plantilla={plantilla}
          valores={valores}
          ejemplo={elegidos[0] ?? null}
          enviando={enviando}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={enviar}
        />
      )}
    </div>
  );
}

function Paso({
  numero,
  titulo,
  icono: Icono,
  hecho = false,
  children,
}: {
  numero: number;
  titulo: string;
  icono: typeof Users;
  hecho?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-50 text-sm font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          {hecho ? <Check className="size-4" aria-label="Paso completo" /> : numero}
        </span>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icono className="size-4 text-neutral-400" />
          {titulo}
        </h2>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Requisito({ cumplido, children }: { cumplido: boolean; children: React.ReactNode }) {
  return (
    <li
      className={`flex items-center gap-2 ${
        cumplido ? "text-neutral-600 dark:text-neutral-300" : "text-neutral-400"
      }`}
    >
      <span
        className={`grid size-4 shrink-0 place-items-center rounded-full ${
          cumplido
            ? "bg-amber-500 text-white"
            : "border border-neutral-300 dark:border-white/20"
        }`}
      >
        {cumplido && <Check className="size-3" strokeWidth={3} />}
      </span>
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ filtros */

function Filtros({
  filtro,
  stages,
  etiquetas,
  onCambiar,
}: {
  filtro: FiltroDifusion;
  stages: StageRow[];
  etiquetas: string[];
  onCambiar: (filtro: FiltroDifusion) => void;
}) {
  const alternarEtapa = (stageId: string) =>
    onCambiar({
      ...filtro,
      stageIds: filtro.stageIds.includes(stageId)
        ? filtro.stageIds.filter((id) => id !== stageId)
        : [...filtro.stageIds, stageId],
    });

  const alternarEtiqueta = (etiqueta: string) =>
    onCambiar({
      ...filtro,
      etiquetas: filtro.etiquetas.includes(etiqueta)
        ? filtro.etiquetas.filter((item) => item !== etiqueta)
        : [...filtro.etiquetas, etiqueta],
    });

  const activos =
    filtro.stageIds.length +
    filtro.etiquetas.length +
    (filtro.desde ? 1 : 0) +
    (filtro.hasta ? 1 : 0);

  return (
    <div className="space-y-5">
      {activos > 0 && (
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {activos} {activos === 1 ? "filtro aplicado" : "filtros aplicados"}
          <button
            type="button"
            onClick={() => onCambiar(FILTRO_VACIO)}
            className="inline-flex cursor-pointer items-center gap-1 underline-offset-2 hover:underline"
          >
            <X className="size-3" />
            Limpiar filtros
          </button>
        </div>
      )}

      <DesplegableEtapas
        stages={stages}
        elegidas={filtro.stageIds}
        onAlternar={alternarEtapa}
        onLimpiar={() => onCambiar({ ...filtro, stageIds: [] })}
      />

      {etiquetas.length > 0 && (
        <Grupo titulo="Etiquetas" vacio="Sin filtrar: con o sin etiquetas.">
          {etiquetas.map((etiqueta) => (
            <Chip
              key={etiqueta}
              activo={filtro.etiquetas.includes(etiqueta)}
              onClick={() => alternarEtiqueta(etiqueta)}
            >
              {etiqueta}
            </Chip>
          ))}
        </Grupo>
      )}

      <div>
        <p className="flex items-center gap-2 text-xs font-medium text-neutral-500">
          <CalendarDays className="size-3.5" />
          Fecha de alta del contacto
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
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
          {(filtro.desde || filtro.hasta) && (
            <button
              type="button"
              onClick={() => onCambiar({ ...filtro, desde: null, hasta: null })}
              className="cursor-pointer self-end pb-2 text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              Quitar fechas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Las etapas en una lista que se abre: con muchas columnas, los chips ocupaban media pantalla. */
function DesplegableEtapas({
  stages,
  elegidas,
  onAlternar,
  onLimpiar,
}: {
  stages: StageRow[];
  elegidas: string[];
  onAlternar: (stageId: string) => void;
  onLimpiar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const varios = hayVariosEmbudos(stages);

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

  const nombres = stages
    .filter((stage) => elegidas.includes(stage.id))
    .map((stage) => nombreCompletoDeEtapa(stage, varios));

  const resumen =
    nombres.length === 0
      ? "Cualquier etapa (y quien no está en el embudo)"
      : nombres.length <= 2
        ? nombres.join(", ")
        : `${nombres.length} etapas elegidas`;

  return (
    <div ref={caja} className="relative">
      <p className="text-xs font-medium text-neutral-500">Etapa del embudo</p>
      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        aria-haspopup="listbox"
        className={`${INPUT_CLASS} mt-2 flex w-full cursor-pointer items-center justify-between gap-3 py-2 text-left text-sm`}
      >
        <span className={`truncate ${nombres.length === 0 ? "text-neutral-500" : ""}`}>{resumen}</span>
        <ChevronDown className={`size-4 shrink-0 text-neutral-400 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-[#ddd8c9] bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-neutral-900">
          <ul role="listbox" aria-multiselectable="true" className="barra-fina max-h-64 overflow-y-auto">
            {stages.map((stage) => (
              <li key={stage.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={elegidas.includes(stage.id)}
                    onChange={() => onAlternar(stage.id)}
                    className="size-4 shrink-0 cursor-pointer accent-amber-500"
                  />
                  <span className="truncate">{nombreCompletoDeEtapa(stage, varios)}</span>
                </label>
              </li>
            ))}
          </ul>
          {elegidas.length > 0 && (
            <button
              type="button"
              onClick={onLimpiar}
              className="mt-1 w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-xs text-neutral-500 hover:bg-neutral-50 dark:hover:bg-white/5"
            >
              Quitar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  vacio,
  children,
}: {
  titulo: string;
  vacio: string;
  children: React.ReactNode;
}) {
  const hijos = Array.isArray(children) ? children : [children];
  return (
    <div>
      <p className="text-xs font-medium text-neutral-500">{titulo}</p>
      {hijos.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">{vacio}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      )}
    </div>
  );
}

function Chip({
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
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        activo
          ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300"
          : "border-[#ddd8c9] text-neutral-600 hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- audiencia */

function Audiencia({
  alcanzables,
  elegidos,
  sinTelefono,
  excluidos,
  onAlternar,
  onTodos,
  onNinguno,
}: {
  alcanzables: Candidato[];
  elegidos: number;
  sinTelefono: number;
  excluidos: Set<string>;
  onAlternar: (contactId: string) => void;
  onTodos: (ids: string[]) => void;
  onNinguno: (ids: string[]) => void;
}) {
  const [busqueda, setBusqueda] = useState("");

  const texto = busqueda.trim().toLowerCase();
  const visibles = texto
    ? alcanzables.filter(
        (candidato) =>
          candidato.nombre.toLowerCase().includes(texto) ||
          (candidato.telefono ?? "").toLowerCase().includes(texto),
      )
    : alcanzables;
  const ids = visibles.map((candidato) => candidato.contactId);

  return (
    <div className="mt-5 rounded-xl bg-neutral-50 p-4 dark:bg-white/[.04]">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">
          {elegidos} {elegidos === 1 ? "contacto elegido" : "contactos elegidos"}
        </p>
        {sinTelefono > 0 && (
          <p className="text-xs text-neutral-500">
            {sinTelefono} sin teléfono {sinTelefono === 1 ? "queda" : "quedan"} afuera
          </p>
        )}
        <div className="ml-auto flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => onTodos(ids)}
            className="cursor-pointer underline-offset-2 hover:underline"
          >
            {texto ? "Marcar los que se ven" : "Marcar todos"}
          </button>
          <button
            type="button"
            onClick={() => onNinguno(ids)}
            className="cursor-pointer underline-offset-2 hover:underline"
          >
            {texto ? "Desmarcar los que se ven" : "Ninguno"}
          </button>
        </div>
      </div>

      {alcanzables.length > 8 && (
        <label className="relative mt-3 block">
          <span className="sr-only">Buscar en la lista</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar por nombre o teléfono"
            className={`${INPUT_CLASS} py-2 pl-9 text-sm`}
          />
        </label>
      )}

      {alcanzables.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          Ningún contacto con teléfono entra en este filtro.
        </p>
      ) : visibles.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">Nadie coincide con la búsqueda.</p>
      ) : (
        <ul className="barra-fina mt-3 max-h-72 divide-y divide-neutral-200 overflow-y-auto dark:divide-white/10">
          {visibles.map((candidato) => (
            <li key={candidato.contactId}>
              <label className="flex cursor-pointer items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={!excluidos.has(candidato.contactId)}
                  onChange={() => onAlternar(candidato.contactId)}
                  className="size-4 shrink-0 cursor-pointer accent-amber-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{candidato.nombre}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {candidato.telefono}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ mensaje */

const NOMBRE_DEL_ARCHIVO: Record<string, string> = {
  image: "Link de la imagen del encabezado",
  video: "Link del video del encabezado",
  document: "Link del documento del encabezado",
};

const TOKENS = ["nombre", "telefono", "email", "etapa"];

function etiquetaDe(faltante: Faltante): string {
  if (faltante.clase === "link") return NOMBRE_DEL_ARCHIVO[faltante.formato] ?? "Link del encabezado";
  const donde = faltante.ubicacion === "header" ? "encabezado" : "texto";
  return `Variable {{${faltante.numero}}} del ${donde}`;
}

function Mensaje({
  plantilla,
  valores,
  ejemplo,
  onElegir,
  onValores,
}: {
  plantilla: Plantilla | null;
  valores: Valores;
  /** Con quién se arma la vista previa: el primero de la lista. */
  ejemplo: Candidato | null;
  onElegir: (plantilla: Plantilla) => void;
  onValores: (valores: Valores) => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Hacia dónde va el dato que se toca: el último hueco donde se escribió.
  const [huecoActivo, setHuecoActivo] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    loadBroadcastTemplates().then((result) => {
      if (!activo) return;
      if (result.ok) setPlantillas(result.plantillas);
      else setError(result.error);
      setCargando(false);
    });

    return () => {
      activo = false;
    };
  }, []);

  if (cargando) return <p className="text-sm text-neutral-500">Buscando las plantillas…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (plantillas.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Sin plantillas aprobadas"
        description="Una difusión sale siempre como plantilla: es la única forma de escribirle a alguien fuera de las 24 horas. Creá una en el panel de YCloud y esperá a que Meta la apruebe."
      />
    );
  }

  const faltantes = plantilla ? faltantesDe(plantilla) : [];

  return (
    <div className="space-y-5">
      <ul className="barra-fina max-h-60 space-y-2 overflow-y-auto">
        {plantillas.map((item) => {
          const elegida = plantilla?.nombre === item.nombre && plantilla?.idioma === item.idioma;
          return (
            <li key={`${item.nombre}.${item.idioma}`}>
              <button
                type="button"
                onClick={() => onElegir(item)}
                className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                  elegida
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-400/10"
                    : "border-[#ddd8c9] hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{item.nombre}</span>
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-white/10">
                    {item.idioma}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-xs text-neutral-500">
                  {componenteDe(item, "body")?.texto || "Sin cuerpo de texto."}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {plantilla && (
        <>
          {faltantes.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">
                  Datos de cada contacto (tocá uno para ponerlo en el hueco elegido):
                </span>
                {TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => {
                      const clave = huecoActivo ?? claveDe(faltantes[0]);
                      onValores({ ...valores, [clave]: `${valores[clave] ?? ""}{${token}}` });
                    }}
                    className="cursor-pointer rounded-full border border-[#ddd8c9] px-2.5 py-1 font-mono text-[11px] text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
                  >
                    {`{${token}}`}
                  </button>
                ))}
              </div>
              {faltantes.map((faltante) => {
                const clave = claveDe(faltante);
                return (
                  <div key={clave}>
                    <label
                      className="block text-xs font-medium text-neutral-500"
                      htmlFor={`hueco-${clave}`}
                    >
                      {etiquetaDe(faltante)}
                    </label>
                    <input
                      id={`hueco-${clave}`}
                      value={valores[clave] ?? ""}
                      onFocus={() => setHuecoActivo(clave)}
                      onChange={(event) =>
                        onValores({ ...valores, [clave]: event.target.value })
                      }
                      className={`${INPUT_CLASS} mt-1.5 text-sm`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <VistaPrevia plantilla={plantilla} valores={valores} ejemplo={ejemplo} />
        </>
      )}
    </div>
  );
}

function resolverValores(valores: Valores, ejemplo: Candidato | null): Valores {
  const datos = {
    nombre: ejemplo?.nombre ?? "",
    telefono: ejemplo?.telefono ?? null,
    email: null,
    etapa: null,
  };

  return Object.fromEntries(
    Object.entries(valores).map(([clave, valor]) => [clave, reemplazarTokens(valor, datos)]),
  );
}

/**
 * El mensaje ya armado, con los datos de alguien de la lista.
 *
 * Con los tokens sin reemplazar la vista previa engaña: "Hola {nombre}" se lee
 * bien y esconde justo el error que importa, que es el token mal escrito. Por
 * eso se muestra con una persona real de la audiencia.
 */
function VistaPrevia({
  plantilla,
  valores,
  ejemplo,
}: {
  plantilla: Plantilla;
  valores: Valores;
  ejemplo: Candidato | null;
}) {
  const resueltos = resolverValores(valores, ejemplo);

  return (
    <div className="rounded-xl bg-neutral-50 p-4 dark:bg-white/5">
      <p className="text-xs font-medium text-neutral-500">
        {ejemplo ? `Así le va a llegar a ${ejemplo.nombre}` : "Así le va a llegar"}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">
        {vistaPrevia(plantilla, resueltos)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- confirmación */

function Confirmacion({
  cantidad,
  plantilla,
  valores,
  ejemplo,
  enviando,
  onCancelar,
  onConfirmar,
}: {
  cantidad: number;
  plantilla: Plantilla;
  valores: Valores;
  ejemplo: Candidato | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Modal title="Confirmar la difusión" onClose={onCancelar}>
      <p className="mt-5 text-sm">
        Le vas a escribir por WhatsApp a{" "}
        <strong>
          {cantidad} {cantidad === 1 ? "persona" : "personas"}
        </strong>{" "}
        con la plantilla <strong>{plantilla.nombre}</strong>.
      </p>

      <div className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm dark:bg-white/5">
        {ejemplo && (
          <p className="mb-1.5 text-xs font-medium text-neutral-500">
            Ejemplo con {ejemplo.nombre}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">
          {vistaPrevia(plantilla, resolverValores(valores, ejemplo))}
        </p>
      </div>

      <p className="mt-4 text-sm text-neutral-500">
        Una vez que sale no se puede deshacer: cada mensaje llega al teléfono de esa persona.
      </p>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onCancelar}
          className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={enviando}
          className={`${PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
        >
          <Send className="size-4" />
          {enviando ? "Creando…" : "Sí, enviar"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- historial */

function Historial({
  recargar,
  timezone,
  onNotice,
}: {
  recargar: number;
  timezone: string;
  onNotice: (message: string) => void;
}) {
  const [difusiones, setDifusiones] = useState<BroadcastRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [hayMas, setHayMas] = useState(false);
  const [cuantas, setCuantas] = useState(20);
  const [viendo, setViendo] = useState<BroadcastRow | null>(null);

  const traer = useCallback(
    async (avisar?: (mensaje: string) => void) => {
      const result = await loadBroadcasts({ cuantas });
      if (result.ok) {
        setDifusiones(result.difusiones);
        setHayMas(result.hayMas);
      } else avisar?.(result.error);
      setCargando(false);
    },
    [cuantas],
  );

  useEffect(() => {
    let activo = true;
    // El pedido va dentro de un callback y no en el cuerpo del efecto: el
    // historial es un dato de afuera, y así el estado se toca recién cuando
    // contesta el servidor.
    loadBroadcasts({ cuantas }).then((result) => {
      if (!activo) return;
      if (result.ok) {
        setDifusiones(result.difusiones);
        setHayMas(result.hayMas);
      } else onNotice(result.error);
      setCargando(false);
    });
    return () => {
      activo = false;
    };
    // `onNotice` cambia en cada render del dashboard: incluirlo volvería a
    // pedir el historial todo el tiempo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargar, cuantas]);

  /* Mientras queda algo en cola el historial se refresca solo: el envío ocurre
     por atrás y sin esto la única forma de ver el avance sería recargar la
     página a mano. Cuando no queda nada pendiente, deja de preguntar. */
  const enCola = difusiones.some((difusion) => difusion.pendientes > 0);

  useEffect(() => {
    if (!enCola) return;
    // Con la pestaña oculta no pregunta: nadie mira el avance y cada vuelta
    // deja su línea en los logs de Supabase.
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") void traer();
    }, 8000);
    return () => window.clearInterval(reloj);
  }, [enCola, traer]);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Difusiones enviadas</h2>
        <button
          type="button"
          onClick={() => void traer()}
          aria-label="Actualizar el historial"
          className="ml-auto cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {cargando ? (
        <p className="mt-4 text-sm text-neutral-500">Cargando…</p>
      ) : difusiones.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          Todavía no mandaste ninguna. Las que mandes quedan acá con el detalle de a quién llegó.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-100 dark:divide-white/10">
          {difusiones.map((difusion) => (
            <li key={difusion.id}>
              <button
                type="button"
                onClick={() => setViendo(difusion)}
                className="w-full cursor-pointer py-3 text-left"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <strong className="truncate text-sm hover:underline">{difusion.nombre}</strong>
                  <span className="text-xs text-neutral-500" suppressHydrationWarning>
                    {dateTime(difusion.creadaEl, timezone)}
                  </span>
                </span>
                <Progreso difusion={difusion} />
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <Marca tono="ok">{difusion.enviados} enviados</Marca>
                  {difusion.pendientes > 0 && (
                    <Marca tono="espera">{difusion.pendientes} en cola</Marca>
                  )}
                  {difusion.fallados > 0 && (
                    <Marca tono="error">{difusion.fallados} fallaron</Marca>
                  )}
                  <span className="text-neutral-400">· {difusion.plantilla}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hayMas && (
        <button
          type="button"
          onClick={() => setCuantas((actuales) => actuales + 20)}
          className="mt-3 w-full cursor-pointer rounded-xl border border-[#ddd8c9] py-2.5 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
        >
          Ver difusiones más viejas
        </button>
      )}

      {viendo && (
        <Destinatarios
          difusion={viendo}
          onNotice={onNotice}
          onCambio={() => void traer()}
          close={() => setViendo(null)}
        />
      )}
    </Card>
  );
}

function Progreso({ difusion }: { difusion: BroadcastRow }) {
  const total = difusion.enviados + difusion.pendientes + difusion.fallados;
  if (total === 0) return null;

  const hechos = difusion.enviados + difusion.fallados;
  const porcentaje = Math.round((hechos / total) * 100);

  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={porcentaje}
      aria-label={`${porcentaje}% procesado`}
      className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10"
    >
      <span className="bg-amber-500" style={{ width: `${(difusion.enviados / total) * 100}%` }} />
      <span className="bg-red-500" style={{ width: `${(difusion.fallados / total) * 100}%` }} />
    </span>
  );
}

const TONOS = {
  ok: "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  espera: "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300",
  error: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

function Marca({ tono, children }: { tono: keyof typeof TONOS; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${TONOS[tono]}`}>{children}</span>
  );
}

/** Uno por uno: a quién llegó, a quién no y por qué. */
function Destinatarios({
  difusion,
  onNotice,
  onCambio,
  close,
}: {
  difusion: BroadcastRow;
  onNotice: (message: string) => void;
  /** Para que el avance de arriba no quede contando lo de antes del reintento. */
  onCambio: () => void;
  close: () => void;
}) {
  const [filas, setFilas] = useState<BroadcastRecipientRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [cual, setCual] = useState<Filtro>("todos");
  const [reintentando, empezarReintento] = useTransition();

  const traer = useCallback(async () => {
    const result = await loadBroadcastRecipients({ broadcastId: difusion.id });
    if (result.ok) setFilas(result.destinatarios);
    else setError(result.error);
    setCargando(false);
  }, [difusion.id]);

  useEffect(() => {
    let activo = true;

    loadBroadcastRecipients({ broadcastId: difusion.id }).then((result) => {
      if (!activo) return;
      if (result.ok) setFilas(result.destinatarios);
      else setError(result.error);
      setCargando(false);
    });

    return () => {
      activo = false;
    };
  }, [difusion.id]);

  /* Mientras algo esté por salir, el detalle se refresca solo. Sin esto quien
     abre una difusión en curso se queda mirando la foto del momento en que la
     abrió, justo cuando lo que quiere es ver avanzar la lista. */
  const enCola = filas.some((fila) => fila.estado === "pendiente" || fila.estado === "enviando");

  useEffect(() => {
    if (!enCola) return;
    // Con la pestaña oculta no pregunta: nadie mira el avance y cada vuelta
    // deja su línea en los logs de Supabase.
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") void traer();
    }, 8000);
    return () => window.clearInterval(reloj);
  }, [enCola, traer]);

  const cuenta = {
    todos: filas.length,
    enviado: filas.filter((fila) => fila.estado === "enviado").length,
    fallado: filas.filter((fila) => fila.estado === "fallado").length,
    pendiente: filas.filter((fila) => fila.estado === "pendiente" || fila.estado === "enviando")
      .length,
  };

  const visibles =
    cual === "todos"
      ? filas
      : cual === "pendiente"
        ? filas.filter((fila) => fila.estado === "pendiente" || fila.estado === "enviando")
        : filas.filter((fila) => fila.estado === cual);

  const reintentar = () =>
    empezarReintento(async () => {
      const result = await retryBroadcastFailed({ broadcastId: difusion.id });
      if (!result.ok) {
        onNotice(result.error);
        return;
      }
      onNotice(
        `${result.reintentados} ${result.reintentados === 1 ? "envío" : "envíos"} de vuelta en la cola.`,
      );
      // El filtro de fallados quedaría vacío: lo que se reintentó pasó a la cola.
      if (cual === "fallado") setCual("pendiente");
      await traer();
      onCambio();
    });

  return (
    <Modal title={difusion.nombre} onClose={close}>
      {cargando ? (
        <p className="mt-5 text-sm text-neutral-500">Cargando…</p>
      ) : error ? (
        <p className="mt-5 text-sm text-red-600">{error}</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {FILTROS.map((filtro) => (
              <Chip
                key={filtro}
                activo={cual === filtro}
                onClick={() => setCual(filtro)}
              >
                {NOMBRE_DEL_FILTRO[filtro]} ({cuenta[filtro]})
              </Chip>
            ))}
          </div>

          {cuenta.fallado > 0 && (
            <button
              type="button"
              onClick={reintentar}
              disabled={reintentando}
              className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#ddd8c9] px-3 py-2 text-xs font-semibold transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
            >
              <RotateCcw className="size-3.5" />
              {reintentando
                ? "Reencolando…"
                : `Reintentar ${cuenta.fallado} ${cuenta.fallado === 1 ? "fallado" : "fallados"}`}
            </button>
          )}

          {visibles.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No hay nadie en este estado.</p>
          ) : (
            <ul className="barra-fina mt-4 max-h-[50vh] divide-y divide-neutral-100 overflow-y-auto dark:divide-white/10">
              {visibles.map((fila) => (
                <li key={fila.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">{fila.nombre}</strong>
                      <span className="text-xs text-neutral-500">{fila.telefono}</span>
                    </span>
                    <Marca tono={fila.estado === "enviado" ? "ok" : fila.estado === "fallado" ? "error" : "espera"}>
                      {ESTADOS[fila.estado]}
                    </Marca>
                  </div>
                  <Detalle detalle={fila.detalle} />
                </li>
              ))}
            </ul>
          )}
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

const FILTROS = ["todos", "enviado", "pendiente", "fallado"] as const;
type Filtro = (typeof FILTROS)[number];

const NOMBRE_DEL_FILTRO: Record<Filtro, string> = {
  todos: "Todos",
  enviado: "Enviados",
  pendiente: "En cola",
  fallado: "Fallaron",
};

/**
 * El motivo del fallo, traducido, con lo que contestó la API a un clic.
 *
 * Lo crudo queda escondido pero no se tira: la traducción va a quedarse corta
 * cuando Meta agregue códigos, y en ese caso lo único que sirve para entender
 * qué pasó es el texto original.
 */
function Detalle({ detalle }: { detalle: string | null }) {
  const motivo = motivoLegible(detalle);
  if (!motivo) return null;

  return (
    <div className="mt-1 text-xs text-red-600 dark:text-red-400">
      <p className="break-words">{motivo.resumen}</p>
      {motivo.tecnico && (
        <details className="mt-1">
          <summary className="cursor-pointer text-neutral-500 underline-offset-2 hover:underline">
            Qué contestó WhatsApp
          </summary>
          <p className="mt-1 break-words font-mono text-[11px] text-neutral-500">
            {motivo.tecnico}
          </p>
        </details>
      )}
    </div>
  );
}

const ESTADOS: Record<BroadcastRecipientRow["estado"], string> = {
  pendiente: "En cola",
  enviando: "Saliendo",
  enviado: "Enviado",
  fallado: "Falló",
};
