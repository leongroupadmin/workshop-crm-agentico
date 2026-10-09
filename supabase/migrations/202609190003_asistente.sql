-- El asistente del CRM: un chat interno que consulta los datos del workspace.
--
-- Dos columnas y nada más. No lleva tabla propia porque no guarda nada: la
-- conversación vive en la pantalla mientras está abierta y se va con ella. Eso
-- es a propósito —un historial de preguntas sobre leads es otro lugar donde se
-- acumulan datos de personas— y además hace que no haya nada que migrar,
-- limpiar ni exportar.
--
-- El interruptor es lo que importa. Cada pregunta al asistente son una o dos
-- llamadas a OpenAI, y a diferencia del agente de WhatsApp —que gasta cuando
-- escribe un cliente— éste gasta cuando alguien del equipo tiene curiosidad.
-- Tiene que poder apagarse sin tocar el código ni quitar la API key, que es
-- compartida con los agentes.

alter table public.workspaces
  add column if not exists assistant_enabled boolean not null default true,
  add column if not exists assistant_model text not null default 'gpt-5';

-- La policy de update ya existe desde la migración de la zona horaria
-- (202608190001), y es la misma que gobierna estas columnas: sólo un
-- administrador cambia la configuración del workspace. Se reafirma acá para
-- que correr esta migración sobre una base donde aquélla no llegó a aplicarse
-- no deje el interruptor imposible de guardar.
drop policy if exists "admins update workspaces" on public.workspaces;
create policy "admins update workspaces" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));
