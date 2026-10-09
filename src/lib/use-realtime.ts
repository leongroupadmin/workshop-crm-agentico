"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Se suscribe a los cambios de una tabla y avisa cuando entra o cambia una fila.
 *
 * Realtime respeta RLS, así que el navegador solo recibe filas que el usuario
 * podría leer con una consulta normal: no hace falta filtrar por `workspace_id`.
 *
 * Y ahí está la parte delicada. El socket tiene que llevar el token del
 * usuario; si se conecta antes de que la sesión esté lista, viaja con la anon
 * key, RLS no deja pasar una sola fila y el canal queda mudo *sin dar error*:
 * dice "SUBSCRIBED" y no llega nada nunca. Por eso primero se espera el token y
 * recién después se hace `subscribe`.
 *
 * Devuelve si el canal está escuchando en este momento. Es lo que le dice al
 * polling de respaldo cuánto apurarse: con el socket arriba los cambios llegan
 * solos y repetir la consulta cada pocos segundos sólo llena los logs de
 * Supabase —que en el plan gratis tienen tope—; con el socket caído, el
 * polling es lo único que mantiene la pantalla al día.
 */
export function useRealtimeInserts(
  table: "messages" | "conversations",
  filter: string | undefined,
  onInsert: (row: Record<string, unknown>) => void,
): boolean {
  // El callback se lee de un ref para que cambiarlo no rearme la suscripción:
  // reconectar el socket pierde los eventos que llegan durante el cambio.
  const handler = useRef(onInsert);
  useEffect(() => {
    handler.current = onInsert;
  });

  // Arranca en falso: hasta que el canal confirma, se pregunta al ritmo rápido.
  const [enVivo, setEnVivo] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelado = false;
    let canal: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      // Sin argumentos toma el token de la sesión activa del cliente.
      await supabase.realtime.setAuth();
      if (cancelado) return;

      canal = supabase
        .channel(`${table}-${filter ?? "all"}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) => handler.current((payload.new ?? {}) as Record<string, unknown>),
        )
        .subscribe((status) => {
          // El cierre del canal anterior llega después de que el nuevo ya
          // arrancó —al cambiar de chat, por ejemplo— y no tiene que pisarlo.
          if (cancelado) return;

          // Cuando el socket se corta —el wifi que salta, el latido que no
          // vuelve— el canal pasa por error y, al reconectarse solo, vuelve a
          // avisar "SUBSCRIBED". Así el estado sigue al socket sin vigilarlo.
          setEnVivo(status === "SUBSCRIBED");

          // Un canal caído es silencioso: la pantalla simplemente deja de
          // actualizarse. Queda en consola para poder distinguirlo de "no pasó
          // nada" cuando algo no aparece.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.warn(`[realtime] canal ${table} en estado ${status}`);
          }
        });
    })();

    return () => {
      cancelado = true;
      setEnVivo(false);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [table, filter]);

  return enVivo;
}

/**
 * Junta en una sola llamada los avisos que llegan en ráfaga.
 *
 * Un mensaje no toca `conversations` una vez sino varias: entra el del
 * contacto, sale la respuesta del agente, vuelve el eco del proveedor, se marca
 * leído. Y una difusión toca cientos seguidas. Si cada aviso recarga el
 * dashboard entero —una quincena de pedidos a Supabase— en cada pestaña
 * abierta, los logs del plan gratis se llenan con recargas que nadie llega a
 * ver, porque la siguiente pisa a la anterior.
 *
 * Así que el primer aviso espera un momento a que termine la ráfaga, y entre
 * una llamada y la siguiente pasa como mínimo `separacionMs`. Con la pestaña
 * oculta no hace nada: al volver, `usePolling` pide en el acto.
 */
export function useAgrupado(callback: () => void, separacionMs: number): () => void {
  const handler = useRef(callback);
  useEffect(() => {
    handler.current = callback;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultima = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(() => {
    if (document.visibilityState !== "visible" || timer.current) return;

    const espera = Math.max(ESPERA_DE_RAFAGA_MS, ultima.current + separacionMs - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      if (document.visibilityState !== "visible") return;
      ultima.current = Date.now();
      handler.current();
    }, espera);
  }, [separacionMs]);
}

/** Lo que se espera a que termine una ráfaga antes de llamar. */
const ESPERA_DE_RAFAGA_MS = 2000;

/**
 * Vuelve a pedir los datos cada tanto, como red de seguridad de Realtime.
 *
 * Realtime es un socket: se cae con la red del celular, con el wifi que salta,
 * con la pestaña en segundo plano que el navegador congela, o con un proxy que
 * corta las conexiones largas. Cuando eso pasa no hay error visible — la
 * pantalla se queda quieta y parece que no llegó ningún mensaje.
 *
 * Sólo corre con la pestaña a la vista, y hace una consulta al volver de
 * segundo plano: es justo el momento en que lo que se ve está más viejo.
 *
 * El intervalo puede cambiar sobre la marcha —uno lento con el socket arriba,
 * uno rápido con el socket caído— y cada cambio pide una vez en el acto. Al
 * caerse el socket, para no esperar la primera vuelta del reloj rápido. Al
 * volver, porque lo que entró mientras el canal se reconectaba no lo trae
 * nadie: el socket no repite eventos y el reloj lento tarda en pasar.
 */
export function usePolling(callback: () => void, intervalMs: number) {
  const handler = useRef(callback);
  useEffect(() => {
    handler.current = callback;
  });

  // El intervalo de la vuelta anterior. Sólo un cambio de verdad pide en el
  // acto: el montaje no, que los datos acaban de llegar con la página.
  const intervaloAnterior = useRef<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const cambio = intervaloAnterior.current !== null && intervaloAnterior.current !== intervalMs;
    intervaloAnterior.current = intervalMs;
    if (cambio && document.visibilityState === "visible") handler.current();

    const arrancar = () => {
      if (timer) return;
      timer = setInterval(() => handler.current(), intervalMs);
    };

    const parar = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        handler.current();
        arrancar();
      } else {
        parar();
      }
    };

    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    return () => {
      parar();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [intervalMs]);
}
