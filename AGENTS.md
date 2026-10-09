<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Flujo de trabajo con Git

- Trabajar directamente en este repositorio; no pedir al usuario que suba archivos manualmente.
- Antes de empezar una tarea, sincronizar la rama de trabajo con su remoto sin sobrescribir cambios locales.
- Al completar cambios solicitados, verificar lo modificado, crear un commit que incluya solo los archivos de esa tarea y hacer push de la rama actual a `origin`, salvo que el usuario indique expresamente que no se publique.
- No incluir en commits cambios locales ajenos a la tarea ni secretos, credenciales o archivos `.env`.
- Para trabajo nuevo que no deba ir directamente a `main`, usar ramas con prefijo `codex/` y publicar la rama para que quede disponible en GitHub.
