/**
 * Difusiones: a quién le toca y con qué número.
 *
 * El módulo no habla ni con la base ni con la red: recibe los contactos que ya
 * tiene el dashboard y devuelve quiénes quedan adentro del filtro. Lo mismo
 * corre en la pantalla, para mostrar la lista mientras se arma, y en el
 * servidor, que es el único que decide de verdad a quién se le escribe.
 *
 * Que sea la misma cuenta en los dos lados no es un detalle: si la pantalla
 * contara distinto que el servidor, alguien apretaría "enviar" mirando un
 * número y le llegaría a otra gente.
 */

/** Lo que se eligió en la pantalla. Todo vacío es "toda la base". */
export type FiltroDifusion = {
  /** Columnas del embudo. Vacío: cualquiera, incluso quien no está en el embudo. */
  stageIds: string[];
  /** Etiquetas del contacto. Alcanza con tener una de ellas. */
  etiquetas: string[];
  /** Fecha de alta, en formato yyyy-mm-dd y en la zona del workspace. */
  desde: string | null;
  hasta: string | null;
};

export const FILTRO_VACIO: FiltroDifusion = {
  stageIds: [],
  etiquetas: [],
  desde: null,
  hasta: null,
};

/** Un contacto visto como posible destinatario. */
export type Candidato = {
  contactId: string;
  nombre: string;
  /** Tal como está cargado en la ficha, sin normalizar. */
  telefono: string | null;
  etiquetas: string[];
  /** En qué columna del embudo está, o null si no tiene oportunidad. */
  stageId: string | null;
  /** Día de alta en la zona del workspace, yyyy-mm-dd. */
  dia: string;
};

/**
 * Tope de destinatarios por difusión.
 *
 * No es un límite de la API sino una barandilla: una difusión es irreversible y
 * un filtro mal armado que agarre la base entera se paga en reputación del
 * número de WhatsApp, no en un error en pantalla.
 */
export const MAX_DESTINATARIOS = 1000;

export function aplicarFiltros(candidatos: Candidato[], filtro: FiltroDifusion): Candidato[] {
  const etapas = new Set(filtro.stageIds);
  const etiquetas = new Set(filtro.etiquetas.map((etiqueta) => etiqueta.toLowerCase()));

  return candidatos.filter((candidato) => {
    if (etapas.size > 0 && (!candidato.stageId || !etapas.has(candidato.stageId))) return false;

    if (
      etiquetas.size > 0 &&
      !candidato.etiquetas.some((etiqueta) => etiquetas.has(etiqueta.toLowerCase()))
    ) {
      return false;
    }

    // Las fechas se comparan como texto porque yyyy-mm-dd ordena igual que el
    // calendario: no hace falta construir un Date para saber cuál es antes.
    if (filtro.desde && candidato.dia < filtro.desde) return false;
    if (filtro.hasta && candidato.dia > filtro.hasta) return false;

    return true;
  });
}

/** Las etiquetas que existen entre los candidatos, para ofrecerlas como filtro. */
export function etiquetasDisponibles(candidatos: Candidato[]): string[] {
  const vistas = new Map<string, string>();
  for (const candidato of candidatos) {
    for (const etiqueta of candidato.etiquetas) {
      const clave = etiqueta.trim().toLowerCase();
      if (clave && !vistas.has(clave)) vistas.set(clave, etiqueta.trim());
    }
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Cómo escribe los números el proveedor.
 *
 * WhatsApp identifica la conversación por el par de teléfonos, así que el
 * número que armamos tiene que coincidir letra por letra con el que manda
 * YCloud cuando el contacto escribe. Si no, el mensaje sale igual pero queda
 * colgado de una conversación nueva y el chat aparece partido en dos.
 *
 * En vez de adivinar el formato se copia el del número propio del workspace,
 * que salió de un evento real de YCloud.
 */
export type FormatoTelefono = "con-mas" | "solo-digitos";

export function formatoDe(numeroPropio: string | null | undefined): FormatoTelefono {
  return (numeroPropio ?? "").trim().startsWith("+") ? "con-mas" : "solo-digitos";
}

/**
 * Deja el teléfono en E.164, o null si no se puede.
 *
 * Los contactos se cargan a mano y llegan como sea —con espacios, guiones,
 * paréntesis, un 0 o un 15 de más—. Lo único que se puede afirmar sin inventar
 * es que un número internacional tiene entre 8 y 15 dígitos: lo que no entra en
 * eso no se manda, y el contacto queda listado aparte para corregirlo.
 */
export function normalizarTelefono(
  valor: string | null | undefined,
  formato: FormatoTelefono = "con-mas",
): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return formato === "con-mas" ? `+${digitos}` : digitos;
}

/**
 * Todas las formas con las que el mismo teléfono puede estar guardado.
 *
 * Sirve para buscar un contacto sin duplicarlo. Hay dos diferencias que no
 * significan nada y que una igualdad exacta trata como personas distintas:
 *
 * 1. **El `+`.** Cada proveedor guarda como le viene: WAHA deja los dígitos
 *    pelados, los otros ponen el prefijo.
 *
 * 2. **El 9 argentino.** WhatsApp lo exige para un móvil —`+549 11 …`— pero
 *    quien carga un contacto a mano escribe el número como se lo dictaron, sin
 *    el 9. Son la misma persona y el mismo WhatsApp, con doce o trece dígitos
 *    según quién lo haya escrito.
 *
 * Sólo se agrega la variante del 9 a los números argentinos: en otros países
 * ese dígito es parte del número y sacarlo sería apuntar a otro lado.
 */
export function formasDelTelefono(valor: string | null | undefined): string[] {
  const digitos = normalizarTelefono(valor, "solo-digitos");
  if (!digitos) return [];

  const variantes = [digitos];

  if (digitos.startsWith("549")) {
    variantes.push(`54${digitos.slice(3)}`);
  } else if (digitos.startsWith("54")) {
    variantes.push(`549${digitos.slice(2)}`);
  }

  // Las dos formas de cada variante, que es como aparecen en la base.
  return variantes.flatMap((variante) => [`+${variante}`, variante]);
}

/**
 * Si a este teléfono se le puede escribir primero por WhatsApp.
 *
 * Arrancar una charla nosotros —una difusión, o el botón de "escribir" de la
 * bandeja— es siempre por WhatsApp: es el único canal donde el proveedor sabe
 * armar el chat a partir de un número. En Instagram y Messenger la conversación
 * nace sólo cuando la persona escribe, porque del otro lado no hay un id de
 * chat que podamos inventar.
 *
 * Es la misma regla que usa `chatIdDelContacto` para armar ese id: quien liste
 * a quién ofrecerle el botón tiene que preguntar acá, o la pantalla promete lo
 * que el envío después no puede cumplir.
 */
export function sePuedeEscribirPrimero(telefono: string | null | undefined): boolean {
  return normalizarTelefono(telefono) !== null;
}

/** Si a este contacto se le puede escribir por WhatsApp. */
export function tieneTelefonoUtil(candidato: Candidato): boolean {
  return sePuedeEscribirPrimero(candidato.telefono);
}

/** Nombre visible de una difusión recién armada, cuando nadie le puso uno. */
export function nombrePorOmision(plantilla: string, cuantos: number): string {
  return `${plantilla} · ${cuantos} ${cuantos === 1 ? "contacto" : "contactos"}`;
}

/**
 * El nombre que WhatsApp le da al chat de un teléfono: `549…@c.us`.
 *
 * No alcanza con pegarle `@c.us` a los dígitos guardados. En un móvil argentino
 * WhatsApp exige el 9 después del 54 —`+549 11 …`—, y quien carga un contacto a
 * mano escribe el número como se lo dictaron, sin ese 9. Con el JID equivocado
 * WAHA acepta el envío y el mensaje no llega a ninguna parte: no hay error que
 * mirar, sólo un recordatorio que nunca apareció.
 *
 * El 9 se agrega únicamente a los números argentinos, por lo mismo que en
 * {@link formasDelTelefono}: en otro país ese dígito es parte del número.
 *
 * Un número sin código de país queda como está. Adivinarlo sería peor: mandaría
 * el recordatorio a un desconocido de otro lado del mundo en vez de no mandarlo.
 */
export function chatDeWhatsapp(valor: string | null | undefined): string | null {
  const digitos = normalizarTelefono(valor, "solo-digitos");
  if (!digitos) return null;

  const conNueve =
    digitos.startsWith("54") && !digitos.startsWith("549") ? `549${digitos.slice(2)}` : digitos;

  return `${conNueve}@c.us`;
}

/* ------------------------------------------------- por qué no salió un envío */

/**
 * Qué decirle a quien manda cuando un destinatario falla.
 *
 * El motivo que queda guardado es el que devolvió la API, y es para otro
 * lector: `YCloud respondió 400: {"error":{"code":132000,...}}` no le dice a
 * nadie que hay que revisar los huecos de la plantilla. Acá se traduce a la
 * acción que corresponde.
 *
 * El texto original no se descarta nunca: la tabla de códigos de Meta cambia y
 * esta traducción va a quedarse corta, así que lo crudo sigue disponible para
 * poder leerlo. Un motivo que no se reconoce se muestra tal cual y no se
 * disfraza de explicación.
 */
export type Motivo = {
  /** Una línea en los términos de quien mandó la difusión. */
  resumen: string;
  /** Lo que contestó la API, cuando aporta algo más que el resumen. */
  tecnico: string | null;
};

/**
 * Las traducciones, de la más específica a la más general.
 *
 * Se busca por código cuando lo hay, porque el texto de Meta cambia de una
 * versión a la otra; el texto es el respaldo para cuando el código no viene.
 */
const MOTIVOS: { marcas: string[]; resumen: string }[] = [
  {
    marcas: ["132000", "number of parameters", "parameters does not match"],
    resumen: "La plantilla espera otra cantidad de variables. Volvé a elegirla y completá los huecos.",
  },
  {
    marcas: ["132001", "template does not exist", "template not found"],
    resumen: "La plantilla ya no existe en ese idioma. Revisala en el panel de YCloud.",
  },
  {
    marcas: ["132012", "parameter format"],
    resumen: "Uno de los valores no tiene el formato que pide la plantilla.",
  },
  {
    marcas: ["131026", "not a valid whatsapp user", "undeliverable"],
    resumen: "Ese número no tiene WhatsApp.",
  },
  {
    marcas: ["133010", "not registered"],
    resumen: "El número propio no está registrado en WhatsApp. Revisá la configuración.",
  },
  {
    marcas: ["130429", "80007", "rate limit", "too many requests"],
    resumen: "WhatsApp frenó el envío por volumen. Reintentá más tarde.",
  },
  {
    marcas: ["131031", "account has been locked", "account restricted"],
    resumen: "WhatsApp restringió la cuenta. Revisá el estado en el panel de Meta.",
  },
  {
    marcas: ["no se pudo conectar"],
    resumen: "No se pudo conectar con YCloud. Reintentá.",
  },
  {
    // El estado va anclado a cómo lo escribe `ycloud-api`: un "403" suelto
    // aparece dentro de cualquier cuerpo JSON y etiquetaría como problema de
    // credenciales a un fallo que no tiene nada que ver.
    marcas: ["respondió 401", "respondió 403", "ycloud_api_key"],
    resumen: "YCloud rechazó las credenciales. Revisá YCLOUD_API_KEY.",
  },
];

export function motivoLegible(detalle: string | null | undefined): Motivo | null {
  const crudo = (detalle ?? "").trim();
  if (!crudo) return null;

  const bajo = crudo.toLowerCase();
  const encontrado = MOTIVOS.find((motivo) => motivo.marcas.some((marca) => bajo.includes(marca)));

  // Sin traducción el crudo es el resumen: repetirlo abajo no agrega nada.
  if (!encontrado) return { resumen: crudo, tecnico: null };

  return { resumen: encontrado.resumen, tecnico: crudo };
}
