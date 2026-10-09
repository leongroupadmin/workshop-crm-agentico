-- Dispositivos que aceptaron recibir avisos de derivaciones.
--
-- Una suscripción pertenece a un usuario y a un workspace, pero el endpoint es
-- único: si dos personas usan el mismo navegador, la última sesión que activa
-- los avisos pasa a ser su dueña y no quedan alertas cruzadas.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_recipient_idx
  on public.push_subscriptions (workspace_id, user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions
  for select to authenticated
  using (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "users create own push subscriptions" on public.push_subscriptions;
create policy "users create own push subscriptions" on public.push_subscriptions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "users update own push subscriptions" on public.push_subscriptions;
create policy "users update own push subscriptions" on public.push_subscriptions
  for update to authenticated
  using (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "users delete own push subscriptions" on public.push_subscriptions;
create policy "users delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated
  using (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );
