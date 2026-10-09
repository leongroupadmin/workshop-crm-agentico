import { after, NextResponse, type NextRequest } from "next/server";

import {
  ejecutarPendientes,
  programarRecordatoriosDeCitas,
} from "@/lib/automatizaciones-server";
import { aplicarEventoDeCalendar } from "@/lib/calendar-citas-server";
import { sendCitaPush } from "@/lib/push-notifications";
import { leerEvento } from "@/lib/calendar-citas";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
// La comparación en tiempo constante del token no tiene nada de Zernio: vive
// ahí por haber llegado primero.
import { verifyZernioToken } from "@/lib/zernio";

// node:crypto y la clave de servicio exigen runtime Node, no Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Una alta hace hasta cuatro consultas encadenadas, y después del `after` que
// adelanta la confirmación vienen el barrido y el envío por WhatsApp. La
// respuesta a n8n no espera nada de eso, pero el trabajo corre en la misma
// función y necesita margen.
export const maxDuration = 60;

/**
 * Lo que pasó en Google Calendar, contado por n8n.
 *
 * n8n es el puente y se queda con lo que ya hace bien: hablar con Google,
 * distinguir alta de cambio y de baja, y raspar el nombre y el teléfono de la
 * descripción del evento. El CRM se queda con lo suyo: quién es el contacto,
 * cuándo es la cita y qué recordatorios corresponden.
 *
 * Tres cosas de este endpoint que no son obvias:
 *
 * 1. **Es idempotente.** La clave es `appointments.google_event_id`, con su
 *    índice único. n8n puede reintentar el mismo POST —y lo va a hacer— sin
 *    duplicar la cita: el alta repetida se trata como un cambio.
 *
 * 2. **Rechaza en vez de guardar a medias.** El teléfono no viene en un campo
 *    del evento sino raspado de la descripción, así que sale vacío más seguido
 *    de lo que parece. Una cita sin teléfono es un recordatorio que no sale
 *    nunca y sin error a la vista; mejor un 422 con el motivo escrito, que se
 *    ve en la ejecución de n8n.
 *
 * 3. **Un evento que no es nuestro no es un error.** El disparador de
 *    `eventUpdated` se activa con cualquier cosa del calendario, incluida la
 *    reunión interna que alguien se puso a mano. Eso devuelve 200 con
 *    `ignorado`, para que n8n no acumule ejecuciones rojas que tapen la falla
 *    real.
 *
 * Se autentica con `CALENDAR_WEBHOOK_SECRET`, en `Authorization: Bearer` o en
 * `?token=` para el que no pueda mandar headers. Corre con la clave de
 * servicio, así que sin secreto no contesta.
 */
export async function POST(request: NextRequest) {
  // El recorte no es cosmético: un secreto pegado en un panel se lleva puesto el
  // salto de línea del portapapeles, y la comparación es byte a byte. Sin esto
  // el síntoma es un 401 sin explicación, con los dos valores viéndose
  // idénticos en pantalla.
  const secreto = (process.env.CALENDAR_WEBHOOK_SECRET ?? "").trim();
  if (!secreto) {
    console.error("[calendar] falta CALENDAR_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Falta la variable CALENDAR_WEBHOOK_SECRET en el entorno." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  const token = (bearer || request.nextUrl.searchParams.get("token") || "").trim();

  if (!verifyZernioToken(token, secreto)) {
    // Qué se dice y qué no: que el token llegó y si mide lo mismo alcanza para
    // separar "me equivoqué de valor" de "se coló un espacio", y no cuenta nada
    // que sirva para adivinarlo.
    console.warn("[calendar] rechazado", { tokenLlego: Boolean(token) });
    return NextResponse.json(
      {
        error: "No autenticado.",
        tokenRecibido: token ? "sí" : "no llegó ningún token",
        largoIgual: token.length === secreto.length,
      },
      { status: 401 },
    );
  }

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }

  const lectura = leerEvento(crudo);
  if (!lectura.ok) {
    // 422 y no 400: el JSON estaba bien, lo que no sirve es el contenido. El
    // campo y el motivo van en el cuerpo porque n8n los muestra tal cual.
    console.warn("[calendar] evento rechazado:", lectura.rechazo.campo, lectura.rechazo.motivo);
    return NextResponse.json(
      {
        error: `No se pudo procesar el evento: ${lectura.rechazo.motivo}`,
        campo: lectura.rechazo.campo,
      },
      { status: 422 },
    );
  }

  const resultado = await aplicarEventoDeCalendar(getSupabaseAdmin(), lectura.evento);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  if ("ignorado" in resultado) {
    console.warn("[calendar] ignorado:", resultado.ignorado);
    return NextResponse.json({ ok: true, ignorado: resultado.ignorado });
  }

  // La confirmación sale ahora, no en la próxima vuelta del reloj.
  //
  // El motor entero corre por cron cada cinco minutos, y para casi todo está
  // bien: un aviso de "24 horas antes" no se entera de cinco minutos. Pero la
  // confirmación al reservar es lo primero que el cliente espera después de
  // apretar el botón, y llegar seis minutos tarde —un minuto de n8n mirando
  // Calendar más la vuelta del cron— la convierte en otra cosa.
  //
  // Va en `after` para que n8n reciba su 200 enseguida: el barrido y el envío
  // son varias consultas y una llamada a WhatsApp, y hacerlos antes de
  // contestar arriesga que el webhook expire y n8n reintente.
  //
  // Es el mismo par de funciones que corre el cron, no un atajo paralelo. Lo
  // que hace seguro llamarlas desde acá es la reserva de `ejecutarPendientes`:
  // si el cron está corriendo en este mismo instante, una de las dos vueltas se
  // queda con cada corrida y nadie manda dos veces.
  if (resultado.accion === "alta" || resultado.accion === "cambio") {
    after(async () => {
      try {
        const supabase = getSupabaseAdmin();

        // El aviso al equipo va primero y sólo en el alta: una reserva entra
        // sola, sin que nadie toque nada, y si no avisa se entera quien mire la
        // Agenda —que puede ser al otro día—. Un cambio de horario no lo
        // repite: para eso está la Agenda.
        if (resultado.accion === "alta" && resultado.creada) {
          await sendCitaPush(supabase, {
            workspaceId: resultado.workspaceId,
            appointmentId: resultado.citaId,
          });
        }

        await programarRecordatoriosDeCitas(supabase);
        await ejecutarPendientes(supabase);
      } catch (problema) {
        // No se le devuelve a n8n: la cita ya quedó guardada y el cron levanta
        // el recordatorio en la próxima vuelta. Marcar el webhook en rojo por
        // esto haría reintentar un alta que salió bien.
        console.error("[calendar] no se pudo adelantar el recordatorio:", problema);
      }
    });
  }

  console.log("[calendar] aplicado:", JSON.stringify(resultado));
  return NextResponse.json(resultado);
}
