-- El horario del agente pasa a ser una lista de franjas.
--
-- Nació como un solo par de horas, y eso no alcanza para el horario cortado:
-- un negocio que atiende de 9 a 13 y de 16 a 20 tenía que cargar 9 a 20, y el
-- agente contestaba en la siesta —cuando no hay nadie para seguir la charla que
-- él arranca, que es justo el problema que el horario venía a resolver—. La otra
-- salida era dejarlo todo el día, que es todavía peor.
--
-- Lista y no un segundo par de columnas porque "dos" es tan arbitrario como
-- "una": el que atiende corrido necesita una, el que corta al mediodía dos, y
-- con la lista los dos casos son el mismo código. El tope de tres lo pone la
-- app, no la base: alcanza para mañana, tarde y una guardia suelta.
--
-- jsonb y no una tabla aparte por lo mismo que `automations.pasos`: son dos o
-- tres pares de números que siempre se leen juntos con la config, nunca por
-- separado, y una tabla con su RLS para eso es una junta más en cada mensaje que
-- entra. La forma de cada franja la valida la app (`errorDeHorario`), igual que
-- la de los pasos.
--
-- Lo que ya estaba cargado se conserva: el par de horas se convierte en la
-- primera franja. Un horario de día completo no deja franja ninguna, porque la
-- lista vacía es exactamente eso: contestar a toda hora.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.ai_agent_configs
  add column if not exists franjas jsonb not null default '[]'::jsonb;

-- La conversión corre sólo si las columnas viejas todavía están, así que esto
-- sirve igual en una base recién creada y en una que venía con horario cargado.
-- El `franjas = '[]'` del final es lo que lo hace repetible: una vez convertido,
-- una segunda corrida no pisa lo que se haya configurado después.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_agent_configs'
      and column_name = 'hora_desde'
  ) then
    update public.ai_agent_configs
    set franjas = jsonb_build_array(jsonb_build_object('desde', hora_desde, 'hasta', hora_hasta))
    where hora_desde < hora_hasta
      and not (hora_desde <= 0 and hora_hasta >= 1440)
      and franjas = '[]'::jsonb;
  end if;
end $$;

alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_hora_desde_check,
  drop constraint if exists ai_agent_configs_hora_hasta_check;

alter table public.ai_agent_configs
  drop column if exists hora_desde,
  drop column if exists hora_hasta;

alter table public.ai_agent_configs
  drop constraint if exists ai_agent_configs_franjas_check;

-- El check cuida la forma gruesa —que sea una lista y que no crezca sin fin
-- desde el navegador— y no el contenido de cada franja. Lo fino lo valida la
-- app, que es la que puede explicar en una frase por qué una franja que cruza
-- la medianoche no se guarda.
alter table public.ai_agent_configs
  add constraint ai_agent_configs_franjas_check check (
    jsonb_typeof(franjas) = 'array' and jsonb_array_length(franjas) <= 3
  );

comment on column public.ai_agent_configs.franjas is
  'Franjas en que el agente contesta, [{"desde":540,"hasta":780},...] en minutos desde la medianoche. Vacío es todo el día.';
