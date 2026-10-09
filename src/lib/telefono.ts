/**
 * Teléfonos: cómo se guardan y cómo se buscan.
 *
 * Funciones puras, sin base ni red. Las usan la bandeja, la ficha del lead, la
 * agenda, la importación y la entrada de mensajes para no duplicar contactos.
 */

/**
 * Cómo escribe los números el proveedor: con `+` adelante o sólo los dígitos.
 */
export type FormatoTelefono = "con-mas" | "solo-digitos";

/**
 * Deja el teléfono en E.164, o null si no se puede.
 *
 * Los contactos se cargan a mano y llegan como sea —con espacios, guiones,
 * paréntesis, un 0 o un 15 de más—. Lo único que se puede afirmar sin inventar
 * es que un número internacional tiene entre 8 y 15 dígitos: lo que no entra en
 * eso no se manda, y el contacto queda listado aparte para corregirlo.
 */
export function normalizarTelefono(
  valor: string | null | undefined,
  formato: FormatoTelefono = "con-mas",
): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return formato === "con-mas" ? `+${digitos}` : digitos;
}

/**
 * Todas las formas con las que el mismo teléfono puede estar guardado.
 *
 * Sirve para buscar un contacto sin duplicarlo. Hay dos diferencias que no
 * significan nada y que una igualdad exacta trata como personas distintas:
 *
 * 1. **El `+`.** Cada fuente guarda como le viene: con el prefijo o con los
 *    dígitos pelados.
 *
 * 2. **El 9 argentino.** WhatsApp lo exige para un móvil —`+549 11 …`— pero
 *    quien carga un contacto a mano escribe el número como se lo dictaron, sin
 *    el 9. Son la misma persona y el mismo WhatsApp, con doce o trece dígitos
 *    según quién lo haya escrito.
 *
 * Sólo se agrega la variante del 9 a los números argentinos: en otros países
 * ese dígito es parte del número y sacarlo sería apuntar a otro lado.
 */
export function formasDelTelefono(valor: string | null | undefined): string[] {
  const digitos = normalizarTelefono(valor, "solo-digitos");
  if (!digitos) return [];

  const variantes = [digitos];

  if (digitos.startsWith("549")) {
    variantes.push(`54${digitos.slice(3)}`);
  } else if (digitos.startsWith("54")) {
    variantes.push(`549${digitos.slice(2)}`);
  }

  // Las dos formas de cada variante, que es como aparecen en la base.
  return variantes.flatMap((variante) => [`+${variante}`, variante]);
}

/**
 * Si a este teléfono se le puede escribir primero por WhatsApp.
 *
 * Arrancar una charla nosotros —el botón de "escribir" de la bandeja— es
 * siempre por WhatsApp: es el único canal donde el proveedor sabe
 * armar el chat a partir de un número. En Instagram y Messenger la conversación
 * nace sólo cuando la persona escribe, porque del otro lado no hay un id de
 * chat que podamos inventar.
 *
 * Es la misma regla que usa `chatIdDelContacto` para armar ese id: quien liste
 * a quién ofrecerle el botón tiene que preguntar acá, o la pantalla promete lo
 * que el envío después no puede cumplir.
 */
export function sePuedeEscribirPrimero(telefono: string | null | undefined): boolean {
  return normalizarTelefono(telefono) !== null;
}
