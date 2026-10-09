-- El enlace de una cita deja de ser sólo el de Calendar.
--
-- `calendar_link` nació para guardar el `hangoutLink` o el `htmlLink` que baja
-- por el webhook, y es lo que sale en el hueco `{link}` de los recordatorios.
-- Una cita cargada a mano en el CRM no baja de ningún lado: hasta acá ese hueco
-- salía sin dato en todos los recordatorios de las citas que carga el equipo,
-- que son las que más lo necesitan —el Meet o el Zoom lo arma el vendedor—.
--
-- No hace falta columna nueva: es el mismo dato con dos orígenes, y partirlo en
-- dos obligaría a todo lector a preguntarse cuál mira. Lo único que cambia es
-- quién lo escribe, y eso ya lo dice `origen`.
--
-- Idempotente: se puede correr dos veces sin romper nada.

comment on column public.appointments.calendar_link is
  'Enlace de la cita: el de Calendar cuando baja del webhook, o el que se carga a mano en el CRM. Es el que sale en el hueco {link} de los recordatorios.';
