-- El fin de la franja de envío es exclusivo: `dentroDeLaFranja` pide
-- `ahora >= hora_desde and ahora < hora_hasta`. Un día completo es entonces
-- [0, 1440), y 1440 es un valor legítimo, no un desborde.
--
-- El tope de 1439 dejaba sin guardar a todos los recordatorios de cita, que van
-- siempre sin franja —un aviso de una cita sale cuando toca, no en horario
-- comercial— y por eso escriben 0 y 1440. Guardar fallaba con
-- `automations_hora_hasta_check` y no se podía prender ni uno.
--
-- `hora_desde` mantiene el tope de 1439 a propósito: empezar en 1440 sería una
-- franja vacía, que no significa nada.
alter table public.automations
  drop constraint if exists automations_hora_hasta_check;

alter table public.automations
  add constraint automations_hora_hasta_check check (hora_hasta between 0 and 1440);
