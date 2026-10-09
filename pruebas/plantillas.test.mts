/**
 * Pruebas del armado de plantillas de WhatsApp.
 *
 * Lo que se cuida acá es lo que no se ve al probar a mano: el orden de los
 * parámetros. Meta no los recibe por nombre sino por posición —el primero es
 * `{{1}}`— así que una plantilla con los huecos escritos al revés en el texto
 * saldría con los valores cambiados de lugar y nadie lo notaría hasta que un
 * cliente reciba "Hola 15 de marzo, tu turno es el Juan".
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  claveDe,
  componentesParaEnviar,
  faltantesDe,
  normalizarPlantillas,
  primerHuecoVacio,
  variablesDe,
  vistaPrevia,
  type Plantilla,
} from "../src/lib/plantillas.ts";

/** Una respuesta como la que devuelve la API, con la forma de Meta. */
const RESPUESTA = {
  items: [
    {
      name: "recordatorio_turno",
      language: "es_AR",
      category: "UTILITY",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "TEXT", text: "Turno en {{1}}" },
        { type: "BODY", text: "Hola {{1}}, te esperamos el {{2}}." },
        { type: "FOOTER", text: "León Group" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }] },
      ],
    },
    {
      name: "sin_variables",
      language: "es",
      category: "MARKETING",
      status: "REJECTED",
      components: [{ type: "body", text: "Seguimos disponibles." }],
    },
  ],
};

function plantilla(nombre: string): Plantilla {
  const encontrada = normalizarPlantillas(RESPUESTA).find((p) => p.nombre === nombre);
  assert.ok(encontrada, `no se normalizó ${nombre}`);
  return encontrada;
}

test("lee la lista y sus componentes", () => {
  const plantillas = normalizarPlantillas(RESPUESTA);

  assert.equal(plantillas.length, 2);
  assert.equal(plantillas[0].idioma, "es_AR");
  assert.equal(plantillas[0].estado, "APPROVED");
  assert.equal(plantillas[0].componentes.length, 4);
  assert.deepEqual(plantillas[0].componentes[3].botones, ["Confirmar"]);
});

test("acepta los tres envoltorios y los tipos en minúscula", () => {
  const suelta = [RESPUESTA.items[1]];

  assert.equal(normalizarPlantillas(suelta).length, 1);
  assert.equal(normalizarPlantillas({ data: suelta }).length, 1);
  // El componente vino como "body" y no "BODY": igual se entiende.
  assert.equal(normalizarPlantillas(suelta)[0].componentes[0].tipo, "body");
});

test("descarta lo que no se entiende sin tirar el resto", () => {
  const plantillas = normalizarPlantillas({
    items: [null, { sin: "nombre" }, RESPUESTA.items[1], "texto suelto"],
  });

  assert.equal(plantillas.length, 1);
  assert.equal(plantillas[0].nombre, "sin_variables");
});

test("las variables salen ordenadas por número y sin repetir", () => {
  assert.deepEqual(variablesDe("El {{2}} para {{1}}, repito: {{2}}"), [1, 2]);
  assert.deepEqual(variablesDe("Sin huecos"), []);
  // El cero no es una variable válida de Meta.
  assert.deepEqual(variablesDe("{{0}} y {{ 3 }}"), [3]);
});

test("los huecos del encabezado van antes que los del cuerpo", () => {
  const faltantes = faltantesDe(plantilla("recordatorio_turno"));

  assert.deepEqual(faltantes.map(claveDe), ["header.1", "body.1", "body.2"]);
});

test("el encabezado y el cuerpo numeran sus variables por separado", () => {
  const valores = { "header.1": "la clínica", "body.1": "Juan", "body.2": "15 de marzo" };
  const componentes = componentesParaEnviar(plantilla("recordatorio_turno"), valores);

  assert.deepEqual(componentes, [
    { type: "header", parameters: [{ type: "text", text: "la clínica" }] },
    {
      type: "body",
      parameters: [
        { type: "text", text: "Juan" },
        { type: "text", text: "15 de marzo" },
      ],
    },
  ]);
});

test("una plantilla sin variables se manda sin componentes", () => {
  assert.deepEqual(componentesParaEnviar(plantilla("sin_variables"), {}), []);
  assert.equal(primerHuecoVacio(plantilla("sin_variables"), {}), null);
});

test("un encabezado con archivo pide un link", () => {
  const [conImagen] = normalizarPlantillas([
    {
      name: "promo",
      language: "es",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Mirá esto." },
      ],
    },
  ]);

  assert.deepEqual(faltantesDe(conImagen), [{ clase: "link", formato: "image" }]);
  assert.deepEqual(componentesParaEnviar(conImagen, { link: "https://ejemplo/f.jpg" }), [
    { type: "header", parameters: [{ type: "image", image: { link: "https://ejemplo/f.jpg" } }] },
  ]);
});

test("un encabezado sin formato declarado es de texto", () => {
  const [suelta] = normalizarPlantillas([
    { name: "x", language: "es", components: [{ type: "HEADER", text: "Hola {{1}}" }] },
  ]);

  assert.equal(suelta.componentes[0].formato, "text");
  assert.deepEqual(faltantesDe(suelta), [{ clase: "variable", ubicacion: "header", numero: 1 }]);
});

test("la vista previa es lo que va a leer el contacto", () => {
  const texto = vistaPrevia(plantilla("recordatorio_turno"), {
    "header.1": "la clínica",
    "body.1": "Juan",
    "body.2": "15 de marzo",
  });

  assert.equal(texto, "Turno en la clínica\n\nHola Juan, te esperamos el 15 de marzo.\n\nLeón Group");
});

test("mientras falta un valor la vista previa deja el hueco a la vista", () => {
  const texto = vistaPrevia(plantilla("recordatorio_turno"), { "body.1": "Juan" });

  assert.ok(texto.includes("Hola Juan"), texto);
  assert.ok(texto.includes("{{2}}"), texto);
});

test("avisa cuál es el primer hueco sin completar", () => {
  const hueco = primerHuecoVacio(plantilla("recordatorio_turno"), {
    "header.1": "la clínica",
    "body.1": "   ",
    "body.2": "15 de marzo",
  });

  assert.deepEqual(hueco, { clase: "variable", ubicacion: "body", numero: 1 });
});
