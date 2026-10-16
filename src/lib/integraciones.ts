/**
 * Las conexiones con los proveedores: qué campos pide cada uno y cómo se
 * combina lo guardado en el panel con el entorno.
 *
 * Las credenciales se cargan en Configuración → Conexiones y se guardan
 * cifradas (`cifrado.ts`), así nadie tiene que tocar las variables de Vercel ni
 * volver a desplegar para conectar un canal. El entorno sigue valiendo: lo que
 * no se cargó en el panel se toma de ahí, así que una instalación que ya
 * andaba con variables sigue andando sin tocar nada.
 *
 * Módulo puro: lo usan el servidor y el panel, y lo prueba el runner de Node.
 */

export type Integracion = "openai" | "ycloud" | "zernio";

export const INTEGRACIONES: Integracion[] = ["openai", "ycloud", "zernio"];

export type Campo = {
  clave: string;
  etiqueta: string;
  /** Un secreto nunca vuelve al navegador: el panel sólo sabe si está cargado. */
  secreto: boolean;
  requerido: boolean;
  /** La variable de entorno que lo cubre si no se cargó en el panel. */
  env: string;
  porDefecto?: string;
  placeholder?: string;
  ayuda?: string;
  /** El panel ofrece generar uno al azar: es un secreto que elegimos nosotros. */
  generable?: boolean;
  formato?: "url" | "telefono";
};

/**
 * Un paso de la conexión, con lo que se completa en él justo debajo.
 *
 * El formulario *es* la lista de pasos: cada campo aparece adentro del paso
 * que lo pide, en vez de una explicación arriba y los campos sueltos abajo.
 * Quien la conecta no suele ser quien escribió el código.
 */
export type Paso = {
  /** Una dirección https:// adentro del texto se muestra como link. */
  texto: string;
  /**
   * Lo que va debajo del texto: un campo, por su clave; `"guardar"`, el botón
   * de guardar; o `"url"`, la URL del webhook. Sin esto, el paso se hace afuera
   * del CRM.
   */
  con?: string;
};

export type DefinicionDeIntegracion = {
  integracion: Integracion;
  nombre: string;
  descripcion: string;
  /**
   * En orden. Los campos que ningún paso pide son opcionales y van plegados
   * antes del paso de guardar.
   */
  pasos: Paso[];
  campos: Campo[];
  /** Si recibe eventos, la ruta del webhook. */
  webhook?: {
    ruta: string;
    /** Dónde se pega la URL, para decirlo con su nombre: "Zernio". */
    donde?: string;
  };
};

export const DEFINICIONES: Record<Integracion, DefinicionDeIntegracion> = {
  openai: {
    integracion: "openai",
    nombre: "OpenAI",
    descripcion:
      "La key que pagan los agentes, las respuestas sugeridas, el asistente y la lectura de audios e imágenes.",
    pasos: [
      {
        texto: "Creá una key en https://platform.openai.com/api-keys con Create new secret key y pegala acá.",
        con: "api_key",
      },
      { texto: "Guardá.", con: "guardar" },
      {
        texto: "En https://platform.openai.com/settings/organization/limits poné un tope de gasto por mes: es la única protección real si la key se filtra.",
      },
    ],
    campos: [
      {
        clave: "api_key",
        etiqueta: "API key",
        secreto: true,
        requerido: true,
        env: "OPENAI_API_KEY",
        placeholder: "sk-…",
      },
    ],
  },
  ycloud: {
    integracion: "ycloud",
    nombre: "YCloud (WhatsApp oficial)",
    descripcion: "WhatsApp por la API oficial de Meta, con plantillas aprobadas.",
    pasos: [
      { texto: "Copiá la API key de tu cuenta de YCloud y pegala acá.", con: "api_key" },
      {
        texto: "En YCloud, creá un webhook con esta URL y el evento whatsapp.inbound_message.received.",
        con: "url",
      },
      {
        texto: "YCloud te muestra el secreto del webhook, que empieza con whsec_: copialo entero acá.",
        con: "webhook_secret",
      },
      {
        texto: "Si querés, el número por el que se le escribe primero a un contacto nuevo, en formato internacional.",
        con: "phone_number",
      },
      { texto: "Guardá.", con: "guardar" },
    ],
    campos: [
      { clave: "api_key", etiqueta: "API key", secreto: true, requerido: true, env: "YCLOUD_API_KEY" },
      {
        clave: "webhook_secret",
        etiqueta: "Secreto del webhook",
        secreto: true,
        requerido: true,
        env: "YCLOUD_WEBHOOK_SECRET",
        placeholder: "whsec_…",
      },
      {
        clave: "phone_number",
        etiqueta: "Número de WhatsApp",
        secreto: false,
        requerido: false,
        env: "YCLOUD_PHONE_NUMBER",
        placeholder: "+5491112345678",
        formato: "telefono",
      },
      {
        clave: "base_url",
        etiqueta: "URL de la API",
        secreto: false,
        requerido: false,
        env: "YCLOUD_API_BASE_URL",
        porDefecto: "https://api.ycloud.com/v2",
        formato: "url",
      },
    ],
    webhook: { ruta: "/api/webhooks/ycloud" },
  },
  zernio: {
    integracion: "zernio",
    nombre: "Zernio (WhatsApp, Instagram y Messenger)",
    descripcion: "Los tres canales de Meta a través de la bandeja de Zernio.",
    pasos: [
      {
        texto: "Creá una API key en https://zernio.com/dashboard/api-keys, con permiso de lectura y escritura, y pegala acá.",
        con: "api_key",
      },
      { texto: "Tocá Generar para crear el secreto del webhook.", con: "webhook_secret" },
      { texto: "Guardá.", con: "guardar" },
      { texto: "Copiá esta URL con el botón: ya trae el secreto adentro.", con: "url" },
      {
        texto: "En https://zernio.com/dashboard andá a Settings → Webhooks, creá un webhook, pegá la URL y elegí el evento message.received. Necesita el addon de inbox habilitado.",
      },
    ],
    campos: [
      { clave: "api_key", etiqueta: "API key", secreto: true, requerido: true, env: "ZERNIO_API_KEY" },
      {
        clave: "webhook_secret",
        etiqueta: "Secreto del webhook",
        secreto: true,
        requerido: true,
        env: "ZERNIO_WEBHOOK_SECRET",
        generable: true,
      },
      {
        clave: "base_url",
        etiqueta: "URL de la API",
        secreto: false,
        requerido: false,
        env: "ZERNIO_API_BASE_URL",
        porDefecto: "https://zernio.com/api",
        formato: "url",
      },
    ],
    webhook: { ruta: "/api/webhooks/zernio", donde: "Zernio" },
  },
};

/**
 * La URL del webhook con el secreto adentro, como `?token=`.
 *
 * Todos los webhooks con secreto generable aceptan esa prueba además de la
 * firma, así que con esta URL alcanza: es una sola cosa para copiar y pegar en
 * el proveedor, en vez de una URL y un secreto que hay que cargar por separado
 * y que, si no coinciden byte a byte, dan 401. El secreto viaja en la URL —queda
 * escrito en el panel del proveedor—, que es lo mismo que pasaba al cargarlo en
 * su campo de secreto.
 */
export function urlConSecreto(url: string, secreto: string): string {
  const limpio = secreto.trim();
  if (!limpio) return url;
  const separador = url.includes("?") ? "&" : "?";
  return `${url}${separador}token=${encodeURIComponent(limpio)}`;
}

export type ParteDelPaso = { tipo: "texto"; texto: string } | { tipo: "link"; url: string; texto: string };

/**
 * Un paso cortado en texto y links, para que las direcciones se puedan tocar.
 *
 * El link se muestra sin el `https://`, que no le dice nada a nadie y alarga el
 * renglón. Un punto o una coma pegados al final son de la frase, no de la URL.
 */
export function partesDelPaso(paso: string): ParteDelPaso[] {
  const partes: ParteDelPaso[] = [];
  let desde = 0;
  for (const encontrado of paso.matchAll(/https:\/\/[^\s]+/g)) {
    const url = encontrado[0].replace(/[.,;:]+$/, "");
    const inicio = encontrado.index ?? 0;
    if (inicio > desde) partes.push({ tipo: "texto", texto: paso.slice(desde, inicio) });
    partes.push({ tipo: "link", url, texto: url.replace(/^https:\/\//, "") });
    desde = inicio + url.length;
  }
  if (desde < paso.length) partes.push({ tipo: "texto", texto: paso.slice(desde) });
  return partes;
}

export function esIntegracion(valor: unknown): valor is Integracion {
  return typeof valor === "string" && (INTEGRACIONES as string[]).includes(valor);
}

/** De dónde salió un valor ya combinado. */
export type Origen = "panel" | "entorno" | "por-defecto";

export type Combinadas = {
  valores: Record<string, string>;
  origen: Record<string, Origen>;
  /** Etiquetas de los campos requeridos que quedaron vacíos. */
  faltan: string[];
};

/**
 * Lo guardado en el panel, completado con el entorno.
 *
 * Campo por campo y no todo o nada: así se puede pasar una sola credencial al
 * panel —por ejemplo, rotar la key de OpenAI sin redeploy— y seguir tomando el
 * resto del entorno.
 */
export function combinar(input: {
  definicion: DefinicionDeIntegracion;
  guardados: Record<string, string>;
  entorno: Record<string, string | undefined>;
}): Combinadas {
  const valores: Record<string, string> = {};
  const origen: Record<string, Origen> = {};
  const faltan: string[] = [];

  for (const campo of input.definicion.campos) {
    const guardado = (input.guardados[campo.clave] ?? "").trim();
    const delEntorno = (input.entorno[campo.env] ?? "").trim();

    if (guardado) {
      valores[campo.clave] = guardado;
      origen[campo.clave] = "panel";
    } else if (delEntorno) {
      valores[campo.clave] = delEntorno;
      origen[campo.clave] = "entorno";
    } else if (campo.porDefecto) {
      valores[campo.clave] = campo.porDefecto;
      origen[campo.clave] = "por-defecto";
    } else if (campo.requerido) {
      faltan.push(campo.etiqueta);
    }
  }

  return { valores, origen, faltan };
}

/**
 * Lo que llega del panel, validado y separado en público y secreto.
 *
 * Un secreto que llega vacío quiere decir "dejá el que está": el panel nunca
 * lo recibe, así que no tiene cómo volver a mandarlo. Para borrarlo está
 * desconectar la integración entera.
 */
export function leerFormulario(
  definicion: DefinicionDeIntegracion,
  entrada: Record<string, unknown>,
  secretosPrevios: Record<string, string>,
): { ok: true; config: Record<string, string>; secretos: Record<string, string> } | { ok: false; error: string } {
  const config: Record<string, string> = {};
  const secretos: Record<string, string> = {};

  for (const campo of definicion.campos) {
    const crudo = entrada[campo.clave];
    const valor = typeof crudo === "string" ? crudo.trim() : "";

    if (valor.length > 4000) return { ok: false, error: `${campo.etiqueta}: es demasiado largo.` };

    if (campo.secreto) {
      const final = valor || secretosPrevios[campo.clave] || "";
      if (final) secretos[campo.clave] = final;
      continue;
    }

    if (!valor) continue;

    if (campo.formato === "url" && !/^https?:\/\/[^\s]+$/i.test(valor)) {
      return { ok: false, error: `${campo.etiqueta}: tiene que empezar con http:// o https://.` };
    }
    if (campo.formato === "telefono" && !/^\+\d{8,15}$/.test(valor.replace(/[\s-]/g, ""))) {
      return { ok: false, error: `${campo.etiqueta}: escribilo en formato internacional, por ejemplo +5491112345678.` };
    }

    config[campo.clave] =
      campo.formato === "url"
        ? valor.replace(/\/+$/, "")
        : campo.formato === "telefono"
          ? valor.replace(/[\s-]/g, "")
          : valor;
  }

  return { ok: true, config, secretos };
}

/** Cómo se ve un campo en el panel: los secretos, sólo si están cargados. */
export type CampoVisible = {
  clave: string;
  /** Sólo para campos que no son secretos. */
  valor: string | null;
  cargado: boolean;
  origen: Origen | null;
};

export function vistaDeLosCampos(
  definicion: DefinicionDeIntegracion,
  combinadas: Combinadas,
): CampoVisible[] {
  return definicion.campos.map((campo) => {
    const origen = combinadas.origen[campo.clave] ?? null;
    return {
      clave: campo.clave,
      // El valor por defecto no se muestra como si lo hubiera escrito alguien:
      // se ve en el placeholder.
      valor: campo.secreto || origen === "por-defecto" ? null : combinadas.valores[campo.clave] ?? null,
      cargado: Boolean(combinadas.valores[campo.clave]) && origen !== "por-defecto",
      origen,
    };
  });
}
