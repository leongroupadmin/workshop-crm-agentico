import { UsersRound } from "lucide-react";

/**
 * El logo de la plataforma: un ícono de contactos, que es de lo que se trata
 * un CRM.
 *
 * Va dibujado con el ícono y no con un archivo para que no haya nada que
 * pueda fallar al cargar y dejar un hueco roto en la barra. Los íconos de
 * instalación y la pestaña (`public/icon-*.png`, `public/logo.png`,
 * `src/app/icon.png` y `src/app/apple-icon.png`) son este mismo dibujo, con
 * los mismos colores.
 *
 * El fondo oscuro va acá para que no desaparezca en modo claro.
 */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`${className} grid shrink-0 place-items-center rounded-xl bg-[#1c1811] text-amber-500`}
    >
      <UsersRound className="size-3/5" strokeWidth={2} />
    </div>
  );
}
