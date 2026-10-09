"use client";

import { CalendarCheck, MessageCircle, Send, SlidersHorizontal, UserCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { LogoWhatsApp } from "@/components/logos-de-canales";

/**
 * "Así trabaja Kivo": el camino de un lead, paso por paso.
 *
 * Es el centro de la página. Todo lo demás cuenta qué hace el producto; esto
 * muestra cómo, en el único orden que importa —el que recorre una persona que
 * escribe— y sin pedirle al visitante que lo arme en la cabeza: entra, conversa,
 * califica, agenda y termina en el escritorio de un vendedor.
 *
 * Avanza solo. Que avance solo no es un adorno: es la idea del producto puesta
 * en movimiento —el sistema trabaja sin que nadie lo empuje— y además resuelve
 * el problema de siempre de estas secciones, que es que nadie hace click. El
 * que sí quiere manejarlo, toca un paso y desde ahí manda él: el avance
 * automático se apaga para no pelearle.
 *
 * Tres frenos, por respeto al que está leyendo:
 * - No corre hasta que la sección está a la vista. Una animación que se gastó
 *   sola mientras el visitante leía el hero no sirvió para nada.
 * - Un click en cualquier paso lo detiene para siempre: a partir de ahí manda
 *   el visitante y la sección no le vuelve a mover el contenido de abajo del
 *   dedo. No hay forma de volver al automático, y está bien que no la haya:
 *   quien tomó el control no quiere recuperarlo.
 * - Se detiene mientras algo de adentro tiene el foco, para que no se mueva
 *   solo mientras alguien recorre los pasos con el tabulador.
 * - No arranca si el sistema pidió menos movimiento. Ahí queda el primer paso
 *   quieto y los otros a un click, que es exactamente lo mismo pero manual.
 *
 * Acá hubo también un freno mientras el puntero estaba encima, y se sacó. En
 * una página larga el mouse se queda quieto en el medio de la pantalla, que es
 * justo donde cae esta sección al scrollear: el visitante no tocaba nada y la
 * veía congelada, sin manera de saber que lo estaba frenando él.
 */

const PASOS = [
  {
    icono: MessageCircle,
    titulo: "Entra el lead",
    texto: "Alguien escribe al WhatsApp, al Instagram o al Messenger del negocio. A las tres de la mañana también.",
    estado: "Mensaje nuevo",
    tono: "neutro",
  },
  {
    icono: Send,
    titulo: "El agente conversa",
    texto: "Contesta en segundos con la información del negocio. No un menú de opciones: una conversación.",
    estado: "Respondido en 4 s",
    tono: "ia",
  },
  {
    icono: SlidersHorizontal,
    titulo: "Califica",
    texto: "Pregunta lo que define si esa persona compra y lo deja escrito en la ficha, campo por campo.",
    estado: "Lead calificado",
    tono: "exito",
  },
  {
    icono: CalendarCheck,
    titulo: "Coordina la reunión",
    texto: "Ofrece los horarios libres del equipo y cierra uno. El equipo la confirma en la agenda y salen los recordatorios.",
    estado: "Reunión agendada",
    tono: "exito",
  },
  {
    icono: UserCheck,
    titulo: "Se lo pasa al vendedor",
    texto: "Con la ficha completa y el historial entero. El vendedor entra a cerrar, no a preguntar el nombre.",
    estado: "Asignado a Sofía",
    tono: "neutro",
  },
] as const;

/**
 * Cuánto se queda cada paso antes de pasar al siguiente.
 *
 * Tres segundos: alcanza para leer el título y los dos renglones del paso, y
 * es poco para quedarse esperando. Los cinco pasos completan la vuelta en
 * quince segundos, que es más o menos lo que alguien le da a una sección
 * antes de seguir bajando.
 */
const DURACION = 3000;

export function FlujoDeKivo({ id }: { id: string }) {
  const [activo, setActivo] = useState(0);
  const [enVista, setEnVista] = useState(false);
  /* Mientras alguien recorre los pasos con el tabulador, no se mueve solo. */
  const [conFoco, setConFoco] = useState(false);
  /* Cuando el visitante toca un paso, el carrusel deja de avanzar solo. */
  const [manual, setManual] = useState(false);

  const caja = useRef<HTMLElement>(null);

  useEffect(() => {
    const elemento = caja.current;
    if (!elemento) return;

    const observador = new IntersectionObserver(
      ([entrada]) => setEnVista(entrada.isIntersecting),
      /* Un tercio a la vista: lo suficiente para que se esté mirando. */
      { threshold: 0.33 },
    );
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    if (!enVista || conFoco || manual) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const reloj = window.setInterval(() => {
      setActivo((anterior) => (anterior + 1) % PASOS.length);
    }, DURACION);
    return () => window.clearInterval(reloj);
  }, [enVista, conFoco, manual]);

  return (
    <section
      id={id}
      ref={caja}
      onFocusCapture={() => setConFoco(true)}
      onBlurCapture={() => setConFoco(false)}
      className="kivo-reticula scroll-mt-20 bg-[#15120b] text-[#f3efe2]"
    >
      <div className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <div className="max-w-2xl">
          <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] text-amber-400/80 uppercase">
            Así trabaja Kivo
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.03em] text-balance sm:text-4xl lg:text-5xl">
            Un mensaje entra.
            <span className="block text-amber-400">Una reunión sale.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[#a9a292]">
            Lo que pasa en el medio no lo hace nadie de tu equipo: lo hacen los agentes, cada vez
            y con el mismo criterio. Eso es un CRM agéntico.
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <ol className="relative flex flex-col gap-1">
            {/* El riel: la línea gris de fondo y encima la dorada, que crece. */}
            <span aria-hidden className="absolute top-6 bottom-6 left-[19px] w-px bg-white/10" />
            <span
              aria-hidden
              style={{ height: `${((activo + 1) / PASOS.length) * 100}%` }}
              className="absolute top-6 left-[19px] w-px bg-gradient-to-b from-amber-500 to-amber-500/20 transition-[height] duration-700 ease-out"
            />

            {PASOS.map((paso, indice) => {
              const esActivo = indice === activo;
              const yaPaso = indice < activo;
              return (
                <li key={paso.titulo} className="relative">
                  <button
                    type="button"
                    aria-current={esActivo}
                    onClick={() => {
                      setActivo(indice);
                      setManual(true);
                    }}
                    className="flex w-full cursor-pointer items-start gap-4 rounded-xl px-2 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
                  >
                    <span
                      className={`relative z-10 grid size-[38px] shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
                        esActivo
                          ? "border-amber-500 bg-amber-500 text-[#17140c]"
                          : yaPaso
                            ? "border-amber-500/40 bg-[#221d12] text-amber-400"
                            : "border-white/12 bg-[#1c180f] text-[#6f6857]"
                      }`}
                    >
                      <paso.icono className="size-4" />
                    </span>

                    <span className="min-w-0 flex-1 pt-1">
                      <span className="flex items-baseline gap-2.5">
                        <span className="font-[family-name:var(--fuente-mono)] text-[10px] text-[#6f6857]">
                          0{indice + 1}
                        </span>
                        <strong
                          className={`text-[17px] font-bold tracking-[-0.01em] transition-colors ${
                            esActivo ? "text-[#f3efe2]" : "text-[#8b8474]"
                          }`}
                        >
                          {paso.titulo}
                        </strong>
                      </span>
                      {/*
                        La explicación sólo del paso activo. Los cinco textos a la
                        vez son un muro que nadie lee, y además le sacarían al
                        movimiento lo único que tiene que hacer: dirigir la
                        atención a un lugar por vez.
                      */}
                      <span
                        className={`grid transition-all duration-500 ease-out ${
                          esActivo ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <span className="overflow-hidden">
                          <span className="block max-w-sm text-[14px] leading-relaxed text-[#a9a292]">
                            {paso.texto}
                          </span>
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/*
            El escenario. La `key` es el paso: al cambiar, React lo reemplaza en
            vez de actualizarlo, y la animación de entrada se vuelve a disparar.
          */}
          <div className="relative min-h-[22rem]">
            <Escenario key={activo} paso={activo} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── el panel de la derecha ─────────────────────── */

/** La ventana oscura donde se muestra lo que hace Kivo en cada paso. */
function Escenario({ paso }: { paso: number }) {
  const contenidos = [
    <MensajeQueEntra key="0" />,
    <ConversacionDelAgente key="1" />,
    <FichaQueSeLlena key="2" />,
    <AgendaQueSeOcupa key="3" />,
    <VendedorQueRecibe key="4" />,
  ];

  return (
    <div className="kivo-aparece overflow-hidden rounded-2xl border border-white/10 bg-[#201c13] shadow-[0_32px_64px_-32px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.07] bg-[#1a160e] px-4 py-2.5">
        <span className="relative flex size-2">
          <span className="kivo-halo absolute inset-0 rounded-full bg-emerald-400" />
          <span className="kivo-late relative size-2 rounded-full bg-emerald-400" />
        </span>
        <span className="font-[family-name:var(--fuente-mono)] text-[11px] text-[#8b8474]">
          kivo · paso 0{paso + 1} de 05
        </span>
        <span className="ml-auto">
          <EstadoOscuro tono={PASOS[paso].tono}>{PASOS[paso].estado}</EstadoOscuro>
        </span>
      </div>

      <div className="p-5">{contenidos[paso]}</div>
    </div>
  );
}

/** El chip de estado, en su versión oscura. Mismo lenguaje que el resto. */
function EstadoOscuro({
  children,
  tono = "ia",
  retraso,
}: {
  children: ReactNode;
  tono?: "ia" | "exito" | "neutro";
  retraso?: number;
}) {
  const cajas = {
    ia: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    exito: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    neutro: "border-white/10 bg-white/5 text-[#c8c2b0]",
  };
  const puntos = {
    ia: "bg-amber-500",
    exito: "bg-emerald-400",
    neutro: "bg-[#6f6857]",
  };

  return (
    <span
      style={retraso ? { animationDelay: `${retraso}ms` } : undefined}
      className={`kivo-entra-estado inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-[family-name:var(--fuente-mono)] text-[11px] leading-none whitespace-nowrap ${cajas[tono]}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${puntos[tono]}`} />
      {children}
    </span>
  );
}

function Burbuja({
  de,
  children,
  retraso,
}: {
  de: "lead" | "agente";
  children: ReactNode;
  retraso?: number;
}) {
  return (
    <p
      style={retraso ? { animationDelay: `${retraso}ms` } : undefined}
      className={`kivo-aparece max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
        de === "agente"
          ? "self-end rounded-br-md bg-amber-500 text-[#17140c]"
          : "self-start rounded-bl-md bg-white/[0.06] text-[#e6e1d2]"
      }`}
    >
      {children}
    </p>
  );
}

function MensajeQueEntra() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#25D366]/15 text-[#25D366]">
          <LogoWhatsApp className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[13.5px] font-semibold">+54 9 351 ···· 2937</strong>
          <span className="font-[family-name:var(--fuente-mono)] text-[11px] text-[#8b8474]">
            WhatsApp · 03:14
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Burbuja de="lead" retraso={120}>
          Hola! Vi el depto de Nueva Córdoba, sigue disponible?
        </Burbuja>
      </div>

      <p className="border-t border-white/[0.07] pt-4 text-[13px] leading-relaxed text-[#8b8474]">
        Nadie del equipo está despierto. En un CRM que sólo guarda datos, este mensaje espera
        hasta las nueve de la mañana.
      </p>
    </div>
  );
}

function ConversacionDelAgente() {
  return (
    <div className="flex flex-col gap-2">
      <Burbuja de="lead">Hola! Vi el depto de Nueva Córdoba, sigue disponible?</Burbuja>
      <Burbuja de="agente" retraso={160}>
        Sí, sigue disponible. Es un dos ambientes al frente, con balcón. ¿Lo buscás para vivir o
        como inversión?
      </Burbuja>
      <Burbuja de="lead" retraso={520}>
        Para vivir, me mudo en octubre
      </Burbuja>
      <Burbuja de="agente" retraso={760}>
        Perfecto, llegás bien con los tiempos. ¿Con qué presupuesto estás manejándote?
      </Burbuja>
    </div>
  );
}

function FichaQueSeLlena() {
  const campos = [
    { etiqueta: "Nombre", valor: "María Paz Ortiz" },
    { etiqueta: "Busca", valor: "2 amb., Nueva Córdoba" },
    { etiqueta: "Motivo", valor: "Para vivir" },
    { etiqueta: "Cuándo", valor: "Octubre" },
    { etiqueta: "Presupuesto", valor: "USD 78.000" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {campos.map((campo, indice) => (
        <div
          key={campo.etiqueta}
          style={{ animationDelay: `${indice * 130}ms` }}
          className="kivo-aparece flex items-baseline justify-between gap-3 border-b border-dashed border-white/[0.09] pb-2.5 last:border-0"
        >
          <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.12em] text-[#6f6857] uppercase">
            {campo.etiqueta}
          </span>
          <span className="truncate text-right text-[13.5px] font-medium text-[#f3efe2]">
            {campo.valor}
          </span>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        <EstadoOscuro retraso={760}>Etapa · Contactado</EstadoOscuro>
        <EstadoOscuro retraso={880}>Responsable · Sofía</EstadoOscuro>
      </div>
    </div>
  );
}

function AgendaQueSeOcupa() {
  const horas = [
    { hora: "09:00", texto: "Llamada · Estudio Pereyra", ocupado: true },
    { hora: "11:30", texto: "Visita · Tomás Vera", ocupado: true },
    { hora: "16:30", texto: "Visita · María Paz Ortiz", nueva: true },
    { hora: "18:00", texto: "Libre" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="pb-1 text-[13px] text-[#8b8474]">
        El agente ofreció los horarios libres de Sofía. La persona eligió uno y el equipo lo
        confirmó en la agenda.
      </p>

      {horas.map((fila, indice) => (
        <div
          key={fila.hora}
          style={{ animationDelay: `${indice * 110}ms` }}
          className="kivo-aparece flex items-center gap-3"
        >
          <span className="w-11 shrink-0 font-[family-name:var(--fuente-mono)] text-[11px] text-[#6f6857]">
            {fila.hora}
          </span>
          <span
            className={`min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-[12.5px] ${
              fila.nueva
                ? "border-amber-500/50 bg-amber-500/10 font-semibold text-amber-100"
                : fila.ocupado
                  ? "border-white/[0.07] bg-white/[0.03] text-[#8b8474]"
                  : "border-dashed border-white/[0.09] text-[#6f6857]"
            }`}
          >
            {fila.texto}
          </span>
        </div>
      ))}

      <div className="pt-2">
        <EstadoOscuro tono="exito" retraso={560}>
          Jueves 16:30 · en la agenda de Sofía
        </EstadoOscuro>
      </div>
    </div>
  );
}

function VendedorQueRecibe() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e8dcc0] text-[13px] font-bold text-[#7a5a12]">
          SL
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[14px] font-semibold">Sofía Ledesma</strong>
          <span className="text-[11.5px] text-[#8b8474]">Vendedora · le llegó la notificación</span>
        </span>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5">
        <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.12em] text-[#6f6857] uppercase">
          Lo que abre Sofía
        </span>
        <ul className="mt-2.5 flex flex-col gap-1.5 text-[13px] text-[#c8c2b0]">
          <li>· La ficha completa, con presupuesto y fecha de mudanza</li>
          <li>· La conversación entera, de las 3:14 en adelante</li>
          <li>· La visita del jueves ya en su calendario</li>
        </ul>
      </div>

      <p className="text-[13px] leading-relaxed text-[#8b8474]">
        Es lo único que Kivo le pide a una persona: entrar a cerrar.
      </p>
    </div>
  );
}
