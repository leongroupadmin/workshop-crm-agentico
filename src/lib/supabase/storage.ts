import "server-only";

import { MAX_ADJUNTO_BYTES } from "@/lib/adjuntos";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Dónde viven los archivos que salen del CRM: las notas de voz del chat y las
 * imágenes y videos que se adjuntan a una respuesta.
 *
 * Públicos a propósito: el proveedor tiene que poder bajarse el archivo para
 * entregárselo a WhatsApp, y del otro lado no hay forma de mandarle nuestra
 * sesión. Las URLs llevan un uuid, así que no se adivinan, pero conviene
 * saberlo: cualquiera con el link ve el archivo.
 *
 * Son dos buckets y no uno porque el tope de tamaño se fija al crearlo y el de
 * las notas de voz ya está creado en 6 MB: meter los videos ahí los dejaría
 * rebotando contra un límite que no se puede subir sin tocar Supabase a mano.
 */
const BUCKET_VOZ = "notas-de-voz";
const BUCKET_ADJUNTOS = "adjuntos-del-chat";

/** 6 MB, lo mismo que aguanta la Server Action que trae el archivo. */
export const MAX_VOICE_BYTES = 6 * 1024 * 1024;

const TOPES: Record<string, number> = {
  [BUCKET_VOZ]: MAX_VOICE_BYTES,
  [BUCKET_ADJUNTOS]: MAX_ADJUNTO_BYTES,
};

const listos = new Set<string>();

/**
 * Crea el bucket la primera vez y no molesta nunca más.
 *
 * Va acá y no en una migración para no obligar a tocar Supabase a mano: el
 * bucket se crea solo con el primer archivo que alguien mande.
 */
async function asegurarBucket(bucket: string) {
  if (listos.has(bucket)) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: TOPES[bucket],
  });

  // "ya existe" es el caso normal a partir de la segunda vez.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`No se pudo preparar el almacenamiento: ${error.message}`);
  }

  listos.add(bucket);
}

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

type Subida = {
  workspaceId: string;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

/**
 * Sube un archivo y devuelve una URL que el proveedor pueda descargar.
 *
 * El `qué` del error lo pone quien llama: "el audio es demasiado largo" y "la
 * imagen pesa demasiado" son el mismo fallo para el almacenamiento y dos cosas
 * distintas para quien está respondiendo un chat.
 */
async function subir(
  bucket: string,
  input: Subida,
  nombre: string,
): Promise<UploadResult> {
  if (input.bytes.byteLength === 0) return { ok: false, error: `${nombre} llegó vacío.` };
  if (input.bytes.byteLength > TOPES[bucket]) {
    return { ok: false, error: `${nombre} es demasiado grande.` };
  }

  try {
    await asegurarBucket(bucket);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Almacenamiento no disponible.",
    };
  }

  const admin = getSupabaseAdmin();
  // El workspace en la ruta mantiene ordenado el bucket y deja borrar por
  // cliente el día que haga falta.
  const path = `${input.workspaceId}/${crypto.randomUUID()}.${input.extension}`;

  const { error } = await admin.storage.from(bucket).upload(path, input.bytes, {
    contentType: input.contentType,
    upsert: false,
  });

  if (error) return { ok: false, error: `No se pudo guardar ${nombre}: ${error.message}` };

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, error: `No se pudo obtener el enlace de ${nombre}.` };

  return { ok: true, url: data.publicUrl };
}

/** Sube el audio y devuelve una URL que el proveedor pueda descargar. */
export async function uploadVoiceNote(input: Subida): Promise<UploadResult> {
  // El tope del audio tiene su propio aviso: lo que hay que hacer es grabar más
  // corto, no "mandar un archivo más chico".
  if (input.bytes.byteLength > MAX_VOICE_BYTES) {
    return { ok: false, error: "El audio es demasiado largo. Grabá uno más corto." };
  }
  return subir(BUCKET_VOZ, input, "el audio");
}

/** Sube la imagen o el video de una respuesta del chat. */
export async function uploadChatMedia(input: Subida): Promise<UploadResult> {
  return subir(BUCKET_ADJUNTOS, input, "el archivo");
}
