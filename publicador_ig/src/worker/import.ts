import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { runDownloader, ReelDownloadError, type ProfileOptions, type DownloadedFile } from "@/lib/media/download";
import {
  ingestMedia,
  MediaRejectedError,
  MediaTooLargeError,
  UnsupportedMediaError,
} from "@/lib/media/ingest";
import type { ImportJobData } from "@/lib/queue";

/** O erro é do conteúdo/configuração, não transitório: não vale retry. */
function isDefinitiveError(e: unknown): e is Error {
  return (
    e instanceof ReelDownloadError ||
    e instanceof MediaRejectedError ||
    e instanceof MediaTooLargeError ||
    e instanceof UnsupportedMediaError
  );
}

/** Ingere um arquivo baixado na biblioteca. Devolve se era duplicata. */
async function ingerir(
  workspaceId: string,
  file: DownloadedFile,
): Promise<{ assetId: string; duplicate: boolean }> {
  const body = await fs.readFile(file.path);
  const { asset, duplicate } = await ingestMedia({
    workspaceId,
    body,
    originalName: path.basename(file.path),
    mimeType: file.mimeType,
    usedFor: "LIBRARY",
    caption: file.caption,
  });
  return { assetId: asset.id, duplicate };
}

export async function processImport(data: ImportJobData): Promise<void> {
  const imp = await prisma.mediaImport.findUnique({ where: { id: data.importId } });
  if (!imp) return;
  if (imp.status === "DONE" || imp.status === "DUPLICATE") return; // já resolvida

  await prisma.mediaImport.update({
    where: { id: imp.id },
    data: { status: "DOWNLOADING", error: null },
  });

  let cookieDir: string | undefined;
  try {
    // O downloader precisa do login da conta (listar perfil e baixar a mídia).
    const jar = await prisma.instagramCookie.findUnique({
      where: { workspaceId: imp.workspaceId },
    });
    if (!jar) {
      throw new ReelDownloadError(
        "Configure o cookie da conta do Instagram na tela de importação antes de baixar.",
      );
    }
    cookieDir = await fs.mkdtemp(path.join(os.tmpdir(), `igck-${crypto.randomBytes(6).toString("hex")}-`));
    const cookiesPath = path.join(cookieDir, "cookies.txt");
    await fs.writeFile(cookiesPath, decryptSecret(jar.cookiesEnc), { mode: 0o600 });

    const run =
      imp.mode === "PROFILE"
        ? await runDownloader({
            cookiesPath,
            account: imp.account ?? undefined,
            profile: (imp.options as unknown as ProfileOptions) ?? undefined,
          })
        : await runDownloader({ cookiesPath, links: [imp.sourceUrl ?? ""] });

    try {
      let novos = 0;
      let dupes = 0;
      let primeiroAsset: string | null = null;
      const falhasArquivo: string[] = [];

      for (const file of run.files) {
        try {
          const { assetId, duplicate } = await ingerir(imp.workspaceId, file);
          if (duplicate) dupes++;
          else novos++;
          primeiroAsset = primeiroAsset ?? assetId;
        } catch {
          // Um arquivo ruim não derruba o lote inteiro (relevante nos perfis).
          falhasArquivo.push(path.basename(file.path));
        }
      }

      if (imp.mode === "LINK") {
        const nada = run.files.length === 0;
        await prisma.mediaImport.update({
          where: { id: imp.id },
          data: {
            status: nada ? "FAILED" : dupes > 0 && novos === 0 ? "DUPLICATE" : "DONE",
            assetId: primeiroAsset,
            downloaded: novos,
            skipped: dupes,
            title: run.files[0]?.caption?.slice(0, 200) ?? imp.title,
            error: nada ? "O link não produziu nenhum vídeo." : null,
          },
        });
      } else {
        const partes = [`${novos} novo(s)`];
        if (dupes) partes.push(`${dupes} já existiam`);
        if (falhasArquivo.length) partes.push(`${falhasArquivo.length} com erro`);
        await prisma.mediaImport.update({
          where: { id: imp.id },
          data: {
            status: novos + dupes === 0 ? "FAILED" : "DONE",
            downloaded: novos,
            skipped: dupes,
            title: `@${imp.account}: ${partes.join(", ")}`,
            error:
              novos + dupes === 0
                ? run.timedOut
                  ? "Tempo esgotado antes de baixar algo."
                  : "Nada foi baixado (conta sem itens, privada, ou limite do Instagram)."
                : null,
          },
        });
      }
    } finally {
      await fs.rm(run.dir, { recursive: true, force: true });
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
    if (!isDefinitiveError(e)) throw e; // transitório: deixa o BullMQ repetir
  } finally {
    if (cookieDir) await fs.rm(cookieDir, { recursive: true, force: true });
  }
}
