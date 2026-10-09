-- Interruptor general por agente.
--
-- `contacts.bot_enabled` ya permitía frenar la IA en un lead puntual, pero no
-- había forma de apagar un canal entero sin vaciar sus instrucciones. Este
-- interruptor manda sobre el del lead: apagado el canal, la IA no habla con
-- nadie.
--
-- Arranca en `true` para no cambiar el comportamiento de lo que ya estaba
-- configurado: quien tenía instrucciones cargadas sigue respondiendo igual.
alter table public.ai_agent_configs
  add column if not exists enabled boolean not null default true;
