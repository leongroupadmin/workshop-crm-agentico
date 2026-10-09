-- El horario en el que contesta cada agente.
--
-- Hasta acá el agente era de dos estados: prendido —y entonces contestaba a
-- cualquier hora de cualquier día— o apagado. Para un equipo que atiende de 9 a
-- 18 eso deja dos agujeros. El de la madrugada es el que se ve: el lead que
-- escribe a las 3 AM recibe una respuesta redactada al instante, y si en esa
-- charla el agente quedó en que "un asesor te escribe en un rato", el asesor
-- aparece seis horas después. El otro es el que molesta de verdad: el agente
-- coordina reuniones y promete respuestas de gente que no está, así que a la
-- mañana alguien tiene que salir a desdecirlo.
--
-- Fuera del horario el agente no contesta: el mensaje queda en la bandeja y lo
-- atiende una persona cuando abre. No se guarda para contestarlo más tarde a
-- propósito, porque la respuesta sale en el `after()` del webhook y ahí no hay
-- dónde esperar ocho horas (ver `MAX_REPLY_DELAY_SECONDS`).
--
-- Son las mismas tres piezas que ya deciden los turnos del reparto y la franja
-- de envío de las automatizaciones —días, hora de apertura, hora de cierre, en
-- la zona del workspace— y por eso se escriben igual: minutos desde la
-- medianoche y 0 = domingo. Una pieza más con otra convención sería una tercera
-- forma de escribir lo mismo.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.ai_agent_configs
  -- Días en que contesta, 0 = domingo, igual que `Date.getDay()`.
  --
  -- Nace con los siete puestos: correr esto no cambia el comportamiento de
  -- ningún workspace, que es lo que tiene que pasar con una migración que
  -- agrega un recorte que todavía nadie configuró.
  add column if not exists dias smallint[] not null default '{0,1,2,3,4,5,6}',
  -- Minutos desde la medianoche. [0, 1440) es el día completo, y es el default:
  -- el fin es exclusivo, igual que en la franja de las automatizaciones.
  add column if not exists hora_desde smallint not null default 0,
  add column if not exists hora_hasta smallint not null default 1440;

alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_hora_desde_check,
  drop constraint if exists ai_agent_configs_hora_hasta_check,
  drop constraint if exists ai_agent_configs_dias_check;

-- `hora_desde` no llega a 1440 porque empezar a la medianoche siguiente sería
-- una franja vacía, que no significa nada. `hora_hasta` sí: es el cierre
-- exclusivo del día completo.
alter table public.ai_agent_configs
  add constraint ai_agent_configs_hora_desde_check check (hora_desde between 0 and 1439),
  add constraint ai_agent_configs_hora_hasta_check check (hora_hasta between 0 and 1440),
  -- Un día que no es un día de la semana dejaría al agente callado un día
  -- entero sin que nada lo explique. El arreglo vacío sí se permite: se lee
  -- como "todos los días", la misma convención que `ai_agent_pipelines` —no
  -- elegir es no restringir— y la lectura segura para un recorte que, mal
  -- interpretado, enmudece al agente sin aviso.
  add constraint ai_agent_configs_dias_check check (
    dias <@ '{0,1,2,3,4,5,6}'::smallint[] and array_position(dias, null) is null
  );

comment on column public.ai_agent_configs.dias is
  'Días en que el agente contesta, 0 = domingo. Vacío es todos.';
comment on column public.ai_agent_configs.hora_desde is
  'Minutos desde la medianoche en que abre, en la zona del workspace.';
comment on column public.ai_agent_configs.hora_hasta is
  'Minutos desde la medianoche en que cierra, exclusivo. Invertido o igual a hora_desde es todo el día.';
