-- Identidades de un contacto en cada canal.
--
-- La misma persona te puede escribir por WhatsApp, Instagram y Messenger. En
-- WhatsApp el teléfono alcanza para reconocerla, pero en Instagram y Messenger
-- no hay teléfono: el único identificador estable es el id que manda Zernio.
--
-- Sin esta tabla, cada canal creaba un contacto nuevo y el mismo lead aparecía
-- duplicado en el embudo. Es tabla aparte y no una columna en `contacts` para
-- que un contacto pueda tener varias identidades y se puedan fusionar después.

create table if not exists public.contact_identities (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform public.channel_type not null,
  external_id text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, platform, external_id)
);

create index if not exists contact_identities_contact_idx
  on public.contact_identities (contact_id);

alter table public.contact_identities enable row level security;

-- El webhook escribe con la service-role key, que omite RLS. Esta política solo
-- habilita a los miembros a ver las identidades de su propio workspace.
create policy "members manage contact identities" on public.contact_identities
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
