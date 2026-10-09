-- CRM de León: esquema inicial multi-tenant, con RLS habilitado.
create extension if not exists pgcrypto;

create type public.channel_type as enum ('whatsapp', 'instagram', 'messenger');
create type public.conversation_status as enum ('open', 'closed', 'pending');
create type public.sender_type as enum ('user', 'contact', 'ai');
create type public.opportunity_stage as enum ('new_lead', 'contacted', 'visit_scheduled', 'proposal', 'won', 'lost');
create type public.appointment_status as enum ('scheduled', 'completed', 'cancelled');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  avatar_url text,
  tags text[] not null default '{}',
  notes jsonb not null default '{}'::jsonb,
  bot_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel public.channel_type not null,
  zernio_chat_id text not null,
  status public.conversation_status not null default 'open',
  assigned_agent_id uuid references auth.users(id) on delete set null,
  unread_count integer not null default 0 check (unread_count >= 0),
  updated_at timestamptz not null default now(),
  unique (workspace_id, zernio_chat_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type public.sender_type not null,
  content text not null default '',
  media_url text,
  zernio_message_id text unique,
  created_at timestamptz not null default now()
);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Embudo principal',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  stage public.opportunity_stage not null default 'new_lead',
  value numeric(12, 2) not null default 0 check (value >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  google_event_id text,
  status public.appointment_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (workspace_id, google_event_id)
);

create table public.ai_agent_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel public.channel_type not null,
  system_prompt text not null default '',
  tools_config jsonb not null default '{"catalog_search": true, "schedule_appointment": true, "handoff_to_human": true}'::jsonb,
  model_version text not null default 'gpt-5',
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel)
);

create index contacts_workspace_created_idx on public.contacts (workspace_id, created_at desc);
create index conversations_workspace_updated_idx on public.conversations (workspace_id, updated_at desc);
create index conversations_contact_idx on public.conversations (contact_id);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index opportunities_workspace_stage_idx on public.opportunities (workspace_id, stage);
create index appointments_workspace_start_idx on public.appointments (workspace_id, start_time);

create or replace function public.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger conversations_touch_updated_at before update on public.conversations for each row execute function public.touch_updated_at();
create trigger opportunities_touch_updated_at before update on public.opportunities for each row execute function public.touch_updated_at();
create trigger ai_agent_configs_touch_updated_at before update on public.ai_agent_configs for each row execute function public.touch_updated_at();

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = target_workspace and user_id = auth.uid());
$$;
grant execute on function public.is_workspace_member(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.pipelines enable row level security;
alter table public.opportunities enable row level security;
alter table public.appointments enable row level security;
alter table public.ai_agent_configs enable row level security;

create policy "members read workspaces" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "members read workspace members" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members manage contacts" on public.contacts for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage conversations" on public.conversations for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage messages" on public.messages for all to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_workspace_member(c.workspace_id))) with check (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_workspace_member(c.workspace_id)));
create policy "members manage pipelines" on public.pipelines for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage opportunities" on public.opportunities for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage appointments" on public.appointments for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage ai configs" on public.ai_agent_configs for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

alter publication supabase_realtime add table public.conversations, public.messages;
