import { Bot, Check, Clock, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import {
  LogoInstagram,
  LogoMessenger,
  LogoWhatsApp,
} from "@/components/logos-de-canales";

/**
 * Los pedazos de Kivo que se muestran en la landing.
 *
 * La página entera se apoya en esto: en vez de contar con tarjetas de texto lo
 * que hace el producto, se muestra el producto. Son reconstrucciones en HTML de
 * las pantallas reales —la ficha del lead, el embudo, la agenda, una regla de
 * automatización—, no capturas.
 *
 * Que no sean capturas es una decisión, no una limitación. Una captura pesa,
 * se ve borrosa en pantallas buenas, hay que rehacerla con cada cambio de la
 * interfaz y no se puede leer con un lector de pantalla. Esto se adapta al
 * ancho del celular, entra en el HTML que ya se manda y envejece con el CSS del
 * resto de la página.
 *
 * La contracara, y hay que decirla: son una reconstrucción. Los nombres de las
 * etapas y las pestañas son los de verdad —`Nuevo lead`, `Contactado`, `Visita
 * coordinada`, `Propuesta`, y `chat / datos / agenda` en la ficha—, así que si
 * el producto los cambia, hay que cambiarlos acá también o la landing empieza a
 * mostrar algo que ya no existe.
 *
 * Nada de acá lleva estado: son componentes de servidor, se renderizan una vez
 * y no le mandan una línea de JavaScript al visitante. El único movimiento es
 * CSS, y entra por `retraso` para que las piezas aparezcan en el orden en que
 * el sistema las va llenando.
 *
 * La paleta, que es la misma en toda la landing:
 *   papel   #fdfbf6   la superficie del producto, lo que está más cerca
 *   crema   #f4efe2   secciones alternas y superficies hundidas
 *   arena   #e8e1cf   el fondo de la página
 *   piedra  #d9d2be   bordes suaves      ·  #c7bfa6  bordes marcados
 *   carbón  #15120b   las bandas oscuras ·  #201c13  superficies sobre carbón
 *   tinta   #100e08   texto  ·  #5f5a4d  secundario  ·  #8b8574  tenue
 *   mostaza #f59e0b   el acento de siempre · #b45309 sobre claro · #fbbf24 sobre oscuro
 */

/** Un retraso de entrada, en milisegundos, para escalonar lo que aparece. */
type ConRetraso = { retraso?: number };

function retrasoDe(retraso?: number) {
  return retraso ? { animationDelay: `${retraso}ms` } : undefined;
}

/* ───────────────────────────── piezas sueltas ───────────────────────────── */

/**
 * Un estado del sistema: "Lead calificado", "Reunión agendada".
 *
 * Es la unidad más chica del lenguaje visual de Kivo y la que más se repite:
 * un punto y dos palabras en monoespaciada. Dice que algo pasó —que el sistema
 * hizo algo— y por eso siempre está en pasado.
 */
export function ChipEstado({
  children,
  tono = "neutro",
  oscuro = false,
  retraso,
}: ConRetraso & {
  children: ReactNode;
  tono?: "ia" | "exito" | "neutro";
  oscuro?: boolean;
}) {
  const puntos = {
    ia: "bg-amber-500",
    exito: oscuro ? "bg-emerald-400" : "bg-emerald-600",
    neutro: oscuro ? "bg-[#6f6857]" : "bg-[#b3ac97]",
  };

  const cajas = oscuro
    ? {
        ia: "border-amber-500/30 bg-amber-500/10 text-amber-200",
        exito: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
        neutro: "border-white/10 bg-white/5 text-[#c8c2b0]",
      }
    : {
        ia: "border-amber-500/35 bg-amber-50 text-[#8a5a06]",
        exito: "border-emerald-600/25 bg-emerald-50 text-emerald-800",
        neutro: "border-[#d9d2be] bg-[#f4efe2] text-[#5f5a4d]",
      };

  return (
    <span
      style={retrasoDe(retraso)}
      className={`kivo-entra-estado inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-[family-name:var(--fuente-mono)] text-[11px] leading-none tracking-tight whitespace-nowrap ${cajas[tono]}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${puntos[tono]}`} />
      {children}
    </span>
  );
}

/** La etiqueta de una sección: mono, chica y espaciada. El rótulo del sistema. */
export function Rotulo({ children, oscuro = false }: { children: ReactNode; oscuro?: boolean }) {
  return (
    <span
      className={`font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.18em] uppercase ${
        oscuro ? "text-amber-400/80" : "text-[#8b8574]"
      }`}
    >
      {children}
    </span>
  );
}

/** El avatar de la ficha: iniciales sobre un color cálido, como en el CRM. */
function Avatar({ iniciales, className = "size-9" }: { iniciales: string; className?: string }) {
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full bg-[#e8dcc0] text-[13px] font-bold text-[#7a5a12]`}
    >
      {iniciales}
    </span>
  );
}

/**
 * La ventana del producto.
 *
 * El marco que convierte un bloque de HTML en "una pantalla de Kivo". Lo usa
 * un solo bloque, el embudo, y está bien que así sea: si todas las piezas van
 * enmarcadas, la sección del producto se lee como una tira de capturas de la
 * misma pantalla. Las demás son esquemas y van sueltas sobre el fondo.
 *
 * La
 * profundidad la da la sombra en dos capas —una corta y cerrada que apoya la
 * pieza sobre el fondo, y una larga y abierta que la levanta— más una línea
 * blanca por dentro del borde de arriba, que es lo que hace que el papel se vea
 * papel y no un rectángulo pintado.
 */
export function VentanaKivo({
  titulo,
  children,
  derecha,
  className = "",
  retraso,
}: ConRetraso & {
  titulo: string;
  children: ReactNode;
  derecha?: ReactNode;
  className?: string;
}) {
  return (
    <div
      style={retrasoDe(retraso)}
      className={`kivo-aparece overflow-hidden rounded-2xl border border-[#c7bfa6] bg-[#fdfbf6] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_-2px_rgba(21,18,11,0.12),0_24px_48px_-24px_rgba(21,18,11,0.45)] ${className}`}
    >
      <div className="flex items-center gap-2.5 border-b border-[#e3dcc8] bg-[#f4efe2] px-3.5 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-[#cfc7ae]" />
          <span className="size-2 rounded-full bg-[#dcd5c0]" />
          <span className="size-2 rounded-full bg-[#dcd5c0]" />
        </span>
        <span className="min-w-0 flex-1 truncate font-[family-name:var(--fuente-mono)] text-[11px] tracking-tight text-[#8b8574]">
          {titulo}
        </span>
        {derecha && <span className="shrink-0">{derecha}</span>}
      </div>
      {children}
    </div>
  );
}

/* ───────────────────────── el antes y el después ────────────────────────── */

/**
 * La bandeja sin Kivo.
 *
 * Es el caos del título de la sección, dibujado: mensajes encimados, sin leer,
 * de tres canales distintos y todos iguales de urgentes.
 *
 * Es lo único de la página que no está en grilla, y a propósito: los papeles
 * se pisan entre ellos, ninguno mide lo mismo, cada uno arranca en un lugar
 * distinto y los de más abajo —los que llegaron primero y nadie abrió— se van
 * apagando. El desorden se entiende antes de leer una palabra, que es lo que
 * tiene que pasar enfrente de la columna ordenada.
 */
export function BandejaDesordenada() {
  const mensajes = [
    {
      texto: "Hola, cuánto sale?",
      canal: "wa",
      hora: "09:12",
      giro: "-1.5deg",
      izquierda: "0%",
      ancho: "84%",
      encima: "0px",
      apagado: true,
    },
    {
      texto: "Buenas! Siguen teniendo stock?",
      canal: "ig",
      hora: "09:31",
      giro: "1deg",
      izquierda: "11%",
      ancho: "89%",
      encima: "-2px",
      apagado: true,
    },
    {
      texto: "Precio?",
      canal: "wa",
      hora: "10:04",
      giro: "-0.6deg",
      izquierda: "4%",
      ancho: "62%",
      encima: "-3px",
    },
    {
      texto: "Me pasás info por favor",
      canal: "ms",
      hora: "10:47",
      giro: "1.6deg",
      izquierda: "0%",
      ancho: "92%",
      encima: "-2px",
    },
    {
      texto: "Hola??",
      canal: "wa",
      hora: "12:20",
      giro: "-1.2deg",
      izquierda: "16%",
      ancho: "70%",
      encima: "-1px",
    },
  ];

  const iconos = {
    wa: <LogoWhatsApp className="size-3.5 shrink-0 text-[#25D366]" />,
    ig: <LogoInstagram className="size-3.5 shrink-0 text-[#E4405F]" />,
    ms: <LogoMessenger className="size-3.5 shrink-0 text-[#0866FF]" />,
  };

  return (
    <div className="relative">
      <div className="flex flex-col items-start pt-2">
        {mensajes.map((mensaje, indice) => (
          <div
            key={mensaje.texto}
            style={{
              transform: `rotate(${mensaje.giro})`,
              marginLeft: mensaje.izquierda,
              marginTop: mensaje.encima,
              width: mensaje.ancho,
              /* El que llegó último queda arriba de la pila, como en la vida. */
              zIndex: indice + 1,
            }}
            className={`flex items-center gap-2.5 rounded-xl border border-[#d9d2be] bg-[#fdfbf6] px-3 py-2.5 ${
              mensaje.apagado ? "opacity-70 shadow-xs" : "shadow-md"
            }`}
          >
            {iconos[mensaje.canal as keyof typeof iconos]}
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#5f5a4d]">
              {mensaje.texto}
            </span>
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] text-[#a39c87]">
              {mensaje.hora}
            </span>
            <span className="size-1.5 shrink-0 rounded-full bg-red-500" />
          </div>
        ))}
      </div>

      {/* El contador de sin leer, que es el verdadero protagonista del bloque. */}
      <span className="kivo-alerta absolute -top-1 right-0 z-10 rounded-full bg-red-600 px-2.5 py-1 font-[family-name:var(--fuente-mono)] text-[11px] font-semibold text-white shadow-lg">
        47 sin leer
      </span>
    </div>
  );
}

/**
 * La misma gente con Kivo: ya no son mensajes sueltos, es una base.
 *
 * Enfrente hay cinco papeles encimados y acá hay una sola pieza: un bloque
 * cerrado, con encabezado y filas separadas por una línea, como la tabla de
 * leads del CRM. La comparación no la hacen los colores —son los mismos—, la
 * hace la forma: muchas cajitas contra un bloque sólido.
 */
export function BandejaOrdenada() {
  const leads = [
    { nombre: "María Paz Ortiz", estado: "Visita jueves 16:30", tono: "exito", quien: "Sofía" },
    { nombre: "Grupo Andina SRL", estado: "Calificado · USD 12.400", tono: "exito", quien: "Nico" },
    { nombre: "Javier Fuentes", estado: "Esperando respuesta", tono: "ia", quien: "Sofía" },
    { nombre: "Lucía Bermúdez", estado: "Fuera de zona · descartado", tono: "neutro", quien: "—" },
  ] as const;

  return (
    <div className="overflow-hidden rounded-xl border border-[#c7bfa6] bg-[#fdfbf6] shadow-[0_1px_2px_rgba(21,18,11,0.06)]">
      <div className="flex items-center gap-3 border-b border-[#e3dcc8] bg-[#faf7ee] px-3.5 py-2 font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.14em] text-[#a39c87] uppercase">
        <span className="flex-1">Lead</span>
        <span>Estado</span>
      </div>

      <div className="divide-y divide-[#ece5d4]">
        {leads.map((lead) => (
          <div
            key={lead.nombre}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5"
          >
            <Avatar
              iniciales={lead.nombre
                .split(" ")
                .slice(0, 2)
                .map((parte) => parte[0])
                .join("")}
              className="size-8"
            />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] font-semibold">{lead.nombre}</strong>
              <span className="truncate text-[11px] text-[#8b8574]">{lead.quien}</span>
            </span>
            <span className="w-full sm:ml-auto sm:w-auto">
              <ChipEstado tono={lead.tono}>{lead.estado}</ChipEstado>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────── el producto en primer plano ───────────────────── */

/** Una tarjeta del embudo: el nombre arriba, el monto y el responsable abajo. */
function TarjetaEmbudo({
  nombre,
  monto,
  quien,
  className = "",
  style,
}: {
  nombre: string;
  monto: string;
  quien: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`rounded-lg border px-2.5 py-2 shadow-sm ${className || "border-[#e3dcc8] bg-[#fdfbf6]"}`}
    >
      <strong className="block truncate text-[12px] font-semibold">{nombre}</strong>
      <span className="mt-0.5 flex items-center justify-between gap-2">
        <span className="font-[family-name:var(--fuente-mono)] text-[10px] text-[#8b8574]">
          {monto}
        </span>
        <span className="truncate text-[10px] text-[#a39c87]">{quien}</span>
      </span>
    </div>
  );
}

/** El aspecto de una tarjeta mientras el agente la está moviendo de etapa. */
const TARJETA_VIAJERA =
  "border-amber-500/55 bg-amber-50 ring-1 ring-amber-500/25 shadow-[0_6px_14px_-8px_rgba(120,53,15,0.45)]";

/**
 * El embudo, con las etapas que trae Kivo de fábrica.
 *
 * Se muestran cuatro de las seis: `Ganado` y `Perdido` quedan afuera porque en
 * un ancho de landing las columnas se harían ilegibles, y porque lo que hay que
 * entender acá es el movimiento, no el final.
 *
 * El movimiento, justamente, es lo único que hace este bloque: cada columna
 * tiene dos tarjetas fijas y debajo un carril vacío por el que las tarjetas
 * viajeras van saltando de etapa en etapa, sin parar. Es la frase del título
 * dibujada —el embudo se mueve mientras nadie mira— y por eso el salto es un
 * desplazamiento de verdad y no un cambio de opacidad: se ve salir la tarjeta
 * de una columna y entrar en la siguiente.
 *
 * Las viajeras viven todas dentro del carril de su columna de origen y se
 * mueven con `transform`, que no toca la maquetación: la columna reserva su
 * lugar una sola vez y nada se acomoda mientras corre la animación. El paso
 * —el ancho de una columna más el hueco— está en `--paso`, en `globals.css`,
 * junto a los fotogramas.
 *
 * En pantalla angosta la grilla es de dos columnas y las etapas 3 y 4 caen en
 * una segunda fila, así que un viaje de cuatro etapas se saldría de su fila.
 * Ahí el recorrido es de una sola columna y hay un carril por fila: el de
 * `Visita coordinada` existe sólo abajo de `lg` y por eso se esconde después.
 */
const COLUMNAS_EMBUDO = [
  {
    etapa: "Nuevo lead",
    total: "14",
    tarjetas: [
      { nombre: "Delia Roldán", monto: "—", quien: "sin asignar" },
      { nombre: "Pablo Sosa", monto: "—", quien: "sin asignar" },
    ],
    /* Las dos viajeras del recorrido largo, desfasadas media vuelta para que
       siempre haya una moviéndose y nunca compartan columna. */
    viajeras: [
      { nombre: "Javier Fuentes", monto: "USD 6.200", quien: "Sofía" },
      { nombre: "Camila Rivas", monto: "USD 18.500", quien: "Nico" },
    ],
  },
  {
    etapa: "Contactado",
    total: "23",
    tarjetas: [
      { nombre: "Grupo Andina SRL", monto: "USD 12.400", quien: "Nico" },
      { nombre: "Ana Carranza", monto: "USD 3.900", quien: "Sofía" },
    ],
  },
  {
    etapa: "Visita coordinada",
    total: "8",
    destacada: true,
    tarjetas: [
      { nombre: "María Paz Ortiz", monto: "USD 78.000", quien: "Sofía" },
      { nombre: "Tomás Vera", monto: "USD 45.000", quien: "Nico" },
    ],
    /* La viajera de la segunda fila, que sólo tiene sentido con dos columnas. */
    viajeras: [{ nombre: "Lautaro Gil", monto: "USD 31.000", quien: "Nico", soloAngosto: true }],
  },
  {
    etapa: "Propuesta",
    total: "5",
    tarjetas: [
      { nombre: "Estudio Pereyra", monto: "USD 22.000", quien: "Nico" },
      { nombre: "Hnos. Belgrano", monto: "USD 9.800", quien: "Sofía" },
    ],
  },
] as const;

export function MiniEmbudo() {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {COLUMNAS_EMBUDO.map((columna) => (
        <div
          key={columna.etapa}
          className={`rounded-xl border p-2 ${
            "destacada" in columna && columna.destacada
              ? "border-amber-500/45 bg-amber-500/[0.07]"
              : "border-[#e3dcc8] bg-[#f4efe2]"
          }`}
        >
          <div className="flex items-center justify-between gap-1 px-1 pb-2">
            <span className="min-w-0 truncate font-[family-name:var(--fuente-mono)] text-[10px] tracking-tight text-[#5f5a4d] uppercase">
              {columna.etapa}
            </span>
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] text-[#a39c87]">
              {columna.total}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {columna.tarjetas.map((tarjeta) => (
              <TarjetaEmbudo key={tarjeta.nombre} {...tarjeta} />
            ))}

            {"viajeras" in columna && columna.viajeras && (
              /*
                El carril. La primera viajera va en el flujo normal y es la que
                le reserva el alto a la columna; la segunda va encima, absoluta,
                porque en su vuelta está siempre en otra etapa.
              */
              <div
                className={`relative ${
                  columna.viajeras.some((viajera) => "soloAngosto" in viajera && viajera.soloAngosto)
                    ? "lg:hidden"
                    : ""
                }`}
              >
                {columna.viajeras.map((viajera, indice) => (
                  <TarjetaEmbudo
                    key={viajera.nombre}
                    nombre={viajera.nombre}
                    monto={viajera.monto}
                    quien={viajera.quien}
                    style={indice === 0 ? undefined : { animationDelay: "-8s" }}
                    className={`kivo-embudo-viaja z-10 ${TARJETA_VIAJERA} ${
                      indice === 0 ? "relative" : "kivo-embudo-viaja-b absolute inset-x-0 top-0"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── la agenda del día ────────────────────────── */

/** La franja del día que se dibuja, y cuánto mide una hora en pantalla. */
const DIA = { desde: 9, hasta: 20, altoHora: 40 };

const CITAS = [
  { desde: "09:00", hasta: "10:00", tipo: "Llamada", con: "Estudio Pereyra", quien: "Nico" },
  { desde: "11:30", hasta: "13:00", tipo: "Visita", con: "Tomás Vera", quien: "Nico" },
  {
    desde: "16:30",
    hasta: "18:00",
    tipo: "Visita",
    con: "María Paz Ortiz",
    quien: "Sofía",
    delAgente: true,
  },
  { desde: "18:30", hasta: "19:30", tipo: "Seguimiento", con: "Ana Carranza", quien: "Sofía" },
];

/** "16:30" → 990. Para pasar una hora a la altura que le toca en la columna. */
function enMinutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** A qué altura, y con qué alto, se dibuja un tramo del día. */
function tramo(desde: string, hasta: string) {
  const arranque = DIA.desde * 60;
  const porMinuto = DIA.altoHora / 60;
  return {
    top: (enMinutos(desde) - arranque) * porMinuto,
    height: (enMinutos(hasta) - enMinutos(desde)) * porMinuto,
  };
}

/**
 * La agenda del día, dibujada como un día y no como una lista.
 *
 * Es el cambio que más dice de este bloque: una lista de horarios con la hora
 * a la izquierda es una lista más —la página ya tiene cinco—, y no muestra lo
 * único que importa acá, que es dónde quedan los huecos. Como columna de día,
 * con el eje de horas y cada cita ocupando el alto de lo que dura, los huecos
 * se ven solos: eso es lo que el agente sale a ofrecer.
 *
 * Por eso tampoco va dentro de una ventana del producto: no es una captura de
 * pantalla, es un esquema, y va apoyada directamente sobre el fondo de la
 * sección. La única ventana que quedó en la página es la del embudo.
 *
 * Los huecos largos —de una hora y media para arriba— se marcan solos a partir
 * de `CITAS`; si cambian las citas, se recalculan.
 */
export function MiniAgenda() {
  const horas = Array.from({ length: DIA.hasta - DIA.desde + 1 }, (_, i) => DIA.desde + i);

  /* Los ratos libres entre una cita y la siguiente, que son el argumento. */
  const huecos = CITAS.flatMap((cita, indice) => {
    const siguiente = CITAS[indice + 1];
    if (!siguiente) return [];
    const largo = enMinutos(siguiente.desde) - enMinutos(cita.hasta);
    return largo >= 90 ? [{ desde: cita.hasta, hasta: siguiente.desde }] : [];
  });

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 pb-4">
        <span className="font-[family-name:var(--fuente-mono)] text-[11px] tracking-[0.14em] text-[#8b8574] uppercase">
          Jueves 14 de mayo
        </span>
        <span className="font-[family-name:var(--fuente-mono)] text-[11px] text-[#a39c87]">
          Sofía y Nico
        </span>
      </div>

      <div
        className="relative"
        style={{ height: (DIA.hasta - DIA.desde) * DIA.altoHora }}
      >
        {horas.map((hora, indice) => (
          <div
            key={hora}
            aria-hidden
            className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2"
            style={{ top: indice * DIA.altoHora }}
          >
            <span className="w-8 shrink-0 text-right font-[family-name:var(--fuente-mono)] text-[10px] text-[#a39c87]">
              {String(hora).padStart(2, "0")}
            </span>
            <span className="h-px flex-1 bg-[#d9d2be]/60" />
          </div>
        ))}

        {huecos.map((hueco) => (
          <div
            key={hueco.desde}
            style={tramo(hueco.desde, hueco.hasta)}
            className="absolute right-0 left-10 grid place-items-center rounded-lg border border-dashed border-[#d9d2be]"
          >
            <span className="font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.14em] text-[#b3ac97] uppercase">
              Libre
            </span>
          </div>
        ))}

        {CITAS.map((cita) => (
          <div
            key={cita.desde}
            style={tramo(cita.desde, cita.hasta)}
            className={`absolute right-0 left-10 overflow-hidden rounded-lg border px-2.5 py-1.5 shadow-sm ${
              cita.delAgente
                ? "kivo-aterriza border-amber-500/50 bg-amber-500/[0.1]"
                : "border-[#e3dcc8] bg-[#fdfbf6]"
            }`}
          >
            <strong className="block truncate text-[12px] leading-[14px] font-semibold">
              {cita.tipo} · {cita.con}
            </strong>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-[12px] text-[#8b8574]">
              {cita.delAgente && <Bot className="size-3 shrink-0 text-amber-600" />}
              {cita.quien} · {cita.desde} a {cita.hasta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Una regla de automatización, escrita como la piensa el que la arma.
 *
 * Es la forma del producto: "cuando pasa esto, esperá tanto, hacé aquello". Y
 * es un esquema, no una pantalla: por eso los pasos no van en tarjetas ni
 * dentro de una ventana, sino en tres carriles —la palabra que encadena a la
 * izquierda, el nodo en el medio, lo que pasa a la derecha— sobre el fondo de
 * la sección, encadenados por la misma línea que dibuja la sección de flujo.
 *
 * El último nodo es el único en ámbar porque es el único que hace algo; los
 * dos de arriba son condiciones.
 */
export function MiniAutomatizacion() {
  const pasos = [
    {
      icono: LogoWhatsApp,
      tipo: "Cuando",
      texto: "Entra un lead por WhatsApp",
      detalle: "También por Instagram o Messenger",
    },
    {
      icono: Clock,
      tipo: "Y",
      texto: "Nadie contestó en 10 minutos",
      detalle: "Se cuenta desde el último mensaje del cliente",
    },
    {
      icono: Zap,
      tipo: "Entonces",
      texto: "Asignar al vendedor de turno y avisarle",
      detalle: "Y queda anotado en la ficha del lead",
    },
  ];

  return (
    <div className="relative">
      {/*
        El punto que baja por la línea: es el lead recorriendo la regla, del
        disparo a la acción. `--recorrido` es la distancia entre el primer nodo
        y el último, y el `left` cae sobre el eje de los círculos —el ancho del
        carril de las palabras (76) más el hueco (12) más medio círculo (15)—.
        Si cambian los pasos, su alto o esos tres números, se ajusta acá.
      */}
      <span
        aria-hidden
        style={{ "--recorrido": "9.05rem" } as CSSProperties}
        className="kivo-viaja absolute top-[13px] left-[101px] size-[5px] rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]"
      />

      {pasos.map(({ icono: Icono, tipo, texto, detalle }, indice) => {
        const ultimo = indice === pasos.length - 1;

        return (
          <div key={texto} className="flex items-stretch gap-3">
            <span className="w-[76px] shrink-0 pt-2 text-right font-[family-name:var(--fuente-mono)] text-[10px] tracking-[0.12em] whitespace-nowrap text-[#a39c87] uppercase">
              {tipo}
            </span>

            <span className="relative flex w-[31px] shrink-0 flex-col items-center">
              <span
                className={`grid size-[31px] shrink-0 place-items-center rounded-full border shadow-sm ${
                  ultimo
                    ? "border-amber-500/45 bg-amber-50 text-amber-700"
                    : "border-[#d9d2be] bg-[#fdfbf6] text-[#5f5a4d]"
                }`}
              >
                <Icono className="size-3.5" />
              </span>
              {!ultimo && <span className="w-px flex-1 bg-[#d9d2be]" />}
            </span>

            <div className={`min-w-0 flex-1 pt-1 ${ultimo ? "" : "pb-7"}`}>
              <strong className="block text-[14px] leading-snug font-semibold">{texto}</strong>
              <span className="mt-1 block text-[12.5px] leading-snug text-[#8b8574]">{detalle}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Los permisos, que es lo que hace que un equipo de verdad pueda usar esto. */
export function MiniEquipo() {
  const gente = [
    { nombre: "Sofía Ledesma", rol: "Vendedora", leads: "31 leads", iniciales: "SL" },
    { nombre: "Nicolás Paz", rol: "Vendedor", leads: "27 leads", iniciales: "NP" },
    { nombre: "Ariel Gómez", rol: "Administrador", leads: "ve todo", iniciales: "AG" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {gente.map((persona) => (
        <div
          key={persona.nombre}
          className="flex items-center gap-3 rounded-lg border border-[#e3dcc8] bg-[#fdfbf6] px-3 py-2 shadow-sm"
        >
          <Avatar iniciales={persona.iniciales} className="size-7" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[12.5px] font-semibold">{persona.nombre}</strong>
            <span className="text-[10px] text-[#8b8574]">{persona.rol}</span>
          </span>
          <span className="shrink-0 font-[family-name:var(--fuente-mono)] text-[10px] text-[#a39c87]">
            {persona.leads}
          </span>
          <Check className="size-3.5 shrink-0 text-emerald-600" />
        </div>
      ))}
    </div>
  );
}
