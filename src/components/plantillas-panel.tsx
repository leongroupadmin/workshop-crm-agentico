"use client";

import { ChevronLeft, FileText, Send } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { loadWhatsappTemplates, sendTemplateMessage } from "@/app/actions";
import {
  claveDe,
  componenteDe,
  faltantesDe,
  vistaPrevia,
  type Faltante,
  type Plantilla,
  type Valores,
} from "@/lib/plantillas";
import { EmptyState, INPUT_CLASS, Modal, PRIMARY_BUTTON_CLASS } from "@/components/ui";

/**
 * Selector de plantillas de WhatsApp.
 *
 * Dos pantallas dentro del mismo modal: la lista de lo que hay aprobado y, al
 * elegir una, los huecos a completar con la vista previa arriba. La vista previa
 * se actualiza mientras se escribe porque una plantilla se lee mal en crudo:
 * `Hola {{1}}, tu turno es el {{2}}` no se parece a lo que va a recibir nadie.
 */
export function PlantillasPicker({
  conversationId,
  onClose,
  onSent,
  onNotice,
}: {
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
  onNotice: (message: string) => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [elegida, setElegida] = useState<Plantilla | null>(null);

  useEffect(() => {
    let activo = true;

    loadWhatsappTemplates({ conversationId }).then((result) => {
      if (!activo) return;
      if (result.ok) setPlantillas(result.plantillas);
      else setError(result.error);
      setCargando(false);
    });

    return () => {
      activo = false;
    };
  }, [conversationId]);

  return (
    <Modal title={elegida ? elegida.nombre : "Plantillas de WhatsApp"} onClose={onClose}>
      {elegida ? (
        <Completar
          key={`${elegida.nombre}.${elegida.idioma}`}
          conversationId={conversationId}
          plantilla={elegida}
          onVolver={() => setElegida(null)}
          onSent={onSent}
          onNotice={onNotice}
        />
      ) : (
        <Lista
          cargando={cargando}
          error={error}
          plantillas={plantillas}
          onElegir={setElegida}
        />
      )}
    </Modal>
  );
}

function Lista({
  cargando,
  error,
  plantillas,
  onElegir,
}: {
  cargando: boolean;
  error: string;
  plantillas: Plantilla[];
  onElegir: (plantilla: Plantilla) => void;
}) {
  if (cargando) return <p className="mt-4 text-sm text-neutral-500">Buscando las plantillas…</p>;
  if (error) return <p className="mt-4 text-sm text-red-600">{error}</p>;

  if (plantillas.length === 0) {
    return (
      <div className="mt-2">
        <EmptyState
          icon={FileText}
          title="Sin plantillas aprobadas"
          description="Creá una en el panel de YCloud y esperá a que Meta la apruebe."
        />
      </div>
    );
  }

  return (
    <>
      <p className="mt-1 text-sm text-neutral-500">
        Sirven para escribirle a alguien que no responde hace más de 24 horas.
      </p>
      <ul className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
        {plantillas.map((plantilla) => (
          <li key={`${plantilla.nombre}.${plantilla.idioma}`}>
            <button
              type="button"
              onClick={() => onElegir(plantilla)}
              className="w-full cursor-pointer rounded-xl border border-[#ddd8c9] p-3 text-left transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{plantilla.nombre}</span>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-white/10">
                  {plantilla.idioma}
                </span>
              </span>
              <span className="mt-1 line-clamp-2 block text-xs text-neutral-500">
                {componenteDe(plantilla, "body")?.texto || "Sin cuerpo de texto."}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Completar({
  conversationId,
  plantilla,
  onVolver,
  onSent,
  onNotice,
}: {
  conversationId: string;
  plantilla: Plantilla;
  onVolver: () => void;
  onSent: () => void;
  onNotice: (message: string) => void;
}) {
  const [valores, setValores] = useState<Valores>({});
  const [enviando, empezarEnvio] = useTransition();

  const faltantes = faltantesDe(plantilla);
  const completo = faltantes.every((f) => (valores[claveDe(f)] ?? "").trim().length > 0);

  const enviar = () => {
    empezarEnvio(async () => {
      const result = await sendTemplateMessage({
        conversationId,
        nombre: plantilla.nombre,
        idioma: plantilla.idioma,
        valores,
      });

      if (!result.ok) {
        onNotice(result.error);
        return;
      }

      if (result.warning) onNotice(result.warning);
      onSent();
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <button
        type="button"
        onClick={onVolver}
        className="inline-flex cursor-pointer items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <ChevronLeft className="size-4" />
        Ver todas
      </button>

      <div className="rounded-xl bg-neutral-50 p-3 dark:bg-white/5">
        <p className="text-xs font-medium text-neutral-500">Así le va a llegar</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">
          {vistaPrevia(plantilla, valores)}
        </p>
      </div>

      {faltantes.length === 0 ? (
        <p className="text-sm text-neutral-500">Esta plantilla no tiene nada que completar.</p>
      ) : (
        <div className="space-y-3">
          {faltantes.map((faltante) => {
            const clave = claveDe(faltante);
            return (
              <div key={clave}>
                <label className="block text-xs font-medium text-neutral-500" htmlFor={`hueco-${clave}`}>
                  {etiquetaDe(faltante)}
                </label>
                <input
                  id={`hueco-${clave}`}
                  value={valores[clave] ?? ""}
                  onChange={(event) =>
                    setValores((actuales) => ({ ...actuales, [clave]: event.target.value }))
                  }
                  disabled={enviando}
                  className={`${INPUT_CLASS} mt-1.5`}
                />
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando || !completo}
        className={`${PRIMARY_BUTTON_CLASS} w-full`}
      >
        <Send className="size-4" />
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    </div>
  );
}

const NOMBRE_DEL_ARCHIVO: Record<string, string> = {
  image: "Link de la imagen del encabezado",
  video: "Link del video del encabezado",
  document: "Link del documento del encabezado",
};

function etiquetaDe(faltante: Faltante): string {
  if (faltante.clase === "link") return NOMBRE_DEL_ARCHIVO[faltante.formato] ?? "Link del encabezado";
  const donde = faltante.ubicacion === "header" ? "encabezado" : "texto";
  return `Variable {{${faltante.numero}}} del ${donde}`;
}
