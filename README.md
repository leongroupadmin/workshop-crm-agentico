# León CRM — versión workshop

CRM agéntico multicanal (WhatsApp, Instagram y Messenger): los agentes de IA trabajan adentro del CRM, no al costado. Está construido sobre Next.js 16 y Supabase. Sirve para cualquier rubro: el embudo, los agentes y los campos del lead los define cada workspace.

Es una **versión reducida** del CRM de León Group ([leongroupadmin/CRM](https://github.com/leongroupadmin/CRM)), armada para el workshop. Partió de ese repo y vive por separado: lo que cambie acá no toca al original.

| Queda | Se sacó |
|---|---|
| Resumen, Conversaciones, Pipeline, Contactos, Agenda, Tareas, Agentes IA, Base de datos (importar y exportar), Configuración, campana y avisos push, asistente | Automatizaciones (incluidos los recordatorios de citas, los seguimientos y el reparto de leads), Difusiones, Usuarios (roles y permisos), WAHA, conversiones de Meta (CAPI) y la landing |

Los mensajes entran por **YCloud** (WhatsApp oficial) y **Zernio** (Instagram, Messenger y WhatsApp), y los **agentes de IA** son los que contestan los chats.

> **Usá un proyecto de Supabase propio para el workshop**, nunca el del CRM de producción: las migraciones de esta versión no traen las tablas de lo que se sacó.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Supabase** — Postgres con RLS, Auth con mail y contraseña, y Realtime
- **Tailwind v4** + **lucide-react**
- **TypeScript**

## Puesta en marcha

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Configurar variables de entorno** — copiá `.env.example` a `.env.local` y completá los valores de tu proyecto Supabase (Settings → API).

   ```bash
   cp .env.example .env.local
   ```

3. **Crear el esquema** — en el SQL Editor de un proyecto de Supabase **nuevo**, ejecutá **todos** los archivos de `supabase/migrations/`, uno por uno y en orden de nombre (empezando por `202608150001_initial_crm.sql`).

4. **Habilitar el acceso con contraseña** — en Supabase, ir a **Authentication → Providers → Email** y dejar prendido *Enable email provider*. El ingreso al CRM es con mail y contraseña; no se manda nada por correo.

   Opcional, sólo si algún día se usa el callback (`/auth/callback`): en **Authentication → URL Configuration → Redirect URLs** agregar `http://localhost:3000/auth/callback` y `https://TU-DOMINIO/auth/callback`.

5. **Levantar el proyecto**

   ```bash
   npm run dev
   ```

   El CRM no tiene registro público, así que la **primera** cuenta se crea a mano una sola vez: en Supabase, **Authentication → Users → Add user**, con mail, contraseña y *Auto Confirm User* tildado.

   Con esa cuenta se entra, se crea el workspace y se queda como administrador. Para sumar a alguien más se crea su cuenta igual, en **Authentication → Users** de Supabase, y le pasás el mail y la contraseña. La primera vez que entra, el CRM la suma sola **como administradora**: en esta versión no hay roles ni permisos, todos ven y pueden todo.

   > Como cualquier cuenta del proyecto Supabase entra al CRM como administradora, dejá **apagado** *Allow new users to sign up* en Supabase (Authentication → Sign In / Providers). Si no, la anon key —que viaja en el navegador— permite que cualquiera se cree una cuenta.

   Hay **un solo workspace** por instalación: todos los usuarios trabajan sobre el mismo CRM. Una vez creado, el servidor rechaza cualquier intento de crear otro.

## Arquitectura

La sesión vive en **cookies**, no en `localStorage`, para que el servidor pueda renderizar con el usuario ya resuelto:

| Pieza | Rol |
|---|---|
| `src/proxy.ts` | Refresca el token de Supabase en cada request y reescribe las cookies. |
| `src/lib/supabase/server.ts` | Cliente con RLS ligado a las cookies. Uno nuevo por request. |
| `src/lib/supabase/browser.ts` | Cliente del navegador; persiste la sesión en cookies. |
| `src/lib/supabase/admin.ts` | Service-role, omite RLS. **Solo** para webhooks y trabajos de servidor. |
| `src/app/auth/callback/route.ts` | Canjea un `code` PKCE por una sesión. El login normal es con contraseña y no pasa por acá. |
| `src/lib/workspace.ts` | Resuelve usuario + workspace en el servidor. |
| `src/lib/crm-data.ts` | Consultas del dashboard (métricas, contactos, pipeline, agenda). |
| `src/lib/metricas.ts` | Formato y comparación de las tarjetas del Resumen. Funciones puras. |
| `src/lib/tareas.ts` | Validación, grupos (vencidas, hoy, mañana…) y textos de las tareas. Funciones puras. |
| `src/app/actions.ts` | Server Actions. El `workspace_id` se resuelve en el servidor, nunca lo elige el cliente. |

## Avisos de derivaciones y mensajes con el CRM cerrado

La campana puede registrar cada computadora o celular para recibir Web Push.
Cuando un contacto escribe —lo conteste o no la IA— y cuando la IA deriva un
chat, el servidor avisa al responsable del lead; si no hay uno, avisa a
administradores y a operarios con permisos para ver leads sin asignar y
responder chats. Tocar el aviso abre esa conversación directamente. Varios
mensajes seguidos del mismo chat dejan un solo aviso, el último.

Para habilitarlo en un ambiente:

1. Ejecutar `supabase/migrations/202608270001_push_notifications.sql` en el SQL
   Editor de Supabase.
2. Generar una identidad VAPID una sola vez:

   ```bash
   npx web-push generate-vapid-keys
   ```

3. Cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en las
   variables del servidor. `VAPID_SUBJECT` debe ser una URL HTTPS o un contacto
   como `mailto:admin@tu-dominio.com`.
4. Volver a desplegar. Cada usuario abre la campana y toca **Activar avisos** en
   cada dispositivo donde quiera recibirlos.

El sitio debe correr por HTTPS —localhost es la única excepción de los
navegadores—. En iPhone/iPad hay que agregar el CRM a la pantalla de inicio y
activar los avisos desde esa aplicación instalada.

## Conectar Zernio

Zernio entrega los mensajes de WhatsApp, Instagram y Messenger por webhook.

1. **Habilitar el addon de inbox** en tu cuenta de Zernio: sin eso no se emiten webhooks de mensajes.
2. **Configurar la URL del webhook** apuntando a este proyecto:

   ```
   https://TU-DOMINIO/api/webhooks/zernio
   ```

3. **Definir el secreto compartido**, en la variable `ZERNIO_WEBHOOK_SECRET` del servidor. El handler acepta dos pruebas de autenticidad:

   - **Firma HMAC-SHA256** sobre el cuerpo crudo, en `X-Zernio-Signature` (u otros nombres habituales), en hex o base64. Es la preferible.
   - **Token en la URL**, si Zernio no firma el cuerpo: `…/api/webhooks/zernio?token=EL_SECRETO`. Es más débil —las URLs quedan escritas en logs y proxies— pero sin firma no hay nada que verificar, y la única prueba posible es que quien llama conozca el secreto.

   Cualquier request que no pase ninguna de las dos se rechaza con 401, y el cuerpo de la respuesta explica cuál falló.
4. **Cargar `ZERNIO_API_KEY`** para poder responder. Los dos sentidos usan credenciales distintas: recibir se valida con el secreto del webhook, responder se autentica con la API key. Recibir funciona sin la key.

## Conectar YCloud (WhatsApp oficial)

YCloud es un proveedor oficial de Meta: el número se vincula en su panel, no
por QR, y no hay riesgo de que WhatsApp lo bloquee. Convive con Zernio —cada
conversación recuerda por dónde entró, en `conversations.provider`— así que
sumar YCloud no apaga nada de lo que ya funciona.

1. **Crear la API key** en el panel de YCloud y cargarla en `YCLOUD_API_KEY`.
2. **Configurar la URL del webhook**, suscribiendo el evento
   `whatsapp.inbound_message.received`:

   ```
   https://TU-DOMINIO/api/webhooks/ycloud
   ```

3. **Copiar el secreto del webhook** —el que YCloud muestra como
   `whsec_…`— a `YCLOUD_WEBHOOK_SECRET` en el servidor. Va **entero, con el
   prefijo**: el código se encarga de sacarlo.

   YCloud entrega por Svix, así que la firma no es un HMAC del cuerpo pelado:
   se firma `id.timestamp.cuerpo` y la clave son los bytes del secreto
   decodificado de base64. Además se rechaza toda entrega con más de cinco
   minutos, para que una interceptada no se pueda reenviar después. Sin firma
   válida el handler responde 401.

   Queda una salida de emergencia: `?token=<YCLOUD_WEBHOOK_SECRET>` al final de
   la URL también autentica. Sirve para reenviar un evento a mano desde `curl`,
   donde no hay forma de firmarlo; no hace falta para la operación normal.

`GET /api/webhooks/ycloud` dice qué variables faltan sin exponer sus valores.

### Qué se mapea

| Campo de YCloud | Dónde queda |
|---|---|
| `whatsappInboundMessage.from` | Teléfono del contacto y `zernio_chat_id` de la conversación |
| `whatsappInboundMessage.to` | Tu número, en `zernio_account_id`: es el puente al workspace |
| `wamid` | `zernio_message_id`, que hace idempotente el reintento |
| `customerProfile.name` | Nombre del contacto |
| `text.body` | Contenido del mensaje |

En WhatsApp la conversación no tiene id propio: es el par de números. Por eso
el teléfono del contacto ocupa el lugar del id de chat y el número propio el de
la cuenta.

### Plantillas

Pasadas 24 horas desde el último mensaje del contacto, WhatsApp rechaza
cualquier texto libre: la única forma de volver a escribirle es una plantilla
aprobada por Meta. Se crean en el panel de YCloud y desde el CRM sólo se leen y
se envían.

En la barra del chat, el botón de hoja abre la lista. Aparece únicamente en
conversaciones de WhatsApp, y adentro sólo se ofrecen las plantillas en estado
`APPROVED`. Al elegir una se completan sus huecos (`{{1}}`, `{{2}}`) con la
vista previa de lo que va a recibir el contacto; en el historial queda guardado
ese texto ya armado, no el nombre de la plantilla.

Del navegador viajan el nombre, el idioma y los valores, nunca el cuerpo: la
definición se vuelve a leer en el servidor y con ella se arma el envío, para que
tener la sesión abierta no alcance para mandar un texto arbitrario disfrazado de
plantilla.

El listado se pide a YCloud y se guarda cinco minutos en memoria. Si creaste una
plantilla y todavía no aparece, esperá ese rato o reiniciá el CRM.

`GET /api/ycloud/plantillas` —con sesión iniciada— muestra las plantillas como
las devuelve YCloud y como las leemos nosotros. Es lo que separa "la cuenta no
tiene ninguna aprobada" de "vienen en un envoltorio que no estamos entendiendo".

## Embudos

Un workspace puede tener varios embudos, cada uno con sus propias columnas:
vender y dar posventa son procesos distintos y mezclar sus columnas en una sola
fila obliga a filtrar a ojo.

**Un lead vive en un embudo por vez.** Es lo que ya asumía todo el código —"la
etapa del contacto", en singular— y es lo que hace entendible el reparto: pasar
un lead de Ventas a Posventa es moverlo, no duplicarlo. Se lo mueve eligiendo
una columna del otro embudo en el selector de etapa, igual que se lo mueve de
columna.

**El primero es la entrada.** Ahí caen los leads que llegan por chat, los que se
importan y los que se cargan a mano. Es la misma convención que la primera
columna adentro de cada embudo, para que haya una sola regla que recordar: lo
que está primero es por donde se entra. Se cambia subiendo otro embudo a ese
lugar, en Pipeline → Embudos.

Un embudo nuevo nace con tres columnas —entrada, ganado y perdido— y no vacío:
sin columnas no acepta una sola tarjeta, y las de ganado y perdido son las que
alimentan el valor del embudo y la tasa de conversión. Todas se pueden
renombrar.

Borrar un embudo nunca borra leads: o pasan a la columna de entrada del embudo
que se elija, o la acción falla. Y siempre tiene que quedar al menos uno, porque
sin ninguno un lead nuevo no tendría dónde caer.

El embudo de una oportunidad no se escribe a mano: se deduce de su etapa, que es
el único lugar donde está esa verdad, y lo sostiene un trigger. Así una tarjeta
arrastrada a otro embudo se lleva su `pipeline_id` sin que nadie se acuerde de
actualizarlo.

Con dos o más embudos, todos los selectores de etapa de la app —el disparador de
una automatización, el filtro de una difusión, la columna de la importación—
agrupan las columnas por embudo. Sin eso, dos columnas llamadas "Nuevo lead" en
dos embudos distintos son indistinguibles, y elegir la equivocada manda el lead
a otro proceso.

Los permisos por columna siguen funcionando igual, con una corrección: la
columna de entrada que un operario ve siempre pasó a ser **la de cada embudo**,
no una sola en todo el workspace. Con la regla vieja, los leads que entraban al
segundo embudo le desaparecían al operario restringido apenas caían.

## Agentes IA

Hay un agente por canal —WhatsApp, Instagram y Messenger— con sus instrucciones,
su modelo y su demora. Tres recortes deciden cuándo habla y cuándo se calla.

**Las instrucciones viven en el código**, en `src/lib/prompts-agentes.ts`, una
por canal. Estuvieron en `ai_agent_configs.system_prompt`, editables desde el
panel, y el problema no era el campo sino que no quedaba historia: quien pisaba
el textarea se llevaba puesto el texto anterior sin dejar rastro, y el día que
el agente empezaba a contestar peor no había con qué comparar ni a qué volver.
Ahora cada cambio es un commit, con fecha, motivo y `git revert`.

El costo es que cambiarlas pide un despliegue. Se eligió igual porque lo urgente
no necesita editar el prompt: el interruptor del canal apaga al agente en el
acto, y ése es el caso real de emergencia. La columna `system_prompt` sigue en
la tabla con lo último que se guardó desde el panel viejo —queda como respaldo
de lo que había el día de la mudanza— y ya no la lee nadie.

Un canal sin texto es un canal mudo. Es el mismo freno de siempre —sin
instrucciones no hay agente, para que la IA no arranque a hablar sola apenas se
carga la API key— movido de la base al código, así un despliegue no pone a
contestar a un canal que nunca se configuró.

El panel las muestra en solo lectura, plegadas, con el contador de caracteres y
los tokens que se pagan en cada respuesta. Se muestran y no se esconden porque
el panel es el único lugar donde alguien puede enterarse de qué le está diciendo
el agente a sus clientes: sin eso, el "¿por qué contestó esto?" no tiene
respuesta posible desde la app.

**Las marcas del agente.** El agente le habla al CRM con dos palabras sueltas
dentro de su respuesta, que se sacan del texto antes de enviarlo
(`src/lib/marcas-del-agente.ts`). `[DERIVAR]` pide que siga una persona: apaga
la IA de ese contacto, deja el chat pendiente y avisa al responsable.
`[RESUMEN]` abre la única puerta que el agente tiene para escribirle al equipo:
todo lo que va después se guarda como nota en el hilo —con el ⚙️ del aviso
interno de las automatizaciones— y no se envía. Sin esa puerta, un prompt que le
pide "dejá registrado un resumen" se lo termina mandando al lead por WhatsApp,
porque el mensaje era lo único que el agente sabía producir.

Ninguna de las dos dicta con qué palabras despedirse ni qué poner en el resumen:
eso es del prompt, que sabe de qué negocio se trata. Cuando las instrucciones
del sistema también elegían la frase de derivación, ganaban ellas por ir últimas
y el agente se despedía distinto de lo que decía su propio prompt.

**En qué embudos contesta.** Sin marcar ninguno contesta en todos: no elegir es
no restringir, igual que los permisos por columna. Se marca cuando hay más de un
embudo, porque el agente que califica leads de ventas no tiene nada que decirle
a alguien que ya está en posventa. La elección vive en `ai_agent_pipelines`, una
tabla y no un arreglo de ids en la config: con la clave foránea, borrar un
embudo limpia sola la restricción que lo apuntaba. El efecto secundario es que
borrar el último embudo al que un agente estaba restringido lo deja contestando
en todos, que es el estado abierto y no uno donde se quede mudo sin motivo.

**El horario en el que contesta.** Días y hasta tres franjas de horas por agente,
en la zona horaria del equipo, con un interruptor que decide cómo se lee lo
marcado: **"Contesta solo en"** o **"No contesta en"**. Nace sin recorte —los
siete días, a toda hora— así que la migración no le cambió el comportamiento a
nadie.

Antes el agente era de dos estados: prendido, y entonces contestaba a cualquier
hora de cualquier día, o apagado. Para un equipo que atiende de 9 a 18 eso deja
dos agujeros. El de la madrugada se ve: el lead que escribe a las 3 AM recibe una
respuesta redactada al instante, y si en esa charla el agente quedó en que "un
asesor te escribe en un rato", el asesor aparece seis horas después. El otro es
el que molesta de verdad: el agente coordina reuniones y promete respuestas de
gente que no está, así que a la mañana alguien tiene que salir a desdecirlo.

Fuera del horario el agente no contesta y el mensaje queda en la bandeja, sin
responder, para que lo atienda una persona cuando abra. No se guarda para
contestarlo al abrir, y no es una decisión de producto: la respuesta sale en el
`after()` del webhook, que se muere con la función, y ahí no hay dónde esperar
ocho horas. El corte va antes de armar el pedido a OpenAI, así que un lead de
madrugada tampoco cuesta tokens.

**El horario cortado.** Las franjas son una lista y no un par de horas porque
"una" es tan arbitrario como "dos": el que atiende corrido necesita una, el que
corta al mediodía dos. Con un solo par, un negocio de 9 a 13 y de 16 a 20 tenía
que cargar 9 a 20, y el agente arrancaba charlas a las 14 —cuando no hay nadie
para seguirlas, que es exactamente el problema que el horario venía a resolver—.
La otra salida, dejarlo todo el día, era peor.

Viven en `ai_agent_configs.franjas`, un jsonb, por lo mismo que
`automations.pasos`: son dos o tres pares de números que siempre se leen junto con
la config y nunca por separado, y una tabla aparte con su RLS para eso es una
junta más en cada mensaje que entra. El check de la base cuida la forma gruesa
—que sea una lista y que no pase de tres— y la forma de cada franja la valida la
app, que es la única que puede explicar en una frase por qué no se guarda. El tope
de tres alcanza para mañana, tarde y una guardia suelta; más que eso es una
planilla, no un horario.

La lista vacía es todo el día: no elegir es no restringir, igual que los embudos.
Las franjas se guardan ordenadas por hora de apertura, que es como se leen, y dos
que se pisan no se guardan —no son dos franjas, es una mal cargada—. Dos que se
tocan sí, porque son una sola más larga escrita en dos renglones.

Los días y las horas son las mismas piezas que ya deciden los turnos del reparto
de leads y la franja de envío de las automatizaciones, y la cuenta de "¿está
abierta esta franja?" es la misma función (`dentroDeLaFranja`), que es la que sabe
de husos raros y de cambios de horario de verano. Dos convenciones para lo mismo
serían dos formas de equivocarse.

**Los dos modos.** El mismo horario leído al derecho o al revés. "Contesta solo
en" es la lista blanca: habla adentro, calla afuera, y sirve para el negocio que
atiende de 9 a 18. "No contesta en" es la excepción: calla adentro y habla
afuera.

El segundo existe porque un agente de IA casi siempre arranca contestando a toda
hora —es la mitad de por qué se pone— y entonces lo que se quiere declarar es
dónde *no*: "menos de 13 a 16", "menos los domingos". Con una sola lectura eso
obligaba a cargar el complemento, de 00:00 a 13:00 y de 16:00 a 24:00, que es la
forma más fácil de equivocarse —un minuto de más en el borde y el agente habla
justo cuando no tiene que hablar— y que encima nadie reconoce como "cerramos al
mediodía".

No agrega ningún campo para cargar: son las mismas franjas y los mismos días. Lo
que cambia es la frase, y el panel la muestra armada mientras se edita: *"Contesta
siempre, salvo de lunes a viernes de 13:00 a 16:00."* Un día entero sin franjas,
en modo excepción, es el "los domingos no atendemos" que en lista blanca pedía
marcar los otros seis.

Lo único que el modo excepción no puede guardar es una excepción que abarque la
semana entera: eso no es un horario, es apagar el agente, y para eso está el
interruptor del canal —que además lo deja dicho en la tarjeta en vez de esconder
"no contesta nunca" adentro de un horario que parece configurado—. Si una fila así
igual aparece cargada a mano, se lee como que no excluye nada: una fila mal
cargada nunca deja al agente prendido y mudo.

**El aviso fuera de horario.** Opcional y vacío por defecto, que es apagado: sin
texto, fuera de horario no sale nada y el mensaje espera en la bandeja. Se ofrece
porque del otro lado el silencio no se distingue de un número que no existe, y
quien no sabe si lo leyeron escribe de nuevo, o se va a la competencia.

Es un **texto fijo** y no una respuesta del modelo a propósito: fuera de horario
lo único honesto que se puede decir es cuándo se atiende, y un modelo suelto a
esa hora vuelve a prometer reuniones de gente que no está, ahora con el
agravante de que nadie va a leer ese chat hasta la mañana. Además cuesta tokens
para decir una sola frase.

Sale **una vez por charla**: antes de mandarlo se mira cuál fue el último mensaje
que el contacto recibió de este lado, y si ya es el aviso no se repite. Las notas
internas —las que empiezan con ⚙️, que nunca se enviaron— se saltean en esa
cuenta. La ráfaga la agrupa la misma espera que agrupa las respuestas: sin ella,
tres mensajes sueltos de las 3 AM entran por tres webhooks que no se ven entre sí
y el lead se come tres avisos iguales. Si alguien le contesta después, la charla
siguió y la próxima madrugada el aviso vuelve a corresponder.

La comparación es de texto porque el aviso se le envía al contacto y no puede
llevar una marca adentro —ése es el truco del ⚙️, que funciona justamente porque
esas notas no se envían—. El costo es que cambiar el texto puede dejar salir uno
de más en los chats que tenían el viejo: una vez por chat, y nunca diciendo algo
falso. Si la consulta al hilo falla, no se manda: un aviso que no sale deja al
lead como estaba, y dos seguidos lo hacen parecer roto.

El aviso va después de los dos recortes que deciden si al agente le toca ese lead
—las instrucciones del canal y los embudos—. Un canal mudo o un embudo ajeno
significan "este agente no habla con esta persona", y un "te contestamos a las 9"
ahí sería prometer en nombre de nadie.

Una franja **no puede cruzar la medianoche**: el que atiende de 18 a 2 corta a las
24:00 y sigue con otra franja desde las 00:00, que es lo que ese día realmente es.
El panel lo dice al intentarlo, pero las filas cargadas a mano en Supabase se leen
con la interpretación segura —una franja invertida se descarta, y sin franjas se
contesta a toda hora—, igual que un día de la semana que no existe o ningún día
marcado, que se lee como todos. La otra lectura deja al agente prendido y mudo,
que es la falla más difícil de notar.

Lo que queda afuera a propósito: **las franjas son las mismas todos los días
marcados**. Un sábado que abre sólo a la mañana pide horas por día, que es otra
pantalla y otra forma de guardarlo; mientras no aparezca, se resuelve dejando el
sábado sin marcar o apagando el agente a mano.

**Frenar la IA si escribe una persona.** Opcional y apagado por defecto. Con la
opción prendida, apenas alguien del equipo manda un mensaje en el chat se apaga
la IA de ese contacto, y queda apagada hasta que alguien la vuelva a prender
desde la ficha del lead. El interruptor ya existía, pero había que acordarse de
tocarlo *antes* de escribir, que es justo cuando nadie se acuerda: el vendedor
entra a la conversación y el agente le contesta encima al lead con otra voz.

No la disparan ni las automatizaciones ni las difusiones, aunque sus mensajes
también se guarden como salientes: un follow-up automático no es alguien tomando
la charla.

Reactivar sola —a las N horas, o al mover la tarjeta— quedó descartado: devolver
al agente en medio de una negociación que alguien está llevando es peor que
tener que prenderlo a mano.

## Cómo entra un mensaje de Zernio

| Paso | Qué hace |
|---|---|
| Firma | HMAC-SHA256 del cuerpo crudo, en hex, leída de `X-Zernio-Signature` (o el heredado `X-Late-Signature`) y comparada en tiempo constante. |
| Workspace | Se resuelve por `account.id` contra `zernio_accounts`. Si la cuenta no está mapeada y existe un único workspace, se asocia sola. |
| Contacto | Se busca primero por su identidad de canal (`contact_identities`), después por teléfono, y recién ahí se crea. |
| Conversación | Se identifica por `zernio_chat_id`, único por workspace. |
| Mensaje | Se guarda con `zernio_message_id`, que es único: los reintentos de Zernio no duplican nada. |
| Oportunidad | Todo contacto nuevo entra por la primera columna del primer embudo, venga del chat o cargado a mano. |

Los tres canales caen en la misma bandeja, el mismo embudo y la misma lista de
contactos: el canal es un atributo de la conversación, no un CRM aparte. En
WhatsApp el teléfono alcanza para reconocer a alguien; en Instagram y Messenger
no hay teléfono, así que la identidad del remitente se guarda en
`contact_identities` para que el segundo mensaje no cree un contacto duplicado.

### Importar el historial

El botón **Importar de Zernio** de la bandeja trae por API las conversaciones
que Zernio ya tiene, con sus contactos, mensajes y tarjetas del embudo. Sirve
para cargar el historial previo a la conexión y para ponerse al día si el
webhook estuvo caído. Es idempotente: `zernio_chat_id` y `zernio_message_id`
son únicos, así que correrla dos veces no duplica nada.

### Diagnóstico

`GET /api/webhooks/zernio` informa qué variables de entorno están cargadas, si
existen las tablas y cuándo llegó el último mensaje. Solo devuelve booleanos y
conteos, nunca secretos.

`GET /api/zernio/check` —con sesión abierta— pregunta del otro lado: qué
conversaciones tiene Zernio y con qué cuentas. Compara además esas cuentas
contra las que el CRM guardó, y lista en `cuentas_vencidas` las que ya no
existen del lado de Zernio.

Las plataformas que el CRM no modela (Telegram, X, Bluesky, Reddit) se descartan con 200 para que Zernio no reintente.

### Cuando Zernio rechaza un envío con 403

Zernio usa el mismo 403 para cosas distintas, así que **el motivo está en el
cuerpo de su respuesta, no en el código**. El CRM lo cita textual en el error
que muestra la bandeja (`Zernio dijo: "…"`): esa frase es el diagnóstico, no un
adorno.

**`"This message is sent outside of allowed window."`** — Es la ventana de
mensajería de Meta: Instagram, Messenger y WhatsApp solo permiten responder
dentro de las 24 horas del último mensaje del contacto. No hay nada que
arreglar, ni en el CRM ni en Zernio; el chat se destraba cuando la persona
vuelve a escribir. En WhatsApp oficial este caso se cubre con una plantilla
aprobada, que Instagram y Messenger no tienen.

Este error no debería llegar a verse: arriba del campo de texto, la bandeja
avisa cuánto hace que no escribe el contacto y, cuando la ventana ya se cerró,
lo dice con todas las letras antes de que alguien escriba. El aviso corre en los
tres canales —la regla es de Meta, no de WhatsApp— y vive en
`src/lib/ventana-meta.ts`.

**Cualquier otro motivo** se trata como un problema de la cuenta por la que
sale el mensaje. Para responder hay que decirle a Zernio por qué cuenta, y el
CRM manda la que guardó cuando entró la conversación; si el perfil se
desconectó y se volvió a conectar en Zernio, esa cuenta quedó con un id nuevo y
los hilos viejos apuntan al anterior. Se arregla solo: el envío que falla le
pregunta a Zernio cuál es la cuenta de esa conversación, la guarda y reintenta
una vez. Si no había id viejo que arreglar, el error lo dice:

- **"Zernio sigue reportando esta misma cuenta"**: el id es correcto y a la key
  le falta permiso sobre ella.
- **"Zernio no lista esta conversación entre las suyas"**: la `ZERNIO_API_KEY`
  es de otro perfil de Zernio. Hay que generarla desde **API Keys** en el
  perfil donde están conectadas las cuentas.

`/api/zernio/check` muestra el cuadro completo: `cuentas_detectadas` son las que
reconoce la API key y `cuentas_vencidas` las que el CRM guarda y Zernio ya no.

La traducción de estos errores se prueba en `pruebas/zernio-errores.test.mts`,
con los cuerpos que Zernio devuelve de verdad.

## Tareas

Cada integrante del equipo **programa lo que tiene que hacer**: "llamar a Juan
mañana a las 10", "mandar la propuesta el jueves". El CRM le avisa a la hora y
le muestra lo pendiente en el menú, en el Resumen y en la ficha de cada lead.

Requiere correr `supabase/migrations/202610070001_tareas.sql` en el SQL Editor de
Supabase. Hasta que se corre, la sección avisa que falta y el resto del CRM anda
igual.

Una tarea tiene título, tipo (llamada, mensaje, seguimiento, reunión u otro),
fecha y hora, a quién le toca, un aviso y, si corresponde, el lead. El lead es
opcional: "preparar el reporte del mes" también es una tarea.

Se cargan desde cuatro lugares, y todas terminan en la misma sección **Tareas**:

- **Tareas**, con el botón **Nueva tarea**. El lead se elige con un buscador:
  se escribe parte del nombre, el teléfono o el mail y busca en toda la base,
  no sólo en los contactos que ya están en pantalla.
- **La tarjeta del lead en el embudo**, con **+ Tarea**. Si tenés una tarea
  pendiente con ese lead, la tarjeta muestra para cuándo es (en rojo si está
  vencida), y tocándola se va a Tareas.
- **La ficha del lead**, con el botón de agregar tarea del encabezado, que se ve
  desde cualquier pestaña, o desde la pestaña **Tareas** de la ficha. Es donde
  más se usan: se está hablando con alguien, queda algo pendiente y se anota
  ahí mismo.
- **La columna del lead en Conversaciones**, al lado del chat, con **+ Tarea**
  arriba o desde su sección de tareas (el ícono de la lista).

### Quién ve y quién toca qué

| Quién | Puede |
|---|---|
| Cualquiera del equipo | Programarse tareas a sí mismo, sin ningún permiso. |
| Con **Darle tareas a otros** | Asignarle una tarea a un compañero. Ve las que dio en "Que di". |
| Con **Ver las tareas del equipo** | Ver lo que tiene pendiente cada uno, salvo las de leads que no ve. |
| Administrador | Todo, por rol. |

Una tarea la editan quien la tiene, quien la creó o un administrador. La borran
sólo quien la creó o un administrador; quien la recibió la puede **cancelar**,
que deja anotado que no se hizo.

Una tarea sobre un lead sólo se le puede dar a alguien que ve ese lead: una
tarea sobre un cliente que no podés abrir es una tarea que no podés hacer.

Todo esto lo controla la base —las políticas RLS y la guarda `guard_tarea`—, no
la pantalla, igual que el resto de los permisos.

### Los avisos

- **A la hora que se elija:** a la hora, 15 minutos antes, 1 hora antes, 1 día
  antes o sin aviso. Sale como push a los dispositivos de quien tiene la tarea,
  por el mismo canal que las derivaciones, así que hace falta tener los avisos
  activados en la campana.
- **Al recibir una tarea de otra persona:** sale en el momento, y además la
  tarea aparece en la campana hasta que se entra a Tareas.

Los avisos a la hora los manda un cron: `GET` o `POST /api/cron/tareas`,
autenticado con `CRON_SECRET` en `Authorization: Bearer` o en `?token=`. Lo
puede llamar el cron de Vercel, `pg_cron` de Supabase o cualquier servicio que
pegue a una URL cada cinco minutos. Si el cron corre cada cinco minutos, el aviso puede llegar hasta
cinco minutos después. Si el reloj estuvo parado más de seis horas, los avisos
viejos se descartan en vez de llegar todos juntos.

Cargar una tarea para una hora que ya pasó no manda aviso: se está anotando algo
atrasado a sabiendas.

## Resumen

La pantalla de entrada es **un tablero y nada más**: ocho métricas, la actividad
de la semana, por dónde llegan los leads, las próximas citas y las
conversaciones recientes. No tiene
acciones. El "Nuevo contacto" que estaba arriba se fue a Contactos, que es donde
se lo busca, y además era el único alta que no pasaba por el permiso de crear
contactos: un operario sin ese permiso veía un botón que la base le iba a
rechazar.

Requiere correr `supabase/migrations/202608210002_metricas_resumen.sql` en el
SQL Editor de Supabase. Si no está corrida el tablero no se rompe —cae a lo que
puede contar con las filas que ya trae—, pero las métricas nuevas van en cero.

### Las tarjetas

| Métrica | Qué dice |
|---|---|
| **Contactos** | Activos del workspace, sin archivados. |
| **Leads nuevos** | Los que entraron este mes. |
| **Valor del embudo** | Suma de las oportunidades en columnas abiertas. |
| **Ganado este mes** | Lo cerrado con éxito **este mes**, según el historial de etapas. |
| **Tasa de conversión** | Ganadas sobre cerradas, acumulado desde siempre. |
| **Sin responder** | Chats abiertos donde la última palabra la tiene el contacto. |
| **Peor lapso de réplica** | La espera más larga que alguien aguantó este mes. |
| **Derivaciones** | Chats donde la IA pidió que siga una persona. |

### Por qué las cuentas bajaron a Postgres

Las métricas se calculaban en la aplicación sobre las filas que ya estaban
traídas para pintar las otras secciones, y esas filas vienen paginadas.
"Contactos" hacía `contacts.length` sobre una consulta con `limit(200)`: del
contacto 201 en adelante el número se congelaba y nadie se enteraba. Lo mismo
con los no leídos, que sumaban sobre las 50 conversaciones más recientes.

Ahora hay una función, `metricas_resumen`, que devuelve una fila con todos los
totales en una sola ida. Es `security invoker`: corre con las políticas de quien
la llama, así que un operario que sólo ve sus leads ve las métricas de sus
leads. Los cortes de tiempo se calculan en la aplicación, que es la que conoce
la zona horaria del workspace.

### El lapso de réplica

Mide **cuánto esperó la persona del otro lado**: del primer mensaje suyo sin
contestar hasta el primero que sale. Si escribió cinco veces seguidas, el reloj
arranca en el primero. Contesta la IA o contesta un humano: para quien espera es
lo mismo, y eso es lo que la métrica cuenta.

El titular es la **peor** espera del mes y no el promedio, porque un promedio de
cuatro minutos con alguien esperando dos días sigue diciendo que todo está bien.
La mediana va en la bajada, que es la que cuenta cómo se atiende habitualmente.

### El historial de etapas

`opportunity_stage_events` guarda una fila por cada vez que una oportunidad
cambia de columna. Existe porque "Ganado este mes" se apoyaba en
`opportunities.updated_at`, que un trigger pisa en *cualquier* update: tocarle el
valor a una oportunidad cerrada en junio la volvía a contar como ganada hoy.

Al correr la migración se siembra un evento por oportunidad con su etapa actual
y su `updated_at`. Es una aproximación —de lo viejo no hay más información que
esa— y alcanza para que el tablero no arranque en cero. De ahí en adelante el
historial es exacto.

### Contra qué se compara

Las tarjetas con flecha comparan contra **el mismo tramo del mes pasado**: si
hoy es 21, contra el 1 al 21 del mes anterior. Comparar veintiún días contra
treinta y uno haría ver un derrumbe donde lo único que pasó es que el mes va por
la mitad. El color no lo decide la flecha sino si el movimiento es bueno: más
leads es verde, más demora en contestar es rojo.

### Por dónde llegan los leads

Una torta con el canal de entrada de cada lead: **WhatsApp**, **Instagram**,
**Messenger**, **Reserva en Calendar**, **Chat de la web** y **Carga manual**.
Arranca en el mes —y suma lo mismo que la tarjeta "Leads nuevos"— y tiene un
botón para ver el **histórico** de los contactos activos. La elección se
recuerda en el navegador.

Requiere correr `supabase/migrations/202610080001_leads_por_canal.sql` en el
SQL Editor de Supabase. Sin ella la tarjeta lo avisa y el resto del tablero
sigue igual: no hay cuenta aproximada a la que caer, porque contar sobre las
filas paginadas daría una torta que parece cierta y no lo es.

Ningún alta anota de dónde vino el contacto, así que la función
`leads_por_canal` lo deduce de lo que dejó cada una. Por eso también cuenta lo
que entró antes de la migración. Mira, en este orden:

| Si… | Cuenta como |
|---|---|
| El primer mensaje lo mandó la persona y es anterior al alta: el chat la dio de alta | El canal de ese chat |
| Tiene la etiqueta `web` | Chat de la web |
| Tiene una cita de Calendar creada junto con el alta | Reserva en Calendar |
| La persona escribió en los dos minutos siguientes al alta (relojes del proveedor) | El canal de ese chat |
| Cualquier otro caso: alta a mano, importación, o un chat que abrió el equipo | Carga manual |

Si escribió por varios canales cuenta el primero. La web va antes que la regla
de los dos minutos porque la landing tiene un "Seguir por WhatsApp": quien lo
toca escribe enseguida, pero llegó por la web. Y la comparación con el alta es
la que evita contar como de WhatsApp a alguien importado en marzo que contestó
una difusión en junio.

## Base de datos

Una sección propia en el menú, sólo para administradores, con un botón por
tabla: contactos, oportunidades del embudo, conversaciones, mensajes y turnos.

Empezó como una tarjeta adentro de Configuración y no servía: nadie busca
"descargar la base" en la misma pantalla donde se elige la zona horaria. Sale un CSV por tabla y no un archivo con
todo junto porque el CSV es una grilla: mezclar chats con turnos obliga a
inventar columnas vacías para tres cuartas partes de cada fila.

La base entera —con teléfonos, mails y el historial de los
chats— es el activo del negocio, y un operario con la sesión abierta no tiene
por qué poder llevársela en un archivo. Tampoco hay un link público: un link se
comparte por WhatsApp sin pensarlo, y del otro lado no hay sesión que revisar.
El archivo se arma en el servidor y lo baja el navegador.

Tres detalles del formato, que son la diferencia entre un archivo que se abre y
uno que hay que pelear:

- **Separador punto y coma.** Excel no lee el separador del archivo sino la
  configuración regional de quien lo abre, y en español es `;`. Con comas, el
  doble clic deja todo en una sola columna.
- **BOM al principio**, o los acentos y las eñes salen rotos.
- **Las celdas que parecen fórmula se neutralizan.** El nombre de un contacto lo
  escribe el contacto: llega de WhatsApp tal cual lo puso él, y una celda que
  empieza con `=` no es texto para Excel.

Las fechas van en la zona del workspace y los ids ya resueltos a nombres: es una
exportación para trabajar, no un respaldo del motor. El tope es 20.000 filas por
archivo, y cuando se recorta el aviso lo dice.

### Cargar contactos

En la misma sección, desde un CSV: el que baja de acá o uno exportado de otra
herramienta. El archivo se lee **en el navegador** —no se sube a ningún lado—, y
al servidor viajan las filas ya limpias.

Las columnas se buscan por nombre y no por posición, aceptando cómo las escriben
otras herramientas: `nombre`/`name`/`contacto`, `telefono`/`celular`/`whatsapp`/
`mobile`, `email`/`correo`, `etiquetas`/`tags`. No importa el orden ni los
acentos. Sin ninguna columna de nombre ni de teléfono, el archivo se rechaza
entero en vez de cargar media base corrida.

Antes de confirmar hay una vista previa con las primeras filas, qué columna se
usó para cada dato, cuántas filas se descartaron y —esto lo calcula el
servidor— cuántos contactos son nuevos y cuántos ya están. La cuenta la hace la
misma función que después guarda, así lo que se lee antes de apretar es lo que
va a pasar.

Se elige a qué columna del embudo entran los nuevos, y si los repetidos se
completan o se saltean. Cruzar es por teléfono y por email. Completar no pisa lo
que el CRM ya tenía: llena los huecos y suma las etiquetas nuevas. El CRM es
donde alguien atendió a esa persona y corrigió su nombre; una planilla vieja no
tiene por qué ganarle a eso.

Un límite a propósito: 2000 contactos por archivo.

## Estado actual

**Funcionando contra la base:** autenticación restringida a usuarios dados de alta en Supabase, creación de workspace, alta de contactos como leads, pipeline y agenda editables, archivado de contactos, el webhook de Zernio recibiendo mensajes y la respuesta desde el chat.

El chat y la bandeja se actualizan solos por Realtime: un mensaje que entra por
el webhook aparece sin recargar. Realtime respeta RLS, así que el navegador
solo recibe filas del workspace del usuario.

La **tarjeta de lead** es la unidad de trabajo, al estilo Kommo: se abre desde
el embudo, la bandeja, los contactos o el resumen, y trae la ficha, la etapa,
el chat y la agenda de esa persona en un solo panel.

El **panel de agentes de IA** guarda modelo, demora, horario, aviso fuera de
horario y herramientas por canal en `ai_agent_configs`, y muestra en solo lectura las instrucciones, que vienen del
código (`src/lib/prompts-agentes.ts`). Desde cualquier chat se puede pedir una
respuesta sugerida, que usa esas instrucciones y llega a la caja de texto para
revisarla antes de enviarla.

### La API key de OpenAI

Cada usuario carga la suya en **Configuración**. Se guarda en el `localStorage`
de su navegador y viaja directo a OpenAI: no pasa por este servidor ni por la
base. La lista de modelos se pide a la cuenta del usuario en vez de venir
hardcodeada, así no se puede elegir uno que su key no tenga.

La contrapartida es el alcance: una key en el navegador solo existe mientras
hay una pestaña abierta, así que sirve para **sugerir** respuestas a pedido.
Para que un agente conteste **solo** al entrar un mensaje haría falta una key
del lado del servidor, porque el webhook corre sin navegador.

**Pendiente:** respuesta automática de los agentes (requiere una key de
servidor).

## Scripts

```bash
npm run dev     # desarrollo
npm run build   # build de producción
npm run lint    # eslint
```
