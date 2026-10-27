import fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { prepareAccount, PrepareError } from "@/lib/story/prepare-app";
import type { PrepareJobData } from "@/lib/queue";

/** Lê a foto do perfil: do disco (driver local) ou pela URL pública. */
async function lerImagem(imageKey: string | null, imageUrl: string | null): Promise<Buffer | null> {
  if (!imageKey || !imageUrl) return null;
  const drv = storage();
  if (drv.name === "local" && drv.localPath) {
    return fs.readFile(drv.localPath(imageKey));
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new PrepareError("Não consegui ler a foto.");
  return Buffer.from(await res.arrayBuffer());
}

export async function processPrepare(data: PrepareJobData): Promise<void> {
  const target = await prisma.prepareTarget.findUnique({
    where: { id: data.targetId },
    include: { job: true },
  });
  if (!target) return;
  if (target.status === "DONE") return;

  await prisma.prepareTarget.update({
    where: { id: target.id },
    data: { status: "POSTING", error: null },
  });

  try {
    const imageBytes = await lerImagem(target.job.imageKey, target.job.imageUrl);

    const sessao = await prisma.igSession.findUnique({
      where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
    });

    const result = await prepareAccount({
      username: target.username,
      password: decryptSecret(target.passwordEnc),
      combo: target.comboEnc ? decryptSecret(target.comboEnc) : null,
      imageBytes,
      bio: target.job.bio,
      proxy: target.job.proxyEnc ? decryptSecret(target.job.proxyEnc) : null,
      sessionIn: sessao ? decryptSecret(sessao.settingsEnc) : null,
    });

    if (result.sessionOut) {
      const settingsEnc = encryptSecret(result.sessionOut);
      await prisma.igSession.upsert({
        where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
        create: { workspaceId: target.job.workspaceId, username: target.username, settingsEnc },
        update: { settingsEnc },
      });
    }

    await prisma.prepareTarget.update({
      where: { id: target.id },
      data: {
        status: result.outcome,
        error: result.outcome === "DONE" ? null : result.message,
        doneAt: result.outcome === "DONE" ? new Date() : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado ao preparar a conta.";
    await prisma.prepareTarget.update({
      where: { id: target.id },
      data: { status: "FAILED", error: msg.slice(0, 400) },
    });
    // Não relança: não repete sozinho (evita lockout da conta).
  }
}
