"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Una preferencia del usuario guardada en el navegador.
 *
 * Va con `useSyncExternalStore` y no con `useState` + efecto porque el servidor
 * también renderiza esta pantalla: leer localStorage durante el render da un
 * valor distinto en el servidor que en el navegador y React se queja de la
 * hidratación. Este hook declara explícitamente qué ve el servidor —siempre
 * `false`— y deja que el navegador corrija en el primer commit.
 *
 * El evento propio es para que dos componentes que miran la misma clave se
 * enteren entre ellos: `storage` sólo avisa a las *otras* pestañas.
 */
const EVENTO = "leon-crm:preferencia";

function suscribir(callback: () => void) {
  window.addEventListener(EVENTO, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENTO, callback);
    window.removeEventListener("storage", callback);
  };
}

export function usePreference(key: string): [boolean, (value: boolean) => void] {
  const leer = useCallback(() => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      // Modo incógnito con almacenamiento bloqueado: la preferencia se pierde
      // al recargar, pero la pantalla no se rompe.
      return false;
    }
  }, [key]);

  const value = useSyncExternalStore(suscribir, leer, () => false);

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Sin almacenamiento no se puede persistir, pero el evento igual
        // actualiza lo que se ve mientras dure la sesión.
      }
      window.dispatchEvent(new Event(EVENTO));
    },
    [key],
  );

  return [value, set];
}
