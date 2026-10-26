import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { downloadReel, ReelDownloadError } from "@/lib/media/download";
import {
  ingestMedia,
  MediaRejectedError,
  MediaTooLargeError,
  UnsupportedMediaError,
} from "@/lib/media/ingest";
import type { ImportJobData } from "@/lib/queue";

/** Nome amigável do asset na biblioteca, a partir do que o yt-dlp leu. */
function assetName(uploader: string | null): string {
  const quem = uploader ? `@${uploader.replace(/[^A-Za-z0-9_.]/g, "")}` : "instagram";
  return `${quem} reel.mp4`;
}

/** Mensagem definitiva: o erro é do conteúdo/link, não transitório. */
function isDefinitiveError(e: unknown): e is Error {
  return (
    e instanceof ReelDownloadError ||
    e instanceof MediaRejectedError ||
    e instanceof MediaTooLargeError ||
    e instanceof UnsupportedMediaError
  );
}

export async function processImport(data: ImportJobData): Promise<void> {
  const imp = await prisma.mediaImport.findUnique({ where: { id: data.importId } });
  if (!imp) return;
  // Já resolvida: nada a fazer (evita rebaixar status em reenfileiramento).
  if (imp.status === "DONE" || imp.status === "DUPLICATE") return;

  await prisma.mediaImport.update({
    where: { id: imp.id },
    data: { status: "DOWNLOADING", error: null },
  });

  let cookieDir: string | undefined;
  let cookiesPath: string | undefined;
  try {
    // Cookie da conta (quando configurado), gravado num arquivo temporário com
    // permissão restrita e apagado no finally.
    const jar = await prisma.instagramCookie.findUnique({
      where: { workspaceId: imp.workspaceId },
    });
    if (jar) {
      cookieDir = await fs.mkdtemp(path.join(os.tmpdir(), `igck-${crypto.randomBytes(6).toString("hex")}-`));
      cookiesPath = path.join(cookieDir, "cookies.txt");
      await fs.writeFile(cookiesPath, decryptSecret(jar.cookiesEnc), { mode: 0o600 });
    }

    const dl = await downloadReel(imp.sourceUrl, { cookiesPath });
    try {
      const body = await fs.readFile(dl.filePath);
      const { asset, duplicate } = await ingestMedia({
        workspaceId: imp.workspaceId,
        body,
        originalName: assetName(dl.uploader),
        mimeType: dl.mimeType,
        usedFor: "LIBRARY",
      });
      await prisma.mediaImport.update({
        where: { id: imp.id },
        data: {
          status: duplicate ? "DUPLICATE" : "DONE",
          assetId: asset.id,
          title: dl.title ?? imp.title,
          error: null,
        },
      });
    } finally {
      await fs.rm(dl.dir, { recursive: true, force: true });
    }
  } catch (e) {
    const msg =
      e instanceof MediaRejectedError
        ? `Reprovado nas regras do Instagram: ${e.issues.map((i) => i.message).join(" ")}`
        : isDefinitiveError(e)
          ? e.message
          : "Erro inesperado ao importar.";
    await prisma.mediaImport.update({
      where: { id: imp.id },
      data: { status: "FAILED", error: msg.slice(0, 500) },
    });
    // Erros de download/validação são definitivos: não relançamos (sem retry do
    // BullMQ). A pessoa reimporta pelo botão se quiser tentar de novo.
    if (!isDefinitiveError(e)) throw e;
  } finally {
    if (cookieDir) await fs.rm(cookieDir, { recursive: true, force: true });
  }
}
