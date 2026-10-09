-- Queda una sola herramienta del agente: derivar a una persona.
--
-- `catalog_search` y `schedule_appointment` se dibujaban en el panel y se
-- guardaban acá, pero ningún pedido a OpenAI las miraba: eran interruptores que
-- no apagaban nada. La derivación sí hace algo — frena la IA para ese contacto
-- y deja el chat pendiente — así que es la única que sobrevive.
--
-- Esto es sólo limpieza. La app ya descarta las claves muertas al leer, así que
-- correrla o no correrla no cambia cómo se comporta el agente.

alter table public.ai_agent_configs
  alter column tools_config set default '{"handoff_to_human": true}'::jsonb;

update public.ai_agent_configs
set tools_config = jsonb_build_object(
  'handoff_to_human',
  coalesce((tools_config ->> 'handoff_to_human')::boolean, true)
)
where tools_config ? 'catalog_search'
   or tools_config ? 'schedule_appointment'
   or not (tools_config ? 'handoff_to_human');
