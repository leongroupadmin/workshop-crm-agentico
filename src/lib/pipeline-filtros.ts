/**
 * Los filtros del embudo.
 *
 * Viven fuera del panel porque son la parte que se puede equivocar en silencio:
 * un filtro que deja pasar de más no rompe nada en pantalla, simplemente muestra
 * un embudo que no es el que se pidió, y eso se descubre tarde. Acá se pueden
 * afirmar sin montar el board.
 *
 * No importan nada del navegador: reciben la tarjeta ya armada y contestan si
 * entra o no.
 */

import type { Channel } from "@/types/database";

/** Lo que se eligió en el popup. Todo vacío es "sin filtrar". */
export type FiltroPipeline = {
  /** Texto libre: nombre o teléfono del contacto. */
  texto: string;
  /**
   * Responsables. Vacío es cualquiera.
   *
   * `"sin-asignar"` es una opción más y no un valor aparte: en la pantalla se
   * elige de la misma lista que a las personas, y tratarlo distinto obligaba a
   * dos controles para una sola pregunta.
   */
  responsables: string[];
  /** Canales por los que el contacto escribió. Alcanza con uno. */
  canales: Channel[];
  /** Fecha de alta del lead, en yyyy-mm-dd y en la zona del workspace. */
  desde: string | null;
  hasta: string | null;
};

export const SIN_ASIGNAR = "sin-asignar";

export const FILTRO_PIPELINE_VACIO: FiltroPipeline = {
  texto: "",
  responsables: [],
  canales: [],
  desde: null,
  hasta: null,
};

/** Lo que el filtro necesita saber de una tarjeta. */
export type TarjetaFiltrable = {
  contactName: string;
  contactPhone: string | null;
  channels: Channel[];
  assignedTo: string | null;
  /** Día de alta en la zona del workspace, yyyy-mm-dd. */
  dia: string;
};

export function pasaElFiltro(tarjeta: TarjetaFiltrable, filtro: FiltroPipeline): boolean {
  const texto = filtro.texto.trim().toLowerCase();
  if (
    texto &&
    ![tarjeta.contactName, tarjeta.contactPhone ?? ""].some((campo) =>
      campo.toLowerCase().includes(texto),
    )
  ) {
    return false;
  }

  if (filtro.responsables.length > 0) {
    const responsable = tarjeta.assignedTo ?? SIN_ASIGNAR;
    if (!filtro.responsables.includes(responsable)) return false;
  }

  if (
    filtro.canales.length > 0 &&
    !tarjeta.channels.some((canal) => filtro.canales.includes(canal))
  ) {
    return false;
  }

  // Una tarjeta sin fecha legible no se puede ubicar en el rango. Se descarta
  // sólo si hay rango: sin filtro de fechas no tiene por qué desaparecer.
  if (filtro.desde || filtro.hasta) {
    if (!tarjeta.dia) return false;
    // yyyy-mm-dd ordena como el calendario: no hace falta construir un Date.
    if (filtro.desde && tarjeta.dia < filtro.desde) return false;
    if (filtro.hasta && tarjeta.dia > filtro.hasta) return false;
  }

  return true;
}

/**
 * Cuántos filtros hay puestos.
 *
 * Es lo que muestra el botón: sin un número, un embudo filtrado se ve igual que
 * un embudo vacío y la explicación queda escondida adentro del popup.
 *
 * El texto no cuenta acá porque tiene su propio campo a la vista.
 */
export function filtrosPuestos(filtro: FiltroPipeline): number {
  return (
    (filtro.responsables.length > 0 ? 1 : 0) +
    (filtro.canales.length > 0 ? 1 : 0) +
    (filtro.desde || filtro.hasta ? 1 : 0)
  );
}

/** Si el filtro está recortando algo, contando el buscador. */
export function filtraAlgo(filtro: FiltroPipeline): boolean {
  return filtro.texto.trim().length > 0 || filtrosPuestos(filtro) > 0;
}
