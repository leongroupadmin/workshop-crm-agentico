import { NextResponse, type NextRequest } from "next/server";

import {
  ejecutarPendientes,
  programarRecordatoriosDeCitas,
  programarSinRespuesta,
} from "@/lib/automatizaciones-server";
import { enviarPendientes as enviarDifusiones } from "@/lib/difusiones-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { avisarTareasVencidas } from "@/lib/tareas-server";
import { verifyZernioToken } from "@/lib/zernio";

// La clave de servicio exige runtime Node, no Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Una vuelta con muchas corridas puede tardar: el modelo redacta y las APIs
// contestan a su ritmo.
export const maxDuration = 60;

/**
 * El reloj de las automatizaciones, de las difusiones y de los avisos de tareas.
 *
 * Vercel no tiene procesos vivos: cada paso queda anotado en `automation_runs`
 * con la hora en que toca, y alguien de afuera tiene que despertar a mirar. El
 * endpoint no sabe quién lo llama —el cron de Vercel, `pg_cron` de Supabase o
 * un curl— y por eso se puede cambiar de reloj sin tocar el código.
 *
 * Se autentica con `CRON_SECRET`, en el header `Authorization: Bearer` que manda
 * Vercel o en `?token=` para los que no pueden mandar headers. Corre con la
 * clave de servicio, así que sin secreto no contesta.
 */
async function correr(request: NextRequest) {
  // El recorte no es cosmético: un secreto pegado en el panel de Vercel se
  // lleva puesto el salto de línea del portapapeles, y la comparación es byte a
  // byte. Sin esto el síntoma es un 401 sin explicación, con los dos valores
  // viéndose idénticos en pantalla.
  const secreto = (process.env.CRON_SECRET ?? "").trim();
  if (!secreto) {
    return NextResponse.json({ error: "Falta la variable CRON_SECRET." }, { status: 500 });
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  const token = (bearer || request.nextUrl.searchParams.get("token") || "").trim();

  if (!verifyZernioToken(token, secreto)) {
    // Qué se dice y qué no: que el token llegó y si mide lo mismo alcanza para
    // separar "me equivoqué de valor" de "se coló un espacio", y no cuenta nada
    // que sirva para adivinarlo.
    return NextResponse.json(
      {
        error: "No autenticado.",
        tokenRecibido: token ? "sí" : "no llegó ningún token",
        largoIgual: token.length === secreto.length,
      },
      { status: 401 },
    );
  }

  const supabase = getSupabaseAdmin();

  // El barrido va primero: lo que encuentre queda listo para esta misma vuelta
  // si ya venció, y no espera a la siguiente.
  const anotadas = await programarSinRespuesta(supabase);
  // Los recordatorios de citas se anotan en la misma vuelta. Casi todos quedan
  // esperando su hora —un aviso de 24 horas antes se anota apenas entra la
  // reserva—, pero el de "al agendar" sale en esta misma vuelta.
  const recordatorios = await programarRecordatoriosDeCitas(supabase);
  const balance = await ejecutarPendientes(supabase);

  // Las difusiones van en el mismo reloj y no en uno propio: es un cron más que
  // configurar y olvidarse de configurarlo se ve como una difusión que quedó a
  // medio salir. La creación ya despacha la primera tanda; esto levanta lo que
  // haya quedado, y lo que falle por un rato de API caída.
  const difusiones = await enviarDifusiones(supabase);

  // Los avisos de tareas, por la misma razón: un reloj más que nadie se
  // acuerda de configurar es un aviso que nunca llega.
  const tareas = await avisarTareasVencidas(supabase);

  console.log(
    "[automatizaciones] vuelta:",
    JSON.stringify({ anotadas, recordatorios, ...balance, difusiones, tareas }),
  );

  return NextResponse.json({ ok: true, anotadas, recordatorios, ...balance, difusiones, tareas });
}

// Vercel Cron entra por GET; un `pg_cron` con `pg_net` suele mandar POST.
export const GET = correr;
export const POST = correr;
