import { NextResponse, type NextRequest } from "next/server";

import { procesarEntrante } from "@/lib/entrante";
import { credenciales, estaConfigurada } from "@/lib/integraciones-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  aMensajeEntrante,
  EVENTO_ENTRANTE,
  leerFirmaYcloud,
  verificarFirmaYcloud,
  type YCloudInboundEvent,
} from "@/lib/ycloud";
// La comparación en tiempo constante del token no tiene nada de Zernio: vive
// ahí por haber llegado primero.
import { verifyZernioToken } from "@/lib/zernio";

// node:crypto y la service-role key exigen runtime Node, no Edge.
export const runtime = "nodejs";

export const dynamic = "force-dynamic";
// La respuesta al proveedor sale enseguida, pero la IA corre después en un
// `after()` y ahí adentro espera la demora configurada en el panel del agente,
// que puede llegar a 60 segundos. Con el tope por defecto de la plataforma la
// función se cortaría antes y la respuesta no llegaría a salir.
export const maxDuration = 60;

const ignored = (reason: string) => {
  console.warn("[ycloud] descartado:", reason);
  return NextResponse.json({ ok: true, ignored: reason });
};

const rejected = (
  reason: string,
  firmaEn: string | null,
  token: string | null,
  receivedHeaders: string[],
) => {
  console.warn("[ycloud] rechazado:", reason, receivedHeaders.join(", "));
  return NextResponse.json(
    {
      error: "No autenticado.",
      reason,
      // Saber con qué nombre llegó la firma —o que no llegó— es lo que separa
      // "el secreto está mal" de "el esquema no es el que esperábamos".
      firmaEnElHeader: firmaEn ?? "ninguno",
      // Si el token no llega, el proveedor está descartando la query de la
      // URL: es otra causa, y sin esto se confunde con un token equivocado.
      tokenEnLaUrl: token ? "llegó pero no coincide con el secreto" : "no llegó",
      headersRecibidos: receivedHeaders,
    },
    { status: 401 },
  );
};

export async function POST(request: NextRequest) {
  const conexion = await credenciales("ycloud", ["webhook_secret"]);
  if (!conexion.ok) {
    console.error("[ycloud]", conexion.error);
    return NextResponse.json({ error: conexion.error }, { status: 500 });
  }
  const secret = conexion.valores.webhook_secret;

  // El cuerpo crudo es lo que se firma: no volver a serializarlo.
  const rawBody = await request.text();
  const firma = leerFirmaYcloud(request);
  const token = request.nextUrl.searchParams.get("token");

  console.log("[ycloud] request recibido", {
    bytes: rawBody.length,
    firma: firma.signatureHeader ?? "ninguna",
    token: Boolean(token),
  });

  // La firma es la prueba buena y es la que YCloud manda siempre. El token en
  // la URL queda como salida de emergencia: sirve para reenviar un evento a
  // mano desde curl, donde no hay forma de firmarlo.
  const verificacion = firma.signature
    ? verificarFirmaYcloud(rawBody, firma, secret)
    : ({ ok: false, motivo: "YCloud no mandó el header de firma" } as const);

  if (!verificacion.ok && !(token && verifyZernioToken(token, secret))) {
    return rejected(verificacion.motivo, firma.signatureHeader, token, firma.receivedHeaders);
  }

  let evento: YCloudInboundEvent;
  try {
    evento = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  // YCloud manda también estados de entrega y eventos de plantillas: se
  // descartan con 200 para que no los reintente.
  if (evento.type !== EVENTO_ENTRANTE) return ignored(`evento ${evento.type}`);

  const entrante = aMensajeEntrante(evento);
  if (!entrante) return ignored("el evento no trae un mensaje procesable");

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error("[ycloud]", error);
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
 * Diagnóstico: abrir esta URL en el navegador dice qué falta configurar.
 *
 * Cuenta tanto lo cargado en Configuración → Conexiones como las variables de
 * entorno: es lo mismo que mira el webhook al recibir.
 *
 * Del secreto se describe la forma, nunca el valor. Saber que existe no
 * alcanzaba: un secreto viejo, o pegado sin el prefijo `whsec_`, se veía
 * idéntico a uno correcto y daba un 401 imposible de explicar desde afuera.
 * El prefijo y el largo no permiten reconstruirlo.
 */
export async function GET() {
  const secreto = await credenciales("ycloud", ["webhook_secret"]);
  return NextResponse.json({
    secreto_del_webhook: secreto.ok,
    formato_del_secreto: describirSecreto(secreto.ok ? secreto.valores.webhook_secret : undefined),
    api_key_de_ycloud: await estaConfigurada("ycloud", ["api_key"]),
    api_key_de_openai: await estaConfigurada("openai", ["api_key"]),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}

function describirSecreto(secreto: string | undefined): string {
  if (!secreto) return "no está cargado";
  if (secreto !== secreto.trim()) return "tiene espacios al principio o al final: sacalos";
  if (!secreto.startsWith("whsec_")) {
    return `le falta el prefijo whsec_ (${secreto.length} caracteres). Pegá el secreto entero, como lo muestra YCloud.`;
  }
  // Los últimos cuatro caracteres alcanzan para compararlo de un vistazo con el
  // que muestra el panel, y dejan los otros veintiocho sin revelar. Cada
  // endpoint de YCloud tiene su propio secreto: cargar el de otro da un 401
  // que no se distingue de un problema de formato.
  return `whsec_ + ${secreto.length - "whsec_".length} caracteres, termina en …${secreto.slice(-4)}`;
}
