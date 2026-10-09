/**
 * Junta todas las migraciones en `supabase/instalar.sql`.
 *
 * Es el archivo que se pega una sola vez en el SQL Editor de un proyecto de
 * Supabase nuevo. Pegar las migraciones de a una funciona igual, pero son más
 * de treinta, y saltearse una o cambiar el orden deja la base a medio armar.
 *
 * Se regenera con `npm run sql:instalar`. Hay una prueba que falla si quedó
 * desactualizado respecto de `supabase/migrations/`.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CARPETA = join(RAIZ, "supabase", "migrations");
export const DESTINO = join(RAIZ, "supabase", "instalar.sql");

export function armarInstalar(carpeta = CARPETA) {
  // El orden es el del nombre: cada migración empieza con su fecha.
  const archivos = readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith(".sql"))
    .sort();

  const partes = archivos.map((nombre) => {
    const sql = readFileSync(join(carpeta, nombre), "utf8").trimEnd();
    return `-- =============================================================================\n-- ${nombre}\n-- =============================================================================\n\n${sql}\n`;
  });

  return `-- Instalación completa de la base del CRM, en un solo archivo.
--
-- Pegalo entero en el SQL Editor de un proyecto de Supabase NUEVO y tocá Run.
-- No lo corras en la base del CRM de producción.
--
-- Son las ${archivos.length} migraciones de supabase/migrations/, en orden. No lo edites a
-- mano: se regenera con \`npm run sql:instalar\`.

${partes.join("\n")}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DESTINO, armarInstalar());
  console.log(`Listo: ${DESTINO}`);
}
