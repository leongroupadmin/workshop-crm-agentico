import { NextResponse, type NextRequest } from "next/server";

import { procesarEntrante } from "@/lib/entrante";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { aMensajeEntranteWaha, verificarFirmaWaha, type WahaEvent } from "@/lib/waha";
import { telefonoDelLid } from "@/lib/waha-api";
import { verifyZernioToken } from "@/lib/zernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La respuesta al proveedor sale enseguida, pero la IA corre después en un
// `after()` y ahí adentro espera la demora configurada en el panel del agente,
// que puede llegar a 60 segundos. Con el tope por defecto de la plataforma la
// función se cortaría antes y la respuesta no llegaría a salir.
export const maxDuration = 60;

const ignored = (reason: string) => {
  console.warn("[waha] descartado:", reason);
  return NextResponse.json({ ok: true, ignored: reason });
};

export async function POST(request: NextRequest) {
  const secret = process.env.WAHA_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[waha] falta WAHA_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Falta WAHA_WEBHOOK_SECRET en el entorno." },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-hmac");
  const algorithm = request.headers.get("x-webhook-hmac-algorithm");
  const token = request.nextUrl.searchParams.get("token");

  const firmaValida =
    Boolean(signature) &&
    (!algorithm || algorithm.toLowerCase() === "sha512") &&
    verificarFirmaWaha(rawBody, signature!, secret);
  const tokenValido = Boolean(token && verifyZernioToken(token, secret));

  if (!firmaValida && !tokenValido) {
    console.warn("[waha] webhook rechazado", {
      firma: Boolean(signature),
      algorithm: algorithm ?? "ninguno",
      token: Boolean(token),
    });
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let evento: WahaEvent;
  try {
    evento = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (evento.event !== "message") return ignored(`evento ${evento.event ?? "sin nombre"}`);

  const entrante = aMensajeEntranteWaha(evento);
  if (!entrante) return ignored("el evento no trae un mensaje entrante procesable");

  await traducirElLid(entrante);

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error("[waha]", error);
    return NextResponse.json(
      { error: "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno." },
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
 * Deja el mensaje hablando de un teléfono y no de un `@lid`.
 *
 * WhatsApp está migrando a un identificador interno que no contiene el número:
 * `167177357402318@lid`. El CRM identifica un chat de WhatsApp por su teléfono
 * —así encuentra al contacto y así lo encuentra el recordatorio que le abrió la
 * conversación—, y con el `@lid` no reconoce nada: crea un contacto nuevo, sin
 * teléfono, y el historial de la misma persona queda partido en dos.
 *
 * La traducción va acá, en el borde, y no adentro del CRM: así el `@lid` no
 * entra nunca al modelo de datos y el resto del sistema sigue teniendo una sola
 * idea de qué es un chat. El precio es un pedido a WAHA por mensaje que llegue
 * con uno, contra un servicio que está en la misma máquina.
 *
 * Si WAHA no sabe el número —devuelve `pn` en null, que pasa— se sigue como
 * antes. Perder la unión es malo; perder el mensaje sería peor.
 */
async function traducirElLid(entrante: { chatId: string; remitente: { externalId?: string; telefono?: string } }) {
  if (!entrante.chatId.endsWith("@lid")) return;

  const lid = entrante.chatId.slice(0, -"@lid".length);
  const telefono = await telefonoDelLid(lid);
  if (!telefono) {
    console.warn("[waha] llegó un @lid que WAHA no supo resolver:", entrante.chatId);
    return;
  }

  const digitos = telefono.replace(/\D/g, "");
  entrante.chatId = `${digitos}@c.us`;
  entrante.remitente.externalId = entrante.chatId;
  entrante.remitente.telefono = telefono;
}

/** Diagnóstico sin revelar claves. */
export async function GET() {
  return NextResponse.json({
    WAHA_API_BASE_URL: process.env.WAHA_API_BASE_URL || null,
    WAHA_API_KEY: Boolean(process.env.WAHA_API_KEY),
    WAHA_WEBHOOK_SECRET: Boolean(process.env.WAHA_WEBHOOK_SECRET),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
