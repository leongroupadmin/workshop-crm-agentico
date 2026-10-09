-- Citas que bajan de Google Calendar, y el lugar de donde van a colgar los
-- recordatorios.
--
-- Calendar es la fuente de la verdad y la tarjeta del CRM es un espejo: el
-- vendedor agenda donde ya agenda, n8n avisa, y el CRM se entera. Eso define
-- casi todo lo que sigue.
--
-- Tres flujos, y los dos últimos no son sobre la tarjeta sino sobre el
-- recordatorio ya encolado:
--
--   alta    en Calendar -> nace la cita
--   cambio  de día u hora -> la cita se corrige *y* el recordatorio viejo se
--           cancela, porque apunta al horario que ya no es
--   baja    -> la cita queda cancelada *y* el recordatorio se cancela, que es
--           el punto del flujo: una llamada borrada que igual avisa es peor
--           que no avisar
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

/* --------------------------------------------------- corridas de una cita */

-- De qué cita salió el recordatorio.
--
-- Sin esta columna el índice único de abajo permite una sola corrida activa por
-- (automatización, contacto), así que un cliente con dos turnos en la semana
-- recibe el recordatorio de uno y el del otro se pierde sin dejar rastro.
alter table public.automation_runs
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

-- El horario que tenía la cita cuando se anotó la corrida.
--
-- Es lo que hace que un cambio de día se note. El barrido no vuelve a anotar
-- una cita que ya tiene corrida *para ese horario*; si la cita se mueve, el
-- horario deja de coincidir y corresponde un recordatorio nuevo —que es lo
-- correcto, el cliente tiene que enterarse del jueves—. La corrida vieja la
-- cancela el webhook, para que no avise del martes que ya no existe.
alter table public.automation_runs
  add column if not exists cita_inicio timestamptz;

-- Lo que consulta el webhook para cancelar los recordatorios de una cita que se
-- movió o se borró.
create index if not exists automation_runs_cita_idx
  on public.automation_runs (appointment_id)
  where appointment_id is not null;

-- El índice de "una sola corrida activa" se parte en dos.
--
-- El de siempre sigue valiendo para los seguimientos, que son por contacto. Los
-- recordatorios son por cita: dos turnos del mismo cliente son dos corridas
-- legítimas, y lo que no puede haber es dos recordatorios vivos de la *misma*
-- cita.
drop index if exists public.automation_runs_una_activa_idx;

create unique index if not exists automation_runs_una_activa_idx
  on public.automation_runs (automation_id, contact_id)
  where estado = 'pendiente' and appointment_id is null;

create unique index if not exists automation_runs_una_por_cita_idx
  on public.automation_runs (automation_id, appointment_id)
  where estado = 'pendiente' and appointment_id is not null;

comment on column public.automation_runs.cita_inicio is
  'Horario de la cita al anotar la corrida. Si cambió, corresponde un recordatorio nuevo.';
