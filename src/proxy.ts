import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * El dominio de marketing.
 *
 * La misma aplicación se sirve por dos nombres: el CRM vive en
 * `crmyagente.leongroup.agency`, que es el que el equipo usa todos los días y
 * el que tienen configurado los webhooks, y `kivo.leongroup.agency` es la cara
 * pública. En el dominio de marketing la raíz muestra la landing en vez del
 * dashboard; en el otro, nada cambia.
 *
 * La comparación es contra el host público y no contra `request.nextUrl.host`
 * porque detrás del proxy inverso ese host es el interno —el contenedor se ve a
 * sí mismo como `localhost`—, el mismo motivo por el que el callback de auth
 * mira `x-forwarded-host`.
 */
const HOST_DE_MARKETING = "kivo.leongroup.agency";

/**
 * Refresca el token de Supabase en cada request y reescribe las cookies en la
 * respuesta. Sin esto, la sesión del servidor expira y el usuario queda
 * deslogueado de forma intermitente.
 */
export default async function proxy(request: NextRequest) {
  const landing = raizDeMarketing(request);
  if (landing) return landing;

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  // Debe ejecutarse antes de generar la respuesta para que un refresh tardío
  // no se pierda.
  //
  // `getSession` y no `getUser`: lee la cookie y sólo va a Supabase cuando el
  // token está por vencer y hay que renovarlo, que es lo único que este paso
  // tiene que hacer. `getUser` iba a Supabase en *cada* request —cada vuelta del
  // polling, cada Server Action— a validar un usuario que acá nadie mira, y la
  // página o la acción lo vuelve a validar enseguida en `getWorkspaceContext`.
  // Eran el doble de llamadas a Auth de las necesarias, y cada una deja su
  // línea en los logs de Supabase, que en el plan gratis tienen tope.
  //
  // Lo que devuelve no se usa para dejar pasar a nadie y no debe usarse: la
  // sesión de la cookie no está verificada. La autorización sigue estando en
  // `getUser`, dentro de cada página y cada acción.
  await supabase.auth.getSession();

  return response;
}

/**
 * La raíz del dominio de marketing, servida con la landing.
 *
 * Es una reescritura y no una redirección: la dirección en la barra sigue
 * siendo `kivo.leongroup.agency/`, que es la que se pone en una tarjeta o en
 * un anuncio, y no `/landing`.
 *
 * Sólo se toca la raíz. Todo lo demás —`/api`, `/auth`, los assets— tiene que
 * seguir llegando a donde llegaba, así que una reescritura más ancha rompería
 * la aplicación en ese dominio.
 *
 * Devuelve `null` cuando no corresponde, y ahí sigue el refresco de sesión de
 * siempre: la landing es pública y estática, no necesita mirar la cookie.
 */
function raizDeMarketing(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== "/") return null;

  const reenviado = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
  // El header puede traer el puerto, y más de un host si hubo varios saltos.
  const host = reenviado.split(",")[0].trim().split(":")[0].toLowerCase();
  if (host !== HOST_DE_MARKETING) return null;

  const url = request.nextUrl.clone();
  url.pathname = "/landing";
  return NextResponse.rewrite(url);
}

export const config = {
  // Los archivos de `public/` —íconos, el service worker— no necesitan sesión:
  // pasarlos por acá sólo sumaba llamadas a Supabase.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|webmanifest)$).*)",
  ],
};
