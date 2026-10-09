-- Reintentar un envío que no salió.
--
-- Hasta acá una corrida que fallaba se cerraba en el primer intento y se
-- perdía. El modo de fallar más común de un recordatorio no es un error de
-- configuración sino un rato de nada —WhatsApp Web desconectado, el celular
-- sin señal, la API reiniciándose—, y el aviso se perdía sin que nadie se
-- entere hasta que el cliente no lo recibió.
--
-- Esta columna cuenta los intentos para poder espaciarlos y, después de unos
-- cuantos, dejar de insistir. Ver `ESPERAS_DEL_REINTENTO_MINUTOS`.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.automation_runs
  add column if not exists intentos integer not null default 0;

comment on column public.automation_runs.intentos is
  'Cuántas veces se intentó enviar y falló. Espacia los reintentos y los corta.';
