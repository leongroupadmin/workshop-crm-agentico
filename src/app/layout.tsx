import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kivo",
  description: "CRM agéntico multicanal para León Group.",
};

/**
 * El teclado del celular achica la página en vez de taparla.
 *
 * Con el valor de fábrica (`resizes-visual`) el teclado se abre encima: la
 * pantalla mide lo mismo que antes y la barra para escribir del chat, que está
 * abajo de todo, queda debajo de las teclas. Con `resizes-content` el alto que
 * mide `100dvh` pasa a ser el que queda libre, así que la barra sube sola y se
 * queda quieta ahí mientras se escribe.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
