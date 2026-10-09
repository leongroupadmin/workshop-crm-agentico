/**
 * Automatizaciones: qué las arranca, qué hacen y cuándo se les permite hablar.
 *
 * El módulo no toca la base ni la red. Recibe lo que está guardado y decide;
 * ejecutar es problema del cron. Esa separación es la que permite probar acá lo
 * que en producción no se puede mirar: que un paso no salga a las tres de la
 * mañana, que la espera se cuente bien y que un disparador mal guardado no
 * tumbe la vuelta entera.
 */

import { TIPOS_DE_CITA, type TipoDeCita } from "./calendar-citas.ts";
import { esEventoMeta, type EventoMeta } from "./meta-eventos.ts";

export const TIPOS_DE_DISPARADOR = ["etapa", "lead_nuevo", "sin_respuesta", "cita"] as const;
export type TipoDisparador = (typeof TIPOS_DE_DISPARADOR)[number];

/**
 * La espera vive en el disparador y no en un primer paso "esperar".
 *
 * Es la forma en que se piensa el embudo —"a las 24 horas de entrar en Nuevo
 * lead"— y además cambia el significado: lo que se mide es el tiempo desde el
 * hecho, no desde que la corrida arrancó.
 */
export type Disparador =
  | { tipo: "etapa"; stageId: string; esperaMinutos: number }
  | { tipo: "lead_nuevo"; esperaMinutos: number }
  | { tipo: "sin_respuesta"; esperaMinutos: number }
  | {
      tipo: "cita";
      momento: MomentoDeCita;
      /** Cuánto antes del inicio sale. Sólo lo usa `antes`. */
      anticipacionMinutos: number;
      /** Qué clase de cita lo dispara. Null es "cualquiera". */
      tipoDeCita: TipoDeCita | null;
      esperaMinutos: number;
    };

/**
 * Cuándo sale un recordatorio de cita.
 *
 * Los otros tres disparadores miran hacia atrás: pasó algo y se cuenta desde
 * ahí. Éste mira hacia adelante, que es lo que lo hace distinto de todo lo
 * demás en el archivo: el momento no se calcula desde el disparo sino desde el
 * inicio de la cita, que está en el futuro y además se puede mover.
 *
 * `al_agendar` es la confirmación que sale apenas entra la reserva.
 * `antes` es el recordatorio propiamente dicho: 24 horas antes, una hora antes.
 */
export const MOMENTOS_DE_CITA = ["al_agendar", "antes"] as const;
export type MomentoDeCita = (typeof MOMENTOS_DE_CITA)[number];

/** Tope de la anticipación: un mes. Más que eso no es un recordatorio. */
export const MAX_ANTICIPACION_MINUTOS = 30 * 24 * 60;

/**
 * Los tres recordatorios con los que se arranca.
 *
 * No se guardan solos: la Agenda los ofrece cuando todavía no hay ninguno y
 * quedan escritos recién si el administrador aprieta Guardar. La diferencia
 * importa —un sistema que empieza a mandar WhatsApps porque se deployó una
 * versión nueva es un sistema que no se controla—, y a la vez una pantalla
 * vacía con un botón "Agregar" deja a cualquiera adivinando qué conviene poner.
 *
 * Los textos no nombran el plazo ("mañana", "en una hora") a propósito: el
 * plazo es justo lo que se edita al lado, y un texto que lo repite queda
 * mintiendo en cuanto alguien lo cambia.
 */
export const RECORDATORIOS_SUGERIDOS: {
  momento: MomentoDeCita;
  anticipacionMinutos: number;
  texto: string;
}[] = [
  {
    momento: "al_agendar",
    anticipacionMinutos: 0,
    texto:
      "¡Hola {nombre}! Te confirmo {cita} para el {fecha} a las {hora}. " +
      "Cualquier cosa me escribís por acá.",
  },
  {
    momento: "antes",
    anticipacionMinutos: 24 * 60,
    texto: "Hola {nombre}, te recuerdo {cita}: {fecha} a las {hora}. ¿Sigue en pie?",
  },
  {
    momento: "antes",
    anticipacionMinutos: 60,
    texto: "Hola {nombre}, ya casi es la hora de {cita}. Te espero a las {hora}.",
  },
];

/**
 * Un recordatorio de cita no juega con las mismas reglas que el resto.
 *
 * Todo lo que corta una secuencia de seguimiento —la franja horaria, el corte
 * por respuesta, la IA frenada, el tope diario, la etapa del embudo— existe
 * para no molestar a alguien que no pidió nada. Quien reservó una llamada sí
 * pidió: el recordatorio es parte de lo que reservó, y cada uno de esos cortes
 * lo único que lograría es que no llegue.
 *
 * El caso que lo vuelve obvio es la etapa: el que reserva por Calendar no tiene
 * oportunidad en ningún embudo, así que su etapa es null y *cualquier*
 * condición de etapa lo cancelaría en silencio, siempre.
 */
export function esRecordatorioDeCita(disparador: Disparador | null): boolean {
  return disparador?.tipo === "cita";
}

export const TIPOS_DE_PASO = [
  "esperar",
  "plantilla",
  "texto",
  "audio",
  "ia",
  "mover",
  "avisar",
  "meta",
  "asignar",
  "frenar_ia",
  "condicion",
] as const;
export type TipoPaso = (typeof TIPOS_DE_PASO)[number];

/**
 * Dejar el chat marcado después de escribirle al contacto.
 *
 * Sin esto, un mensaje automático sale y la conversación queda igual de
 * tranquila que antes: el contador de sin leer sólo lo mueve lo que entra. La
 * secuencia hablaba y nadie se enteraba hasta que el contacto contestaba —si
 * contestaba—.
 *
 * Marcado, el chat sube a la bandeja con su globito igual que un mensaje
 * entrante, y se apaga solo cuando alguien lo abre. Es para las secuencias que
 * piden seguimiento humano: mandaste la propuesta, ahora alguien tiene que
 * mirar si contestan.
 *
 * Es opcional a propósito: las automatizaciones que ya estaban guardadas no lo
 * traen, y sin el campo se comportan como siempre.
 */
type ConMarca = { marcarSinLeer?: boolean };

/**
 * Cómo se elige a quién le toca el próximo lead.
 *
 * `equitativo` es la rotación de toda la vida: le toca al que hace más que no
 * recibe. `peso` reparte en proporción —uno que vende el doble atiende el
 * doble— y `carga` mira cuántos leads abiertos tiene cada uno ahora, que es
 * distinto: el que cerró todos los suyos vuelve a estar libre aunque le hayan
 * tocado muchos.
 */
export const MODOS_DE_REPARTO = ["equitativo", "peso", "carga"] as const;
export type ModoDeReparto = (typeof MODOS_DE_REPARTO)[number];

/**
 * Un usuario dentro del reparto, con los días y las horas en que recibe.
 *
 * El horario es de cada persona y no de la automatización a propósito: repartir
 * es justamente decidir *quién* según *cuándo*, y una sola ventana para todos
 * obligaría a una automatización por turno.
 */
export type Candidato = {
  userId: string;
  /** Días en que recibe, 0 = domingo, igual que `Date.getDay()`. */
  dias: number[];
  /** Minutos desde la medianoche. Invertida o vacía se lee como todo el día. */
  horaDesde: number;
  horaHasta: number;
  /** Cuántos leads le tocan por cada uno de los demás, sólo en el modo `peso`. */
  peso: number;
};

/** Tope de gente en un reparto. Más que esto es una lista mal armada. */
export const MAX_CANDIDATOS = 20;
/** Tope del peso de una persona: 20 a 1 ya es "que le toque todo a ese". */
export const MAX_PESO = 20;

/* ---------------------------------------------------------------- condición */

/**
 * Lo que una condición mira para decidir por qué rama sigue.
 *
 * Las cuatro se resuelven con una consulta y contra algo que ya existe en el
 * momento de ejecutar el paso, que es la restricción que las define: una
 * condición se evalúa días después de que la automatización arrancó, así que
 * no puede depender de nada que se haya calculado al dispararla.
 *
 * - `etapa`: en qué columna del embudo está el lead *ahora*. Es la que reemplaza
 *   el truco de armar dos automatizaciones con `etapa_requerida` distinta.
 * - `respondio`: si el contacto escribió desde que arrancó la corrida. Sirve
 *   con `cancelar_si_responde` apagado, que es cuando la secuencia sigue viva
 *   después de que contestó y conviene decirle otra cosa.
 * - `ventana`: si todavía se puede mandar un mensaje libre. Es la que evita el
 *   paso que no sale: dentro de la ventana un texto, fuera de ella la plantilla.
 * - `con_responsable`: si el lead ya tiene dueño.
 */
export type Prueba =
  | { tipo: "etapa"; stageIds: string[] }
  | { tipo: "respondio" }
  | { tipo: "ventana" }
  | { tipo: "con_responsable" };

export const TIPOS_DE_PRUEBA = ["etapa", "respondio", "ventana", "con_responsable"] as const;
export type TipoPrueba = (typeof TIPOS_DE_PRUEBA)[number];

/** Las dos salidas de una condición. */
export const RAMAS = ["si", "no"] as const;
export type Rama = (typeof RAMAS)[number];

/**
 * Tope de etapas en una condición de etapa.
 *
 * Más que esto no es una condición, es "cualquiera menos dos": conviene darlo
 * vuelta y poner las otras en la rama del no.
 */
export const MAX_ETAPAS_DE_LA_PRUEBA = 10;

export type Paso =
  | { tipo: "esperar"; minutos: number }
  | ({ tipo: "plantilla"; nombre: string; idioma: string; valores: Record<string, string> } & ConMarca)
  | ({ tipo: "texto"; texto: string } & ConMarca)
  /**
   * Un audio grabado una sola vez, al armar la automatización, que sale igual
   * en cada corrida.
   *
   * `url` apunta al archivo ya guardado y `texto` es su transcripción: se hace
   * al subirlo y no al enviarlo porque el audio es siempre el mismo, y así el
   * historial y el agente leen lo que se dijo en vez de "Nota de voz".
   *
   * `urlWav` es el mismo audio en WAV, para Instagram y Messenger, que rechazan
   * el OGG y el WebM. Se arma en el navegador al subirlo, porque el servidor no
   * tiene con qué decodificar el audio. Falta en los pasos guardados antes de
   * que existiera: esos salen por WhatsApp y fallan con un aviso en los otros
   * canales hasta que se prepare la versión WAV desde el editor.
   */
  | ({ tipo: "audio"; url: string; urlWav?: string; texto: string } & ConMarca)
  | ({ tipo: "ia"; instruccion: string } & ConMarca)
  | { tipo: "mover"; stageId: string }
  | { tipo: "avisar"; texto: string }
  /**
   * Le avisa a Meta que el lead convirtió, para que lo cuente en el anuncio
   * que lo trajo. `conValor` suma el monto de la oportunidad.
   */
  | { tipo: "meta"; evento: EventoMeta; conValor: boolean }
  /**
   * Le pone responsable al lead, repartiendo entre la gente que esté en
   * horario. Si no hay nadie, quien ejecuta lo manda al responsable de
   * respaldo: un lead sin dueño no lo mira nadie.
   */
  | { tipo: "asignar"; modo: ModoDeReparto; candidatos: Candidato[] }
  /**
   * Frena la IA para este contacto: es el mismo interruptor de la ficha, puesto
   * desde la secuencia. Sirve para que el agente no conteste solo lo que venga
   * después de un mensaje que tiene que parecer de una persona —un audio
   * grabado, una propuesta—, y que esa respuesta la lea alguien del equipo.
   *
   * No trae campos: lo único que hace es apagar, y reactivarla queda a mano.
   */
  | { tipo: "frenar_ia" }
  /**
   * Parte la secuencia en dos caminos.
   *
   * Las ramas son listas anidadas y no punteros a otros pasos, que es la
   * decisión que más consecuencias tiene en todo el archivo. Un grafo con
   * punteros permitiría volver atrás, y con eso aparecen los ciclos: una
   * automatización que se persigue a sí misma mandándole mensajes al mismo
   * contacto hasta que alguien la apague. Anidando, el ciclo es imposible de
   * escribir —no hay forma de apuntar hacia arriba— y a cambio se pierde el
   * "ir a", que es justamente lo que menos falta hace.
   *
   * Cuando una rama se termina, la secuencia sigue con lo que venga *después*
   * de la condición, como un `if` cualquiera. La alternativa —que cada rama
   * sea el final del camino— obligaría a repetir la cola en las dos.
   *
   * Una rama puede estar vacía: ahí la condición es "si pasa esto, hacé este
   * desvío; si no, seguí". Las dos vacías no se guardan: no decide nada.
   */
  | { tipo: "condicion"; prueba: Prueba; siSi: Paso[]; siNo: Paso[] };

export type Franja = { horaDesde: number; horaHasta: number; zona: string };

/**
 * Tope de pasos, contando los de todas las ramas.
 *
 * Eran 12 cuando la secuencia era una sola lista. Con ramas, una condición y
 * dos caminos de cuatro pasos ya son nueve, y el límite se chocaba armando algo
 * normal. Se cuenta el total y no el largo de cada rama porque lo que hay que
 * acotar es el trabajo de una corrida, y una corrida recorre un camino solo.
 */
export const MAX_PASOS = 24;

/**
 * Cuántas condiciones se pueden meter una adentro de otra.
 *
 * Tres niveles son ocho caminos posibles: más que eso no se puede leer en
 * pantalla ni razonar al mirar por qué un lead recibió lo que recibió. El tope
 * también protege al lector: `leerPasos` es recursivo y se lo llama con jsonb
 * de la base y con lo que mande el navegador.
 */
export const MAX_PROFUNDIDAD = 3;
/** Tres meses. Más que eso es casi seguro un cero de más al cargarlo. */
export const MAX_ESPERA_MINUTOS = 90 * 24 * 60;
/** Tope de mensajes automáticos por contacto y por día, para toda la cuenta. */
export const MAX_AUTOMATICOS_POR_DIA = 3;

/**
 * Cuánto atraso se le perdona a un recordatorio que ya venció.
 *
 * El cron no corre al segundo, y un aviso de "24 horas antes" que sale doce
 * minutos tarde sigue sirviendo. Lo que no se anota es un momento que pasó hace
 * rato: una reserva cargada dos horas antes de la llamada no tiene que mandar
 * el recordatorio de las 24 horas, porque ese momento nunca existió —y saldría
 * al instante diciendo "mañana" sobre algo que es hoy—.
 */
export const TOLERANCIA_DE_ATRASO_MINUTOS = 15;

/**
 * Cuándo sale el recordatorio, o null si ese momento ya pasó.
 *
 * `al_agendar` sale ahora: la cita recién aparece en el barrido, que es lo más
 * cerca de "al agendar" que se puede estar sin un aviso en vivo.
 */
export function momentoDelRecordatorio(
  disparador: Extract<Disparador, { tipo: "cita" }>,
  inicio: Date,
  ahora: number,
): Date | null {
  if (disparador.momento === "al_agendar") return new Date(ahora);

  const corre = inicio.getTime() - disparador.anticipacionMinutos * 60_000;
  if (corre < ahora - TOLERANCIA_DE_ATRASO_MINUTOS * 60_000) return null;

  // Un momento que ya pasó pero entra en la tolerancia sale ahora y no en el
  // pasado: la vuelta siguiente lo levanta igual, pero una fila con `corre_en`
  // vencido miente sobre cuándo estaba previsto.
  return new Date(Math.max(corre, ahora));
}

/* -------------------------------------------------------------------- rutas */

/**
 * Dónde está parado algo dentro del árbol de pasos.
 *
 * Alterna índice y rama: `[2, "si", 1]` es el segundo paso de la rama del sí de
 * la condición que está tercera. Un número suelto —`[0]`— es un paso del nivel
 * de arriba, que es todo lo que existía cuando la secuencia era una lista.
 *
 * Es lo que reemplaza al índice que guardaba la corrida. Se persiste como
 * texto, `"2.si.1"`, porque va en una columna y porque así se lee de un vistazo
 * cuando hay que mirar una corrida a mano.
 */
export type Ruta = (number | Rama)[];

export function escribirRuta(ruta: Ruta): string {
  return ruta.join(".");
}

/**
 * Lee una ruta guardada. Devuelve `[]` si está rota, que el motor trata como
 * "esta corrida ya no sabe dónde está" y no como "arrancá de nuevo".
 */
export function leerRuta(crudo: unknown): Ruta {
  if (typeof crudo !== "string" || crudo.trim() === "") return [];

  const partes = crudo.trim().split(".");
  const ruta: Ruta = [];

  for (let i = 0; i < partes.length; i += 1) {
    // Pares: índice, rama, índice, rama… y siempre termina en índice.
    if (i % 2 === 0) {
      const indice = Number(partes[i]);
      if (!Number.isInteger(indice) || indice < 0) return [];
      ruta.push(indice);
    } else {
      const rama = RAMAS.find((valor) => valor === partes[i]);
      if (!rama) return [];
      ruta.push(rama);
    }
  }

  // Una ruta que termina en rama no apunta a ningún paso.
  return ruta.length % 2 === 1 ? ruta : [];
}

/**
 * La lista en la que vive el paso al final del prefijo.
 *
 * El prefijo son los pares completos —`[2, "si"]`—; sin nada, la lista de
 * arriba. Null quiere decir que la ruta no se corresponde con el árbol: pasa
 * cuando alguien editó la automatización con corridas en vuelo.
 */
function listaEn(pasos: Paso[], prefijo: Ruta): Paso[] | null {
  let lista = pasos;

  for (let i = 0; i < prefijo.length; i += 2) {
    const indice = prefijo[i];
    const rama = prefijo[i + 1];
    if (typeof indice !== "number" || (rama !== "si" && rama !== "no")) return null;

    const paso = lista[indice];
    if (paso?.tipo !== "condicion") return null;

    lista = rama === "si" ? paso.siSi : paso.siNo;
  }

  return lista;
}

/** El paso que está en esa ruta, o null si la ruta ya no existe. */
export function pasoEn(pasos: Paso[], ruta: Ruta): Paso | null {
  if (ruta.length === 0) return null;

  const lista = listaEn(pasos, ruta.slice(0, -1));
  const indice = ruta[ruta.length - 1];
  if (!lista || typeof indice !== "number") return null;

  return lista[indice] ?? null;
}

/** La ruta del primer paso, o null si la automatización no tiene ninguno. */
export function rutaInicial(pasos: Paso[]): Ruta | null {
  return pasos.length > 0 ? [0] : null;
}

/**
 * Qué se ejecuta después del paso que está en `ruta`.
 *
 * Avanza al hermano siguiente; si la lista se terminó, sube y sigue con lo que
 * venga después de la condición que abrió la rama. Null es el final de la
 * secuencia.
 */
export function rutaSiguiente(pasos: Paso[], ruta: Ruta): Ruta | null {
  if (ruta.length === 0) return null;

  const prefijo = ruta.slice(0, -1);
  const lista = listaEn(pasos, prefijo);
  const indice = ruta[ruta.length - 1];
  if (!lista || typeof indice !== "number") return null;

  if (indice + 1 < lista.length) return [...prefijo, indice + 1];

  // Se acabó la rama: sigue después de la condición que la abrió. Con menos de
  // tres tramos estamos en el nivel de arriba y no hay a dónde subir.
  if (ruta.length < 3) return null;
  return rutaSiguiente(pasos, ruta.slice(0, -2));
}

/**
 * Por dónde sigue una condición ya resuelta.
 *
 * Una rama vacía no es un error: significa "no hagas el desvío", y la secuencia
 * continúa después de la condición.
 */
export function rutaDeLaRama(pasos: Paso[], ruta: Ruta, rama: Rama): Ruta | null {
  const paso = pasoEn(pasos, ruta);
  if (paso?.tipo !== "condicion") return null;

  const elegida = rama === "si" ? paso.siSi : paso.siNo;
  return elegida.length > 0 ? [...ruta, rama, 0] : rutaSiguiente(pasos, ruta);
}

/**
 * Todos los pasos que una corrida parada en `ruta` todavía puede llegar a
 * ejecutar, las dos ramas de cada condición incluidas.
 *
 * Las dos y no la que vaya a tomar, porque todavía no se sabe cuál va a ser:
 * la condición se evalúa cuando se llega. Lo que se decide con esta lista
 * —si queda algún mensaje por salir, si lo único que falta es avisarle a Meta—
 * tiene que valer para cualquiera de los caminos posibles.
 */
export function pasosRestantes(pasos: Paso[], ruta: Ruta): Paso[] {
  const salida: Paso[] = [];
  let actual: Ruta | null = ruta;

  while (actual && actual.length > 0) {
    const lista = listaEn(pasos, actual.slice(0, -1));
    const desde = actual[actual.length - 1];
    if (!lista || typeof desde !== "number") break;

    for (let i = desde; i < lista.length; i += 1) acumular(lista[i], salida);

    // La cola de esta rama ya está contada; sigue lo de después de la condición
    // que la abrió. La condición en sí quedó contada al entrar en ella.
    actual = actual.length >= 3 ? rutaSiguiente(pasos, actual.slice(0, -2)) : null;
  }

  return salida;
}

function acumular(paso: Paso | undefined, salida: Paso[]): void {
  if (!paso) return;
  salida.push(paso);
  if (paso.tipo !== "condicion") return;
  for (const hijo of paso.siSi) acumular(hijo, salida);
  for (const hijo of paso.siNo) acumular(hijo, salida);
}

/** Todos los pasos del árbol, aplanados. Las condiciones también cuentan. */
export function todosLosPasos(pasos: Paso[]): Paso[] {
  const salida: Paso[] = [];
  for (const paso of pasos) acumular(paso, salida);
  return salida;
}

/** Cuántos pasos tiene la automatización, sumando los de todas las ramas. */
export function contarPasos(pasos: Paso[]): number {
  return todosLosPasos(pasos).length;
}

/** Cuántas condiciones hay metidas una adentro de otra, como mucho. */
export function profundidadDe(pasos: Paso[]): number {
  let maxima = 0;
  for (const paso of pasos) {
    if (paso.tipo !== "condicion") continue;
    const adentro = 1 + Math.max(profundidadDe(paso.siSi), profundidadDe(paso.siNo));
    maxima = Math.max(maxima, adentro);
  }
  return maxima;
}

/**
 * Aplica un cambio a la lista en la que vive una ruta, sin tocar el resto.
 *
 * Devuelve un árbol nuevo: el editor guarda los pasos en estado de React y
 * mutar la lista de adentro no dispararía el re-render de la rama que cambió.
 *
 * El prefijo son los pares completos. Si no se corresponde con el árbol
 * —porque apunta a un paso que no es una condición, o a una rama que no
 * existe— devuelve el árbol como estaba: perder el cambio es preferible a
 * escribirlo en otro lado.
 */
function conLista(pasos: Paso[], prefijo: Ruta, cambio: (lista: Paso[]) => Paso[]): Paso[] {
  if (prefijo.length === 0) return cambio(pasos);

  const [indice, rama, ...resto] = prefijo;
  if (typeof indice !== "number" || (rama !== "si" && rama !== "no")) return pasos;

  const paso = pasos[indice];
  if (paso?.tipo !== "condicion") return pasos;

  const hija = conLista(rama === "si" ? paso.siSi : paso.siNo, resto, cambio);
  const nuevo: Paso = rama === "si" ? { ...paso, siSi: hija } : { ...paso, siNo: hija };

  return pasos.map((p, i) => (i === indice ? nuevo : p));
}

/** Cambia el paso que está en esa ruta. */
export function reemplazarEn(pasos: Paso[], ruta: Ruta, nuevo: Paso): Paso[] {
  const indice = ruta[ruta.length - 1];
  if (typeof indice !== "number") return pasos;

  return conLista(pasos, ruta.slice(0, -1), (lista) =>
    lista.map((paso, i) => (i === indice ? nuevo : paso)),
  );
}

/**
 * Mete un paso en esa posición y empuja al resto para abajo.
 *
 * Es lo que hace el `+` de una línea del lienzo: la ruta que recibe es la del
 * paso que está debajo, y el nuevo le queda arriba. Con el largo de la lista
 * como índice, queda al final.
 */
export function insertarEn(pasos: Paso[], ruta: Ruta, nuevo: Paso): Paso[] {
  const indice = ruta[ruta.length - 1];
  if (typeof indice !== "number" || indice < 0) return pasos;

  return conLista(pasos, ruta.slice(0, -1), (lista) =>
    indice > lista.length
      ? lista
      : [...lista.slice(0, indice), nuevo, ...lista.slice(indice)],
  );
}

/** Saca el paso de esa ruta. Si es una condición, se lleva sus dos ramas. */
export function quitarEn(pasos: Paso[], ruta: Ruta): Paso[] {
  const indice = ruta[ruta.length - 1];
  if (typeof indice !== "number") return pasos;

  return conLista(pasos, ruta.slice(0, -1), (lista) => lista.filter((_, i) => i !== indice));
}

/** Mueve un paso dentro de su propia lista. Entre ramas no se mueve. */
export function moverEn(pasos: Paso[], ruta: Ruta, salto: number): Paso[] {
  const indice = ruta[ruta.length - 1];
  if (typeof indice !== "number") return pasos;

  return conLista(pasos, ruta.slice(0, -1), (lista) => {
    const destino = indice + salto;
    if (destino < 0 || destino >= lista.length) return lista;

    const copia = [...lista];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    return copia;
  });
}

/** Cómo se nombra una ruta en un mensaje de error: "Paso 3 › Sí › Paso 1". */
export function describirRuta(ruta: Ruta): string {
  return ruta
    .map((tramo) =>
      typeof tramo === "number" ? `Paso ${tramo + 1}` : tramo === "si" ? "Sí" : "No",
    )
    .join(" › ");
}

/* ------------------------------------------------------------------ lectura */

/**
 * Lee el disparador guardado.
 *
 * Devuelve null en vez de tirar: una fila corrupta tiene que saltear esa
 * automatización, no frenar la vuelta del cron para todas las demás.
 */
export function leerDisparador(crudo: unknown): Disparador | null {
  if (!crudo || typeof crudo !== "object") return null;
  const objeto = crudo as Record<string, unknown>;

  const tipo = TIPOS_DE_DISPARADOR.find((t) => t === objeto.tipo);
  if (!tipo) return null;

  const esperaMinutos = entero(objeto.esperaMinutos);
  if (esperaMinutos === null || esperaMinutos < 0 || esperaMinutos > MAX_ESPERA_MINUTOS) {
    return null;
  }

  if (tipo === "etapa") {
    const stageId = texto(objeto.stageId);
    return stageId ? { tipo, stageId, esperaMinutos } : null;
  }

  if (tipo === "cita") {
    const momento = MOMENTOS_DE_CITA.find((valor) => valor === objeto.momento);
    if (!momento) return null;

    // `al_agendar` sale apenas entra la reserva: no hay nada que anticipar, y
    // dejar escrito un número ahí sería una anticipación que no se aplica.
    const anticipacionMinutos = momento === "antes" ? entero(objeto.anticipacionMinutos) : 0;
    if (
      anticipacionMinutos === null ||
      anticipacionMinutos < 0 ||
      anticipacionMinutos > MAX_ANTICIPACION_MINUTOS
    ) {
      return null;
    }
    // Una anticipación de cero minutos es un aviso que llega cuando la llamada
    // ya empezó: no es un recordatorio, es ruido.
    if (momento === "antes" && anticipacionMinutos === 0) return null;

    const tipoDeCita = TIPOS_DE_CITA.find((valor) => valor === objeto.tipoDeCita) ?? null;

    return { tipo, momento, anticipacionMinutos, tipoDeCita, esperaMinutos };
  }

  return { tipo, esperaMinutos };
}

/**
 * La etapa en la que tiene que estar el lead para que la automatización corra.
 *
 * Null es "cualquiera", y es también lo que devuelve una fila vieja que no
 * tiene la columna: una automatización ya guardada no cambia de alcance porque
 * se haya agregado la condición.
 */
export function leerEtapaRequerida(crudo: unknown): string | null {
  return texto(crudo).trim() || null;
}

/**
 * Lee la secuencia guardada.
 *
 * `profundidad` es cuántas condiciones hay por encima de esta lista. No es un
 * detalle de implementación que se pueda omitir: el lector es recursivo y come
 * jsonb de la base y objetos que llegan del navegador, así que sin tope un
 * anidado de diez mil niveles —que cabe de sobra en un request— se lleva
 * puesta la pila y con ella la vuelta entera del cron. Pasado el tope la lista
 * se lee vacía, que para una condición significa que no se guarda.
 */
export function leerPasos(crudo: unknown, profundidad = 0): Paso[] {
  if (!Array.isArray(crudo)) return [];
  if (profundidad > MAX_PROFUNDIDAD) return [];

  // El arrow es necesario: `crudo.map(leerPaso)` le pasaría el índice como
  // profundidad y el tope dejaría de contar niveles para contar posiciones.
  return crudo
    .map((cruda) => leerPaso(cruda, profundidad))
    .filter((p): p is Paso => p !== null);
}

export function leerPaso(crudo: unknown, profundidad = 0): Paso | null {
  if (!crudo || typeof crudo !== "object") return null;
  const objeto = crudo as Record<string, unknown>;

  switch (objeto.tipo) {
    case "esperar": {
      const minutos = entero(objeto.minutos);
      return minutos !== null && minutos > 0 && minutos <= MAX_ESPERA_MINUTOS
        ? { tipo: "esperar", minutos }
        : null;
    }
    case "plantilla": {
      const nombre = texto(objeto.nombre);
      if (!nombre) return null;
      const valores =
        objeto.valores && typeof objeto.valores === "object" && !Array.isArray(objeto.valores)
          ? Object.fromEntries(
              Object.entries(objeto.valores as Record<string, unknown>).map(([k, v]) => [
                k,
                texto(v),
              ]),
            )
          : {};
      return {
        tipo: "plantilla",
        nombre,
        idioma: texto(objeto.idioma) || "es",
        valores,
        marcarSinLeer: objeto.marcarSinLeer === true,
      };
    }
    case "texto": {
      const contenido = texto(objeto.texto).trim();
      return contenido
        ? { tipo: "texto", texto: contenido, marcarSinLeer: objeto.marcarSinLeer === true }
        : null;
    }
    case "audio": {
      const url = texto(objeto.url).trim();
      if (!esUrlDeAudio(url)) return null;
      const urlWav = texto(objeto.urlWav).trim();
      return {
        tipo: "audio",
        url,
        // Una versión WAV inválida no tira el paso: sin ella sale igual por
        // WhatsApp, que es el canal de casi todas las automatizaciones.
        ...(esUrlDeAudio(urlWav) ? { urlWav } : {}),
        texto: texto(objeto.texto).trim() || AUDIO_SIN_TRANSCRIBIR,
        marcarSinLeer: objeto.marcarSinLeer === true,
      };
    }
    case "ia": {
      const instruccion = texto(objeto.instruccion).trim();
      return instruccion
        ? { tipo: "ia", instruccion, marcarSinLeer: objeto.marcarSinLeer === true }
        : null;
    }
    case "mover": {
      const stageId = texto(objeto.stageId);
      return stageId ? { tipo: "mover", stageId } : null;
    }
    case "avisar": {
      const contenido = texto(objeto.texto).trim();
      return contenido ? { tipo: "avisar", texto: contenido } : null;
    }
    case "meta": {
      if (!esEventoMeta(objeto.evento)) return null;
      // Una compra sin monto no le sirve a Meta para optimizar: el valor va
      // siempre, aunque la fila diga otra cosa.
      const conValor = objeto.evento === "Purchase" || objeto.conValor === true;
      return { tipo: "meta", evento: objeto.evento, conValor };
    }
    case "asignar": {
      const candidatos = leerCandidatos(objeto.candidatos);
      if (candidatos.length === 0) return null;
      const modo = MODOS_DE_REPARTO.find((m) => m === objeto.modo) ?? "equitativo";
      return { tipo: "asignar", modo, candidatos };
    }
    case "frenar_ia":
      return { tipo: "frenar_ia" };
    case "condicion": {
      const prueba = leerPrueba(objeto.prueba);
      if (!prueba) return null;

      const siSi = leerPasos(objeto.siSi, profundidad + 1);
      const siNo = leerPasos(objeto.siNo, profundidad + 1);
      // Las dos ramas vacías es una condición que no decide nada: se descarta
      // entera para que la pantalla no muestre un paso que el motor saltea.
      if (siSi.length === 0 && siNo.length === 0) return null;

      return { tipo: "condicion", prueba, siSi, siNo };
    }
    default:
      return null;
  }
}

/**
 * Lee lo que una condición mira.
 *
 * Null descarta la condición entera, y eso es a propósito: una prueba ilegible
 * no tiene rama por defecto que sea razonable. Mandar a todos por el sí sería
 * inventar una decisión, y por el no sería saltearse en silencio el desvío que
 * alguien configuró.
 */
function leerPrueba(crudo: unknown): Prueba | null {
  if (!crudo || typeof crudo !== "object") return null;
  const objeto = crudo as Record<string, unknown>;

  switch (objeto.tipo) {
    case "etapa": {
      if (!Array.isArray(objeto.stageIds)) return null;
      const stageIds = [
        ...new Set(
          objeto.stageIds
            .map((valor) => texto(valor).trim())
            .filter((valor) => valor !== ""),
        ),
      ].slice(0, MAX_ETAPAS_DE_LA_PRUEBA);
      // Sin ninguna etapa la condición sería siempre falsa.
      return stageIds.length > 0 ? { tipo: "etapa", stageIds } : null;
    }
    case "respondio":
    case "ventana":
    case "con_responsable":
      return { tipo: objeto.tipo };
    default:
      return null;
  }
}

/**
 * Lee la lista del reparto.
 *
 * Un candidato mal guardado se descarta en vez de tumbar el paso entero: que se
 * haya corrompido la fila de una persona no es razón para dejar de repartir
 * entre las otras. Sin nadie que sobreviva el paso sí se descarta, porque un
 * reparto vacío no reparte.
 */
function leerCandidatos(crudo: unknown): Candidato[] {
  if (!Array.isArray(crudo)) return [];

  const vistos = new Set<string>();
  const salida: Candidato[] = [];

  for (const cruda of crudo.slice(0, MAX_CANDIDATOS)) {
    if (!cruda || typeof cruda !== "object") continue;
    const objeto = cruda as Record<string, unknown>;

    const userId = texto(objeto.userId).trim();
    // Repetido significaría que a esa persona le toca el doble sin haberlo
    // pedido. Para eso está el peso, que se ve.
    if (!userId || vistos.has(userId)) continue;

    const dias = leerDias(objeto.dias);
    // Sin días no recibe nunca, que es lo mismo que no estar en la lista. Se lo
    // saca para que la rotación no tenga que saltearlo en cada vuelta.
    if (dias.length === 0) continue;

    const horaDesde = enRango(objeto.horaDesde, 0, 1439) ?? 0;
    const horaHasta = enRango(objeto.horaHasta, 0, 1439) ?? 0;
    const peso = enRango(objeto.peso, 1, MAX_PESO) ?? 1;

    vistos.add(userId);
    salida.push({ userId, dias, horaDesde, horaHasta, peso });
  }

  return salida;
}

function leerDias(crudo: unknown): number[] {
  if (!Array.isArray(crudo)) return [];
  const dias = new Set<number>();
  for (const valor of crudo) {
    const dia = enRango(valor, 0, 6);
    if (dia !== null) dias.add(dia);
  }
  return [...dias].sort((a, b) => a - b);
}

function enRango(valor: unknown, minimo: number, maximo: number): number | null {
  const numero = entero(valor);
  return numero !== null && numero >= minimo && numero <= maximo ? numero : null;
}

/**
 * Si el paso pide dejar el chat marcado como sin leer.
 *
 * Existe para no repetir el chequeo de tipo en cada lugar que lo consulta: los
 * pasos que no le escriben al contacto —esperar, mover, avisar, meta, frenar
 * la IA— nunca lo traen, y el campo es opcional también en los que sí.
 */
export function marcaSinLeer(paso: Paso): boolean {
  return "marcarSinLeer" in paso && paso.marcarSinLeer === true;
}

/** Lo que se guarda en el historial cuando no se pudo transcribir el audio. */
export const AUDIO_SIN_TRANSCRIBIR = "Nota de voz";

/**
 * Sólo se aceptan URLs https.
 *
 * Que además sea un archivo nuestro se comprueba al guardar, donde se conoce
 * el bucket; acá alcanza con descartar lo que ni siquiera es una dirección
 * descargable, que es lo que el proveedor necesita para poder mandarlo.
 */
function esUrlDeAudio(url: string): boolean {
  return /^https:\/\/\S+$/i.test(url);
}

/**
 * WhatsApp dibuja la onda con el play sólo si el audio es OGG/Opus; el resto
 * viaja como adjunto y se escucha igual.
 *
 * Se decide por la extensión del archivo guardado y no por un campo aparte,
 * que podría terminar diciendo lo contrario de lo que se subió.
 */
export function esNotaDeVoz(url: string): boolean {
  return /\.ogg(?:[?#]|$)/i.test(url);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * Si desde este punto la secuencia sólo le avisa a Meta.
 *
 * Una conversión es un hecho que ya pasó: el lead llegó a la columna. No se
 * frena porque alguien tomó la charla a mano, porque el lead contestó, porque
 * es de madrugada o porque ya lo movieron a la columna siguiente, que son los
 * cortes pensados para no escribirle a alguien a destiempo. Aplicarle esos
 * cortes perdía justo las mejores conversiones: el lead que avanza rápido.
 *
 * Tiene que ser *toda* la secuencia restante. Si después viene un mensaje, los
 * cortes siguen valiendo para él.
 */
export function soloConversiones(pasos: Paso[]): boolean {
  return (
    pasos.some((paso) => paso.tipo === "meta") &&
    pasos.every(
      (paso) => paso.tipo === "meta" || paso.tipo === "esperar" || paso.tipo === "condicion",
    )
  );
}

/**
 * Si de acá en adelante no le sale ningún mensaje al contacto.
 *
 * Los dos cortes que existen para no molestar al lead —la franja horaria y el
 * "se canceló porque respondió"— no tienen sentido sobre pasos que el lead
 * nunca ve. Un reparto que espera a que abran las nueve deja el lead sin dueño
 * toda la noche, y uno que se cancela porque el lead contestó deja sin dueño
 * justamente al que más interés mostró.
 *
 * `mover` y `avisar` tampoco le escriben, pero quedan afuera: cambiarles el
 * comportamiento ahora movería automatizaciones que ya están andando.
 */
export function sinMensajes(pasos: Paso[]): boolean {
  return pasos.every(
    (paso) =>
      paso.tipo === "asignar" ||
      paso.tipo === "esperar" ||
      paso.tipo === "meta" ||
      // Frenar la IA a las tres de la mañana está bien, y es justo cuando más
      // falta hace: si el contacto contesta de madrugada, el agente ya no habla.
      paso.tipo === "frenar_ia" ||
      // La condición no le escribe a nadie: lo que decide son los pasos de sus
      // ramas, y `pasosRestantes` ya los trae a esta misma lista.
      paso.tipo === "condicion",
  );
}

/**
 * Si la propia corrida ya frenó la IA antes de llegar a `ruta`.
 *
 * La IA frenada corta los mensajes automáticos porque quiere decir que alguien
 * tomó la conversación a mano. Cuando la frenó esta misma secuencia no es así:
 * sin esta excepción, "parar la IA, esperar un día y mandar un recordatorio"
 * se cancelaría sola en el recordatorio.
 *
 * Cuenta sólo lo que seguro ya se ejecutó: los pasos anteriores de cada lista
 * del camino hasta `ruta`. Un "frenar" dentro de una condición que quedó atrás
 * no cuenta, porque no se sabe por qué rama pasó la corrida; en la duda se
 * aplica el corte de siempre.
 */
export function yaFrenoLaIA(pasos: Paso[], ruta: Ruta): boolean {
  let lista = pasos;

  for (let i = 0; i < ruta.length; i += 2) {
    const indice = ruta[i];
    if (typeof indice !== "number") return false;
    if (lista.slice(0, indice).some((paso) => paso.tipo === "frenar_ia")) return true;

    const rama = ruta[i + 1];
    const paso = lista[indice];
    if ((rama !== "si" && rama !== "no") || paso?.tipo !== "condicion") return false;
    lista = rama === "si" ? paso.siSi : paso.siNo;
  }

  return false;
}

function entero(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

/* ------------------------------------------------------------------- franja */

/**
 * Minutos desde la medianoche en la zona pedida.
 *
 * `Intl` es lo único que sabe de horarios de verano y de husos que no son
 * horas enteras. Hacerlo con offsets fijos funcionaría hasta el primer cambio
 * de hora, y fallaría mandando mensajes a la madrugada.
 */
export function minutosLocales(instante: Date, zona: string): number {
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

/**
 * Una franja invertida o vacía se lee como "a cualquier hora".
 *
 * Es la interpretación segura: la otra —no enviar nunca— deja la automatización
 * prendida y muda, que es la falla más difícil de notar.
 */
function franjaAbierta(franja: Franja): boolean {
  return franja.horaDesde >= franja.horaHasta;
}

export function dentroDeLaFranja(instante: Date, franja: Franja): boolean {
  if (franjaAbierta(franja)) return true;
  const ahora = minutosLocales(instante, franja.zona);
  return ahora >= franja.horaDesde && ahora < franja.horaHasta;
}

/**
 * El próximo instante en que la franja está abierta.
 *
 * Se calcula sumando minutos al instante y no armando una fecha local, porque
 * sumar minutos es exacto y armar la medianoche de otra zona no lo es. En un
 * cambio de horario de verano el resultado puede quedar corrido una hora: no
 * importa, el ejecutor vuelve a preguntar antes de enviar y a lo sumo cuesta
 * una vuelta más del cron.
 */
export function proximaApertura(instante: Date, franja: Franja): Date {
  if (dentroDeLaFranja(instante, franja)) return instante;

  const ahora = minutosLocales(instante, franja.zona);
  const faltan = ahora < franja.horaDesde ? franja.horaDesde - ahora : 1440 - ahora + franja.horaDesde;

  return new Date(instante.getTime() + faltan * 60_000);
}

/* ---------------------------------------------------------------- silencio */

/**
 * Si a esta conversación le corresponde un seguimiento por silencio.
 *
 * Vive acá y no adentro del barrido porque es la regla que en producción no se
 * puede mirar sin esperar días, y la que ya falló una vez: el "ya le escribí
 * por este silencio" se medía contra el último mensaje del chat, y el mensaje
 * que manda el propio seguimiento pasaba a ser el último. Doce horas después el
 * silencio volvía a estar cumplido, la corrida vieja quedaba antes del corte, y
 * salía otro. Y otro. El lead frío parado en la columna de entrada recibía dos
 * por día hasta que alguien moviera la tarjeta.
 *
 * El ancla correcta es la última vez que habló *el contacto*: eso es lo que
 * define este silencio. Mientras no vuelva a escribir sigue siendo el mismo, y
 * un seguimiento ya mandado lo da por atendido. Cuando escribe, empieza otro y
 * el seguimiento vuelve a estar disponible.
 */
export function correspondeSeguimiento(input: {
  ahora: number;
  esperaMinutos: number;
  /** El último mensaje del chat, sea de quien sea. */
  ultimoMensaje: { deElContacto: boolean; en: number } | null;
  /** La última vez que habló el contacto. Null si nunca escribió. */
  ultimoMensajeDelContacto: number | null;
  /** Cuándo se anotó la última corrida de esta automatización. Null si ninguna. */
  ultimaCorrida: number | null;
}): boolean {
  const { ultimoMensaje } = input;

  // Un chat sin mensajes no tiene silencio que medir.
  if (!ultimoMensaje) return false;

  // Si el último que habló fue el contacto, no está sin responder: está
  // esperando que le respondamos nosotros.
  if (ultimoMensaje.deElContacto) return false;

  // Todavía no se cumplió la espera.
  if (ultimoMensaje.en >= input.ahora - input.esperaMinutos * 60_000) return false;

  if (input.ultimaCorrida === null) return true;

  // Un contacto que nunca escribió no tiene silencios sucesivos: el suyo es uno
  // solo, desde siempre. Con una corrida ya anotada, está atendido.
  if (input.ultimoMensajeDelContacto === null) return false;

  // La corrida es de este silencio si se anotó después de que el contacto habló
  // por última vez.
  return input.ultimaCorrida < input.ultimoMensajeDelContacto;
}

/* ------------------------------------------------------------------ reparto */

/**
 * Qué día de la semana es en la zona pedida, 0 = domingo.
 *
 * Por `Intl` y no por `getDay()` porque el día lo decide la zona del workspace:
 * a las 22 de un domingo en Buenos Aires, en UTC ya es lunes. Con el turno de
 * alguien que trabaja los lunes, la diferencia es si el lead le entra o no.
 */
export function diaLocal(instante: Date, zona: string): number {
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short" }).format(
    instante,
  );
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nombre);
  // Un nombre que no se reconoce no puede dejar a todo el mundo fuera de turno:
  // se cae al domingo, y como mucho el reparto de una vuelta sale corrido.
  return dia === -1 ? 0 : dia;
}

/** Si a esta persona le toca recibir leads en este momento. */
export function candidatoDisponible(candidato: Candidato, instante: Date, zona: string): boolean {
  if (!candidato.dias.includes(diaLocal(instante, zona))) return false;
  return dentroDeLaFranja(instante, {
    horaDesde: candidato.horaDesde,
    horaHasta: candidato.horaHasta,
    zona,
  });
}

export function disponibles(candidatos: Candidato[], instante: Date, zona: string): Candidato[] {
  return candidatos.filter((candidato) => candidatoDisponible(candidato, instante, zona));
}

/**
 * Lo que la rotación necesita saber de cada persona para decidir.
 *
 * Los tres modos leen cosas distintas y por eso vienen los tres juntos: quien
 * ejecuta consulta una sola vez y esta función no toca la base.
 */
export type EstadoDelReparto = {
  /** Cuántos leads le tocaron en el historial que se mira. */
  asignados: number;
  /** Cuándo fue el último, en milisegundos. Null si nunca le tocó. */
  ultima: number | null;
  /** Leads sin archivar que tiene ahora. */
  carga: number;
};

/**
 * A quién le toca el próximo lead.
 *
 * Los tres modos son el mismo algoritmo con distinta cuenta: se puntúa a cada
 * candidato y gana el más bajo. El empate lo define el orden de la lista, así
 * que el reparto es reproducible —dos vueltas con los mismos datos dan lo
 * mismo— y arrancar de cero reparte en el orden en que están escritos.
 *
 * Recibe ya filtrada la gente en horario: quién está disponible lo decide
 * `disponibles`, y qué hacer cuando no hay nadie es cosa de quien ejecuta.
 */
export function elegirResponsable(
  modo: ModoDeReparto,
  candidatos: Candidato[],
  estadoDe: (userId: string) => EstadoDelReparto,
): string | null {
  let elegido: Candidato | null = null;
  let mejor = Number.POSITIVE_INFINITY;

  for (const candidato of candidatos) {
    const puntos = puntaje(modo, candidato, estadoDe(candidato.userId));
    if (puntos < mejor) {
      mejor = puntos;
      elegido = candidato;
    }
  }

  return elegido?.userId ?? null;
}

function puntaje(modo: ModoDeReparto, candidato: Candidato, estado: EstadoDelReparto): number {
  switch (modo) {
    // El que hace más que no recibe. Quien nunca recibió va primero de todos,
    // que es lo que hace que alguien recién agregado entre enseguida en la
    // rotación en vez de esperar a que los demás se emparejen con él.
    case "equitativo":
      return estado.ultima ?? Number.NEGATIVE_INFINITY;
    // Leads por unidad de peso: con Lucas en 2 y Ana en 1, Lucas llega al mismo
    // puntaje recién con el doble de leads.
    case "peso":
      return estado.asignados / Math.max(candidato.peso, 1);
    case "carga":
      return estado.carga;
  }
}

/* -------------------------------------------------------------------- texto */

export type DatosDelContacto = {
  nombre: string;
  telefono: string | null;
  email: string | null;
  etapa: string | null;
  /** Sólo en un recordatorio: la cita de la que habla el mensaje. */
  cita?: DatosDeLaCita | null;
};

/**
 * La cita, ya escrita para leer.
 *
 * `fecha` y `hora` llegan armadas y no como instante a propósito: formatearlas
 * pide la zona del workspace, y traerla acá obligaría a este módulo a consultar
 * la base. Quien arma la corrida ya la tiene.
 */
export type DatosDeLaCita = {
  fecha: string;
  hora: string;
  titulo: string;
  link: string | null;
};

/** Los huecos que se pueden escribir en un texto o en el valor de una variable. */
export const TOKENS: { token: string; descripcion: string }[] = [
  { token: "{nombre}", descripcion: "Nombre del contacto" },
  { token: "{telefono}", descripcion: "Teléfono del contacto" },
  { token: "{email}", descripcion: "Email del contacto" },
  { token: "{etapa}", descripcion: "Etapa actual en el embudo" },
];

/** Los huecos que sólo tienen valor en un recordatorio de cita. */
export const TOKENS_DE_CITA: { token: string; descripcion: string }[] = [
  { token: "{fecha}", descripcion: "Fecha de la cita" },
  { token: "{hora}", descripcion: "Hora de la cita" },
  { token: "{cita}", descripcion: "Título de la cita" },
  { token: "{link}", descripcion: "Enlace de la cita (el de Calendar, o el que cargues al agendar)" },
];

/**
 * Qué hacer con un hueco que quedó sin dato.
 *
 * - `dejar`: se queda escrito tal cual —`{email}`—, que es lo que sirve en una
 *   vista previa: muestra el hueco que no se completó en vez de esconderlo.
 * - `borrar`: desaparece del texto. Es lo que corresponde al mandar: el que
 *   recibe no tiene por qué leer las llaves de un campo vacío.
 */
export type HuecoSinDato = "dejar" | "borrar";

/**
 * Completa los huecos con los datos del contacto.
 *
 * Un token que no existe —`{apellido}`— se deja escrito siempre, igual que en
 * las plantillas: borrarlo dejaría un mensaje con un agujero que nadie nota, y
 * así se ve en la vista previa antes de prender la automatización.
 *
 * Uno que existe pero no tiene dato es otra cosa, y por eso se decide desde
 * afuera. Casi todos pueden venir vacíos en el peor momento: `{link}` en una
 * cita cargada a mano sin enlace, `{etapa}` en quien reservó por Calendar y
 * nunca entró al embudo, `{email}` en cualquiera que haya llegado por WhatsApp.
 * Mandarlos escritos es mandarle al cliente un `{link}` literal.
 */
export function reemplazarTokens(
  contenido: string,
  datos: DatosDelContacto,
  sinDato: HuecoSinDato = "dejar",
): string {
  const valores: Record<string, string> = {
    nombre: datos.nombre,
    telefono: datos.telefono ?? "",
    email: datos.email ?? "",
    etapa: datos.etapa ?? "",
    fecha: datos.cita?.fecha ?? "",
    hora: datos.cita?.hora ?? "",
    cita: datos.cita?.titulo ?? "",
    link: datos.cita?.link ?? "",
  };

  if (sinDato === "dejar") {
    return contenido.replace(HUECOS, (original, clave: string) => valores[clave] || original);
  }

  // Línea por línea, porque borrar el hueco no alcanza: "Entrá por acá:\n{link}"
  // sin enlace dejaría un renglón vacío colgado y un "por acá:" que no lleva a
  // ningún lado. La línea que era sólo el hueco se va entera, y a la que queda
  // se le saca el separador que quedó sin nada atrás.
  return contenido
    .split("\n")
    .map((linea) => {
      let faltoAlguno = false;
      const escrita = linea.replace(HUECOS, (original, clave: string) => {
        const valor = valores[clave];
        if (valor) return valor;
        faltoAlguno = true;
        return "";
      });

      if (!faltoAlguno) return escrita;
      return escrita.trim() ? limpiarSobras(escrita) : null;
    })
    .filter((linea): linea is string => linea !== null)
    .join("\n");
}

/** Los huecos que el motor conoce. Cualquier otro no se toca. */
const HUECOS = /\{(nombre|telefono|email|etapa|fecha|hora|cita|link)\}/g;

/**
 * Empareja lo que dejó un hueco borrado: los dos espacios donde había uno, y el
 * `:` o el `-` que introducía algo que ya no está.
 */
function limpiarSobras(linea: string): string {
  return linea
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]*[:\-–—,]\s*$/, "")
    .trimEnd();
}

/* ---------------------------------------------------------------- validación */

export type Borrador = {
  name: string;
  disparador: Disparador | null;
  etapaRequerida: string | null;
  pasos: Paso[];
  horaDesde: number;
  horaHasta: number;
};

/** Devuelve el primer problema, o null si se puede guardar. */
export function validar(borrador: Borrador): string | null {
  // Casi todos los controles valen para cualquier paso, esté en el nivel de
  // arriba o escondido en una rama, así que se miran sobre el árbol aplanado.
  const todos = todosLosPasos(borrador.pasos);

  const nombre = borrador.name.trim();
  if (nombre.length < 1) return "Poné un nombre.";
  if (nombre.length > 60) return "El nombre es demasiado largo.";

  if (!borrador.disparador) return "Elegí qué la dispara.";
  if (borrador.disparador.tipo === "etapa" && !borrador.disparador.stageId) {
    return "Elegí la etapa del embudo.";
  }

  if (borrador.disparador.tipo === "cita") {
    if (borrador.disparador.momento === "antes" && borrador.disparador.anticipacionMinutos <= 0) {
      return "Decí cuánto antes de la cita tiene que salir.";
    }

    // La condición de etapa no es "poco útil" acá: es fatal. El que reserva por
    // Calendar entra como contacto y no como oportunidad, así que su etapa es
    // null y la corrida se cancelaría en el primer paso, sin mensaje y sin
    // error a la vista. Vale más decirlo al guardar que dejarlo descubrir por
    // los recordatorios que no llegaron.
    if (borrador.etapaRequerida) {
      return "Un recordatorio de cita no puede pedir una etapa: quien reserva por Calendar no entra al embudo, así que no se ejecutaría nunca.";
    }

    // Mover de etapa o repartir un lead que no tiene oportunidad no hace nada.
    // Se mira el árbol entero: un paso escondido en una rama rompe igual.
    const fuera = todos.find((paso) => paso.tipo === "mover" || paso.tipo === "asignar");
    if (fuera) {
      return fuera.tipo === "mover"
        ? "Un recordatorio de cita no puede mover de etapa: el contacto no tiene tarjeta en el embudo."
        : "Un recordatorio de cita no puede repartir el lead: el contacto no tiene tarjeta en el embudo.";
    }
  }

  // Entrar en una columna y tener que estar en otra no pasa nunca: la corrida
  // se programaría para cancelarse en el primer paso. Es más fácil de entender
  // acá que mirando por qué una automatización prendida no manda nada.
  if (
    borrador.disparador.tipo === "etapa" &&
    borrador.etapaRequerida &&
    borrador.etapaRequerida !== borrador.disparador.stageId
  ) {
    return "El disparador entra en una etapa y la condición pide otra: así no se ejecuta nunca.";
  }

  if (borrador.pasos.length === 0) return "Agregá al menos un paso.";
  if (todos.length > MAX_PASOS) {
    return `No puede tener más de ${MAX_PASOS} pasos contando los de todas las ramas.`;
  }
  if (profundidadDe(borrador.pasos) > MAX_PROFUNDIDAD) {
    return `No se pueden anidar más de ${MAX_PROFUNDIDAD} condiciones.`;
  }

  // Las dos cosas que el lector le descarta a una condición, dichas acá para
  // que no se guarde una automatización con un paso menos del que se ve.
  const condicion = todos.find(
    (paso) =>
      paso.tipo === "condicion" &&
      ((paso.siSi.length === 0 && paso.siNo.length === 0) ||
        (paso.prueba.tipo === "etapa" && paso.prueba.stageIds.length === 0)),
  );
  if (condicion?.tipo === "condicion") {
    return condicion.prueba.tipo === "etapa" && condicion.prueba.stageIds.length === 0
      ? "Hay una condición de etapa sin ninguna etapa elegida."
      : "Hay una condición sin pasos en ninguna de las dos ramas: no decide nada.";
  }

  // El paso queda armado sin archivo mientras se graba: guardarlo así lo haría
  // desaparecer, porque el lector lo descarta.
  if (todos.some((paso) => paso.tipo === "audio" && !paso.url)) {
    return "Hay un paso de audio vacío: grabalo o subí un archivo.";
  }

  // Un reparto sin nadie no reparte, y el lector lo descarta entero: se
  // guardaría una automatización con un paso menos del que se ve en pantalla.
  const reparto = todos.find((paso) => paso.tipo === "asignar");
  if (reparto?.tipo === "asignar") {
    if (reparto.candidatos.length === 0) {
      return "Hay un paso de reparto sin nadie: elegí al menos un usuario.";
    }
    if (reparto.candidatos.some((candidato) => !candidato.userId)) {
      return "Hay un usuario del reparto sin elegir.";
    }
    if (reparto.candidatos.some((candidato) => candidato.dias.length === 0)) {
      return "Hay un usuario del reparto sin días: marcale al menos uno.";
    }
  }

  // Una secuencia que termina esperando no hace nada: el último paso siempre
  // tiene que ser algo que pase. Con ramas hay un final por camino, y una
  // espera colgada al final de una sola de ellas es igual de inútil.
  const colgada = esperaAlFinal(borrador.pasos, []);
  if (colgada) {
    return borrador.pasos.length === colgada.length
      ? "El último paso es una espera: agregá qué hacer después."
      : `Una rama termina en una espera (${describirRuta(colgada)}): agregá qué hacer después, o sacala.`;
  }

  if (borrador.horaDesde >= borrador.horaHasta) {
    return "La hora de inicio tiene que ser anterior a la de fin.";
  }

  return null;
}

/**
 * La primera espera que quedó al final de un camino, o null si no hay ninguna.
 *
 * Una lista vacía no cuenta: una rama sin pasos no termina la secuencia, la
 * devuelve a lo que venga después de la condición.
 */
function esperaAlFinal(lista: Paso[], prefijo: Ruta): Ruta | null {
  const indice = lista.length - 1;
  const ultimo = lista[indice];
  if (!ultimo) return null;

  const ruta: Ruta = [...prefijo, indice];
  if (ultimo.tipo === "esperar") return ruta;
  if (ultimo.tipo !== "condicion") return null;

  return (
    esperaAlFinal(ultimo.siSi, [...ruta, "si"]) ?? esperaAlFinal(ultimo.siNo, [...ruta, "no"])
  );
}

/**
 * Minutos desde el disparo hasta cada paso.
 *
 * Sirve para avisar en la pantalla cuáles caen fuera de la ventana de 24 horas
 * de WhatsApp, donde el texto libre ya no sale y sólo entra una plantilla.
 */
export function minutosHastaCadaPaso(disparador: Disparador | null, pasos: Paso[]): number[] {
  const porRuta = minutosPorRuta(disparador, pasos);
  return pasos.map((_, indice) => porRuta.get(String(indice)) ?? 0);
}

/**
 * Lo mismo pero para el árbol entero, indexado por ruta escrita.
 *
 * Después de una condición las dos ramas pueden haber esperado distinto, así
 * que lo que sigue se cuenta con la más lenta. Es el número que corresponde:
 * lo único que se hace con esto es avisar que un paso puede quedar fuera de
 * las 24 horas, y ahí lo que importa es el peor camino, no el promedio.
 */
export function minutosPorRuta(
  disparador: Disparador | null,
  pasos: Paso[],
): Map<string, number> {
  const salida = new Map<string, number>();
  acumularMinutos(pasos, [], disparador?.esperaMinutos ?? 0, salida);
  return salida;
}

/** Devuelve los minutos acumulados al final de la lista. */
function acumularMinutos(
  lista: Paso[],
  prefijo: Ruta,
  inicial: number,
  salida: Map<string, number>,
): number {
  let acumulado = inicial;

  for (let indice = 0; indice < lista.length; indice += 1) {
    const paso = lista[indice];
    const ruta: Ruta = [...prefijo, indice];

    if (paso.tipo === "esperar") acumulado += paso.minutos;
    salida.set(escribirRuta(ruta), acumulado);

    if (paso.tipo === "condicion") {
      const porSi = acumularMinutos(paso.siSi, [...ruta, "si"], acumulado, salida);
      const porNo = acumularMinutos(paso.siNo, [...ruta, "no"], acumulado, salida);
      acumulado = Math.max(porSi, porNo);
    }
  }

  return acumulado;
}

/**
 * La ventana de Meta: 24 horas desde el último mensaje de la persona.
 *
 * No es de WhatsApp solamente, aunque el nombre venga de ahí. Instagram y
 * Messenger tienen la misma, y ésos además no tienen plantillas con las que
 * saltearla: pasado el plazo no hay forma de escribir primero.
 */
export const VENTANA_WHATSAPP_MINUTOS = 24 * 60;

/** Cuántos minutos del día la franja tiene cerrado el envío. */
export function minutosCerrados(franja: { horaDesde: number; horaHasta: number }): number {
  // Invertida o vacía se lee como "a cualquier hora", igual que al enviar.
  if (franja.horaDesde >= franja.horaHasta) return 0;
  return 1440 - (franja.horaHasta - franja.horaDesde);
}

/**
 * Lo más tarde que puede salir un paso que toca a los `minutos` del disparo.
 *
 * Un paso que cae fuera de la franja no se pierde: espera a que abra. Eso lo
 * demora hasta una noche entera, y esa demora también cuenta contra la ventana
 * de 24 horas. Es de una sola noche por más larga que sea la espera: una vez
 * que abre, sale.
 */
export function peorDemora(
  minutos: number,
  franja: { horaDesde: number; horaHasta: number },
): number {
  return minutos + minutosCerrados(franja);
}

/**
 * Un paso que manda un mensaje libre y cae fuera de la ventana no va a salir.
 *
 * Se mira con la franja puesta y no con la espera pelada, porque lo que decide
 * es cuándo sale de verdad. Un follow-up de 20 horas entra en las 24 sobre el
 * papel y no entra si la espera se cumple de madrugada y tiene que aguantar
 * hasta que abra.
 */
export function pasoFueraDeLaVentana(
  paso: Paso,
  minutos: number,
  franja: { horaDesde: number; horaHasta: number } = { horaDesde: 0, horaHasta: 0 },
): boolean {
  // El audio entra acá igual que el texto: no existe la plantilla de audio,
  // así que pasadas las 24 horas no hay forma de mandarlo por ningún canal.
  if (paso.tipo !== "texto" && paso.tipo !== "ia" && paso.tipo !== "audio") return false;
  return peorDemora(minutos, franja) >= VENTANA_WHATSAPP_MINUTOS;
}

/* ----------------------------------------------------------------- etiquetas */

export function describirEspera(minutos: number): string {
  if (minutos <= 0) return "al instante";
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const horas = minutos / 60;
    return `${redondear(horas)} h`;
  }
  return `${redondear(minutos / 1440)} d`;
}

function redondear(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
}

/* ------------------------------------------- reintentar lo que no salió */

/**
 * Cuánto esperar antes de volver a intentar un envío que falló.
 *
 * Hasta acá un envío fallido se daba por perdido en el primer intento, y el
 * modo de fallar más común no es un error de configuración sino un rato de
 * nada: WhatsApp Web desconectado, el celular sin señal, la API reiniciándose.
 * Perder un recordatorio por treinta segundos de eso es caro y silencioso.
 *
 * La espera crece para cubrir cortes cada vez más largos sin insistirle a algo
 * que claramente no está. El total llega a poco más de una hora, y ahí se
 * abandona: más que eso ya no es un problema de red, es un problema que hay que
 * ir a mirar.
 *
 * No hace falta distinguir un error pasajero de uno definitivo. Al que no tiene
 * arreglo lo único que le pasa es que tarda una hora en darse por muerto, y a
 * cambio no hay que adivinar qué significa cada mensaje de error de tres
 * proveedores distintos. Un recordatorio, además, tiene su propio freno: si la
 * cita ya empezó se cancela en vez de salir, así que un reintento tardío nunca
 * termina en un aviso inútil.
 */
export const ESPERAS_DEL_REINTENTO_MINUTOS = [5, 15, 45] as const;

/**
 * Los minutos que faltan esperar, o null si ya no hay que reintentar.
 *
 * `intentos` es cuántas veces ya se intentó, contando el que acaba de fallar.
 */
export function esperaDelReintento(intentos: number): number | null {
  if (!Number.isFinite(intentos) || intentos < 1) return ESPERAS_DEL_REINTENTO_MINUTOS[0];
  return ESPERAS_DEL_REINTENTO_MINUTOS[intentos - 1] ?? null;
}

/* -------------------------------------- si los recordatorios están vivos */

/**
 * Cuánto silencio de Calendar deja de ser una semana tranquila.
 *
 * No hay forma de distinguir "no hubo reservas" de "n8n se cayó" mirando sólo
 * el CRM, así que el número no marca un error: marca el punto donde vale la
 * pena ir a mirar. Dos semanas es holgado a propósito, porque un cartel que se
 * prende por nada se aprende a ignorar y entonces no sirve para el día que sí.
 */
export const SILENCIO_SOSPECHOSO_DIAS = 14;

/**
 * Cuánto se le da al barrido antes de contar una cita como desatendida.
 *
 * Una cita que entró hace diez segundos todavía no pasó por ningún barrido, y
 * contarla como problema sería acusar al reloj de no haber hecho algo que
 * todavía no le tocaba. Con el cron cada cinco minutos, veinte son cuatro
 * vueltas: si en cuatro vueltas no se anotó, no es que llegó tarde.
 */
export const GRACIA_DEL_BARRIDO_MINUTOS = 20;

/**
 * Si una corrida pendiente ya tendría que haber salido y nadie la atendió.
 *
 * Es la misma señal que la de las citas, mirada desde la lista de
 * automatizaciones: sin esto una corrida trabada se mostraba como "en curso",
 * en verde, igual que una que espera tranquila sus 24 horas, y el lead quedaba
 * sin dueño sin que la pantalla dijera nada.
 *
 * Ninguna espera legítima deja `corre_en` en el pasado: la reserva lo corre
 * hacia adelante, un reintento también, y lo que cae fuera de la franja se
 * anota para cuando abra. Vencida hace más que la gracia, sólo queda que el
 * reloj no pasó.
 */
export function corridaAtrasada(correEn: unknown, ahora: number): boolean {
  if (typeof correEn !== "string") return false;
  const corre = new Date(correEn).getTime();
  return Number.isFinite(corre) && corre < ahora - GRACIA_DEL_BARRIDO_MINUTOS * 60_000;
}

export type EstadoDeRecordatorios = {
  /** Cuántos recordatorios hay prendidos. */
  prendidos: number;
  /** `updated_at` de la última cita que bajó de Calendar. Null si no bajó ninguna. */
  ultimoAviso: string | null;
  /** Citas de Calendar que vienen y siguen en pie. */
  citasProximas: number;
  /**
   * Citas próximas sin ninguna corrida anotada, ya pasado el tiempo de gracia.
   *
   * Es el número que importa. Una corrida se anota en el primer barrido, con su
   * hora en el futuro; que una cita vieja siga sin ninguna significa que el
   * barrido no corrió, y el barrido es el cron.
   */
  desatendidas: number;
  /**
   * De las próximas, cuántas se alcanzaron a revisar.
   *
   * Una cita recién bajada todavía no pasó por ningún barrido, así que no se
   * le puede reclamar una corrida —ni afirmar que la tiene—. Separar el número
   * de las revisadas es lo que deja al cartel decir lo que sabe: sin esto
   * anunciaba "con su aviso anotado" sobre citas que nunca miró.
   */
  revisadas: number;
};

export type Diagnostico = {
  nivel: "ok" | "aviso" | "alarma";
  mensaje: string;
};

/**
 * Traduce el estado a una frase, y a un color.
 *
 * Existe porque la forma en que este sistema falla es en silencio: n8n deja de
 * avisar, o el cron no está programado, y desde el CRM se ve exactamente igual
 * que una semana sin reservas. Nadie se entera hasta que un cliente no recibió
 * el recordatorio, que es el momento más caro para enterarse.
 *
 * El orden de los casos es el orden en que hay que arreglarlos, y sólo el
 * primero es una alarma: es el único que no admite otra explicación.
 */
export function diagnosticarRecordatorios(
  estado: EstadoDeRecordatorios,
  ahora = Date.now(),
): Diagnostico {
  // Citas encoladas sin corrida es lo único que no tiene lectura inocente: el
  // barrido las habría anotado. Apunta al reloj, que es lo que hay que ir a ver.
  if (estado.desatendidas > 0) {
    return {
      nivel: "alarma",
      mensaje:
        `${estado.desatendidas === 1 ? "Hay una cita próxima" : `Hay ${estado.desatendidas} citas próximas`} ` +
        "sin ningún aviso anotado. Suele ser que el reloj de las automatizaciones no está corriendo.",
    };
  }

  if (estado.prendidos === 0) {
    return { nivel: "aviso", mensaje: "No hay ningún recordatorio prendido: no se manda nada." };
  }

  // Que todavía no haya bajado ninguna cita no dice nada: es igual de cierto
  // con n8n roto que con nadie que haya reservado, y no hay forma de saber cuál
  // desde acá. Un aviso que casi siempre es inocente enseña a ignorar el color,
  // y entonces el día que pase algo de verdad tampoco se mira. El silencio sí
  // se vigila, pero recién cuando hubo una primera cita: ahí el contraste entre
  // "bajaban" y "dejaron de bajar" es lo que hace la señal.
  if (!estado.ultimoAviso) {
    return { nivel: "ok", mensaje: "Funcionando. No hay citas próximas." };
  }

  const silencio = ahora - new Date(estado.ultimoAviso).getTime();
  if (Number.isFinite(silencio) && silencio > SILENCIO_SOSPECHOSO_DIAS * 24 * 60 * 60_000) {
    return {
      nivel: "aviso",
      mensaje:
        "Hace más de dos semanas que no baja una cita de Calendar. Puede que no haya reservas, " +
        "o que n8n haya dejado de avisar.",
    };
  }

  if (estado.citasProximas === 0) {
    return { nivel: "ok", mensaje: "Funcionando. No hay citas próximas." };
  }

  const cuantas =
    estado.citasProximas === 1 ? "1 cita próxima" : `${estado.citasProximas} citas próximas`;

  // "Con su aviso anotado" es una afirmación, y sólo se puede hacer sobre lo
  // que se miró. Si todas las próximas son más nuevas que el tiempo de gracia
  // no se revisó ninguna, y el cartel se limita a contarlas.
  return {
    nivel: "ok",
    mensaje:
      estado.revisadas === 0 ? `Funcionando. ${cuantas}.` : `Funcionando. ${cuantas} con su aviso anotado.`,
  };
}
