-- Varios embudos por workspace.
--
-- Hasta acá las etapas colgaban del workspace: un solo embudo, y para separar
-- dos procesos que no se parecen —vender y dar posventa, por ejemplo— había que
-- mezclar sus columnas en la misma fila y filtrar a ojo.
--
-- La tabla `pipelines` existe desde la migración inicial y quedó sin usar
-- cuando las etapas pasaron de enum a datos. Esto la pone a trabajar: cada
-- etapa pasa a ser de un embudo, y el embudo de una oportunidad se deduce de su
-- etapa, que es el único lugar donde estaba escrito.
--
-- Un lead vive en un embudo por vez. Es lo que ya asumía todo el código —"la
-- etapa del contacto", en singular— y es además lo que hace entendible el
-- reparto: pasar un lead de Ventas a Posventa es moverlo, no duplicarlo.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- `pipelines` viene de la migración inicial. Se la vuelve a declarar por si un
-- proyecto se armó a mano y se saltó esa parte: si ya está, no pasa nada.
create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Embudo principal',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.pipelines enable row level security;

drop policy if exists "members manage pipelines" on public.pipelines;
create policy "members manage pipelines" on public.pipelines
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- El orden de los embudos, y con él cuál es el de entrada.
--
-- Se elige por posición y no por una columna `es_principal` para no tener que
-- sostener a mano la regla de que haya exactamente uno. El primero es donde
-- caen los leads nuevos, igual que la primera columna dentro de cada embudo: es
-- la misma convención, y así hay una sola que recordar.
alter table public.pipelines
  add column if not exists position integer not null default 1;

-- Todo workspace tiene que tener al menos uno, porque las etapas van a colgar
-- de ahí.
insert into public.pipelines (workspace_id, name, position)
select w.id, 'Embudo principal', 1
from public.workspaces w
where not exists (
  select 1 from public.pipelines p where p.workspace_id = w.id
);

-- La columna nace con todas las filas en 1. Un workspace que ya tuviera dos
-- embudos quedaría con dos "primeros", así que se renumeran por antigüedad
-- antes de que alguien los ordene.
with ordenados as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as puesto
  from public.pipelines
)
update public.pipelines p
set position = ordenados.puesto
from ordenados
where ordenados.id = p.id
  and p.position is distinct from ordenados.puesto;

-- Sin `unique`, igual que las etapas: reordenar se hace fila por fila, y un
-- índice único abortaría a mitad de camino con dos filas pisando la misma
-- posición. El orden se desempata por `created_at`, que nunca repite.
create index if not exists pipelines_workspace_position_idx
  on public.pipelines (workspace_id, position);

/* --------------------------------------------------------- etapas por embudo */

alter table public.pipeline_stages
  add column if not exists pipeline_id uuid references public.pipelines(id) on delete cascade;

-- Las etapas que ya existían son todas del embudo que ya existía.
update public.pipeline_stages ps
set pipeline_id = (
  select p.id
  from public.pipelines p
  where p.workspace_id = ps.workspace_id
  order by p.position, p.created_at
  limit 1
)
where ps.pipeline_id is null;

alter table public.pipeline_stages
  alter column pipeline_id set not null;

-- La posición es dentro del embudo, no del workspace: dos embudos tienen los
-- dos su columna 1.
drop index if exists public.pipeline_stages_workspace_position_idx;
create index if not exists pipeline_stages_pipeline_position_idx
  on public.pipeline_stages (pipeline_id, position);

/* -------------------------------------------- el embudo de cada oportunidad */

-- `opportunities.pipeline_id` también viene de la migración inicial, y la
-- referencia era `on delete set null`: borrar un embudo dejaría tarjetas
-- apuntando a la nada. Pasa a `cascade`, que es lo que ya hace la etapa.
alter table public.opportunities
  add column if not exists pipeline_id uuid references public.pipelines(id) on delete cascade;

do $embudo_fk$
begin
  alter table public.opportunities drop constraint if exists opportunities_pipeline_id_fkey;
  alter table public.opportunities
    add constraint opportunities_pipeline_id_fkey
    foreign key (pipeline_id) references public.pipelines(id) on delete cascade;
end $embudo_fk$;

-- El embudo de una oportunidad no se escribe a mano en ningún lado: se deduce
-- de su etapa, que es el único lugar donde está la verdad. La columna existe
-- para poder filtrar sin un join, y el trigger es lo que garantiza que no se
-- desincronice —una tarjeta arrastrada a otro embudo se lleva su `pipeline_id`
-- sin que nadie se acuerde de actualizarlo—.
create or replace function public.sincronizar_embudo_de_oportunidad()
returns trigger language plpgsql security definer set search_path = public as $sincronizar$
begin
  select ps.pipeline_id into new.pipeline_id
  from public.pipeline_stages ps
  where ps.id = new.stage_id;
  return new;
end;
$sincronizar$;

drop trigger if exists opportunities_sincronizar_embudo on public.opportunities;
create trigger opportunities_sincronizar_embudo
  before insert or update of stage_id on public.opportunities
  for each row execute function public.sincronizar_embudo_de_oportunidad();

update public.opportunities o
set pipeline_id = ps.pipeline_id
from public.pipeline_stages ps
where ps.id = o.stage_id
  and o.pipeline_id is distinct from ps.pipeline_id;

create index if not exists opportunities_pipeline_idx
  on public.opportunities (pipeline_id);

/* ------------------------------------------------- el embudo de los nuevos */

-- Un workspace nuevo nace con su embudo y las seis etapas adentro. Va como
-- trigger y no en la app para que también lo hereden los workspaces que se
-- crean desde SQL o desde el webhook.
create or replace function public.seed_pipeline_stages()
returns trigger language plpgsql security definer set search_path = public as $seed$
declare
  embudo uuid;
begin
  insert into public.pipelines (workspace_id, name, position)
  values (new.id, 'Embudo principal', 1)
  returning id into embudo;

  insert into public.pipeline_stages (workspace_id, pipeline_id, name, position, kind)
  values
    (new.id, embudo, 'Nuevo lead', 1, 'open'),
    (new.id, embudo, 'Contactado', 2, 'open'),
    (new.id, embudo, 'Visita coordinada', 3, 'open'),
    (new.id, embudo, 'Propuesta', 4, 'open'),
    (new.id, embudo, 'Ganado', 5, 'won'),
    (new.id, embudo, 'Perdido', 6, 'lost');
  return new;
end;
$seed$;

/* ----------------------------------------------- permisos: una entrada por embudo */

-- `can_see_stage` eximía una sola columna: la primera del workspace. Era
-- correcto con un embudo y deja de serlo con dos, porque las dos primeras
-- comparten la posición 1 y el `limit 1` se queda con una sola —la que Postgres
-- devuelva—. Al operario con acceso restringido, los leads que entran al otro
-- embudo le desaparecían apenas caían.
--
-- Ahora se exime la primera columna de cada embudo, que es lo que la regla
-- quería decir desde el principio: donde caen los leads nuevos se ve siempre.
create or replace function public.can_see_stage(target_workspace uuid, target_stage uuid)
returns boolean language sql stable security definer set search_path = public as $ver_etapa$
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
    or target_stage in (
      select distinct on (ps.pipeline_id) ps.id
      from public.pipeline_stages ps
      where ps.workspace_id = target_workspace
      order by ps.pipeline_id, ps.position
    );
$ver_etapa$;

grant execute on function public.can_see_stage(uuid, uuid) to authenticated;

comment on column public.pipelines.position is
  'Orden de los embudos. El primero es donde entran los leads nuevos.';
comment on column public.pipeline_stages.pipeline_id is
  'De qué embudo es la columna. La posición se cuenta dentro del embudo.';
comment on column public.opportunities.pipeline_id is
  'Se deduce de la etapa y lo mantiene un trigger. No se escribe a mano.';
