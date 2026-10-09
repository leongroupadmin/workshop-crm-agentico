/**
 * La marca con la que el agente de la landing avisa que esto ya es un lead.
 *
 * Vive aparte del resto del chat —que habla con OpenAI y está marcado como
 * `server-only`— porque acá no hay red ni base: entra un texto y salen dos
 * cosas. Eso lo vuelve la única parte de todo esto que se puede probar sin
 * gastar un peso ni levantar nada, y es justo la que más conviene tener
 * probada: se le pasa por encima a lo que escribió un modelo, que es lo menos
 * predecible del sistema.
 */

/** Lo que el agente logró sacarle a la persona, si lo logró. */
export type DatosDelLead = {
  nombre?: string;
  rubro?: string;
  telefono?: string;
  resumen?: string;
};

/**
 * Con qué avisa el agente.
 *
 * Es una marca de texto y no una herramienta de OpenAI, igual que el
 * `[DERIVAR]` del agente del CRM y por el mismo motivo: function calling
 * significaría una segunda vuelta contra la API en cada mensaje para averiguar
 * algo que el modelo puede decir en la misma respuesta.
 */
export const MARCA_DE_LEAD = "[LEAD]";

/**
 * Separa la marca del mensaje que ve el visitante.
 *
 * El modelo la escribe al final, en un renglón aparte. Acá se corta en dos: el
 * texto limpio, que es lo único que viaja al navegador, y los datos, que van al
 * CRM.
 *
 * Si la marca vino mal escrita —un JSON roto, que pasa— se descarta la parte de
 * datos pero igual se limpia el texto y se devuelve el aviso vacío: que el
 * modelo se haya equivocado tipeando no cambia que reconoció un lead. Lo que no
 * puede pasar nunca es que el visitante vea un corchete con su propio teléfono
 * adentro.
 */
export function separarMarcaDeLead(texto: string): {
  limpio: string;
  datos: DatosDelLead | null;
} {
  const posicion = texto.indexOf(MARCA_DE_LEAD);
  if (posicion === -1) return { limpio: texto.trim(), datos: null };

  const antes = texto.slice(0, posicion).trim();
  const cola = texto.slice(posicion + MARCA_DE_LEAD.length).trim();

  const abre = cola.indexOf("{");
  const cierra = cola.lastIndexOf("}");

  /*
    Qué es el mensaje y qué es la marca.

    Se le pide al modelo que escriba la marca al final, y casi siempre lo hace.
    Cuando no —la pone arriba y contesta abajo— quedarse sólo con lo de antes
    devolvía un mensaje vacío, o sea una burbuja en blanco en el hero de la
    página. Así que el mensaje es lo que haya antes de la marca y, si no hay
    nada, lo que quede después del JSON.
  */
  const despues = cierra > abre ? cola.slice(cierra + 1).trim() : cola;
  const limpio = antes || despues;

  if (abre === -1 || cierra <= abre) return { limpio, datos: {} };

  try {
    const crudo = JSON.parse(cola.slice(abre, cierra + 1)) as Record<string, unknown>;
    const campo = (clave: string) => {
      const valor = crudo[clave];
      return typeof valor === "string" && valor.trim() ? valor.trim() : undefined;
    };

    return {
      limpio,
      datos: {
        nombre: campo("nombre"),
        rubro: campo("rubro"),
        telefono: campo("telefono"),
        resumen: campo("resumen"),
      },
    };
  } catch {
    return { limpio, datos: {} };
  }
}
