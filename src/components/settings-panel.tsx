"use client";

import {
  Check,
  Clock,
  KeyRound,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  loadAssistantConfig,
  loadChatModels,
  loadMetaConfig,
  loadWhatsappStatus,
  saveAssistantConfig,
  saveMetaConfig,
  updateWorkspaceTimezone,
  type EstadoDeWhatsapp,
  type MetaConfigVista,
  type MetaConversionFila,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { Card, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import { TIMEZONE_OPTIONS, longDateInZone } from "@/lib/fechas";
import { esEventoMeta, MONEDAS_META, NOMBRE_DEL_EVENTO } from "@/lib/meta-eventos";

/**
 * Configuración del workspace.
 *
 * Acá vivía la API key de OpenAI de cada usuario, guardada en su navegador.
 * Se sacó cuando apareció la key del servidor: eran dos credenciales en dos
 * lugares y sólo una servía para que la IA contestara sola, lo que llevaba a
 * cargar la equivocada y no entender por qué no pasaba nada. Ahora hay una
 * sola, en el entorno, y esta pantalla se limita a decir si está funcionando.
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
              Cargá <code className="font-mono">OPENAI_API_KEY</code> en las variables de entorno
              del servidor y reiniciá el CRM.
            </p>
          </div>
        )}
      </Card>

      <WhatsappCard />

      <TimezoneCard timezone={timezone} />

      <AsistenteCard />

      <MetaCard />

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Cómo funciona la IA</h2>
        <ul className="mt-3 space-y-2 text-sm text-neutral-500">
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Una sola key, en el
            servidor.</strong>{" "}
            Nadie carga credenciales en el navegador. La misma key paga las respuestas automáticas
            y las sugeridas.
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
 * La cuenta de Meta a la que las automatizaciones le avisan las conversiones.
 *
 * Es del workspace porque cada workspace es un cliente con su propia cuenta
 * publicitaria. El token no vuelve nunca a la pantalla: se muestran sus
 * últimos cuatro caracteres para reconocerlo, y dejar el campo vacío conserva
 * el que estaba.
 */
function MetaCard() {
  const access = useAccess();
  const [cargado, setCargado] = useState(false);
  const [guardada, setGuardada] = useState<MetaConfigVista | null>(null);
  const [conversiones, setConversiones] = useState<MetaConversionFila[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [token, setToken] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [testEventCode, setTestEventCode] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const aplicar = (config: MetaConfigVista | null) => {
    setGuardada(config);
    setDatasetId(config?.datasetId ?? "");
    setCurrency(config?.currency ?? "USD");
    setTestEventCode(config?.testEventCode ?? "");
    setToken("");
  };

  useEffect(() => {
    if (!access.isAdmin) return;
    let active = true;
    loadMetaConfig().then((result) => {
      if (!active) return;
      setCargado(true);
      if (!result.ok) {
        setNotice({ ok: false, message: result.error });
        return;
      }
      aplicar(result.config);
      setConversiones(result.conversiones);
    });
    return () => {
      active = false;
    };
  }, [access.isAdmin]);

  if (!access.isAdmin) return null;

  const guardar = () => {
    setNotice(null);
    startSaving(async () => {
      const result = await saveMetaConfig({ datasetId, accessToken: token, currency, testEventCode });
      if (!result.ok) {
        setNotice({ ok: false, message: result.error });
        return;
      }
      const recargado = await loadMetaConfig();
      if (recargado.ok) {
        aplicar(recargado.config);
        setConversiones(recargado.conversiones);
      }
      setNotice({ ok: true, message: "Cuenta de Meta guardada. Meta aceptó el token." });
    });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Megaphone className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Conversiones de Meta</h2>
          <p className="text-sm text-neutral-500">
            {guardada
              ? `Conectado al dataset ${guardada.datasetId}.`
              : "Avisale a Meta cuando un lead de un anuncio llega a una columna del embudo."}
          </p>
        </div>
      </div>

      {cargado && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            ID del dataset
            <input
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value.trim())}
              inputMode="numeric"
              placeholder="1425517971935121"
              className={`${INPUT_CLASS} mt-2`}
            />
          </label>

          <label className="block text-sm font-medium">
            Token de acceso
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              placeholder={
                guardada?.tokenTermina ? `Guardado, termina en …${guardada.tokenTermina}` : "EAAG…"
              }
              className={`${INPUT_CLASS} mt-2`}
            />
          </label>

          <label className="block text-sm font-medium">
            Moneda del valor
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className={`${INPUT_CLASS} mt-2 cursor-pointer`}
            >
              {MONEDAS_META.map((moneda) => (
                <option key={moneda} value={moneda}>
                  {moneda}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium">
            Código de prueba <span className="font-normal text-neutral-500">(opcional)</span>
            <input
              value={testEventCode}
              onChange={(event) => setTestEventCode(event.target.value.trim())}
              placeholder="TEST12345"
              className={`${INPUT_CLASS} mt-2`}
            />
          </label>
        </div>
      )}

      {cargado && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={guardar}
            disabled={saving || !datasetId || (!token && !guardada)}
            className={PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Comprobando con Meta…" : "Guardar"}
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-1.5 text-sm text-neutral-500">
        <li>
          El token se genera en el Administrador de eventos: dataset → Configuración → API de
          conversiones → Generar token de acceso.
        </li>
        <li>
          Con el código de prueba cargado, los eventos aparecen en &ldquo;Probar eventos&rdquo; y no
          cuentan en las campañas. Borralo cuando termines de probar.
        </li>
        <li>
          Para mandar conversiones, armá una automatización &ldquo;Entra en una etapa&rdquo; con el
          paso &ldquo;Enviar conversión a Meta&rdquo;.
        </li>
      </ul>

      {notice && (
        <p
          className={`mt-3 text-sm ${
            notice.ok ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {notice.message}
        </p>
      )}

      {conversiones.length > 0 && (
        <div className="mt-5 border-t border-[#ddd8c9] pt-4 dark:border-white/10">
          <h3 className="text-sm font-medium">Últimas conversiones</h3>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm dark:divide-white/5">
            {conversiones.map((fila) => (
              <li key={fila.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="font-medium">{fila.contacto}</span>
                <span className="text-neutral-500">
                  {esEventoMeta(fila.evento) ? NOMBRE_DEL_EVENTO[fila.evento] : fila.evento}
                  {fila.valor !== null && ` · ${fila.valor.toLocaleString("es-AR")}`}
                </span>
                <span
                  className={`ml-auto text-xs ${
                    fila.estado === "enviada"
                      ? "text-amber-700 dark:text-amber-400"
                      : fila.estado === "fallada"
                        ? "text-red-600 dark:text-red-400"
                        : "text-neutral-500"
                  }`}
                  title={fila.detalle ?? undefined}
                >
                  {fila.estado === "enviada" && "Enviada"}
                  {fila.estado === "fallada" && "Falló"}
                  {fila.estado === "sin_anuncio" && "No vino de un anuncio"}
                </span>
                {fila.estado === "fallada" && fila.detalle && (
                  <span className="w-full text-xs text-red-600/80 dark:text-red-400/80">
                    {fila.detalle}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
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

const ESTILO_DE_LA_SESION: Record<
  EstadoDeWhatsapp["diagnostico"]["nivel"],
  { icono: string; texto: string }
> = {
  ok: {
    icono: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    texto: "text-neutral-500",
  },
  aviso: {
    icono: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    texto: "text-amber-700 dark:text-amber-400",
  },
  alarma: {
    icono: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
    texto: "text-red-600 dark:text-red-400",
  },
};

/**
 * El estado del WhatsApp que manda los recordatorios.
 *
 * El QR está acá y no sólo en el panel de WAHA por una razón práctica: cuando
 * la sesión se cae —el teléfono sin batería, alguien que la cierra desde el
 * celular— quien lo nota es quien usa el CRM, y no tiene por qué tener acceso
 * al servidor para volver a vincular.
 */
function WhatsappCard() {
  const access = useAccess();
  const [estado, setEstado] = useState<EstadoDeWhatsapp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisando, startRevisar] = useTransition();

  const revisar = () => {
    startRevisar(async () => {
      const resultado = await loadWhatsappStatus();
      if (resultado.ok) {
        setEstado(resultado.estado);
        setError(null);
      } else {
        setEstado(null);
        setError(resultado.error);
      }
    });
  };

  useEffect(() => {
    if (access.isAdmin) revisar();
    // Una sola vez al abrir Ajustes: el resto lo pide el botón.
  }, [access.isAdmin]);

  if (!access.isAdmin) return null;

  const estilo = ESTILO_DE_LA_SESION[estado?.diagnostico.nivel ?? "aviso"];

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${estilo.icono}`}>
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">
            {estado?.diagnostico.titulo ?? (error ? "No se pudo consultar" : "WhatsApp")}
          </h2>
          <p className={`text-sm ${error ? "text-red-600 dark:text-red-400" : estilo.texto}`}>
            {error ??
              estado?.diagnostico.mensaje ??
              (revisando ? "Consultando a WhatsApp…" : "Sin datos todavía.")}
          </p>
        </div>
        <button
          type="button"
          onClick={revisar}
          disabled={revisando}
          className="shrink-0 rounded-lg p-2 text-neutral-500 transition hover:bg-black/[0.04] disabled:opacity-40 dark:hover:bg-white/5"
          title="Volver a consultar"
        >
          <RefreshCw className={`size-4 ${revisando ? "animate-spin" : ""}`} />
        </button>
      </div>

      {estado?.qr && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-black/[0.03] p-5 dark:bg-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={estado.qr}
            alt="Código QR para vincular WhatsApp"
            className="size-56 rounded-lg bg-white p-2"
          />
          <p className="max-w-xs text-center text-sm text-neutral-500">
            En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.
          </p>
          <p className="text-center text-xs text-neutral-400">
            El código vence en unos segundos. Si no llegás a tiempo, actualizá con el botón de
            arriba.
          </p>
        </div>
      )}

      {estado?.diagnostico.pideQr && !estado.qr && (
        <p className="mt-4 text-sm text-neutral-500">
          WAHA no entregó el código. Probá con el botón de actualizar, o vinculá desde el panel de
          WAHA.
        </p>
      )}
    </Card>
  );
}
