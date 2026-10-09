import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca el token de Supabase en cada request y reescribe las cookies en la
 * respuesta. Sin esto, la sesión del servidor expira y el usuario queda
 * deslogueado de forma intermitente.
 */
export default async function proxy(request: NextRequest) {
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

export const config = {
  // Los archivos de `public/` —íconos, el service worker— no necesitan sesión:
  // pasarlos por acá sólo sumaba llamadas a Supabase.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|webmanifest)$).*)",
  ],
};
