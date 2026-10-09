/**
 * `supabase/instalar.sql` tiene que ser exactamente la suma de las migraciones.
 *
 * Es lo que pegan en Supabase quienes instalan el CRM. Si alguien agrega una
 * migración y se olvida de regenerarlo, la instalación nueva queda sin esa
 * tabla y el error aparece recién cuando la pantalla la pide.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { armarInstalar, DESTINO } from "../scripts/armar-instalar.mjs";

test("instalar.sql está al día con supabase/migrations (si falla: npm run sql:instalar)", () => {
  assert.equal(readFileSync(DESTINO, "utf8"), armarInstalar());
});
