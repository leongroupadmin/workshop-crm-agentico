-- Archivado de contactos (borrado suave).
--
-- `conversations.contact_id` y `appointments.contact_id` tienen ON DELETE
-- CASCADE: borrar un contacto de verdad destruiría sus chats y mensajes.
-- Para "ocultar sin eliminar", marcamos el contacto como archivado y la
-- aplicación filtra por `archived_at is null`. El historial queda intacto.

alter table public.contacts add column if not exists archived_at timestamptz;

-- Los listados siempre piden contactos activos ordenados por fecha.
create index if not exists contacts_workspace_active_idx
  on public.contacts (workspace_id, created_at desc)
  where archived_at is null;
