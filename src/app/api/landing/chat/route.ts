import { after, NextResponse, type NextRequest } from "next/server";

import {
  diagnosticarAgenteDeLanding,
  MAX_CARACTERES,
  MAX_MENSAJES_DEL_VISITANTE,
  responderEnLaLanding,
  type TurnoDemo,
} from "@/lib/landing-demo";
import { guardarLeadDeLanding } from "@/lib/landing-lead";
import { separarMarcaDeLead } from "@/lib/landing-marca";
import { getWorkspaceContext } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El chat del hero de la landing.
 *
 * Es el único endpoint del CRM que contesta sin sesión, y encima gasta plata en
 * cada llamada: cualquiera que encuentre esta URL puede pedirle respuestas a
 * OpenAI con la key de León Group. Todo lo que sigue —el techo por IP, el techo
 * global, el largo de los mensajes, la cantidad de turnos— existe por eso, no
 * por prolijidad.
 *
 * La conversación no se guarda en ningún lado. Llega entera desde el navegador
 * en cada pedido, se le agregan las instrucciones y se descarta.
 */

/**
 * Cuántos mensajes tiene que escribir alguien para quedar en el CRM aunque el
 * agente no lo haya marcado.
 *
 * Tres es el número donde deja de ser curiosidad. Con uno o dos entra cualquier
 * cosa; con cinco, la mitad de los interesados se va sin dejar rastro.
 */
const MINIMO_DE_MENSAJES_PARA_GUARDAR = 3;

/** Respuestas por IP dentro de la ventana. Una charla real usa menos de diez. */
const TOPE_POR_IP = 12;

/** La ventana del tope por IP. */
const VENTANA_MS = 10 * 60 * 1000;

/**
 * Techo de toda la landing por hora, sumando a todos.
 *
 * El tope por IP no alcanza contra alguien decidido: se cambia de IP y sigue.
 * Esto es el corte general —si se llega, la página deja de contestar por un
 * rato y muestra el WhatsApp— y está puesto arriba de cualquier tráfico real
 * que una landing nueva pueda tener. Es el freno que evita despertarse con una
 * factura.
 */
const TOPE_GLOBAL_POR_HORA = 300;

/**
 * La cuenta vive en memoria del proceso, no en la base.
 *
 * Con un solo contenedor alcanza, y evita escribirle a Postgres en cada
 * mensaje de un desconocido. Se reinicia con cada deploy: el peor caso es que
 * alguien que estaba justo en el tope consiga unos mensajes más, que es un
 * costo mucho menor que el de una tabla nueva.
 */
const porIp = new Map<string, number[]>();
const global: number[] = [];

/** Deja sólo lo que sigue dentro de la ventana y dice cuántos quedaron. */
function vigentes(marcas: number[], ahora: number, ventana: number): number {
  let corte = 0;
  while (corte < marcas.length && ahora - marcas[corte] > ventana) corte += 1;
  if (corte > 0) marcas.splice(0, corte);
  return marcas.length;
}

/**
 * Quién está pidiendo.
 *
 * Detrás del proxy inverso, la IP del socket es la del proxy y sería la misma
 * para todo el mundo: el tope por IP se volvería un tope global. La real viaja
 * en `x-forwarded-for`, y el primer valor es el cliente.
 */
function ipDelVisitante(request: NextRequest): string {
  const reenviada = request.headers.get("x-forwarded-for");
  if (reenviada) return reenviada.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "desconocida";
}

/**
 * El identificador de esta charla, tal como lo manda el navegador.
 *
 * Es lo único que une un pedido con el siguiente —el chat no guarda estado del
 * lado del servidor— y es lo que evita que cada mensaje deje otra ficha en el
 * CRM. Se acepta con forma de UUID y nada más: va a una consulta contra la base
 * y no tiene por qué ser texto libre.
 */
function sesionValida(cuerpo: unknown): string | null {
  const valor = (cuerpo as { sesion?: unknown }).sesion;
  if (typeof valor !== "string") return null;
  return /^[0-9a-f-]{16,64}$/i.test(valor) ? valor : null;
}

/** Los turnos que mandó el navegador, o `null` si no son lo que dicen ser. */
function turnosValidos(cuerpo: unknown): TurnoDemo[] | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const crudos = (cuerpo as { turnos?: unknown }).turnos;
  if (!Array.isArray(crudos) || crudos.length === 0) return null;

  // Ida y vuelta del visitante, más el saludo del agente que arranca la charla.
  if (crudos.length > MAX_MENSAJES_DEL_VISITANTE * 2 + 1) return null;

  const turnos: TurnoDemo[] = [];
  for (const crudo of crudos) {
    if (typeof crudo !== "object" || crudo === null) return null;
    const { role, content } = crudo as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;

    const texto = content.trim();
    if (!texto || texto.length > MAX_CARACTERES) return null;
    turnos.push({ role, content: texto });
  }

  // El último tiene que ser del visitante: si no, no hay nada que contestar.
  if (turnos[turnos.length - 1].role !== "user") return null;

  // Y no se le puede pedir al modelo que conteste más veces de las permitidas.
  if (turnos.filter((turno) => turno.role === "user").length > MAX_MENSAJES_DEL_VISITANTE) {
    return null;
  }

  return turnos;
}

export async function POST(request: NextRequest) {
  const cuerpo = await request.json().catch(() => null);
  const turnos = turnosValidos(cuerpo);
  if (!turnos) {
    return NextResponse.json({ error: "No entendí el mensaje." }, { status: 400 });
  }

  const ahora = Date.now();

  if (vigentes(global, ahora, 60 * 60 * 1000) >= TOPE_GLOBAL_POR_HORA) {
    return NextResponse.json(
      { error: "El agente está con mucha demanda. Escribinos por WhatsApp y te atendemos." },
      { status: 429 },
    );
  }

  const ip = ipDelVisitante(request);
  const marcas = porIp.get(ip) ?? [];
  if (vigentes(marcas, ahora, VENTANA_MS) >= TOPE_POR_IP) {
    return NextResponse.json(
      { error: "Charlamos bastante. Seguimos por WhatsApp, que es más cómodo." },
      { status: 429 },
    );
  }

  // Se cuenta antes de llamar: si la llamada tarda, dos pedidos simultáneos de
  // la misma IP no tienen que pasar los dos por el mismo hueco.
  marcas.push(ahora);
  porIp.set(ip, marcas);
  global.push(ahora);

  // El mapa no se limpia solo: sin esto, cada IP que pasó alguna vez queda
  // ocupando memoria hasta el próximo deploy.
  if (porIp.size > 5000) {
    for (const [clave, valores] of porIp) {
      if (vigentes(valores, ahora, VENTANA_MS) === 0) porIp.delete(clave);
    }
  }

  const respuesta = await responderEnLaLanding(turnos);
  if (!respuesta.ok) {
    return NextResponse.json({ error: respuesta.error }, { status: 503 });
  }

  const { limpio, datos } = separarMarcaDeLead(respuesta.texto);
  const sesion = sesionValida(cuerpo);

  /*
    Cuándo esto es un lead.

    Al principio dependía sólo de que el agente pusiera la marca, y eso dejaba
    el CRM vacío: el modelo marca cuando entiende que del otro lado hay un
    negocio, y alguien que pregunta tres cosas sobre el producto sin contar a
    qué se dedica —que es como prueba cualquiera, empezando por el dueño— no
    califica nunca. Quedaba una función que funcionaba y no se veía funcionar.

    Así que ahora hay dos caminos y alcanza con uno. La marca sigue siendo el
    bueno, porque trae nombre, rubro y teléfono. El otro es la insistencia: tres
    mensajes escritos a mano no los manda un bot que rebota ni alguien que pasó
    de largo, y aunque no sepamos quién es, la charla quedó guardada y el equipo
    puede leerla y juzgar.
  */
  const escritos = turnos.filter((turno) => turno.role === "user").length;
  const esLead = Boolean(datos) || escritos >= MINIMO_DE_MENSAJES_PARA_GUARDAR;

  // El lead se guarda después de contestar, no antes: escribir en la base es
  // trabajo del CRM y no tiene por qué hacer esperar al visitante mirando los
  // tres puntitos. `after` lo corre cuando la respuesta ya salió.
  if (esLead && sesion) {
    const conversacion = [...turnos, { role: "assistant" as const, content: limpio }].map(
      (turno) => ({
        de: turno.role === "user" ? ("visitante" as const) : ("agente" as const),
        texto: turno.content,
      }),
    );

    after(() => guardarLeadDeLanding({ sesion, datos: datos ?? {}, conversacion }));
  } else if (!sesion) {
    // Sin sesión no se puede evitar duplicar la ficha en cada mensaje, así que
    // se prefiere no escribir. Si esto aparece seguido, el navegador dejó de
    // mandar el identificador y hay que mirar el componente, no el prompt.
    console.warn("[landing] charla sin sesión: no se guarda el lead");
  }

  return NextResponse.json({ texto: limpio });
}

/**
 * Por qué no contesta el agente.
 *
 * El `POST` de arriba es público y por eso contesta siempre lo mismo cuando
 * falla. Este `GET` hace la misma llamada y devuelve el error tal como vino,
 * pero exige estar logueado al CRM: el detalle puede incluir parte de la
 * configuración de la cuenta de OpenAI.
 *
 * Se abre desde el navegador donde ya tenés la sesión del CRM:
 * `https://crmyagente.leongroup.agency/api/landing/chat`
 *
 * `hayKey` en false significa que al contenedor le falta `OPENAI_API_KEY`.
 * Con la key puesta, `detalle` dice si el modelo no existe para esa cuenta, si
 * la key está vencida o si el modelo se quedó sin presupuesto antes de escribir.
 */
export async function GET(request: NextRequest) {
  const context = await getWorkspaceContext();
  if (context.status !== "ready") {
    return NextResponse.json({ error: "Entrá al CRM antes de abrir esta URL." }, { status: 401 });
  }

  const agente = await diagnosticarAgenteDeLanding();

  // `?lead=1` prueba además la otra mitad: que se pueda escribir el contacto.
  // Son dos fallas que desde afuera se ven iguales —no aparece el lead— y se
  // arreglan en lugares distintos. Escribe una ficha de prueba de verdad,
  // etiquetada, para borrar despues.
  if (request.nextUrl.searchParams.get("lead") !== "1") {
    return NextResponse.json({ agente });
  }

  const escritura = await guardarLeadDeLanding({
    sesion: crypto.randomUUID(),
    datos: { nombre: "Prueba del chat de la landing", rubro: "prueba", resumen: "Ficha de prueba" },
    conversacion: [{ de: "visitante", texto: "Esto es una prueba del diagnóstico." }],
  });

  return NextResponse.json({ agente, escritura });
}
