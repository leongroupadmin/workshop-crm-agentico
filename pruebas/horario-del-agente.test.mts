/**
 * Pruebas del horario en el que contesta un agente.
 *
 * Lo que se cuida es lo que en producción no se puede mirar sin esperar a que
 * sea esa hora: que el corte use la zona del equipo y no la del servidor —Vercel
 * corre en UTC, donde el viernes a la noche ya es sábado—, y que un horario mal
 * cargado no termine en un agente prendido y mudo.
 *
 * Las horas se afirman contra una zona fija —Buenos Aires, UTC-3 todo el año— y
 * con instantes en UTC, así el resultado no depende de dónde corra la prueba.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  HORARIO_SIEMPRE,
  MAX_AVISO_CHARS,
  MAX_FRANJAS,
  MINUTOS_DEL_DIA,
  avisoDeLaFila,
  contestaSiempre,
  dentroDelHorario,
  describirHorario,
  diasDelHorario,
  errorDeAviso,
  errorDeHorario,
  esTodoElDia,
  franjasDelHorario,
  hayAviso,
  horaEnTexto,
  horarioDeLaFila,
  yaSalioElAviso,
  type HorarioDelAgente,
} from "../src/lib/horario-del-agente.ts";

const ZONA = "America/Argentina/Buenos_Aires";

/** Los siete, para no repetir el arreglo en cada caso. */
const TODOS_LOS_DIAS_DE_PRUEBA = [0, 1, 2, 3, 4, 5, 6];

/** De lunes a viernes, de 9 a 18. El horario que cargaría cualquier equipo. */
const COMERCIAL: HorarioDelAgente = {
  dias: [1, 2, 3, 4, 5],
  franjas: [{ desde: 540, hasta: 1080 }],
  excluye: false,
};

/** El cortado de siempre: de 9 a 13 y de 16 a 20, con la siesta en el medio. */
const CORTADO: HorarioDelAgente = {
  dias: [1, 2, 3, 4, 5],
  franjas: [
    { desde: 540, hasta: 780 },
    { desde: 960, hasta: 1200 },
  ],
  excluye: false,
};

test("un agente sin horario configurado contesta siempre", () => {
  assert.equal(contestaSiempre(HORARIO_SIEMPRE), true);
  assert.equal(errorDeHorario(HORARIO_SIEMPRE), null);
  // El default de las columnas es éste: correr la migración no puede cambiarle
  // el comportamiento a ningún workspace.
  assert.equal(dentroDelHorario(new Date("2026-10-07T06:00:00Z"), HORARIO_SIEMPRE, ZONA), true);
});

test("dentro del horario contesta y fuera no", () => {
  // Martes 10:00 en Buenos Aires.
  assert.equal(dentroDelHorario(new Date("2026-10-06T13:00:00Z"), COMERCIAL, ZONA), true);
  // Martes 20:00: ya cerró.
  assert.equal(dentroDelHorario(new Date("2026-10-06T23:00:00Z"), COMERCIAL, ZONA), false);
  // Martes 3 de la mañana, que es el caso que motivó todo esto.
  assert.equal(dentroDelHorario(new Date("2026-10-06T06:00:00Z"), COMERCIAL, ZONA), false);
});

test("el cierre es exclusivo y la apertura no", () => {
  // 09:00 en punto: abre.
  assert.equal(dentroDelHorario(new Date("2026-10-06T12:00:00Z"), COMERCIAL, ZONA), true);
  // 18:00 en punto: ya cerró.
  assert.equal(dentroDelHorario(new Date("2026-10-06T21:00:00Z"), COMERCIAL, ZONA), false);
});

test("el horario cortado no contesta en la siesta", () => {
  // Es el caso que trajo las franjas: con una sola, un negocio de 9 a 13 y de 16
  // a 20 tenía que cargar 9 a 20 y el agente arrancaba charlas a las 14, cuando
  // no hay nadie para seguirlas.
  assert.equal(dentroDelHorario(new Date("2026-10-06T13:00:00Z"), CORTADO, ZONA), true);
  // Martes 14:00 en Buenos Aires: cerrado.
  assert.equal(dentroDelHorario(new Date("2026-10-06T17:00:00Z"), CORTADO, ZONA), false);
  // Martes 17:00: abierto otra vez.
  assert.equal(dentroDelHorario(new Date("2026-10-06T20:00:00Z"), CORTADO, ZONA), true);
  // Martes 21:00: cerró la tarde.
  assert.equal(dentroDelHorario(new Date("2026-10-07T00:00:00Z"), CORTADO, ZONA), false);
});

test("el cortado se guarda y no cuenta como todo el día", () => {
  assert.equal(errorDeHorario(CORTADO), null);
  assert.equal(esTodoElDia(CORTADO), false);
  assert.equal(contestaSiempre(CORTADO), false);
});

test("dos franjas que se pisan no se guardan", () => {
  const error = errorDeHorario({
    dias: [1],
    franjas: [
      { desde: 540, hasta: 1080 },
      { desde: 960, hasta: 1200 },
    ],
  });
  assert.ok(error);
  assert.match(error, /antes de que cierre la anterior/);
});

test("dos franjas que se tocan se guardan: son una sola más larga", () => {
  assert.equal(
    errorDeHorario({
      dias: [1],
      franjas: [
        { desde: 540, hasta: 780 },
        { desde: 780, hasta: 1080 },
      ],
    }),
    null,
  );
});

test("no se pueden cargar más franjas que el tope", () => {
  const franjas = Array.from({ length: MAX_FRANJAS + 1 }, (_, i) => ({
    desde: i * 120,
    hasta: i * 120 + 60,
  }));
  const error = errorDeHorario({ dias: [1], franjas });
  assert.ok(error);
  assert.match(error, new RegExp(String(MAX_FRANJAS)));
});

test("una franja que cubre el día entero es todo el día", () => {
  const corrido: HorarioDelAgente = {
    dias: [1],
    franjas: [{ desde: 0, hasta: MINUTOS_DEL_DIA }],
  };
  assert.equal(esTodoElDia(corrido), true);
});

test("un día que no está en la lista no contesta ni en hora", () => {
  // Sábado 10:00 en Buenos Aires.
  assert.equal(dentroDelHorario(new Date("2026-10-10T13:00:00Z"), COMERCIAL, ZONA), false);
});

test("el día lo decide la zona del equipo y no la del servidor", () => {
  // Viernes 23:00 en Buenos Aires, que en UTC ya es sábado. Con el día tomado
  // del reloj del servidor, el agente de lunes a viernes se callaría una hora
  // antes de lo que dice el panel.
  const viernesALaNoche = new Date("2026-10-10T02:00:00Z");
  assert.equal(viernesALaNoche.getUTCDay(), 6);

  const todaHoraEnSemana: HorarioDelAgente = { dias: [1, 2, 3, 4, 5], franjas: [], excluye: false };
  assert.equal(dentroDelHorario(viernesALaNoche, todaHoraEnSemana, ZONA), true);
});

test("sin ningún día marcado contesta todos", () => {
  // Es la lectura segura, la misma que los embudos del agente: no elegir es no
  // restringir. La otra —no contestar nunca— deja al agente prendido y mudo.
  const sinDias: HorarioDelAgente = { dias: [], franjas: [{ desde: 540, hasta: 1080 }] };
  assert.deepEqual(diasDelHorario(sinDias), [0, 1, 2, 3, 4, 5, 6]);
  // Domingo 10:00 en Buenos Aires.
  assert.equal(dentroDelHorario(new Date("2026-10-11T13:00:00Z"), sinDias, ZONA), true);
});

test("una franja invertida se descarta y el agente contesta igual", () => {
  // No se puede guardar desde la app —`errorDeHorario` la rechaza— pero una fila
  // cargada a mano en Supabase no puede dejar al agente mudo sin que nada lo
  // explique: descartada la única franja, no queda recorte de horas.
  const invertida: HorarioDelAgente = {
    dias: [1, 2, 3, 4, 5],
    franjas: [{ desde: 1080, hasta: 540 }],
  };
  assert.deepEqual(franjasDelHorario(invertida), []);
  assert.equal(esTodoElDia(invertida), true);
  assert.equal(dentroDelHorario(new Date("2026-10-06T06:00:00Z"), invertida, ZONA), true);
});

test("la franja mala se descarta sin llevarse la buena", () => {
  const mezcla: HorarioDelAgente = {
    dias: [1],
    franjas: [
      { desde: 960, hasta: 1200 },
      { desde: 100, hasta: Number.NaN },
    ],
  };
  // Y salen ordenadas por hora de apertura, que es como se leen y como se guardan.
  assert.deepEqual(franjasDelHorario(mezcla), [{ desde: 960, hasta: 1200 }]);
});

test("el horario que cruza la medianoche no se guarda", () => {
  const error = errorDeHorario({ dias: [1], franjas: [{ desde: 18 * 60, hasta: 2 * 60 }] });
  assert.ok(error);
  assert.match(error, /medianoche/);
});

test("un día que no es un día de la semana no se guarda", () => {
  assert.ok(errorDeHorario({ dias: [1, 9], franjas: [{ desde: 540, hasta: 1080 }] }));
});

test("los extremos del día se guardan", () => {
  const franja = (desde: number, hasta: number) => ({ dias: [1], franjas: [{ desde, hasta }] });
  assert.equal(errorDeHorario(franja(0, MINUTOS_DEL_DIA)), null);
  assert.equal(errorDeHorario(franja(1439, MINUTOS_DEL_DIA)), null);
  assert.ok(errorDeHorario(franja(0, MINUTOS_DEL_DIA + 1)));
  assert.ok(errorDeHorario(franja(-1, 1080)));
  assert.ok(errorDeHorario(franja(9.5, 1080)));
});

test("el horario se lee en una línea", () => {
  assert.equal(describirHorario(COMERCIAL), "de lunes a viernes de 09:00 a 18:00");
  assert.equal(describirHorario(HORARIO_SIEMPRE), "todos los días, a toda hora");
  assert.equal(
    describirHorario(CORTADO),
    "de lunes a viernes de 09:00 a 13:00 y de 16:00 a 20:00",
  );
  assert.equal(
    describirHorario({ dias: [0, 6], franjas: [{ desde: 600, hasta: 1290 }] }),
    "sábados y domingos de 10:00 a 21:30",
  );
  assert.equal(
    describirHorario({ dias: [2, 4], franjas: [{ desde: 540, hasta: 1080 }] }),
    "mar, jue de 09:00 a 18:00",
  );
});

test("tres franjas se leen con comas y una sola y", () => {
  assert.equal(
    describirHorario({
      dias: TODOS_LOS_DIAS_DE_PRUEBA,
      franjas: [
        { desde: 480, hasta: 600 },
        { desde: 780, hasta: 900 },
        { desde: 1080, hasta: 1200 },
      ],
    }),
    "todos los días de 08:00 a 10:00, de 13:00 a 15:00 y de 18:00 a 20:00",
  );
});

test("la hora se escribe con dos dígitos", () => {
  assert.equal(horaEnTexto(0), "00:00");
  assert.equal(horaEnTexto(540), "09:00");
  assert.equal(horaEnTexto(MINUTOS_DEL_DIA), "24:00");
});

test("una fila sin las columnas del horario contesta siempre", () => {
  // Es el escenario de la migración todavía sin correr: dejar de contestar por
  // eso sería peor que ignorar un recorte que nadie configuró.
  assert.equal(contestaSiempre(horarioDeLaFila({})), true);
  assert.equal(contestaSiempre(horarioDeLaFila(null)), true);
});

test("una fila con las franjas cargadas se lee tal cual", () => {
  const horario = horarioDeLaFila({
    dias: [1, 2, 3, 4, 5],
    franjas: [
      { desde: 540, hasta: 780 },
      { desde: 960, hasta: 1200 },
    ],
  });
  assert.deepEqual(horario, CORTADO);
  assert.equal(contestaSiempre(horario), false);
});

test("una fila con el par de horas viejo se lee como una franja", () => {
  // Es el despliegue a medias: `202610010001` corrida y `202610010003` todavía
  // no. El horario ya cargado tiene que seguir valiendo, no abrirse a toda hora.
  const horario = horarioDeLaFila({ dias: [1, 2, 3, 4, 5], hora_desde: 540, hora_hasta: 1080 });
  assert.deepEqual(horario, COMERCIAL);
});

test("el par de horas viejo que cubría el día entero no deja franja", () => {
  const horario = horarioDeLaFila({ dias: [1], hora_desde: 0, hora_hasta: MINUTOS_DEL_DIA });
  assert.deepEqual(horario.franjas, []);
  assert.equal(esTodoElDia(horario), true);
});

test("una fila con los números en texto se lee igual", () => {
  // Un `select` armado a mano o un driver que devuelve los números como texto no
  // tiene que correr el horario doce horas.
  const horario = horarioDeLaFila({ dias: ["1", "5"], franjas: [{ desde: "540", hasta: "1080" }] });
  assert.deepEqual(horario, { dias: [1, 5], franjas: [{ desde: 540, hasta: 1080 }], excluye: false });
});

test("una franja que no es una franja se descarta al leer la fila", () => {
  assert.deepEqual(horarioDeLaFila({ franjas: [null, 7, { desde: 540 }] }).franjas, []);
  assert.deepEqual(horarioDeLaFila({ franjas: "todo el día" }).franjas, []);
});

test("una fila con basura en los días se queda con los días válidos", () => {
  assert.deepEqual(horarioDeLaFila({ dias: [1, 99, null] }).dias, [1]);
  assert.deepEqual(horarioDeLaFila({ dias: "lunes" }).dias, [0, 1, 2, 3, 4, 5, 6]);
});

/* ---------------------------------------------------------------- el aviso */

test("sin texto no hay aviso: fuera de horario no sale nada", () => {
  // Es el estado con el que nace la columna, y tiene que seguir siendo el
  // silencio de antes.
  assert.equal(hayAviso(""), false);
  assert.equal(hayAviso("   \n  "), false);
  assert.equal(hayAviso(null), false);
  assert.equal(hayAviso("Te contestamos a las 9."), true);
});

test("el aviso no pasa del tope y el error dice cuánto sacar", () => {
  assert.equal(errorDeAviso("a".repeat(MAX_AVISO_CHARS)), null);
  const error = errorDeAviso("a".repeat(MAX_AVISO_CHARS + 12));
  assert.ok(error);
  assert.match(error, /12/);
});

test("el aviso no se repite si fue lo último que recibió el contacto", () => {
  const aviso = "Te leemos de lunes a viernes de 9 a 18.";
  assert.equal(yaSalioElAviso(aviso, aviso), true);
  // Los espacios de más no lo vuelven otro texto: el aviso se guarda recortado,
  // pero una fila vieja puede tenerlos.
  assert.equal(yaSalioElAviso(`  ${aviso}\n`, aviso), true);
});

test("el aviso sale si lo último que recibió fue otra cosa", () => {
  const aviso = "Te leemos de lunes a viernes de 9 a 18.";
  // Un chat sin nada saliente: nunca se avisó.
  assert.equal(yaSalioElAviso(null, aviso), false);
  // Alguien le contestó después del aviso: la charla siguió, y la próxima
  // madrugada el aviso vuelve a tener sentido.
  assert.equal(yaSalioElAviso("Hola, soy Sofía, ¿en qué te ayudo?", aviso), false);
});

test("una fila sin la columna del aviso no manda nada", () => {
  assert.equal(avisoDeLaFila({}), "");
  assert.equal(avisoDeLaFila(null), "");
  assert.equal(avisoDeLaFila({ aviso_fuera_de_horario: 7 }), "");
  assert.equal(avisoDeLaFila({ aviso_fuera_de_horario: "Abrimos a las 9." }), "Abrimos a las 9.");
});

/* ------------------------------------------------------------------- el modo */

/** El mismo mediodía, pero cargado como excepción: "no contestes de 13 a 16". */
const SIN_MEDIODIA: HorarioDelAgente = {
  dias: [1, 2, 3, 4, 5],
  franjas: [{ desde: 780, hasta: 960 }],
  excluye: true,
};

test("en modo excepción se calla adentro y contesta afuera", () => {
  // Las mismas horas que `CORTADO` dejaba abiertas, escritas al revés: una franja
  // en vez de dos, que es el punto del interruptor.
  // Martes 14:00 en Buenos Aires: adentro de la excepción, no contesta.
  assert.equal(dentroDelHorario(new Date("2026-10-06T17:00:00Z"), SIN_MEDIODIA, ZONA), false);
  // Martes 10:00 y martes 17:00: afuera, contesta.
  assert.equal(dentroDelHorario(new Date("2026-10-06T13:00:00Z"), SIN_MEDIODIA, ZONA), true);
  assert.equal(dentroDelHorario(new Date("2026-10-06T20:00:00Z"), SIN_MEDIODIA, ZONA), true);
  // Y de madrugada también contesta: la excepción no dice nada de las 3 AM.
  assert.equal(dentroDelHorario(new Date("2026-10-06T06:00:00Z"), SIN_MEDIODIA, ZONA), true);
});

test("un día que la excepción no nombra queda contestando", () => {
  // Domingo 14:00 en Buenos Aires: la excepción es de lunes a viernes.
  assert.equal(dentroDelHorario(new Date("2026-10-11T17:00:00Z"), SIN_MEDIODIA, ZONA), true);
});

test("una excepción de día entero deja el día sin atención", () => {
  // El caso "los domingos no atendemos", que en lista blanca pedía marcar los
  // otros seis días.
  const sinDomingos: HorarioDelAgente = { dias: [0], franjas: [], excluye: true };
  assert.equal(errorDeHorario(sinDomingos), null);
  assert.equal(dentroDelHorario(new Date("2026-10-11T13:00:00Z"), sinDomingos, ZONA), false);
  assert.equal(dentroDelHorario(new Date("2026-10-06T13:00:00Z"), sinDomingos, ZONA), true);
});

test("una excepción que abarca todo no se guarda: eso es el interruptor", () => {
  const error = errorDeHorario({ dias: [], franjas: [], excluye: true });
  assert.ok(error);
  assert.match(error, /interruptor/);
});

test("una excepción que abarca todo, ya guardada, no deja al agente mudo", () => {
  // Una fila cargada a mano no puede apagar al agente por la ventana de atrás:
  // se lee como que no hay nada excluido.
  const todo: HorarioDelAgente = { dias: TODOS_LOS_DIAS_DE_PRUEBA, franjas: [], excluye: true };
  assert.equal(contestaSiempre(todo), true);
  assert.equal(dentroDelHorario(new Date("2026-10-06T17:00:00Z"), todo, ZONA), true);
});

test("la excepción se lee como una excepción y no como su complemento", () => {
  assert.equal(
    describirHorario(SIN_MEDIODIA),
    "siempre, salvo de lunes a viernes de 13:00 a 16:00",
  );
  assert.equal(
    describirHorario({ dias: [0], franjas: [], excluye: true }),
    "siempre, salvo los domingos",
  );
});

test("sin la columna del modo, las franjas son cuándo contesta", () => {
  // Es el despliegue con `202610010004` todavía sin correr: lo que había
  // configurado seguía siendo una lista blanca, y así se tiene que leer.
  assert.equal(horarioDeLaFila({ franjas: [{ desde: 540, hasta: 1080 }] }).excluye, false);
  assert.equal(horarioDeLaFila({ horario_excluye: true }).excluye, true);
});
