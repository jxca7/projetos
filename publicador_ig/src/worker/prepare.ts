import fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { prepareAccount, PrepareError } from "@/lib/story/prepare-app";
import { acceptInvite } from "@/lib/story/accept-invite";
import type { PrepareJobData } from "@/lib/queue";

type StepOutcome = "DONE" | "FAILED" | "SKIPPED_2FA";

/** Junta os desfechos dos passos (foto/bio/story e convite) num status só. */
function combinar(steps: { label: string; outcome: StepOutcome; message: string }[]): {
  status: StepOutcome;
  error: string | null;
} {
  if (steps.length === 0) return { status: "DONE", error: null };
  const status: StepOutcome = steps.some((s) => s.outcome === "FAILED")
    ? "FAILED"
    : steps.some((s) => s.outcome === "SKIPPED_2FA")
      ? "SKIPPED_2FA"
      : "DONE";
  if (status === "DONE") return { status, error: null };
  const error = steps
    .filter((s) => s.outcome !== "DONE")
    .map((s) => `${s.label}: ${s.message}`)
    .join(" | ");
  return { status, error: error.slice(0, 400) };
}

/** Lê uma imagem do storage (foto do perfil ou story): do disco (driver local) ou pela URL pública. */
async function lerImagem(imageKey: string | null, imageUrl: string | null): Promise<Buffer | null> {
  if (!imageKey || !imageUrl) return null;
  const drv = storage();
  if (drv.name === "local" && drv.localPath) {
    return fs.readFile(drv.localPath(imageKey));
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new PrepareError("Não consegui ler a imagem.");
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
    const combo = target.comboEnc ? decryptSecret(target.comboEnc) : null;
    const proxy = target.job.proxyEnc ? decryptSecret(target.job.proxyEnc) : null;
    const steps: { label: string; outcome: StepOutcome; message: string }[] = [];

    // Passo 1 — foto, bio e story (instagrapi), numa sessão só, quando pedido.
    if (target.job.imageKey || target.job.bio || target.job.storyImageKey) {
      const imageBytes = await lerImagem(target.job.imageKey, target.job.imageUrl);
      const storyBytes = await lerImagem(target.job.storyImageKey, target.job.storyImageUrl);
      const sessao = await prisma.igSession.findUnique({
        where: { workspaceId_username: { workspaceId: target.job.workspaceId, username: target.username } },
      });
      const result = await prepareAccount({
        username: target.username,
        password: decryptSecret(target.passwordEnc),
        combo,
        imageBytes,
        bio: target.job.bio,
        storyBytes,
        storyLink: target.job.storyLink,
        storyLinkLabel: target.job.storyLinkLabel,
        storyHighlight: target.job.storyHighlight,
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
      steps.push({ label: "perfil/story", outcome: result.outcome, message: result.message });
    }

    // Passo 2 — aceitar o convite do testador (navegador headless). Exige combo.
    if (target.job.acceptInvite) {
      if (!combo) {
        steps.push({ label: "convite", outcome: "FAILED", message: "aceitar convite exige o combo (cookie)." });
      } else {
        const inv = await acceptInvite({ username: target.username, combo, proxy });
        steps.push({ label: "convite", outcome: inv.outcome, message: inv.message });
      }
    }

    const { status, error } = combinar(steps);
    await prisma.prepareTarget.update({
      where: { id: target.id },
      data: { status, error, doneAt: status === "DONE" ? new Date() : null },
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
