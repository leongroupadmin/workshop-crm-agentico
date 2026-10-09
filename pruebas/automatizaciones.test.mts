/**
 * Pruebas de la lógica de las automatizaciones.
 *
 * Lo que se cuida acá es lo que en producción no se puede mirar sin esperar
 * días: que un paso no salga de madrugada, que la cuenta de "cuánto falta desde
 * el disparo" no se corra, y que una fila guardada mal se descarte en vez de
 * ejecutarse a medias sobre clientes reales.
 *
 * Las horas se afirman contra una zona fija —Buenos Aires— y con instantes en
 * UTC, así el resultado no depende de dónde corra la prueba.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  AUDIO_SIN_TRANSCRIBIR,
  GRACIA_DEL_BARRIDO_MINUTOS,
  dentroDeLaFranja,
  describirEspera,
  diagnosticarRecordatorios,
  esNotaDeVoz,
  esperaDelReintento,
  ESPERAS_DEL_REINTENTO_MINUTOS,
  leerDisparador,
  leerEtapaRequerida,
  leerPaso,
  correspondeSeguimiento,
  contarPasos,
  corridaAtrasada,
  describirRuta,
  escribirRuta,
  leerPasos,
  leerRuta,
  marcaSinLeer,
  MAX_PASOS,
  MAX_PROFUNDIDAD,
  minutosCerrados,
  minutosHastaCadaPaso,
  minutosLocales,
  minutosPorRuta,
  momentoDelRecordatorio,
  moverEn,
  insertarEn,
  quitarEn,
  reemplazarEn,
  pasoEn,
  pasoFueraDeLaVentana,
  pasosRestantes,
  peorDemora,
  profundidadDe,
  proximaApertura,
  RECORDATORIOS_SUGERIDOS,
  rutaDeLaRama,
  rutaInicial,
  rutaSiguiente,
  SILENCIO_SOSPECHOSO_DIAS,
  reemplazarTokens,
  sinMensajes,
  soloConversiones,
  validar,
  yaFrenoLaIA,
  type Paso,
  type Ruta,
} from "../src/lib/automatizaciones.ts";

const ZONA = "America/Argentina/Buenos_Aires";
/** 09:00 a 21:00, la franja por omisión. */
const FRANJA = { horaDesde: 540, horaHasta: 1260, zona: ZONA };

/* ------------------------------------------------------------------ lectura */

test("lee un disparador por etapa", () => {
  const leido = leerDisparador({ tipo: "etapa", stageId: "abc", esperaMinutos: 1440 });

  assert.deepEqual(leido, { tipo: "etapa", stageId: "abc", esperaMinutos: 1440 });
});

test("descarta el disparador por etapa sin etapa", () => {
  assert.equal(leerDisparador({ tipo: "etapa", esperaMinutos: 60 }), null);
});

test("descarta disparadores con esperas imposibles", () => {
  assert.equal(leerDisparador({ tipo: "lead_nuevo", esperaMinutos: -1 }), null);
  assert.equal(leerDisparador({ tipo: "lead_nuevo", esperaMinutos: 999_999_999 }), null);
  assert.equal(leerDisparador({ tipo: "inventado", esperaMinutos: 10 }), null);
  assert.equal(leerDisparador(null), null);
});

test("una espera de cero es válida: el disparador actúa al instante", () => {
  assert.deepEqual(leerDisparador({ tipo: "lead_nuevo", esperaMinutos: 0 }), {
    tipo: "lead_nuevo",
    esperaMinutos: 0,
  });
});

test("un paso vacío no se guarda", () => {
  assert.equal(leerPaso({ tipo: "texto", texto: "   " }), null);
  assert.equal(leerPaso({ tipo: "ia", instruccion: "" }), null);
  assert.equal(leerPaso({ tipo: "esperar", minutos: 0 }), null);
  assert.equal(leerPaso({ tipo: "mover", stageId: "" }), null);
});

test("los pasos rotos se caen sin arrastrar a los sanos", () => {
  const pasos = leerPasos([
    { tipo: "esperar", minutos: 60 },
    { tipo: "texto", texto: "" },
    null,
    { tipo: "texto", texto: "Hola" },
  ]);

  assert.deepEqual(pasos, [
    { tipo: "esperar", minutos: 60 },
    { tipo: "texto", texto: "Hola", marcarSinLeer: false },
  ]);
});

test("un paso de audio sin archivo no se guarda", () => {
  assert.equal(leerPaso({ tipo: "audio", url: "", texto: "Hola" }), null);
  assert.equal(leerPaso({ tipo: "audio", url: "   ", texto: "Hola" }), null);
  // Sin https no hay forma de que el proveedor se lo baje.
  assert.equal(leerPaso({ tipo: "audio", url: "http://x/a.ogg", texto: "" }), null);
  assert.equal(leerPaso({ tipo: "audio", url: "/local/a.ogg", texto: "" }), null);
});

test("un audio sin transcripción igual se guarda, con el texto de siempre", () => {
  assert.deepEqual(leerPaso({ tipo: "audio", url: "https://x/a.ogg", texto: "  " }), {
    tipo: "audio",
    url: "https://x/a.ogg",
    texto: AUDIO_SIN_TRANSCRIBIR,
    marcarSinLeer: false,
  });
});

test("la versión WAV de un audio se guarda si es una URL válida, y si no se descarta sola", () => {
  assert.deepEqual(
    leerPaso({ tipo: "audio", url: "https://x/a.ogg", urlWav: "https://x/a.wav", texto: "Hola" }),
    {
      tipo: "audio",
      url: "https://x/a.ogg",
      urlWav: "https://x/a.wav",
      texto: "Hola",
      marcarSinLeer: false,
    },
  );
  // Sin versión WAV el paso sigue valiendo: sale por WhatsApp igual.
  assert.deepEqual(
    leerPaso({ tipo: "audio", url: "https://x/a.ogg", urlWav: "http://x/a.wav", texto: "Hola" }),
    { tipo: "audio", url: "https://x/a.ogg", texto: "Hola", marcarSinLeer: false },
  );
});

test("la marca de sin leer se lee en los pasos que escriben, y sólo si es true", () => {
  const conMarca = { marcarSinLeer: true };

  assert.equal(marcaSinLeer(leerPaso({ tipo: "texto", texto: "Hola", ...conMarca })!), true);
  assert.equal(marcaSinLeer(leerPaso({ tipo: "ia", instruccion: "Preguntá", ...conMarca })!), true);
  assert.equal(
    marcaSinLeer(leerPaso({ tipo: "audio", url: "https://x/a.ogg", texto: "Hola", ...conMarca })!),
    true,
  );
  assert.equal(
    marcaSinLeer(leerPaso({ tipo: "plantilla", nombre: "recordatorio", ...conMarca })!),
    true,
  );

  // Cualquier cosa que no sea el booleano no alcanza: una cadena "true" que
  // llegue de una fila vieja o de un pegado a mano no tiene que marcar nada.
  assert.equal(marcaSinLeer(leerPaso({ tipo: "texto", texto: "Hola", marcarSinLeer: "true" })!), false);
  assert.equal(marcaSinLeer(leerPaso({ tipo: "texto", texto: "Hola", marcarSinLeer: 1 })!), false);
});

test("una automatización guardada antes de la marca sigue sin marcar", () => {
  // Es el caso que más importa: las filas que ya están en la base no traen el
  // campo y tienen que comportarse igual que siempre.
  assert.equal(marcaSinLeer(leerPaso({ tipo: "texto", texto: "Hola" })!), false);
  assert.equal(marcaSinLeer(leerPaso({ tipo: "ia", instruccion: "Preguntá" })!), false);
});

test("los pasos que no le escriben al contacto nunca marcan", () => {
  // Ni siquiera si alguien les mete el campo a mano: esperar, mover, avisar y
  // meta no pasan por el envío, así que no hay chat que marcar.
  assert.equal(marcaSinLeer(leerPaso({ tipo: "esperar", minutos: 60, marcarSinLeer: true })!), false);
  assert.equal(marcaSinLeer(leerPaso({ tipo: "mover", stageId: "e1", marcarSinLeer: true })!), false);
  assert.equal(marcaSinLeer(leerPaso({ tipo: "avisar", texto: "Llamar", marcarSinLeer: true })!), false);
});

test("la nota de voz se decide por la extensión del archivo guardado", () => {
  // OGG/Opus es lo único que WhatsApp muestra con la onda y el play.
  assert.equal(esNotaDeVoz("https://x/a.ogg"), true);
  assert.equal(esNotaDeVoz("https://x/a.OGG?token=1"), true);
  // El resto viaja como adjunto de audio: se escucha igual.
  assert.equal(esNotaDeVoz("https://x/a.mp3"), false);
  assert.equal(esNotaDeVoz("https://x/ogg/a.m4a"), false);
});

test("los valores de una plantilla se leen siempre como texto", () => {
  const paso = leerPaso({
    tipo: "plantilla",
    nombre: "recordatorio",
    idioma: "es_AR",
    valores: { "body.1": "{nombre}", "body.2": 42 },
  });

  assert.deepEqual(paso, {
    tipo: "plantilla",
    nombre: "recordatorio",
    idioma: "es_AR",
    // El 42 no era texto: se descarta a cadena vacía y no se cuela un número.
    valores: { "body.1": "{nombre}", "body.2": "" },
    marcarSinLeer: false,
  });
});

/* ------------------------------------------------------------------- franja */

test("la hora local sale de la zona y no de la del servidor", () => {
  // 15:00 UTC son las 12:00 en Buenos Aires (UTC-3).
  assert.equal(minutosLocales(new Date("2026-08-19T15:00:00Z"), ZONA), 12 * 60);
});

test("el mediodía está dentro de la franja y la madrugada no", () => {
  assert.equal(dentroDeLaFranja(new Date("2026-08-19T15:00:00Z"), FRANJA), true);
  // 06:00 UTC son las 03:00 en Buenos Aires.
  assert.equal(dentroDeLaFranja(new Date("2026-08-19T06:00:00Z"), FRANJA), false);
});

test("una franja de día completo llega hasta el último minuto", () => {
  // Es la franja de los recordatorios de cita: un aviso sale cuando toca, no
  // en horario comercial. El fin es exclusivo, así que el día entero es
  // [0, 1440) y 1440 tiene que ser un valor válido —la base lo rechazaba y no
  // se podía guardar ni un recordatorio.
  const todoElDia = { horaDesde: 0, horaHasta: 1440, zona: ZONA };

  // 02:59 UTC son las 23:59 en Buenos Aires: el último minuto del día.
  assert.equal(dentroDeLaFranja(new Date("2026-08-20T02:59:00Z"), todoElDia), true);
  // Y el primero.
  assert.equal(dentroDeLaFranja(new Date("2026-08-19T03:00:00Z"), todoElDia), true);
});

test("un paso de madrugada espera a que abra la franja", () => {
  // 03:00 local: faltan seis horas para las 09:00.
  const corrido = proximaApertura(new Date("2026-08-19T06:00:00Z"), FRANJA);

  assert.equal(minutosLocales(corrido, ZONA), 540);
  assert.equal(corrido.toISOString(), "2026-08-19T12:00:00.000Z");
});

test("después de cerrar, espera al día siguiente", () => {
  // 23:00 local del 19: la próxima apertura es a las 09:00 del 20.
  const corrido = proximaApertura(new Date("2026-08-20T02:00:00Z"), FRANJA);

  assert.equal(minutosLocales(corrido, ZONA), 540);
  assert.equal(corrido.toISOString(), "2026-08-20T12:00:00.000Z");
});

test("dentro de la franja no se corre nada", () => {
  const instante = new Date("2026-08-19T15:00:00Z");

  assert.equal(proximaApertura(instante, FRANJA), instante);
});

test("una franja invertida deja pasar a cualquier hora", () => {
  // La otra lectura —no enviar nunca— dejaría la automatización muda sin que
  // nada lo indique.
  const rota = { horaDesde: 1260, horaHasta: 540, zona: ZONA };

  assert.equal(dentroDeLaFranja(new Date("2026-08-19T06:00:00Z"), rota), true);
});

/* -------------------------------------------------------------------- pasos */

test("la cuenta hasta cada paso arranca en la espera del disparador", () => {
  const pasos: Paso[] = [
    { tipo: "texto", texto: "uno" },
    { tipo: "esperar", minutos: 2880 },
    { tipo: "texto", texto: "dos" },
  ];

  // 24 h del disparador, después 24 h + 2 días.
  assert.deepEqual(minutosHastaCadaPaso({ tipo: "lead_nuevo", esperaMinutos: 1440 }, pasos), [
    1440, 4320, 4320,
  ]);
});

test("avisa cuando un texto libre cae fuera de la ventana de WhatsApp", () => {
  const texto: Paso = { tipo: "texto", texto: "Hola" };
  const plantilla: Paso = { tipo: "plantilla", nombre: "x", idioma: "es", valores: {} };

  assert.equal(pasoFueraDeLaVentana(texto, 1439), false);
  assert.equal(pasoFueraDeLaVentana(texto, 1440), true);
  // Una plantilla sí puede salir tarde: es justamente para lo que sirve.
  assert.equal(pasoFueraDeLaVentana(plantilla, 100_000), false);

  // El audio va con el texto y no con la plantilla: no existe la plantilla de
  // audio, así que pasadas las 24 horas no hay canal que lo acepte.
  const audio: Paso = { tipo: "audio", url: "https://x/a.ogg", texto: "Hola" };
  assert.equal(pasoFueraDeLaVentana(audio, 1439), false);
  assert.equal(pasoFueraDeLaVentana(audio, 1440), true);
});

test("la franja cerrada cuenta contra la ventana de 24 horas", () => {
  // 9:00 a 23:30 deja 9 h 30 de noche cerrada.
  const noche = { horaDesde: 540, horaHasta: 1410 };
  assert.equal(minutosCerrados(noche), 570);

  // Un follow-up de 12 h nunca llega a las 24, ni cayendo justo al cierre.
  assert.equal(peorDemora(720, noche), 1290);

  const texto: Paso = { tipo: "texto", texto: "Hola" };
  assert.equal(pasoFueraDeLaVentana(texto, 720, noche), false);
  // 14 h 30 es el techo exacto con esta franja: un minuto más y puede no salir.
  assert.equal(pasoFueraDeLaVentana(texto, 870, noche), true);
  assert.equal(pasoFueraDeLaVentana(texto, 869, noche), false);
});

test("una franja abierta todo el día no demora nada", () => {
  const siempre = { horaDesde: 0, horaHasta: 0 };

  assert.equal(minutosCerrados(siempre), 0);
  assert.equal(peorDemora(1439, siempre), 1439);
  assert.equal(pasoFueraDeLaVentana({ tipo: "ia", instruccion: "x" }, 1439, siempre), false);
});

test("una automatización sin condición de etapa alcanza a todo el embudo", () => {
  // Es lo que devuelve una fila guardada antes de que existiera la columna: sin
  // esto, agregar la condición habría apagado todo lo que ya estaba andando.
  assert.equal(leerEtapaRequerida(undefined), null);
  assert.equal(leerEtapaRequerida(null), null);
  assert.equal(leerEtapaRequerida("   "), null);
  assert.equal(leerEtapaRequerida(42), null);
});

test("lee la etapa de la condición", () => {
  assert.equal(leerEtapaRequerida("abc"), "abc");
});

/* ---------------------------------------------------------------- validación */

const BASE = {
  name: "Seguimiento",
  disparador: { tipo: "lead_nuevo" as const, esperaMinutos: 1440 },
  etapaRequerida: null as string | null,
  horaDesde: 540,
  horaHasta: 1260,
};

test("una automatización completa se puede guardar", () => {
  assert.equal(validar({ ...BASE, pasos: [{ tipo: "texto", texto: "Hola" }] }), null);
});

test("no se guarda sin nombre, sin disparador ni sin pasos", () => {
  assert.ok(validar({ ...BASE, name: "  ", pasos: [{ tipo: "texto", texto: "a" }] }));
  assert.ok(validar({ ...BASE, disparador: null, pasos: [{ tipo: "texto", texto: "a" }] }));
  assert.ok(validar({ ...BASE, pasos: [] }));
});

test("no se guarda un paso de audio mientras no haya archivo", () => {
  // El paso se arma vacío y se llena al grabar: guardarlo antes lo haría
  // desaparecer, porque el lector lo descarta y la secuencia quedaría corta.
  const problema = validar({
    ...BASE,
    pasos: [{ tipo: "audio", url: "", texto: "" }],
  });

  assert.ok(problema?.includes("audio"), String(problema));
});

test("una secuencia que termina esperando no hace nada", () => {
  const problema = validar({
    ...BASE,
    pasos: [
      { tipo: "texto", texto: "Hola" },
      { tipo: "esperar", minutos: 60 },
    ],
  });

  assert.ok(problema?.includes("espera"), String(problema));
});

test("la franja al revés se rechaza al guardar", () => {
  const problema = validar({
    ...BASE,
    horaDesde: 1260,
    horaHasta: 540,
    pasos: [{ tipo: "texto", texto: "Hola" }],
  });

  assert.ok(problema);
});

test("la condición de etapa convive con cualquier disparador", () => {
  assert.equal(
    validar({ ...BASE, etapaRequerida: "abc", pasos: [{ tipo: "texto", texto: "Hola" }] }),
    null,
  );
});

test("entrar en una etapa y exigir otra se rechaza: no se ejecutaría nunca", () => {
  const problema = validar({
    ...BASE,
    disparador: { tipo: "etapa", stageId: "abc", esperaMinutos: 1440 },
    etapaRequerida: "xyz",
    pasos: [{ tipo: "texto", texto: "Hola" }],
  });

  assert.ok(problema?.includes("nunca"), String(problema));
});

test("entrar en una etapa y exigir la misma es redundante pero válido", () => {
  assert.equal(
    validar({
      ...BASE,
      disparador: { tipo: "etapa", stageId: "abc", esperaMinutos: 1440 },
      etapaRequerida: "abc",
      pasos: [{ tipo: "texto", texto: "Hola" }],
    }),
    null,
  );
});

/* ------------------------------------------------------------------- textos */

const CONTACTO = {
  nombre: "Juan",
  telefono: "+5491122334455",
  email: null,
  etapa: "Propuesta",
};

test("los huecos se completan con los datos del contacto", () => {
  assert.equal(
    reemplazarTokens("Hola {nombre}, seguís en {etapa}.", CONTACTO),
    "Hola Juan, seguís en Propuesta.",
  );
});

test("un hueco sin dato queda escrito, para que se vea en la vista previa", () => {
  assert.equal(reemplazarTokens("Te escribo a {email}.", CONTACTO), "Te escribo a {email}.");
  assert.equal(reemplazarTokens("Nada que ver {apellido}.", CONTACTO), "Nada que ver {apellido}.");
});

/* ------------------------------------------- huecos vacíos a la hora de mandar */

/**
 * El caso que motivó el modo `borrar`: una cita cargada a mano no tiene enlace
 * de Calendar, así que el recordatorio salía con un `{link}` literal por
 * WhatsApp.
 */
const CITA_SIN_ENLACE = {
  ...CONTACTO,
  cita: { fecha: "jueves 2 de octubre", hora: "15:30", titulo: "Visita", link: null },
};

test("al mandar, el hueco sin dato se borra en vez de salir escrito", () => {
  assert.equal(
    reemplazarTokens("Te espero el {fecha} a las {hora}. Entrá por {link}", CITA_SIN_ENLACE, "borrar"),
    "Te espero el jueves 2 de octubre a las 15:30. Entrá por",
  );
  assert.equal(reemplazarTokens("Te escribo a {email}.", CONTACTO, "borrar"), "Te escribo a.");
});

test("al mandar, el renglón que era sólo el hueco se va entero", () => {
  assert.equal(
    reemplazarTokens("Te espero a las {hora}.\n{link}\nAvisame si no llegás.", CITA_SIN_ENLACE, "borrar"),
    "Te espero a las 15:30.\nAvisame si no llegás.",
  );
});

test("al mandar, el separador que quedó sin nada atrás se va con el hueco", () => {
  assert.equal(
    reemplazarTokens("Entrá por acá: {link}", CITA_SIN_ENLACE, "borrar"),
    "Entrá por acá",
  );
  assert.equal(
    reemplazarTokens("Hola {nombre}, tu etapa es {etapa} - {email}", CONTACTO, "borrar"),
    "Hola Juan, tu etapa es Propuesta",
  );
});

test("con el enlace cargado el hueco sale igual que siempre", () => {
  const conEnlace = {
    ...CONTACTO,
    cita: { fecha: "jueves", hora: "15:30", titulo: "Visita", link: "https://meet.google.com/abc" },
  };

  assert.equal(
    reemplazarTokens("Entrá por acá: {link}", conEnlace, "borrar"),
    "Entrá por acá: https://meet.google.com/abc",
  );
});

test("borrar no toca un hueco que el motor no conoce", () => {
  assert.equal(reemplazarTokens("Nada que ver {apellido}.", CONTACTO, "borrar"), "Nada que ver {apellido}.");
});

test("las esperas se leen en la unidad que corresponde", () => {
  assert.equal(describirEspera(0), "al instante");
  assert.equal(describirEspera(45), "45 min");
  assert.equal(describirEspera(120), "2 h");
  assert.equal(describirEspera(1440), "1 d");
  assert.equal(describirEspera(2160), "1,5 d");
});

/* ------------------------------------------------- seguimiento por silencio */

/**
 * El caso que motivó la regla: el seguimiento salía, su propio mensaje pasaba a
 * ser el último del chat, y doce horas después el silencio volvía a estar
 * cumplido. El lead frío recibía dos por día hasta que alguien moviera la
 * tarjeta.
 */
const HORA = 60 * 60 * 1000;
const AHORA = Date.parse("2026-09-24T12:00:00Z");

/** Silencio de 12 h; el contacto habló por última vez hace 20 h. */
function silencio(extra: Partial<Parameters<typeof correspondeSeguimiento>[0]> = {}) {
  return correspondeSeguimiento({
    ahora: AHORA,
    esperaMinutos: 12 * 60,
    ultimoMensaje: { deElContacto: false, en: AHORA - 20 * HORA },
    ultimoMensajeDelContacto: AHORA - 20 * HORA,
    ultimaCorrida: null,
    ...extra,
  });
}

test("con el silencio cumplido y sin seguimiento previo, corresponde", () => {
  assert.equal(silencio(), true);
});

test("el seguimiento no se repite: su propio mensaje no abre un silencio nuevo", () => {
  // La corrida se anota y recién después sale el mensaje, así que queda un
  // minuto *antes* que él. Ahí estaba el bug: medido contra el último mensaje
  // del chat, ese minuto alcanzaba para que la corrida no contara y se anotara
  // otra. Medido contra la última vez que habló el contacto, no.
  assert.equal(
    silencio({
      ultimoMensaje: { deElContacto: false, en: AHORA - 13 * HORA },
      ultimaCorrida: AHORA - 13 * HORA - 60_000,
    }),
    false,
  );
});

test("si el contacto vuelve a escribir y se calla de nuevo, corresponde otro", () => {
  assert.equal(
    silencio({
      // Contestó después del seguimiento anterior y volvió a quedarse callado.
      ultimaCorrida: AHORA - 40 * HORA,
      ultimoMensajeDelContacto: AHORA - 30 * HORA,
      ultimoMensaje: { deElContacto: false, en: AHORA - 29 * HORA },
    }),
    true,
  );
});

test("si el último que habló fue el contacto, no está sin responder", () => {
  assert.equal(silencio({ ultimoMensaje: { deElContacto: true, en: AHORA - 20 * HORA } }), false);
});

test("antes de que se cumpla la espera no corresponde", () => {
  assert.equal(silencio({ ultimoMensaje: { deElContacto: false, en: AHORA - 5 * HORA } }), false);
});

test("un chat sin mensajes no tiene silencio que medir", () => {
  assert.equal(silencio({ ultimoMensaje: null }), false);
});

test("a quien nunca escribió le corresponde uno solo, no uno por cada espera", () => {
  const nuncaEscribio = { ultimoMensajeDelContacto: null };
  assert.equal(silencio({ ...nuncaEscribio, ultimaCorrida: null }), true);
  assert.equal(silencio({ ...nuncaEscribio, ultimaCorrida: AHORA - 13 * HORA - 60_000 }), false);
});

/* ------------------------------------------------- recordatorios de citas */

/**
 * El disparador `cita` es el único que mira hacia adelante.
 *
 * Los otros tres cuentan desde un hecho que ya pasó; éste cuenta desde el
 * inicio de la cita, que está en el futuro y además se puede mover. Eso cambia
 * qué es un dato mal guardado: una anticipación de cero no es "sin espera" como
 * en los demás, es un aviso que llega cuando la llamada ya empezó.
 */

const RECORDATORIO = {
  tipo: "cita" as const,
  momento: "antes" as const,
  anticipacionMinutos: 1440,
  tipoDeCita: null,
  esperaMinutos: 0,
};

test("lee un recordatorio de un día antes", () => {
  assert.deepEqual(leerDisparador(RECORDATORIO), RECORDATORIO);
});

test("lee el recordatorio que sale al agendar, y le fuerza la anticipación a cero", () => {
  // Apenas se agenda no anticipa nada. Un número guardado ahí sería una
  // anticipación que no se aplica y que en pantalla diría otra cosa.
  const leido = leerDisparador({ ...RECORDATORIO, momento: "al_agendar" });
  assert.equal(leido?.tipo, "cita");
  if (leido?.tipo !== "cita") return;
  assert.equal(leido.momento, "al_agendar");
  assert.equal(leido.anticipacionMinutos, 0);
});

test("un recordatorio sin momento o con uno inventado se descarta", () => {
  assert.equal(leerDisparador({ ...RECORDATORIO, momento: undefined }), null);
  assert.equal(leerDisparador({ ...RECORDATORIO, momento: "despues" }), null);
});

test("cero minutos antes no es un recordatorio: llega con la cita empezada", () => {
  assert.equal(leerDisparador({ ...RECORDATORIO, anticipacionMinutos: 0 }), null);
});

test("una anticipación negativa o absurda se descarta", () => {
  assert.equal(leerDisparador({ ...RECORDATORIO, anticipacionMinutos: -60 }), null);
  assert.equal(leerDisparador({ ...RECORDATORIO, anticipacionMinutos: 99_999_999 }), null);
});

test("filtra por clase de cita, y una clase inventada vale por todas", () => {
  const soloLlamadas = leerDisparador({ ...RECORDATORIO, tipoDeCita: "llamada" });
  assert.equal(soloLlamadas?.tipo === "cita" ? soloLlamadas.tipoDeCita : "", "llamada");

  const inventada = leerDisparador({ ...RECORDATORIO, tipoDeCita: "asado" });
  assert.equal(inventada?.tipo === "cita" ? inventada.tipoDeCita : "no", null);
});

test("un recordatorio con condición de etapa no se guarda: no se ejecutaría nunca", () => {
  // Quien reserva por Calendar entra como contacto y no como oportunidad, así
  // que su etapa es null y cualquier etapa exigida cancela la corrida en
  // silencio. Es la falla que no se ve: recordatorios que no llegan y ningún
  // error en ningún lado.
  const problema = validar({
    ...BASE,
    disparador: RECORDATORIO,
    etapaRequerida: "etapa-123",
    pasos: [{ tipo: "texto", texto: "Te recuerdo tu cita" }],
  });

  assert.ok(problema?.includes("etapa"), String(problema));
});

test("un recordatorio no puede mover de etapa ni repartir el lead", () => {
  const mover = validar({
    ...BASE,
    disparador: RECORDATORIO,
    pasos: [{ tipo: "mover", stageId: "etapa-123" }],
  });
  assert.ok(mover?.includes("mover"), String(mover));

  const repartir = validar({
    ...BASE,
    disparador: RECORDATORIO,
    pasos: [
      { tipo: "asignar", modo: "equitativo", candidatos: [
        { userId: "u1", dias: [1], horaDesde: 540, horaHasta: 1080, peso: 1 },
      ] },
    ],
  });
  assert.ok(repartir?.includes("repartir"), String(repartir));
});

test("un recordatorio con un texto se guarda", () => {
  assert.equal(
    validar({
      ...BASE,
      disparador: RECORDATORIO,
      pasos: [{ tipo: "texto", texto: "Mañana {fecha} a las {hora}" }],
    }),
    null,
  );
});

/* ------------------------------------------------------- tokens de la cita */

const CITA = {
  fecha: "jueves 2 de octubre",
  hora: "15:30",
  titulo: "Llamada con Juan",
  link: "https://calendar.google.com/evento",
};

test("completa los huecos de la cita", () => {
  const texto = reemplazarTokens("Hola {nombre}, te espero el {fecha} a las {hora}: {link}", {
    ...CONTACTO,
    cita: CITA,
  });

  assert.equal(
    texto,
    "Hola Juan, te espero el jueves 2 de octubre a las 15:30: https://calendar.google.com/evento",
  );
});

test("sin cita, los huecos de la cita quedan escritos y no dejan un agujero", () => {
  // Es la misma regla que para un token inventado: borrarlo dejaría un mensaje
  // con un hueco que nadie nota hasta que sale. Escrito se ve en la vista
  // previa antes de prender la automatización.
  const texto = reemplazarTokens("Tu cita del {fecha}", CONTACTO);
  assert.equal(texto, "Tu cita del {fecha}");
});

test("una cita sin enlace no borra el token del enlace", () => {
  const texto = reemplazarTokens("Entrá por {link}", {
    ...CONTACTO,
    cita: { ...CITA, link: null },
  });
  assert.equal(texto, "Entrá por {link}");
});

test("los tokens del contacto siguen funcionando igual con una cita puesta", () => {
  assert.equal(
    reemplazarTokens("{nombre} en {etapa}", { ...CONTACTO, cita: CITA }),
    "Juan en Propuesta",
  );
});

/* --------------------------------------------- cuándo sale el recordatorio */

/**
 * El cálculo que decide si un recordatorio todavía tiene sentido.
 *
 * Es el único lugar donde se resuelve el caso que rompe la intuición: una
 * reserva que entra *después* del momento del aviso. Sin la regla, un
 * recordatorio de "24 horas antes" sobre una cita reservada esta mañana para
 * esta tarde saldría al instante, diciendo "mañana" sobre algo que es hoy.
 */

/** Las 15:30 del 2 de octubre, en UTC, para no depender de dónde corra esto. */
const INICIO = new Date("2026-10-02T18:30:00.000Z");
const UN_DIA_ANTES = { ...RECORDATORIO, anticipacionMinutos: 1440 };

test("un recordatorio de un día antes sale 24 horas antes del inicio", () => {
  // Dos días antes de la cita: el momento todavía no llegó.
  const ahora = INICIO.getTime() - 48 * 60 * 60_000;
  const corre = momentoDelRecordatorio(UN_DIA_ANTES, INICIO, ahora);

  assert.equal(corre?.toISOString(), "2026-10-01T18:30:00.000Z");
});

test("una reserva que entra tarde no manda el aviso de 24 horas: ese momento nunca existió", () => {
  // Reservan a las 11 para las 15:30 del mismo día. El aviso de "un día antes"
  // corresponde a ayer.
  const ahora = INICIO.getTime() - 4 * 60 * 60_000;

  assert.equal(momentoDelRecordatorio(UN_DIA_ANTES, INICIO, ahora), null);
});

test("un momento recién vencido entra por la tolerancia, y sale ahora y no en el pasado", () => {
  // El cron no corre al segundo: cinco minutos de atraso sobre un aviso de una
  // hora antes sigue sirviendo.
  const unaHoraAntes = { ...RECORDATORIO, anticipacionMinutos: 60 };
  const ahora = INICIO.getTime() - 55 * 60_000;
  const corre = momentoDelRecordatorio(unaHoraAntes, INICIO, ahora);

  assert.equal(corre?.getTime(), ahora, "tiene que salir ahora, no cinco minutos atrás");
});

test("pasada la tolerancia ya no sale", () => {
  const unaHoraAntes = { ...RECORDATORIO, anticipacionMinutos: 60 };
  const ahora = INICIO.getTime() - 40 * 60_000;

  assert.equal(momentoDelRecordatorio(unaHoraAntes, INICIO, ahora), null);
});

test("el de al agendar sale ahora, sin importar cuándo sea la cita", () => {
  const alAgendar = { ...RECORDATORIO, momento: "al_agendar" as const, anticipacionMinutos: 0 };
  const ahora = INICIO.getTime() - 30 * 24 * 60 * 60_000;

  assert.equal(momentoDelRecordatorio(alAgendar, INICIO, ahora)?.getTime(), ahora);
});

test("los tres recordatorios sugeridos se pueden guardar tal como vienen", () => {
  // La Agenda los ofrece con un botón, y quien lo aprieta espera que Guardar
  // funcione. Un default que el validador rechaza sería un callejón sin salida:
  // la pantalla lo propone y después no lo acepta.
  assert.equal(RECORDATORIOS_SUGERIDOS.length, 3);

  for (const sugerido of RECORDATORIOS_SUGERIDOS) {
    const disparador = leerDisparador({
      tipo: "cita",
      momento: sugerido.momento,
      anticipacionMinutos: sugerido.anticipacionMinutos,
      tipoDeCita: null,
      esperaMinutos: 0,
    });
    assert.ok(disparador, `no se leyó el disparador de ${sugerido.momento}`);

    // Las mismas condiciones que arma `saveReminders`.
    assert.equal(
      validar({
        name: "Recordatorio",
        disparador,
        etapaRequerida: null,
        pasos: [{ tipo: "texto", texto: sugerido.texto }],
        horaDesde: 0,
        horaHasta: 1440,
      }),
      null,
      `el sugerido de ${sugerido.momento} no pasó la validación`,
    );
  }
});

test("los textos sugeridos no nombran el plazo que se edita al lado", () => {
  // "mañana" o "en una hora" quedan mintiendo en cuanto alguien cambia la
  // anticipación, y nadie vuelve a leer el texto después de tocar el número.
  for (const sugerido of RECORDATORIOS_SUGERIDOS) {
    assert.doesNotMatch(sugerido.texto, /mañana|en una hora|en 24|24 horas/i);
  }
});

test("cada texto sugerido usa sólo huecos que existen", () => {
  const conocidos = new Set(["nombre", "telefono", "email", "etapa", "fecha", "hora", "cita", "link"]);
  for (const sugerido of RECORDATORIOS_SUGERIDOS) {
    for (const [, hueco] of sugerido.texto.matchAll(/\{([a-z]+)\}/g)) {
      assert.ok(conocidos.has(hueco), `{${hueco}} no es un hueco que se reemplace`);
    }
  }
});

/* ------------------------------------------ corridas que nadie atendió */

const MIRADO_A_LAS = Date.parse("2026-10-05T01:00:00-03:00");

test("una corrida vencida hace rato cuenta como atrasada", () => {
  // Es la que se mostraba como "en curso" con el lead sin dueño: anotada para
  // ya, y el reloj sin pasar.
  const hace = new Date(MIRADO_A_LAS - (GRACIA_DEL_BARRIDO_MINUTOS + 1) * 60_000).toISOString();
  assert.equal(corridaAtrasada(hace, MIRADO_A_LAS), true);
});

test("una corrida recién vencida todavía no acusa al reloj", () => {
  // El cron pasa cada cinco minutos: lo anotado hace dos todavía no tuvo vuelta.
  const recien = new Date(MIRADO_A_LAS - 2 * 60_000).toISOString();
  assert.equal(corridaAtrasada(recien, MIRADO_A_LAS), false);
});

test("una corrida que espera su hora no está atrasada", () => {
  const manana = new Date(MIRADO_A_LAS + 24 * 60 * 60_000).toISOString();
  assert.equal(corridaAtrasada(manana, MIRADO_A_LAS), false);
});

test("una hora ilegible no prende el cartel", () => {
  assert.equal(corridaAtrasada(null, MIRADO_A_LAS), false);
  assert.equal(corridaAtrasada("cualquier cosa", MIRADO_A_LAS), false);
});

/* ------------------------------- el diagnóstico de los recordatorios */

const REVISADO_A_LAS = Date.parse("2026-09-28T12:00:00-03:00");
const SANO = {
  prendidos: 3,
  ultimoAviso: new Date(REVISADO_A_LAS - 2 * 60 * 60_000).toISOString(),
  citasProximas: 4,
  desatendidas: 0,
  revisadas: 4,
};

test("todo en orden no prende ningún cartel", () => {
  const diagnostico = diagnosticarRecordatorios(SANO, REVISADO_A_LAS);
  assert.equal(diagnostico.nivel, "ok");
  assert.match(diagnostico.mensaje, /4 citas próximas/);
});

test("una cita próxima sin corrida anotada acusa al reloj", () => {
  // Es el caso que justifica todo el diagnóstico: el cron sin programar se ve
  // idéntico a que todo funcione, hasta que un cliente no recibe el aviso.
  const diagnostico = diagnosticarRecordatorios({ ...SANO, desatendidas: 2 }, REVISADO_A_LAS);
  assert.equal(diagnostico.nivel, "alarma");
  assert.match(diagnostico.mensaje, /reloj/);
});

test("la alarma del reloj se escribe en singular cuando es una sola", () => {
  const diagnostico = diagnosticarRecordatorios({ ...SANO, desatendidas: 1 }, REVISADO_A_LAS);
  assert.match(diagnostico.mensaje, /Hay una cita próxima/);
});

test("la alarma del reloj gana sobre cualquier otro aviso", () => {
  // Con el reloj parado, los demás carteles son consecuencias: el que hay que
  // leer primero es el que se puede arreglar.
  const diagnostico = diagnosticarRecordatorios(
    { prendidos: 0, ultimoAviso: null, citasProximas: 9, desatendidas: 3 },
    REVISADO_A_LAS,
  );
  assert.equal(diagnostico.nivel, "alarma");
});

test("sin recordatorios prendidos se dice que no se manda nada", () => {
  const diagnostico = diagnosticarRecordatorios({ ...SANO, prendidos: 0 }, REVISADO_A_LAS);
  assert.equal(diagnostico.nivel, "aviso");
  assert.match(diagnostico.mensaje, /no se manda nada/);
});

test("que todavía no haya bajado una cita no es un aviso", () => {
  // Es igual de cierto con n8n roto que con nadie que haya reservado. Pintarlo
  // de ámbar enseña a ignorar el ámbar, y entonces el día que la alarma sea de
  // verdad tampoco se mira.
  const diagnostico = diagnosticarRecordatorios({ ...SANO, ultimoAviso: null }, REVISADO_A_LAS);

  assert.equal(diagnostico.nivel, "ok");
  assert.doesNotMatch(diagnostico.mensaje, /n8n/);
});

test("no afirma que el aviso está anotado sobre citas que no miró", () => {
  // Una cita recién bajada de Calendar todavía no pasó por ningún barrido. El
  // cartel las cuenta, pero no puede decir que tienen su corrida: decirlo es
  // justo lo que haría confiar de más en el momento en que menos se sabe.
  const reciente = diagnosticarRecordatorios({ ...SANO, revisadas: 0 }, REVISADO_A_LAS);

  assert.equal(reciente.nivel, "ok");
  assert.doesNotMatch(reciente.mensaje, /anotado/);
  assert.match(reciente.mensaje, /4 citas próximas/);

  // Con al menos una revisada sí lo afirma, porque ahí lo comprobó.
  const revisada = diagnosticarRecordatorios(SANO, REVISADO_A_LAS);
  assert.match(revisada.mensaje, /con su aviso anotado/);
});

test("un silencio largo avisa sin afirmar de quién es la culpa", () => {
  // Desde el CRM no se puede distinguir "no hubo reservas" de "n8n se cayó", y
  // el cartel no tiene que elegir una de las dos: tiene que mandar a mirar.
  const diagnostico = diagnosticarRecordatorios(
    {
      ...SANO,
      ultimoAviso: new Date(REVISADO_A_LAS - (SILENCIO_SOSPECHOSO_DIAS + 1) * 24 * 60 * 60_000).toISOString(),
    },
    REVISADO_A_LAS,
  );
  assert.equal(diagnostico.nivel, "aviso");
  assert.match(diagnostico.mensaje, /no haya reservas/);
});

test("un silencio corto no se reporta", () => {
  const diagnostico = diagnosticarRecordatorios(
    {
      ...SANO,
      ultimoAviso: new Date(REVISADO_A_LAS - (SILENCIO_SOSPECHOSO_DIAS - 1) * 24 * 60 * 60_000).toISOString(),
    },
    REVISADO_A_LAS,
  );
  assert.equal(diagnostico.nivel, "ok");
});

test("una agenda vacía está en orden, no en falta", () => {
  // Sin citas próximas no hay nada que anotar: llamarlo problema sería un
  // cartel encendido todos los lunes.
  const diagnostico = diagnosticarRecordatorios({ ...SANO, citasProximas: 0 }, REVISADO_A_LAS);
  assert.equal(diagnostico.nivel, "ok");
  assert.match(diagnostico.mensaje, /No hay citas próximas/);
});

test("un ultimoAviso ilegible no rompe el diagnóstico", () => {
  const diagnostico = diagnosticarRecordatorios({ ...SANO, ultimoAviso: "no es una fecha" }, REVISADO_A_LAS);
  assert.equal(diagnostico.nivel, "ok");
});

/* ------------------------------------------ reintentos de un envío */

test("el primer fallo se reintenta enseguida y las esperas crecen", () => {
  // Crecen para cubrir cortes cada vez más largos sin insistirle a algo que
  // claramente no está.
  assert.equal(esperaDelReintento(1), 5);
  assert.equal(esperaDelReintento(2), 15);
  assert.equal(esperaDelReintento(3), 45);

  const esperas = [...ESPERAS_DEL_REINTENTO_MINUTOS];
  for (let i = 1; i < esperas.length; i += 1) {
    assert.ok(esperas[i] > esperas[i - 1], "las esperas tienen que crecer");
  }
});

test("después del último intento se abandona", () => {
  // Null es "cerrala como fallada". Sin este corte, una corrida rota se
  // reintentaría para siempre y ocuparía lugar en cada vuelta del cron.
  assert.equal(esperaDelReintento(ESPERAS_DEL_REINTENTO_MINUTOS.length + 1), null);
  assert.equal(esperaDelReintento(99), null);
});

test("no se insiste más de una hora larga en total", () => {
  // Pasado ese rato ya no es un problema de red, es uno que hay que ir a
  // mirar. Y un recordatorio muy tardío no sirve: la cita ya pasó.
  const total = ESPERAS_DEL_REINTENTO_MINUTOS.reduce((suma, minutos) => suma + minutos, 0);
  assert.ok(total <= 90, `el total no puede pasar de 90 min, da ${total}`);
});

test("un contador raro no deja la corrida sin reintento", () => {
  // Una fila vieja puede no tener la columna cargada. Que eso la dé por
  // perdida en el primer fallo sería el bug que este reintento viene a
  // arreglar, otra vez.
  assert.equal(esperaDelReintento(0), 5);
  assert.equal(esperaDelReintento(-1), 5);
  assert.equal(esperaDelReintento(Number.NaN), 5);
});

/* ------------------------------------------------------------------- ramas */

/**
 * Lo que se cuida acá es que el árbol no pierda ni repita pasos.
 *
 * El recorrido es la parte del motor que no se puede mirar en producción:
 * una rama que vuelve al paso de arriba le manda el mismo mensaje dos veces al
 * mismo cliente, y una que termina antes de tiempo lo deja sin el seguimiento.
 * Ninguna de las dos avisa; las dos se ven días después.
 */

const TEXTO: Paso = { tipo: "texto", texto: "Hola" };
const OTRO: Paso = { tipo: "texto", texto: "Chau" };
const META: Paso = { tipo: "meta", evento: "QualifiedLead", conValor: false };

function espera(minutos: number): Paso {
  return { tipo: "esperar", minutos };
}

function condicion(siSi: Paso[], siNo: Paso[]): Paso {
  return { tipo: "condicion", prueba: { tipo: "etapa", stageIds: ["ganado"] }, siSi, siNo };
}

/** `[texto, condicion([A, B], [C]), D]`, el árbol de casi todas las pruebas. */
const A: Paso = { tipo: "texto", texto: "A" };
const B: Paso = { tipo: "texto", texto: "B" };
const C: Paso = { tipo: "texto", texto: "C" };
const D: Paso = { tipo: "texto", texto: "D" };
const ARBOL: Paso[] = [TEXTO, condicion([A, B], [C]), D];

test("una ruta se escribe y se vuelve a leer igual", () => {
  const ruta: Ruta = [2, "si", 1];
  assert.equal(escribirRuta(ruta), "2.si.1");
  assert.deepEqual(leerRuta("2.si.1"), ruta);
  assert.deepEqual(leerRuta("0"), [0]);
});

test("una ruta mal escrita se lee vacía en vez de apuntar a cualquier lado", () => {
  // Vacía quiere decir "esta corrida no sabe dónde está", y el motor la
  // cancela. Devolver `[0]` la haría arrancar de nuevo y repetir los envíos.
  assert.deepEqual(leerRuta("2.quizas.1"), []);
  assert.deepEqual(leerRuta("2.si"), []);
  assert.deepEqual(leerRuta("-1"), []);
  assert.deepEqual(leerRuta("a.si.0"), []);
  assert.deepEqual(leerRuta(""), []);
  assert.deepEqual(leerRuta(null), []);
});

test("pasoEn encuentra el paso de cada rama", () => {
  assert.deepEqual(pasoEn(ARBOL, [0]), TEXTO);
  assert.deepEqual(pasoEn(ARBOL, [1, "si", 1]), B);
  assert.deepEqual(pasoEn(ARBOL, [1, "no", 0]), C);
  assert.deepEqual(pasoEn(ARBOL, [2]), D);
});

test("una ruta que ya no existe no devuelve otro paso", () => {
  assert.equal(pasoEn(ARBOL, [9]), null);
  assert.equal(pasoEn(ARBOL, [1, "si", 5]), null);
  // El paso 0 no es una condición: no tiene ramas donde meterse.
  assert.equal(pasoEn(ARBOL, [0, "si", 0]), null);
  assert.equal(pasoEn(ARBOL, []), null);
});

test("el recorrido avanza y, cuando la rama se acaba, sigue después de la condición", () => {
  assert.deepEqual(rutaInicial(ARBOL), [0]);
  assert.deepEqual(rutaSiguiente(ARBOL, [0]), [1]);
  assert.deepEqual(rutaSiguiente(ARBOL, [1, "si", 0]), [1, "si", 1]);
  // Último de la rama del sí: sale de la rama y sigue con lo de después.
  assert.deepEqual(rutaSiguiente(ARBOL, [1, "si", 1]), [2]);
  assert.deepEqual(rutaSiguiente(ARBOL, [1, "no", 0]), [2]);
  // El final del todo.
  assert.equal(rutaSiguiente(ARBOL, [2]), null);
});

test("una rama vacía no corta la secuencia: sigue después de la condición", () => {
  const pasos: Paso[] = [condicion([A], []), D];
  assert.deepEqual(rutaDeLaRama(pasos, [0], "si"), [0, "si", 0]);
  assert.deepEqual(rutaDeLaRama(pasos, [0], "no"), [1]);
});

test("una condición al final con la rama vacía termina la secuencia", () => {
  const pasos: Paso[] = [condicion([A], [])];
  assert.equal(rutaDeLaRama(pasos, [0], "no"), null);
});

test("las dos ramas anidadas se recorren enteras y en orden", () => {
  // La del sí tiene adentro otra condición: sin subir dos niveles al terminar,
  // el último paso del árbol nunca se ejecutaría.
  const pasos: Paso[] = [condicion([condicion([A], [B])], [C]), D];

  assert.deepEqual(rutaSiguiente(pasos, [0, "si", 0, "si", 0]), [1]);
  assert.deepEqual(rutaSiguiente(pasos, [0, "si", 0, "no", 0]), [1]);
  assert.deepEqual(rutaSiguiente(pasos, [0, "no", 0]), [1]);
});

test("lo que queda por ejecutar incluye las dos ramas, porque todavía no se sabe cuál", () => {
  assert.deepEqual(pasosRestantes(ARBOL, [1]), [ARBOL[1], A, B, C, D]);
  assert.deepEqual(pasosRestantes(ARBOL, [1, "si", 1]), [B, D]);
  assert.deepEqual(pasosRestantes(ARBOL, [2]), [D]);
  assert.deepEqual(pasosRestantes(ARBOL, [0]), [TEXTO, ARBOL[1], A, B, C, D]);
});

test("un mensaje escondido en una rama no deja la secuencia muda", () => {
  // De esto depende que la franja horaria y el corte por respuesta se
  // apliquen: si se diera por muda, un texto saldría de madrugada.
  assert.equal(sinMensajes(pasosRestantes([condicion([TEXTO], [])], [0])), false);
  assert.equal(sinMensajes(pasosRestantes([condicion([META], [espera(5)])], [0])), true);
});

test("una condición entre conversiones sigue siendo sólo conversiones", () => {
  assert.equal(soloConversiones(pasosRestantes([condicion([META], [META])], [0])), true);
  assert.equal(soloConversiones(pasosRestantes([condicion([META], [TEXTO])], [0])), false);
});

test("los minutos se acumulan dentro de la rama y después sigue el peor camino", () => {
  const pasos: Paso[] = [espera(30), condicion([espera(60), A], [B]), D];
  const minutos = minutosPorRuta({ tipo: "lead_nuevo", esperaMinutos: 60 }, pasos);

  assert.equal(minutos.get("0"), 90);
  assert.equal(minutos.get("1"), 90);
  assert.equal(minutos.get("1.si.0"), 150);
  assert.equal(minutos.get("1.si.1"), 150);
  // La rama del no no esperó nada.
  assert.equal(minutos.get("1.no.0"), 90);
  // Después de la condición manda la rama más lenta: un paso que puede caer
  // fuera de las 24 horas por un camino tiene que avisarlo igual.
  assert.equal(minutos.get("2"), 150);
});

test("contar pasos y profundidad mira el árbol entero", () => {
  assert.equal(contarPasos(ARBOL), 6);
  assert.equal(profundidadDe(ARBOL), 1);
  assert.equal(profundidadDe([TEXTO, OTRO]), 0);
  assert.equal(profundidadDe([condicion([condicion([A], [B])], [])]), 2);
});

/* ------------------------------------------------------- lectura de las ramas */

test("lee una condición con sus dos ramas", () => {
  const leido = leerPaso({
    tipo: "condicion",
    prueba: { tipo: "etapa", stageIds: ["ganado", "perdido"] },
    siSi: [{ tipo: "texto", texto: "Hola" }],
    siNo: [{ tipo: "esperar", minutos: 60 }],
  });

  assert.deepEqual(leido, {
    tipo: "condicion",
    prueba: { tipo: "etapa", stageIds: ["ganado", "perdido"] },
    siSi: [{ tipo: "texto", texto: "Hola", marcarSinLeer: false }],
    siNo: [{ tipo: "esperar", minutos: 60 }],
  });
});

test("lee las pruebas que no llevan datos", () => {
  // El lector le completa `marcarSinLeer` al texto, igual que a cualquier otro.
  const texto = { tipo: "texto", texto: "Hola", marcarSinLeer: false };

  for (const tipo of ["respondio", "ventana", "con_responsable"]) {
    const leido = leerPaso({ tipo: "condicion", prueba: { tipo }, siSi: [TEXTO], siNo: [] });
    assert.deepEqual(leido, { tipo: "condicion", prueba: { tipo }, siSi: [texto], siNo: [] });
  }
});

test("una condición que no decide nada se descarta", () => {
  // Las dos ramas vacías: el motor la saltearía igual, y así la pantalla no
  // muestra un paso que no existe.
  assert.equal(leerPaso({ tipo: "condicion", prueba: { tipo: "ventana" }, siSi: [], siNo: [] }), null);
  // Sin etapas, la prueba sería siempre falsa.
  assert.equal(
    leerPaso({ tipo: "condicion", prueba: { tipo: "etapa", stageIds: [] }, siSi: [TEXTO], siNo: [] }),
    null,
  );
  // Una prueba que no se entiende no tiene rama por defecto razonable.
  assert.equal(
    leerPaso({ tipo: "condicion", prueba: { tipo: "la_luna" }, siSi: [TEXTO], siNo: [] }),
    null,
  );
  assert.equal(leerPaso({ tipo: "condicion", siSi: [TEXTO], siNo: [] }), null);
});

test("las etapas repetidas de una prueba se guardan una sola vez", () => {
  const leido = leerPaso({
    tipo: "condicion",
    prueba: { tipo: "etapa", stageIds: ["ganado", "ganado", "  ", "perdido"] },
    siSi: [TEXTO],
    siNo: [],
  });

  assert.equal(leido?.tipo, "condicion");
  assert.deepEqual(
    leido?.tipo === "condicion" && leido.prueba.tipo === "etapa" ? leido.prueba.stageIds : null,
    ["ganado", "perdido"],
  );
});

test("un anidado más profundo que el tope se descarta en vez de tumbar la pila", () => {
  // `leerPasos` es recursivo y come jsonb de la base y objetos del navegador.
  // Cuatro condiciones encajadas: la última queda sin ramas y se cae sola.
  let crudo: unknown = { tipo: "condicion", prueba: { tipo: "ventana" }, siSi: [TEXTO], siNo: [] };
  for (let i = 0; i < 3; i += 1) {
    crudo = { tipo: "condicion", prueba: { tipo: "ventana" }, siSi: [crudo], siNo: [TEXTO] };
  }

  const pasos = leerPasos([crudo]);
  assert.equal(profundidadDe(pasos) <= MAX_PROFUNDIDAD, true);
});

test("una ruta se nombra para que se entienda en un error", () => {
  assert.equal(describirRuta([2]), "Paso 3");
  assert.equal(describirRuta([2, "si", 0]), "Paso 3 › Sí › Paso 1");
  assert.equal(describirRuta([0, "no", 1]), "Paso 1 › No › Paso 2");
});

/* ----------------------------------------------- validación con ramas */

test("un árbol bien armado se puede guardar", () => {
  assert.equal(validar({ ...BASE, pasos: [condicion([TEXTO], [OTRO])] }), null);
  assert.equal(validar({ ...BASE, pasos: [condicion([TEXTO], []), OTRO] }), null);
});

test("una condición sin pasos en ninguna rama no se guarda", () => {
  assert.ok(validar({ ...BASE, pasos: [condicion([], []), TEXTO] }));
});

test("una condición de etapa sin etapas no se guarda", () => {
  const vacia: Paso = {
    tipo: "condicion",
    prueba: { tipo: "etapa", stageIds: [] },
    siSi: [TEXTO],
    siNo: [],
  };
  assert.ok(validar({ ...BASE, pasos: [vacia] }));
});

test("una rama que termina en una espera no se guarda", () => {
  // La espera sería el último paso de ese camino: la corrida se dormiría para
  // despertar a no hacer nada.
  const problema = validar({ ...BASE, pasos: [condicion([TEXTO, espera(60)], [OTRO])] });
  assert.ok(problema);
  assert.match(problema ?? "", /rama/i);

  // Con algo después de la condición, esa misma espera sí tiene sentido.
  assert.equal(validar({ ...BASE, pasos: [condicion([TEXTO, espera(60)], [OTRO]), D] }), null);
});

test("el tope de pasos cuenta los de todas las ramas", () => {
  const muchos = Array.from({ length: MAX_PASOS }, () => TEXTO);
  // La condición más sus ramas pasa el tope por uno.
  assert.ok(validar({ ...BASE, pasos: [condicion(muchos, [])] }));
  assert.equal(
    validar({ ...BASE, pasos: [condicion(muchos.slice(0, MAX_PASOS - 1), [])] }),
    null,
  );
});

test("no se pueden anidar más condiciones que el tope", () => {
  let paso: Paso = condicion([TEXTO], []);
  for (let i = 0; i < MAX_PROFUNDIDAD; i += 1) paso = condicion([paso], []);

  assert.ok(validar({ ...BASE, pasos: [paso] }));
});

test("un paso escondido en una rama rompe un recordatorio igual que uno de arriba", () => {
  // `mover` no hace nada en un recordatorio: quien reserva por Calendar no
  // tiene tarjeta en el embudo. Escondido en una rama rompe lo mismo.
  const problema = validar({
    ...BASE,
    disparador: { tipo: "cita", momento: "antes", anticipacionMinutos: 60, tipoDeCita: null, esperaMinutos: 0 },
    pasos: [condicion([{ tipo: "mover", stageId: "ganado" }], [TEXTO])],
  });

  assert.ok(problema);
  assert.match(problema ?? "", /mover de etapa/i);
});

test("un audio vacío escondido en una rama tampoco se guarda", () => {
  const problema = validar({
    ...BASE,
    pasos: [condicion([{ tipo: "audio", url: "", texto: "" }], [TEXTO])],
  });

  assert.ok(problema);
  assert.match(problema ?? "", /audio/i);
});

/* ------------------------------------------------- editar el árbol por ruta */

/**
 * Lo que se cuida acá es que tocar una rama no mueva la otra.
 *
 * El lienzo edita por ruta: el `+` de una línea inserta en la posición de
 * abajo, el tacho borra un nodo con todo lo que cuelga. Un índice mal contado
 * mete el paso en la rama equivocada, y eso en pantalla se ve igual de
 * prolijo que si estuviera bien.
 */

test("reemplazar cambia sólo el paso de esa ruta", () => {
  const cambiado = reemplazarEn(ARBOL, [1, "si", 1], OTRO);

  assert.deepEqual(pasoEn(cambiado, [1, "si", 1]), OTRO);
  // Los vecinos quedan como estaban.
  assert.deepEqual(pasoEn(cambiado, [1, "si", 0]), A);
  assert.deepEqual(pasoEn(cambiado, [1, "no", 0]), C);
  assert.deepEqual(pasoEn(cambiado, [2]), D);
  // Y el original no se tocó.
  assert.deepEqual(pasoEn(ARBOL, [1, "si", 1]), B);
});

test("insertar empuja para abajo al que estaba en esa posición", () => {
  const conNuevo = insertarEn(ARBOL, [1, "si", 0], OTRO);

  assert.deepEqual(pasoEn(conNuevo, [1, "si", 0]), OTRO);
  assert.deepEqual(pasoEn(conNuevo, [1, "si", 1]), A);
  assert.deepEqual(pasoEn(conNuevo, [1, "si", 2]), B);
  assert.equal(contarPasos(conNuevo), contarPasos(ARBOL) + 1);
});

test("insertar con el largo de la lista agrega al final", () => {
  const alFinal = insertarEn(ARBOL, [3], OTRO);
  assert.deepEqual(pasoEn(alFinal, [3]), OTRO);

  // En una rama vacía, que es como el lienzo le agrega el primer paso.
  const pasos: Paso[] = [condicion([A], [])];
  const conRama = insertarEn(pasos, [0, "no", 0], OTRO);
  assert.deepEqual(pasoEn(conRama, [0, "no", 0]), OTRO);
});

test("una ruta que no existe deja el árbol como estaba", () => {
  // Perder el cambio es preferible a escribirlo en otra rama.
  assert.deepEqual(insertarEn(ARBOL, [9, "si", 0], OTRO), ARBOL);
  assert.deepEqual(insertarEn(ARBOL, [0, "si", 0], OTRO), ARBOL);
  assert.deepEqual(insertarEn(ARBOL, [1, "si", 7], OTRO), ARBOL);
  assert.deepEqual(reemplazarEn(ARBOL, [2, "no", 0], OTRO), ARBOL);
});

test("quitar una condición se lleva sus dos ramas", () => {
  const sinCondicion = quitarEn(ARBOL, [1]);

  assert.deepEqual(sinCondicion, [TEXTO, D]);
  assert.equal(contarPasos(sinCondicion), 2);
});

test("quitar un paso de una rama no toca la otra", () => {
  const sinA = quitarEn(ARBOL, [1, "si", 0]);

  assert.deepEqual(pasoEn(sinA, [1, "si", 0]), B);
  assert.deepEqual(pasoEn(sinA, [1, "no", 0]), C);
  assert.deepEqual(pasoEn(sinA, [2]), D);
});

test("mover un paso lo cambia de lugar dentro de su propia lista", () => {
  const dadoVuelta = moverEn(ARBOL, [1, "si", 1], -1);

  assert.deepEqual(pasoEn(dadoVuelta, [1, "si", 0]), B);
  assert.deepEqual(pasoEn(dadoVuelta, [1, "si", 1]), A);
});

test("un paso no se escapa de su rama al moverlo", () => {
  // El primero de la rama no sube al nivel de arriba: quedaría antes de la
  // condición que lo puso ahí, y la secuencia diría otra cosa.
  assert.deepEqual(moverEn(ARBOL, [1, "si", 0], -1), ARBOL);
  assert.deepEqual(moverEn(ARBOL, [1, "no", 0], 1), ARBOL);
});

/* ------------------------------------------------------------ parar la IA */

const FRENAR: Paso = { tipo: "frenar_ia" };

test("parar la IA se guarda y se lee sin campos", () => {
  assert.deepEqual(leerPaso({ tipo: "frenar_ia", sobra: 1 }), FRENAR);
  assert.equal(validar({ ...BASE, pasos: [TEXTO, FRENAR] }), null);
});

test("parar la IA no le escribe al contacto: no espera la franja ni se corta por respuesta", () => {
  assert.equal(sinMensajes([FRENAR]), true);
  assert.equal(sinMensajes([FRENAR, TEXTO]), false);
  assert.equal(marcaSinLeer(FRENAR), false);
});

test("la corrida sabe que la IA la frenó ella misma", () => {
  const pasos: Paso[] = [TEXTO, FRENAR, espera(60), OTRO];

  // Sin esto, el texto de después de la espera se cancelaba con "alguien tomó
  // la conversación a mano", cuando la frenó la propia secuencia.
  assert.equal(yaFrenoLaIA(pasos, [3]), true);
  assert.equal(yaFrenoLaIA(pasos, [2]), true);
  // El paso mismo y lo de antes todavía no la frenaron.
  assert.equal(yaFrenoLaIA(pasos, [1]), false);
  assert.equal(yaFrenoLaIA(pasos, [0]), false);
});

test("frenar antes de una condición vale para las dos ramas", () => {
  const pasos: Paso[] = [FRENAR, condicion([espera(5), A], [B])];

  assert.equal(yaFrenoLaIA(pasos, [1, "si", 1]), true);
  assert.equal(yaFrenoLaIA(pasos, [1, "no", 0]), true);
});

test("frenar adentro de una rama vale sólo para esa rama", () => {
  const pasos: Paso[] = [condicion([FRENAR, espera(5), A], [espera(5), B])];

  assert.equal(yaFrenoLaIA(pasos, [0, "si", 2]), true);
  assert.equal(yaFrenoLaIA(pasos, [0, "no", 1]), false);
});

test("un frenar en una condición que quedó atrás no cuenta: no se sabe por qué rama pasó", () => {
  const pasos: Paso[] = [condicion([FRENAR], [B]), espera(5), D];

  assert.equal(yaFrenoLaIA(pasos, [2]), false);
});
