/**
 * El horario en el que contesta un agente.
 *
 * Vive en su propio archivo porque lo necesitan los dos lados —el panel para
 * dibujarlo y avisar mientras se edita, el servidor para validar y para decidir
 * si el agente habla— y no puede ir en `actions.ts`, que al ser `"use server"`
 * sólo exporta funciones asíncronas. Es el mismo motivo por el que existe
 * `agent-limits.ts`.
 *
 * Un horario son días y, dentro de cada uno, una o más franjas de horas: de 9 a
 * 13 y de 16 a 20 es un horario de dos franjas. Las horas son siempre de la zona
 * del workspace.
 *
 * Lo marcado se lee de dos maneras, y eso lo decide `excluye`: o es cuándo el
 * agente contesta —y afuera calla—, o es cuándo no contesta —y afuera contesta—.
 * Es la misma lista leída al revés, porque un agente de IA casi siempre arranca
 * contestando siempre y lo que se quiere declarar es la excepción: "menos de 13
 * a 16". Cargar eso como lista blanca obliga a escribir el complemento, 00 a 13
 * y 16 a 24, que es la forma más fácil de equivocarse y que además nadie lee
 * como "cerramos al mediodía".
 *
 * Las franjas son una lista y no un par de columnas porque "una" es tan
 * arbitrario como "dos": el negocio que corta al mediodía necesita dos, el que
 * atiende corrido una, y con la lista los dos casos son el mismo código. La
 * cuenta de "¿está abierta esta franja ahora?" la hace `dentroDeLaFranja`, al
 * final del archivo, con `Intl` para respetar husos raros y horario de verano.
 */

/** 0 = domingo, igual que `Date.getDay()`. */
export const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6];

/** Minutos desde la medianoche. El cierre es exclusivo: el día completo es [0, 1440). */
export const MINUTOS_DEL_DIA = 1440;

/**
 * Una franja de atención, en minutos desde la medianoche.
 *
 * El cierre es exclusivo:
 * un horario que cierra a las 18 no contesta el mensaje de las 18:00 en punto.
 */
export type Franja = { desde: number; hasta: number };

export type HorarioDelAgente = {
  /** Días marcados, 0 = domingo. Vacío es todos. */
  dias: number[];
  /** Franjas marcadas dentro de esos días. Vacío es el día entero. */
  franjas: Franja[];
  /**
   * Si lo marcado es cuándo NO contesta.
   *
   * `false` —lo de siempre— es la lista blanca: contesta adentro y calla afuera.
   * `true` la da vuelta: calla adentro y contesta afuera, que es como se declara
   * una excepción sobre un agente que atiende todo el día.
   */
  excluye: boolean;
};

/**
 * Tope de franjas por agente.
 *
 * Tres alcanzan para cualquier horario de atención real —mañana, tarde y una
 * guardia suelta— y el tope existe para que el panel no se vuelva una planilla
 * y para que la lista no crezca sin fin desde el navegador.
 */
export const MAX_FRANJAS = 3;

/** La franja que se propone al cortar el día: una jornada de 9 a 18. */
export const JORNADA: Franja = { desde: 9 * 60, hasta: 18 * 60 };

/**
 * La que se propone cuando lo que se carga es una excepción: el mediodía.
 *
 * En modo `excluye` lo que se está escribiendo es el hueco, no la jornada:
 * proponer 9 a 18 ahí sería proponer "no contestes justo en horario de oficina".
 */
export const SIESTA: Franja = { desde: 13 * 60, hasta: 16 * 60 };

/**
 * Lo que trae un agente sin horario configurado: contesta siempre.
 *
 * Es el default de las columnas y el de los canales que todavía no tienen fila,
 * así que el horario no le cambió el comportamiento a nadie.
 */
export const HORARIO_SIEMPRE: HorarioDelAgente = {
  dias: TODOS_LOS_DIAS,
  franjas: [],
  excluye: false,
};

/** Días en que contesta, ya normalizados: vacío o inválido es todos. */
export function diasDelHorario(horario: HorarioDelAgente): number[] {
  const dias = [...new Set(horario.dias.filter((dia) => TODOS_LOS_DIAS.includes(dia)))].sort(
    (a, b) => a - b,
  );
  return dias.length > 0 ? dias : TODOS_LOS_DIAS;
}

/**
 * Las franjas utilizables, ordenadas por hora de apertura.
 *
 * Se descarta lo que no es una franja: la invertida —abrir a las 18 y cerrar a
 * las 2—, la vacía y la que trae basura en vez de números. Si no queda ninguna,
 * la lista vacía significa todo el día, que es la lectura segura: la otra —no
 * contestar nunca— deja al agente prendido y mudo, que es la falla más difícil
 * de notar. `errorDeHorario` no deja guardar una franja así desde la app; esto
 * es para las filas cargadas a mano.
 */
export function franjasDelHorario(horario: HorarioDelAgente): Franja[] {
  return horario.franjas
    .filter(
      (franja) =>
        Number.isFinite(franja?.desde) &&
        Number.isFinite(franja?.hasta) &&
        franja.desde >= 0 &&
        franja.desde < franja.hasta &&
        franja.hasta <= MINUTOS_DEL_DIA,
    )
    .sort((una, otra) => una.desde - otra.desde);
}

/** Si las franjas no recortan ninguna hora del día. */
export function esTodoElDia(horario: HorarioDelAgente): boolean {
  const franjas = franjasDelHorario(horario);
  if (franjas.length === 0) return true;
  return franjas.some((franja) => franja.desde <= 0 && franja.hasta >= MINUTOS_DEL_DIA);
}

/** Si lo marcado abarca la semana entera, de la medianoche a la medianoche. */
function cubreTodo(horario: HorarioDelAgente): boolean {
  return esTodoElDia(horario) && diasDelHorario(horario).length === TODOS_LOS_DIAS.length;
}

/**
 * Si el agente contesta a cualquier hora de cualquier día.
 *
 * Los dos modos llegan acá por caminos opuestos y el de `excluye` es el que
 * importa: una excepción que abarca la semana entera sería "no contesta nunca",
 * y eso no es un horario, es el interruptor. `errorDeHorario` no deja guardarla,
 * y acá se lee como que no hay nada excluido —el agente contesta— porque una
 * fila cargada a mano no puede dejarlo prendido y mudo.
 */
export function contestaSiempre(horario: HorarioDelAgente): boolean {
  return cubreTodo(horario);
}

/**
 * Si al agente le toca contestar en este momento.
 *
 * La zona es la del workspace —`workspaces.timezone`, la misma que decide qué
 * es "hoy" en el resumen— y no la del servidor: Vercel corre en UTC, así que a
 * las 21 de un viernes en Buenos Aires allá ya es sábado, y con un horario de
 * lunes a viernes la diferencia es si el lead recibe respuesta o no.
 */
export function dentroDelHorario(
  instante: Date,
  horario: HorarioDelAgente,
  zona: string,
): boolean {
  // Sin recorte —o con uno que abarca todo, que sería dejarlo mudo— contesta.
  if (cubreTodo(horario)) return true;

  const marcado = enLoMarcado(instante, horario, zona);
  return horario.excluye ? !marcado : marcado;
}

/** Si el instante cae en lo que el panel tiene marcado, sin mirar el modo. */
function enLoMarcado(instante: Date, horario: HorarioDelAgente, zona: string): boolean {
  if (!diasDelHorario(horario).includes(diaLocal(instante, zona))) return false;

  const franjas = franjasDelHorario(horario);
  if (franjas.length === 0) return true;

  // Alcanza con una: entre dos franjas hay un hueco, y el hueco no está marcado.
  return franjas.some((franja) =>
    dentroDeLaFranja(instante, franja, zona),
  );
}

/**
 * Valida el horario. Devuelve el error listo para mostrar, o null.
 *
 * Lo usan el panel mientras se edita y la action antes de guardar: el error del
 * check de Postgres habla de constraints y de nombres de columna, que no es lo
 * que hay que decirle a alguien que puso un horario que cruza la medianoche.
 */
export function errorDeHorario(horario: HorarioDelAgente): string | null {
  if (horario.dias.some((dia) => !TODOS_LOS_DIAS.includes(dia))) {
    return "Alguno de los días elegidos no es un día de la semana.";
  }
  if (horario.franjas.length > MAX_FRANJAS) {
    return `No se pueden cargar más de ${MAX_FRANJAS} franjas en el mismo día.`;
  }

  for (const franja of horario.franjas) {
    if (!Number.isInteger(franja.desde) || !Number.isInteger(franja.hasta)) {
      return "El horario se carga en horas y minutos.";
    }
    if (franja.desde < 0 || franja.desde > MINUTOS_DEL_DIA - 1) {
      return "La hora de apertura tiene que estar dentro del día.";
    }
    if (franja.hasta < 0 || franja.hasta > MINUTOS_DEL_DIA) {
      return "La hora de cierre tiene que estar dentro del día.";
    }
    if (franja.desde >= franja.hasta) {
      // El caso real es el negocio que atiende de 18 a 2. Guardarlo así lo
      // dejaría contestando también a las 7 de la mañana —una franja invertida
      // se descarta y sin franjas se contesta todo el día— y eso no se nota
      // hasta que pasa. Para atender de noche hay dos franjas: una hasta las 24
      // y otra desde las 00 del día siguiente, que es lo que ese día es.
      return `La franja de ${horaEnTexto(franja.desde)} a ${horaEnTexto(franja.hasta)} cierra antes de abrir. Una franja no puede cruzar la medianoche: para atender de noche, cortá a las 24:00 y seguí al día siguiente.`;
    }
  }

  // Excluir la semana entera no es un horario: es apagar el agente, y para eso
  // está el interruptor —que además lo deja dicho en la tarjeta del canal, en vez
  // de esconder "no contesta nunca" adentro de un horario que parece configurado.
  if (horario.excluye && cubreTodo(horario)) {
    return "Así el agente no contestaría nunca. Si es lo que querés, apagalo con el interruptor de arriba; si no, dejale alguna franja o algún día afuera.";
  }

  // Dos franjas que se pisan no son dos franjas: son una mal cargada. Se
  // comparan ya ordenadas, así que alcanza con mirar la anterior.
  const ordenadas = [...horario.franjas].sort((una, otra) => una.desde - otra.desde);
  for (let i = 1; i < ordenadas.length; i += 1) {
    if (ordenadas[i].desde < ordenadas[i - 1].hasta) {
      return `La franja que abre a las ${horaEnTexto(ordenadas[i].desde)} empieza antes de que cierre la anterior, a las ${horaEnTexto(ordenadas[i - 1].hasta)}.`;
    }
  }

  return null;
}

/** `540` → `"09:00"`. */
export function horaEnTexto(minutos: number): string {
  const acotado = Math.min(Math.max(Math.trunc(minutos), 0), MINUTOS_DEL_DIA);
  return `${String(Math.floor(acotado / 60)).padStart(2, "0")}:${String(acotado % 60).padStart(2, "0")}`;
}

const NOMBRES_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/**
 * En plural, que es como se nombra un día que se repite todas las semanas.
 *
 * Se usa cuando hay uno solo: "los domingos" se lee en cualquier frase, y "dom"
 * suelto no —"siempre, salvo dom" parece un error de recorte—.
 */
const NOMBRES_EN_PLURAL = [
  "los domingos",
  "los lunes",
  "los martes",
  "los miércoles",
  "los jueves",
  "los viernes",
  "los sábados",
];

/** Los días, escritos como los diría alguien: "de lunes a viernes". */
export function describirDias(horario: HorarioDelAgente): string {
  const dias = diasDelHorario(horario);
  const clave = dias.join(",");

  if (clave === TODOS_LOS_DIAS.join(",")) return "todos los días";
  if (clave === "1,2,3,4,5") return "de lunes a viernes";
  if (clave === "1,2,3,4,5,6") return "de lunes a sábado";
  if (clave === "0,6") return "sábados y domingos";
  if (dias.length === 1) return NOMBRES_EN_PLURAL[dias[0]];
  return dias.map((dia) => NOMBRES_CORTOS[dia]).join(", ");
}

/** "de 09:00 a 13:00 y de 16:00 a 20:00". */
export function describirFranjas(horario: HorarioDelAgente): string {
  const partes = franjasDelHorario(horario).map(
    (franja) => `de ${horaEnTexto(franja.desde)} a ${horaEnTexto(franja.hasta)}`,
  );
  if (partes.length === 0) return "a toda hora";
  // La última va con "y" y no con coma: es como se lee un horario en voz alta.
  return partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/**
 * El horario entero en una línea, siempre como respuesta a "¿cuándo contesta?".
 *
 * Los dos modos se leen distinto a propósito: el que recorta dice cuándo habla,
 * el que excluye dice que habla siempre menos en tal rato. Darlos vuelta a mano
 * —convertir "no de 13 a 16" en "de 00 a 13 y de 16 a 24"— sería devolverle a
 * quien lo configuró el complemento que justamente no quiso escribir.
 */
export function describirHorario(horario: HorarioDelAgente): string {
  if (contestaSiempre(horario)) return "todos los días, a toda hora";

  const dias = describirDias(horario);
  const cuando = esTodoElDia(horario) ? dias : `${dias} ${describirFranjas(horario)}`;

  return horario.excluye ? `siempre, salvo ${cuando}` : cuando;
}

/* ---------------------------------------------------------------- el aviso */

/**
 * Tope del aviso fuera de horario, en caracteres.
 *
 * Lo que sale a esa hora es una o dos frases diciendo cuándo se atiende. Más
 * que eso es un discurso que nadie escribió para leer a las 3 AM, y lo que
 * necesita es el agente, que justamente no está contestando.
 */
export const MAX_AVISO_CHARS = 300;

/** Si hay un aviso cargado. Vacío es apagado: fuera de horario no sale nada. */
export function hayAviso(aviso: string | null | undefined): boolean {
  return typeof aviso === "string" && aviso.trim().length > 0;
}

/** Valida el aviso. Devuelve el error listo para mostrar, o null. */
export function errorDeAviso(aviso: string): string | null {
  if (aviso.length > MAX_AVISO_CHARS) {
    return `El aviso no puede pasar de ${MAX_AVISO_CHARS} caracteres: sacá ${aviso.length - MAX_AVISO_CHARS}.`;
  }
  return null;
}

/**
 * Si el aviso ya salió y no hay que repetirlo.
 *
 * Se mira el último mensaje que salió de este lado —de la IA o de una persona— y
 * se compara con el aviso configurado. Alcanza con eso: si lo último que vio el
 * lead es el aviso, ya está avisado; si alguien le contestó después, la charla
 * siguió y un aviso nuevo en la próxima madrugada tiene sentido otra vez.
 *
 * Es una comparación de texto y no una marca en la fila porque el aviso se le
 * envía al contacto, así que no puede llevar nada adentro que lo delate —ese es
 * el truco del ⚙️ de las notas internas, que no se envían—. El costo es que
 * cambiar el texto del aviso puede dejar salir uno de más en los chats que
 * tenían el viejo. Es una vez por chat y nunca le miente a nadie.
 *
 * Vive acá, con el resto de las decisiones del horario, porque es la regla que
 * en producción no se puede mirar sin esperar a que sea de madrugada.
 */
export function yaSalioElAviso(ultimoSaliente: string | null, aviso: string): boolean {
  if (ultimoSaliente === null) return false;
  return ultimoSaliente.trim() === aviso.trim();
}

/* ----------------------------------------------------------------- la fila */

/** Las columnas del horario, como vienen de la base. */
type FilaConHorario = {
  dias?: unknown;
  franjas?: unknown;
  horario_excluye?: unknown;
  /** El par de columnas que tuvo el horario antes de las franjas. */
  hora_desde?: unknown;
  hora_hasta?: unknown;
};

/**
 * El horario que sale de una fila de `ai_agent_configs`.
 *
 * Las columnas pueden no estar —una migración del horario todavía sin correr— y
 * entonces el agente contesta siempre, que es como venía. Dejar de contestar por
 * una migración pendiente sería mucho peor que ignorar un recorte que nadie
 * configuró.
 */
export function horarioDeLaFila(fila: FilaConHorario | null | undefined): HorarioDelAgente {
  return {
    // Por `entero` y no por `Number`: `Number(null)` es 0, así que un hueco en
    // el arreglo pasaría por domingo y el agente contestaría un día que nadie
    // marcó. El check de la columna tampoco lo deja entrar, pero el que lee no
    // puede confiar en eso para una fila que ya está guardada.
    dias: Array.isArray(fila?.dias)
      ? (fila.dias as unknown[])
          .map(entero)
          .filter((dia): dia is number => dia !== null && TODOS_LOS_DIAS.includes(dia))
      : TODOS_LOS_DIAS,
    franjas: franjasDeLaFila(fila),
    // Sin la columna, la lista blanca de siempre: es lo que la fila significaba
    // antes de que el modo existiera.
    excluye: fila?.horario_excluye === true,
  };
}

/**
 * Las franjas de la fila, con respaldo en las dos columnas viejas.
 *
 * El respaldo es para el despliegue a medias: el código nuevo contra una base
 * donde corrió `202610010001` pero todavía no `202610010003`. Sin él, el agente
 * que ya tenía horario cargado pasaría a contestar a toda hora justo en el
 * momento en que nadie está mirando eso.
 */
function franjasDeLaFila(fila: FilaConHorario | null | undefined): Franja[] {
  if (Array.isArray(fila?.franjas)) {
    return (fila.franjas as unknown[])
      .map(aFranja)
      .filter((franja): franja is Franja => franja !== null);
  }

  const desde = entero(fila?.hora_desde);
  const hasta = entero(fila?.hora_hasta);
  if (desde === null || hasta === null) return [];
  // El día completo no es una franja: es no tener ninguna.
  if (desde <= 0 && hasta >= MINUTOS_DEL_DIA) return [];
  return desde < hasta ? [{ desde, hasta }] : [];
}

/** Un elemento del jsonb, si es una franja. */
function aFranja(valor: unknown): Franja | null {
  if (typeof valor !== "object" || valor === null) return null;
  const desde = entero((valor as { desde?: unknown }).desde);
  const hasta = entero((valor as { hasta?: unknown }).hasta);
  return desde === null || hasta === null ? null : { desde, hasta };
}

/** El aviso que sale de una fila. Sin la columna, no hay aviso. */
export function avisoDeLaFila(fila: { aviso_fuera_de_horario?: unknown } | null | undefined): string {
  return typeof fila?.aviso_fuera_de_horario === "string" ? fila.aviso_fuera_de_horario : "";
}

/** El número de la columna, o null si vino cualquier otra cosa. */
function entero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.trunc(valor) : null;
  // Postgres devuelve los `smallint` como número, pero un `select` armado a mano
  // o una fila vieja pueden traerlos como texto.
  if (typeof valor === "string" && valor.trim()) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.trunc(numero) : null;
  }
  return null;
}

/* ------------------------------------------------------------- hora local */

/**
 * Minutos desde la medianoche en la zona pedida.
 *
 * `Intl` es lo único que sabe de horarios de verano y de husos que no son
 * horas enteras. Hacerlo con offsets fijos funcionaría hasta el primer cambio
 * de hora.
 */
function minutosLocales(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);

  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? "0");
  return hora * 60 + minuto;
}

/** Una franja invertida o vacía se lee como "a cualquier hora". */
function dentroDeLaFranja(instante: Date, franja: Franja, zona: string): boolean {
  if (franja.desde >= franja.hasta) return true;
  const ahora = minutosLocales(instante, zona);
  return ahora >= franja.desde && ahora < franja.hasta;
}

/**
 * Qué día de la semana es en la zona pedida, 0 = domingo.
 *
 * Por `Intl` y no por `getDay()` porque el día lo decide la zona del workspace:
 * a las 22 de un domingo en Buenos Aires, en UTC ya es lunes.
 */
function diaLocal(instante: Date, zona: string): number {
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short" }).format(
    instante,
  );
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nombre);
  return dia === -1 ? 0 : dia;
}
