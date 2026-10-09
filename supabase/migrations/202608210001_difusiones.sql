-- Difusiones: una plantilla de WhatsApp a muchos contactos de una vez.
--
-- Son dos tablas por la misma razón que las automatizaciones: la difusión es lo
-- que se decidió mandar —plantilla, valores, quién la armó— y casi no cambia; el
-- destinatario es cada intento de entrega, que cambia todo el tiempo y es lo
-- único que mira el reloj.
--
-- El envío no pasa por acá adentro. Escribirle a trescientas personas no entra
-- en el tiempo de una request y, si se cortara a la mitad, nadie sabría por
-- dónde iba. En vez de eso la difusión deja las filas en 'pendiente' y el mismo
-- cron de las automatizaciones las va despachando: cada fila sabe cómo terminó
-- y una vuelta que se corta no repite nada.
--
-- Idempotente: se puede correr dos veces sin romper nada.

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- La plantilla se guarda por nombre e idioma y no por su contenido: el texto
  -- aprobado vive en Meta y puede cambiar. Lo que se le mandó a cada persona
  -- queda escrito en `messages`, que es donde se lo busca después.
  template_name text not null,
  template_language text not null,
  -- Los huecos de la plantilla ya completados. Pueden traer {nombre}, {telefono},
  -- {email} y {etapa}: se reemplazan por contacto al momento de enviar.
  valores jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists broadcasts_workspace_idx
  on public.broadcasts (workspace_id, created_at desc);

create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- El teléfono se copia acá, ya normalizado a E.164. Si mañana alguien lo
  -- corrige en la ficha, el registro sigue diciendo a qué número salió.
  phone text not null,
  -- 'enviando' existe para que dos vueltas del cron no manden lo mismo dos
  -- veces: quien va a despachar se queda con la fila antes de llamar a la API.
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'fallado')),
  detalle text,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Cuándo se la reservó para mandar. Es lo que permite rescatar una fila que
  -- quedó en 'enviando' porque la vuelta se cayó a la mitad: sin esto, un
  -- destinatario se quedaba en el limbo para siempre.
  claimed_at timestamptz,
  sent_at timestamptz,
  -- Nadie recibe dos veces la misma difusión, ni siquiera si se reintenta.
  unique (broadcast_id, contact_id)
);

-- Lo único que consulta el cron.
create index if not exists broadcast_recipients_pendientes_idx
  on public.broadcast_recipients (created_at)
  where estado = 'pendiente';

create index if not exists broadcast_recipients_difusion_idx
  on public.broadcast_recipients (broadcast_id);

-- Para encontrar las que quedaron trabadas sin recorrer la tabla entera.
create index if not exists broadcast_recipients_trabadas_idx
  on public.broadcast_recipients (claimed_at)
  where estado = 'enviando';

-- ---------------------------------------------------------------------------
-- Avance de cada difusión
--
-- Contar del lado de la aplicación obligaría a traerse todos los destinatarios
-- para mostrar "120 de 300", y a un contador guardado en la fila lo pisan dos
-- vueltas del cron que corren juntas. La vista cuenta en el momento y no puede
-- desincronizarse.
--
-- `security_invoker` la hace respetar las políticas de quien consulta: sin eso
-- la vista mostraría el avance de cualquier workspace.
-- ---------------------------------------------------------------------------
create or replace view public.broadcast_progress
with (security_invoker = on) as
select
  b.id as broadcast_id,
  b.workspace_id,
  count(r.id) as total,
  count(r.id) filter (where r.estado = 'enviado') as enviados,
  count(r.id) filter (where r.estado = 'fallado') as fallados,
  count(r.id) filter (where r.estado in ('pendiente', 'enviando')) as pendientes
from public.broadcasts b
left join public.broadcast_recipients r on r.broadcast_id = b.id
group by b.id, b.workspace_id;

-- Las vistas nuevas heredan los permisos por omisión del proyecto, pero
-- dejarlo escrito evita el "no existe la relación" que aparece cuando ese
-- default no está puesto: el síntoma es un historial sin avance, no un error.
grant select on public.broadcast_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- `mandar_difusiones` es un permiso nuevo, asignable desde la pantalla de
-- Usuarios. No hace falta migrar nada para crearlo: los permisos viven en el
-- jsonb de `workspace_members` y `has_permission()` ya sabe leer cualquier
-- clave, dándosela siempre al administrador.
--
-- Leer también se pide con el permiso: el historial dice a qué números se les
-- escribió, y quien no puede mandar tampoco tiene por qué tener esa lista.
-- ---------------------------------------------------------------------------

alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

drop policy if exists "difusiones" on public.broadcasts;
create policy "difusiones" on public.broadcasts
  for all to authenticated
  using (public.has_permission(workspace_id, 'mandar_difusiones'))
  with check (public.has_permission(workspace_id, 'mandar_difusiones'));

drop policy if exists "destinatarios" on public.broadcast_recipients;
create policy "destinatarios" on public.broadcast_recipients
  for all to authenticated
  using (public.has_permission(workspace_id, 'mandar_difusiones'))
  with check (public.has_permission(workspace_id, 'mandar_difusiones'));
