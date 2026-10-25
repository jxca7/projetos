import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/**
 * Serve a mídia do driver local.
 *
 * Em produção com S3/R2 a mídia é entregue direto pelo bucket/CDN e esta rota
 * não é usada. Ela existe porque a Meta precisa BAIXAR o arquivo de uma URL
 * publica, o que em desenvolvimento exige um tunel apontando para ca'.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (env().STORAGE_DRIVER !== "local") {
    return new NextResponse("Storage não é local", { status: 404 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");

  // So' serve o que está registrado como mídia de algum workspace: impede
  // usar esta rota para ler arquivos arbitrarios do diretorio.
  const asset = await prisma.mediaAsset.findFirst({
    where: { storageKey: key },
    select: { mimeType: true, sizeBytes: true },
  });
  if (!asset) return new NextResponse("Não encontrado", { status: 404 });

  const driver = storage();
  if (!driver.localPath) return new NextResponse("Driver sem acesso local", { status: 500 });

  try {
    const filePath = driver.localPath(key);
    const data = await fs.readFile(filePath);
    const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": asset.mimeType || TYPES[ext] || "application/octet-stream",
        "content-length": String(data.byteLength),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Não encontrado", { status: 404 });
  }
}
