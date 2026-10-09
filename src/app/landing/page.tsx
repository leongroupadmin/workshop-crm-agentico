import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  Cloud,
  Database,
  Megaphone,
  MoonStar,
  Radio,
  Server,
  Smartphone,
} from "lucide-react";

import { BrandMark } from "@/components/brand";
import { LandingChat } from "@/components/landing-chat";
import { FlujoDeKivo } from "@/components/landing-flujo";
import {
  BandejaDesordenada,
  BandejaOrdenada,
  ChipEstado,
  MiniAgenda,
  MiniAutomatizacion,
  MiniEmbudo,
  MiniEquipo,
  Rotulo,
  VentanaKivo,
} from "@/components/landing-mockups";
import { CANALES } from "@/components/logos-de-canales";

/**
 * La landing pública de Kivo.
 *
 * Una sola idea sostiene la página: Kivo ordena el caos comercial y entrega
 * oportunidades listas para cerrar. Si una sección no empuja esa frase, sobra.
 *
 * El rediseño se apoya en tres decisiones, y conviene tenerlas a mano antes de
 * tocar nada:
 *
 * 1. Se muestra el producto, no se lo cuenta. Casi todas las secciones tienen
 *    un pedazo de interfaz de Kivo adelante —la ficha, el embudo, la agenda,
 *    una automatización— y el texto al lado, corto. Las tarjetas con un ícono y
 *    tres renglones son el recurso fácil de cualquier landing y no demuestran
 *    nada; una pantalla, sí. Las piezas viven en `landing-mockups.tsx`.
 *
 * 2. El ritmo se hace con superficies, no con adornos. La página alterna cuatro
 *    profundidades —arena de fondo, crema, papel para lo que está al frente y
 *    carbón para las dos bandas oscuras— y esa alternancia es lo que separa una
 *    sección de la otra. Nada de degradados de colores ni vidrios: el contraste
 *    lo dan el papel y la sombra, como en un producto real.
 *
 * 3. Ninguna composición se repite. Hay bloques a todo lo ancho, mitades
 *    desparejas, una comparación a dos columnas y una banda oscura con el flujo
 *    animado. La sucesión de grillas de tres iguales es lo que hace que una
 *    página se lea como plantilla.
 *
 * Vive en `/landing` y no en la raíz porque `/` es el CRM: quien ya es cliente
 * entra ahí todos los días y no queremos ponerle una página de venta en el
 * medio. El dominio de marketing sirve esta misma página en su raíz, por la
 * reescritura de `proxy.ts`.
 *
 * Es un componente de servidor. Lo único que manda JavaScript al visitante es
 * el chat en vivo del hero y la sección de flujo; todo lo demás se pinta una
 * vez y se cachea. Las preguntas de abajo abren con un `<details>` nativo.
 *
 * La tipografía —Manrope para leer, Geist Mono para los datos— la carga
 * `layout.tsx` de esta misma carpeta, y no la de la raíz: el CRM sigue con la
 * del sistema.
 */
export const metadata: Metadata = {
  title: "Kivo — CRM agéntico: agentes de IA que califican y agendan",
  description:
    "Kivo es un CRM agéntico: sus agentes de IA atienden, califican y agendan por tu equipo comercial. Tus vendedores entran cuando el lead ya está listo: sólo a cerrar. En nuestra nube por mes, o in house en el servidor de tu empresa.",
};

/**
 * Por dónde se pide una demo.
 *
 * Está acá arriba y en una constante porque es lo único de esta página que
 * cambia seguido: si mañana se atiende por otro número se toca esta línea y
 * listo, no hay que buscarlo entre las secciones.
 *
 * Es el único canal que ofrece la landing. Hubo también un mail en el cierre y
 * se sacó: dos caminos en el último metro no suman, y por WhatsApp la charla
 * arranca al toque.
 */
const WHATSAPP_DEMO = "https://wa.me/5493518592937";

/**
 * Dónde entra el que ya es cliente.
 *
 * Va absoluto y no como `/` porque la landing se sirve por dos dominios: en
 * `kivo.leongroup.agency` la raíz es esta misma página, así que un enlace a `/`
 * devolvería al visitante acá en vez de llevarlo al CRM. Escrito entero
 * funciona igual desde los dos lados.
 */
const URL_DEL_CRM = "https://crmyagente.leongroup.agency/";


/* Las dos formas del botón principal, que se repiten en tres lugares. */
const BOTON_PRIMARIO =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[15px] font-semibold text-[#17140c] shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_8px_20px_-8px_rgba(245,158,11,0.7)] transition-colors hover:bg-amber-400";

const BOTON_SECUNDARIO =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#c7bfa6] bg-[#fdfbf6] px-6 py-3.5 text-[15px] font-medium text-[#100e08] transition-colors hover:border-[#100e08]/25 hover:bg-white";

export default function Landing() {
  return (
    /*
      La página es siempre clara, sin importar cómo tenga configurado el CRM el
      que la visita: los colores van escritos a mano y no con el modificador
      `dark:` de Tailwind, que cuelga de la clase `.dark` que pone el dashboard.
      `color-scheme` acompaña para que la barra de scroll salga clara.
    */
    <div className="flex min-h-screen flex-col bg-[#e8e1cf] text-[#100e08] [color-scheme:light]">
      <Encabezado />
      <main className="flex-1">
        <Hero />
        <Canales />
        <Caos />
        <FlujoDeKivo id="como-funciona" />
        <Producto id="producto" />
        <Diferencial id="in-house" />
        <Preguntas id="preguntas" />
        <CierreDemo />
      </main>
      <PieDePagina />
    </div>
  );
}

/**
 * La barra de arriba.
 *
 * Fija y translúcida: la página es larga y el botón de demo tiene que estar a
 * un toque desde cualquier altura. Los enlaces del medio se esconden en el
 * celular —cuatro palabras al lado del logo no entran— y ahí la navegación
 * queda resuelta por el orden de las secciones, que es el mismo del menú.
 */
function Encabezado() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#d9d2be] bg-[#e8e1cf]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <Link href="/landing" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-[19px] font-extrabold tracking-[-0.03em]">Kivo</span>
        </Link>

        <nav
          aria-label="Secciones"
          className="ml-8 hidden gap-7 text-[14px] text-[#5f5a4d] md:flex"
        >
          <a href="#como-funciona" className="transition-colors hover:text-[#100e08]">
            Cómo funciona
          </a>
          <a href="#producto" className="transition-colors hover:text-[#100e08]">
            Producto
          </a>
          <a href="#in-house" className="transition-colors hover:text-[#100e08]">
            In house
          </a>
          <a href="#preguntas" className="transition-colors hover:text-[#100e08]">
            Preguntas
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={URL_DEL_CRM}
            className="inline-flex rounded-lg px-3.5 py-2 text-[14px] font-medium text-[#5f5a4d] transition-colors hover:bg-black/[0.05] hover:text-[#100e08]"
          >
            Entrar
          </a>
          <a
            href={WHATSAPP_DEMO}
            className="inline-flex items-center gap-2 rounded-lg bg-[#15120b] px-4 py-2 text-[14px] font-semibold text-[#f3efe2] transition-colors hover:bg-[#2a2417]"
          >
            Pedir demo
          </a>
        </div>
      </div>
    </header>
  );
}

/**
 * El primer golpe de vista.
 *
 * El título dice primero el resultado —tu equipo sólo cierra— y recién después
 * quién hace el trabajo sucio. Al revés ("agentes de IA que califican") suena a
 * herramienta, y nadie compra una herramienta: compra tener el día libre.
 *
 * El texto ocupa el ancho de arriba y el producto va abajo, entero y grande, en
 * vez del clásico texto-izquierda / captura-derecha, que deja las dos cosas
 * chicas. Acá el mockup es el protagonista de la primera pantalla.
 *
 * La categoría va arriba del título, en la etiqueta: "CRM agéntico". Es la
 * palabra que nos separa de un CRM que sólo guarda datos, y por eso el párrafo
 * de abajo la define en una línea antes de contar qué hace. Sin esa línea es
 * una etiqueta de moda; con ella, una promesa.
 *
 * Y no es un mockup del todo: la mitad izquierda es el agente de verdad, con el
 * mismo modelo que atiende en el CRM. El visitante le escribe y comprueba en
 * diez segundos lo que el título promete, que es lo más difícil de vender de
 * este producto. A la derecha, la ficha que esa clase de charla deja cargada.
 */
function Hero() {
  return (
    <section className="relative">
      {/*
        El resplandor dorado del fondo, muy suave y bien abierto: el ámbar sobre
        un fondo cálido tiñe enseguida, y con más fuerza la franja de arriba se
        ve sucia y el título pierde contraste. Va en un envoltorio con
        `overflow-hidden` propio para que recortarlo no recorte el contenido.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-56 left-1/2 size-[52rem] -translate-x-1/2 rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 68%)" }}
        />
      </div>

      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pt-12 pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:pt-16 lg:pb-28">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#c7bfa6] bg-[#fdfbf6] px-3 py-1.5 font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.1em] text-[#5f5a4d] uppercase">
            <span className="size-1.5 rounded-full bg-amber-500" />
            CRM agéntico
          </span>

          <h1 className="mt-6 text-[2.2rem] leading-[0.97] font-extrabold tracking-[-0.045em] text-balance sm:text-[2.9rem] lg:text-[3.25rem]">
            Tu equipo comercial,
            <span className="block">sólo cerrando.</span>
            <span className="block text-[#b45309]">Calificar y agendar lo hace la IA.</span>
          </h1>

          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[#5f5a4d]">
            Kivo es un <strong className="font-semibold text-[#100e08]">CRM agéntico</strong>: no se
            queda guardando contactos, los trabaja. Responde cada consulta, detecta quién tiene
            intención real de compra y agenda la reunión con tu equipo.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a href={WHATSAPP_DEMO} className={BOTON_PRIMARIO}>
              Pedir una demo
              <ArrowRight className="size-4" />
            </a>
            <a href="#como-funciona" className={BOTON_SECUNDARIO}>
              Ver cómo trabaja
            </a>
          </div>

          <p className="mt-7 font-[family-name:var(--fuente-mono)] text-[12px] text-[#8b8574]">
            Se instala en el celular como una app. Sin descargar nada de ninguna tienda.
          </p>
        </div>

        {/*
          El agente, atendiendo. La ventana la arma acá y no el componente del
          chat: adentro de ese archivo está la conversación, y el marco —el
          borde, la sombra en dos capas que lo levanta del fondo— es cosa de la
          página, que es la que sabe sobre qué se está apoyando.
        */}
        <div className="kivo-aparece overflow-hidden rounded-2xl border border-[#c7bfa6] bg-[#fdfbf6] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_-2px_rgba(21,18,11,0.12),0_36px_70px_-30px_rgba(21,18,11,0.5)]">
          <LandingChat whatsapp={WHATSAPP_DEMO} />
        </div>
      </div>
    </section>
  );
}

/**
 * Con qué se conecta.
 *
 * Nada de promesas: es lo que ya está enchufado. Los logos van en el color de
 * cada marca —ver `logos-de-canales.tsx`— porque lo único que tienen que hacer
 * es que el visitante reconozca en medio segundo que su WhatsApp entra acá.
 */
function Canales() {
  return (
    <section className="border-y border-[#d9d2be] bg-[#f4efe2]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-9 gap-y-5 px-5 py-8">
        <Rotulo>Se conecta con</Rotulo>
        {CANALES.map(({ nombre, color, Logo }) => (
          <span key={nombre} className="flex items-center gap-2.5">
            <Logo className="size-[18px] shrink-0" style={{ color }} />
            <span className="text-[14px] font-medium text-[#3d382e]">{nombre}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * El caos, y el orden.
 *
 * Es la idea principal de la página puesta en imagen: a la izquierda la bandeja
 * de cualquier PyME que vende por mensaje —encimada, sin leer, sin saber cuál
 * de esos cuarenta y siete valía algo—; a la derecha la misma gente después de
 * pasar por Kivo, con nombre, estado y responsable.
 *
 * Va antes que cualquier función porque el visitante compra la solución recién
 * cuando se reconoce en el problema. Y va como comparación y no como tres
 * tarjetas de dolores porque el contraste entre las dos columnas explica en un
 * vistazo lo que tres párrafos no.
 */
function Caos() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
      <div className="max-w-3xl">
        <Rotulo>El problema</Rotulo>
        <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[3.1rem] lg:leading-[1.02]">
          Tus vendedores no pierden ventas.
          <span className="block text-[#8b8574]">Pierden el día.</span>
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#5f5a4d]">
          De cada diez que escriben, ocho preguntan el precio y no vuelven. Nadie sabe cuál de los
          otros dos iba a comprar hasta que ya se enfrió.
        </p>
      </div>

      <div className="mt-14 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] text-[#a39c87] uppercase">
              Hoy
            </span>
            <span className="h-px flex-1 bg-[#d9d2be]" />
          </div>
          <div className="mt-6">
            <BandejaDesordenada />
          </div>
          <p className="mt-7 text-[15px] leading-relaxed text-[#5f5a4d]">
            Mensajes iguales, de tres canales distintos, contestados cuando alguien puede. El que
            sí iba a comprar espera lo mismo que el que preguntaba por preguntar.
          </p>
        </div>

        <div className="rounded-3xl border border-[#d9d2be] bg-[#f4efe2] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] lg:p-8">
          <div className="flex items-center gap-2.5">
            <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] text-[#b45309] uppercase">
              Con Kivo
            </span>
            <span className="h-px flex-1 bg-amber-500/30" />
          </div>
          <div className="mt-6">
            <BandejaOrdenada />
          </div>
          <p className="mt-7 text-[15px] leading-relaxed text-[#5f5a4d]">
            Ya no son mensajes: son oportunidades con estado, valor y responsable. El equipo abre
            la mañana sabiendo a quién llamar primero.
          </p>
        </div>
      </div>
    </section>
  );
}

/* Lo que no necesita una pantalla propia para entenderse. */
const EXTRAS = [
  { icono: Megaphone, texto: "Difusiones por WhatsApp con plantillas aprobadas" },
  { icono: CalendarDays, texto: "Recordatorios de cita, al equipo y al cliente" },
  { icono: Database, texto: "Importá y exportá tu base en CSV" },
  { icono: Smartphone, texto: "Se instala como app y avisa con notificaciones" },
  { icono: Radio, texto: "Devuelve las conversiones a Meta Ads" },
  { icono: MoonStar, texto: "Notas de voz, archivos y modo oscuro" },
];

/**
 * El producto, en primer plano.
 *
 * Cuatro bloques, y ninguno con la misma forma que el anterior: el embudo a
 * todo lo ancho, la agenda a la derecha del texto, la automatización a la
 * izquierda y el equipo en un par más chico junto a la lista de lo que queda.
 * Esa irregularidad es deliberada —una grilla pareja de tarjetas es lo que hace
 * que una página se lea como plantilla— y además le da a cada pantalla el
 * tamaño que necesita para leerse.
 *
 * Tampoco son cuatro veces el mismo dibujo. La ventana del producto la usa
 * solamente el embudo, que es el que tiene que leerse como una pantalla de
 * Kivo; la agenda es una columna de día y la automatización un esquema, y los
 * dos van apoyados directo sobre el fondo de la sección. Tres marcos iguales
 * seguidos se leen como tres capturas de lo mismo.
 */
function Producto({ id }: { id: string }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-[#d9d2be] bg-[#f4efe2]">
      <div className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <div className="max-w-2xl">
          <Rotulo>El producto</Rotulo>
          <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[3.1rem] lg:leading-[1.02]">
            Lo que queda cargado después de cada conversación
          </h2>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#5f5a4d]">
            En un CRM común esto lo carga un vendedor, a mano y cuando se acuerda. En uno agéntico
            lo carga el agente mientras conversa: la ficha, la etapa y la reunión.
          </p>
        </div>

        {/* 1 · El embudo, a todo lo ancho: es lo único que se entiende mejor
            cuanto más grande se ve, porque lo que hay que leer es el movimiento
            de una columna a la otra. */}
        <div className="mt-14">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:items-end">
            <h3 className="text-2xl font-bold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
              El embudo se mueve mientras nadie mira
            </h3>
            <p className="text-[15.5px] leading-relaxed text-[#5f5a4d]">
              Cada lead con su etapa, su valor y su responsable. Cuando el agente califica a
              alguien, la tarjeta cambia de columna sola: nadie tiene que acordarse de moverla.
            </p>
          </div>

          <VentanaKivo
            titulo="Kivo · embudo de ventas"
            className="mt-7"
            derecha={<ChipEstado tono="ia">Movidas por el agente</ChipEstado>}
          >
            <div className="p-3.5 lg:p-5">
              <MiniEmbudo />
            </div>
          </VentanaKivo>
        </div>

        {/* 2 · La agenda: texto a la izquierda, pantalla a la derecha. */}
        <div className="mt-20 grid items-center gap-10 lg:mt-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h3 className="text-2xl font-bold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
              La agenda se llena mientras dormís
            </h3>
            <p className="mt-4 text-[15.5px] leading-relaxed text-[#5f5a4d]">
              El agente ofrece los horarios que el equipo tiene libres y cierra uno en la
              conversación. El equipo la confirma en la agenda del responsable —sincronizada con
              Google Calendar— y salen los recordatorios, al vendedor y al cliente.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              <li>
                <ChipEstado tono="ia">Coordinado por el agente</ChipEstado>
              </li>
              <li>
                <ChipEstado tono="exito">Recordatorio enviado</ChipEstado>
              </li>
            </ul>
          </div>

          <MiniAgenda />
        </div>

        {/* 3 · La automatización: se da vuelta el orden, pantalla a la izquierda. */}
        <div className="mt-20 grid items-center gap-10 lg:mt-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-16">
          <MiniAutomatizacion />

          <div>
            <h3 className="text-2xl font-bold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
              Reglas que trabajan de noche
            </h3>
            <p className="mt-4 text-[15.5px] leading-relaxed text-[#5f5a4d]">
              Reparto de los leads nuevos, cambios de etapa, mensajes de seguimiento y avisos al
              responsable. Se arman una vez, en castellano, y corren siempre igual: sin que nadie
              se acuerde de hacerlo.
            </p>
          </div>
        </div>

        {/* 4 · El equipo, en un par más chico, junto a lo que no necesita pantalla. */}
        <div className="mt-20 grid gap-10 border-t border-[#d9d2be] pt-14 lg:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <h3 className="text-2xl font-bold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
              Cada vendedor ve lo suyo
            </h3>
            <p className="mt-4 text-[15.5px] leading-relaxed text-[#5f5a4d]">
              Los permisos se manejan por rol: quién difunde, quién borra, quién ve la base entera.
            </p>
            <div className="mt-6">
              <MiniEquipo />
            </div>
          </div>

          <div>
            <Rotulo>Y además</Rotulo>
            <ul className="mt-5 grid gap-x-8 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {EXTRAS.map(({ icono: Icono, texto }) => (
                <li key={texto} className="flex items-start gap-3 text-[14.5px] text-[#5f5a4d]">
                  <Icono className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  {texto}
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-2xl border border-[#d9d2be] bg-[#fdfbf6] p-5">
              <span className="flex items-center gap-2.5">
                <Bot className="size-4 text-amber-600" />
                <Rotulo>El freno</Rotulo>
              </span>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[#5f5a4d]">
                La ficha tiene un interruptor: con la IA frenada, el agente no vuelve a hablar en
                ese chat hasta que vos lo reactives. También se frena sola cuando alguien del
                equipo entra a responder.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Los dos modelos, lado a lado.
 *
 * El orden importa y no es alfabético: primero el mensual, que es por donde
 * entra casi todo el mundo, y segundo el in house, que es el que tiene que
 * quedar resonando. Lo último que se lee es lo que se recuerda.
 */
const MODELOS = [
  {
    icono: Cloud,
    nombre: "Mensual",
    donde: "en nuestra nube",
    etiqueta: "Para arrancar ya",
    linea: "Lo hosteamos nosotros. Vos entrás y vendés.",
    puntos: [
      "Andando en días, sin que nadie de sistemas toque nada",
      "Actualizaciones, backups y monitoreo incluidos",
      "Se paga por mes; si no te sirve, lo dejás",
      "Las funciones nuevas te llegan el día que salen",
      "Crece sin que tengas que comprar un servidor",
    ],
    accion: "Pedir una demo",
  },
  {
    icono: Server,
    nombre: "In house",
    donde: "en tu servidor",
    etiqueta: "Para que sea tuyo",
    linea: "Se instala en tu infraestructura y el código queda tuyo.",
    puntos: [
      "La base, las fichas y el historial no salen de tu red",
      "Te entregamos el código: el sistema es tuyo, no un acceso que te prestamos",
      "Licencia por única vez, sin cuota que crezca cada vez que sumás un vendedor",
      "Instalación y capacitación nuestras; el soporte, como te convenga: nosotros, o los recursos para que tu equipo lo mantenga con agentes de IA",
      "Si mañana cortás con nosotros, el CRM sigue andando",
    ],
    accion: "Hablar de in house",
  },
] as const;

/**
 * La comparación, fila por fila.
 *
 * Son las seis preguntas que de verdad decide alguien entre un modelo y el
 * otro, y están puestas en el orden en que se las hace: dónde quedan mis
 * datos, cuánto me sale, quién lo arregla cuando se rompe, de quién es esto,
 * qué pasa si me quiero ir, y cuándo lo tengo andando.
 *
 * Es la pieza más persuasiva del bloque justamente porque no vende: pone las
 * dos columnas en igualdad y deja que el que lee saque la cuenta. Dos de las
 * seis filas favorecen al mensual, y quedan.
 */
const COMPARACION = [
  {
    que: "Dónde viven los datos",
    nube: "En nuestra nube",
    propio: "En tu servidor",
  },
  {
    que: "Cómo se paga",
    nube: "Cuota por mes",
    propio: "Licencia única + implementación",
  },
  {
    que: "Quién lo mantiene",
    nube: "Nosotros",
    propio: "Tu equipo, con nuestro soporte",
  },
  { que: "De quién es el código", nube: "Nuestro", propio: "Tuyo" },
  {
    que: "Si dejás de pagar",
    nube: "Se corta el acceso",
    propio: "Lo seguís usando",
  },
  { que: "Hasta estar andando", nube: "Días", propio: "Semanas" },
] as const;

/**
 * El diferencial: los dos modelos, y sobre todo el in house.
 *
 * Va acá, entre el producto y las preguntas, y no antes: nadie se interesa por
 * dónde se instala un sistema que todavía no quiere. Primero se ve qué hace;
 * recién cuando ya lo quiere tiene sentido decirle que además puede ser suyo.
 *
 * Es la única superficie mostaza de la página, y es a propósito. Las otras dos
 * bandas que cortan el ritmo —el flujo y el cierre— son de carbón, así que una
 * tercera banda oscura acá no destacaría nada: se leería como la tercera igual.
 * Entonces se da vuelta la regla de toda la landing, donde el ámbar es siempre
 * el acento y nunca el fondo, y el acento pasa a ser la superficie. Que sea la
 * única vez que eso pasa es lo que hace que la sección se vea distinta antes de
 * leer una palabra.
 *
 * Y encima de ese campo claro va la tarjeta del in house en carbón: el objeto
 * más oscuro de la página sobre el fondo más brillante. La vista va ahí sola,
 * que es exactamente donde queremos que vaya.
 *
 * Acá abajo hubo un párrafo que aclaraba que el modelo de IA corre afuera, y
 * se sacó por decisión comercial: la sección vende, y una objeción que el
 * visitante no trajo no se contesta antes de que la haga. El agente de la
 * landing la sigue contestando derecho si se la preguntan
 * (`lib/landing-demo.ts`), que es donde la pregunta aparece de verdad.
 */
function Diferencial({ id }: { id: string }) {
  return (
    <section
      id={id}
      className="kivo-reticula-tinta scroll-mt-16 border-y border-[#b45309]/45 bg-amber-500 text-[#17140c]"
    >
      <div className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <div className="max-w-3xl">
          {/*
            El rótulo de esta sección va escrito acá y no con `<Rotulo>`: ese
            componente tiene dos colores, uno para fondo claro y otro para
            carbón, y ninguno de los dos sirve sobre mostaza. Antes que sumarle
            una tercera variante por un solo uso, se escribe la línea.
          */}
          <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] text-[#17140c]/60 uppercase">
            El diferencial
          </span>
          {/*
            El titular en dos tintas, como en el resto de la página: la primera
            línea apagada y la segunda al tope. Acá la que remata es la oscura y
            no una clara, que era lo primero que se probó: el blanco sobre
            mostaza da menos de 2 a 1 de contraste y a este tamaño todavía se
            lee, pero es el tipo de línea que desaparece con el sol en la
            pantalla del celular, que es justo donde se mira esta página.
          */}
          <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[3.1rem] lg:leading-[1.02]">
            <span className="text-[#17140c]/60">
              Todos los CRM son un alquiler.
            </span>
            <span className="block">Kivo también puede ser tuyo.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-[#17140c]/75">
            Kivo se instala en el servidor de tu empresa: el sistema, la base y
            todas las conversaciones quedan adentro de tu infraestructura, con
            el código en tu poder. O lo tomás por mes en nuestra nube y arrancás
            esta semana. Es el mismo producto en las dos versiones —mismo
            agente, mismo embudo, misma app—; lo único que cambia es dónde viven
            tus datos.
          </p>
        </div>

        {/*
          Las dos tarjetas. La del in house no es más grande ni tiene un cartel
          de "recomendado": alcanza con que sea la oscura. La jerarquía la da la
          superficie, como en toda la página.
        */}
        <div className="mt-14 grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
          {MODELOS.map((modelo, indice) => {
            const esInHouse = indice === 1;
            return (
              <div
                key={modelo.nombre}
                className={`flex h-full flex-col rounded-3xl border p-7 lg:p-8 ${
                  esInHouse
                    ? "border-[#17140c]/30 bg-[#15120b] text-[#f3efe2] shadow-[0_2px_4px_-2px_rgba(21,18,11,0.3),0_36px_70px_-30px_rgba(21,18,11,0.75)]"
                    : "border-[#17140c]/12 bg-[#fdfbf6] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_-2px_rgba(21,18,11,0.18)]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex items-center gap-3">
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                        esInHouse
                          ? "bg-amber-500 text-[#17140c]"
                          : "bg-[#f4efe2] text-[#b45309]"
                      }`}
                    >
                      <modelo.icono className="size-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[19px] font-extrabold tracking-[-0.025em]">
                        {modelo.nombre}
                      </strong>
                      <span
                        className={`block font-[family-name:var(--fuente-mono)] text-[11px] tracking-tight ${
                          esInHouse ? "text-[#8b8474]" : "text-[#8b8574]"
                        }`}
                      >
                        {modelo.donde}
                      </span>
                    </span>
                  </span>

                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 font-[family-name:var(--fuente-mono)] text-[10px] leading-none tracking-tight whitespace-nowrap ${
                      esInHouse
                        ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                        : "border-[#d9d2be] bg-[#f4efe2] text-[#5f5a4d]"
                    }`}
                  >
                    {modelo.etiqueta}
                  </span>
                </div>

                <p
                  className={`mt-6 text-[16px] leading-relaxed font-semibold tracking-[-0.01em] ${
                    esInHouse ? "text-[#f3efe2]" : "text-[#100e08]"
                  }`}
                >
                  {modelo.linea}
                </p>

                <ul className="mt-5 grid gap-3">
                  {modelo.puntos.map((punto) => (
                    <li
                      key={punto}
                      className={`flex items-start gap-3 text-[14.5px] leading-relaxed ${
                        esInHouse ? "text-[#c8c2b0]" : "text-[#5f5a4d]"
                      }`}
                    >
                      <Check
                        className={`mt-0.5 size-4 shrink-0 ${
                          esInHouse ? "text-amber-400" : "text-amber-600"
                        }`}
                      />
                      {punto}
                    </li>
                  ))}
                </ul>

                {/*
                  `mt-auto` y no un margen fijo: las dos listas no miden lo
                  mismo y los dos botones tienen que quedar a la misma altura.
                */}
                <div className="mt-auto pt-8">
                  <a
                    href={WHATSAPP_DEMO}
                    className={
                      esInHouse
                        ? BOTON_PRIMARIO + " w-full"
                        : "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#c7bfa6] bg-[#fdfbf6] px-6 py-3.5 text-[15px] font-medium text-[#100e08] transition-colors hover:border-[#100e08]/25 hover:bg-white"
                    }
                  >
                    {modelo.accion}
                    <ArrowRight className="size-4" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/*
          La comparación.

          Va sin superficie propia, apoyada directo sobre la mostaza con
          filetes de tinta: una tercera caja acá abajo sumaría un cuarto nivel
          de profundidad en una sección que ya tiene papel y carbón, y lo que
          hace falta es que se lea como una ficha técnica, no como otra tarjeta.

          En el celular cada fila se apila y los valores llevan adelante el
          nombre del modelo, porque el encabezado de columnas desaparece: sin
          eso quedarían dos valores sueltos sin saber cuál es cuál.
        */}
        <div className="mt-16 overflow-hidden rounded-2xl border border-[#17140c]/15">
          {/*
            El encabezado de columnas va afuera de la `<dl>` y no adentro: una
            lista de definiciones sólo admite `dt`, `dd` y divisiones que los
            envuelvan, y esta fila no define nada, nombra las columnas. Adentro
            sería markup inválido para algo que es puramente visual.
          */}
          <div className="hidden bg-[#17140c]/[0.07] px-5 py-3 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-6">
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.16em] text-[#17140c]/55 uppercase">
              Lo que cambia
            </span>
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.16em] text-[#17140c]/55 uppercase">
              Mensual
            </span>
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.16em] text-[#17140c]/55 uppercase">
              In house
            </span>
          </div>

          <dl>
            {COMPARACION.map((fila) => (
              <div
                key={fila.que}
                className="grid gap-x-6 gap-y-1.5 border-t border-[#17140c]/12 px-5 py-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-baseline"
              >
                <dt className="text-[14px] font-semibold tracking-[-0.01em] text-[#17140c]/70">
                  {fila.que}
                </dt>
                <dd className="text-[14.5px] text-[#17140c]">
                  <span className="font-[family-name:var(--fuente-mono)] text-[11px] text-[#17140c]/55 sm:hidden">
                    Mensual ·{" "}
                  </span>
                  {fila.nube}
                </dd>
                <dd className="text-[14.5px] font-semibold text-[#17140c]">
                  <span className="font-[family-name:var(--fuente-mono)] text-[11px] font-normal text-[#17140c]/55 sm:hidden">
                    In house ·{" "}
                  </span>
                  {fila.propio}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

const PREGUNTAS = [
  {
    pregunta: "¿Qué es un CRM agéntico?",
    respuesta:
      "Un CRM con agentes de IA que trabajan adentro del sistema, no al costado. Un CRM común guarda lo que tu equipo carga a mano y depende de que alguien se acuerde de seguir cada lead; en Kivo el agente atiende, completa la ficha, mueve al lead de etapa y coordina la reunión. No es un chatbot pegado a un CRM: escribe en la misma base que usa tu equipo.",
  },
  {
    pregunta: "¿La IA reemplaza a mi equipo de ventas?",
    respuesta:
      "No. Hace la parte de arriba del embudo —atender, repreguntar, filtrar y coordinar un horario—, que es la que se come el día y no cierra ninguna venta. El cierre lo hace tu vendedor, con el lead ya calificado y la reunión puesta.",
  },
  {
    pregunta: "¿Cómo sabe a quién calificar?",
    respuesta:
      "Con los criterios que le des vos. Le decís qué preguntas hacer y qué respuestas separan a alguien que compra de alguien que está mirando; el agente las hace en la conversación, sin interrogatorio, y deja la respuesta escrita en la ficha del lead.",
  },
  {
    pregunta: "¿Y si el lead pregunta algo que el agente no sabe?",
    respuesta:
      "Le pasa el chat a una persona en vez de inventar. Vos definís los temas que nunca contesta solo —precios especiales, excepciones, reclamos— y en esos casos avisa al responsable y se calla.",
  },
  {
    pregunta: "¿Puedo frenar la IA en una conversación puntual?",
    respuesta:
      "Sí, con un toque. La ficha del lead tiene un interruptor: con la IA frenada el agente no vuelve a hablar en ese chat hasta que vos lo reactives. También se frena sola cuando alguien del equipo entra a responder.",
  },
  {
    pregunta: "¿Cada vendedor ve todos los leads?",
    respuesta:
      "Sólo los que tiene asignados, salvo que le des permiso para ver más. Los permisos se manejan por rol desde Usuarios: quién puede difundir, quién puede borrar, quién ve la base entera.",
  },
  {
    pregunta: "¿Puedo traer mi base de contactos actual?",
    respuesta:
      "Sí. Se importa desde un CSV, se revisa antes de confirmar y se exporta igual de fácil cuando la necesites. Tus datos siguen siendo tuyos.",
  },
  {
    pregunta: "¿Qué es exactamente el modelo in house?",
    respuesta:
      "Que Kivo corre en un servidor de tu empresa en vez del nuestro. Mismo sistema, misma app, mismo agente: lo que cambia es que la base de datos y las conversaciones quedan en tu red y el código queda en tu poder.",
  },
  {
    pregunta: "¿Puedo empezar por mes y pasarme a in house después?",
    respuesta:
      "Sí. Se exporta la base entera y se levanta en tu servidor con el historial completo, sin arrancar de cero ni perder una conversación.",
  },
  {
    pregunta: "¿Qué necesito para tener el in house?",
    respuesta:
      "Un servidor —propio o tu propia nube— y alguien que lo administre. La instalación y la capacitación las hacemos nosotros; después elegís si el soporte lo seguimos dando nosotros o si te dejamos los recursos para que tu equipo lo resuelva con agentes de IA.",
  },
];

/**
 * Las preguntas.
 *
 * `<details>` nativo: abre y cierra sin una línea de JavaScript, es accesible
 * con teclado desde el navegador y el buscador lo lee como contenido, no como
 * un bloque escondido detrás de un click.
 *
 * El título va al costado y no arriba del todo: es la única sección de texto
 * puro de la página y, centrada, se leería como el final. Todavía falta el
 * cierre.
 */
function Preguntas({ id }: { id: string }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-[#d9d2be] bg-[#e8e1cf]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] lg:gap-16 lg:py-32">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Rotulo>Preguntas</Rotulo>
          <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-balance sm:text-4xl">
            Lo que todos preguntan
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-[#5f5a4d]">
            Si la tuya no está acá, escribinos y te la contestamos por WhatsApp.
          </p>
        </div>

        <div className="divide-y divide-[#d9d2be] border-y border-[#d9d2be]">
          {PREGUNTAS.map((item) => (
            <details key={item.pregunta} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-[16px] font-semibold tracking-[-0.01em]">
                {item.pregunta}
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[#c7bfa6] text-[#5f5a4d] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5f5a4d]">
                {item.respuesta}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const PROMESAS = [
  "Te mostramos el agente calificando con tu caso, no con una demo genérica",
  "Vemos juntos cuántas de tus conversaciones terminan hoy en reunión",
  "Si no te sirve, te lo decimos en la misma llamada",
];

/**
 * El cierre.
 *
 * La segunda banda oscura de la página, y la última pantalla: después de
 * recorrer todo en claro, el carbón corta y deja el botón solo, sin nada
 * alrededor con qué competir.
 */
function CierreDemo() {
  return (
    <section className="kivo-reticula relative overflow-hidden bg-[#15120b] text-[#f3efe2]">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-72 left-1/2 size-[46rem] -translate-x-1/2 rounded-full opacity-[0.16] blur-3xl"
        style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 68%)" }}
      />

      <div className="relative mx-auto max-w-3xl px-5 py-24 text-center lg:py-32">
        <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] text-amber-400/80 uppercase">
          La demo
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-balance sm:text-4xl lg:text-[3.1rem] lg:leading-[1.02]">
          Media hora para ver si Kivo te sirve
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[#a9a292]">
          Contanos cuántos mensajes por día recibís y cuántos terminan en una reunión. Con eso
          alcanza para decirte si esto te cambia el mes o no.
        </p>

        <ul className="mx-auto mt-10 grid max-w-md gap-3 text-left">
          {PROMESAS.map((promesa) => (
            <li key={promesa} className="flex items-start gap-3 text-[14.5px] text-[#c8c2b0]">
              <Check className="mt-0.5 size-4 shrink-0 text-amber-400" />
              {promesa}
            </li>
          ))}
        </ul>

        {/*
          Un solo botón, y a propósito. Acá al lado hubo uno de mail, y sacarlo
          es lo mejor que le pasó a este bloque: el que llegó hasta el final ya
          decidió, y ofrecerle dos caminos en el último metro sólo le da algo
          que pensar. Por WhatsApp además la conversación arranca al toque, que
          es exactamente lo que la página estuvo demostrando todo el tiempo.
        */}
        <div className="mt-11 flex justify-center">
          <a href={WHATSAPP_DEMO} className={BOTON_PRIMARIO}>
            Escribinos por WhatsApp
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

/** El pie: los datos de siempre, sobre el mismo carbón con el que cierra. */
function PieDePagina() {
  return (
    <footer className="border-t border-white/[0.08] bg-[#15120b] text-[#f3efe2]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-9 sm:flex-row">
        <span className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-[13.5px] text-[#8b8474]">
            Kivo · un producto de <span className="font-semibold text-[#f3efe2]">León Group</span>
          </span>
        </span>

        <nav
          aria-label="Enlaces del pie"
          className="flex items-center gap-6 text-[13.5px] text-[#8b8474]"
        >
          <a href="#como-funciona" className="transition-colors hover:text-[#f3efe2]">
            Cómo funciona
          </a>
          <a href="#producto" className="transition-colors hover:text-[#f3efe2]">
            Producto
          </a>
          <a href={URL_DEL_CRM} className="transition-colors hover:text-[#f3efe2]">
            Entrar al CRM
          </a>
        </nav>
      </div>
    </footer>
  );
}
