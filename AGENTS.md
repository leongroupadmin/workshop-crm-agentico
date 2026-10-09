<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Este repo

Es la versión workshop del CRM agéntico de León Group: cada alumno tiene su propia
copia y la instala en su propio Supabase y su propio Vercel. Quien te habla casi
nunca es programador. Hablale en español, simple y sin jerga.

## Si te piden instalar el CRM

Seguí `INSTALAR.md` **paso por paso, de a uno**: explicá el paso, esperá a que la
persona confirme que lo hizo y recién ahí pasá al siguiente. Si algo falla, pedí
que te cuente o te pase una captura del error antes de seguir.

- El SQL de la base es `supabase/instalar.sql`, un solo archivo para pegar en el
  SQL Editor de Supabase. No le hagas pegar las migraciones de a una.
- **Nunca le pidas que pegue claves en el chat** (service_role, OpenAI, YCloud,
  Zernio). Se cargan directamente en Vercel, en Environment Variables.
- No hay roles: toda cuenta creada en Supabase entra como administradora. Por eso
  insistí en que deje **apagado** "Allow new users to sign up".
- Siempre un proyecto de Supabase **nuevo**, nunca el de otra instalación.
- Vercel se conecta desde su panel (Import Git Repository); no hace falta su CLI.

## Si te piden adaptar el agente

Las instrucciones del agente están en `src/lib/prompts-agentes.ts`. Las que
vienen son un ejemplo armado para León Group: antes de reescribirlas, entrevistá
a la persona (qué vende, a quién, qué tiene que lograr el agente, qué no puede
decir nunca, cuándo deriva a una persona, links que puede compartir) y armá las
suyas respetando la estructura del ejemplo. `pruebas/prompts-agentes.test.mts`
prueba el texto de León Group (sus precios, su workshop): al reemplazar las
instrucciones, reemplazá esas pruebas por unas que cuiden lo importante del agente
nuevo, y corré `npm test`.

## Al hacer cambios

- Verificá con `npm run lint`, `npm test` y `npm run build` antes de subir.
- Vercel publica sólo lo que llega a `main`. Si trabajás en otra rama, abrí un
  pull request y explicale a la persona cómo aprobarlo.
- Nunca subas `.env`, claves ni credenciales.
- Si agregás una migración en `supabase/migrations/`, regenerá
  `supabase/instalar.sql` con `npm run sql:instalar` (hay una prueba que falla si
  no está al día) y decile a la persona qué SQL nuevo tiene que correr en su base.
