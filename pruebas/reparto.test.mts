/**
 * Pruebas del reparto de leads.
 *
 * Lo que se cuida acá es lo que en producción se nota tarde y mal: que un lead
 * le caiga a alguien que está de franco, que la rotación se trabe siempre en la
 * misma persona, o que sacar a alguien de la lista corra el turno de todos los
 * demás.
 *
 * Las horas se afirman contra Buenos Aires con instantes en UTC, igual que en
 * el resto del módulo, así el resultado no depende de dónde corra la prueba.
 */
import assert from "node:assert";
import { test } from "node:test";

import {
  candidatoDisponible,
  diaLocal,
  disponibles,
  elegirResponsable,
  leerPaso,
  sinMensajes,
  validar,
  type Candidato,
  type EstadoDelReparto,
} from "../src/lib/automatizaciones.ts";

const ZONA = "America/Argentina/Buenos_Aires";

/** Lunes a viernes de 9 a 18. */
function turno(userId: string, extra: Partial<Candidato> = {}): Candidato {
  return { userId, dias: [1, 2, 3, 4, 5], horaDesde: 540, horaHasta: 1080, peso: 1, ...extra };
}

const NUNCA: EstadoDelReparto = { asignados: 0, ultima: null, carga: 0 };

/* --------------------------------------------------------------- disponible */

test("el día se lee en la zona del workspace y no en UTC", () => {
  // Domingo 22:00 en Buenos Aires ya es lunes en UTC. Manda Buenos Aires.
  const domingoTarde = new Date("2026-09-21T01:00:00Z");
  assert.equal(diaLocal(domingoTarde, ZONA), 0);
  assert.equal(diaLocal(domingoTarde, "UTC"), 1);
});

test("fuera de sus días no recibe, por más que sea horario de oficina", () => {
  // Sábado 12:00 en Buenos Aires.
  const sabado = new Date("2026-09-19T15:00:00Z");
  assert.equal(candidatoDisponible(turno("ana"), sabado, ZONA), false);
  assert.equal(candidatoDisponible(turno("ana", { dias: [6] }), sabado, ZONA), true);
});

test("fuera de su horario no recibe, por más que sea un día suyo", () => {
  // Lunes 21:00 en Buenos Aires.
  const lunesNoche = new Date("2026-09-22T00:00:00Z");
  assert.equal(candidatoDisponible(turno("ana"), lunesNoche, ZONA), false);
  // Todo el día se escribe con la franja invertida, igual que en el envío.
  const siempre = turno("ana", { horaDesde: 0, horaHasta: 0 });
  assert.equal(candidatoDisponible(siempre, lunesNoche, ZONA), true);
});

test("el reparto de un domingo de madrugada se queda sin nadie", () => {
  const domingo = new Date("2026-09-20T06:00:00Z");
  assert.deepEqual(disponibles([turno("ana"), turno("lucas")], domingo, ZONA), []);
});

/* ------------------------------------------------------------------ elegir */

test("por turno le toca al que hace más que no recibe", () => {
  const estados: Record<string, EstadoDelReparto> = {
    ana: { ...NUNCA, ultima: 3_000 },
    lucas: { ...NUNCA, ultima: 1_000 },
    juan: { ...NUNCA, ultima: 2_000 },
  };
  const elegido = elegirResponsable(
    "equitativo",
    [turno("ana"), turno("lucas"), turno("juan")],
    (id) => estados[id] ?? NUNCA,
  );
  assert.equal(elegido, "lucas");
});

test("quien nunca recibió entra primero en la rotación", () => {
  const estados: Record<string, EstadoDelReparto> = {
    ana: { ...NUNCA, ultima: 1_000 },
    nuevo: NUNCA,
  };
  assert.equal(
    elegirResponsable("equitativo", [turno("ana"), turno("nuevo")], (id) => estados[id] ?? NUNCA),
    "nuevo",
  );
});

test("por peso, el doble de peso recibe el doble de leads", () => {
  const lista = [turno("lucas", { peso: 2 }), turno("ana", { peso: 1 })];
  const recibidos: Record<string, number> = { lucas: 0, ana: 0 };

  for (let vuelta = 0; vuelta < 30; vuelta += 1) {
    const elegido = elegirResponsable("peso", lista, (id) => ({
      ...NUNCA,
      asignados: recibidos[id],
    }));
    assert.ok(elegido);
    recibidos[elegido] += 1;
  }

  assert.equal(recibidos.lucas, 20);
  assert.equal(recibidos.ana, 10);
});

test("por carga le toca al que menos leads abiertos tiene, no al que menos recibió", () => {
  const estados: Record<string, EstadoDelReparto> = {
    // Recibió muchos pero ya los cerró: está libre.
    ana: { asignados: 50, ultima: 9_000, carga: 1 },
    lucas: { asignados: 2, ultima: 1_000, carga: 8 },
  };
  assert.equal(
    elegirResponsable("carga", [turno("ana"), turno("lucas")], (id) => estados[id] ?? NUNCA),
    "ana",
  );
});

test("el empate lo define el orden de la lista, así el reparto es reproducible", () => {
  const lista = [turno("ana"), turno("lucas")];
  assert.equal(elegirResponsable("equitativo", lista, () => NUNCA), "ana");
  assert.equal(elegirResponsable("carga", lista, () => NUNCA), "ana");
});

test("sin nadie en turno no elige a nadie: el respaldo es cosa de quien ejecuta", () => {
  assert.equal(elegirResponsable("equitativo", [], () => NUNCA), null);
});

/* ------------------------------------------------------------------ lectura */

test("un candidato sin días se descarta, pero no tumba el reparto entero", () => {
  const paso = leerPaso({
    tipo: "asignar",
    modo: "peso",
    candidatos: [
      { userId: "ana", dias: [], horaDesde: 540, horaHasta: 1080, peso: 1 },
      { userId: "lucas", dias: [1, 2], horaDesde: 540, horaHasta: 1080, peso: 3 },
    ],
  });

  assert.equal(paso?.tipo, "asignar");
  assert.deepEqual(
    paso?.tipo === "asignar" ? paso.candidatos.map((c) => c.userId) : null,
    ["lucas"],
  );
});

test("un usuario repetido entra una sola vez: para recibir el doble está el peso", () => {
  const paso = leerPaso({
    tipo: "asignar",
    modo: "equitativo",
    candidatos: [
      { userId: "ana", dias: [1], horaDesde: 0, horaHasta: 0, peso: 1 },
      { userId: "ana", dias: [2], horaDesde: 0, horaHasta: 0, peso: 1 },
    ],
  });
  assert.equal(paso?.tipo === "asignar" ? paso.candidatos.length : null, 1);
});

test("un reparto sin nadie que sobreviva se descarta entero", () => {
  assert.equal(leerPaso({ tipo: "asignar", modo: "equitativo", candidatos: [] }), null);
});

test("un modo desconocido se lee como el de siempre en vez de descartar el paso", () => {
  const paso = leerPaso({
    tipo: "asignar",
    modo: "por_simpatia",
    candidatos: [{ userId: "ana", dias: [1], horaDesde: 0, horaHasta: 0, peso: 1 }],
  });
  assert.equal(paso?.tipo === "asignar" ? paso.modo : null, "equitativo");
});

/* ------------------------------------------------------------------- cortes */

test("un reparto no le escribe a nadie, así que no lo frena ni la franja ni la respuesta", () => {
  assert.equal(sinMensajes([{ tipo: "asignar", modo: "equitativo", candidatos: [turno("ana")] }]), true);
});

test("un reparto seguido de un mensaje sí queda sujeto a la franja", () => {
  assert.equal(
    sinMensajes([
      { tipo: "asignar", modo: "equitativo", candidatos: [turno("ana")] },
      { tipo: "texto", texto: "Hola" },
    ]),
    false,
  );
});

/* --------------------------------------------------------------- validación */

test("no se puede guardar un reparto sin usuarios", () => {
  const problema = validar({
    name: "Reparto",
    disparador: { tipo: "lead_nuevo", esperaMinutos: 0 },
    etapaRequerida: null,
    pasos: [{ tipo: "asignar", modo: "equitativo", candidatos: [] }],
    horaDesde: 540,
    horaHasta: 1260,
  });
  assert.match(problema ?? "", /sin nadie/);
});

test("no se puede guardar a alguien sin días marcados", () => {
  const problema = validar({
    name: "Reparto",
    disparador: { tipo: "lead_nuevo", esperaMinutos: 0 },
    etapaRequerida: null,
    pasos: [{ tipo: "asignar", modo: "equitativo", candidatos: [turno("ana", { dias: [] })] }],
    horaDesde: 540,
    horaHasta: 1260,
  });
  assert.match(problema ?? "", /sin días/);
});
