import { NextResponse } from "next/server";

import { normalizarPlantillas } from "@/lib/plantillas";
import { getWorkspaceContext } from "@/lib/workspace";
import { pedirPlantillasCrudas } from "@/lib/ycloud-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Muestra las plantillas como las devuelve YCloud y como las leemos nosotros.
 *
 * Separa dos fallas que desde el selector se ven iguales: que la cuenta no
 * tenga plantillas aprobadas, o que las tenga y no estemos entendiendo el
 * envoltorio en el que vienen. El contrato de la API se escribió sin la
 * documentación a mano, así que esto es lo que permite corregirlo mirando.
 *
 * Exige sesión: el contenido de las plantillas es material de la empresa.
 */
export async function GET() {
  const context = await getWorkspaceContext();
  if (context.status !== "ready") {
    return NextResponse.json({ error: "Entrá al CRM antes de abrir esta URL." }, { status: 401 });
  }

  const crudas = await pedirPlantillasCrudas();
  if (!crudas.ok) return NextResponse.json({ error: crudas.error }, { status: 502 });

  const entendidas = normalizarPlantillas(crudas.cuerpo);

  return NextResponse.json({
    entendidas: entendidas.length,
    aprobadas: entendidas.filter((p) => p.estado === "APPROVED").length,
    plantillas: entendidas.map((p) => ({
      nombre: p.nombre,
      idioma: p.idioma,
      estado: p.estado,
      componentes: p.componentes.map((c) => c.tipo),
    })),
    respuesta_de_ycloud: crudas.cuerpo,
  });
}
