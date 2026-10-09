-- Las métricas del Resumen dejan de contarse a ojo.
--
-- Hasta acá cada tarjeta se calculaba en la aplicación sobre las filas que ya
-- estaban traídas para pintar las otras secciones, y eso tenía dos problemas.
--
-- El primero es que esas filas vienen paginadas: "Contactos" hacía
-- `contacts.length` sobre una consulta con `limit(200)`, así que del contacto
-- 201 en adelante el número se congelaba y nadie se enteraba. Lo mismo con los
-- no leídos, que sumaban sobre las 50 conversaciones más recientes.
--
-- El segundo es que hay métricas que no se pueden calcular así ni trayendo todo:
-- el lapso de réplica necesita mirar cada mensaje contra el siguiente, y eso en
-- Postgres es una función de ventana y en la aplicación es traerse un mes de
-- mensajes a la memoria del servidor.
--
-- Por eso las cuentas bajan a la base, en una sola función que devuelve una
-- fila. Y por eso aparece el historial de etapas: "ganado este mes" se apoyaba
-- en `opportunities.updated_at`, que un trigger pisa en *cualquier* update, así
-- que tocarle el valor a una oportunidad cerrada en junio la volvía a contar
-- como ganada hoy.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- ---------------------------------------------------------------------------
-- Historial de etapas
--
-- Una fila por vez que una oportunidad cambia de columna. Es lo único que
-- permite preguntar "qué se ganó en julio" sin que la respuesta dependa de lo
-- que se haya editado después.
--
-- `kind` se copia en vez de leerse del join: el evento cuenta lo que pasó ese
-- día. Si mañana el usuario borra la columna "Ganado" o la reconvierte en una
-- etapa abierta, los cierres del mes pasado siguen habiendo sido cierres. Por
-- eso también `stage_id` es `on delete set null` y no `cascade`: se puede
-- perder el nombre de la columna, no el hecho.
-- ---------------------------------------------------------------------------

create table if not exists public.opportunity_stage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  kind text not null check (kind in ('open', 'won', 'lost')),
  created_at timestamptz not null default now()
);

-- El índice que usa la métrica: los cierres de un workspace en un rango.
create index if not exists opportunity_stage_events_workspace_idx
  on public.opportunity_stage_events (workspace_id, kind, created_at);

create index if not exists opportunity_stage_events_opportunity_idx
  on public.opportunity_stage_events (opportunity_id, created_at);

-- `security definer` porque el trigger escribe la fila de auditoría en nombre
-- de quien movió la tarjeta, y esa persona no tiene —ni tiene que tener—
-- permiso de insertar acá a mano.
create or replace function public.log_opportunity_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.opportunity_stage_events (workspace_id, opportunity_id, stage_id, kind)
    select new.workspace_id, new.id, new.stage_id, coalesce(ps.kind, 'open')
    from public.pipeline_stages ps
    where ps.id = new.stage_id;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_log_stage on public.opportunities;
create trigger opportunities_log_stage
  after insert or update of stage_id on public.opportunities
  for each row execute function public.log_opportunity_stage_change();

-- Siembra de lo que ya existe.
--
-- Es una aproximación y conviene saberlo: de las oportunidades viejas sólo se
-- conoce dónde están hoy y cuándo se las tocó por última vez, así que se
-- registra un único evento con esa fecha. Alcanza para que el tablero no
-- arranque en cero, y de acá en adelante el historial es exacto.
insert into public.opportunity_stage_events (workspace_id, opportunity_id, stage_id, kind, created_at)
select o.workspace_id, o.id, o.stage_id, ps.kind, o.updated_at
from public.opportunities o
join public.pipeline_stages ps on ps.id = o.stage_id
where not exists (
  select 1 from public.opportunity_stage_events e where e.opportunity_id = o.id
);

alter table public.opportunity_stage_events enable row level security;

-- Un evento se ve si se ve la oportunidad. `security definer` por lo mismo que
-- el resto de las funciones de permiso: se la llama desde adentro de una
-- política y no puede volver a disparar la de `opportunities`.
create or replace function public.can_see_opportunity(target_opportunity uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.opportunities o
    where o.id = target_opportunity
      and public.is_workspace_member(o.workspace_id)
      and public.can_see_contact_row(o.contact_id)
      and public.can_see_stage(o.workspace_id, o.stage_id)
  );
$$;

grant execute on function public.can_see_opportunity(uuid) to authenticated;

-- Sólo lectura: las filas las escribe el trigger. Nadie edita el historial.
drop policy if exists "leer historial de etapas" on public.opportunity_stage_events;
create policy "leer historial de etapas" on public.opportunity_stage_events
  for select to authenticated
  using (public.can_see_opportunity(opportunity_id));

-- ---------------------------------------------------------------------------
-- Un índice por fecha en los mensajes
--
-- El que había es `(conversation_id, created_at)`, perfecto para pintar un chat
-- y inútil para "todos los mensajes del mes", que es lo que pide el lapso de
-- réplica. Sin esto la función recorre la tabla entera cada vez que alguien
-- abre el tablero.
-- ---------------------------------------------------------------------------
create index if not exists messages_created_idx on public.messages (created_at);

-- ---------------------------------------------------------------------------
-- Las métricas del Resumen, en una sola ida
--
-- `security invoker`: la función corre con las políticas de quien la llama, así
-- que un operario que sólo ve sus leads ve las métricas de sus leads. Si fuera
-- `definer` el tablero le mostraría los números del workspace entero.
--
-- Los cortes de tiempo llegan resueltos desde la aplicación, que es la que
-- conoce la zona horaria del workspace: acá adentro no se decide qué es "hoy".
-- El tramo previo no es el mes pasado completo sino su mismo tramo —del 1 al
-- 21 si hoy es 21— porque comparar veintiún días contra treinta y uno hace que
-- todo parezca que se derrumbó.
-- ---------------------------------------------------------------------------
create or replace function public.metricas_resumen(
  p_workspace uuid,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_previo_desde timestamptz,
  p_previo_hasta timestamptz
)
returns table (
  contactos bigint,
  leads_nuevos bigint,
  leads_nuevos_previos bigint,
  sin_leer bigint,
  sin_responder bigint,
  derivaciones bigint,
  ganado numeric,
  ganado_operaciones bigint,
  ganado_previo numeric,
  replica_peor numeric,
  replica_mediana numeric,
  replicas bigint,
  replica_peor_previa numeric
)
language sql stable security invoker set search_path = public as $$
with
-- Los chats de los que se habla en todo lo que sigue: los del workspace cuyo
-- contacto no está archivado. Archivar esconde a la persona de cada módulo, y
-- las métricas no pueden ser la excepción que la delate.
chats as (
  select v.id, v.status, v.unread_count, v.updated_at
  from public.conversations v
  join public.contacts c on c.id = v.contact_id
  where v.workspace_id = p_workspace
    and c.archived_at is null
),
-- Los mensajes del tramo, más una semana de colchón hacia atrás: la réplica a
-- un mensaje que entró el 31 a las 23:50 se responde en el mes siguiente, y sin
-- ese margen la espera más larga del mes es justo la que no se ve.
mensajes as (
  select m.conversation_id, m.sender_type, m.created_at
  from public.messages m
  join chats v on v.id = m.conversation_id
  where m.created_at >= p_previo_desde - interval '7 days'
    and m.created_at < p_hasta
),
-- Cuántas salidas hubo hasta cada mensaje. Es el truco que agrupa la
-- conversación en turnos: todos los mensajes seguidos del contacto comparten
-- número, y el primero que sale después lleva el siguiente. Emparejar los dos
-- da la espera, sin importar cuántas veces haya escrito la persona mientras
-- esperaba: se cuenta desde el primero, que es cuando empezó a esperar.
bloques as (
  select
    conversation_id,
    sender_type,
    created_at,
    sum(case when sender_type in ('user', 'ai') then 1 else 0 end) over (
      partition by conversation_id
      order by created_at
      rows between unbounded preceding and current row
    ) as bloque
  from mensajes
),
esperas as (
  select conversation_id, bloque, min(created_at) as consulta
  from bloques
  where sender_type = 'contact'
  group by conversation_id, bloque
),
-- Contesta la IA o contesta una persona: para quien está del otro lado la
-- espera terminó igual, y eso es lo que la métrica mide.
replicas_todas as (
  select
    r.created_at as respondido,
    extract(epoch from (r.created_at - e.consulta))::numeric as segundos
  from esperas e
  join bloques r
    on r.conversation_id = e.conversation_id
   and r.bloque = e.bloque + 1
   and r.sender_type in ('user', 'ai')
),
-- Se ordenan por cuándo se respondió y no por cuándo entró la consulta: la
-- pregunta es "cuánto hicimos esperar este mes".
replicas_mes as (
  select segundos from replicas_todas
  where respondido >= p_desde and respondido < p_hasta
),
replicas_previas as (
  select segundos from replicas_todas
  where respondido >= p_previo_desde and respondido < p_previo_hasta
),
-- Quién habló último en cada chat. Se acota a los abiertos de los últimos
-- noventa días: un chat cerrado no espera respuesta, y uno de hace un año
-- tampoco, pero haría crecer el recorrido para siempre.
ultimos as (
  select distinct on (m.conversation_id) m.conversation_id, m.sender_type
  from public.messages m
  join chats v on v.id = m.conversation_id
  where v.status <> 'closed'
    and v.updated_at >= p_hasta - interval '90 days'
  order by m.conversation_id, m.created_at desc
),
-- Una oportunidad puede entrar y salir de "Ganado" varias veces; cuenta la
-- primera vez que llegó dentro del tramo, así no se suma dos veces sola.
ganadas as (
  select distinct on (e.opportunity_id) e.opportunity_id, o.value
  from public.opportunity_stage_events e
  join public.opportunities o on o.id = e.opportunity_id
  where e.workspace_id = p_workspace
    and e.kind = 'won'
    and e.created_at >= p_desde
    and e.created_at < p_hasta
  order by e.opportunity_id, e.created_at
),
ganadas_previas as (
  select distinct on (e.opportunity_id) e.opportunity_id, o.value
  from public.opportunity_stage_events e
  join public.opportunities o on o.id = e.opportunity_id
  where e.workspace_id = p_workspace
    and e.kind = 'won'
    and e.created_at >= p_previo_desde
    and e.created_at < p_previo_hasta
  order by e.opportunity_id, e.created_at
),
activos as (
  select id, created_at from public.contacts
  where workspace_id = p_workspace and archived_at is null
)
select
  (select count(*) from activos),
  (select count(*) from activos where created_at >= p_desde and created_at < p_hasta),
  (select count(*) from activos where created_at >= p_previo_desde and created_at < p_previo_hasta),
  (select coalesce(sum(unread_count), 0)::bigint from chats),
  (select count(*) from ultimos where sender_type = 'contact'),
  (select count(*) from chats where status = 'pending'),
  (select coalesce(sum(value), 0)::numeric from ganadas),
  (select count(*) from ganadas),
  (select coalesce(sum(value), 0)::numeric from ganadas_previas),
  (select coalesce(max(segundos), 0)::numeric from replicas_mes),
  (select coalesce(
     percentile_cont(0.5) within group (order by segundos::double precision), 0
   )::numeric from replicas_mes),
  (select count(*) from replicas_mes),
  (select coalesce(max(segundos), 0)::numeric from replicas_previas);
$$;

grant execute on function public.metricas_resumen(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
