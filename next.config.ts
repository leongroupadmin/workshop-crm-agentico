import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Las notas de voz y los adjuntos del chat viajan al servidor por una
    // Server Action. El tope por defecto es 1 MB, que no alcanza para ninguno
    // de los dos: tres minutos de opus rondan los 700 KB y en base64 se pasan,
    // y un video de WhatsApp llega hasta 16 MB.
    //
    // 17 MB y no 16: el video va en un `multipart/form-data`, que agrega sus
    // bordes y los encabezados de cada parte, y el tope se mide sobre el cuerpo
    // crudo. Sin ese margen el video más grande que el CRM acepta rebota acá, y
    // el error no diría nada sobre el tamaño.
    serverActions: { bodySizeLimit: "17mb" },
  },
};

export default nextConfig;
