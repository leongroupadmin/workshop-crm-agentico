-- El barrido de "sin respuesta" en una sola consulta.
--
-- El cron corre cada cinco minutos y, por cada automatización de seguimiento,
-- miraba las últimas doscientas conversaciones con tres consultas cada una: el
-- último mensaje, el último del contacto y la última corrida. Seiscientos
-- pedidos por vuelta, con o sin movimiento, más de ciento setenta mil por día.
-- Cada uno deja su línea en los logs de Supabase, y en el plan gratis tienen
-- tope. Era, lejos, lo que más pedidos hacía de todo el CRM.
--
-- Esta función devuelve lo mismo de una vez. La decisión de si corresponde el
-- seguimiento sigue en el código (`correspondeSeguimiento`), que se puede
-- probar sin base; acá sólo se juntan los datos.
--
-- No filtra por `updated_at`: un trigger la pisa en cualquier update —marcar
-- un chat como leído, por ejemplo— y no dice cuándo habló nadie. Sólo ordena,
-- igual que antes.

create or replace function public.seguimiento_silencios(
  p_workspace uuid,
  p_automation uuid,
  p_limite integer
)
returns table (
  conversacion uuid,
  contacto uuid,
  ultimo_de_contacto boolean,
  ultimo_en timestamptz,
  ultimo_del_contacto_en timestamptz,
  ultima_corrida_en timestamptz
)
language sql stable security invoker set search_path = public as $$
  select
    charla.id,
    charla.contact_id,
    ultimo.sender_type = 'contact',
    ultimo.created_at,
    (
      select m.created_at
      from public.messages m
      where m.conversation_id = charla.id
        and m.sender_type = 'contact'
      order by m.created_at desc
      limit 1
    ),
    (
      select r.created_at
      from public.automation_runs r
      where r.automation_id = p_automation
        and r.contact_id = charla.contact_id
      order by r.created_at desc
      limit 1
    )
  from (
    select c.id, c.contact_id, c.updated_at
    from public.conversations c
    where c.workspace_id = p_workspace
    order by c.updated_at desc
    limit p_limite
  ) charla
  left join lateral (
    select m.sender_type, m.created_at
    from public.messages m
    where m.conversation_id = charla.id
    order by m.created_at desc
    limit 1
  ) ultimo on true
  order by charla.updated_at desc;
$$;

-- La llama sólo el cron, con la clave de servicio. Nadie desde el navegador.
revoke execute on function public.seguimiento_silencios(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.seguimiento_silencios(uuid, uuid, integer) to service_role;
