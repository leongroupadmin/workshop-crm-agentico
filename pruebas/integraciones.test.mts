import assert from "node:assert/strict";
import { test } from "node:test";

import { cifrar, descifrar, errorDeLaClave, generarSecreto } from "../src/lib/cifrado.ts";
import {
  combinar,
  DEFINICIONES,
  esIntegracion,
  leerFormulario,
  partesDelPaso,
  urlConSecreto,
  vistaDeLosCampos,
} from "../src/lib/integraciones.ts";

const CLAVE = "una-clave-de-prueba-larga-de-mas-de-32-caracteres";

/* ------------------------------------------------------------------ cifrado */

test("lo cifrado vuelve igual con la misma clave", () => {
  const texto = cifrar({ api_key: "sk-123", webhook_secret: "whsec_abc" }, CLAVE);
  assert.deepEqual(descifrar(texto, CLAVE), { api_key: "sk-123", webhook_secret: "whsec_abc" });
});

test("el texto cifrado no contiene la key en claro", () => {
  const texto = cifrar({ api_key: "sk-secreta-de-verdad" }, CLAVE);
  assert.doesNotMatch(texto, /sk-secreta/);
  assert.match(texto, /^v1\./);
});

test("dos cifrados de lo mismo no dan el mismo texto", () => {
  assert.notEqual(cifrar({ a: "1" }, CLAVE), cifrar({ a: "1" }, CLAVE));
});

test("con otra clave no se descifra: devuelve null, no lanza", () => {
  const texto = cifrar({ api_key: "sk-123" }, CLAVE);
  assert.equal(descifrar(texto, `${CLAVE}-otra`), null);
});

test("un texto alterado no se descifra a otra cosa", () => {
  const texto = cifrar({ api_key: "sk-123" }, CLAVE);
  const partes = texto.split(".");
  const datos = Buffer.from(partes[3], "base64");
  datos[0] ^= 1;
  partes[3] = datos.toString("base64");
  assert.equal(descifrar(partes.join("."), CLAVE), null);
});

test("un formato que no es nuestro devuelve null", () => {
  assert.equal(descifrar("sk-en-claro", CLAVE), null);
  assert.equal(descifrar("v2.a.b.c", CLAVE), null);
});

test("la clave del entorno se exige y con un largo mínimo", () => {
  assert.match(errorDeLaClave(undefined) ?? "", /Falta INTEGRATIONS_ENCRYPTION_KEY/);
  assert.match(errorDeLaClave("corta") ?? "", /demasiado corta/);
  assert.equal(errorDeLaClave(CLAVE), null);
});

test("el secreto generado es hex de 64 caracteres", () => {
  assert.match(generarSecreto(), /^[0-9a-f]{64}$/);
});

/* ------------------------------------------------------------- integraciones */

const ENTORNO = {
  ZERNIO_API_KEY: "key-del-entorno",
  ZERNIO_WEBHOOK_SECRET: "secreto-del-entorno",
};

test("lo que no se cargó en el panel se completa con el entorno", () => {
  const combinadas = combinar({
    definicion: DEFINICIONES.zernio,
    guardados: { api_key: "key-del-panel" },
    entorno: ENTORNO,
  });
  assert.equal(combinadas.valores.api_key, "key-del-panel");
  assert.equal(combinadas.origen.api_key, "panel");
  assert.equal(combinadas.valores.webhook_secret, "secreto-del-entorno");
  assert.equal(combinadas.origen.webhook_secret, "entorno");
  assert.deepEqual(combinadas.faltan, []);
});

test("los valores por defecto completan los campos opcionales", () => {
  const combinadas = combinar({
    definicion: DEFINICIONES.zernio,
    guardados: { api_key: "k", webhook_secret: "s" },
    entorno: {},
  });
  assert.equal(combinadas.valores.base_url, "https://zernio.com/api");
  assert.equal(combinadas.origen.base_url, "por-defecto");
});

test("un secreto vacío en el formulario conserva el guardado", () => {
  const leido = leerFormulario(
    DEFINICIONES.zernio,
    { api_key: "", webhook_secret: "nuevo" },
    { api_key: "viejo", webhook_secret: "anterior" },
  );
  assert.ok(leido.ok);
  assert.deepEqual(leido.secretos, { api_key: "viejo", webhook_secret: "nuevo" });
});

test("los secretos no quedan en la parte pública", () => {
  const leido = leerFormulario(
    DEFINICIONES.ycloud,
    { api_key: "k", webhook_secret: "whsec_x", phone_number: "+54 9 11 1234-5678" },
    {},
  );
  assert.ok(leido.ok);
  assert.deepEqual(leido.config, { phone_number: "+5491112345678" });
  assert.equal(JSON.stringify(leido.config).includes("whsec_x"), false);
});

test("se rechazan una URL y un teléfono mal escritos", () => {
  const url = leerFormulario(DEFINICIONES.zernio, { base_url: "zernio.local" }, {});
  assert.equal(url.ok, false);
  const telefono = leerFormulario(DEFINICIONES.ycloud, { phone_number: "11 1234" }, {});
  assert.equal(telefono.ok, false);
});

test("la URL se guarda sin la barra final", () => {
  const leido = leerFormulario(DEFINICIONES.zernio, { base_url: "https://zernio.example.com/api/" }, {});
  assert.ok(leido.ok);
  assert.equal(leido.config.base_url, "https://zernio.example.com/api");
});

test("el panel nunca recibe el valor de un secreto", () => {
  const combinadas = combinar({
    definicion: DEFINICIONES.ycloud,
    guardados: { api_key: "k-secreta", webhook_secret: "whsec_s", phone_number: "+5491100000000" },
    entorno: {},
  });
  const vista = vistaDeLosCampos(DEFINICIONES.ycloud, combinadas);
  const porClave = Object.fromEntries(vista.map((campo) => [campo.clave, campo]));
  assert.equal(porClave.api_key.valor, null);
  assert.equal(porClave.api_key.cargado, true);
  assert.equal(porClave.webhook_secret.valor, null);
  assert.equal(porClave.phone_number.valor, "+5491100000000");
  // El valor por defecto no se presenta como si alguien lo hubiera cargado.
  assert.equal(porClave.base_url.cargado, false);
  assert.equal(JSON.stringify(vista).includes("k-secreta"), false);
});

test("sólo se aceptan las integraciones conocidas", () => {
  assert.equal(esIntegracion("openai"), true);
  assert.equal(esIntegracion("stripe"), false);
  assert.equal(esIntegracion("waha"), false);
  assert.equal(esIntegracion("calendar"), false);
  assert.equal(esIntegracion(undefined), false);
});

test("la URL del webhook lleva el secreto como token, recortado y escapado", () => {
  const base = "https://crm.ejemplo.com/api/webhooks/zernio";
  assert.equal(urlConSecreto(base, "abc123"), `${base}?token=abc123`);
  // El salto de línea del portapapeles no viaja: el servidor compara recortado.
  assert.equal(urlConSecreto(base, "  abc123\n"), `${base}?token=abc123`);
  // Un secreto escrito a mano con caracteres raros vuelve igual al leerlo.
  const raro = "a b&c=d/é";
  const url = new URL(urlConSecreto(base, raro));
  assert.equal(url.searchParams.get("token"), raro);
  // Sin secreto, la URL queda como estaba.
  assert.equal(urlConSecreto(base, "  "), base);
  // Si la URL ya traía parámetros, se suma con &.
  assert.equal(urlConSecreto(`${base}?x=1`, "abc"), `${base}?x=1&token=abc`);
});

test("los webhooks con secreto generable dicen dónde se pega la URL", () => {
  for (const integracion of ["zernio"] as const) {
    const definicion = DEFINICIONES[integracion];
    assert.ok(definicion.campos.some((campo) => campo.clave === "webhook_secret" && campo.generable), integracion);
    assert.ok(definicion.webhook?.donde, integracion);
  }
});

test("cada integración es una lista de pasos con cada campo adentro del que lo pide", () => {
  for (const definicion of Object.values(DEFINICIONES)) {
    const { integracion, pasos, campos } = definicion;
    const claves = new Set(campos.map((campo) => campo.clave));
    const con = pasos.map((paso) => paso.con);

    for (const pedido of con) {
      if (pedido === undefined || pedido === "guardar" || pedido === "url") continue;
      assert.ok(claves.has(pedido), `${integracion}: el paso pide «${pedido}», que no es un campo`);
    }
    assert.equal(con.filter((pedido) => pedido === "guardar").length, 1, `${integracion}: un solo Guardar`);
    assert.equal(con.includes("url"), Boolean(definicion.webhook), `${integracion}: la URL, si recibe eventos`);
    assert.equal(new Set(con.filter(Boolean)).size, con.filter(Boolean).length, `${integracion}: nada dos veces`);

    // Lo que ningún paso pide va plegado en "Opciones avanzadas": nunca algo
    // sin lo que la integración no anda.
    for (const campo of campos.filter((campo) => campo.requerido)) {
      assert.ok(con.includes(campo.clave), `${integracion}: ${campo.etiqueta} es obligatorio y ningún paso lo pide`);
    }

    // Con secreto generable: se genera, se guarda y recién ahí se copia la URL,
    // que no funciona hasta que el secreto está guardado.
    if (campos.some((campo) => campo.generable)) {
      const generar = con.indexOf("webhook_secret");
      const guardar = con.indexOf("guardar");
      const url = con.indexOf("url");
      assert.ok(generar >= 0 && generar < guardar && guardar < url, integracion);
    }
  }
});

test("los links de los pasos se separan del texto, sin el punto de la frase", () => {
  assert.deepEqual(partesDelPaso("Creá una key en https://platform.openai.com/api-keys y pegala acá."), [
    { tipo: "texto", texto: "Creá una key en " },
    { tipo: "link", url: "https://platform.openai.com/api-keys", texto: "platform.openai.com/api-keys" },
    { tipo: "texto", texto: " y pegala acá." },
  ]);
  assert.deepEqual(partesDelPaso("Entrá a https://zernio.com/dashboard/api-keys, creá una."), [
    { tipo: "texto", texto: "Entrá a " },
    { tipo: "link", url: "https://zernio.com/dashboard/api-keys", texto: "zernio.com/dashboard/api-keys" },
    { tipo: "texto", texto: ", creá una." },
  ]);
  assert.deepEqual(partesDelPaso("Guardá."), [{ tipo: "texto", texto: "Guardá." }]);

  // Zernio y OpenAI llevan a sus paneles; todo link es https y válido.
  const links = (integracion: keyof typeof DEFINICIONES) =>
    DEFINICIONES[integracion].pasos.flatMap((paso) =>
      partesDelPaso(paso.texto).flatMap((parte) => (parte.tipo === "link" ? [parte.url] : [])),
    );
  assert.ok(links("zernio").includes("https://zernio.com/dashboard/api-keys"));
  assert.ok(links("openai").includes("https://platform.openai.com/api-keys"));
  for (const integracion of Object.keys(DEFINICIONES) as (keyof typeof DEFINICIONES)[]) {
    for (const url of links(integracion)) assert.equal(new URL(url).protocol, "https:");
  }
});
