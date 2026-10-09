/**
 * Dónde va dibujado cada paso del árbol.
 *
 * El módulo no sabe de React ni de SVG: recibe la secuencia y devuelve
 * coordenadas. Esa separación es la que permite probar acá lo que mirando la
 * pantalla sólo se ve como "quedó torcido": que dos ramas no se pisen, que la
 * línea que sale de una rama termine en el paso que de verdad sigue, y que un
 * camino que no continúa tenga su marca de fin.
 *
 * Todo en píxeles y con el eje y para abajo, como el DOM.
 */

import { escribirRuta, type Paso, type Rama, type Ruta } from "./automatizaciones.ts";

/** Lo que mide una tarjeta de paso. */
export const ANCHO_NODO = 216;
export const ALTO_NODO = 60;

/**
 * El ancho que se reserva para una rama aunque tenga un solo paso.
 *
 * Es más que el nodo a propósito: dos ramas pegadas por el borde de sus
 * tarjetas se leen como una sola columna.
 */
export const COLUMNA = 256;

/** Del tope de un nodo al tope del que le sigue. Lo que sobra es la línea. */
export const FILA = 144;

/** Aire entre dos ramas hermanas. */
export const SEPARACION = 40;

/** Margen alrededor de todo el dibujo. */
export const MARGEN = 48;

export type Punto = { x: number; y: number };

export type NodoPuesto = {
  clave: string;
  ruta: Ruta;
  paso: Paso;
  /** Centro horizontal: la tarjeta se dibuja centrada acá. */
  x: number;
  /** Borde de arriba de la tarjeta. */
  y: number;
};

export type AristaPuesta = {
  clave: string;
  desde: Punto;
  hasta: Punto;
  /** "Sí" o "No" cuando la línea entra en una rama. */
  etiqueta: string | null;
  rama: Rama | null;
  /** Dónde cae un paso nuevo si se toca el `+` de esta línea. Null: sin `+`. */
  insertar: Ruta | null;
};

/**
 * El pie de un camino.
 *
 * `fin` separa los dos casos que se ven distinto: un camino que se termina
 * lleva la marca de FIN, y una cadena que terminó en una condición —donde las
 * que se terminan son las ramas, cada una con su propia marca— lleva sólo el
 * `+`, para poder agregar algo después de la condición.
 */
export type FinalPuesto = {
  clave: string;
  x: number;
  y: number;
  insertar: Ruta;
  fin: boolean;
};

export type Plano = {
  nodos: NodoPuesto[];
  aristas: AristaPuesta[];
  finales: FinalPuesto[];
  ancho: number;
  alto: number;
  /** Dónde va la tarjeta del disparador, arriba de todo. */
  raiz: Punto;
};

/**
 * Cuánto ocupa una cadena de pasos.
 *
 * El ancho es el de la rama más ancha que haya adentro, nunca menos de una
 * columna. El alto es una fila por paso más, en cada condición, lo que mida la
 * más alta de sus dos ramas: las dos arrancan a la misma altura y lo que sigue
 * va debajo de la más larga.
 */
export function medir(lista: Paso[]): { ancho: number; alto: number } {
  let ancho = COLUMNA;
  let alto = 0;

  for (const paso of lista) {
    alto += FILA;
    if (paso.tipo !== "condicion") continue;

    const si = medir(paso.siSi);
    const no = medir(paso.siNo);
    ancho = Math.max(ancho, si.ancho + SEPARACION + no.ancho);
    alto += Math.max(si.alto, no.alto);
  }

  return { ancho, alto };
}

type Acumulador = Pick<Plano, "nodos" | "aristas" | "finales">;

export function disponer(pasos: Paso[]): Plano {
  const medida = medir(pasos);
  const raiz: Punto = { x: MARGEN + medida.ancho / 2, y: MARGEN };
  const acc: Acumulador = { nodos: [], aristas: [], finales: [] };

  tender({
    lista: pasos,
    prefijo: [],
    cx: raiz.x,
    arriba: raiz.y + FILA,
    // La primera línea baja del disparador.
    entrada: { x: raiz.x, y: raiz.y + ALTO_NODO },
    etiqueta: null,
    rama: null,
    salida: null,
    acc,
  });

  return {
    ...acc,
    ancho: medida.ancho + MARGEN * 2,
    // La fila del disparador, lo que mida el árbol, y lugar para la marca de
    // fin que cuelga del último paso.
    alto: raiz.y + FILA + medida.alto + ALTO_NODO + MARGEN,
    raiz,
  };
}

/**
 * Pone una cadena de pasos y, en cada condición, sus dos ramas.
 *
 * `entrada` es de dónde baja la línea que llega al primer paso, y `salida` a
 * dónde desemboca la cadena cuando se termina: el paso que sigue en el nivel
 * de arriba, o null si no sigue nada y corresponde una marca de fin.
 *
 * Una lista vacía no es un caso aparte y por eso no lo tiene: el bucle no
 * corre, y la línea de entrada se conecta directo a la salida. Eso es
 * exactamente lo que hace una rama vacía —no desvía nada y la secuencia sigue
 * derecho—, dibujado.
 */
function tender({
  lista,
  prefijo,
  cx,
  arriba,
  entrada,
  etiqueta,
  rama,
  salida,
  acc,
}: {
  lista: Paso[];
  prefijo: Ruta;
  cx: number;
  arriba: number;
  entrada: Punto;
  etiqueta: string | null;
  rama: Rama | null;
  salida: Punto | null;
  acc: Acumulador;
}): void {
  // De dónde sale la próxima línea. Null después de una condición: al paso que
  // sigue le llegan las líneas de las dos ramas, y la cadena no le dibuja otra
  // encima.
  let desde: Punto | null = entrada;
  let rotulo = etiqueta;
  let deRama = rama;
  let y = arriba;

  for (let indice = 0; indice < lista.length; indice += 1) {
    const paso = lista[indice];
    const ruta: Ruta = [...prefijo, indice];
    const clave = escribirRuta(ruta);

    if (desde) {
      acc.aristas.push({
        clave: `linea:${clave}`,
        desde,
        hasta: { x: cx, y },
        etiqueta: rotulo,
        rama: deRama,
        insertar: ruta,
      });
      rotulo = null;
      deRama = null;
    } else {
      // A este paso le llegan las líneas de las dos ramas de la condición de
      // arriba, así que no tiene una línea propia donde colgar el `+`. Sin
      // esto no habría forma de meter un paso entre la condición y lo que
      // sigue: las dos líneas que llegan insertan cada una adentro de su rama.
      acc.finales.push({
        clave: `mas:${clave}`,
        x: cx,
        y: y - 22,
        insertar: ruta,
        fin: false,
      });
    }

    acc.nodos.push({ clave, ruta, paso, x: cx, y });
    const abajo: Punto = { x: cx, y: y + ALTO_NODO };

    if (paso.tipo !== "condicion") {
      desde = abajo;
      y += FILA;
      continue;
    }

    const mSi = medir(paso.siSi);
    const mNo = medir(paso.siNo);
    const izquierda = cx - (mSi.ancho + SEPARACION + mNo.ancho) / 2;
    const yRamas = y + FILA;
    const yDespues = yRamas + Math.max(mSi.alto, mNo.alto);

    // Las dos ramas desembocan en lo que venga después de la condición. Si no
    // viene nada, heredan la salida de la cadena: cada una termina donde
    // habría terminado la secuencia entera.
    const reunion: Punto | null =
      indice + 1 < lista.length ? { x: cx, y: yDespues } : salida;

    tender({
      lista: paso.siSi,
      prefijo: [...ruta, "si"],
      cx: izquierda + mSi.ancho / 2,
      arriba: yRamas,
      entrada: abajo,
      etiqueta: "Sí",
      rama: "si",
      salida: reunion,
      acc,
    });

    tender({
      lista: paso.siNo,
      prefijo: [...ruta, "no"],
      cx: izquierda + mSi.ancho + SEPARACION + mNo.ancho / 2,
      arriba: yRamas,
      entrada: abajo,
      etiqueta: "No",
      rama: "no",
      salida: reunion,
      acc,
    });

    desde = null;
    y = yDespues;
  }

  const alFinal: Ruta = [...prefijo, lista.length];

  if (!desde) {
    // La cadena terminó en una condición: las marcas de fin son de las ramas.
    // Queda el `+` para poder agregar algo después de ella.
    acc.finales.push({
      clave: `mas:${escribirRuta(alFinal)}`,
      x: cx,
      y,
      insertar: alFinal,
      fin: false,
    });
    return;
  }

  if (salida) {
    acc.aristas.push({
      clave: `linea:fin:${escribirRuta(alFinal)}`,
      desde,
      hasta: salida,
      etiqueta: rotulo,
      rama: deRama,
      insertar: alFinal,
    });
    return;
  }

  // El camino se termina acá. La línea hasta la marca no lleva `+`: el de
  // agregar al final lo pone la marca misma.
  acc.aristas.push({
    clave: `linea:fin:${escribirRuta(alFinal)}`,
    desde,
    hasta: { x: cx, y },
    etiqueta: rotulo,
    rama: deRama,
    insertar: null,
  });

  acc.finales.push({
    clave: `fin:${escribirRuta(alFinal)}`,
    x: cx,
    y,
    insertar: alFinal,
    fin: true,
  });
}

/**
 * El camino de una línea, en coordenadas de SVG.
 *
 * Dos tramos verticales unidos por uno horizontal a media altura, que es como
 * se dibuja un árbol: una diagonal entre dos ramas lejanas cruza por encima de
 * las tarjetas del medio.
 */
export function camino(desde: Punto, hasta: Punto): string {
  if (Math.abs(desde.x - hasta.x) < 1) return `M ${desde.x} ${desde.y} V ${hasta.y}`;

  const medio = desde.y + (hasta.y - desde.y) / 2;
  const radio = Math.min(12, Math.abs(hasta.x - desde.x) / 2, Math.abs(hasta.y - desde.y) / 4);
  const hacia = hasta.x > desde.x ? 1 : -1;

  // Las esquinas van redondeadas: en ángulo recto, con dos ramas que arrancan
  // del mismo punto, las líneas se ven como una grilla y no como un árbol.
  return [
    `M ${desde.x} ${desde.y}`,
    `V ${medio - radio}`,
    `Q ${desde.x} ${medio} ${desde.x + radio * hacia} ${medio}`,
    `H ${hasta.x - radio * hacia}`,
    `Q ${hasta.x} ${medio} ${hasta.x} ${medio + radio}`,
    `V ${hasta.y}`,
  ].join(" ");
}

/**
 * Dónde va el `+` de una línea: en el medio, que es donde la línea es suya.
 *
 * No arriba del nodo al que llega, que sería lo obvio: a un paso que viene
 * después de una condición le llegan las dos ramas, y las dos pondrían su `+`
 * en el mismo punto. Quedarían dos botones encimados que insertan en ramas
 * distintas, y el de abajo no se puede ni tocar.
 *
 * En el medio del tramo horizontal cada línea tiene su propia x —las dos ramas
 * salen hacia lados opuestos— y las que bajan derecho se separan por la y.
 */
export function puntoDelMas(arista: AristaPuesta): Punto {
  return {
    x: (arista.desde.x + arista.hasta.x) / 2,
    y: arista.desde.y + (arista.hasta.y - arista.desde.y) / 2,
  };
}

/**
 * Dónde va la pastilla "Sí"/"No": arriba de la curva, en la columna de la rama.
 *
 * Separada del `+` a mano porque en una rama vacía la línea baja derecho y los
 * dos caen en el mismo lugar: la pastilla desaparecía abajo del botón.
 */
export function puntoDeLaEtiqueta(arista: AristaPuesta): Punto {
  const medio = arista.desde.y + (arista.hasta.y - arista.desde.y) / 2;
  return { x: arista.hasta.x, y: medio - 22 };
}
