# Preparar Supabase Cloud

1. Crea un proyecto en Supabase y copia su URL, anon key y service-role key en un archivo local `.env.local`, usando `.env.example` como guía.
2. En **SQL Editor**, pega y ejecuta `supabase/migrations/202608150001_initial_crm.sql`.
3. En **Authentication > Providers > Email**, deja habilitado *Enable email provider*: el ingreso es con mail y contraseña. Opcionalmente, en **Authentication > URL Configuration > Redirect URLs** agrega las URLs de callback (sólo hacen falta si se usa `/auth/callback`):

```
http://localhost:3000/auth/callback
https://TU-DOMINIO.vercel.app/auth/callback
```

4. Crea la primera cuenta en **Authentication > Users > Add user** (mail, contraseña y *Auto Confirm User* tildado). Es la única que se crea a mano: las demás salen de la sección Usuarios del CRM.

5. Levanta la app (`npm run dev`), entra con esa cuenta y crea el workspace desde la propia interfaz. Ya no hace falta insertarlo a mano por SQL: la ruta `POST /api/workspaces` crea el workspace y la membresía `owner` de forma atómica.

   Si prefieres hacerlo por SQL, con el UUID del usuario:

```sql
with new_workspace as (
  insert into public.workspaces (name) values ('León Group') returning id
)
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'REEMPLAZAR_UUID_DEL_USUARIO', 'owner' from new_workspace;
```

La service-role key se usará exclusivamente desde los webhooks del servidor; no se debe exponer en Vercel como una variable `NEXT_PUBLIC_*`.

> Una service-role key permite usar la API de datos, pero no autoriza DDL por REST. Para automatizar la ejecución de migraciones en Supabase Cloud se requiere un `SUPABASE_ACCESS_TOKEN` (Management API/CLI), el cual no fue proporcionado.
