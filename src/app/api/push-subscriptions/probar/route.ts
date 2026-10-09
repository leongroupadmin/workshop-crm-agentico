import { sendTestPush } from "@/lib/push-notifications";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getWorkspaceContext } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manda un aviso de prueba a los dispositivos de quien lo pide.
 *
 * Sin esto, comprobar los avisos exige una derivación real, y encima una sobre
 * un chat que no esté ya pendiente: el aviso sale una sola vez, en la
 * transición. Eso convierte cada intento en coordinar un WhatsApp con otra
 * persona, y cuando falla no queda nada en pantalla que diga por qué.
 *
 * El destinatario sale de la sesión, nunca del cuerpo del pedido: nadie puede
 * hacer sonar el teléfono de otro.
 */
export async function POST() {
  const context = await getWorkspaceContext();
  if (context.status !== "ready") {
    return Response.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const { configurado, resultados } = await sendTestPush(getSupabaseAdmin(), {
    workspaceId: context.workspaceId,
    userId: context.userId,
  });

  if (!configurado) {
    return Response.json({ error: "Los avisos push no están configurados en el servidor." }, { status: 503 });
  }
  if (resultados.length === 0) {
    return Response.json({ error: "Este dispositivo todavía no está registrado." }, { status: 409 });
  }

  return Response.json({ resultados }, { headers: { "Cache-Control": "no-store" } });
}
