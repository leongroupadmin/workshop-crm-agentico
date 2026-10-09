"use client";

import { ArrowUp, Bot } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

/**
 * El chat en vivo del hero.
 *
 * Es la demo y la imagen de la página al mismo tiempo. Antes acá había una
 * bandeja de mentira, dibujada: se entendía, pero había que creerle. Esto es el
 * agente de verdad, con el mismo modelo que atiende en el CRM, así que el
 * visitante no lee que Kivo contesta bien — lo comprueba antes de bajar a la
 * primera sección.
 *
 * La conversación vive acá y nada más: no se guarda ni se manda a la base. Al
 * recargar arranca de cero.
 */

type Turno = { role: "user" | "assistant"; content: string };

/** Lo mismo que acepta el endpoint. Si se cambia allá, hay que cambiarlo acá. */
const MAX_MENSAJES = 8;
const MAX_CARACTERES = 600;

/**
 * El saludo.
 *
 * Está escrito y no generado: es lo primero que se ve al entrar y no puede
 * depender de una llamada a la API. Así la página pinta completa de entrada,
 * no parpadea y no gasta un peso hasta que alguien decide escribir.
 */
const SALUDO =
  "Hola, soy el agente de Kivo. Contesto acá igual que en el WhatsApp de tu negocio: preguntame lo que quieras y de paso te muestro cómo trabajo. ¿A qué te dedicás?";

/**
 * Arranques para el que no sabe qué preguntar, que es el 90% de los visitantes.
 *
 * No son datos que la persona podría darnos —el agente ya pregunta a qué se
 * dedica en el saludo, así que un chip que diga "tengo una inmobiliaria" le
 * pide al visitante que se califique solo—. Lo que hacen es poner al agente a
 * actuar en vez de a explicar, que es lo único que el FAQ, tres mil píxeles más
 * abajo, no puede hacer por él.
 *
 * Cada uno tiene respuesta definida en las instrucciones del agente
 * (`lib/landing-demo.ts`), y eso no es casualidad: un chip que lo empuje a
 * terreno que el prompt no cubre lo deja improvisando sobre el producto que
 * estamos vendiendo, que es el peor lugar para que improvise. Si se agrega uno
 * nuevo, primero hay que ver que allá exista qué contestar.
 *
 * Van en orden de desconfianza, de lo que muestra a lo que compromete:
 * 1. Lo pone a atender un cliente del visitante: la demostración más
 *    convincente que tiene la página, y el chip que más se toca.
 * 2. Le hace demostrar la derivación, que es la forma de contestar "la IA le va
 *    a decir cualquier cosa a mis clientes" sin prometer nada.
 * 3. Qué es un CRM agéntico: el diferencial contra cualquier otro CRM, dicho
 *    con la palabra que la página pone arriba de todo. El prompt lo tiene
 *    escrito y la página lo define en las preguntas.
 * 4. El precio, que es lo primero que piensa cualquiera y nadie escribe. Acá
 *    importa menos la respuesta —se define en la llamada— que ver que no se
 *    inventa un número.
 * 5. El que lo obliga a repreguntar de qué es el negocio, que es justo lo que
 *    el agente tiene que averiguar.
 */
const SUGERENCIAS = [
  "Atendeme como si fuera un cliente mío",
  "¿Y si te pregunto algo que no sabés?",
  "¿Qué es un CRM agéntico?",
  "¿Cuánto sale?",
  "¿Sirve para mi rubro?",
];

export function LandingChat({ whatsapp }: { whatsapp: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([
    { role: "assistant", content: SALUDO },
  ]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState("");

  const hilo = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  /*
    El identificador de esta charla.

    Es lo único que une un mensaje con el siguiente: el servidor no guarda la
    conversación, así que sin esto cada respuesta dejaría otra ficha en el CRM
    en vez de completar la misma. Se arma recién al mandar el primer mensaje
    —no al pintar la página— para que quien sólo pasa mirando no genere nada,
    y vive en un ref porque cambiarlo no tiene que repintar nada.
  */
  const sesion = useRef<string>("");

  const usados = turnos.filter((turno) => turno.role === "user").length;
  const agotado = usados >= MAX_MENSAJES;

  /*
    El hilo se desplaza solo, pero por dentro: se mueve `scrollTop` del
    contenedor en vez de usar `scrollIntoView`, que arrastraría la página
    entera. En una landing eso sería robarle el scroll a alguien que estaba
    leyendo otra cosa.
  */
  useEffect(() => {
    const caja = hilo.current;
    if (caja) caja.scrollTop = caja.scrollHeight;
  }, [turnos, pensando]);

  const enviar = async (mensaje: string) => {
    const limpio = mensaje.trim().slice(0, MAX_CARACTERES);
    if (!limpio || pensando || agotado) return;

    if (!sesion.current) sesion.current = crypto.randomUUID();

    const conElMio: Turno[] = [...turnos, { role: "user", content: limpio }];
    setTurnos(conElMio);
    setTexto("");
    setError("");
    setPensando(true);

    try {
      const respuesta = await fetch("/api/landing/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnos: conElMio, sesion: sesion.current }),
      });

      const cuerpo = (await respuesta.json().catch(() => null)) as {
        texto?: string;
        error?: string;
      } | null;

      if (!respuesta.ok || !cuerpo?.texto) {
        setError(
          cuerpo?.error ?? "El agente no está disponible en este momento.",
        );
        return;
      }

      setTurnos([...conElMio, { role: "assistant", content: cuerpo.texto }]);
    } catch {
      setError(
        "Se cortó la conexión. Probá de nuevo o escribinos por WhatsApp.",
      );
    } finally {
      setPensando(false);
      campo.current?.focus();
    }
  };

  const mandar = (evento: FormEvent) => {
    evento.preventDefault();
    void enviar(texto);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#fdfbf6]">
      <header className="flex items-center gap-3 border-b border-[#e3dcc8] bg-[#f4efe2] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
          <Bot className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold">
            Agente de Kivo
          </strong>
          <span className="flex items-center gap-2 font-[family-name:var(--fuente-mono)] text-[11px] text-[#5f5a4d]">
            {/* El punto verde no es adorno: dice que lo de abajo pasa ahora, no
                que es una grabación. Es la diferencia entre una captura y una
                demo, y es lo primero que mira alguien que ya vio diez landings
                con un chat dibujado. */}
            <span className="relative flex size-1.5">
              <span className="kivo-halo absolute inset-0 rounded-full bg-emerald-500" />
              <span className="kivo-late relative size-1.5 rounded-full bg-emerald-500" />
            </span>
            En vivo · te contesta de verdad
          </span>
        </span>
      </header>

      {/*
        La superficie del chat: el papel con la trama y, encima, todo lo que
        pasa adentro de la conversación —los mensajes y las sugerencias—.

        El papel es el mismo que usa la bandeja del CRM (`public/fondo-chat.svg`,
        definido en `globals.css`). Acá hace además otro trabajo: mientras la
        charla tiene un solo mensaje el panel es casi todo espacio libre, y sobre
        un color plano ese espacio se ve como una caja rota. Con la trama se lee
        como lo que es —una conversación que todavía no empezó—, que es justo lo
        que queremos que el visitante tenga ganas de arreglar.

        La trama va en este envoltorio y no en el div que scrollea, que es donde
        estaba. Ahí terminaba en el borde de la zona de mensajes, que mide menos
        que una baldosa del dibujo —256 px contra 320— y no tiene ninguna línea
        abajo: los íconos quedaban cortados al medio contra las sugerencias, que
        son del mismo color, y ese corte al aire se leía como un error de dibujo
        en vez de como el borde de algo. Cubriendo también las sugerencias, la
        trama llega hasta el borde de la barra de escribir, que sí es una línea.
      */}
      <div className="fondo-chat bg-[#f7f3e8]">
        {/*
          Dos divs y no uno: el de afuera es el que scrollea y el de adentro
          empuja los mensajes al piso con `justify-end`, para que una charla que
          recién arranca se apoye sobre la barra de escribir en vez de flotar
          arriba con medio panel vacío. Poner `justify-end` directamente en el que
          scrollea deja el principio del hilo inalcanzable cuando la conversación
          crece; el `min-h-full` del de adentro consigue lo mismo sin ese defecto.
        */}
        <div
          ref={hilo}
          aria-live="polite"
          aria-label="Conversación con el agente de Kivo"
          className="h-[16rem] overflow-y-auto sm:h-[18rem] lg:h-[19rem]"
        >
          <div className="flex min-h-full flex-col justify-end gap-2.5 px-4 py-4">
            {turnos.map((turno, indice) => (
              <p
                key={indice}
                className={
                  turno.role === "assistant"
                    ? "max-w-[85%] self-start rounded-2xl rounded-bl-md border border-[#e3dcc8] bg-white px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line"
                    : "max-w-[85%] self-end rounded-2xl rounded-br-md bg-amber-500 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line text-[#17140c]"
                }
              >
                {turno.content}
              </p>
            ))}

            {pensando && (
              <span className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md border border-[#e3dcc8] bg-white px-3.5 py-3">
                <span className="sr-only">El agente está escribiendo</span>
                {[0, 1, 2].map((punto) => (
                  <span
                    key={punto}
                    className="size-1.5 animate-bounce rounded-full bg-[#8f8b80]"
                    style={{ animationDelay: `${punto * 120}ms` }}
                  />
                ))}
              </span>
            )}

            {error && (
              <span className="self-start text-xs text-[#5f5a4d]">
                {error}{" "}
                <a
                  href={whatsapp}
                  className="font-medium text-amber-700 underline"
                >
                  Escribinos por WhatsApp
                </a>
                .
              </span>
            )}
          </div>
        </div>

        {/* Las sugerencias sólo mientras la charla no arrancó: después estorban. */}
        {usados === 0 && !pensando && (
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {SUGERENCIAS.map((sugerencia) => (
              <button
                key={sugerencia}
                type="button"
                onClick={() => void enviar(sugerencia)}
                className="cursor-pointer rounded-full border border-[#d9d2be] bg-[#f4efe2] px-3 py-1.5 text-xs font-medium text-[#5f5a4d] transition-colors hover:border-amber-500/60 hover:bg-amber-50 hover:text-[#100e08]"
              >
                {sugerencia}
              </button>
            ))}
          </div>
        )}
      </div>

      {agotado ? (
        <div className="border-t border-[#e3dcc8] bg-[#f4efe2] px-4 py-3.5 text-center">
          <p className="text-sm text-[#5f5a4d]">
            Así atiende Kivo. ¿Lo vemos con tu caso?
          </p>
          <a
            href={whatsapp}
            className="mt-2.5 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-[#17140c] transition-colors hover:bg-amber-400"
          >
            Seguir por WhatsApp
          </a>
        </div>
      ) : (
        <form
          onSubmit={mandar}
          className="flex items-center gap-2 border-t border-[#e3dcc8] bg-[#f4efe2] p-3"
        >
          <label className="sr-only" htmlFor="landing-chat-campo">
            Escribile al agente de Kivo
          </label>
          <input
            id="landing-chat-campo"
            ref={campo}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            maxLength={MAX_CARACTERES}
            disabled={pensando}
            placeholder="Escribile como si fueras un cliente…"
            className="min-w-0 flex-1 rounded-xl border border-[#d9d2be] bg-[#fdfbf6] px-3 py-2.5 text-base outline-none transition focus:ring-2 focus:ring-amber-500 disabled:opacity-60 sm:text-sm"
          />
          <button
            type="submit"
            disabled={pensando || !texto.trim()}
            aria-label="Enviar"
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-amber-500 text-[#17140c] transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="size-4.5" />
          </button>
        </form>
      )}
    </div>
  );
}
