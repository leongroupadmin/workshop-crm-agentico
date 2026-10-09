-- Chats destacados.
--
-- La lista de la bandeja ordena por actividad: el chat que importa toda la
-- semana se hunde cada vez que escribe cualquier otro, y había que buscarlo por
-- nombre una y otra vez. La estrella lo fija arriba.
--
-- La marca es del workspace y no de cada persona: en un equipo chico el chat
-- importante es el mismo para todos, y una tabla aparte por usuario es más de
-- lo que esto necesita.
alter table public.conversations
  add column if not exists destacada boolean not null default false;

comment on column public.conversations.destacada is
  'Chat fijado arriba en la bandeja con una estrella.';

-- La bandeja trae sólo las 50 más recientes: sin este índice el orden por
-- estrella obliga a recorrer todas las conversaciones del workspace.
create index if not exists conversations_destacadas_idx
  on public.conversations (workspace_id, destacada desc, updated_at desc);
