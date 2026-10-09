/**
 * Qué tablas se pueden descargar.
 *
 * Vive separado del exportador porque lo lee también la pantalla, y el
 * exportador es `server-only`: consulta la base con la sesión del usuario y no
 * puede viajar al navegador. Acá sólo están los nombres, que son los mismos de
 * los dos lados.
 */

export type TablaExportable =
  | "contactos"
  | "oportunidades"
  | "conversaciones"
  | "mensajes"
  | "turnos";

export const TABLAS: { clave: TablaExportable; titulo: string; detalle: string }[] = [
  {
    clave: "contactos",
    titulo: "Contactos",
    detalle: "Nombre, teléfono, email, etiquetas, responsable, etapa y canales.",
  },
  {
    clave: "oportunidades",
    titulo: "Oportunidades del embudo",
    detalle: "Una fila por tarjeta, con su etapa, su valor y su responsable.",
  },
  {
    clave: "conversaciones",
    titulo: "Conversaciones",
    detalle: "Los chats con su canal, su estado y cuándo fue el último movimiento.",
  },
  {
    clave: "mensajes",
    titulo: "Mensajes",
    detalle: "El historial de los chats, del más nuevo al más viejo.",
  },
  {
    clave: "turnos",
    titulo: "Turnos de la agenda",
    detalle: "Todos los turnos, incluidos los que ya pasaron.",
  },
];
