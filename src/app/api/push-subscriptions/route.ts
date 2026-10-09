import { getVapidPublicKey } from "@/lib/push-notifications";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getWorkspaceContext } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

async function readyContext() {
  const context = await getWorkspaceContext();
  return context.status === "ready" ? context : null;
}

function noStore(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

/** Devuelve configuración, nunca la clave privada. */
export async function GET() {
  const context = await readyContext();
  if (!context) return noStore({ error: "Sesión inválida." }, { status: 401 });

  const publicKey = getVapidPublicKey();
  return noStore({ configured: Boolean(publicKey), publicKey });
}

/** Guarda o mueve a la sesión actual la suscripción de este navegador. */
export async function POST(request: Request) {
  const context = await readyContext();
  if (!context) return noStore({ error: "Sesión inválida." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as SubscriptionBody | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth.trim() : "";

  if (
    !endpoint.startsWith("https://") ||
    endpoint.length > 4096 ||
    !p256dh ||
    p256dh.length > 512 ||
    !auth ||
    auth.length > 512
  ) {
    return noStore({ error: "La suscripción del navegador no es válida." }, { status: 400 });
  }

  if (!getVapidPublicKey()) {
    return noStore({ error: "Las notificaciones push todavía no están configuradas." }, { status: 503 });
  }

  const { error } = await getSupabaseAdmin().from("push_subscriptions").upsert(
    {
      workspace_id: context.workspaceId,
      user_id: context.userId,
      endpoint,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) return noStore({ error: error.message }, { status: 500 });
  return noStore({ ok: true });
}

/** Desactiva únicamente la suscripción propia que llega en el cuerpo. */
export async function DELETE(request: Request) {
  const context = await readyContext();
  if (!context) return noStore({ error: "Sesión inválida." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 4096) {
    return noStore({ error: "La suscripción del navegador no es válida." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.userId)
    .eq("endpoint", endpoint);

  if (error) return noStore({ error: error.message }, { status: 500 });
  return noStore({ ok: true });
}
