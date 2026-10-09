-- Zona horaria del workspace.
--
-- Vercel corre en UTC y el resumen armaba los días con la fecha del servidor:
-- a las 21:00 de Argentina ya era el día siguiente allá, así que el gráfico de
-- actividad abría una barra de mañana y metía ahí los mensajes de hoy. Quien
-- miraba veía leads en un día que todavía no había empezado.
--
-- El corte del día lo tiene que decidir el equipo, no la máquina donde toca
-- desplegar, así que la zona viaja con el workspace.

alter table public.workspaces
  add column if not exists timezone text not null default 'America/Argentina/Buenos_Aires';

-- `workspaces` sólo tenía policy de lectura: sin esto, guardar la zona desde
-- Configuración fallaba con un error de RLS.
drop policy if exists "admins update workspaces" on public.workspaces;
create policy "admins update workspaces" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));
