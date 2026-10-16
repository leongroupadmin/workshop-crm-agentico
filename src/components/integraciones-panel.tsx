"use client";

import {
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Plug,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  deleteIntegracion,
  loadIntegraciones,
  saveIntegracion,
  type IntegracionesResult,
} from "@/app/actions";
import { useAccess } from "@/components/access";
import { Card, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import {
  DEFINICIONES,
  partesDelPaso,
  urlConSecreto,
  type Campo,
  type CampoVisible,
  type Integracion,
} from "@/lib/integraciones";
import type { EstadoDeIntegracion } from "@/lib/integraciones-server";

/**
 * Las conexiones con cada proveedor: OpenAI, YCloud y Zernio.
 *
 * Reemplaza a cargar las claves en las variables de Vercel y volver a
 * desplegar, que es donde más se trababa quien instala el CRM. Los secretos se
 * escriben y no se vuelven a ver —el servidor los guarda cifrados y sólo
 * contesta si están cargados—, así que dejar un campo de secreto vacío al
 * guardar conserva el que había.
 *
 * Cada proveedor que manda eventos muestra su URL de webhook, lista para
 * copiar.
 */
export function IntegracionesCard() {
  const access = useAccess();
  const [estado, setEstado] = useState<IntegracionesResult | null>(null);
  const [abierta, setAbierta] = useState<Integracion | null>(null);

  const cargar = useCallback(() => {
    loadIntegraciones().then(setEstado);
  }, []);

  useEffect(() => {
    if (access.isAdmin) cargar();
  }, [access.isAdmin, cargar]);

  if (!access.isAdmin) return null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Plug className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Conexiones</h2>
          <p className="text-sm text-neutral-500">
            Tus cuentas de OpenAI, YCloud y Zernio. Las claves se guardan cifradas y no se vuelven
            a mostrar.
          </p>
        </div>
        <button
          type="button"
          onClick={cargar}
          className="shrink-0 rounded-lg p-2 text-neutral-500 transition hover:bg-black/[0.04] dark:hover:bg-white/5"
          title="Volver a consultar"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {!estado ? (
        <p className="mt-5 text-sm text-neutral-500">Cargando…</p>
      ) : !estado.ok ? (
        <p className="mt-5 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {estado.error}
        </p>
      ) : (
        <>
          {estado.problemaDeLaClave && <FaltaLaClave problema={estado.problemaDeLaClave} />}
          <ul className="mt-4 divide-y divide-[#ddd8c9] rounded-xl border border-[#ddd8c9] dark:divide-white/10 dark:border-white/10">
            {estado.integraciones.map((integracion) => (
              <li key={integracion.integracion}>
                <Fila
                  estado={integracion}
                  abierta={abierta === integracion.integracion}
                  onAlternar={() =>
                    setAbierta(abierta === integracion.integracion ? null : integracion.integracion)
                  }
                  onCambio={cargar}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Fila({
  estado,
  abierta,
  onAlternar,
  onCambio,
}: {
  estado: EstadoDeIntegracion;
  abierta: boolean;
  onAlternar: () => void;
  onCambio: () => void;
}) {
  const definicion = DEFINICIONES[estado.integracion];
  const tocada = estado.campos.some((campo) => campo.cargado);
  const delEntorno = estado.campos.some((campo) => campo.origen === "entorno");

  const etiqueta = estado.ilegible
    ? { texto: "Volvé a cargarla", clase: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" }
    : estado.configurada && tocada
      ? {
          texto: delEntorno ? "Conectada (Vercel)" : "Conectada",
          clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
        }
      : tocada
        ? { texto: "Incompleta", clase: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" }
        : { texto: "Sin conectar", clase: "bg-neutral-200 text-neutral-600 dark:bg-white/10 dark:text-neutral-300" };

  return (
    <div>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{definicion.nombre}</p>
          <p className="truncate text-xs text-neutral-500">{definicion.descripcion}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${etiqueta.clase}`}>
          {etiqueta.texto}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-neutral-400 transition ${abierta ? "rotate-180" : ""}`} />
      </button>

      {abierta && (
        <Formulario estado={estado} onCambio={onCambio} />
      )}
    </div>
  );
}

function Formulario({
  estado,
  onCambio,
}: {
  estado: EstadoDeIntegracion;
  onCambio: () => void;
}) {
  const definicion = DEFINICIONES[estado.integracion];
  const visibles = new Map<string, CampoVisible>(estado.campos.map((campo) => [campo.clave, campo]));

  // Los campos públicos arrancan con lo guardado; los secretos, siempre vacíos.
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      definicion.campos.map((campo) => [
        campo.clave,
        campo.secreto || visibles.get(campo.clave)?.origen !== "panel"
          ? ""
          : visibles.get(campo.clave)?.valor ?? "",
      ]),
    ),
  );
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  // El secreto del webhook que ya quedó guardado en esta pantalla: hasta que
  // coincida con el escrito, la URL con el secreto todavía no funciona.
  const [secretoGuardado, setSecretoGuardado] = useState("");

  const guardar = () =>
    startTransition(async () => {
      const enviado = (valores.webhook_secret ?? "").trim();
      const resultado = await saveIntegracion({ integracion: estado.integracion, valores });
      if (!resultado.ok) return setAviso({ ok: false, texto: resultado.error });
      setSecretoGuardado(enviado);
      setAviso({ ok: true, texto: "Guardado." });
      onCambio();
    });

  const desconectar = () => {
    if (!window.confirm(`¿Desconectar ${definicion.nombre}? Se borran las credenciales guardadas.`)) return;
    startTransition(async () => {
      const resultado = await deleteIntegracion({ integracion: estado.integracion });
      if (!resultado.ok) return setAviso({ ok: false, texto: resultado.error });
      setAviso({ ok: true, texto: resultado.warning ?? "Desconectada." });
      onCambio();
    });
  };

  const urlDelWebhook =
    definicion.webhook && typeof window !== "undefined"
      ? `${window.location.origin}${definicion.webhook.ruta}`
      : null;

  // Con el secreto recién generado o escrito, la URL se arma con él adentro:
  // una sola cosa para pegar en el proveedor. Sólo existe mientras el secreto
  // está en esta pantalla, porque guardado ya no vuelve al navegador.
  const secretoGenerable = definicion.campos.some((campo) => campo.clave === "webhook_secret" && campo.generable);
  const secretoNuevo = secretoGenerable ? (valores.webhook_secret ?? "").trim() : "";
  const urlCompleta = urlDelWebhook && secretoNuevo ? urlConSecreto(urlDelWebhook, secretoNuevo) : null;
  const faltaGuardar = Boolean(secretoNuevo) && secretoNuevo !== secretoGuardado;
  const donde = definicion.webhook?.donde ?? "el proveedor";

  // Lo que ningún paso pide es opcional: va plegado antes de guardar.
  const pedidos = new Set(definicion.pasos.map((paso) => paso.con));
  const opcionales = definicion.campos.filter((campo) => !pedidos.has(campo.clave));

  const campoDelFormulario = (campo: Campo) => {
    const visible = visibles.get(campo.clave);
    const placeholder = campo.secreto
      ? visible?.origen === "panel"
        ? "•••••••• guardada (dejala vacía para conservarla)"
        : visible?.origen === "entorno"
          ? `Tomada de ${campo.env} en Vercel`
          : campo.placeholder ?? ""
      : visible?.origen === "entorno"
        ? `${visible.valor ?? ""} (de ${campo.env} en Vercel)`
        : campo.porDefecto ?? campo.placeholder ?? "";

    return (
      <label key={campo.clave} className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
          {campo.secreto && <KeyRound className="size-3.5" />}
          {campo.etiqueta}
          {!campo.requerido && <span className="font-normal text-neutral-400">(opcional)</span>}
        </span>
        <div className="mt-1 flex gap-2">
          <input
            type={campo.secreto ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            value={valores[campo.clave] ?? ""}
            onChange={(event) => setValores({ ...valores, [campo.clave]: event.target.value })}
            placeholder={placeholder}
            className={`${INPUT_CLASS} font-mono text-sm`}
          />
          {campo.generable && (
            <button
              type="button"
              onClick={() => setValores({ ...valores, [campo.clave]: secretoAlAzar() })}
              className="shrink-0 cursor-pointer rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              title="Generar uno al azar"
            >
              Generar
            </button>
          )}
        </div>
        {campo.ayuda && <span className="mt-1 block text-xs text-neutral-500">{campo.ayuda}</span>}
      </label>
    );
  };

  const paraGuardar = (
    <div className="space-y-3">
      {opcionales.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-neutral-500">Opciones avanzadas (casi nunca hacen falta)</summary>
          <div className="mt-2 space-y-3">{opcionales.map(campoDelFormulario)}</div>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={guardar} disabled={pendiente} className={PRIMARY_BUTTON_CLASS}>
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        {aviso && (
          <p className={`text-sm ${aviso.ok ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
            {aviso.ok && <Check className="mr-1 inline size-4" />}
            {aviso.texto}
          </p>
        )}
      </div>
    </div>
  );

  const laUrl = urlDelWebhook && (
    <div className="text-sm">
      {urlCompleta ? (
        /* El secreto va adentro de la URL y se copia con el botón: con la URL
           y el secreto por separado, pegarlos mal en el proveedor —o con el
           texto de un aviso pegado— era la causa de casi todos los 401. */
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="font-medium">URL para pegar en {donde}</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">Ya trae el secreto: no hace falta cargarlo aparte.</p>
          <Copiable texto={urlCompleta} />
          {faltaGuardar ? (
            <p className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              Falta tocar Guardar: hasta entonces esta URL no funciona.
            </p>
          ) : (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              Guardado. Cuando cierres esta pantalla no se vuelve a ver: copiala ahora.
            </p>
          )}
          <details className="mt-2 text-xs text-neutral-500">
            <summary className="cursor-pointer">¿{donde} te pide el secreto por separado?</summary>
            <p className="mt-1">Es este. Si lo cargás, tiene que ser exactamente igual.</p>
            <Copiable texto={secretoNuevo} />
          </details>
        </div>
      ) : (
        <>
          <Copiable texto={urlDelWebhook} />
          {secretoGenerable && (
            <p className="mt-1 text-xs text-neutral-500">
              Esta todavía no trae el secreto. Si ya está andando, no toques nada. Para armarla con el secreto
              incluido, tocá Generar más arriba y Guardar.
            </p>
          )}
        </>
      )}
    </div>
  );

  const loQueSeCompleta = (con: string | undefined) => {
    if (con === "guardar") return paraGuardar;
    if (con === "url") return laUrl;
    const campo = definicion.campos.find((candidato) => candidato.clave === con);
    return campo ? campoDelFormulario(campo) : null;
  };

  return (
    <div className="space-y-4 border-t border-[#ddd8c9] bg-black/[0.015] px-4 py-4 dark:border-white/10 dark:bg-white/[0.02]">
      {estado.ilegible && (
        <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Las claves guardadas no se pueden leer: probablemente cambió INTEGRATIONS_ENCRYPTION_KEY en
          Vercel. Volvé a escribirlas y guardá.
        </p>
      )}

      {/* El formulario es la lista de pasos: cada campo, adentro del paso que lo pide. */}
      <ol className="space-y-4">
        {definicion.pasos.map((paso, indice) => (
          <li key={indice} className="border-l-2 border-amber-300 pl-3 dark:border-amber-500/40">
            <p className="text-sm leading-6">
              <span className="mr-1 font-semibold text-amber-700 dark:text-amber-300">Paso {indice + 1}.</span>
              <TextoDelPaso texto={paso.texto} />
            </p>
            {paso.con && <div className="mt-2">{loQueSeCompleta(paso.con)}</div>}
          </li>
        ))}
      </ol>
      {!pedidos.has("guardar") && paraGuardar}

      {estado.campos.some((campo) => campo.origen === "panel") && (
        <div className="flex justify-end border-t border-[#ddd8c9] pt-3 dark:border-white/10">
          <button
            type="button"
            onClick={desconectar}
            disabled={pendiente}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Unplug className="size-4" />
            Desconectar
          </button>
        </div>
      )}
    </div>
  );
}

/** El texto de un paso, con sus direcciones como links que abren aparte. */
function TextoDelPaso({ texto }: { texto: string }) {
  return partesDelPaso(texto).map((parte, posicion) =>
    parte.tipo === "link" ? (
      <a
        key={posicion}
        href={parte.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium break-all text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
      >
        {parte.texto}
      </a>
    ) : (
      <span key={posicion}>{parte.texto}</span>
    ),
  );
}

function Copiable({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2 dark:border-white/10 dark:bg-white/5">
      <code className="min-w-0 flex-1 break-all text-xs">{texto}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(texto).then(() => {
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1500);
          });
        }}
        className="shrink-0 cursor-pointer rounded-lg p-1.5 text-neutral-500 transition hover:bg-black/[0.04] dark:hover:bg-white/5"
        title="Copiar"
      >
        {copiado ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Lo que hay que hacer una sola vez antes de poder guardar claves.
 *
 * La llave con la que se cifran no puede vivir en la base —protegería lo mismo
 * que dejarla al lado de la caja fuerte—, así que va en Vercel. Para que nadie
 * tenga que inventarla, la pantalla trae una ya generada para copiar.
 */
function FaltaLaClave({ problema }: { problema: string }) {
  const [clave] = useState(secretoAlAzar);
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="flex items-start gap-2 font-semibold">
        <TriangleAlert className="mt-1 size-4 shrink-0" />
        Antes de conectar, falta un paso en Vercel (se hace una sola vez)
      </p>
      <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">{problema}</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li>
          En Vercel, abrí tu proyecto y andá a <strong>Settings → Environment Variables</strong>.
        </li>
        <li>
          Agregá una variable con el nombre <code className="font-mono">INTEGRATIONS_ENCRYPTION_KEY</code> y
          este valor, que ya generamos para vos:
          <Copiable texto={clave} />
        </li>
        <li>
          Tocá <strong>Save</strong> y después, en <strong>Deployments</strong>, los tres puntos del último →{" "}
          <strong>Redeploy</strong>.
        </li>
        <li>Volvé a esta pantalla. Este aviso desaparece y ya podés guardar las claves.</li>
      </ol>
      <p className="mt-3 text-xs text-amber-900/80 dark:text-amber-200/80">
        No la cambies después: las claves guardadas con ella dejarían de poder leerse.
      </p>
    </div>
  );
}

/** 32 bytes al azar en hex, del generador criptográfico del navegador. */
function secretoAlAzar(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
