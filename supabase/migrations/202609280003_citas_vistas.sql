-- Una cita que baja de Calendar entra sola, sin que nadie del equipo toque
-- nada. La campana necesita saber cuáles ya vio alguien para poder dejar de
-- mostrarlas, igual que una derivación se marca como atendida.
--
-- Nace en `true` y recién después pasa a `false` por omisión: así las citas que
-- ya existen quedan como vistas y la campana no arranca con meses de reservas
-- viejas encima. Las nuevas entran sin ver, que es lo que se quiere.
alter table public.appointments
  add column if not exists vista boolean not null default true;

alter table public.appointments
  alter column vista set default false;

comment on column public.appointments.vista is
  'Si alguien del equipo ya vio esta cita en la campana.';

-- La campana la consulta en cada carga del panel: sin índice es un scan de
-- toda la tabla, y las no vistas son siempre un puñado.
create index if not exists appointments_sin_ver_idx
  on public.appointments (workspace_id, start_time)
  where vista = false;
