import { NextResponse, type NextRequest } from "next/server";

import { procesarEntrante, type MensajeEntrante } from "@/lib/entrante";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  readZernioHeaders,
  toChannel,
  verifyZernioSignature,
  verifyZernioToken,
  type ZernioMessagePayload,
} from "@/lib/zernio";

// node:crypto y la service-role key exigen runtime Node, no Edge.
export const runtime = "nodejs";

export const dynamic = "force-dynamic";
// La respuesta al proveedor sale enseguida, pero la IA corre después en un
// `after()` y ahí adentro espera la demora configurada en el panel del agente,
// que puede llegar a 60 segundos. Con el tope por defecto de la plataforma la
// función se cortaría antes y la respuesta no llegaría a salir.
export const maxDuration = 60;

/** Respuesta 200 con motivo: evita que Zernio reintente algo que no vamos a procesar. */
const ignored = (reason: string) => {
  console.warn("[zernio] descartado:", reason);
  return NextResponse.json({ ok: true, ignored: reason });
};

/**
 * 401 con motivo y con los headers que llegaron.
 *
 * El panel de Zernio muestra el cuerpo de la respuesta, así que es el único
 * lugar donde el diagnóstico llega sin tener que bucear en los logs.
 */
const rejected = (reason: string, receivedHeaders: string[]) => {
  console.warn("[zernio] rechazado:", reason, receivedHeaders.join(", "));
  return NextResponse.json(
    { error: "No autenticado.", reason, headersRecibidos: receivedHeaders },
    { status: 401 },
  );
};

export async function POST(request: NextRequest) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[zernio] falta ZERNIO_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Falta la variable ZERNIO_WEBHOOK_SECRET en el entorno." },
      { status: 500 },
    );
  }

  // El cuerpo crudo es lo que se firma: no volver a serializarlo.
  const rawBody = await request.text();
  const { signature, signatureHeader, receivedHeaders } = readZernioHeaders(request);
  const token = request.nextUrl.searchParams.get("token");

  console.log("[zernio] request recibido", {
    bytes: rawBody.length,
    firma: signatureHeader ?? "ninguna",
    token: Boolean(token),
  });

  // Se acepta cualquiera de las dos pruebas de autenticidad. La firma es
  // preferible; el token existe porque Zernio no siempre firma el cuerpo, y sin
  // firma no hay nada que verificar.
  const signed = signature ? verifyZernioSignature(rawBody, signature, secret) : false;
  const tokenized = token ? verifyZernioToken(token, secret) : false;

  if (!signed && !tokenized) {
    if (signature) {
      return rejected("la firma no coincide con ZERNIO_WEBHOOK_SECRET", receivedHeaders);
    }
    if (token) {
      return rejected("el token de la URL no coincide con ZERNIO_WEBHOOK_SECRET", receivedHeaders);
    }
    return rejected(
      "Zernio no mandó firma ni token. Agregá ?token=<ZERNIO_WEBHOOK_SECRET> al final de la URL del webhook.",
      receivedHeaders,
    );
  }

  let payload: ZernioMessagePayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (payload.event !== "message.received") return ignored(`evento ${payload.event}`);

  const { message, conversation, account } = payload;
  if (!message || !conversation || !account) return ignored("payload incompleto");

  const entrante = aMensajeEntrante(payload);
  if (!entrante) return ignored(`plataforma ${account.platform} no soportada`);

  // getSupabaseAdmin lanza si falta la service-role key: sin capturarlo el error
  // sale como un 500 opaco y no se distingue de un fallo de la base.
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error("[zernio]", error);
    return NextResponse.json(
      { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en el entorno." },
      { status: 500 },
    );
  }

  const resultado = await procesarEntrante(supabase, entrante);

  if (resultado.estado === "ignorado") return ignored(resultado.motivo);
  if (resultado.estado === "error") {
    return NextResponse.json({ error: resultado.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Pasa el payload de Zernio a la forma común de los entrantes.
 *
 * Devuelve `null` si la plataforma no la modela el CRM: Zernio cubre más
 * (Telegram, X, Bluesky) y esas se descartan sin error.
 */
function aMensajeEntrante(payload: ZernioMessagePayload): MensajeEntrante | null {
  const { message, conversation, account } = payload;

  const channel = toChannel(account.platform || message.platform);
  if (!channel) return null;

  const attachment = message.attachments?.[0] ?? null;

  return {
    provider: "zernio",
    channel,
    cuenta: { id: account.id, plataforma: account.platform, usuario: account.username },
    chatId: conversation.id,
    mensajeId: message.id,
    direccion: message.direction,
    texto: message.text,
    adjunto: attachment ? { type: attachment.type, url: attachment.url } : null,
    enviadoEl: message.sentAt,
    remitente: {
      externalId: message.sender?.id || conversation.participantId,
      nombre:
        message.sender?.name ||
        conversation.participantName ||
        message.sender?.username ||
        conversation.participantUsername,
      telefono: message.sender?.phoneNumber,
      foto: message.sender?.picture ?? conversation.participantPicture,
    },
    // Zernio no nombra el tipo del mensaje; lo más cerca es el del adjunto.
    tipoCrudo: attachment?.type,
  };
}


/**
 * Diagnóstico: abrir esta URL en el navegador dice qué falta configurar.
 *
 * Solo devuelve booleanos y conteos, nunca valores de secretos, así que es
 * seguro dejarlo público.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    // Recibir solo depende del secreto; la API key es para responder.
    ZERNIO_WEBHOOK_SECRET: Boolean(process.env.ZERNIO_WEBHOOK_SECRET),
    ZERNIO_API_KEY: Boolean(process.env.ZERNIO_API_KEY),
    // Sin esta, la IA no puede contestar sola: el webhook no ve la key del navegador.
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  };

  try {
    const supabase = getSupabaseAdmin();

    const [accounts, identities, conversations, workspaces, messages, stages] = await Promise.all([
      supabase.from("zernio_accounts").select("zernio_account_id", { count: "exact", head: true }),
      supabase.from("contact_identities").select("contact_id", { count: "exact", head: true }),
      // Seleccionar la columna nueva es la forma de comprobar que existe:
      // PostgREST falla si la migración no se corrió.
      supabase.from("conversations").select("zernio_account_id", { count: "exact", head: true }),
      supabase.from("workspaces").select("id", { count: "exact", head: true }),
      supabase
        .from("messages")
        .select("created_at")
        .not("zernio_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("pipeline_stages").select("id", { count: "exact", head: true }),
    ]);

    const state = (result: { error: { message: string } | null }) =>
      result.error ? `ERROR: ${result.error.message}` : "ok";

    checks.tabla_zernio_accounts = state(accounts);
    checks.tabla_contact_identities = state(identities);
    checks.columna_zernio_account_id = state(conversations);
    checks.tabla_pipeline_stages = state(stages);
    checks.columnas_del_embudo = stages.count ?? 0;
    checks.cuentas_asociadas = accounts.count ?? 0;
    checks.conversaciones = conversations.count ?? 0;
    checks.workspaces = workspaces.count ?? 0;
    checks.ultimo_mensaje_de_zernio = messages.data?.created_at ?? "ninguno todavía";
  } catch (error) {
    checks.supabase = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }

  return NextResponse.json(checks);
}
