-- Que los mensajes nuevos aparezcan sin recargar la página.
--
-- Realtime manda por el socket lo que sale del WAL de Postgres, y con RLS
-- prendido tiene que decidir, fila por fila, si ese usuario podía leerla. Para
-- decidirlo necesita la fila entera. Por defecto Postgres sólo publica la clave
-- primaria en los UPDATE y los DELETE (`replica identity default`), así que a
-- Realtime le llega un id pelado, no puede evaluar la política y descarta el
-- evento en silencio: la pantalla se queda quieta y no hay error en ningún lado.
--
-- `replica identity full` publica la fila completa y arregla eso. Cuesta un
-- poco más de WAL por escritura, que en tablas de esta escala no se nota.
--
-- Los UPDATE importan acá y no son un detalle: cuando entra un audio o una foto
-- el mensaje se guarda primero con un marcador y unos segundos después el
-- webhook lo reemplaza por la transcripción. Ese reemplazo es un UPDATE.

alter table public.messages replica identity full;
alter table public.conversations replica identity full;

-- La publicación se creó en la migración inicial, pero conviene reafirmarla:
-- restaurar la base desde un backup o recrear la tabla la deja afuera, y el
-- síntoma es exactamente el mismo — todo funciona salvo el vivo.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
