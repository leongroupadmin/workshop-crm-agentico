-- El horario del agente puede decir "contesta acá" o "no contesta acá".
--
-- Las franjas nacieron como lista blanca: el agente contesta adentro y calla
-- afuera. Sirve para el negocio que atiende de 9 a 18, pero un agente de IA casi
-- siempre arranca al revés —contesta siempre— y lo que se quiere declarar es la
-- excepción: "menos de 13 a 16", "menos los domingos".
--
-- Con una sola lectura, esa excepción obliga a cargar el complemento: para no
-- contestar de 13 a 16 había que escribir dos franjas, de 00 a 13 y de 16 a 24.
-- Es la forma más fácil de equivocarse —un minuto de más en el borde y el agente
-- queda hablando justo cuando no tiene que hablar— y encima no se lee: nadie
-- reconoce "de 00:00 a 13:00 y de 16:00 a 24:00" como "cerramos al mediodía".
--
-- El interruptor son las mismas franjas leídas al revés, así que no agrega
-- ningún campo para cargar: lo que cambia es si lo marcado es cuándo contesta o
-- cuándo no.
--
-- Arranca en false, que es la lista blanca de siempre: correr esto no cambia el
-- comportamiento de ningún workspace.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.ai_agent_configs
  add column if not exists horario_excluye boolean not null default false;

comment on column public.ai_agent_configs.horario_excluye is
  'false: las franjas son cuándo contesta. true: son cuándo NO contesta y el resto del tiempo sí.';
