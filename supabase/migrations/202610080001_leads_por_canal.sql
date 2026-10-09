-- Por qué canal llegan los leads, para la torta del Resumen.
--
-- No hay una columna que lo diga: el contacto se crea en cinco lugares —el
-- webhook de cada proveedor, la landing, la reserva de Calendar, el alta a mano
-- y la importación— y ninguno anota de dónde vino. Se deduce de lo que dejó
-- cada uno, y por eso se puede contar también lo que entró antes de esta
-- migración.
--
-- Va en una función aparte y no dentro de `metricas_resumen` porque aquélla
-- devuelve una fila y esto es una fila por canal. Mismo criterio que allá: no
-- se cuenta sobre las filas paginadas del tablero sino en Postgres, y corre con
-- las políticas de quien la llama.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- El índice que usa el primer mensaje de cada chat ya existe:
-- `(conversation_id, created_at)`, el mismo que pinta un chat.

-- ---------------------------------------------------------------------------
-- Cómo se decide el canal de un lead
--
-- Se mira con qué empezó todo, en este orden:
--
-- 1. Escribió por un chat y eso lo dio de alta. El webhook crea el contacto al
--    recibir el mensaje, y el mensaje se guarda con la hora en que lo mandó la
--    persona, así que llega con fecha anterior al alta. Es el caso común.
-- 2. Lleva la etiqueta `web`: lo creó la charla de la landing. Va antes que la
--    regla de abajo porque la landing tiene un "Seguir por WhatsApp", y quien lo
--    toca escribe un minuto después de que la charla lo dio de alta. Ése llegó
--    por la web, aunque el primer mensaje sea de WhatsApp.
-- 3. Reservó en Calendar: la cita y el contacto nacieron juntos.
-- 4. Escribió apenas después del alta. Es el margen para los relojes de los
--    proveedores, que no siempre coinciden al segundo con el de la base.
-- 5. Todo lo demás es carga manual: el alta a mano, la importación, o un chat
--    que abrió el equipo. Si quien escribió primero fue el equipo, la persona no
--    llegó: la fueron a buscar.
--
-- Mirar sólo el primer mensaje del contacto, sin compararlo con el alta, se
-- equivocaba con los cargados a mano: alguien importado en marzo que contesta
-- una difusión en junio no llegó por WhatsApp.
-- ---------------------------------------------------------------------------
create or replace function public.leads_por_canal(
  p_workspace uuid,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  canal text,
  total bigint,
  del_tramo bigint
)
language sql stable security invoker set search_path = public as $$
with
activos as (
  select id, created_at, tags from public.contacts
  where workspace_id = p_workspace and archived_at is null
),
-- El primer mensaje de cada contacto, mirando todos sus chats: si escribió por
-- Instagram y un mes después por WhatsApp, llegó por Instagram.
primeros as (
  select distinct on (v.contact_id)
    v.contact_id,
    v.channel::text as canal,
    m.sender_type,
    m.created_at
  from public.conversations v
  join activos c on c.id = v.contact_id
  cross join lateral (
    select sender_type, created_at from public.messages
    where conversation_id = v.id
    order by created_at
    limit 1
  ) m
  where v.workspace_id = p_workspace
  order by v.contact_id, m.created_at
),
origenes as (
  select
    c.created_at,
    case
      when p.sender_type = 'contact' and p.created_at <= c.created_at then p.canal
      when 'web' = any(c.tags) then 'web'
      when exists (
        select 1 from public.appointments a
        where a.contact_id = c.id
          and a.origen = 'calendar'
          and a.created_at <= c.created_at + interval '2 minutes'
      ) then 'calendar'
      when p.sender_type = 'contact'
        and p.created_at <= c.created_at + interval '2 minutes' then p.canal
      else 'manual'
    end as canal
  from activos c
  left join primeros p on p.contact_id = c.id
)
-- El tramo es el mismo de "Leads nuevos": los que se dieron de alta en el mes.
-- Así la torta del mes suma exactamente lo que dice esa tarjeta.
select
  canal,
  count(*),
  count(*) filter (where created_at >= p_desde and created_at < p_hasta)
from origenes
group by canal;
$$;

grant execute on function public.leads_por_canal(uuid, timestamptz, timestamptz) to authenticated;
