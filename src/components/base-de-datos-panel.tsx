"use client";

import { Database, Download, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { exportTable, importContacts } from "@/app/actions";
import { OpcionesDeEtapa } from "@/components/opciones-de-etapa";
import { Card, PRIMARY_BUTTON_CLASS } from "@/components/ui";
import type { StageRow } from "@/lib/crm-data";
import { TABLAS, type TablaExportable } from "@/lib/exportables";
import { leerContactos, MAX_IMPORTADAS, type Lectura } from "@/lib/importar";

/**
 * Base de datos: sacar los datos del CRM.
 *
 * Nació como una tarjeta adentro de Configuración y no funcionaba: nadie busca
 * "descargar la base" en la misma pantalla donde se elige la zona horaria. Es
 * una tarea con nombre propio y ahora tiene su lugar en el menú, que es donde
 * la gente la va a buscar.
 *
 * Un archivo por tabla y no uno solo con todo: el CSV es una grilla, y meter
 * contactos, chats y turnos en la misma grilla obliga a inventar columnas
 * vacías para las tres cuartas partes de cada fila. Separados, cada uno se abre
 * en Excel y ya está listo para filtrar.
 */
export function BaseDeDatosPanel({ stages }: { stages: StageRow[] }) {
  const [bajando, setBajando] = useState<TablaExportable | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const descargar = async (tabla: TablaExportable, titulo: string) => {
    setBajando(tabla);
    setNotice(null);

    const result = await exportTable({ tabla });
    setBajando(null);

    if (!result.ok) {
      setNotice({ ok: false, message: result.error });
      return;
    }

    if (result.filas === 0) {
      setNotice({ ok: false, message: `No hay ${titulo.toLowerCase()} para descargar todavía.` });
      return;
    }

    // El archivo se arma en el servidor y lo baja el navegador. El objeto URL se
    // suelta apenas se usa: uno que queda vivo se lleva en memoria el contenido
    // entero de la planilla.
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.nombre;
    link.click();
    URL.revokeObjectURL(url);

    setNotice({
      ok: true,
      message: result.recortado
        ? `Se descargaron ${result.filas} filas de ${titulo.toLowerCase()}, que es el máximo por archivo. Faltan las más viejas.`
        : `Listo: ${result.filas} ${result.filas === 1 ? "fila" : "filas"} en ${result.nombre}.`,
    });
  };

  return (
    <div className="space-y-5">
      <CargarContactos stages={stages} />

      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Database className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Descargar la base</h2>
            <p className="text-sm text-neutral-500">
              Un archivo por tabla, listo para abrir en Excel.
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {TABLAS.map((tabla) => (
            <li key={tabla.clave}>
              <button
                type="button"
                disabled={bajando !== null}
                onClick={() => void descargar(tabla.clave, tabla.titulo)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[#ddd8c9] p-4 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{tabla.titulo}</span>
                  <span className="mt-0.5 block text-sm text-neutral-500">{tabla.detalle}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-500">
                  <Download className="size-4" />
                  {bajando === tabla.clave ? "Armando…" : "Descargar"}
                </span>
              </button>
            </li>
          ))}
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
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Cómo vienen los archivos</h2>
        <ul className="mt-3 space-y-2 text-sm text-neutral-500">
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Listos para Excel en
            español.</strong>{" "}
            Separados por punto y coma, que es lo que espera Excel según la configuración regional,
            y con la codificación marcada para que los acentos y las eñes no salgan rotos. Se abren
            con doble clic, sin asistentes de importación.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Fechas de acá y nombres, no
            códigos.</strong>{" "}
            Las fechas van en la zona horaria del workspace, y el responsable y la etapa salen
            escritos, no como identificadores.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Hasta 20.000 filas por
            archivo.</strong>{" "}
            Si una tabla tiene más, se descargan las más nuevas y el aviso lo dice.
          </li>
          <li>
            <strong className="text-neutral-700 dark:text-neutral-300">Sólo administradores.</strong>{" "}
            No hay ningún link para compartir: el archivo se arma con tu sesión y lo baja tu
            navegador. Son datos personales de clientes reales y, una vez descargados, no los
            protege ningún permiso del CRM.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/**
 * Cargar contactos desde un archivo.
 *
 * Tres momentos, uno abajo del otro: elegir el archivo, mirar qué se entendió,
 * confirmar. La vista previa no es cosmética — dice cuántos son nuevos y
 * cuántos ya están, y ese número lo calcula el servidor con la misma cuenta que
 * va a hacer al guardar, así lo que se lee antes de apretar es lo que va a
 * pasar.
 *
 * El archivo se lee en el navegador: no se sube a ningún lado, viajan las filas
 * ya limpias.
 */
function CargarContactos({ stages }: { stages: StageRow[] }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [actualizar, setActualizar] = useState(true);
  const [cuenta, setCuenta] = useState<{ nuevos: number; actualizados: number; salteados: number } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [trabajando, empezar] = useTransition();

  const limpiar = () => {
    setArchivo(null);
    setLectura(null);
    setCuenta(null);
    if (entrada.current) entrada.current.value = "";
  };

  const elegir = async (file: File) => {
    setNotice(null);
    setCuenta(null);
    setArchivo(file.name);

    const leido = leerContactos(await file.text());
    setLectura(leido);

    if (leido.error || leido.filas.length === 0) return;

    // La cuenta la hace el servidor porque es el único que sabe qué hay en la
    // base: contra los contactos que el dashboard tiene en pantalla la vista
    // previa mentiría en cuanto la base pase de un par de cientos.
    empezar(async () => {
      const result = await importContacts({
        filas: leido.filas,
        stageId,
        actualizarExistentes: actualizar,
        simular: true,
      });

      if (result.ok) setCuenta(result);
      else setNotice({ ok: false, message: result.error });
    });
  };

  const cargar = () => {
    if (!lectura || lectura.filas.length === 0) return;

    empezar(async () => {
      const result = await importContacts({
        filas: lectura.filas,
        stageId,
        actualizarExistentes: actualizar,
        simular: false,
      });

      if (!result.ok) {
        setNotice({ ok: false, message: result.error });
        return;
      }

      const partes = [`${result.nuevos} ${result.nuevos === 1 ? "contacto nuevo" : "contactos nuevos"}`];
      if (result.actualizados > 0) partes.push(`${result.actualizados} actualizados`);
      if (result.salteados > 0) partes.push(`${result.salteados} que ya estaban, sin tocar`);

      setNotice({ ok: true, message: `Listo: ${partes.join(", ")}.` });
      limpiar();
    });
  };

  const listo = lectura !== null && !lectura.error && lectura.filas.length > 0 && stageId !== "";

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Upload className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Cargar contactos</h2>
          <p className="text-sm text-neutral-500">
            Desde un CSV: el mismo que baja de acá, o uno exportado de otra herramienta.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <input
          ref={entrada}
          type="file"
          accept=".csv,text/csv"
          aria-label="Archivo CSV de contactos"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void elegir(file);
          }}
          className="block w-full cursor-pointer text-sm text-neutral-500 file:mr-3 file:cursor-pointer file:rounded-xl file:border-0 file:bg-neutral-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold hover:file:bg-neutral-200 dark:file:bg-white/10 dark:hover:file:bg-white/20"
        />
        <p className="mt-2 text-xs text-neutral-400">
          La primera fila tiene que ser la de los títulos. Se buscan las columnas de nombre,
          teléfono, email y etiquetas: no importa el orden ni si están escritas con acento.
        </p>
      </div>

      {lectura?.error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {lectura.error}
        </p>
      )}

      {lectura && !lectura.error && (
        <div className="mt-5 rounded-xl bg-neutral-50 p-4 dark:bg-white/[.04]">
          <p className="text-sm font-semibold">
            {archivo}: {lectura.filas.length} {lectura.filas.length === 1 ? "contacto" : "contactos"}
          </p>

          <p className="mt-1 text-xs text-neutral-500">
            Columnas que se usaron: {describirColumnas(lectura)}.
          </p>

          {(lectura.vacias > 0 || lectura.repetidas > 0) && (
            <p className="mt-1 text-xs text-neutral-500">
              {lectura.vacias > 0 && `${lectura.vacias} sin nombre ni teléfono. `}
              {lectura.repetidas > 0 && `${lectura.repetidas} repetidas dentro del archivo.`}
            </p>
          )}

          {lectura.filas.length >= MAX_IMPORTADAS && (
            <p className="mt-1 text-xs text-neutral-500">
              El archivo tenía más: se leen hasta {MAX_IMPORTADAS} por vez.
            </p>
          )}

          <ul className="mt-3 divide-y divide-neutral-200 text-sm dark:divide-white/10">
            {lectura.filas.slice(0, 5).map((fila, indice) => (
              <li key={`${fila.telefono ?? fila.email ?? fila.nombre}-${indice}`} className="py-2">
                <span className="block truncate font-medium">{fila.nombre}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {[fila.telefono, fila.email, fila.etiquetas.join(", ")].filter(Boolean).join(" · ") ||
                    "Sin teléfono ni email"}
                </span>
              </li>
            ))}
          </ul>
          {lectura.filas.length > 5 && (
            <p className="mt-2 text-xs text-neutral-400">
              …y {lectura.filas.length - 5} más.
            </p>
          )}

          {cuenta && (
            <p className="mt-3 text-sm">
              Se van a cargar <strong>{cuenta.nuevos}</strong>{" "}
              {cuenta.nuevos === 1 ? "contacto nuevo" : "contactos nuevos"}
              {cuenta.actualizados > 0 && <> y actualizar <strong>{cuenta.actualizados}</strong> que ya estaban</>}
              {cuenta.salteados > 0 && <>. <strong>{cuenta.salteados}</strong> ya están en la base y quedan como están</>}
              .
            </p>
          )}
        </div>
      )}

      <div className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500" htmlFor="etapa-importacion">
            En qué columna del embudo entran
          </label>
          <select
            id="etapa-importacion"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className="mt-1.5 w-full max-w-sm cursor-pointer rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 text-sm dark:border-white/10 dark:bg-[#1c1811]"
          >
            <OpcionesDeEtapa stages={stages} />
          </select>
          {stages.length === 0 && (
            <p className="mt-1.5 text-xs text-red-600">
              El embudo no tiene columnas: creá una antes de importar.
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={actualizar}
            onChange={(event) => setActualizar(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-500"
          />
          <span>
            Completar los que ya están
            <span className="mt-0.5 block text-xs text-neutral-500">
              Se cruzan por teléfono y por email. Lo que el CRM ya tenía cargado no se pisa: sólo se
              llenan los huecos y se suman las etiquetas nuevas. Sin esto, los repetidos se saltean.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={cargar}
          disabled={!listo || trabajando}
          className={`${PRIMARY_BUTTON_CLASS} w-full disabled:opacity-50`}
        >
          <Upload className="size-4" />
          {trabajando ? "Trabajando…" : "Cargar contactos"}
        </button>
      </div>

      {notice && (
        <p
          className={`mt-3 text-sm ${
            notice.ok ? "text-amber-700 dark:text-amber-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {notice.message}
        </p>
      )}

      <p className="mt-4 text-xs leading-5 text-neutral-400">
        Los contactos importados no disparan automatizaciones. Una importación de cientos de filas
        con una automatización de &ldquo;lead nuevo&rdquo; prendida sería una ráfaga de mensajes a
        gente que nunca escribió, y eso no se deshace.
      </p>
    </Card>
  );
}

function describirColumnas(lectura: Lectura): string {
  const usadas = [
    lectura.columnas.nombre && `nombre (${lectura.columnas.nombre})`,
    lectura.columnas.telefono && `teléfono (${lectura.columnas.telefono})`,
    lectura.columnas.email && `email (${lectura.columnas.email})`,
    lectura.columnas.etiquetas && `etiquetas (${lectura.columnas.etiquetas})`,
  ].filter(Boolean);

  return usadas.join(", ");
}
