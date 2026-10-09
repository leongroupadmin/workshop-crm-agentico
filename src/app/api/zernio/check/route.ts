import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { listZernioConversations } from "@/lib/zernio-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Le pregunta a Zernio qué conversaciones tiene de su lado.
 *
 * Separa dos fallas que desde el CRM se ven idénticas: que Zernio no tenga el
 * mensaje, o que lo tenga y no esté disparando el webhook.
 *
 * También compara las cuentas que Zernio reconoce hoy contra las que el CRM
 * tiene guardadas en sus conversaciones. Cuando un perfil se reconecta en
 * Zernio la cuenta queda con otro id, y responder en los hilos viejos falla con
 * "la API key no tiene permiso sobre la cuenta X": `cuentas_vencidas` dice
 * exactamente cuáles quedaron así. El envío las reata solo al primer intento,
 * pero verlas acá separa ese caso del otro que da el mismo 403, que es que la
 * key sea de un perfil distinto —ahí ninguna cuenta coincide.
 *
 * A diferencia del diagnóstico del webhook, esto devuelve datos de clientes,
 * así que exige sesión: sin login no contesta.
 */
export async function GET() {
  const context = await getWorkspaceContext();
  if (context.status !== "ready") {
    return NextResponse.json({ error: "Entrá al CRM antes de abrir esta URL." }, { status: 401 });
  }

  // Se piden 100 y no las 20 por defecto: con menos, una cuenta que Zernio sí
  // reconoce podría no aparecer en el listado y contarse como vencida.
  const result = await listZernioConversations(100);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  const cuentas = [...new Set(result.conversations.map((item) => item.accountId).filter(Boolean))];

  const supabase = await getSupabaseServer();
  const { data: filas } = await supabase
    .from("conversations")
    .select("zernio_account_id")
    .eq("workspace_id", context.workspaceId)
    .eq("provider", "zernio")
    .not("zernio_account_id", "is", null);

  const guardadas = [...new Set((filas ?? []).map((fila) => fila.zernio_account_id as string))];
  const vencidas = guardadas.filter((cuenta) => !cuentas.includes(cuenta));

  return NextResponse.json({
    conversaciones_en_zernio: result.conversations.length,
    // Es el `account.id` que el webhook usa para resolver el workspace.
    cuentas_detectadas: cuentas,
    cuentas_guardadas: guardadas,
    /** Las que el CRM guarda y Zernio ya no reconoce: son las que dan 403. */
    cuentas_vencidas: vencidas,
    detalle: result.conversations.map((item) => ({
      id: item.id,
      canal: item.platform,
      contacto: item.participantName,
      actualizado: item.updatedAt,
    })),
  });
}
