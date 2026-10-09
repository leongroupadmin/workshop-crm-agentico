-- Citas que bajan de Google Calendar.
--
-- Calendar es la fuente de la verdad y la tarjeta del CRM es un espejo: el
-- vendedor agenda donde ya agenda, n8n avisa, y el CRM se entera. Eso define
-- casi todo lo que sigue.
--
-- Tres flujos:
--
--   alta    en Calendar -> nace la cita
--   cambio  de día u hora -> la cita se corrige
--   baja    -> la cita queda cancelada
--
-- La clave de todo es `appointments.google_event_id`, que ya existía sin usarse
-- desde la migración inicial, con su `unique (workspace_id, google_event_id)`.
-- Esa restricción es la que hace idempotente al webhook: n8n puede reintentar
-- el mismo POST y la base rechaza el duplicado.
--
-- Idempotente: se puede correr dos veces sin romper nada.

/* --------------------------------------------------------------- las citas */

-- Qué clase de cita es. Es lo que separa "recordatorio de llamada" de
-- "recordatorio de reunión" sin obligar a dos configuraciones.
--
-- Texto con check y no un enum de Postgres a propósito: agregar un valor a un
-- enum no se puede deshacer dentro de una transacción, y esta lista va a
-- crecer.
alter table public.appointments
  add column if not exists tipo text not null default 'reunion';

-- Quién manda sobre esta fila.
--
-- Sin esto no se puede distinguir una cita que bajó de Calendar de una que
-- alguien cargó a mano en el CRM, y la segunda quedaría expuesta a que la
-- sincronización la pise. Es la columna que hace convivir las dos formas de
-- agendar en la misma tabla.
alter table public.appointments
  add column if not exists origen text not null default 'manual';

-- El enlace al evento en Calendar, para poder abrirlo desde la agenda. Es el
-- `hangoutLink` o el `htmlLink` que ya viaja por n8n.
alter table public.appointments
  add column if not exists calendar_link text;

-- El teléfono tal como llegó del evento, ya normalizado a E.164.
--
-- Se guarda acá además de en `contacts.phone` porque son dos cosas distintas:
-- el del contacto es el que el equipo mantiene, y este es el que la persona
-- puso al reservar. Cuando no coinciden, esta columna es la que explica por qué
-- el recordatorio salió a donde salió.
alter table public.appointments
  add column if not exists telefono text;

-- La descripción del evento, que es de donde n8n saca el nombre y el teléfono.
-- Queda guardada para poder reconstruir qué se leyó cuando la extracción falle.
alter table public.appointments
  add column if not exists notas text;

alter table public.appointments
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_tipo_check') then
    alter table public.appointments
      add constraint appointments_tipo_check
      check (tipo in ('reunion', 'llamada', 'visita', 'otro'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'appointments_origen_check') then
    alter table public.appointments
      add constraint appointments_origen_check
      check (origen in ('manual', 'calendar'));
  end if;
end $$;

-- Lo que va a leer el barrido de recordatorios: las que vienen y siguen en pie.
create index if not exists appointments_proximas_idx
  on public.appointments (workspace_id, start_time)
  where status = 'scheduled';

comment on column public.appointments.origen is
  'Quién manda sobre la fila: calendar la sincroniza y sobrescribe, manual no se toca.';
comment on column public.appointments.tipo is
  'Clase de cita. El disparador de recordatorios filtra por acá.';
comment on column public.appointments.telefono is
  'Teléfono con el que se reservó, ya en E.164. Explica a dónde salió el recordatorio.';
