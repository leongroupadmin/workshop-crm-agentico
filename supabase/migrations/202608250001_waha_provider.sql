-- WAHA se suma como proveedor de WhatsApp sin reemplazar YCloud.
alter table public.conversations
  drop constraint if exists conversations_provider_check;

alter table public.conversations
  add constraint conversations_provider_check
  check (provider in ('zernio', 'ycloud', 'waha'));

comment on column public.conversations.zernio_chat_id is
  'Id de la conversación en el proveedor. YCloud usa E.164; WAHA usa el JID de WhatsApp.';
comment on column public.conversations.zernio_account_id is
  'Cuenta del proveedor. YCloud usa el número propio; WAHA usa waha:<sesión>.';
