-- La demora del agente pasa a ser un solo número.
--
-- La migración anterior la dejó como un rango, mínimo y máximo, porque la
-- espera vieja era proporcional al largo de la respuesta y necesitaba dos
-- topes. Pedirle eso a quien configura el agente es pedirle que entienda la
-- fórmula: lo que quiere contestar es "¿cuánto tarda?", y eso es un número.
--
-- El mínimo y el máximo no desaparecen, cambian de lugar: dejan de ser dos
-- campos para cargar y pasan a ser los límites de lo que se puede cargar, 2 y
-- 60 segundos, que el panel muestra al lado del campo.
--
-- Las filas que ya tengan un rango se quedan con su máximo, que es lo que esos
-- workspaces venían esperando en las respuestas largas.

alter table public.ai_agent_configs
  add column if not exists reply_delay_seconds smallint not null default 5;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_agent_configs'
      and column_name = 'reply_delay_max_seconds'
  ) then
    update public.ai_agent_configs
    set reply_delay_seconds = greatest(2, least(60, reply_delay_max_seconds));
  end if;
end $$;

alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_reply_delay_range;

alter table public.ai_agent_configs
  drop column if exists reply_delay_min_seconds,
  drop column if exists reply_delay_max_seconds;

-- El piso no es 0 a propósito: esa espera es la ventana en la que se agrupan
-- los mensajes sueltos de una ráfaga. Sin espera no hay nada que agrupar.
alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_reply_delay;

alter table public.ai_agent_configs
  add constraint ai_agent_configs_reply_delay
  check (reply_delay_seconds between 2 and 60);
