import { prisma } from "./../prisma";
import { cancelPublish, enqueuePublish } from "../queue";
import { validateCaption } from "../media/validate";
import { MIN_SECONDS_BETWEEN_PUBLISHES } from "./pacing";

export interface ScheduleResult {
  postId: string;
  queued: number;
  firstAt: Date;
  lastAt: Date;
  warnings: string[];
}

export class ScheduleError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" | "));
    this.name = "ScheduleError";
    this.issues = issues;
  }
}

/**
 * Coloca um post na fila, um job por conta de destino.
 *
 * As publicações são distribuídas no tempo (stagger) em vez de disparadas
 * juntas. Isso existe por dois motivos: a Graph API tem teto de chamadas, e
 * dezenas de contas publicando o mesmo conteúdo no mesmo segundo é o padrão
 * que o Instagram classifica como automação coordenada.
 */
export async function schedulePost(postId: string): Promise<ScheduleResult> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      media: { include: { media: true }, orderBy: { position: "asc" } },
      targets: { include: { account: true } },
      workspace: { include: { subscription: true } },
    },
  });

  if (!post) throw new ScheduleError(["Post não encontrado."]);

  const issues: string[] = [];
  const warnings: string[] = [];

  if (post.targets.length === 0) {
    issues.push("Selecione pelo menos uma conta de destino.");
  }
  if (post.media.length === 0) {
    issues.push("Anexe a mídia do post.");
  }
  if (post.type === "CAROUSEL" && (post.media.length < 2 || post.media.length > 10)) {
    issues.push(`Carrossel precisa de 2 a 10 itens (tem ${post.media.length}).`);
  }
  if (post.type !== "CAROUSEL" && post.media.length > 1) {
    warnings.push(`Post do tipo ${post.type} usa apenas a primeira mídia.`);
  }
  if (post.requiresApproval && !post.approvedAt) {
    issues.push("Post precisa de aprovação antes de ser agendado.");
  }

  // Legenda: a do post e cada override por conta.
  for (const issue of validateCaption(post.caption)) {
    if (issue.level === "error") issues.push(issue.message);
    else warnings.push(issue.message);
  }
  for (const t of post.targets) {
    if (!t.captionOverride) continue;
    for (const issue of validateCaption(t.captionOverride)) {
      const where = `@${t.account.igUsername}`;
      if (issue.level === "error") issues.push(`${where}: ${issue.message}`);
      else warnings.push(`${where}: ${issue.message}`);
    }
  }

  const inactive = post.targets.filter((t) => t.account.status !== "ACTIVE");
  for (const t of inactive) {
    warnings.push(`@${t.account.igUsername} esta ${t.account.status} e será ignorada.`);
  }

  const activeTargets = post.targets.filter((t) => t.account.status === "ACTIVE");
  if (activeTargets.length === 0 && issues.length === 0) {
    issues.push("Nenhuma conta de destino esta ativa.");
  }

  // Limite do plano: número de contas conectadas.
  const maxAccounts = post.workspace.subscription?.maxAccounts ?? 2;
  if (activeTargets.length > maxAccounts) {
    issues.push(
      `Seu plano permite ${maxAccounts} conta(s) por post; você selecionou ${activeTargets.length}.`,
    );
  }

  if (issues.length > 0) throw new ScheduleError(issues);

  const baseAt = post.publishNow
    ? new Date()
    : (post.scheduledAt ?? new Date());

  if (!post.publishNow && baseAt.getTime() < Date.now() - 60_000) {
    throw new ScheduleError(["O horário agendado já passou."]);
  }

  // Stagger: no mínimo o intervalo configurado no post, e nunca menos do que
  // o piso de segurança quando a mesma conta aparece mais de uma vez.
  const stagger = Math.max(5, post.staggerSeconds);

  // Agrupa por conta para espacar publicações repetidas na mesma conta.
  const perAccountCount = new Map<string, number>();

  const plan = activeTargets.map((t, index) => {
    const seen = perAccountCount.get(t.accountId) ?? 0;
    perAccountCount.set(t.accountId, seen + 1);

    const spreadMs = index * stagger * 1000;
    const sameAccountMs = seen * MIN_SECONDS_BETWEEN_PUBLISHES * 1000;
    const at = new Date(baseAt.getTime() + spreadMs + sameAccountMs);
    return { target: t, at };
  });

  await prisma.$transaction(async (tx) => {
    for (const { target, at } of plan) {
      await tx.postTarget.update({
        where: { id: target.id },
        data: {
          status: "QUEUED",
          scheduledAt: at,
          attempts: 0,
          pollAttempts: 0,
          lastError: null,
          lastErrorCode: null,
          nextRetryAt: null,
          containerId: null,
          containerCreatedAt: null,
          childContainerIds: [],
        },
      });
    }
    // Contas inativas ficam explicitamente marcadas, não somem em silêncio.
    if (inactive.length > 0) {
      await tx.postTarget.updateMany({
        where: { id: { in: inactive.map((t) => t.id) } },
        data: {
          status: "SKIPPED",
          lastError: "Conta inativa no momento do agendamento.",
          lastErrorCode: "account_inactive",
        },
      });
    }
    await tx.post.update({
      where: { id: postId },
      data: {
        status: post.publishNow ? "PUBLISHING" : "SCHEDULED",
        scheduledAt: baseAt,
      },
    });
  });

  for (const { target, at } of plan) {
    await enqueuePublish(target.id, { delayMs: Math.max(0, at.getTime() - Date.now()) });
  }

  const times = plan.map((p) => p.at.getTime());
  return {
    postId,
    queued: plan.length,
    firstAt: new Date(Math.min(...times)),
    lastAt: new Date(Math.max(...times)),
    warnings,
  };
}

/** Cancela um post agendado e todos os jobs pendentes dele. */
export async function cancelPost(postId: string): Promise<number> {
  const targets = await prisma.postTarget.findMany({
    where: {
      postId,
      status: { in: ["PENDING", "QUEUED", "CREATING_CONTAINER", "WAITING_CONTAINER"] },
    },
    select: { id: true },
  });

  for (const t of targets) await cancelPublish(t.id);

  await prisma.postTarget.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { status: "CANCELED", nextRetryAt: null },
  });
  await prisma.post.update({ where: { id: postId }, data: { status: "CANCELED" } });

  return targets.length;
}

/** Recoloca na fila apenas os destinos que falharam. */
export async function retryFailedTargets(postId: string): Promise<number> {
  const failed = await prisma.postTarget.findMany({
    where: { postId, status: "FAILED" },
    include: { account: true },
  });

  const retryable = failed.filter((t) => t.account.status === "ACTIVE");
  let delayMs = 0;

  for (const t of retryable) {
    await prisma.postTarget.update({
      where: { id: t.id },
      data: {
        status: "QUEUED",
        attempts: 0,
        pollAttempts: 0,
        lastError: null,
        lastErrorCode: null,
        nextRetryAt: null,
        containerId: null,
        containerCreatedAt: null,
        childContainerIds: [],
      },
    });
    await enqueuePublish(t.id, { delayMs });
    delayMs += 10_000;
  }

  if (retryable.length > 0) {
    await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHING" } });
  }
  return retryable.length;
}
