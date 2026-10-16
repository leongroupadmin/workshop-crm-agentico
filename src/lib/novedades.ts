/**
 * El orden de la campana: lo último que pasó, arriba.
 *
 * La campana mezcla tareas que te pasaron, chats derivados y mensajes sin leer,
 * y antes iban en bloques fijos, uno abajo del otro. Lo nuevo podía quedar al
 * fondo detrás de un aviso de ayer, que es justo al revés de como se lee una
 * lista de avisos.
 *
 * Una fecha que falta o que no se entiende va al final: un aviso sin hora no
 * puede pasar adelante de uno que sabemos que es de recién.
 */
export function masNuevasPrimero<T>(items: T[], cuando: (item: T) => string | null): T[] {
  const momento = (item: T) => {
    const valor = cuando(item);
    const ms = valor ? new Date(valor).getTime() : Number.NaN;
    return Number.isNaN(ms) ? null : ms;
  };

  return [...items].sort((a, b) => {
    const ma = momento(a);
    const mb = momento(b);
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return mb - ma;
  });
}
