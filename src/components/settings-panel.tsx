"use client";

import {
  Check,
  Clock,
  KeyRound,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  loadAssistantConfig,
  loadChatModels,
  saveAssistantConfig,
  updateWorkspaceTimezone,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { IntegracionesCard } from "@/components/integraciones-panel";
import { Card } from "@/components/ui";
import { TIMEZONE_OPTIONS, longDateInZone } from "@/lib/fechas";

/**
 * Configuración del workspace.
 *
 * Acá vivía la API key de OpenAI de cada usuario, guardada en su navegador.
 * Se sacó cuando apareció la key del servidor: eran dos credenciales en dos
 * lugares y sólo una servía para que la IA contestara sola, lo que llevaba a
 * cargar la equivocada y no entender por qué no pasaba nada. Ahora hay una
 * sola, que se carga en Conexiones y se guarda cifrada en el servidor; la
 * tarjeta de arriba se limita a decir si está funcionando.
 */
export function SettingsPanel({ timezone }: { timezone: string }) {
  const [status, setStatus] = useState<
    { state: "checking" } | { state: "ok"; models: number } | { state: "error"; message: string }
  >({ state: "checking" });

  useEffect(() => {
    let active = true;
    loadChatModels().then((result) => {
      if (!active) return;
      setStatus(
        result.ok
          ? { state: "ok", models: result.models.length }
          : { state: "error", message: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-10 place-items-center rounded-xl ${
              status.state === "error"
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
            }`}
          >
            {status.state === "error" ? (
              <TriangleAlert className="size-5" />
            ) : (
              <KeyRound className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Motor de IA</h2>
            <p className="text-sm text-neutral-500">
              {status.state === "checking" && "Comprobando la conexión…"}
              {status.state === "ok" && "Conectado con OpenAI"}
              {status.state === "error" && "No se pudo conectar"}
            </p>
          </div>
        </div>

        {status.state === "ok" && (
          <p className="mt-5 flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <Check className="size-4" />
            Funciona. Hay {status.models} modelos de chat disponibles.
          </p>
        )}

        {status.state === "error" && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm text-red-700 dark:text-red-300">{status.message}</p>
            <p className="mt-2 text-sm text-red-700/80 dark:text-red-300/80">
              Cargá tu key de OpenAI en <strong>Conexiones</strong>, más abajo en esta misma
              pantalla.
            </p>
          </div>
        )}
      </Card>

      <IntegracionesCard />

      <TimezoneCard timezone={timezone} />

      <AsistenteCard />

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Cómo funciona la IA</h2>
        <ul className="mt-3 space-y-2 text-sm text-neutral-500">
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Una sola key, guardada
            cifrada.</strong>{" "}
            Se carga una vez en Conexiones y nunca vuelve a mostrarse. La misma key paga las
            respuestas automáticas y las sugeridas.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Dos niveles para
            apagarla.</strong>{" "}
            El interruptor de cada agente en <em>Agentes IA</em> apaga un canal entero; la etiqueta
            &ldquo;Frenar IA&rdquo; de una tarjeta de lead la apaga sólo para ese contacto.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Sin instrucciones no
            habla.</strong>{" "}
            Un agente sin instrucciones cargadas no responde, aunque esté encendido. Es a propósito.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Poné un límite de gasto</strong>{" "}
            en la cuenta de OpenAI. Es la única protección real contra un consumo inesperado.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/**
 * El asistente interno, el chat de la burbuja.
 *
 * Vive acá y no en una sección propia del menú porque no es un lugar al que se
 * va: es algo que se prende una vez y después se usa desde cualquier pantalla.
 *
 * El interruptor es lo que justifica la tarjeta. Cada pregunta son una o dos
 * llamadas a OpenAI, y a diferencia de los agentes —que gastan cuando escribe
 * un cliente— éste gasta cuando alguien del equipo tiene curiosidad. Tiene que
 * poder apagarse sin quitar la API key, que es la misma que usan los agentes.
 */
function AsistenteCard() {
  const access = useAccess();
  const [config, setConfig] = useState<{ enabled: boolean; model: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    let active = true;
    loadAssistantConfig().then((result) => {
      if (active && result.ok) setConfig(result.config);
    });
    loadChatModels().then((result) => {
      if (active && result.ok) setModels(result.models);
    });
    return () => {
      active = false;
    };
  }, []);

  const puedeEditar = access.isAdmin;

  const guardar = (siguiente: { enabled: boolean; model: string }) => {
    const previo = config;
    setConfig(siguiente);
    setNotice(null);
    startSaving(async () => {
      const result = await saveAssistantConfig(siguiente);
      if (result.ok) {
        setNotice({ ok: true, message: "Asistente guardado." });
      } else {
        setConfig(previo);
        setNotice({ ok: false, message: result.error });
      }
    });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-10 place-items-center rounded-xl ${
            config?.enabled === false
              ? "bg-neutral-100 text-neutral-400 dark:bg-white/10"
              : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          }`}
        >
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Asistente del CRM</h2>
          <p className="text-sm text-neutral-500">
            El chat de la burbuja. Contesta preguntas sobre leads, embudo y métricas.
          </p>
        </div>

        {config && (
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            aria-label="Asistente del CRM"
            disabled={!puedeEditar || saving}
            onClick={() => guardar({ ...config, enabled: !config.enabled })}
            className={`ml-auto flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              config.enabled ? "bg-amber-500" : "bg-neutral-300 dark:bg-white/20"
            }`}
          >
            <span
              className={`size-5 rounded-full bg-[#f9f8f3] shadow transition-transform ${
                config.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>

      {config && (
        <>
          <label className="mt-5 block text-sm font-medium" htmlFor="asistente-model">
            Modelo
          </label>
          <select
            id="asistente-model"
            value={config.model}
            disabled={!puedeEditar || saving}
            onChange={(event) => guardar({ ...config, model: event.target.value })}
            className="mt-2 w-full max-w-sm cursor-pointer rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-[#1c1811]"
          >
            {/* El guardado puede no estar en la lista: se agrega para no perderlo. */}
            {!models.includes(config.model) && <option value={config.model}>{config.model}</option>}
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          <p className="mt-3 text-sm text-neutral-500">
            Cada pregunta consulta los datos en el momento y sólo alcanza lo que esa persona podría
            ver por pantalla: un operario que no ve todos los leads tampoco los ve acá.
          </p>

          {!puedeEditar && (
            <p className="mt-2 text-sm text-neutral-500">Sólo un administrador puede cambiarlo.</p>
          )}

          {notice && (
            <p
              className={`mt-3 text-sm ${
                notice.ok ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {notice.message}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Zona horaria del workspace.
 *
 * El resumen arma los días con esta zona y no con el reloj del servidor, que
 * en Vercel es UTC: a las 21:00 de Argentina el gráfico ya abría la barra de
 * mañana y le cargaba los mensajes de hoy.
 *
 * Es del workspace y no de cada dispositivo a propósito: dos personas mirando
 * el mismo tablero desde distintos países tienen que ver el mismo número.
 */
function TimezoneCard({ timezone }: { timezone: string }) {
  const access = useAccess();
  const [value, setValue] = useState(timezone);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  // La zona guardada puede no estar en la lista (la cargó otro admin, o quedó
  // de antes): se agrega para que el selector no la pise en silencio.
  const options = TIMEZONE_OPTIONS.some((option) => option.zone === timezone)
    ? TIMEZONE_OPTIONS
    : [{ zone: timezone, label: timezone }, ...TIMEZONE_OPTIONS];

  const puedeEditar = access.isAdmin;

  const guardar = (zone: string) => {
    setValue(zone);
    setNotice(null);
    startSaving(async () => {
      const result = await updateWorkspaceTimezone({ timezone: zone });
      if (result.ok) {
        setNotice({ ok: true, message: "Zona horaria guardada." });
      } else {
        setValue(timezone);
        setNotice({ ok: false, message: result.error });
      }
    });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Clock className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Zona horaria</h2>
          <p className="text-sm text-neutral-500">
            Define dónde corta el día en el resumen y en las métricas del mes.
          </p>
        </div>
      </div>

      <label className="mt-5 block text-sm font-medium" htmlFor="workspace-timezone">
        Zona del workspace
      </label>
      <select
        id="workspace-timezone"
        value={value}
        disabled={!puedeEditar || saving}
        onChange={(event) => guardar(event.target.value)}
        className="mt-2 w-full max-w-sm cursor-pointer rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-[#1c1811]"
      >
        {options.map((option) => (
          <option key={option.zone} value={option.zone}>
            {option.label}
          </option>
        ))}
      </select>

      <p className="mt-3 text-sm text-neutral-500" suppressHydrationWarning>
        Con esta zona, hoy es <strong className="text-neutral-700 dark:text-neutral-300">
        {longDateInZone(new Date(), value)}</strong>.
      </p>

      {!puedeEditar && (
        <p className="mt-2 text-sm text-neutral-500">
          Sólo un administrador puede cambiarla.
        </p>
      )}

      {notice && (
        <p
          className={`mt-3 text-sm ${
            notice.ok ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {notice.message}
        </p>
      )}
    </Card>
  );
}
