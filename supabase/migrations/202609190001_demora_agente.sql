-- Cuánto tarda el agente en contestar, configurable por canal.
--
-- La demora estaba fija en el código: entre 3 y 9 segundos, proporcional al
-- largo de la respuesta. Dos motivos para sacarla de ahí. El primero es de
-- tono: un negocio que atiende consultas largas quiere parecer que las está
-- leyendo, y tres segundos para cuatro renglones delata al bot igual que
-- responder al instante.
--
-- El segundo es el que importa de verdad. Esa espera no es sólo cosmética: es
-- la ventana en la que se juntan los mensajes sueltos de una ráfaga —"hola",
-- "una consulta", "por el precio"— para contestarlos de una sola vez. Quien
-- estira la demora está estirando la ventana; quien la acorta, la acorta. Por
-- eso el piso es 2 segundos y no 0: sin espera no hay nada que agrupar y el
-- lead se come una respuesta por mensaje.
--
-- Los valores por defecto son exactamente los que estaban fijos, así que
-- correr esto no cambia el comportamiento de ningún workspace.

alter table public.ai_agent_configs
  add column if not exists reply_delay_min_seconds smallint not null default 3,
  add column if not exists reply_delay_max_seconds smallint not null default 9;

-- El rango se valida también en la app, pero el check es lo que impide que una
-- carga a mano en el panel de Supabase deje al agente esperando media hora.
alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_reply_delay_range;

alter table public.ai_agent_configs
  add constraint ai_agent_configs_reply_delay_range
  check (
    reply_delay_min_seconds >= 2
    and reply_delay_max_seconds <= 60
    and reply_delay_max_seconds >= reply_delay_min_seconds
  );
