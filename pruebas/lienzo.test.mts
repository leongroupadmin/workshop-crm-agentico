/**
 * Pruebas del dibujo del árbol de automatizaciones.
 *
 * Lo que se cuida acá es lo que en pantalla sólo se ve como "quedó torcido" y
 * no se puede afirmar mirando: que dos ramas no se superpongan, que la línea
 * que sale de una rama termine en el paso que de verdad sigue, y que el `+` de
 * cada línea inserte en la posición que está debajo y no en otra.
 *
 * Un `+` que inserta en la rama equivocada se ve igual de prolijo que uno que
 * anda, y el error recién aparece cuando la automatización le escribe a un
 * cliente por el camino que no era.
 */
import assert from "node:assert";
import { test } from "node:test";

import { escribirRuta, type Paso } from "../src/lib/automatizaciones.ts";
import {
  ANCHO_NODO,
  disponer,
  FILA,
  medir,
  puntoDeLaEtiqueta,
  puntoDelMas,
  type NodoPuesto,
  type Plano,
} from "../src/lib/automatizaciones-lienzo.ts";

const A: Paso = { tipo: "texto", texto: "A" };
const B: Paso = { tipo: "texto", texto: "B" };
const C: Paso = { tipo: "texto", texto: "C" };
const D: Paso = { tipo: "texto", texto: "D" };

function condicion(siSi: Paso[], siNo: Paso[]): Paso {
  return { tipo: "condicion", prueba: { tipo: "ventana" }, siSi, siNo };
}

function nodo(plano: Plano, ruta: string): NodoPuesto {
  const puesto = plano.nodos.find((n) => n.clave === ruta);
  assert.ok(puesto, `falta el nodo ${ruta}`);
  return puesto;
}

/* ------------------------------------------------------------------- medir */

test("una cadena sin ramas ocupa una columna y una fila por paso", () => {
  assert.equal(medir([A, B, C]).alto, FILA * 3);
  assert.equal(medir([]).alto, 0);
  // Una rama vacía igual reserva su columna: ahí va la pastilla y la marca.
  assert.ok(medir([]).ancho > 0);
});

test("una condición ensancha lo suyo y suma la rama más alta", () => {
  const sola = medir([A]);
  const conRamas = medir([condicion([A, B], [C])]);

  assert.ok(conRamas.ancho > sola.ancho);
  // Una fila para la condición más las dos filas de la rama más larga.
  assert.equal(conRamas.alto, FILA * 3);
});

/* ------------------------------------------------------------------ nodos */

test("una cadena sin ramas baja derecha", () => {
  const plano = disponer([A, B, C]);

  const uno = nodo(plano, "0");
  const dos = nodo(plano, "1");
  const tres = nodo(plano, "2");

  assert.equal(uno.x, dos.x);
  assert.equal(dos.x, tres.x);
  assert.equal(dos.y - uno.y, FILA);
  assert.equal(tres.y - dos.y, FILA);
});

test("el disparador queda arriba de todo y centrado con el primer paso", () => {
  const plano = disponer([A]);
  assert.equal(plano.raiz.x, nodo(plano, "0").x);
  assert.ok(plano.raiz.y < nodo(plano, "0").y);
});

test("las dos ramas arrancan a la misma altura y en columnas distintas", () => {
  const plano = disponer([condicion([A], [B])]);

  const si = nodo(plano, "0.si.0");
  const no = nodo(plano, "0.no.0");

  assert.equal(si.y, no.y);
  // El sí va a la izquierda.
  assert.ok(si.x < no.x);
});

test("dos ramas no se pisan, ni con otra condición adentro", () => {
  // La rama del sí tiene adentro su propia condición, así que es más ancha que
  // una columna: sin medirla, la del no le quedaría encima.
  const plano = disponer([condicion([condicion([A], [B])], [C]), D]);

  const izquierda = plano.nodos.filter((n) => n.clave.startsWith("0.si"));
  const derecha = plano.nodos.filter((n) => n.clave.startsWith("0.no"));

  const masDerecha = Math.max(...izquierda.map((n) => n.x + ANCHO_NODO / 2));
  const masIzquierda = Math.min(...derecha.map((n) => n.x - ANCHO_NODO / 2));

  assert.ok(masDerecha < masIzquierda, "las ramas se superponen");
});

test("lo que sigue a una condición queda centrado y debajo de las dos ramas", () => {
  const plano = disponer([condicion([A, B], [C]), D]);

  const laCondicion = nodo(plano, "0");
  const despues = nodo(plano, "3".replace("3", "1"));

  assert.equal(despues.x, laCondicion.x);
  for (const rama of plano.nodos.filter((n) => n.clave.includes("."))) {
    assert.ok(despues.y > rama.y, "el paso de después pisa una rama");
  }
});

/* ----------------------------------------------------------------- líneas */

test("a cada paso le llega una línea", () => {
  const plano = disponer([condicion([A, B], [C]), D]);

  for (const puesto of plano.nodos) {
    const llega = plano.aristas.some(
      (a) => a.hasta.x === puesto.x && a.hasta.y === puesto.y,
    );
    assert.ok(llega, `el nodo ${puesto.clave} quedó suelto`);
  }
});

test("las dos ramas desembocan en el paso que sigue", () => {
  const plano = disponer([condicion([A], [B]), D]);
  const despues = nodo(plano, "1");

  const entran = plano.aristas.filter(
    (a) => a.hasta.x === despues.x && a.hasta.y === despues.y,
  );

  // Una por rama, y ninguna directa desde la condición.
  assert.equal(entran.length, 2);
});

test("una rama vacía va directo al paso que sigue, con su etiqueta", () => {
  const plano = disponer([condicion([A], []), D]);
  const despues = nodo(plano, "1");

  const delNo = plano.aristas.find(
    (a) => a.rama === "no" && a.hasta.x === despues.x && a.hasta.y === despues.y,
  );

  assert.ok(delNo, "la rama vacía no llega a ningún lado");
  assert.equal(delNo?.etiqueta, "No");
});

test("las etiquetas de rama salen una sola vez, en la línea de entrada", () => {
  const plano = disponer([condicion([A, B], [C])]);

  assert.equal(plano.aristas.filter((a) => a.etiqueta === "Sí").length, 1);
  assert.equal(plano.aristas.filter((a) => a.etiqueta === "No").length, 1);
  // La segunda de la rama del sí ya no la lleva.
  const segunda = plano.aristas.find((a) => a.clave === "linea:0.si.1");
  assert.equal(segunda?.etiqueta, null);
});

/* ------------------------------------------------------------- fin y el + */

test("un camino que se termina lleva su marca de fin", () => {
  const plano = disponer([A, B]);
  const finales = plano.finales.filter((f) => f.fin);

  assert.equal(finales.length, 1);
  assert.deepEqual(finales[0].insertar, [2]);
});

test("una condición al final deja una marca de fin por rama", () => {
  const plano = disponer([A, condicion([B], [C])]);

  assert.equal(plano.finales.filter((f) => f.fin).length, 2);
  // Y un `+` suelto para poder agregar algo después de la condición.
  const suelto = plano.finales.find((f) => !f.fin);
  assert.ok(suelto);
  assert.deepEqual(suelto?.insertar, [2]);
});

test("el + de cada línea inserta justo arriba del paso al que llega", () => {
  const plano = disponer([condicion([A, B], [C]), D]);

  const aB = plano.aristas.find((a) => a.clave === "linea:0.si.1");
  assert.deepEqual(aB?.insertar, [0, "si", 1]);

  // A D le llegan las dos ramas, así que su `+` no va sobre una línea —cada
  // una insertaría adentro de su rama— sino suelto, justo arriba suyo.
  const aD = plano.finales.find((f) => f.clave === "mas:1");
  assert.deepEqual(aD?.insertar, [1]);
  assert.equal(aD?.fin, false);

  const aLaCondicion = plano.aristas.find((a) => a.clave === "linea:0");
  assert.deepEqual(aLaCondicion?.insertar, [0]);
});

test("el + de una rama vacía inserta adentro de la rama", () => {
  const plano = disponer([condicion([A], []), D]);

  const delNo = plano.aristas.find((a) => a.rama === "no");
  assert.deepEqual(delNo?.insertar, [0, "no", 0]);
});

test("la línea que llega a una marca de fin no lleva +", () => {
  // El de agregar al final lo pone la marca, y dos `+` pegados uno arriba del
  // otro insertarían en la misma posición.
  const plano = disponer([A]);
  const aLaMarca = plano.aristas.find((a) => a.clave.startsWith("linea:fin:"));

  assert.equal(aLaMarca?.insertar, null);
});

/* ------------------------------------------------------------------ tamaño */

test("el dibujo entra entero en el tamaño declarado", () => {
  const plano = disponer([condicion([condicion([A], [B])], [C]), D]);

  for (const puesto of plano.nodos) {
    assert.ok(puesto.x - ANCHO_NODO / 2 >= 0, `${puesto.clave} se sale por la izquierda`);
    assert.ok(puesto.x + ANCHO_NODO / 2 <= plano.ancho, `${puesto.clave} se sale por la derecha`);
    assert.ok(puesto.y < plano.alto, `${puesto.clave} se sale por abajo`);
  }

  for (const final of plano.finales) {
    assert.ok(final.y <= plano.alto, "una marca de fin queda fuera del dibujo");
  }
});

test("una secuencia vacía no rompe el dibujo", () => {
  const plano = disponer([]);

  assert.deepEqual(plano.nodos, []);
  assert.equal(plano.finales.length, 1);
  assert.deepEqual(plano.finales[0].insertar, [0]);
  assert.ok(plano.alto > 0);
});

test("las claves no se repiten", () => {
  const plano = disponer([condicion([A, B], [C]), D]);

  const claves = [
    ...plano.nodos.map((n) => n.clave),
    ...plano.aristas.map((a) => a.clave),
    ...plano.finales.map((f) => f.clave),
  ];

  assert.equal(new Set(claves).size, claves.length, "hay claves repetidas");
});

test("la clave de un nodo es su ruta escrita", () => {
  const plano = disponer([condicion([A], [B])]);
  for (const puesto of plano.nodos) {
    assert.equal(puesto.clave, escribirRuta(puesto.ruta));
  }
});

/* ------------------------------------------------- que nada tape a nada */

/**
 * Los dos choques que tuvo el dibujo la primera vez que se miró en pantalla.
 *
 * Ninguno de los dos rompe nada ni falla al compilar: se ven como un botón
 * que no responde y como una etiqueta que no está. Por eso quedan acá.
 */

const FORMAS: { nombre: string; pasos: Paso[] }[] = [
  { nombre: "cadena", pasos: [A, B, C] },
  { nombre: "condición que se reúne", pasos: [A, condicion([B], [C]), D] },
  { nombre: "rama vacía", pasos: [condicion([A], []), D] },
  { nombre: "las dos ramas vacías", pasos: [condicion([], [A]), D] },
  { nombre: "condición al final", pasos: [A, condicion([B], [C])] },
  { nombre: "ramas del mismo alto", pasos: [condicion([A], [B]), D] },
  { nombre: "anidada", pasos: [condicion([condicion([A], [B]), C], [D]), A] },
];

test("dos botones de agregar nunca caen en el mismo punto", () => {
  // Encimados, uno tapa al otro y el de abajo no se puede tocar. Y como cada
  // uno inserta en una rama distinta, el que queda arriba manda el paso nuevo
  // al camino equivocado.
  for (const { nombre, pasos } of FORMAS) {
    const plano = disponer(pasos);

    const puntos = [
      ...plano.aristas.filter((a) => a.insertar).map(puntoDelMas),
      ...plano.finales.map((f) => ({ x: f.x, y: f.y })),
    ].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);

    assert.equal(new Set(puntos).size, puntos.length, `se encimaron dos + en "${nombre}"`);
  }
});

test("la pastilla de la rama no queda abajo del botón de agregar", () => {
  // Con la rama vacía la línea baja derecha y los dos caían en el mismo lugar:
  // el "No" desaparecía abajo del botón.
  for (const { nombre, pasos } of FORMAS) {
    const plano = disponer(pasos);

    for (const arista of plano.aristas) {
      if (!arista.etiqueta || !arista.insertar) continue;

      const pastilla = puntoDeLaEtiqueta(arista);
      const mas = puntoDelMas(arista);
      const lejos = Math.abs(pastilla.x - mas.x) > 24 || Math.abs(pastilla.y - mas.y) > 20;

      assert.ok(lejos, `la pastilla "${arista.etiqueta}" tapa un + en "${nombre}"`);
    }
  }
});
