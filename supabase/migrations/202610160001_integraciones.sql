-- Las credenciales de los proveedores (OpenAI, YCloud y Zernio), cargadas desde
-- Configuración → Conexiones en vez de las variables de entorno de Vercel.
--
-- `config` guarda lo que no es secreto y se puede mostrar (la URL base, el
-- número propio). `secretos` es un JSON cifrado con AES-256-GCM en el servidor,
-- con una clave que vive en el entorno (INTEGRATIONS_ENCRYPTION_KEY): la base
-- nunca ve una API key en claro, así que un volcado de la base no alcanza para
-- usarlas.
--
-- Una fila por proveedor: cada instalación tiene un solo workspace.
--
-- Sin políticas a propósito: sólo la service role lee y escribe. El panel pasa
-- por Server Actions que nunca devuelven el secreto, sólo si está cargado.
create table if not exists public.integraciones (
  provider text primary key
    check (provider in ('openai', 'ycloud', 'zernio')),
  config jsonb not null default '{}'::jsonb,
  secretos text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.integraciones enable row level security;

drop trigger if exists integraciones_touch_updated_at on public.integraciones;
create trigger integraciones_touch_updated_at
  before update on public.integraciones
  for each row execute function public.touch_updated_at();
