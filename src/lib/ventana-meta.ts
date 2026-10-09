import type { Channel } from "@/types/database";

/**
 * La ventana de mensajería de Meta.
 *
 * Instagram, Messenger y WhatsApp solo permiten responder dentro de las 24
 * horas del último mensaje del contacto. Pasado ese plazo la plataforma rechaza
 * el envío, y no hay nada que se pueda arreglar del lado del CRM.
 *
 * Esto se llamaba `whatsapp-window` y el aviso se mostraba solo en WhatsApp,
 * como si la regla fuera de ese canal. No lo es: es de Meta y rige en los tres.
 * Por creerlo de WhatsApp, un chat de Instagram falló sin aviso previo y el
 * error que salió culpó a la API key.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SilenceState = "fresh" | "warm" | "risk" | "expired";

export function silenceStateSince(iso: string | null | undefined, now = Date.now()): SilenceState | null {
  const elapsed = elapsedMs(iso, now);
  if (elapsed === null) return null;
  if (elapsed < 6 * HOUR) return "fresh";
  if (elapsed < 20 * HOUR) return "warm";
  if (elapsed < DAY) return "risk";
  return "expired";
}

export function silenceLabelSince(iso: string | null | undefined, now = Date.now()): string | null {
  const elapsed = elapsedMs(iso, now);
  if (elapsed === null) return null;
  if (elapsed < MINUTE) return "hace menos de 1 min";

  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(elapsed / HOUR);
  const remainingMinutes = Math.floor((elapsed % HOUR) / MINUTE);
  if (hours < 24) {
    return remainingMinutes > 0 ? `hace ${hours} h ${remainingMinutes} min` : `hace ${hours} h`;
  }

  const days = Math.floor(elapsed / DAY);
  const remainingHours = Math.floor((elapsed % DAY) / HOUR);
  return remainingHours > 0 ? `hace ${days} d ${remainingHours} h` : `hace ${days} d`;
}

function elapsedMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, now - then);
}

/**
 * Qué decir cuando la ventana ya se cerró.
 *
 * El texto cambia por canal porque la salida cambia: en WhatsApp oficial hay
 * plantillas aprobadas justamente para esto, y en Instagram y Messenger no hay
 * equivalente —sólo queda esperar—. Decir "no se puede" en los tres sería
 * mentir en uno.
 */
export function ventanaCerrada(channel: Channel): string {
  if (channel === "whatsapp") {
    return "La ventana de 24 h se cerró. Para escribirle hay que mandar una plantilla aprobada.";
  }

  const red = channel === "instagram" ? "Instagram" : "Messenger";
  return `La ventana de 24 h se cerró: ${red} no deja responder hasta que el contacto vuelva a escribir.`;
}

/**
 * Qué decir cuando la ventana todavía no se abrió nunca, o `null` si no hay
 * nada que advertir.
 *
 * No es lo mismo que una ventana vencida: acá el contacto jamás escribió, así
 * que no hay un "escribió hace tanto" que mostrar. Pasa en los chats que
 * abrimos nosotros para escribirle primero a alguien cargado a mano, y
 * conviene decirlo antes de que manden un texto que la plataforma va a
 * rebotar. Lo que se puede hacer depende de por dónde sale el chat, no sólo
 * del canal: `conPlantillas` distingue WhatsApp oficial de una sesión común.
 */
export function ventanaSinAbrir(channel: Channel, conPlantillas: boolean): string | null {
  // WhatsApp vinculado por QR: es un WhatsApp común, no hay ventana que
  // esperar ni plantilla que mandar. Avisar algo acá sería inventarle un
  // impedimento que no existe.
  if (channel === "whatsapp") {
    return conPlantillas
      ? "Este contacto todavía no escribió: el primer mensaje tiene que ser una plantilla aprobada."
      : null;
  }

  const red = channel === "instagram" ? "Instagram" : "Messenger";
  return `Este contacto todavía no escribió: ${red} no deja escribir primero, hay que esperar a que arranque la charla.`;
}
