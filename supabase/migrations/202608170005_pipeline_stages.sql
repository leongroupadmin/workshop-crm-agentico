-- Las etapas del embudo dejan de ser un tipo de Postgres y pasan a ser datos.
--
-- Con el enum `opportunity_stage` no se podía agregar, renombrar ni borrar una
-- columna del embudo sin tocar el esquema. Esta migración las mueve a una
-- tabla por workspace, migra las oportunidades existentes y recién ahí elimina
-- el enum. Es idempotente sólo hasta el `drop column`: correrla dos veces es
-- inofensivo porque la segunda no encuentra la columna vieja.

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  position integer not null,
  -- `kind` es lo que hace que las métricas sigan funcionando después de que el
  -- usuario renombre las columnas: "Ganado" puede pasar a llamarse "Cerrado"
  -- sin que la tasa de conversión deje de contarlo.
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  created_at timestamptz not null default now()
);

create index if not exists pipeline_stages_workspace_position_idx
  on public.pipeline_stages (workspace_id, position);

alter table public.pipeline_stages enable row level security;

drop policy if exists "members manage pipeline stages" on public.pipeline_stages;
create policy "members manage pipeline stages" on public.pipeline_stages
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Siembra las seis etapas históricas en los workspaces que ya existen.
insert into public.pipeline_stages (workspace_id, name, position, kind)
select w.id, s.name, s.position, s.kind
from public.workspaces w
cross join (values
  ('Nuevo lead', 1, 'open'),
  ('Contactado', 2, 'open'),
  ('Visita coordinada', 3, 'open'),
  ('Propuesta', 4, 'open'),
  ('Ganado', 5, 'won'),
  ('Perdido', 6, 'lost')
) as s(name, position, kind)
where not exists (
  select 1 from public.pipeline_stages ps where ps.workspace_id = w.id
);

-- Todo workspace nuevo nace con el embudo por defecto. Va como trigger y no en
-- la app para que también lo hereden los que se crean desde SQL o desde el
-- webhook, sin depender de que alguien se acuerde de sembrarlos.
create or replace function public.seed_pipeline_stages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pipeline_stages (workspace_id, name, position, kind)
  values
    (new.id, 'Nuevo lead', 1, 'open'),
    (new.id, 'Contactado', 2, 'open'),
    (new.id, 'Visita coordinada', 3, 'open'),
    (new.id, 'Propuesta', 4, 'open'),
    (new.id, 'Ganado', 5, 'won'),
    (new.id, 'Perdido', 6, 'lost');
  return new;
end;
$$;

drop trigger if exists workspaces_seed_pipeline_stages on public.workspaces;
create trigger workspaces_seed_pipeline_stages
  after insert on public.workspaces
  for each row execute function public.seed_pipeline_stages();

-- `restrict` en lugar de `cascade`: borrar una etapa nunca debe borrar las
-- oportunidades que estaban adentro. La app las reubica antes de eliminarla.
alter table public.opportunities
  add column if not exists stage_id uuid references public.pipeline_stages(id) on delete restrict;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'opportunities' and column_name = 'stage'
  ) then
    update public.opportunities o
    set stage_id = ps.id
    from public.pipeline_stages ps
    where o.stage_id is null
      and ps.workspace_id = o.workspace_id
      and ps.position = case o.stage::text
        when 'new_lead' then 1
        when 'contacted' then 2
        when 'visit_scheduled' then 3
        when 'proposal' then 4
        when 'won' then 5
        when 'lost' then 6
      end;

    alter table public.opportunities drop column stage;
    drop type if exists public.opportunity_stage;
  end if;
end $$;

-- Red de seguridad: si quedó alguna oportunidad sin mapear (por ejemplo de un
-- workspace sin etapas), se la manda a la primera columna abierta antes de
-- exigir `not null`.
update public.opportunities o
set stage_id = (
  select ps.id from public.pipeline_stages ps
  where ps.workspace_id = o.workspace_id
  order by ps.position
  limit 1
)
where o.stage_id is null;

alter table public.opportunities alter column stage_id set not null;

create index if not exists opportunities_stage_idx on public.opportunities (stage_id);
