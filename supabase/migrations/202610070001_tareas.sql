-- Tareas: cada integrante del equipo programa lo que tiene que hacer.
--
-- "Llamar a Juan mañana a las 10", "mandar la propuesta el jueves". Hasta acá
-- eso vivía en la cabeza de cada uno o en una nota del celular, y el CRM sólo
-- sabía de citas, que son otra cosa: una cita es con el cliente y tiene hora de
-- las dos partes; una tarea es trabajo de alguien del equipo y la hora la pone
-- él.
--
-- Tres reglas definen la tabla:
--
--   - Cualquiera se programa tareas a sí mismo, sin permiso especial. Es la
--     razón de existir del módulo.
--   - Darle una tarea a otra persona es el permiso `asignar_tareas`.
--   - Ver las tareas de los demás es el permiso `ver_tareas_del_equipo`.
--     El administrador tiene los dos por rol, como todos los permisos.
--
-- El lead es opcional: "preparar el reporte del mes" también es una tarea.
--
-- Idempotente: se puede correr dos veces sin romper nada.

create table if not exists public.tareas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  titulo text not null check (length(trim(titulo)) between 1 and 200),
  notas text check (notas is null or length(notas) <= 2000),

  -- Texto con check y no un enum de Postgres, igual que `appointments.tipo`:
  -- agregar un valor a un enum no se puede deshacer dentro de una transacción.
  tipo text not null default 'seguimiento'
    check (tipo in ('llamada', 'mensaje', 'seguimiento', 'reunion', 'otro')),

  -- Para cuándo es.
  vence_at timestamptz not null,

  -- Cuándo avisar, ya calculado. Null es "sin aviso".
  --
  -- Se guarda el instante y no "15 minutos antes" para que el barrido del
  -- reloj sea una comparación contra `now()` y nada más.
  aviso_at timestamptz,

  -- Cuándo salió el aviso. Es la reserva que impide que dos vueltas del reloj
  -- avisen dos veces la misma tarea: se marca antes de mandar.
  avisada_at timestamptz,

  -- Quién la tiene que hacer y quién la creó. Sin `not null`: si la cuenta de
  -- alguien se borra, la tarea queda sin responsable en vez de desaparecer, y
  -- un administrador la reparte.
  asignada_a uuid references auth.users(id) on delete set null,
  creada_por uuid references auth.users(id) on delete set null,

  -- El lead al que corresponde, si corresponde a alguno. Borrar el contacto se
  -- lleva sus tareas, igual que se lleva sus citas.
  contact_id uuid references public.contacts(id) on delete cascade,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'hecha', 'cancelada')),
  completada_at timestamptz,

  -- Si quien la recibió ya la vio. Sólo importa cuando la creó otra persona:
  -- es lo que la campana muestra como "te pasaron una tarea".
  vista boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La lista de cada uno: lo pendiente, por fecha.
create index if not exists tareas_pendientes_idx
  on public.tareas (workspace_id, asignada_a, vence_at)
  where estado = 'pendiente';

-- Las tareas de un lead, para su ficha.
create index if not exists tareas_contacto_idx
  on public.tareas (contact_id)
  where contact_id is not null;

-- Lo que mira el reloj en cada vuelta: avisos vencidos que todavía no salieron.
create index if not exists tareas_avisos_idx
  on public.tareas (aviso_at)
  where estado = 'pendiente' and avisada_at is null and aviso_at is not null;

-- Lo que mira la campana. Las no vistas son siempre un puñado.
create index if not exists tareas_sin_ver_idx
  on public.tareas (workspace_id, asignada_a)
  where vista = false;

drop trigger if exists tareas_touch_updated_at on public.tareas;
create trigger tareas_touch_updated_at
  before update on public.tareas
  for each row execute function public.touch_updated_at();

comment on table public.tareas is
  'Trabajo programado de cada integrante del equipo, con o sin lead.';
comment on column public.tareas.aviso_at is
  'Cuándo avisar a quien la tiene asignada. Null: sin aviso.';
comment on column public.tareas.avisada_at is
  'Cuándo salió el aviso. Se marca antes de mandar, para no avisar dos veces.';
comment on column public.tareas.vista is
  'false si se la asignó otra persona y quien la recibió todavía no la vio.';

-- ---------------------------------------------------------------------------
-- Quién ve una tarea
--
-- `security definer` por lo mismo que las funciones de permisos: se la llama
-- desde la política y lee workspace_members y contacts sin volver a pasar por
-- RLS.
--
-- Quien la tiene asignada y quien la creó la ven siempre, aunque el lead ya no
-- sea suyo: la tarea es de ellos. El resto del equipo —el administrador o quien
-- tenga `ver_tareas_del_equipo`— la ve si además ve el lead, porque el título de
-- una tarea suele llevar el nombre del cliente, y ver la tarea no puede ser una
-- forma de enterarse de leads que no te tocan.
-- ---------------------------------------------------------------------------

create or replace function public.puede_ver_tarea(
  target_workspace uuid,
  asignada uuid,
  creador uuid,
  contacto uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = auth.uid()
      and (
        asignada = auth.uid()
        or creador = auth.uid()
        or (
          (m.role in ('owner', 'admin')
           or coalesce((m.permissions ->> 'ver_tareas_del_equipo')::boolean, false))
          and (contacto is null or public.can_see_contact_row(contacto))
        )
      )
  );
$$;

grant execute on function public.puede_ver_tarea(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Si un miembro puede ver un lead, para cualquier miembro y no sólo para quien
-- está en sesión.
--
-- Es `can_see_contact` con el usuario como parámetro. Lo necesita la guarda de
-- abajo: al darle a alguien una tarea sobre un lead hay que saber si *esa
-- persona* ve el lead, no quien la está creando.
--
-- No se le da a `authenticated`: preguntar qué ve otra persona no es algo que
-- la app necesite exponer. Sólo la usa el trigger, que corre como su dueño.
-- ---------------------------------------------------------------------------

create or replace function public.miembro_ve_contacto(
  target_workspace uuid,
  miembro uuid,
  target_contact uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.contacts c on c.id = target_contact and c.workspace_id = m.workspace_id
    where m.workspace_id = target_workspace
      and m.user_id = miembro
      and (
        m.role in ('owner', 'admin')
        or coalesce((m.permissions ->> 'ver_todos_los_leads')::boolean, false)
        or c.assigned_to = miembro
        or (c.assigned_to is null
            and coalesce((m.permissions ->> 'ver_leads_sin_asignar')::boolean, false))
      )
  );
$$;

revoke execute on function public.miembro_ve_contacto(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- La guarda de la tabla
--
-- Las políticas miran la fila nueva y la vieja por separado; lo que sigue
-- necesita compararlas, o mirar otras tablas, y por eso va en un trigger:
--
--   - El workspace y quien la creó no cambian nunca.
--   - Pasarle la tarea a otra persona pide `asignar_tareas`. Quedártela vos no.
--   - Quien la recibe tiene que ser del workspace y, si hay lead, verlo: una
--     tarea sobre un cliente que no podés abrir es una tarea que no podés
--     hacer.
--   - Al cambiar de manos queda sin ver, para que la campana avise.
--   - Al cambiar el aviso, vuelve a quedar pendiente de salir.
--   - `completada_at` sigue al estado solo.
--
-- `auth.uid()` es null en los trabajos de servidor (el reloj entra con la
-- clave de servicio). Ahí no hay sesión que controlar y los permisos no
-- aplican; las reglas de consistencia sí.
-- ---------------------------------------------------------------------------

create or replace function public.guard_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  cambia_responsable boolean;
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.creada_por := old.creada_por;
    cambia_responsable := new.asignada_a is distinct from old.asignada_a;
  else
    cambia_responsable := true;
  end if;

  if new.contact_id is not null
     and (tg_op = 'INSERT' or new.contact_id is distinct from old.contact_id)
     and not exists (
       select 1 from public.contacts c
       where c.id = new.contact_id and c.workspace_id = new.workspace_id
     ) then
    raise exception 'Ese contacto no es de este workspace.';
  end if;

  if new.asignada_a is not null
     and (cambia_responsable or new.contact_id is distinct from old.contact_id) then
    if actor is not null
       and cambia_responsable
       and new.asignada_a <> actor
       and not public.has_permission(new.workspace_id, 'asignar_tareas') then
      raise exception 'No tenés permiso para darle tareas a otra persona.';
    end if;

    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = new.asignada_a
    ) then
      raise exception 'Esa persona no es parte del equipo.';
    end if;

    if new.contact_id is not null
       and not public.miembro_ve_contacto(new.workspace_id, new.asignada_a, new.contact_id) then
      raise exception 'Esa persona no ve este lead. Asignale el lead primero o elegí a otra persona.';
    end if;
  end if;

  if cambia_responsable then
    new.vista := new.asignada_a is null or new.asignada_a is not distinct from actor;
  end if;

  -- Salvo que quien escribe ya diga qué hacer con el aviso: la app lo marca
  -- como salido cuando la hora nueva ya pasó, para no mandar un aviso de algo
  -- que se está cargando a sabiendas de que es para antes.
  if tg_op = 'UPDATE'
     and (new.aviso_at is distinct from old.aviso_at or new.vence_at is distinct from old.vence_at)
     and new.avisada_at is not distinct from old.avisada_at then
    new.avisada_at := null;
  end if;

  -- Al reabrirla se borra, así que al volver a marcarla hecha llega en null y
  -- toma la hora de ahora, que es la que importa.
  if new.estado = 'hecha' then
    new.completada_at := coalesce(new.completada_at, now());
  else
    new.completada_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tareas_guard on public.tareas;
create trigger tareas_guard
  before insert or update on public.tareas
  for each row execute function public.guard_tarea();

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------

alter table public.tareas enable row level security;

drop policy if exists "read visible tareas" on public.tareas;
create policy "read visible tareas" on public.tareas
  for select to authenticated
  using (public.puede_ver_tarea(workspace_id, asignada_a, creada_por, contact_id));

-- Crear: siempre a nombre propio. A quién se le da lo controla la guarda.
drop policy if exists "create own tareas" on public.tareas;
create policy "create own tareas" on public.tareas
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and creada_por = auth.uid()
    and (contact_id is null or public.can_see_contact_row(contact_id))
  );

-- Editar: quien la tiene, quien la creó o un administrador. Ver las del equipo
-- no alcanza para tocarlas: es un permiso de mirar.
drop policy if exists "update own tareas" on public.tareas;
create policy "update own tareas" on public.tareas
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      asignada_a = auth.uid()
      or creada_por = auth.uid()
      or public.is_workspace_admin(workspace_id)
    )
  )
  with check (public.is_workspace_member(workspace_id));

-- Borrar: quien la creó o un administrador. Quien sólo la recibió la cancela.
drop policy if exists "delete own tareas" on public.tareas;
create policy "delete own tareas" on public.tareas
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (creada_por = auth.uid() or public.is_workspace_admin(workspace_id))
  );
