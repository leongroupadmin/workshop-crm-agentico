/**
 * Cuándo el agente mueve la tarjeta de columna, y a cuál.
 *
 * El criterio no está en el código: lo escribe quien configura, en castellano
 * ("cuando ya dijo su rubro y cuántos vendedores tiene"), y viaja al modelo tal
 * cual. Este archivo es todo lo que se puede decidir *sin* la base y sin la API:
 * qué reglas aplican según dónde está la tarjeta, cómo se le pregunta al modelo
 * y cómo se lee lo que contesta.
 *
 * Esa separación es la que permite probar acá lo que en producción no se puede
 * mirar: que una regla no aplique desde la columna equivocada, que un nombre
 * inventado no mueva nada, y que una respuesta mal formada no termine en un
 * movimiento.
 *
 * El resto —leer las reglas, pedirle al modelo, escribir la oportunidad— está
 * en `movimientos-del-agente-server.ts`.
 */

/** Una regla, como la guardó el panel. */
export type ReglaDeMovimiento = {
  id: string;
  /** A qué columna mueve. */
  stageId: string;
  /** Desde cuál aplica. Null es "desde cualquiera". */
  desdeStageId: string | null;
  criterio: string;
  activo: boolean;
};

/**
 * Tope de reglas por agente.
 *
 * No lo pide la base. Lo pide la clasificación: las reglas que aplican viajan
 * enteras en cada pedido, y una lista de treinta criterios no la lee bien ni el
 * modelo ni la persona que después tiene que entender por qué se movió una
 * tarjeta. Doce alcanza para un embudo de seis columnas con reglas de ida y de
 * vuelta.
 */
export const MAX_REGLAS = 12;

/** Tope del criterio, igual que el check de Postgres. */
export const MAX_CRITERIO_CHARS = 300;
export const MIN_CRITERIO_CHARS = 3;

/**
 * Cuántos mensajes ve el clasificador.
 *
 * Son diez y no los cuarenta que ve la respuesta porque la pregunta es otra. La
 * respuesta necesita el hilo entero para no repetirse ni contradecirse; el
 * criterio se cumple —o no— con lo último que pasó. Pasarle los cuarenta no
 * decidiría mejor y pagaría cuatro veces la entrada en cada mensaje.
 */
export const MENSAJES_PARA_CLASIFICAR = 10;

/** Lo que el clasificador contesta cuando ninguna regla se cumple. */
export const SIN_MOVIMIENTO = "ninguna";

/**
 * Valida una regla antes de guardarla. Devuelve el error listo para mostrar, o null.
 *
 * Vive acá porque lo usan los dos lados: el panel mientras se edita y la action
 * antes de escribir. El error de Postgres habla de constraints y de nombres de
 * columna, y lo que hay que decirle a alguien que dejó el criterio vacío es por
 * qué un criterio vacío es peor que no tener la regla.
 */
export function errorDeRegla(regla: {
  stageId: string;
  desdeStageId: string | null;
  criterio: string;
}): string | null {
  if (!regla.stageId) return "Elegí a qué columna mueve la regla.";

  const criterio = regla.criterio.trim();
  if (criterio.length < MIN_CRITERIO_CHARS) {
    // Un criterio vacío no es una regla incompleta: es una regla que se cumple
    // siempre, y el modelo la leería así.
    return "Escribí cuándo tiene que mover. Sin criterio, la regla se cumpliría siempre.";
  }
  if (criterio.length > MAX_CRITERIO_CHARS) {
    return `El criterio no puede pasar de ${MAX_CRITERIO_CHARS} caracteres: viaja al modelo en cada mensaje.`;
  }
  if (regla.desdeStageId && regla.desdeStageId === regla.stageId) {
    return "La columna de origen y la de destino no pueden ser la misma.";
  }
  return null;
}

/** El primer error de la lista entera, incluidas las reglas repetidas. */
export function errorDeLasReglas(reglas: ReglaDeMovimiento[]): string | null {
  if (reglas.length > MAX_REGLAS) {
    return `No se pueden cargar más de ${MAX_REGLAS} reglas: todas las que aplican viajan al modelo en cada mensaje.`;
  }

  for (const regla of reglas) {
    const error = errorDeRegla(regla);
    if (error) return error;
  }

  // Dos reglas para el mismo movimiento son dos criterios contradictorios para
  // la misma decisión. La base ya lo rechaza; acá se explica.
  const vistas = new Set<string>();
  for (const regla of reglas) {
    const clave = `${regla.desdeStageId ?? ""}>${regla.stageId}`;
    if (vistas.has(clave)) {
      return "Hay dos reglas para el mismo movimiento. Dejá una sola y juntá los criterios.";
    }
    vistas.add(clave);
  }

  return null;
}

/**
 * Las reglas que pueden disparar con la tarjeta donde está.
 *
 * Tres recortes, y cada uno saca un error distinto:
 *
 * - La apagada no cuenta. Es el interruptor para probar sin borrar la regla.
 * - La que pide otra columna de origen no cuenta. Es lo que evita que un
 *   criterio ya cumplido —"dijo su rubro", que sigue siendo verdad para
 *   siempre— devuelva la tarjeta a una columna por la que ya pasó.
 * - La que lleva a la columna donde la tarjeta ya está no cuenta. No es un
 *   movimiento, y ofrecérsela al modelo invita a un movimiento que no mueve.
 */
export function reglasAplicables(
  reglas: ReglaDeMovimiento[],
  etapaActual: string | null,
): ReglaDeMovimiento[] {
  return reglas.filter(
    (regla) =>
      regla.activo &&
      regla.stageId !== etapaActual &&
      (regla.desdeStageId === null || regla.desdeStageId === etapaActual),
  );
}

/** Una regla con el nombre de su columna, que es lo único que el modelo ve. */
export type ReglaConNombre = { stageId: string; nombre: string; criterio: string };

/**
 * Lo que se le pide al clasificador.
 *
 * Es un pedido aparte del que escribe la respuesta, y a propósito. Clasificar
 * mientras redacta le pone al modelo dos tareas en el mismo turno, con el prompt
 * entero del negocio compitiendo por su atención; acá la tarea está sola, es
 * corta, y devuelve algo que se puede verificar antes de tocar una tarjeta.
 *
 * El motivo no es decorado: es lo que después se lee en el chat para darse
 * cuenta de que un criterio está mal redactado. Sin él, un movimiento equivocado
 * sólo se puede discutir mirando la conversación entera.
 */
export function instruccionesDeClasificacion(reglas: ReglaConNombre[]): string {
  return [
    "Sos un clasificador de un CRM. Mirás una conversación entre un vendedor y una",
    "persona, y decidís si corresponde mover su tarjeta a otra columna del embudo.",
    "",
    "Las columnas posibles son exactamente éstas, con el criterio de cada una:",
    ...reglas.map((regla) => `- "${regla.nombre}": ${regla.criterio}`),
    "",
    'Contestás sólo con un objeto JSON: {"etapa": "<nombre exacto o ' +
      SIN_MOVIMIENTO +
      '>", "motivo": "<una frase corta>"}',
    "",
    "Reglas:",
    `- Si ninguno de los criterios se cumple, la etapa es "${SIN_MOVIMIENTO}".`,
    "- El nombre va copiado tal cual de la lista. No inventes ni abrevies.",
    "- El criterio se tiene que cumplir con lo que la persona dijo, no con lo que",
    "  vos supongas que va a pasar. Ante la duda, ninguna.",
    "- El motivo cita lo que la persona dijo y que hace que el criterio se cumpla.",
    `  Si la etapa es "${SIN_MOVIMIENTO}", el motivo puede ir vacío.`,
  ].join("\n");
}

/** La conversación como la ve el clasificador. */
export function conversacionParaClasificar(
  mensajes: { deLaPersona: boolean; texto: string }[],
): string {
  return mensajes
    .slice(-MENSAJES_PARA_CLASIFICAR)
    .map((mensaje) => `${mensaje.deLaPersona ? "Persona" : "Vendedor"}: ${mensaje.texto}`)
    .join("\n");
}

/** Lo que se decidió, ya validado contra las reglas que aplicaban. */
export type Clasificacion = { stageId: string; nombre: string; motivo: string };

/**
 * Lee lo que contestó el clasificador y lo valida contra las reglas.
 *
 * Devuelve null cuando no hay que mover: porque dijo "ninguna", porque no
 * devolvió JSON, o —el caso que importa— porque nombró una columna que no está
 * en la lista que se le dio. Ahí no se busca la más parecida: el movimiento que
 * no se hace se nota y se corrige, el que se hace a la columna equivocada se
 * descubre cuando alguien ya trabajó esa tarjeta como si fuera otra cosa.
 *
 * El JSON se busca entre llaves y no se parsea el texto entero porque el modelo
 * a veces lo envuelve en un bloque de código o le pone una línea arriba.
 */
export function interpretarClasificacion(
  respuesta: string,
  aplicables: ReglaConNombre[],
): Clasificacion | null {
  const abre = respuesta.indexOf("{");
  const cierra = respuesta.lastIndexOf("}");
  if (abre === -1 || cierra <= abre) return null;

  let objeto: unknown;
  try {
    objeto = JSON.parse(respuesta.slice(abre, cierra + 1));
  } catch {
    return null;
  }

  if (!objeto || typeof objeto !== "object") return null;
  const { etapa, motivo } = objeto as { etapa?: unknown; motivo?: unknown };
  if (typeof etapa !== "string") return null;

  const buscado = normalizar(etapa);
  if (!buscado || buscado === SIN_MOVIMIENTO) return null;

  const regla = aplicables.find((item) => normalizar(item.nombre) === buscado);
  if (!regla) return null;

  return {
    stageId: regla.stageId,
    nombre: regla.nombre,
    motivo: typeof motivo === "string" ? motivo.trim() : "",
  };
}

/**
 * Para comparar nombres de columna escritos a mano contra los de la base.
 *
 * Sin acentos y en minúsculas porque el modelo copia "calificado" donde la
 * columna dice "Calificado", y eso no es un nombre inventado: es el mismo
 * nombre. Lo que sigue sin pasar es una columna que no está en la lista.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Cómo queda el movimiento escrito en el chat.
 *
 * Con el mismo engranaje que el resumen del agente y los avisos de las
 * automatizaciones: una fila de `messages` que empieza con ⚙️, que no se le
 * envía a nadie y que quien atiende ya reconoce como algo del sistema.
 *
 * El motivo va en la nota y no sólo en un log porque es el único lugar donde
 * alguien lo va a leer. Un vendedor que ve "movió a Calificado — dijo que son 4
 * vendedores" sabe si el criterio está bien escrito; el mismo movimiento sin
 * motivo sólo se puede auditar releyendo la conversación.
 */
export function notaDeMovimiento(nombre: string, motivo: string): string {
  const encabezado = `⚙️ El agente movió la tarjeta a ${nombre}`;
  return motivo ? `${encabezado}\n${motivo}` : encabezado;
}
