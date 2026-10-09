-- Reparto de leads: a quién le tocó cada uno.
--
-- Es un registro y no un contador. Un contador ("el próximo es el tercero")
-- se desincroniza en cuanto alguien entra o sale del reparto: el índice apunta
-- a otra persona y la rotación salta. Con el registro, cada vuelta se decide
-- mirando qué pasó, así que sacar a alguien de la lista no rompe nada y
-- cambiarle el peso se nota en las asignaciones siguientes.
--
-- De paso contesta la pregunta que siempre aparece: por qué este lead le cayó
-- a esta persona y no a la otra.
--
-- Idempotente: se puede correr dos veces sin romper nada.

create table if not exists public.automation_asignaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- A quién le tocó. Sin clave foránea a auth.users a propósito: si la persona
  -- se va del workspace, el registro de lo que pasó no tiene por qué borrarse.
  user_id uuid not null,
  -- Si lo eligió la rotación o cayó en el respaldo por no haber nadie en
  -- horario. Separarlos es lo que permite ver "el domingo le cayó todo al
  -- admin" sin tener que cruzar horarios a mano.
  respaldo boolean not null default false,
  created_at timestamptz not null default now()
);

-- Lo que lee la rotación: las últimas asignaciones de esta automatización.
create index if not exists automation_asignaciones_rotacion_idx
  on public.automation_asignaciones (automation_id, created_at desc);

alter table public.automation_asignaciones enable row level security;

-- Sólo lectura desde la app: las escribe el cron con la clave de servicio,
-- igual que las corridas.
drop policy if exists "members read automation asignaciones" on public.automation_asignaciones;
create policy "members read automation asignaciones" on public.automation_asignaciones
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

comment on table public.automation_asignaciones is
  'Qué usuario recibió cada lead y por qué automatización. Es el estado de la rotación.';
comment on column public.automation_asignaciones.respaldo is
  'true si no había nadie en horario y cayó en el responsable de respaldo.';
