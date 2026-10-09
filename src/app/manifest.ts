import type { MetadataRoute } from "next";

/**
 * El manifest de instalación.
 *
 * Sólo lo lee el navegador cuando alguien instala el CRM en su dispositivo: la
 * aplicación en el explorador no lo mira nunca. Cambiar esto no puede alterar
 * cómo funciona el CRM abierto en una pestaña.
 *
 * Los íconos son tres y no uno. Android pide 192 y 512 para ofrecer la
 * instalación —con un único tamaño "any" a veces directamente no la ofrece, y
 * cuando la ofrece deja un ícono borroso en la pantalla de inicio— y el
 * `maskable` es el que se deja recortar con la forma que usa cada launcher.
 * Sin él, Android mete el ícono cuadrado dentro de un círculo blanco.
 *
 * Es también lo que lee Bubblewrap para generar el APK, así que un manifest
 * incompleto se arrastra hasta la app de Android.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kivo",
    short_name: "Kivo",
    description: "CRM agéntico multicanal para León Group.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0b09",
    theme_color: "#0d0b09",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // La marca va más chica acá a propósito: el recorte de Android sólo
      // garantiza el 80% central, y con el ícono común le comería las puntas.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
