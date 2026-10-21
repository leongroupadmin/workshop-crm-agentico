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
   repository**. No uses **Fork**: un fork de este repo no se puede hacer privado.
2. Ponele un nombre (por ejemplo `mi-crm`) y elegí **Private**. Tiene que ser
   privado: la [licencia](LICENSE) te deja usar el CRM para tu negocio, pero no
   publicarlo, venderlo ni instalárselo a otros.
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
API key y cargale saldo. Dejala a mano: la vas a pegar en el CRM en el paso 6.
Si todavía no la tenés, seguí igual: el CRM anda sin ella, sólo el agente no
contesta.

## Paso 4 · Publicarlo (Vercel)

1. En Vercel, **Add New → Project → Import Git Repository** y elegí tu repo.
2. Antes de tocar **Deploy**, abrí **Environment Variables** y cargá:

   | Nombre | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | La Project URL de Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | La service_role key |

   Las claves de OpenAI, YCloud y Zernio **no** van acá: se cargan después,
   desde el CRM.

3. Tocá **Deploy** y esperá un par de minutos. Vercel te da una dirección del
   estilo `https://mi-crm.vercel.app`: ése es tu CRM.

## Paso 5 · Primer ingreso

1. Entrá a tu dirección de Vercel con el mail y la contraseña del paso 2.
2. Ponele nombre a tu workspace. Listo: ya estás adentro.
3. Para sumar a alguien de tu equipo, creale la cuenta igual que la tuya
   (Supabase → Authentication → Users). La primera vez que entra queda como
   administradora.

## Paso 6 · Conexiones (OpenAI, YCloud y Zernio)

Las claves de los proveedores se cargan en el CRM, en **Configuración →
Conexiones**. Se guardan cifradas y no se vuelven a mostrar.

1. **Una sola vez:** la primera vez que entrás, la tarjeta te pide una variable
   más en Vercel, `INTEGRATIONS_ENCRYPTION_KEY`, y te la muestra ya generada
   para copiar. Es la llave con la que se cifran tus claves. Cargala en Vercel →
   Settings → Environment Variables, y después Deployments → los tres puntos
   del último → **Redeploy**. No la cambies nunca más.
2. **OpenAI:** abrí la fila, pegá la key y tocá **Guardar**.
3. **YCloud y Zernio:** se ven en el paso 8.

## Paso 7 · Tu agente

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

## Paso 8 · Conectar los canales

Se hace en el CRM, en **Configuración → Conexiones**, sin tocar Vercel. Cada
conexión es una lista de pasos: abrí la fila y seguilos en orden.

**YCloud (WhatsApp oficial)**

1. Pegá la API key de YCloud.
2. La pantalla te da la dirección del webhook con un botón para copiarla. En
   YCloud creá un webhook con esa dirección y el evento
   `whatsapp.inbound_message.received`.
3. Copiá el secreto que te da YCloud, entero con el `whsec_` adelante, y pegalo.
4. Tocá **Guardar**.

**Zernio (Instagram, Messenger y WhatsApp)**

1. Habilitá el addon de inbox en Zernio.
2. Pegá tu API key de Zernio.
3. Tocá **Generar**: el CRM inventa el secreto por vos.
4. Tocá **Guardar**.
5. Copiá la dirección del webhook con el botón (ya trae el secreto adentro) y
   pegala en Zernio → Settings → Webhooks, con el evento `message.received`.

Para revisar que quedó bien, abrí `https://TU-DIRECCION/api/webhooks/ycloud` o
`/api/webhooks/zernio` en el navegador: te dice qué falta.

## Paso 9 · Antes de usarlo con clientes reales

El CRM es tuyo y lo manejás vos: tus cuentas, tus datos y tus gastos corren por
tu cuenta (está en la [licencia](LICENSE)). Antes de abrirlo a clientes, revisá
esta lista. Tildá cada punto recién cuando lo hayas comprobado.

**Seguridad**

- [ ] **Tu copia del repo es privada.** En GitHub, tu repo → **Settings** → abajo
  de todo, **Change visibility**. Tiene que decir *Private*.
- [ ] **Nadie se puede registrar solo.** En Supabase → **Authentication → Sign In
  / Providers**, *Allow new users to sign up* tiene que estar **apagado**.
- [ ] **Sólo tienen cuenta las personas que vos elegiste.** En Supabase →
  **Authentication → Users**, borrá las que no reconozcas. Acordate de que toda
  cuenta entra como administradora y ve todo.
- [ ] **Tus claves no están en ningún lado más.** La service_role de Supabase y
  las keys de OpenAI, YCloud y Zernio no se mandan por chat, mail ni WhatsApp.
  Si alguna se compartió, generá una nueva y reemplazala.

**Gastos**

- [ ] **OpenAI tiene un límite.** En
  [platform.openai.com](https://platform.openai.com), **Settings → Billing**:
  dejá apagada la recarga automática (*auto recharge*) o ponele un tope. Así el
  agente nunca gasta más de lo que cargaste.

**Tus datos**

- [ ] **Tenés una copia de seguridad.** En el CRM, **Base de datos → Descargar
  la base**: bajá cada tabla y guardá los archivos. Repetilo cada tanto. Ojo: Supabase pausa los proyectos gratis que no se usan
  por un tiempo.

**El agente**

- [ ] **Lo probaste con vos.** Escribile desde tu propio celular y hacele las
  preguntas que te haría un cliente, incluidas las difíciles: precios,
  descuentos, quejas. Si inventa algo o promete lo que no debe, corregí las
  **Instrucciones** y volvé a probar.
- [ ] **Vas a leer sus primeras charlas reales.** Los primeros días revisá en
  **Conversaciones** qué contesta. La IA se puede equivocar y habla en nombre de
  tu negocio.

**WhatsApp e Instagram**

- [ ] **Sólo le escribís a quien te escribió o aceptó tus mensajes.** Meta puede
  bloquear un número que manda mensajes no pedidos.

## Opcional

- **Avisos en el celular (push):** generá las claves con
  `npx web-push generate-vapid-keys` y cargá `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (por ejemplo `mailto:vos@tumail.com`).
- **Avisos de tareas vencidas:** cargá `CRON_SECRET` (cualquier texto largo al
  azar) y programá un servicio como [cron-job.org](https://cron-job.org) para que
  llame cada 5 minutos a `https://TU-DIRECCION/api/cron/tareas?token=EL_SECRETO`.

## Cambios posteriores

Cada cambio que hace Claude Code se sube a GitHub. Vercel publica solo lo que
llega a la rama `main`: si Claude trabajó en otra rama, pedile que abra un pull
request y aprobalo (merge) en GitHub. A los dos minutos el cambio está en tu CRM.
