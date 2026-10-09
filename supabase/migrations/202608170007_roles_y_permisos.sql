-- Dos tipos de usuario: administrador y operario.
--
-- El administrador ve y hace todo, y además configura qué puede hacer cada
-- operario. El operario arranca sin nada: sólo ve los leads que le asignaron y
-- las columnas del embudo que le habilitaron, y cada acción (crear contactos,
-- borrarlos, editar el embudo, responder chats) es un permiso que se prende
-- uno por uno.
--
-- Todo se aplica en la base, no en la pantalla. Esconder un botón no protege
-- nada: cualquiera con la sesión abierta puede llamar a la API igual. Por eso
-- las reglas viven en las políticas RLS y la interfaz sólo las refleja.

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------

-- Los permisos del operario, uno por clave. Va como jsonb y no como columnas
-- para poder agregar permisos sin migrar la tabla cada vez. El administrador
-- no lo usa: su rol ya le da todo.
alter table public.workspace_members
  add column if not exists permissions jsonb not null default '{}'::jsonb;

-- El responsable del lead. Es lo que decide qué ve un operario.
alter table public.contacts
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists contacts_assigned_idx
  on public.contacts (workspace_id, assigned_to);

-- ---------------------------------------------------------------------------
-- Qué columnas del embudo ve cada operario
-- ---------------------------------------------------------------------------

-- Tabla y no un arreglo de ids en workspace_members: con la clave foránea,
-- borrar una columna del embudo limpia sola las habilitaciones que la
-- apuntaban. Con un arreglo quedarían ids muertos para siempre.
create table if not exists public.member_stage_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  primary key (workspace_id, user_id, stage_id)
);

alter table public.member_stage_access enable row level security;

-- ---------------------------------------------------------------------------
-- Funciones de permiso
--
-- Todas son `security definer` a propósito: se las llama desde adentro de las
-- políticas RLS y necesitan leer workspace_members, contacts y pipeline_stages
-- sin volver a pasar por RLS. Si no, la política de una tabla dispararía la de
-- la otra y se caería en recursión infinita.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_admin(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- Un permiso suelto. El administrador los tiene todos sin cargarlos.
create or replace function public.has_permission(target_workspace uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or coalesce((m.permissions ->> perm)::boolean, false)
      )
  );
$$;

-- Si el usuario puede ver un lead según quién sea su responsable.
--
-- Tres niveles: el operario siempre ve lo suyo; con `ver_leads_sin_asignar` ve
-- además la bolsa de leads nuevos que todavía no repartió nadie; con
-- `ver_todos_los_leads` ve el workspace entero.
create or replace function public.can_see_contact(target_workspace uuid, owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or coalesce((m.permissions ->> 'ver_todos_los_leads')::boolean, false)
        or owner_id = auth.uid()
        or (owner_id is null
            and coalesce((m.permissions ->> 'ver_leads_sin_asignar')::boolean, false))
      )
  );
$$;

-- Lo mismo, pero partiendo del id del contacto. Lo usan chats y oportunidades.
create or replace function public.can_see_contact_row(target_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts c
    where c.id = target_contact
      and public.can_see_contact(c.workspace_id, c.assigned_to)
  );
$$;

create or replace function public.can_see_conversation(target_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations v
    where v.id = target_conversation
      and public.is_workspace_member(v.workspace_id)
      and public.can_see_contact_row(v.contact_id)
  );
$$;

-- Si el usuario puede ver una columna del embudo.
--
-- Sin filas cargadas en member_stage_access el operario ve el embudo completo:
-- el default es no restringir, para que agregar un usuario no lo deje mirando
-- una pantalla vacía. Restringir es una decisión explícita del administrador.
--
-- La primera columna se ve siempre. Es donde caen los leads nuevos, y si un
-- operario no la viera no podría cargar un contacto: la oportunidad que se
-- crea con él apunta justamente ahí.
create or replace function public.can_see_stage(target_workspace uuid, target_stage uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_workspace_admin(target_workspace)
    or not exists (
      select 1 from public.member_stage_access a
      where a.workspace_id = target_workspace and a.user_id = auth.uid()
    )
    or exists (
      select 1 from public.member_stage_access a
      where a.workspace_id = target_workspace
        and a.user_id = auth.uid()
        and a.stage_id = target_stage
    )
    or target_stage = (
      select ps.id from public.pipeline_stages ps
      where ps.workspace_id = target_workspace
      order by ps.position
      limit 1
    );
$$;

grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.can_see_contact(uuid, uuid) to authenticated;
grant execute on function public.can_see_contact_row(uuid) to authenticated;
grant execute on function public.can_see_conversation(uuid) to authenticated;
grant execute on function public.can_see_stage(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reasignar un lead es un permiso aparte
--
-- La política de UPDATE no alcanza para esto: mira la fila vieja y la nueva por
-- separado, así que un operario podría ponerse a sí mismo como responsable de
-- un lead que ya ve y quedárselo. El trigger compara los dos valores.
-- ---------------------------------------------------------------------------

create or replace function public.guard_contact_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- `auth.uid()` es null en los trabajos de servidor (el webhook entra con la
  -- service role key). Ahí no hay sesión que controlar y la guarda no aplica.
  if auth.uid() is not null
     and new.assigned_to is distinct from old.assigned_to
     and not public.has_permission(new.workspace_id, 'asignar_leads') then
    raise exception 'No tenés permiso para cambiar el responsable de un lead.';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_guard_assignment on public.contacts;
create trigger contacts_guard_assignment
  before update on public.contacts
  for each row execute function public.guard_contact_assignment();

-- ---------------------------------------------------------------------------
-- Políticas
--
-- Las de antes eran todas `for all` con la sola condición de ser miembro del
-- workspace. Se reemplazan por una por operación, porque leer y borrar ya no
-- piden lo mismo.
-- ---------------------------------------------------------------------------

-- Miembros del workspace ------------------------------------------------------

drop policy if exists "members read workspace members" on public.workspace_members;
create policy "members read workspace members" on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "admins manage workspace members" on public.workspace_members;
create policy "admins manage workspace members" on public.workspace_members
  for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- Habilitación de columnas ----------------------------------------------------

drop policy if exists "members read own stage access" on public.member_stage_access;
create policy "members read own stage access" on public.member_stage_access
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  );

drop policy if exists "admins manage stage access" on public.member_stage_access;
create policy "admins manage stage access" on public.member_stage_access
  for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- Contactos -------------------------------------------------------------------

drop policy if exists "members manage contacts" on public.contacts;

drop policy if exists "read visible contacts" on public.contacts;
create policy "read visible contacts" on public.contacts
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact(workspace_id, assigned_to)
  );

drop policy if exists "create contacts with permission" on public.contacts;
create policy "create contacts with permission" on public.contacts
  for insert to authenticated
  with check (public.has_permission(workspace_id, 'crear_contactos'));

drop policy if exists "update visible contacts" on public.contacts;
create policy "update visible contacts" on public.contacts
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact(workspace_id, assigned_to)
  )
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "delete contacts with permission" on public.contacts;
create policy "delete contacts with permission" on public.contacts
  for delete to authenticated
  using (
    public.has_permission(workspace_id, 'eliminar_contactos')
    and public.can_see_contact(workspace_id, assigned_to)
  );

-- Conversaciones y mensajes ---------------------------------------------------

drop policy if exists "members manage conversations" on public.conversations;

drop policy if exists "read visible conversations" on public.conversations;
create policy "read visible conversations" on public.conversations
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
  );

drop policy if exists "write visible conversations" on public.conversations;
create policy "write visible conversations" on public.conversations
  for all to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
  )
  with check (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
  );

drop policy if exists "members manage messages" on public.messages;

drop policy if exists "read visible messages" on public.messages;
create policy "read visible messages" on public.messages
  for select to authenticated
  using (public.can_see_conversation(conversation_id));

drop policy if exists "send messages with permission" on public.messages;
create policy "send messages with permission" on public.messages
  for insert to authenticated
  with check (
    public.can_see_conversation(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.has_permission(c.workspace_id, 'responder_chats')
    )
  );

drop policy if exists "update visible messages" on public.messages;
create policy "update visible messages" on public.messages
  for update to authenticated
  using (public.can_see_conversation(conversation_id))
  with check (public.can_see_conversation(conversation_id));

-- Embudo ----------------------------------------------------------------------

drop policy if exists "members manage pipeline stages" on public.pipeline_stages;

drop policy if exists "read allowed stages" on public.pipeline_stages;
create policy "read allowed stages" on public.pipeline_stages
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_stage(workspace_id, id)
  );

drop policy if exists "edit pipeline with permission" on public.pipeline_stages;
create policy "edit pipeline with permission" on public.pipeline_stages
  for all to authenticated
  using (public.has_permission(workspace_id, 'editar_embudo'))
  with check (public.has_permission(workspace_id, 'editar_embudo'));

drop policy if exists "members manage opportunities" on public.opportunities;

-- Una oportunidad se ve si se ve el lead y además la columna donde está. Mover
-- una tarjeta a una columna que no ves no se puede: el `with check` la frena.
drop policy if exists "read visible opportunities" on public.opportunities;
create policy "read visible opportunities" on public.opportunities
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
    and public.can_see_stage(workspace_id, stage_id)
  );

drop policy if exists "write visible opportunities" on public.opportunities;
create policy "write visible opportunities" on public.opportunities
  for all to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
    and public.can_see_stage(workspace_id, stage_id)
  )
  with check (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
    and public.can_see_stage(workspace_id, stage_id)
  );

-- Agenda ----------------------------------------------------------------------

drop policy if exists "members manage appointments" on public.appointments;

drop policy if exists "read visible appointments" on public.appointments;
create policy "read visible appointments" on public.appointments
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and public.can_see_contact_row(contact_id)
  );

drop policy if exists "manage appointments with permission" on public.appointments;
create policy "manage appointments with permission" on public.appointments
  for all to authenticated
  using (
    public.has_permission(workspace_id, 'gestionar_agenda')
    and public.can_see_contact_row(contact_id)
  )
  with check (
    public.has_permission(workspace_id, 'gestionar_agenda')
    and public.can_see_contact_row(contact_id)
  );

-- Agentes IA ------------------------------------------------------------------

drop policy if exists "members manage ai configs" on public.ai_agent_configs;

drop policy if exists "read ai configs" on public.ai_agent_configs;
create policy "read ai configs" on public.ai_agent_configs
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "manage ai configs with permission" on public.ai_agent_configs;
create policy "manage ai configs with permission" on public.ai_agent_configs
  for all to authenticated
  using (public.has_permission(workspace_id, 'gestionar_agentes'))
  with check (public.has_permission(workspace_id, 'gestionar_agentes'));

-- ---------------------------------------------------------------------------
-- El primero que entró al workspace queda como administrador
--
-- Antes el rol default era 'agent' y nadie lo miraba. Con esta migración el rol
-- pasa a importar, así que el miembro más viejo de cada workspace se promueve a
-- 'owner': sin esto el dueño del CRM se quedaría afuera de su propia cuenta.
-- ---------------------------------------------------------------------------

update public.workspace_members m
set role = 'owner'
where m.role not in ('owner', 'admin')
  and m.created_at = (
    select min(x.created_at) from public.workspace_members x
    where x.workspace_id = m.workspace_id
  );
