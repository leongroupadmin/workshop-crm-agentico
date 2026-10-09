/**
 * Lectura de un CSV de contactos.
 *
 * El archivo lo arma otra persona: sale de un Excel, de otro CRM o de una
 * planilla compartida, y nunca viene como uno espera. Puede estar separado por
 * punto y coma o por comas, traer las columnas en cualquier orden, con o sin
 * acentos en los títulos, y con filas a medio llenar.
 *
 * Este módulo se ocupa de todo eso y no toca la base: recibe el texto y
 * devuelve filas limpias más el detalle de lo que descartó. Corre igual en la
 * pantalla —para la vista previa— y en el servidor, que es el único que decide
 * qué se guarda.
 */

// Ruta relativa y no el alias `@/`: las pruebas corren con el runner de Node,
// que resuelve el alias para los tipos —los borra al compilar— pero no para lo
// que se importa de verdad.
import { normalizarTelefono } from "./difusiones.ts";

/** Un contacto leído del archivo, ya limpio. */
export type FilaImportada = {
  nombre: string;
  /** En E.164, o null si no había o no era un número. */
  telefono: string | null;
  email: string | null;
  etiquetas: string[];
};

export type Lectura = {
  filas: FilaImportada[];
  /** Filas que no tenían ni nombre ni teléfono: no hay a quién cargar. */
  vacias: number;
  /** Repetidas dentro del mismo archivo, por teléfono o por email. */
  repetidas: number;
  /** Qué columna se usó para cada dato. Lo muestra la vista previa. */
  columnas: { nombre: string | null; telefono: string | null; email: string | null; etiquetas: string | null };
  /** Por qué no se pudo leer. `null` si salió bien. */
  error: string | null;
};

/** Tope por archivo. Más que esto no entra en una sola operación. */
export const MAX_IMPORTADAS = 2000;

/* ------------------------------------------------------------------ formato */

/**
 * Con qué está separado el archivo.
 *
 * Excel en español escribe punto y coma y en inglés comas, y los dos archivos
 * se llaman `.csv`. Se decide contando afuera de las comillas: un nombre como
 * "Pérez, Juan" tiene comas que no son separadores.
 */
function separadorDe(linea: string): string {
  const candidatos = [";", ",", "\t"];
  let mejor = ";";
  let maximo = -1;

  for (const candidato of candidatos) {
    let cuenta = 0;
    let dentro = false;
    for (const caracter of linea) {
      if (caracter === '"') dentro = !dentro;
      else if (caracter === candidato && !dentro) cuenta += 1;
    }
    if (cuenta > maximo) {
      maximo = cuenta;
      mejor = candidato;
    }
  }

  return mejor;
}

/**
 * El archivo entero a filas y columnas.
 *
 * Se recorre carácter por carácter en vez de partir por líneas y comas porque
 * una celda entrecomillada puede tener adentro el separador y hasta un salto de
 * línea —un mensaje pegado en una columna de notas, por ejemplo—, y partir a lo
 * bruto corre todas las columnas de esa fila para abajo.
 */
export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, "");
  if (!limpio.trim()) return [];

  const separador = separadorDe(limpio.split(/\r?\n/)[0] ?? "");

  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let dentro = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const caracter = limpio[i];

    if (dentro) {
      if (caracter === '"') {
        // Dos comillas seguidas adentro de una celda son una comilla escrita.
        if (limpio[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          dentro = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      dentro = true;
    } else if (caracter === separador) {
      fila.push(celda);
      celda = "";
    } else if (caracter === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else if (caracter !== "\r") {
      celda += caracter;
    }
  }

  if (celda || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  // Una fila de separadores sueltos no es una fila: es el renglón en blanco del
  // final que dejan casi todos los exportadores.
  return filas.filter((actual) => actual.some((valor) => valor.trim() !== ""));
}

/* ----------------------------------------------------------------- columnas */

/** Sin acentos, sin mayúsculas y sin espacios: así se comparan los títulos. */
function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Cómo se puede llamar cada columna.
 *
 * La lista es larga a propósito: el archivo lo exportó otra herramienta o lo
 * escribió una persona, y pedir un título exacto convierte la importación en un
 * ida y vuelta de "no me lo toma" que se resuelve renombrando a mano.
 */
const ALIAS = {
  nombre: ["nombre", "nombre y apellido", "name", "full name", "contacto", "cliente", "apellido y nombre"],
  telefono: ["telefono", "phone", "celular", "movil", "whatsapp", "numero", "number", "tel", "mobile"],
  email: ["email", "e-mail", "mail", "correo", "correo electronico"],
  etiquetas: ["etiquetas", "etiqueta", "tags", "tag", "categoria", "categorias"],
} as const;

type Campo = keyof typeof ALIAS;

function ubicarColumnas(encabezado: string[]): Record<Campo, number> {
  const titulos = encabezado.map(normalizarTitulo);
  const ubicacion = { nombre: -1, telefono: -1, email: -1, etiquetas: -1 };

  for (const campo of Object.keys(ALIAS) as Campo[]) {
    // Primero el título exacto y después el que lo contenga: así "Teléfono
    // celular" entra, pero sin que "email" se robe la columna "email 2" cuando
    // existe una que se llama justo "email".
    const alias: readonly string[] = ALIAS[campo];
    let indice = titulos.findIndex((titulo) => alias.includes(titulo));
    if (indice === -1) {
      indice = titulos.findIndex((titulo) => alias.some((nombre) => titulo.includes(nombre)));
    }
    ubicacion[campo] = indice;
  }

  return ubicacion;
}

/* ------------------------------------------------------------------ lectura */

export function leerContactos(texto: string): Lectura {
  const vacia: Lectura["columnas"] = { nombre: null, telefono: null, email: null, etiquetas: null };
  const filasCrudas = leerCsv(texto);

  if (filasCrudas.length === 0) {
    return { filas: [], vacias: 0, repetidas: 0, columnas: vacia, error: "El archivo está vacío." };
  }

  const encabezado = filasCrudas[0];
  const donde = ubicarColumnas(encabezado);

  if (donde.nombre === -1 && donde.telefono === -1) {
    return {
      filas: [],
      vacias: 0,
      repetidas: 0,
      columnas: vacia,
      error:
        "No encontramos ninguna columna de nombre ni de teléfono. La primera fila tiene que ser la de los títulos.",
    };
  }

  const columnas: Lectura["columnas"] = {
    nombre: donde.nombre === -1 ? null : encabezado[donde.nombre],
    telefono: donde.telefono === -1 ? null : encabezado[donde.telefono],
    email: donde.email === -1 ? null : encabezado[donde.email],
    etiquetas: donde.etiquetas === -1 ? null : encabezado[donde.etiquetas],
  };

  const filas: FilaImportada[] = [];
  const vistos = new Set<string>();
  let vacias = 0;
  let repetidas = 0;

  for (const cruda of filasCrudas.slice(1)) {
    const dato = (indice: number) => (indice === -1 ? "" : (cruda[indice] ?? "").trim());

    const telefono = normalizarTelefono(dato(donde.telefono));
    const email = dato(donde.email).toLowerCase() || null;
    // Sin nombre pero con teléfono, el teléfono hace de nombre: es preferible a
    // una base llena de "Sin nombre" que después no se puede distinguir.
    const nombre = dato(donde.nombre) || telefono || "";

    if (!nombre) {
      vacias += 1;
      continue;
    }

    // El mismo contacto dos veces en el mismo archivo pasa siempre que alguien
    // pega dos listados juntos. Se queda el primero.
    const clave = telefono ?? email;
    if (clave) {
      if (vistos.has(clave)) {
        repetidas += 1;
        continue;
      }
      vistos.add(clave);
    }

    filas.push({
      nombre: nombre.slice(0, 120),
      telefono,
      email,
      etiquetas: dato(donde.etiquetas)
        .split(/[,;|]/)
        .map((etiqueta) => etiqueta.trim())
        .filter(Boolean)
        .slice(0, 10),
    });

    if (filas.length >= MAX_IMPORTADAS) break;
  }

  return { filas, vacias, repetidas, columnas, error: null };
}
