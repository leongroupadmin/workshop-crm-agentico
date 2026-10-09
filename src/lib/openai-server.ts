import "server-only";

import { razonaAntesDeEscribir, TECHO_RESPUESTA, techoDelModelo } from "@/lib/modelos-ia";

/**
 * Cliente de OpenAI. Es el único: la key vive en `OPENAI_API_KEY` y nunca sale
 * del servidor.
 *
 * Hubo un momento en que cada usuario cargaba la suya en el navegador, pero eso
 * dejaba dos keys en dos lugares y ninguna servía para lo mismo: el webhook
 * corre sin pestaña abierta y no podía leer la del navegador. Con una sola, la
 * respuesta automática y la sugerida usan el mismo camino.
 */

const BASE_URL = "https://api.openai.com/v1";

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export type CompletionResult = { ok: true; text: string } | { ok: false; error: string };

/** Cómo salió un pedido al modelo, antes de decidir si vale reintentar. */
type Intento =
  | { estado: "ok"; texto: string }
  | { estado: "vacio"; finishReason: string }
  | { estado: "error"; error: string; rechazoElEsfuerzo?: boolean };

/** Cuánto se le deja pensar. `null` es no mandar el parámetro. */
type Esfuerzo = "minimal" | "low" | null;

/** Un pedido al modelo, sin política de reintento: eso lo decide quien llama. */
async function pedirChat(
  apiKey: string,
  input: { model: string; messages: ChatTurn[]; techo: number; esfuerzo: Esfuerzo },
): Promise<Intento> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        max_completion_tokens: input.techo,
        ...(input.esfuerzo ? { reasoning_effort: input.esfuerzo } : {}),
      }),
    });
  } catch (error) {
    console.error("[ia] no se pudo alcanzar OpenAI:", error);
    return { estado: "error", error: "No se pudo conectar con OpenAI." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      estado: "error",
      error: `OpenAI devolvió ${response.status}. ${detail.slice(0, 200)}`.trim(),
      // Un 400 que nombra el parámetro es el modelo diciendo que no razona.
      rechazoElEsfuerzo:
        Boolean(input.esfuerzo) && response.status === 400 && detail.includes("reasoning_effort"),
    };
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  } | null;

  const choice = body?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    return { estado: "vacio", finishReason: String(choice?.finish_reason ?? "desconocido") };
  }

  return { estado: "ok", texto: content.trim() };
}

/**
 * Le pide una respuesta al modelo, con dos redes abajo.
 *
 * La primera es el techo: un razonador descuenta de él lo que piensa, así que
 * se le da más margen que a uno que escribe directo (ver `modelos-ia.ts`).
 *
 * La segunda es el reintento. Son dos casos distintos y los dos terminaban en
 * silencio:
 *
 * - Le erramos a la familia del modelo y rechaza `reasoning_effort`. Se repite
 *   el pedido sin el parámetro: la lista de modelos la arma la cuenta del
 *   usuario y no vale quedarse mudo porque apareció un nombre que no conocemos.
 * - Se quedó sin presupuesto antes de escribir una palabra (`length` con el
 *   texto vacío). Se repite con el doble de techo y pensando lo mínimo: una
 *   respuesta más llana es infinitamente mejor que ninguna.
 *
 * Un reintento, no más: si con el doble tampoco entra, el problema es otro y
 * hay que verlo, no seguir gastando.
 */
export async function completeChatServer(input: {
  model: string;
  messages: ChatTurn[];
}): Promise<CompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable OPENAI_API_KEY en el entorno." };

  const razona = razonaAntesDeEscribir(input.model);
  const techo = techoDelModelo(input.model);
  const pedido = { model: input.model, messages: input.messages };

  let intento = await pedirChat(apiKey, { ...pedido, techo, esfuerzo: razona ? "low" : null });

  if (intento.estado === "error" && intento.rechazoElEsfuerzo) {
    console.warn("[ia] el modelo no acepta reasoning_effort: se reintenta sin pedirlo");
    intento = await pedirChat(apiKey, { ...pedido, techo, esfuerzo: null });
  }

  if (intento.estado === "vacio" && intento.finishReason === "length") {
    console.warn("[ia] el modelo gastó el techo pensando: se reintenta con más margen");
    intento = await pedirChat(apiKey, {
      ...pedido,
      techo: techo * 2,
      esfuerzo: razona ? "minimal" : null,
    });
  }

  if (intento.estado === "ok") return { ok: true, text: intento.texto };
  if (intento.estado === "error") return { ok: false, error: intento.error };

  return {
    ok: false,
    error: `El modelo no devolvió texto (finish_reason: ${intento.finishReason}).`,
  };
}

/**
 * Una herramienta que el modelo puede pedir que se ejecute.
 *
 * `parametros` es JSON Schema, que es lo que espera la API. Se escribe a mano y
 * no se genera de un tipo: lo que el modelo lee son las descripciones, y ésas
 * hay que redactarlas para que entienda cuándo usar cada una.
 */
export type Herramienta = {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
};

/** Lo que el modelo pidió ejecutar, ya con los argumentos parseados. */
export type Llamada = { id: string; nombre: string; argumentos: Record<string, unknown> };

/**
 * Cuántas veces se le deja pedir herramientas antes de exigirle una respuesta.
 *
 * Una pregunta normal usa una o dos. El tope está para el caso en que el modelo
 * entra en loop pidiendo lo mismo: sin esto, una sola pregunta podría costar
 * veinte llamadas a la API.
 */
const MAX_VUELTAS = 4;

type MensajeApi = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

/**
 * Conversación con herramientas: el modelo pide datos y después contesta.
 *
 * El bucle es el corazón del asistente. El modelo no consulta nada por su
 * cuenta —no puede— sino que devuelve qué herramienta quiere y con qué
 * argumentos; acá se ejecuta, se le devuelve el resultado como un mensaje más,
 * y se le vuelve a preguntar. Termina cuando contesta con texto en lugar de
 * pedir otra herramienta.
 *
 * `ejecutar` la provee quien llama, y es ahí donde viven los permisos: este
 * archivo no sabe qué es un lead ni tiene con qué mirar la base.
 */
export async function completeWithToolsServer(input: {
  model: string;
  messages: ChatTurn[];
  herramientas: Herramienta[];
  ejecutar: (llamada: Llamada) => Promise<unknown>;
}): Promise<CompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable OPENAI_API_KEY en el entorno." };

  const tools = input.herramientas.map((item) => ({
    type: "function" as const,
    function: {
      name: item.nombre,
      description: item.descripcion,
      parameters: item.parametros,
    },
  }));

  const historia: MensajeApi[] = input.messages.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  for (let vuelta = 0; vuelta <= MAX_VUELTAS; vuelta += 1) {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: historia,
          max_completion_tokens: TECHO_RESPUESTA,
          // En la última vuelta se le sacan las herramientas: es la forma de
          // exigirle que conteste con lo que ya tiene en vez de seguir pidiendo.
          ...(vuelta < MAX_VUELTAS ? { tools } : {}),
        }),
      });
    } catch (error) {
      console.error("[asistente] no se pudo alcanzar OpenAI:", error);
      return { ok: false, error: "No se pudo conectar con OpenAI." };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: `OpenAI devolvió ${response.status}. ${detail.slice(0, 200)}`.trim(),
      };
    }

    const body = (await response.json().catch(() => null)) as {
      choices?: { message?: MensajeApi }[];
    } | null;

    const message = body?.choices?.[0]?.message;
    if (!message) return { ok: false, error: "El modelo no devolvió ninguna respuesta." };

    const pedidos = message.tool_calls ?? [];

    if (pedidos.length === 0) {
      const texto = typeof message.content === "string" ? message.content.trim() : "";
      if (!texto) return { ok: false, error: "El modelo no devolvió texto." };
      return { ok: true, text: texto };
    }

    // El mensaje del modelo tiene que volver tal cual antes de los resultados:
    // la API rechaza un `tool` que no sigue al `assistant` que lo pidió.
    historia.push(message);

    // En paralelo porque son lecturas independientes: preguntar por las
    // métricas y por los pendientes a la vez es una sola espera y no dos.
    const resultados = await Promise.all(
      pedidos.map(async (pedido) => {
        const argumentos = parsearArgumentos(pedido.function.arguments);
        try {
          const salida = await input.ejecutar({
            id: pedido.id,
            nombre: pedido.function.name,
            argumentos,
          });
          return { id: pedido.id, salida };
        } catch (error) {
          // El error vuelve como resultado y no corta la conversación: el
          // modelo puede decir qué falló, o resolverlo con otra herramienta.
          console.error(`[asistente] falló ${pedido.function.name}:`, error);
          return { id: pedido.id, salida: { error: "No se pudo consultar ese dato." } };
        }
      }),
    );

    for (const resultado of resultados) {
      historia.push({
        role: "tool",
        tool_call_id: resultado.id,
        content: JSON.stringify(resultado.salida ?? null),
      });
    }
  }

  return { ok: false, error: "El asistente se quedó dando vueltas sin llegar a una respuesta." };
}

/** Los argumentos vienen como string y el modelo a veces manda JSON roto. */
function parsearArgumentos(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whisper acepta ogg/opus, que es lo que manda WhatsApp. */
const TRANSCRIPTION_MODEL = "whisper-1";

/** Techo para no descargar un archivo enorme desde una URL que no controlamos. */
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

/**
 * Modelo con visión para describir imágenes.
 *
 * Va fijo y no toma el del agente a propósito: el modelo del agente lo elige el
 * usuario de una lista y podría no tener visión, y entonces cada foto que
 * entrara rompería en silencio.
 */
const VISION_MODEL = "gpt-4o-mini";

/**
 * Baja un adjunto de Zernio.
 *
 * La URL la manda Zernio y no sabemos si pide autenticación, así que se prueba
 * primero sin credenciales y sólo si rebota se reintenta con la API key.
 */
async function downloadMedia(
  url: string,
): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  let media: Response;
  try {
    media = await fetch(url);
    if ((media.status === 401 || media.status === 403) && process.env.ZERNIO_API_KEY) {
      media = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
      });
    }
  } catch (error) {
    console.error("[ia] no se pudo descargar el adjunto:", error);
    return { ok: false, error: "No se pudo descargar el adjunto." };
  }

  if (!media.ok) return { ok: false, error: `El adjunto devolvió ${media.status}.` };

  const bytes = await media.arrayBuffer().catch(() => null);
  if (!bytes) return { ok: false, error: "No se pudo leer el adjunto." };
  if (bytes.byteLength > MAX_MEDIA_BYTES) return { ok: false, error: "El adjunto es demasiado grande." };

  return {
    ok: true,
    bytes,
    contentType: media.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * Transcribe un audio a texto.
 *
 * Nunca lanza: un audio que no se puede transcribir no debe tumbar el webhook.
 */
export async function transcribeAudio(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable OPENAI_API_KEY en el entorno." };

  const downloaded = await downloadMedia(url);
  if (!downloaded.ok) return downloaded;

  // OpenAI deduce el formato por la extensión del nombre, no por el
  // content-type, así que se rescata de la URL y se cae a ogg (WhatsApp).
  const guessed = new URL(url).pathname.split("/").pop() ?? "";
  const filename = /\.[a-z0-9]{2,4}$/i.test(guessed) ? guessed : "audio.ogg";

  const form = new FormData();
  form.append("file", new Blob([downloaded.bytes]), filename);
  form.append("model", TRANSCRIPTION_MODEL);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    console.error("[ia] no se pudo alcanzar OpenAI:", error);
    return { ok: false, error: "No se pudo conectar con OpenAI." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: `OpenAI devolvió ${response.status}. ${detail.slice(0, 200)}`.trim() };
  }

  const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) return { ok: false, error: "La transcripción vino vacía." };
  return { ok: true, text };
}

/**
 * Describe una imagen en texto.
 *
 * La imagen se manda embebida en base64 en vez de pasarle la URL a OpenAI: la
 * de Zernio puede pedir autenticación, y en ese caso OpenAI no podría abrirla.
 */
export async function describeImage(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable OPENAI_API_KEY en el entorno." };

  const downloaded = await downloadMedia(url);
  if (!downloaded.ok) return downloaded;

  const base64 = Buffer.from(downloaded.bytes).toString("base64");
  const mime = downloaded.contentType.startsWith("image/") ? downloaded.contentType : "image/jpeg";

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Describí esta imagen en español rioplatense, en dos o tres oraciones. " +
                  "Es una foto que un cliente le mandó a una empresa por chat: mencioná qué se " +
                  "ve y, si hay texto o números legibles, transcribilos.",
              },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        max_completion_tokens: TECHO_RESPUESTA,
      }),
    });
  } catch (error) {
    console.error("[ia] no se pudo alcanzar OpenAI:", error);
    return { ok: false, error: "No se pudo conectar con OpenAI." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: `OpenAI devolvió ${response.status}. ${detail.slice(0, 200)}`.trim() };
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;

  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "El modelo no devolvió una descripción." };
  }

  return { ok: true, text: text.trim() };
}

/** Modelos que no sirven para chatear, aunque el endpoint los liste. */
const NOT_CHAT = /audio|realtime|image|tts|whisper|embedding|moderation|transcribe|search-preview/;

/**
 * Modelos de chat disponibles en la cuenta.
 *
 * Se consultan en vivo en lugar de mantener una lista fija en el código: así el
 * desplegable nunca ofrece un modelo que la cuenta no tiene, ni se queda viejo
 * cuando OpenAI publica uno nuevo.
 */
export async function listChatModelsServer(): Promise<
  { ok: true; models: string[] } | { ok: false; error: string }
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Falta la variable OPENAI_API_KEY en el entorno." };

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "No se pudo conectar con OpenAI." };
  }

  if (!response.ok) {
    return { ok: false, error: `OpenAI devolvió ${response.status}.` };
  }

  const body = (await response.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;

  const models = (body?.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string")
    .filter((id) => /^(gpt|o\d)/.test(id) && !NOT_CHAT.test(id))
    .sort();

  return { ok: true, models };
}
