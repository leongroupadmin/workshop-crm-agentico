-- Proveedor de mensajería por el que entró cada conversación.
--
-- Hasta acá todo llegaba por Zernio y responder era llamar directo a su API.
-- Al sumar un segundo proveedor hay que saber por dónde contestar cada charla,
-- y el canal no alcanza: WhatsApp puede entrar por cualquiera de los dos.
--
-- Es `text` con check y no un enum a propósito: sumar un proveedor más adelante
-- es cambiar la restricción, no alterar un tipo del que cuelgan columnas.
--
-- El default cubre lo que ya existe sin backfill: toda conversación anterior a
-- esta migración es de Zernio por definición.
alter table public.conversations
  add column if not exists provider text not null default 'zernio';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_provider_check'
  ) then
    alter table public.conversations
      add constraint conversations_provider_check
      check (provider in ('zernio', 'ycloud'));
  end if;
end $$;

-- `zernio_chat_id` y `zernio_account_id` quedaron con ese nombre por historia,
-- pero ya no son de Zernio: son las coordenadas del proveedor que sea. Para
-- Zernio, el id de conversación y el de cuenta social. Para YCloud, el teléfono
-- del contacto en E.164 y el número propio desde el que se envía.
comment on column public.conversations.zernio_chat_id is
  'Id de la conversación en el proveedor. En YCloud, el teléfono del contacto en E.164.';
comment on column public.conversations.zernio_account_id is
  'Cuenta del proveedor por la que entró. En YCloud, el número propio que recibe.';
