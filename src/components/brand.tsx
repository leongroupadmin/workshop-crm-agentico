"use client";

import { useState } from "react";

/**
 * El archivo que sirve la web.
 *
 * Los originales están en `branding/`, que no se publica: `kivo-isotipo.png`
 * —de donde salen éste y los íconos de instalación— y `kivo-lockup.png`, que
 * suma la palabra sobre fondo transparente y no se usa acá porque a cuarenta
 * píxeles el texto no se leería.
 *
 * Se apunta a uno solo y no a una lista de formatos a probar: el `onError` no
 * sirve de red porque el navegador carga la imagen antes de que React hidrate,
 * y para entonces el evento del que falló ya pasó.
 */
const ARCHIVO = "/logo.png";

/**
 * El logo de la plataforma.
 *
 * Si ninguno de los archivos está —o no se pudo cargar— aparece la inicial
 * sobre el cuadrado de siempre: un logo que falta no tiene que dejar un hueco
 * roto en la barra.
 *
 * El fondo negro va acá y no en el archivo para que un logo con transparencia
 * se vea igual de bien que uno con el fondo ya puesto, y para que no
 * desaparezca en modo claro.
 */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  const [falló, setFalló] = useState(false);

  if (falló) {
    return (
      <div
        className={`${className} grid shrink-0 place-items-center rounded-xl bg-amber-500 text-sm font-bold text-neutral-950`}
      >
        K
      </div>
    );
  }

  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-xl bg-[#1c1811]`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image acá no
          aporta nada: es un archivo local, chico y de tamaño fijo, y sumaría
          una petición de optimización por cada carga de página. */}
      <img
        src={ARCHIVO}
        alt="Kivo"
        onError={() => setFalló(true)}
        className="size-full object-contain"
      />
    </div>
  );
}
