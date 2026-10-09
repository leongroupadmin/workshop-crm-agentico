-- El aviso que sale cuando el agente está fuera de horario.
--
-- Con el horario solo, el lead que escribe a las 3 AM no recibe nada. Para el
-- equipo eso es correcto —el mensaje queda en la bandeja y se atiende al abrir—
-- pero del otro lado el silencio no se distingue de un número que no existe, y
-- quien no sabe si lo leyeron escribe de nuevo, o se va a la competencia.
--
-- Es un texto fijo y no una respuesta del modelo a propósito. Fuera de horario
-- lo único honesto que se puede decir es cuándo se atiende: un modelo pensando
-- a esa hora vuelve a lo de antes —coordina reuniones y promete respuestas de
-- gente que no está— con el agravante de que ahora nadie va a leer ese chat
-- hasta la mañana. Y cuesta tokens para decir una sola frase.
--
-- Nace vacío, que es apagado: quien no lo cargue sigue con el silencio de
-- antes. Así correr esto no cambia el comportamiento de ningún workspace.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.ai_agent_configs
  add column if not exists aviso_fuera_de_horario text not null default '';

alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_aviso_check;

-- El tope es de cortesía, no de la base: lo que sale fuera de horario es una o
-- dos frases diciendo cuándo se atiende. Un texto más largo que eso es un
-- discurso que nadie escribió para leer a las 3 AM, y lo que necesita es el
-- agente, que a esa hora justamente no está contestando.
alter table public.ai_agent_configs
  add constraint ai_agent_configs_aviso_check
  check (char_length(aviso_fuera_de_horario) <= 300);

comment on column public.ai_agent_configs.aviso_fuera_de_horario is
  'Texto que se manda cuando llega un mensaje fuera del horario del agente. Vacío es no mandar nada.';
