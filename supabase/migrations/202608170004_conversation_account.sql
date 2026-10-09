-- Cuenta de Zernio por la que entró cada conversación.
--
-- Para responder hay que decirle a Zernio con qué cuenta mandar el mensaje: la
-- API exige `accountId` en el cuerpo. Un workspace puede tener varias cuentas
-- (WhatsApp, Instagram, Messenger, o dos números distintos), así que deducirlo
-- del canal no alcanza: se guarda el que vino en el webhook.

alter table public.conversations
  add column if not exists zernio_account_id text;
