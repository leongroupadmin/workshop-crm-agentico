-- Conversiones de Meta (CAPI): de qué anuncio vino cada lead y qué se le avisó
-- a Meta cuando avanzó en el embudo.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- ---------------------------------------------------------------------------
-- El origen del lead
--
-- Cuando alguien escribe tocando un anuncio de Click-to-WhatsApp, el primer
-- mensaje trae el identificador del clic. Es lo único que después permite
-- atribuirle la conversión al anuncio, y no se puede reconstruir: si no se
-- guarda en ese momento, se perdió. Va en el contacto porque la conversión
-- puede pasar días después, en otra charla o movida a mano.
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists meta_ctwa_clid text,
  add column if not exists meta_ad_id text,
  add column if not exists meta_waba_id text,
  add column if not exists meta_clic_at timestamptz;

comment on column public.contacts.meta_ctwa_clid is
  'Id del clic en el anuncio de Click-to-WhatsApp que trajo al lead. Se pisa con el más reciente.';

-- ---------------------------------------------------------------------------
-- La cuenta de Meta de cada workspace
--
-- Cada workspace es un cliente distinto, con su propio dataset. El token es un
-- secreto: la pantalla nunca lo lee de vuelta, sólo sabe si está cargado. Por
-- eso la tabla no tiene política de lectura para usuarios —la escribe y la lee
-- el servidor con la clave de servicio, después de comprobar que quien pide es
-- administrador—.
-- ---------------------------------------------------------------------------

create table if not exists public.meta_capi_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  dataset_id text not null check (dataset_id ~ '^[0-9]{5,25}$'),
  access_token text not null check (length(access_token) between 20 and 1000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Código de prueba del Administrador de eventos. Con él cargado los eventos
  -- aparecen en "Probar eventos" y no cuentan en las campañas.
  test_event_code text,
  updated_at timestamptz not null default now()
);

alter table public.meta_capi_configs enable row level security;

-- ---------------------------------------------------------------------------
-- Lo que se mandó
--
-- Una fila por contacto y evento. El índice único es lo que impide que un lead
-- que sale de la columna y vuelve a entrar cuente dos veces: la conversión es
-- que llegó, no cuántas veces pasó por ahí.
-- ---------------------------------------------------------------------------

create table if not exists public.meta_conversiones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  evento text not null,
  -- `sin_anuncio`: el lead llegó a la columna pero no vino de un anuncio, así
  -- que no hay a qué atribuírselo. Se anota igual para que la pantalla muestre
  -- cuántos de los que convierten vienen de las campañas.
  estado text not null check (estado in ('enviada', 'fallada', 'sin_anuncio')),
  valor numeric,
  detalle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_conversiones_contacto_evento_idx
  on public.meta_conversiones (contact_id, evento);

create index if not exists meta_conversiones_workspace_idx
  on public.meta_conversiones (workspace_id, created_at desc);

alter table public.meta_conversiones enable row level security;

-- Sólo lectura, y sólo administradores: es el registro que muestra
-- Configuración. Las filas las escribe el cron.
drop policy if exists "admins leen conversiones" on public.meta_conversiones;
create policy "admins leen conversiones" on public.meta_conversiones
  for select to authenticated
  using (public.is_workspace_admin(workspace_id));
