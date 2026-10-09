-- Automatizaciones: un disparador, una espera y una secuencia de pasos.
--
-- Son dos tablas y no una porque separan dos cosas de vida distinta: la
-- automatización es la receta, que se escribe una vez y casi no cambia, y la
-- corrida es cada lead atravesándola, que cambia todo el tiempo y se borra sola
-- cuando el contacto se va.
--
-- Los pasos van en jsonb y no en una tabla aparte a propósito: nunca se leen de
-- a uno —para ejecutar el paso 3 hace falta saber que existe el 4— y una tabla
-- hija obligaría a un join y a mantener el orden a mano en cada edición.
--
-- Idempotente: se puede correr dos veces sin romper nada.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  -- Nace apagada. Una automatización a medio configurar que arranca sola le
  -- escribe a clientes reales, y eso no se puede deshacer.
  enabled boolean not null default false,
  -- {tipo: 'etapa'|'lead_nuevo'|'sin_respuesta', stageId?, esperaMinutos}
  disparador jsonb not null,
  -- [{tipo: 'esperar'|'plantilla'|'texto'|'ia'|'mover'|'avisar', ...}]
  pasos jsonb not null default '[]'::jsonb,
  -- Si el lead contesta, la secuencia se corta. Sin esto le llega el
  -- "¿seguís interesado?" a alguien que respondió ayer.
  cancelar_si_responde boolean not null default true,
  -- Franja en la que se permite enviar, en minutos desde la medianoche de la
  -- zona. Un paso que cae afuera no se pierde: espera a que abra.
  hora_desde smallint not null default 540 check (hora_desde between 0 and 1439),
  hora_hasta smallint not null default 1260 check (hora_hasta between 0 and 1439),
  -- Reserva. Manda `workspaces.timezone`; esta sólo se usa si esa columna
  -- todavía no existe, para que una migración pendiente no mande de madrugada.
  zona text not null default 'America/Argentina/Buenos_Aires',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automations_workspace_idx
  on public.automations (workspace_id);

alter table public.automations enable row level security;

drop policy if exists "members read automations" on public.automations;
create policy "members read automations" on public.automations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Escribir queda para el administrador: una automatización mal armada le
-- escribe a toda la base de contactos.
drop policy if exists "admins manage automations" on public.automations;
create policy "admins manage automations" on public.automations
  for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- Índice del próximo paso a ejecutar dentro de `automations.pasos`.
  paso smallint not null default 0,
  -- Cuándo hay que despertar a mirarla. Es lo único que consulta el cron.
  corre_en timestamptz not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'hecha', 'cancelada', 'fallada')),
  detalle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lo que lee el cron en cada vuelta.
create index if not exists automation_runs_pendientes_idx
  on public.automation_runs (corre_en)
  where estado = 'pendiente';

create index if not exists automation_runs_contacto_idx
  on public.automation_runs (automation_id, contact_id);

-- Una automatización no persigue dos veces al mismo contacto a la vez. Es la
-- red que evita el mensaje duplicado cuando el mismo disparador se dispara dos
-- veces —arrastrar la tarjeta de ida y de vuelta entre dos columnas, por
-- ejemplo— sin tener que acordarse de chequearlo en cada lugar que lo crea.
create unique index if not exists automation_runs_una_activa_idx
  on public.automation_runs (automation_id, contact_id)
  where estado = 'pendiente';

alter table public.automation_runs enable row level security;

-- Sólo lectura desde la app: las corridas las escribe el cron con la clave de
-- servicio. Nadie las crea ni las edita a mano desde el navegador.
drop policy if exists "members read automation runs" on public.automation_runs;
create policy "members read automation runs" on public.automation_runs
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

comment on column public.automations.disparador is
  'Qué la arranca y cuánto espera antes del primer paso.';
comment on column public.automation_runs.corre_en is
  'Cuándo toca el próximo paso. El cron busca por acá, no por el disparador.';

-- Qué automatización mandó cada mensaje.
--
-- Hace exacto el tope diario por contacto: sin esto habría que adivinarlo
-- contando corridas, y una corrida puede mandar más de un mensaje. De paso deja
-- rastro para cuando alguien pregunte por qué le llegó eso a un cliente.
alter table public.messages
  add column if not exists automation_id uuid references public.automations(id) on delete set null;

create index if not exists messages_automation_idx
  on public.messages (automation_id, created_at)
  where automation_id is not null;
