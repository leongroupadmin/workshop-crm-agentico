-- Condición de etapa: la automatización corre sólo si el lead está en esa columna.
--
-- Hasta acá sólo el disparador `etapa` miraba el embudo, y lo miraba contra la
-- columna que lo había disparado. Los otros dos —`lead_nuevo` y
-- `sin_respuesta`— corrían igual sin importar dónde estuviera el lead: el
-- follow-up de silencio le salía a alguien que ya estaba en Ganado.
--
-- Null es "todas las etapas", y es el valor con el que quedan las filas que ya
-- existen: la condición no cambia lo que una automatización ya guardada venía
-- haciendo.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.automations
  add column if not exists etapa_requerida uuid;

-- Sin foreign key, igual que el `stageId` que vive dentro de `disparador`.
--
-- Con `on delete set null` borrar una columna del embudo convertiría la
-- condición en "todas las etapas" y la automatización pasaría a escribirle a
-- leads que hoy no toca: se ensancharía sola, en silencio. Sin la clave, una
-- etapa borrada no coincide con ninguna y la automatización deja de disparar,
-- que es el lado seguro del error. La pantalla la muestra como "una etapa
-- borrada" para que se note.
comment on column public.automations.etapa_requerida is
  'Etapa del embudo en la que tiene que estar el lead. Null: cualquiera.';
