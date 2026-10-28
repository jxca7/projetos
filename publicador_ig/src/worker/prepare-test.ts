import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { acceptInviteApi } from "@/lib/story/accept-invite-api";
import type { PrepareTestJobData } from "@/lib/queue";

/** TESTE: aceita o convite do testador de UMA conta pelo instagrapi (sem navegador). */
export async function processPrepareTest(data: PrepareTestJobData): Promise<void> {
  const target = await prisma.prepareTestTarget.findUnique({
    where: { id: data.targetId },
    include: { job: true },
  });
  if (!target) return;
  if (target.status === "DONE") return;

  await prisma.prepareTestTarget.update({
    where: { id: target.id },
    data: { status: "POSTING", error: null },
  });

  try {
    const combo = target.comboEnc ? decryptSecret(target.comboEnc) : null;
    const proxy = target.job.proxyEnc ? decryptSecret(target.job.proxyEnc) : null;

    const sessao = await prisma.igSession.findUnique({
      where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
    });

    const result = await acceptInviteApi({
      username: target.username,
      password: decryptSecret(target.passwordEnc),
      combo,
      appId: target.job.appId,
      proxy,
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

    await prisma.prepareTestTarget.update({
      where: { id: target.id },
      data: {
        status: result.outcome,
        error: result.outcome === "DONE" ? null : result.message,
        doneAt: result.outcome === "DONE" ? new Date() : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro inesperado ao aceitar o convite.";
    await prisma.prepareTestTarget.update({
      where: { id: target.id },
      data: { status: "FAILED", error: msg.slice(0, 400) },
    });
    // Não relança: não repete sozinho (evita lockout da conta).
  }
}
