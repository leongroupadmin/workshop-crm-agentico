/**
 * Armado de CSV para abrir en Excel.
 *
 * Un CSV parece texto separado por comas hasta que un contacto se llama
 * "Pérez, Juan" o alguien manda un mensaje con un salto de línea: ahí la
 * planilla se corre una columna y el archivo entero deja de servir. Este módulo
 * existe para que esas reglas estén en un solo lugar y se puedan afirmar.
 *
 * Tres decisiones que no son obvias:
 *
 * - **Separador `;`.** Excel no lee el separador del archivo sino la
 *   configuración regional de quien lo abre, y en español es punto y coma. Con
 *   comas, el doble clic deja todo en una sola columna.
 * - **BOM al principio.** Sin él, Excel abre el archivo como Latin-1 y los
 *   acentos y las eñes salen rotos.
 * - **Fin de línea CRLF**, que es lo que dice el estándar del formato y lo que
 *   esperan las planillas viejas.
 */

const SEPARADOR = ";";
const FIN_DE_LINEA = "\r\n";
const BOM = "﻿";

/** Una columna: cómo se titula y qué saca de cada fila. */
export type Columna<T> = {
  titulo: string;
  valor: (fila: T) => string | number | null | undefined;
};

/**
 * Neutraliza las celdas que una planilla interpretaría como fórmula.
 *
 * El nombre de un contacto lo escribe el contacto: llega de WhatsApp tal cual
 * lo puso él. Una celda que empieza con `=`, `+`, `-` o `@` no es texto para
 * Excel, es una fórmula, y hay ataques conocidos que se aprovechan de eso desde
 * un CSV exportado. Con la comilla adelante se ve igual y no se ejecuta.
 */
function neutralizar(texto: string): string {
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

/** Una celda, escapada según las reglas del formato. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";

  const texto = neutralizar(String(valor));

  // Se entrecomilla cuando hay algo que podría partir la fila o la columna, y
  // también con espacios en las puntas, que si no algunas planillas se comen.
  const necesitaComillas =
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes("\n") ||
    texto.includes("\r") ||
    texto !== texto.trim();

  return necesitaComillas ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** El archivo entero, listo para descargar. */
export function aCsv<T>(columnas: Columna<T>[], filas: T[]): string {
  const encabezado = columnas.map((columna) => celda(columna.titulo)).join(SEPARADOR);
  const cuerpo = filas.map((fila) =>
    columnas.map((columna) => celda(columna.valor(fila))).join(SEPARADOR),
  );

  return BOM + [encabezado, ...cuerpo].join(FIN_DE_LINEA) + FIN_DE_LINEA;
}

/**
 * Nombre del archivo, con la fecha adelante.
 *
 * Con la fecha en el medio del nombre, la carpeta de Descargas ordena por
 * nombre y mezcla los respaldos de meses distintos. Así quedan en orden.
 */
export function nombreDeArchivo(base: string, dia: string): string {
  return `${dia}-${base}.csv`;
}
