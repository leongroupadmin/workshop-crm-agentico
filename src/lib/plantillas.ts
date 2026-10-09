/**
 * Plantillas de WhatsApp: lectura, variables y armado del envío.
 *
 * Una plantilla es un texto aprobado por Meta con huecos numerados —`{{1}}`,
 * `{{2}}`— que se completan al enviar. Es la única forma de escribirle a alguien
 * fuera de las 24 horas desde su último mensaje: pasado ese plazo, WhatsApp
 * rechaza cualquier texto libre.
 *
 * El módulo no habla con la red a propósito: recibe lo que devolvió la API y
 * devuelve lo que hay que mandarle. Así se puede probar sin YCloud delante, que
 * es lo que importa cuando la forma exacta del JSON todavía no está confirmada
 * contra la documentación.
 */

export type TipoComponente = "header" | "body" | "footer" | "buttons";

/** Formato del encabezado. `text` lleva variables; el resto lleva un link. */
export type FormatoEncabezado = "text" | "image" | "video" | "document";

export type Componente = {
  tipo: TipoComponente;
  /** Sólo en el encabezado. */
  formato: FormatoEncabezado | null;
  texto: string;
  botones: string[];
};

export type Plantilla = {
  nombre: string;
  /** Código de idioma de Meta: `es`, `es_AR`, `en_US`. */
  idioma: string;
  categoria: string;
  /** Tal como lo devuelve la API, en mayúsculas: `APPROVED`, `REJECTED`… */
  estado: string;
  componentes: Componente[];
};

/** Lo que hay que completar antes de poder enviar. */
export type Faltante =
  | { clase: "variable"; ubicacion: "header" | "body"; numero: number }
  | { clase: "link"; formato: Exclude<FormatoEncabezado, "text"> };

const TIPOS: TipoComponente[] = ["header", "body", "footer", "buttons"];
const FORMATOS: FormatoEncabezado[] = ["text", "image", "video", "document"];

/**
 * Saca la lista de plantillas de la respuesta de la API.
 *
 * Acepta tres envoltorios —`{items}`, `{data}` y el arreglo pelado— porque la
 * forma exacta no está confirmada y equivocarse acá significa una pantalla
 * vacía sin explicación. Lo que no se entiende se descarta en silencio: una
 * plantilla rota no puede tumbar a las demás.
 */
export function normalizarPlantillas(cuerpo: unknown): Plantilla[] {
  const crudas = listaDe(cuerpo);
  return crudas.map(normalizarPlantilla).filter((p): p is Plantilla => p !== null);
}

function listaDe(cuerpo: unknown): unknown[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (!cuerpo || typeof cuerpo !== "object") return [];

  const objeto = cuerpo as Record<string, unknown>;
  for (const clave of ["items", "data", "templates"]) {
    if (Array.isArray(objeto[clave])) return objeto[clave] as unknown[];
  }
  return [];
}

export function normalizarPlantilla(cruda: unknown): Plantilla | null {
  if (!cruda || typeof cruda !== "object") return null;
  const objeto = cruda as Record<string, unknown>;

  const nombre = texto(objeto.name);
  if (!nombre) return null;

  return {
    nombre,
    idioma: texto(objeto.language) || "es",
    categoria: (texto(objeto.category) || "").toUpperCase(),
    estado: (texto(objeto.status) || "").toUpperCase(),
    componentes: (Array.isArray(objeto.components) ? objeto.components : [])
      .map(normalizarComponente)
      .filter((c): c is Componente => c !== null),
  };
}

function normalizarComponente(crudo: unknown): Componente | null {
  if (!crudo || typeof crudo !== "object") return null;
  const objeto = crudo as Record<string, unknown>;

  // Meta manda `HEADER`; algunos clientes lo mandan en minúscula. Se compara
  // siempre en minúscula para no depender de cuál llegó.
  const tipo = TIPOS.find((t) => t === texto(objeto.type).toLowerCase());
  if (!tipo) return null;

  const formato = FORMATOS.find((f) => f === texto(objeto.format).toLowerCase()) ?? null;

  return {
    tipo,
    // Un encabezado sin `format` declarado es de texto: es el valor por
    // omisión de Meta y el caso más común.
    formato: tipo === "header" ? (formato ?? "text") : null,
    texto: texto(objeto.text),
    botones: (Array.isArray(objeto.buttons) ? objeto.buttons : [])
      .map((boton) =>
        boton && typeof boton === "object"
          ? texto((boton as Record<string, unknown>).text)
          : "",
      )
      .filter(Boolean),
  };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

export function componenteDe(plantilla: Plantilla, tipo: TipoComponente): Componente | null {
  return plantilla.componentes.find((c) => c.tipo === tipo) ?? null;
}

/**
 * Números de variable que aparecen en un texto, ordenados y sin repetir.
 *
 * Se ordenan por número y no por aparición porque el orden es el del arreglo de
 * parámetros que espera Meta: el primer parámetro es `{{1}}`, no el que esté
 * más a la izquierda.
 */
export function variablesDe(contenido: string): number[] {
  const encontradas = new Set<number>();
  for (const coincidencia of contenido.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const numero = Number(coincidencia[1]);
    if (Number.isInteger(numero) && numero > 0) encontradas.add(numero);
  }
  return [...encontradas].sort((a, b) => a - b);
}

/** Todo lo que el usuario tiene que completar para poder enviarla. */
export function faltantesDe(plantilla: Plantilla): Faltante[] {
  const faltantes: Faltante[] = [];

  const encabezado = componenteDe(plantilla, "header");
  if (encabezado) {
    if (encabezado.formato === "text") {
      for (const numero of variablesDe(encabezado.texto)) {
        faltantes.push({ clase: "variable", ubicacion: "header", numero });
      }
    } else if (encabezado.formato) {
      faltantes.push({ clase: "link", formato: encabezado.formato });
    }
  }

  const cuerpo = componenteDe(plantilla, "body");
  if (cuerpo) {
    for (const numero of variablesDe(cuerpo.texto)) {
      faltantes.push({ clase: "variable", ubicacion: "body", numero });
    }
  }

  return faltantes;
}

/** Clave con la que viaja cada valor entre el navegador y el servidor. */
export function claveDe(faltante: Faltante): string {
  return faltante.clase === "link" ? "link" : `${faltante.ubicacion}.${faltante.numero}`;
}

export type Valores = Record<string, string>;

export function reemplazarVariables(contenido: string, obtener: (numero: number) => string): string {
  return contenido.replace(/\{\{\s*(\d+)\s*\}\}/g, (original, numero: string) => {
    const valor = obtener(Number(numero));
    return valor || original;
  });
}

/**
 * El mensaje tal como lo va a leer el contacto.
 *
 * Es también lo que se guarda en el historial: en la base queda el texto ya
 * armado y no el nombre de la plantilla, porque quien abre el chat después
 * quiere leer lo que se dijo, no buscarlo en otro lado.
 */
export function vistaPrevia(plantilla: Plantilla, valores: Valores): string {
  const partes: string[] = [];

  const encabezado = componenteDe(plantilla, "header");
  if (encabezado?.formato === "text" && encabezado.texto) {
    partes.push(reemplazarVariables(encabezado.texto, (n) => valores[`header.${n}`] ?? ""));
  }

  const cuerpo = componenteDe(plantilla, "body");
  if (cuerpo?.texto) {
    partes.push(reemplazarVariables(cuerpo.texto, (n) => valores[`body.${n}`] ?? ""));
  }

  const pie = componenteDe(plantilla, "footer");
  if (pie?.texto) partes.push(pie.texto);

  return partes.join("\n\n");
}

export type ComponenteSaliente = {
  type: string;
  parameters: Record<string, unknown>[];
};

/**
 * Arma el arreglo `components` del envío.
 *
 * Sólo lleva los componentes que tienen algo que completar: una plantilla sin
 * variables se manda con `components` vacío, y mandar un componente de más con
 * cero parámetros hace que Meta rechace el mensaje.
 */
export function componentesParaEnviar(plantilla: Plantilla, valores: Valores): ComponenteSaliente[] {
  const salientes: ComponenteSaliente[] = [];

  const encabezado = componenteDe(plantilla, "header");
  if (encabezado) {
    if (encabezado.formato === "text") {
      const numeros = variablesDe(encabezado.texto);
      if (numeros.length > 0) {
        salientes.push({
          type: "header",
          parameters: numeros.map((n) => ({ type: "text", text: valores[`header.${n}`] ?? "" })),
        });
      }
    } else if (encabezado.formato) {
      const link = valores.link ?? "";
      if (link) {
        salientes.push({
          type: "header",
          parameters: [{ type: encabezado.formato, [encabezado.formato]: { link } }],
        });
      }
    }
  }

  const cuerpo = componenteDe(plantilla, "body");
  if (cuerpo) {
    const numeros = variablesDe(cuerpo.texto);
    if (numeros.length > 0) {
      salientes.push({
        type: "body",
        parameters: numeros.map((n) => ({ type: "text", text: valores[`body.${n}`] ?? "" })),
      });
    }
  }

  return salientes;
}

/** Falta algo por completar: devuelve el primer hueco vacío, o null. */
export function primerHuecoVacio(plantilla: Plantilla, valores: Valores): Faltante | null {
  return faltantesDe(plantilla).find((f) => !(valores[claveDe(f)] ?? "").trim()) ?? null;
}

/**
 * Si una conversación puede mandar plantillas aprobadas.
 *
 * Sólo WhatsApp oficial: es un mecanismo de Meta para escribir fuera de la
 * ventana de 24 horas. En una sesión de WAHA —un WhatsApp común vinculado por
 * QR— no hay plantillas, pero tampoco hace falta ninguna para escribir
 * primero. Vive acá y no en `mensajeria`, que es `server-only`, porque el chat
 * necesita saberlo para decidir qué avisar antes de que escriban.
 */
export function conPlantillas(provider: string | null | undefined): boolean {
  return provider === "ycloud";
}
