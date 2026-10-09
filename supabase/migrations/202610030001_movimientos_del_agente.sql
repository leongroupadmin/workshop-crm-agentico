-- El agente mueve la tarjeta de columna, con el criterio escrito por el usuario.
--
-- Hasta acá mover de etapa era de las automatizaciones (el paso `mover`) y de
-- la mano que arrastra la tarjeta. Las dos son reglas duras: entró en esta
-- columna, pasaron tantas horas. Lo que ninguna puede es leer la conversación y
-- decidir, que es justo lo que el agente ya está haciendo para contestar.
--
-- La regla no se escribe en código porque el criterio es del negocio, no del
-- CRM: "cuando ya dijo su rubro y cuántos vendedores tiene" sólo lo sabe quien
-- vende. Por eso el criterio es texto libre y viaja al modelo tal cual.
--
-- Nace vacía: crear la tabla no mueve ninguna tarjeta. El agente recién empieza
-- a mover cuando alguien carga la primera regla desde el panel y la guarda.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- Tabla y no un arreglo en `tools_config`, por lo mismo que `ai_agent_pipelines`:
-- con la clave foránea, borrar una columna del embudo se lleva la regla que la
-- apuntaba. Con un arreglo quedaría un id muerto y el agente intentando mover a
-- una etapa que ya no existe, que es la clase de error que no se ve hasta que
-- alguien revisa por qué una tarjeta nunca se movió.
create table if not exists public.ai_agent_stage_moves (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  config_id uuid not null references public.ai_agent_configs(id) on delete cascade,

  -- A qué columna mueve.
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,

  -- Desde cuál. Null es "desde cualquiera".
  --
  -- Es la columna que evita que una regla se cumpla para siempre. "Ya dijo su
  -- rubro" sigue siendo verdad tres días después: sin el desde, la regla que
  -- lleva a Calificado seguiría pidiendo volver a Calificado cuando el lead ya
  -- está en Visita coordinada, y la tarjeta quedaría yendo y viniendo.
  desde_stage_id uuid references public.pipeline_stages(id) on delete cascade,

  -- El criterio, en castellano, como lo escribió quien configura.
  --
  -- El tope de 300 no lo pide Postgres: el criterio viaja al modelo en cada
  -- clasificación, y uno de tres renglones no decide mejor que uno de uno. El
  -- piso de 3 es para que no se guarde un criterio vacío de hecho, que el modelo
  -- leería como "moveme siempre".
  criterio text not null check (length(trim(criterio)) between 3 and 300),

  activo boolean not null default true,
  created_at timestamptz not null default now(),

  -- Una sola regla por par (desde, hacia) en cada agente. `nulls not distinct`
  -- porque sin eso dos reglas "desde cualquiera" hacia la misma columna no
  -- chocarían —en Postgres dos nulls son distintos— y el modelo recibiría dos
  -- criterios contradictorios para el mismo movimiento.
  unique nulls not distinct (config_id, stage_id, desde_stage_id)
);

create index if not exists ai_agent_stage_moves_workspace_idx
  on public.ai_agent_stage_moves (workspace_id);

create index if not exists ai_agent_stage_moves_config_idx
  on public.ai_agent_stage_moves (config_id);

comment on table public.ai_agent_stage_moves is
  'Reglas con las que el agente mueve de columna. Sin filas, no mueve nada.';
comment on column public.ai_agent_stage_moves.desde_stage_id is
  'Etapa desde la que aplica la regla. Null: desde cualquiera.';
comment on column public.ai_agent_stage_moves.criterio is
  'Cuándo mover, en castellano. Viaja al modelo tal cual.';

-- Las tres cosas que una regla no puede ser, y por qué van en la base.
--
-- Un check normal no alcanza: las tres miran otra tabla. Y la UI no alcanza
-- tampoco, porque el caso que importa aparece después de guardar: alguien
-- renombra "Propuesta" a "Cerrado" y le pone kind 'won'. Sin esto, una regla
-- que era legítima se convierte sola en un cierre de venta automático. Con
-- esto, el día que se intente escribir eso falla y hay que decidirlo a mano.
-- `search_path = ''` igual que el resto de las funciones del esquema: obliga a
-- escribir `public.` en todo y así un esquema puesto adelante por quien llama no
-- puede hacer que la validación lea otra tabla.
create or replace function public.ai_agent_stage_move_valida()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  destino record;
  origen record;
begin
  select workspace_id, kind, pipeline_id into destino
  from public.pipeline_stages where id = new.stage_id;

  if not found or destino.workspace_id <> new.workspace_id then
    raise exception 'La etapa de destino no pertenece a este workspace.';
  end if;

  -- Ganado y Perdido quedan afuera. De ahí cuelgan las métricas y la conversión
  -- de Meta: un cierre que el agente inventó ensucia los dos, y no se arregla
  -- moviendo la tarjeta para atrás.
  if destino.kind <> 'open' then
    raise exception 'El agente no puede mover a una etapa de tipo %. Sólo a columnas abiertas.', destino.kind;
  end if;

  if new.desde_stage_id is not null then
    if new.desde_stage_id = new.stage_id then
      raise exception 'La etapa de origen y la de destino no pueden ser la misma.';
    end if;

    select workspace_id, pipeline_id into origen
    from public.pipeline_stages where id = new.desde_stage_id;

    if not found or origen.workspace_id <> new.workspace_id then
      raise exception 'La etapa de origen no pertenece a este workspace.';
    end if;

    -- Mover entre embudos distintos no es mover: es sacar la tarjeta de un
    -- tablero y ponerla en otro, con otras métricas y otro equipo mirándola.
    if origen.pipeline_id <> destino.pipeline_id then
      raise exception 'Las dos etapas tienen que ser del mismo embudo.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ai_agent_stage_moves_valida on public.ai_agent_stage_moves;
create trigger ai_agent_stage_moves_valida
  before insert or update on public.ai_agent_stage_moves
  for each row execute function public.ai_agent_stage_move_valida();

alter table public.ai_agent_stage_moves enable row level security;

-- Leer, cualquier miembro: el motivo de cada movimiento aparece en el chat y
-- quien atiende tiene que poder ver qué regla lo explica.
drop policy if exists "members read agent stage moves" on public.ai_agent_stage_moves;
create policy "members read agent stage moves" on public.ai_agent_stage_moves
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Escribir queda para quien puede tocar los agentes, igual que el resto de su
-- configuración: es la misma decisión repartida en tres tablas.
drop policy if exists "agent managers write agent stage moves" on public.ai_agent_stage_moves;
create policy "agent managers write agent stage moves" on public.ai_agent_stage_moves
  for all to authenticated
  using (public.has_permission(workspace_id, 'gestionar_agentes'))
  with check (public.has_permission(workspace_id, 'gestionar_agentes'));
