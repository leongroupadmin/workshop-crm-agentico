-- Repara una tabla de suscripciones creada antes de su forma actual.
--
-- `202608270001_push_notifications.sql` la crea con `create table if not exists`.
-- Cuando la tabla ya existía con otras columnas, ese create no hace nada y las
-- que faltan nunca aparecen: el alta de un dispositivo fallaba con
-- "Could not find the 'updated_at' column of 'push_subscriptions'".
--
-- Todo acá es idempotente: en una base que ya está bien, no cambia nada.

alter table public.push_subscriptions
  add column if not exists created_at timestamptz not null default now();

alter table public.push_subscriptions
  add column if not exists updated_at timestamptz not null default now();

-- El alta usa `onConflict: "endpoint"`, que necesita un índice único sobre esa
-- columna. Sin él, volver a abrir el CRM en el mismo navegador insertaría una
-- fila nueva en vez de refrescar la que ya está.
create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_recipient_idx
  on public.push_subscriptions (workspace_id, user_id);
