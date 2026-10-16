import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado de las credenciales de los proveedores.
 *
 * Las API keys de OpenAI, YCloud y Zernio se guardan en la base, y la base no
 * las ve nunca en claro: se cifran acá, en el servidor, con una clave que vive
 * en el entorno (`INTEGRATIONS_ENCRYPTION_KEY`). Un volcado de la base, un
 * backup filtrado o una consulta con la service role desde otro lado sólo ven
 * texto ilegible.
 *
 * AES-256-GCM porque además de cifrar autentica: un texto alterado en la base
 * no se descifra a otra cosa, falla. El IV es aleatorio por cada cifrado, así
 * que dos keys iguales no dejan el mismo texto.
 *
 * Módulo puro —sin `server-only` ni Supabase— para poder probarlo con el
 * runner de Node.
 */

const VERSION = "v1";
const ALGORITMO = "aes-256-gcm";

/** Lo mínimo que se le pide a la clave del entorno. */
export const LARGO_MINIMO_DE_LA_CLAVE = 32;

/**
 * La clave de 32 bytes, derivada de lo que haya en el entorno.
 *
 * Se acepta cualquier texto largo y se pasa por SHA-256 en vez de exigir
 * exactamente 32 bytes en base64: lo que se pega en el panel de Vercel es un
 * texto, y pedir un formato exacto es una forma más de que el despliegue falle
 * sin que nadie entienda por qué. `openssl rand -base64 32` alcanza y sobra.
 */
function derivar(clave: string): Buffer {
  return createHash("sha256").update(clave, "utf8").digest();
}

export function errorDeLaClave(clave: string | undefined | null): string | null {
  const limpia = (clave ?? "").trim();
  if (!limpia) {
    return "Falta INTEGRATIONS_ENCRYPTION_KEY en el entorno: sin ella no se pueden guardar credenciales.";
  }
  if (limpia.length < LARGO_MINIMO_DE_LA_CLAVE) {
    return `INTEGRATIONS_ENCRYPTION_KEY es demasiado corta: tiene que tener al menos ${LARGO_MINIMO_DE_LA_CLAVE} caracteres.`;
  }
  return null;
}

/** Cifra un objeto de textos y devuelve `v1.iv.tag.datos`, todo en base64. */
export function cifrar(valores: Record<string, string>, clave: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv(ALGORITMO, derivar(clave.trim()), iv);
  const datos = Buffer.concat([
    cifrador.update(JSON.stringify(valores), "utf8"),
    cifrador.final(),
  ]);
  const tag = cifrador.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), datos.toString("base64")].join(".");
}

/**
 * Lo inverso. Devuelve `null` si el texto no se puede descifrar: clave
 * equivocada, texto alterado o un formato que no es nuestro.
 *
 * No lanza a propósito. Quien llama tiene que poder decir "las credenciales
 * guardadas no se pueden leer, volvé a cargarlas" en vez de caerse con un 500.
 */
export function descifrar(texto: string, clave: string): Record<string, string> | null {
  const partes = texto.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) return null;

  try {
    const [, iv, tag, datos] = partes;
    const descifrador = createDecipheriv(
      ALGORITMO,
      derivar(clave.trim()),
      Buffer.from(iv, "base64"),
    );
    descifrador.setAuthTag(Buffer.from(tag, "base64"));
    const claro = Buffer.concat([
      descifrador.update(Buffer.from(datos, "base64")),
      descifrador.final(),
    ]).toString("utf8");

    const leido: unknown = JSON.parse(claro);
    if (!leido || typeof leido !== "object" || Array.isArray(leido)) return null;

    const valores: Record<string, string> = {};
    for (const [campo, valor] of Object.entries(leido)) {
      if (typeof valor === "string") valores[campo] = valor;
    }
    return valores;
  } catch {
    return null;
  }
}

/** Un secreto nuevo para pegar en el proveedor: 32 bytes en hex. */
export function generarSecreto(): string {
  return randomBytes(32).toString("hex");
}
