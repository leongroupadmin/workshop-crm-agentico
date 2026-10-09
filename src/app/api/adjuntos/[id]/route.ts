import type { NextRequest } from "next/server";

import { rutaDeLaCopia } from "@/lib/adjuntos-recibidos";
import { getSupabaseServer } from "@/lib/supabase/server";
import { firmarAdjuntoRecibido } from "@/lib/supabase/storage";
import { credencialesDeWaha } from "@/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lo que se le pasa al navegador de la respuesta del proveedor.
 *
 * Los rangos van sí o sí: Safari no reproduce un audio si el servidor no le
 * contesta un 206 al primer pedido parcial, y sin ellos tampoco se puede
 * adelantar la barra en ningún navegador.
 */
const CABECERAS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * Sólo se reenvía multimedia.
 *
 * La URL sale de la fila del mensaje, y esa fila la puede editar cualquiera del
 * equipo que vea el chat. Si se reenviara cualquier cosa, apuntarla a un
 * servicio interno del servidor serviría para leerlo desde afuera. Con esta
 * lista lo peor que sale es una imagen, un audio o un video.
 *
 * SVG queda afuera porque es un documento con scripts, no una imagen más.
 */
function esMultimedia(tipo: string): boolean {
  if (tipo === "image/svg+xml") return false;
  return (
    tipo.startsWith("audio/") ||
    tipo.startsWith("video/") ||
    tipo.startsWith("image/") ||
    tipo === "application/ogg" ||
    // Algunos CDN no dicen qué es. El reproductor lo averigua solo.
    tipo === "application/octet-stream"
  );
}

/**
 * El adjunto de un mensaje, servido desde el CRM.
 *
 * Existe por los audios de WAHA. WAHA guarda el archivo en su propio servidor,
 * detrás de su API key, y la URL que manda apunta a la dirección interna con la
 * que el CRM lo llama —`http://127.0.0.1:3001/…`—. El servidor la puede bajar
 * y por eso el audio se transcribía, pero el navegador no: desde el celular esa
 * dirección no existe, y aunque existiera no tiene la key. El reproductor
 * quedaba en 0:00 y el play no hacía nada.
 *
 * Hoy eso sirve unos minutos, hasta que WAHA borra el archivo. Lo que queda es
 * la copia que guarda el webhook (`adjuntos-recibidos.ts`), en un bucket
 * privado: también pasa por acá, con un enlace firmado que no sale del servidor.
 *
 * Quién puede escuchar qué lo decide RLS, igual que en el resto del chat: el
 * mensaje se busca con la sesión del usuario, así que un operario que no ve una
 * conversación tampoco puede pedir sus audios adivinando el id.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/adjuntos/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("messages")
    .select("media_url, conversations!inner(workspace_id)")
    .eq("id", id)
    .maybeSingle();

  const url = typeof data?.media_url === "string" ? data.media_url : null;
  if (!url || !/^https?:\/\//i.test(url)) return new Response(null, { status: 404 });

  // La copia se firma con la service role, que ve todos los workspaces. Por
  // eso tiene que ser del mismo workspace que el mensaje: la fila se puede
  // editar, y apuntarla a la copia de otro cliente no puede servir para oírla.
  const ruta = rutaDeLaCopia(url, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const conversacion = Array.isArray(data?.conversations) ? data.conversations[0] : data?.conversations;
  const workspace = typeof conversacion?.workspace_id === "string" ? conversacion.workspace_id : null;
  if (ruta && (!workspace || !ruta.startsWith(`${workspace}/`))) {
    return new Response(null, { status: 404 });
  }

  const destino = ruta ? await firmarAdjuntoRecibido(ruta) : url;
  if (!destino) return new Response(null, { status: 404 });

  const pedido = new Headers(credencialesDeWaha(url) ?? undefined);
  const rango = request.headers.get("range");
  if (rango) pedido.set("Range", rango);
  // Sin compresión: el tamaño que se le pasa al navegador tiene que ser el del
  // archivo, y `fetch` lo descomprimiría dejando el `content-length` viejo.
  pedido.set("Accept-Encoding", "identity");

  let original: Response;
  try {
    original = await fetch(destino, { headers: pedido, cache: "no-store", signal: request.signal });
  } catch (error) {
    // Cortar el audio a mitad de carga también llega acá, y eso no es una falla.
    if (!request.signal.aborted) console.error("[adjuntos] no se pudo pedir el adjunto:", error);
    return new Response(null, { status: 502 });
  }

  // Un rango fuera del archivo se contesta tal cual: el reproductor lo entiende.
  if (!original.ok && original.status !== 416) {
    await original.body?.cancel();
    console.error("[adjuntos] el proveedor devolvió", original.status);
    // Un enlace vencido es un archivo que ya no está, no una falla nuestra.
    return new Response(null, { status: original.status === 404 || original.status === 410 ? 404 : 502 });
  }

  const tipo = original.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (original.ok && !esMultimedia(tipo)) {
    await original.body?.cancel();
    return new Response(null, { status: 415 });
  }

  const respuesta = new Headers();
  for (const nombre of CABECERAS) {
    const valor = original.headers.get(nombre);
    if (valor) respuesta.set(nombre, valor);
  }
  // Si igual vino comprimido, el largo original ya no corresponde a lo que sale.
  if (original.headers.get("content-encoding")) respuesta.delete("content-length");

  respuesta.set("Cache-Control", "private, max-age=3600");
  // Abierto en una pestaña sigue siendo un archivo y nada más.
  respuesta.set("X-Content-Type-Options", "nosniff");
  respuesta.set("Content-Security-Policy", "default-src 'none'; sandbox");

  return new Response(original.body, { status: original.status, headers: respuesta });
}
