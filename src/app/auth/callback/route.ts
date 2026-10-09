import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Destino del magic link. El flujo PKCE devuelve un `code` de un solo uso que
 * hay que canjear por una sesión antes de entrar al CRM.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(errorDescription)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent("Enlace de acceso inválido.")}`);
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(origin);
}

/**
 * De dónde volver al CRM.
 *
 * `request.nextUrl.origin` es el host con el que llegó el request, y detrás de
 * un proxy inverso ese host es el interno: en el VPS el contenedor se ve a sí
 * mismo como `localhost:80` y el magic link terminaba redirigiendo ahí. El
 * host público sólo viaja en `x-forwarded-host`, que el proxy reescribe en cada
 * request —el contenedor no se alcanza de otra forma—, así que es la única
 * fuente que conoce el dominio real.
 */
function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host");
  if (!host) return request.nextUrl.origin;

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
