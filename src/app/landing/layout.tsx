import { Geist_Mono, Manrope } from "next/font/google";

/**
 * La tipografía de la landing.
 *
 * Vive en un layout propio y no en el de la raíz a propósito: el CRM usa la
 * tipografía del sistema —la que ya tiene instalada el que trabaja ocho horas
 * adentro, sin descargar un archivo— y esa decisión no cambia. La landing es
 * otra cosa: es lo primero que ve alguien que no nos conoce, y ahí el carácter
 * de la letra es parte de la marca.
 *
 * Manrope para todo lo que se lee: es geométrica pero de formas cálidas, cierra
 * bien apretado en los títulos grandes y no es la de todas las webs de IA.
 *
 * Geist Mono para los datos: estados, horarios, importes, etiquetas de campo.
 * No es decoración —es lo que hace que la página se sienta un software que
 * opera y no un folleto que promete. Va como variable porque se usa en pocos
 * lugares y puntuales, no como fuente heredada.
 *
 * `next/font` las descarga en tiempo de compilación y las sirve desde nuestro
 * dominio: no hay pedido a Google desde el navegador del visitante ni salto de
 * maquetación al cargar.
 */
const manrope = Manrope({ subsets: ["latin"], display: "swap" });

const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--fuente-mono",
});

export default function LandingLayout({ children }: LayoutProps<"/landing">) {
  return (
    <div className={`${manrope.className} ${mono.variable} flex min-h-full flex-1 flex-col`}>
      {children}
    </div>
  );
}
