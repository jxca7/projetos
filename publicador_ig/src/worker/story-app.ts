import fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { postStoryApp, StoryPostError } from "@/lib/story/post-app";
import type { StoryAppJobData } from "@/lib/queue";

/** Lê os bytes da imagem do story: do disco (driver local) ou pela URL pública. */
async function lerImagem(imageKey: string, imageUrl: string): Promise<Buffer> {
  const drv = storage();
  if (drv.name === "local" && drv.localPath) {
    return fs.readFile(drv.localPath(imageKey));
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new StoryPostError("Não consegui ler a imagem do story.");
  return Buffer.from(await res.arrayBuffer());
}

export async function processStoryApp(data: StoryAppJobData): Promise<void> {
  const target = await prisma.storyAppTarget.findUnique({
    where: { id: data.targetId },
    include: { job: true },
  });
  if (!target) return;
  if (target.status === "DONE") return;

  await prisma.storyAppTarget.update({
    where: { id: target.id },
    data: { status: "POSTING", error: null },
  });

  try {
    const imageBytes = await lerImagem(target.job.imageKey, target.job.imageUrl);

    // Sessão salva desta conta (se houver), para reusar e não logar de novo.
    const sessao = await prisma.igSession.findUnique({
      where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
    });

    const result = await postStoryApp({
      username: target.username,
      password: decryptSecret(target.passwordEnc),
      combo: target.comboEnc ? decryptSecret(target.comboEnc) : null,
      imageBytes,
      link: target.job.link,
      linkLabel: target.job.linkLabel,
      highlight: target.job.highlight,
      proxy: target.job.proxyEnc ? decryptSecret(target.job.proxyEnc) : null,
      sessionIn: sessao ? decryptSecret(sessao.settingsEnc) : null,
    });

    // Persiste a sessão atualizada (device + cookies) para os próximos runs.
    if (result.sessionOut) {
      const settingsEnc = encryptSecret(result.sessionOut);
      await prisma.igSession.upsert({
        where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
        create: { workspaceId: target.job.workspaceId, username: target.username, settingsEnc },
        update: { settingsEnc },
      });
    }

    await prisma.storyAppTarget.update({
      where: { id: target.id },
      data: {
        status: result.outcome,
        error: result.outcome === "DONE" ? null : result.message,
        igStoryId: result.igStoryId,
        postedAt: result.outcome === "DONE" ? new Date() : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado ao postar o story.";
    await prisma.storyAppTarget.update({
      where: { id: target.id },
      data: { status: "FAILED", error: msg.slice(0, 400) },
    });
    // Não relança: postagem não deve repetir sozinha (evita lockout da conta).
  }
}
