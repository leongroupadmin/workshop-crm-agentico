-- Dos límites para el agente: en qué embudos contesta y cuándo se corre.
--
-- El primero llega con los embudos múltiples: el agente que califica leads de
-- Ventas no tiene nada que decirle a alguien que está en Posventa, y hasta acá
-- el único recorte posible era el canal.
--
-- El segundo es más viejo y más molesto. Cuando un vendedor entra a una
-- conversación, el agente le seguía escribiendo encima: el lead recibía dos
-- voces, a veces contradiciéndose. Frenarlo existía —el interruptor "IA activa"
-- de la ficha— pero había que acordarse de tocarlo antes de escribir, que es
-- exactamente cuando nadie se acuerda.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- Tabla y no un arreglo de ids en `ai_agent_configs`, por lo mismo que
-- `member_stage_access`: con la clave foránea, borrar un embudo limpia sola la
-- restricción que lo apuntaba. Con un arreglo quedaría un id muerto, y un
-- agente restringido a un embudo que ya no existe se queda mudo sin que nada lo
-- explique.
--
-- Sin filas, el agente contesta en todos los embudos. Es la misma convención
-- que los permisos por columna: no elegir es no restringir.
create table if not exists public.ai_agent_pipelines (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  config_id uuid not null references public.ai_agent_configs(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  primary key (config_id, pipeline_id)
);

create index if not exists ai_agent_pipelines_workspace_idx
  on public.ai_agent_pipelines (workspace_id);

alter table public.ai_agent_pipelines enable row level security;

drop policy if exists "members read agent pipelines" on public.ai_agent_pipelines;
create policy "members read agent pipelines" on public.ai_agent_pipelines
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Escribir queda para quien puede tocar los agentes, igual que la config: es la
-- misma decisión partida en dos tablas.
drop policy if exists "agent managers write agent pipelines" on public.ai_agent_pipelines;
create policy "agent managers write agent pipelines" on public.ai_agent_pipelines
  for all to authenticated
  using (public.has_permission(workspace_id, 'gestionar_agentes'))
  with check (public.has_permission(workspace_id, 'gestionar_agentes'));

-- Nace apagado: correr esto no cambia el comportamiento de ningún workspace.
-- Que el agente se calle solo es lo que se quiere casi siempre, pero decidirlo
-- por el usuario le cambiaría la atención de un día para el otro sin aviso.
alter table public.ai_agent_configs
  add column if not exists pause_on_human_reply boolean not null default false;

comment on table public.ai_agent_pipelines is
  'En qué embudos contesta cada agente. Sin filas, contesta en todos.';
comment on column public.ai_agent_configs.pause_on_human_reply is
  'Si al escribir una persona en el chat se apaga la IA de ese contacto.';
