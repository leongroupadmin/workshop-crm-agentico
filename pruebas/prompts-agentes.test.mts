/**
 * Pruebas de la sección del workshop en las instrucciones del agente.
 *
 * Lo que se cuida es lo que en producción no se puede mirar sin esperar a que
 * sea ese día: que el precio cambie en el corte de Argentina y no en el del
 * servidor —Vercel corre en UTC—, que la sección se vaya sola cuando arranca el
 * workshop, y que no le dé voz a un canal sin instrucciones.
 *
 * Los instantes van en UTC, así el resultado no depende de dónde corra la
 * prueba.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  PROMPTS_POR_CANAL,
  WORKSHOP_URL,
  promptDelCanal,
  seccionDelWorkshop,
} from "../src/lib/prompts-agentes.ts";

test("el pedido de información se resuelve arriba, antes del contexto, en los tres canales", () => {
  for (const channel of ["whatsapp", "instagram", "messenger"] as const) {
    const prompt = promptDelCanal(channel);
    const regla = prompt.indexOf("## 3.1. CUANDO TE PIDEN INFORMACIÓN");

    assert.ok(regla > prompt.indexOf("## 3. ORDEN DE PRIORIDAD"), channel);
    assert.ok(regla < prompt.indexOf("## 4. CONTEXTO"), channel);
    // Lo que decía antes —explicar primero qué hacemos— no puede quedar
    // compitiendo con la regla.
    assert.doesNotMatch(prompt, /Contestás en el chat, en una o dos líneas, qué hacemos/, channel);
  }
});

test("el formato del mensaje es una regla de arriba, en los tres canales", () => {
  for (const channel of ["whatsapp", "instagram", "messenger"] as const) {
    const prompt = promptDelCanal(channel);
    const regla = prompt.indexOf("## 3.2. CÓMO SE VE TU MENSAJE");

    assert.ok(regla > prompt.indexOf("## 3.1. CUANDO TE PIDEN INFORMACIÓN"), channel);
    assert.ok(regla < prompt.indexOf("## 4. CONTEXTO"), channel);
    assert.match(prompt, /Nunca mandás un bloque de texto corrido/, channel);
  }
  // La sección propia de Instagram se referencia por número: no se corre.
  assert.match(PROMPTS_POR_CANAL.instagram, /## 15\. INSTAGRAM/);
});

test("el primer mensaje siempre saluda, en los tres canales y con el workshop", () => {
  for (const channel of ["whatsapp", "instagram", "messenger"] as const) {
    const prompt = promptDelCanal(channel, new Date("2026-10-08T15:00:00Z"));
    const regla = prompt.indexOf("## 3.3. TU PRIMER MENSAJE SIEMPRE SALUDA");

    assert.ok(regla > prompt.indexOf("## 3.2. CÓMO SE VE TU MENSAJE"), channel);
    assert.ok(regla < prompt.indexOf("## 4. CONTEXTO"), channel);
    assert.match(prompt, /aunque ya tengas la respuesta para dar/, channel);
    // El workshop pisa casi todo: tiene que dejar dicho que esto no.
    assert.match(prompt, /el saludo del primer mensaje de la sección 3\.3 siguen valiendo igual/, channel);
  }
  assert.match(PROMPTS_POR_CANAL.instagram, /El saludo de la sección 3\.3 va igual/);
});

test("el workshop ya no pide meter todo en una o dos oraciones", () => {
  const seccion = seccionDelWorkshop(new Date("2026-10-08T15:00:00Z"));

  assert.doesNotMatch(seccion, /En 1 o 2 oraciones/);
  assert.match(seccion, /con el formato de la sección 3\.2/);
  // El ejemplo trae los tramos en viñetas y el link solo en su línea.
  assert.match(seccion, /\n• \$40\.000 hasta el sábado 10\/10 \(el de hoy\)\n• \$80\.000 del domingo 11\/10 al jueves 15\/10\n• \$120\.000 del viernes 16\/10 al martes 20\/10\n/);
  assert.ok(seccion.includes(`\n${WORKSHOP_URL}"`));
});

test("del workshop contesta lo básico y deriva lo específico", () => {
  const seccion = seccionDelWorkshop(new Date("2026-10-08T15:00:00Z"));

  assert.match(seccion, /Lo que podés decir del workshop es esto y nada más:/);
  assert.match(seccion, /nunca lo usás para contar qué se aprende/);
  assert.match(seccion, /\*\*Específicas, las derivás:\*\*[^\n]*frase de derivación de la sección 12/);
  assert.match(seccion, /Si dudás de si una pregunta es básica o específica, es específica: derivás\./);
  // Ofrecer "te cuento cómo funciona" es lo que lo llevó a inventar.
  assert.match(seccion, /No ofrecés contar más de lo que está acá/);
  // Temario, contenido y entregables no se derivan: se mandan a la página.
  assert.match(seccion, /\*\*Temario, contenido y entregables, a la página:\*\*[^\n]*le pasás el link de la página/);
  const temario = seccion.slice(
    seccion.indexOf("Ejemplo, si te preguntan por el temario"),
    seccion.indexOf("Ejemplo, si te hacen una pregunta específica"),
  );
  assert.ok(temario.includes(`\n${WORKSHOP_URL}"`));
  // El ejemplo de la pregunta específica es la derivación sola, sin link.
  const ejemplo = seccion.slice(
    seccion.indexOf("Ejemplo, si te hacen una pregunta específica"),
    seccion.indexOf("Ejemplo, si te preguntan cuánto sale"),
  );
  assert.match(ejemplo, /\n"Te derivo con un asesor humano"\n/);
  assert.ok(!ejemplo.includes(WORKSHOP_URL));
});

test("el precio del workshop sale solo si lo preguntan", () => {
  const seccion = seccionDelWorkshop(new Date("2026-10-08T15:00:00Z"));

  assert.match(seccion, /El precio, solo si te lo preguntan\./);
  assert.doesNotMatch(seccion, /Podés confirmar la fecha, el horario, la duración y el precio/);
  // El ejemplo del pedido de info no trae el precio: el modelo copia lo que ve.
  const ejemplo = seccion.slice(
    seccion.indexOf("Ejemplo, si te piden información"),
    seccion.indexOf("Ejemplo, si te preguntan cuánto sale"),
  );
  assert.ok(ejemplo.includes(WORKSHOP_URL));
  assert.doesNotMatch(ejemplo, /\$/);
});

test("el ejemplo del precio solo muestra los tramos que siguen vigentes", () => {
  // Domingo 11/10, 00:00 en Argentina.
  const domingo = seccionDelWorkshop(new Date("2026-10-11T03:00:00Z"));
  assert.match(domingo, /\n• \$80\.000 del domingo 11\/10 al jueves 15\/10 \(el de hoy\)\n• \$120\.000/);

  // Viernes 16/10: ya no hay tramos que listar.
  const ultimo = seccionDelWorkshop(new Date("2026-10-16T03:00:00Z"));
  assert.match(ultimo, /"Hoy está a \$120\.000, y ya es el último precio\./);
  assert.doesNotMatch(ultimo, /\n• /);
});

test("antes del sábado 10/10 a medianoche rige el primer precio, con los aumentos que vienen", () => {
  // Sábado 10/10, 23:59 en Argentina.
  const seccion = seccionDelWorkshop(new Date("2026-10-11T02:59:00Z"));

  assert.match(seccion, /Hoy está a \$40\.000 \(hasta el sábado 10\/10\)/);
  assert.match(seccion, /Después sube: \$80\.000 del domingo 11\/10 al jueves 15\/10, y \$120\.000 del viernes 16\/10 al martes 20\/10\./);
  assert.match(seccion, /conviene reservar antes/);
});

test("el precio cambia a la medianoche de Argentina, no a la de UTC", () => {
  // Sábado 10/10, 22:00 en Argentina: en UTC ya es domingo.
  assert.match(seccionDelWorkshop(new Date("2026-10-11T01:00:00Z")), /Hoy está a \$40\.000/);
  // Domingo 11/10, 00:00 en Argentina.
  const domingo = seccionDelWorkshop(new Date("2026-10-11T03:00:00Z"));
  assert.match(domingo, /Hoy está a \$80\.000 \(del domingo 11\/10 al jueves 15\/10\)/);
  assert.match(domingo, /Después sube: \$120\.000 del viernes 16\/10 al martes 20\/10\./);
  assert.doesNotMatch(domingo, /\$40\.000/);
});

test("en el último tramo no anuncia un aumento que no existe", () => {
  // Viernes 16/10, 00:00 en Argentina.
  const seccion = seccionDelWorkshop(new Date("2026-10-16T03:00:00Z"));

  assert.match(seccion, /Hoy está a \$120\.000 .*es el último precio: no sube más\./);
  assert.doesNotMatch(seccion, /Después sube/);
  assert.doesNotMatch(seccion, /conviene reservar antes/);
});

test("inscribirse y pagar se derivan: la página no se ofrece para eso", () => {
  const seccion = seccionDelWorkshop(new Date("2026-10-07T15:00:00Z"));

  // Las palabras con las que `INSTRUCCIONES_DE_DERIVACION` pide la marca.
  assert.match(seccion, /es una consulta que no podés resolver/);
  assert.match(seccion, /frase de derivación de la sección 12, sin link/);
  assert.doesNotMatch(seccion, /inscripción están acá|botón para reservar/);
});

test("la sección se va sola cuando arranca el workshop", () => {
  // Martes 20/10, 17:59 en Argentina: todavía se ofrece.
  assert.match(seccionDelWorkshop(new Date("2026-10-20T20:59:00Z")), /\$120\.000/);
  // Martes 20/10, 18:00 en Argentina.
  assert.equal(seccionDelWorkshop(new Date("2026-10-20T21:00:00Z")), "");
});

test("el workshop va primero en cada canal, con el link textual", () => {
  const ahora = new Date("2026-10-06T15:00:00Z");

  for (const channel of ["whatsapp", "instagram", "messenger"] as const) {
    const prompt = promptDelCanal(channel, ahora);
    assert.ok(prompt.startsWith(`${seccionDelWorkshop(ahora)}\n\n# PROMPT — SETTER IA DE LEÓN GROUP`), channel);
    assert.ok(prompt.endsWith(PROMPTS_POR_CANAL[channel].trim()), channel);
    assert.ok(prompt.includes(WORKSHOP_URL), channel);
  }
});

test("con la campaña, lo que no es por el servicio se contesta con el workshop", () => {
  const seccion = seccionDelWorkshop(new Date("2026-10-08T15:00:00Z"));

  assert.match(seccion, /^# PRIORIDAD: WORKSHOP CRM AGÉNTICO/);
  assert.match(seccion, /das por hecho que viene por el workshop/);
  assert.match(seccion, /Esto pisa la pregunta de la sección 3\.1 y la apertura de la Etapa 0/);
  assert.match(seccion, /Solo si pregunta por nuestros servicios .* arranca la indagación de la sección 7/);
  assert.match(seccion, /no hacés preguntas de calificación ni le ofrecés la auditoría/);
});

test("después del workshop el canal vuelve al texto aprobado tal cual", () => {
  const despues = new Date("2026-10-21T15:00:00Z");

  assert.equal(promptDelCanal("whatsapp", despues), PROMPTS_POR_CANAL.whatsapp.trim());
});

test("un canal sin instrucciones sigue mudo aunque haya workshop", () => {
  const original = PROMPTS_POR_CANAL.messenger;
  PROMPTS_POR_CANAL.messenger = "";
  try {
    assert.equal(promptDelCanal("messenger", new Date("2026-10-06T15:00:00Z")), "");
  } finally {
    PROMPTS_POR_CANAL.messenger = original;
  }
});
