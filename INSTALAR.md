# Instalar tu propio CRM

Esta guía te lleva desde cero hasta tu CRM funcionando en internet, con un agente
de IA que contesta tus chats. No hace falta saber programar: abrí este repo con
Claude Code, escribile **"quiero instalar el CRM"** y te va a acompañar paso a paso.

Calculá entre 30 y 45 minutos.

## Lo que necesitás antes de empezar

| Cuenta | Para qué | Costo |
|---|---|---|
| [GitHub](https://github.com) | Tener tu copia del CRM | Gratis |
| [Claude](https://claude.ai) con Claude Code | Que te guíe y haga los cambios | Plan pago de Claude |
| [Supabase](https://supabase.com) | La base de datos y los usuarios | Gratis para empezar |
| [Vercel](https://vercel.com) | Publicar el CRM en internet | Gratis para empezar |
| [OpenAI](https://platform.openai.com) | El cerebro del agente (API key) | Pagás lo que uses |
| [YCloud](https://www.ycloud.com) y/o [Zernio](https://zernio.com) | Recibir los mensajes de WhatsApp, Instagram y Messenger | Según el proveedor |

YCloud y Zernio se pueden dejar para el final: el CRM se instala y se usa sin
ellos, sólo que todavía no entran mensajes.

## Paso 1 · Tu copia del repo

1. En la página de este repo en GitHub, tocá **Use this template → Create a new
   repository**. Si no aparece ese botón, usá **Fork**.
2. Ponele un nombre (por ejemplo `mi-crm`). Puede ser privado.
3. En [claude.ai/code](https://claude.ai/code), conectá tu cuenta de GitHub y
   abrí una sesión sobre **tu** repo nuevo.
4. Escribile a Claude: **"quiero instalar el CRM"**.

## Paso 2 · La base de datos (Supabase)

1. En Supabase, creá un **proyecto nuevo**. Guardá la contraseña de la base en
   algún lado; no la vas a necesitar acá.
2. Andá a **SQL Editor → New query**. Abrí el archivo
   [`supabase/instalar.sql`](supabase/instalar.sql) de tu repo (en GitHub, botón
   **Raw** o **Copy raw file**), pegalo entero y tocá **Run**. Tiene que terminar
   con *Success*.
   - Si aparece `already exists`, la base ya estaba instalada: seguí de largo.
3. Andá a **Authentication → Sign In / Providers**:
   - **Email**: prendido.
   - **Allow new users to sign up**: **apagado**. Es importante: en este CRM
     toda cuenta entra como administradora, y con esto prendido cualquiera
     podría crearse una.
4. Andá a **Authentication → Users → Add user → Create new user**: tu mail, una
   contraseña y tildá **Auto Confirm User**. Con esa cuenta vas a entrar.
5. Andá a **Project Settings → API** (o **Data API / API Keys**) y dejá a mano
   tres datos: la **Project URL**, la **anon public key** y la **service_role
   key**. La service_role es secreta: no la compartas ni la pegues en un chat.

## Paso 3 · La key de OpenAI

En [platform.openai.com/api-keys](https://platform.openai.com/api-keys) creá una
API key y cargale saldo. Dejala a mano junto con las de Supabase.

## Paso 4 · Publicarlo (Vercel)

1. En Vercel, **Add New → Project → Import Git Repository** y elegí tu repo.
2. Antes de tocar **Deploy**, abrí **Environment Variables** y cargá:

   | Nombre | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | La Project URL de Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | La service_role key |
   | `OPENAI_API_KEY` | La key de OpenAI |

3. Tocá **Deploy** y esperá un par de minutos. Vercel te da una dirección del
   estilo `https://mi-crm.vercel.app`: ése es tu CRM.

## Paso 5 · Primer ingreso

1. Entrá a tu dirección de Vercel con el mail y la contraseña del paso 2.
2. Ponele nombre a tu workspace. Listo: ya estás adentro.
3. Para sumar a alguien de tu equipo, creale la cuenta igual que la tuya
   (Supabase → Authentication → Users). La primera vez que entra queda como
   administradora.

## Paso 6 · Tu agente

Las instrucciones de cada agente se escriben en el CRM, en **Agentes IA**: abrí
el canal (WhatsApp, Instagram o Messenger) y completá el campo **Instrucciones**.
Mientras esté vacío, ese agente no contesta.

- Para no arrancar de cero, tocá **Empezar con una plantilla** y completá lo que
  está entre corchetes.
- Si querés ayuda, pedile a Claude **"ayudame a escribir las instrucciones de mi
  agente"**: te va a hacer preguntas (qué vendés, a quién, qué tiene que lograr
  el agente, cuándo pasarle la charla a una persona) y te va a dar el texto listo
  para pegar.

En el mismo lugar elegís el modelo, la demora y el horario. Tocá **Guardar** y
prendé el agente del canal.

## Paso 7 · Conectar los canales

Para cada proveedor se configuran dos cosas: un **webhook** (por donde entran los
mensajes) y las **variables** en Vercel. Después de cargar variables nuevas hay
que volver a desplegar: Vercel → Deployments → los tres puntos del último →
**Redeploy**.

**YCloud (WhatsApp oficial)**

1. En YCloud creá una API key → variable `YCLOUD_API_KEY`.
2. Creá un webhook a `https://TU-DIRECCION/api/webhooks/ycloud` con el evento
   `whatsapp.inbound_message.received`.
3. Copiá el secreto del webhook, entero con el `whsec_` adelante → variable
   `YCLOUD_WEBHOOK_SECRET`.

**Zernio (Instagram, Messenger y WhatsApp)**

1. Habilitá el addon de inbox en Zernio.
2. Inventá un secreto largo al azar → variable `ZERNIO_WEBHOOK_SECRET`.
3. Webhook a `https://TU-DIRECCION/api/webhooks/zernio?token=EL_SECRETO`.
4. Tu API key de Zernio → variable `ZERNIO_API_KEY`.

Para revisar que quedó bien, abrí `https://TU-DIRECCION/api/webhooks/ycloud` o
`/api/webhooks/zernio` en el navegador: te dice qué variables faltan.

## Opcional

- **Avisos en el celular (push):** generá las claves con
  `npx web-push generate-vapid-keys` y cargá `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (por ejemplo `mailto:vos@tumail.com`).
- **Avisos de tareas vencidas:** cargá `CRON_SECRET` (cualquier texto largo al
  azar) y programá un servicio como [cron-job.org](https://cron-job.org) para que
  llame cada 5 minutos a `https://TU-DIRECCION/api/cron/tareas?token=EL_SECRETO`.
- **Citas de Google Calendar:** las citas pueden bajar solas de Google Calendar
  usando [n8n](https://n8n.io) como puente. Cargá `CALENDAR_WEBHOOK_SECRET` y que
  n8n mande cada alta, cambio o baja a `https://TU-DIRECCION/api/webhooks/calendar`
  con ese secreto. Pedile a Claude que te explique qué datos espera ese webhook
  (están documentados en `src/app/api/webhooks/calendar/route.ts`).

## Cambios posteriores

Cada cambio que hace Claude Code se sube a GitHub. Vercel publica solo lo que
llega a la rama `main`: si Claude trabajó en otra rama, pedile que abra un pull
request y aprobalo (merge) en GitHub. A los dos minutos el cambio está en tu CRM.
