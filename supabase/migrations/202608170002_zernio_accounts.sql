-- Mapeo de cuentas de Zernio a workspaces.
--
-- Los webhooks entrantes no traen sesión de usuario: hay que resolver a qué
-- workspace pertenece cada mensaje. Zernio identifica la cuenta social que
-- recibió el mensaje con `account.id`, así que ese es el puente.
--
-- Un workspace puede tener varias cuentas (una por canal), por eso es tabla
-- aparte y no una columna en `workspaces`.

create table if not exists public.zernio_accounts (
  zernio_account_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text,
  username text,
  created_at timestamptz not null default now()
);

create index if not exists zernio_accounts_workspace_idx
  on public.zernio_accounts (workspace_id);

alter table public.zernio_accounts enable row level security;

-- El webhook escribe con la service-role key, que omite RLS. Esta política
-- solo habilita a los miembros a ver y administrar sus propias cuentas.
create policy "members manage zernio accounts" on public.zernio_accounts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
