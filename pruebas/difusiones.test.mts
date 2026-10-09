/**
 * Pruebas de a quién le llega una difusión.
 *
 * Es la parte del sistema donde equivocarse no se ve hasta que ya salió: un
 * filtro que deja pasar de más le escribe a gente que no tenía que recibir
 * nada, y un teléfono mal normalizado manda el mensaje a un número que no
 * existe. Las dos cosas son irreversibles, así que se afirman acá y no se
 * confían a la pantalla.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  aplicarFiltros,
  chatDeWhatsapp,
  etiquetasDisponibles,
  FILTRO_VACIO,
  formasDelTelefono,
  formatoDe,
  motivoLegible,
  normalizarTelefono,
  sePuedeEscribirPrimero,
  tieneTelefonoUtil,
  type Candidato,
} from "../src/lib/difusiones.ts";

function candidato(parcial: Partial<Candidato> & { contactId: string }): Candidato {
  return {
    nombre: "Alguien",
    telefono: "+5491122334455",
    etiquetas: [],
    stageId: null,
    dia: "2026-01-15",
    ...parcial,
  };
}

/* ------------------------------------------------------------------ filtros */

test("sin filtros entra todo el mundo", () => {
  const gente = [candidato({ contactId: "a" }), candidato({ contactId: "b" })];

  assert.equal(aplicarFiltros(gente, FILTRO_VACIO).length, 2);
});

test("filtrar por etapa deja afuera a quien no está en el embudo", () => {
  const gente = [
    candidato({ contactId: "en-la-etapa", stageId: "nuevos" }),
    candidato({ contactId: "otra-etapa", stageId: "perdidos" }),
    candidato({ contactId: "sin-oportunidad", stageId: null }),
  ];

  const filtrados = aplicarFiltros(gente, { ...FILTRO_VACIO, stageIds: ["nuevos"] });

  assert.deepEqual(
    filtrados.map((c) => c.contactId),
    ["en-la-etapa"],
  );
});

test("varias etapas suman: alcanza con estar en una", () => {
  const gente = [
    candidato({ contactId: "a", stageId: "nuevos" }),
    candidato({ contactId: "b", stageId: "ganados" }),
    candidato({ contactId: "c", stageId: "perdidos" }),
  ];

  const filtrados = aplicarFiltros(gente, {
    ...FILTRO_VACIO,
    stageIds: ["nuevos", "ganados"],
  });

  assert.deepEqual(
    filtrados.map((c) => c.contactId),
    ["a", "b"],
  );
});

test("las etiquetas se comparan sin distinguir mayúsculas", () => {
  const gente = [
    candidato({ contactId: "a", etiquetas: ["VIP"] }),
    candidato({ contactId: "b", etiquetas: ["frío"] }),
  ];

  const filtrados = aplicarFiltros(gente, { ...FILTRO_VACIO, etiquetas: ["vip"] });

  assert.deepEqual(
    filtrados.map((c) => c.contactId),
    ["a"],
  );
});

test("etapa y etiqueta se piden las dos juntas", () => {
  const gente = [
    candidato({ contactId: "cumple", stageId: "nuevos", etiquetas: ["vip"] }),
    candidato({ contactId: "solo-etapa", stageId: "nuevos", etiquetas: [] }),
    candidato({ contactId: "solo-etiqueta", stageId: "perdidos", etiquetas: ["vip"] }),
  ];

  const filtrados = aplicarFiltros(gente, {
    ...FILTRO_VACIO,
    stageIds: ["nuevos"],
    etiquetas: ["vip"],
  });

  assert.deepEqual(
    filtrados.map((c) => c.contactId),
    ["cumple"],
  );
});

test("el rango de fechas incluye los dos extremos", () => {
  const gente = [
    candidato({ contactId: "antes", dia: "2026-01-31" }),
    candidato({ contactId: "primero", dia: "2026-02-01" }),
    candidato({ contactId: "medio", dia: "2026-02-14" }),
    candidato({ contactId: "ultimo", dia: "2026-02-28" }),
    candidato({ contactId: "despues", dia: "2026-03-01" }),
  ];

  const filtrados = aplicarFiltros(gente, {
    ...FILTRO_VACIO,
    desde: "2026-02-01",
    hasta: "2026-02-28",
  });

  assert.deepEqual(
    filtrados.map((c) => c.contactId),
    ["primero", "medio", "ultimo"],
  );
});

test("una punta sola del rango también filtra", () => {
  const gente = [
    candidato({ contactId: "viejo", dia: "2025-12-31" }),
    candidato({ contactId: "nuevo", dia: "2026-01-01" }),
  ];

  assert.deepEqual(
    aplicarFiltros(gente, { ...FILTRO_VACIO, desde: "2026-01-01" }).map((c) => c.contactId),
    ["nuevo"],
  );
  assert.deepEqual(
    aplicarFiltros(gente, { ...FILTRO_VACIO, hasta: "2025-12-31" }).map((c) => c.contactId),
    ["viejo"],
  );
});

/* --------------------------------------------------------------- etiquetas */

test("las etiquetas disponibles no se repiten y salen ordenadas", () => {
  const gente = [
    candidato({ contactId: "a", etiquetas: ["vip", "Referido"] }),
    candidato({ contactId: "b", etiquetas: ["VIP", "  "] }),
  ];

  assert.deepEqual(etiquetasDisponibles(gente), ["Referido", "vip"]);
});

/* --------------------------------------------------------------- teléfonos */

test("el teléfono queda en E.164 sin importar cómo se cargó", () => {
  assert.equal(normalizarTelefono("+54 9 11 2233-4455"), "+5491122334455");
  assert.equal(normalizarTelefono("(011) 5555 6666"), "+01155556666");
  assert.equal(normalizarTelefono("5491122334455"), "+5491122334455");
});

test("el formato del número propio manda", () => {
  assert.equal(formatoDe("+5491100000000"), "con-mas");
  assert.equal(formatoDe("5491100000000"), "solo-digitos");
  assert.equal(formatoDe(null), "solo-digitos");

  assert.equal(normalizarTelefono("+5491122334455", "solo-digitos"), "5491122334455");
});

test("normalizar un número ya normalizado no lo cambia", () => {
  const una = normalizarTelefono("+54 9 11 2233 4455");
  assert.equal(normalizarTelefono(una), una);
});

test("lo que no puede ser un teléfono no se manda", () => {
  for (const roto of [null, undefined, "", "sin números", "12345", "1".repeat(16)]) {
    assert.equal(normalizarTelefono(roto), null, `debería descartar ${JSON.stringify(roto)}`);
  }
});

test("un contacto sin teléfono útil queda afuera de la audiencia", () => {
  assert.equal(tieneTelefonoUtil(candidato({ contactId: "a", telefono: null })), false);
  assert.equal(tieneTelefonoUtil(candidato({ contactId: "b", telefono: "123" })), false);
  assert.equal(tieneTelefonoUtil(candidato({ contactId: "c" })), true);
});

/* --------------------------- las formas de un mismo teléfono */

test("un móvil argentino se busca con y sin el 9, con y sin el +", () => {
  // Es el caso que duplicaba contactos: WhatsApp guarda +549…, quien carga a
  // mano escribe el número sin el 9, y una igualdad exacta los trata como dos
  // personas distintas.
  const formas = formasDelTelefono("+5491122334455");

  assert.ok(formas.includes("+5491122334455"));
  assert.ok(formas.includes("5491122334455"));
  assert.ok(formas.includes("+541122334455"));
  assert.ok(formas.includes("541122334455"));
});

test("el mismo número escrito sin el 9 devuelve exactamente las mismas formas", () => {
  // Si no, encontrarse dependería de cuál de los dos se cargó primero.
  const con = [...formasDelTelefono("+5491122334455")].sort();
  const sin = [...formasDelTelefono("+541122334455")].sort();

  assert.deepEqual(con, sin);
});

test("da igual cómo venga escrito: espacios, guiones o paréntesis", () => {
  const esperado = [...formasDelTelefono("+5491122334455")].sort();

  for (const escrito of ["+54 9 11 2233-4455", "(54) 9 11 2233.4455", "54 9 1122334455"]) {
    assert.deepEqual([...formasDelTelefono(escrito)].sort(), esperado, escrito);
  }
});

test("a un número de otro país no se le toca el 9", () => {
  // Fuera de Argentina ese dígito es parte del número, y sacarlo apuntaría a
  // otro lado. Sólo se devuelven las dos formas del mismo número.
  const formas = formasDelTelefono("+34911223344");

  assert.deepEqual(formas.sort(), ["+34911223344", "34911223344"]);
});

test("un teléfono que no sirve no devuelve ninguna forma", () => {
  // Sin esto, un `.in()` con lista vacía o con basura buscaría cualquier cosa.
  assert.deepEqual(formasDelTelefono(null), []);
  assert.deepEqual(formasDelTelefono(""), []);
  assert.deepEqual(formasDelTelefono("123"), []);
});

test("el chat de WhatsApp lleva el 9 aunque el contacto esté guardado sin él", () => {
  // Es el caso que no se ve: con `541122334455@c.us` WAHA acepta el envío y el
  // recordatorio no llega a ningún teléfono. No hay error que mirar.
  assert.equal(chatDeWhatsapp("+541122334455"), "5491122334455@c.us");
  assert.equal(chatDeWhatsapp("54 11 2233-4455"), "5491122334455@c.us");
});

test("el chat de un número que ya trae el 9 queda igual", () => {
  // Agregarlo dos veces daría `5499…`, que tampoco existe.
  assert.equal(chatDeWhatsapp("+5491122334455"), "5491122334455@c.us");
});

test("a un número de otro país no se le agrega el 9 para armar el chat", () => {
  assert.equal(chatDeWhatsapp("+34911223344"), "34911223344@c.us");
  assert.equal(chatDeWhatsapp("+15551234567"), "15551234567@c.us");
});

test("sin un teléfono usable no se arma ningún chat", () => {
  // Devolver un chat inventado dejaría conversaciones vacías en el CRM.
  assert.equal(chatDeWhatsapp(null), null);
  assert.equal(chatDeWhatsapp("123"), null);
});

/* ------------------------------------------------- a quién escribirle primero */

test("con teléfono válido se le puede escribir primero", () => {
  assert.equal(sePuedeEscribirPrimero("+54 9 11 2233-4455"), true);
  assert.equal(sePuedeEscribirPrimero("5491122334455"), true);
});

// El caso que hacía aparecer contactos de Instagram en "Esperando primer
// mensaje": sin teléfono el botón abría un error sin arreglo posible.
test("sin teléfono no se le puede escribir primero", () => {
  assert.equal(sePuedeEscribirPrimero(null), false);
  assert.equal(sePuedeEscribirPrimero(""), false);
  assert.equal(sePuedeEscribirPrimero("   "), false);
  assert.equal(sePuedeEscribirPrimero(undefined), false);
});

test("un teléfono a medio cargar tampoco alcanza", () => {
  assert.equal(sePuedeEscribirPrimero("1122"), false);
  assert.equal(sePuedeEscribirPrimero("+54 9 11 2233-4455-6677-88"), false);
});

/* ------------------------------------------------- por qué no salió un envío */

test("un motivo vacío no inventa una explicación", () => {
  assert.equal(motivoLegible(null), null);
  assert.equal(motivoLegible(""), null);
  assert.equal(motivoLegible("   "), null);
});

test("traduce el código de Meta y guarda lo que contestó la API", () => {
  const crudo = 'YCloud respondió 400: {"error":{"code":132000,"message":"..."}}';
  const motivo = motivoLegible(crudo);

  assert.ok(motivo);
  assert.match(motivo.resumen, /variables/);
  // Lo crudo no se pierde: es lo único que sirve cuando la traducción no alcanza.
  assert.equal(motivo.tecnico, crudo);
});

test("reconoce por texto cuando el código no viene", () => {
  const motivo = motivoLegible("not a valid WhatsApp user");

  assert.ok(motivo);
  assert.match(motivo.resumen, /no tiene WhatsApp/);
});

test("un motivo desconocido se muestra tal cual y no se repite abajo", () => {
  const motivo = motivoLegible("Se cayó el tendido eléctrico");

  assert.ok(motivo);
  assert.equal(motivo.resumen, "Se cayó el tendido eléctrico");
  assert.equal(motivo.tecnico, null);
});

test("un 403 dentro del cuerpo no se confunde con credenciales rechazadas", () => {
  // El número aparece en el detalle del error, no como estado de la respuesta.
  const motivo = motivoLegible('YCloud respondió 400: {"error":{"message":"to=+5491140322403"}}');

  assert.ok(motivo);
  assert.doesNotMatch(motivo.resumen, /credenciales/);
});

test("reconoce las credenciales cuando el estado sí es 403", () => {
  const motivo = motivoLegible("YCloud respondió 403: forbidden");

  assert.ok(motivo);
  assert.match(motivo.resumen, /credenciales/);
});
