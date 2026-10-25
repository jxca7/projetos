import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import {
  MetaApiError,
  NoMetaAppError,
  backoffMs,
  driverForAccount,
  type ErrorClass,
} from "@/lib/meta";
import type { CreateContainerInput, PostTypeName } from "@/lib/meta/types";
import { enqueueInsights, enqueuePublish } from "@/lib/queue";
import { markPublished, releaseSlot, reserveSlot } from "@/lib/publishing/pacing";

/** Container da Meta expira em 24h; recriamos com folga antes disso. */
const CONTAINER_TTL_MS = 23 * 60 * 60 * 1000;
/** Quantas vezes checamos o processamento antes de desistir da tentativa. */
const MAX_POLL_ATTEMPTS = 60;
/** Tentativas de publicação antes de marcar o target como falho. */
const MAX_ATTEMPTS = 5;

type Outcome =
  | { kind: "done" }
  | { kind: "retry"; delayMs: number; reason: string }
  | { kind: "failed"; reason: string };

async function logEvent(
  targetId: string,
  level: "info" | "warn" | "error",
  message: string,
  payload?: unknown,
) {
  await prisma.targetEvent.create({
    data: {
      targetId,
      level,
      message,
      payload: payload === undefined ? undefined : (payload as object),
    },
  });
}

function captionFor(postCaption: string, override: string | null): string {
  return (override ?? postCaption ?? "").trim();
}

/**
 * Processa um target até onde conseguir avancar e devolve o que fazer.
 *
 * O estado vive no banco, não no payload do job: se o worker morrer no meio,
 * o job reenfileirado retoma de onde parou e, principalmente, não republica
 * algo que já foi publicado.
 */
export async function processPublishTarget(targetId: string): Promise<Outcome> {
  const target = await prisma.postTarget.findUnique({
    where: { id: targetId },
    include: {
      account: true,
      post: { include: { media: { include: { media: true }, orderBy: { position: "asc" } } } },
    },
  });

  if (!target) return { kind: "done" };

  // Estados finais: nada a fazer.
  if (["PUBLISHED", "CANCELED", "SKIPPED", "FAILED"].includes(target.status)) {
    return { kind: "done" };
  }
  if (target.post.status === "CANCELED") {
    await prisma.postTarget.update({
      where: { id: targetId },
      data: { status: "CANCELED" },
    });
    return { kind: "done" };
  }

  const { account, post } = target;

  if (account.status !== "ACTIVE") {
    await failTarget(
      targetId,
      `Conta @${account.igUsername} esta ${account.status}. Reconecte a conta para publicar.`,
      "account_inactive",
    );
    return { kind: "failed", reason: "conta inativa" };
  }

  if (target.attempts >= MAX_ATTEMPTS) {
    await failTarget(
      targetId,
      target.lastError ?? `Excedeu ${MAX_ATTEMPTS} tentativas de publicação.`,
      target.lastErrorCode ?? "max_attempts",
    );
    return { kind: "failed", reason: "tentativas esgotadas" };
  }

  let accessToken: string;
  try {
    accessToken = decryptSecret(account.accessTokenEnc);
  } catch {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: "DISABLED", statusMessage: "Token não pode ser decifrado" },
    });
    await failTarget(targetId, "Token da conta ilegível. Reconecte a conta.", "token_unreadable");
    return { kind: "failed", reason: "token ilegível" };
  }

  // Cada conta fala pelo app que emitiu o token dela.
  let driver;
  try {
    driver = await driverForAccount(account.id);
  } catch (e) {
    if (e instanceof NoMetaAppError) {
      await failTarget(targetId, e.message, "no_meta_app");
      return { kind: "failed", reason: e.message };
    }
    throw e;
  }

  try {
    // ---- 1. Cota de 24h da conta ----------------------------------------
    const limit = await driver.getPublishingLimit(account.igUserId, accessToken);
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        quotaUsage: limit.quotaUsage,
        quotaTotal: limit.quotaTotal,
        quotaCheckedAt: new Date(),
      },
    });

    if (limit.quotaUsage >= limit.quotaTotal) {
      const delay = backoffMs("quota", 1);
      await prisma.postTarget.update({
        where: { id: targetId },
        data: {
          status: "QUEUED",
          nextRetryAt: new Date(Date.now() + delay),
          lastError: `Cota de publicação da conta cheia (${limit.quotaUsage}/${limit.quotaTotal} em 24h).`,
          lastErrorCode: "quota_full",
        },
      });
      await logEvent(
        targetId,
        "warn",
        `Cota cheia (${limit.quotaUsage}/${limit.quotaTotal}). Nova tentativa em ${Math.round(delay / 60000)} min.`,
      );
      return { kind: "retry", delayMs: delay, reason: "cota cheia" };
    }

    // ---- 2. Espacamento entre publicações da mesma conta ----------------
    // Só reserva quando já há o que publicar; criar container não consome cota.
    const needsSlot = target.status === "WAITING_CONTAINER" || Boolean(target.containerId);
    if (needsSlot) {
      const waitMs = await reserveSlot(account.id);
      if (waitMs > 0) {
        await prisma.postTarget.update({
          where: { id: targetId },
          data: { status: "QUEUED", nextRetryAt: new Date(Date.now() + waitMs) },
        });
        await logEvent(
          targetId,
          "info",
          `Aguardando intervalo mínimo entre posts da conta (${Math.round(waitMs / 1000)}s).`,
        );
        return { kind: "retry", delayMs: waitMs, reason: "espacamento da conta" };
      }
    }

    // ---- 3. Container: criar se não existe ou se expirou ----------------
    const containerExpired =
      target.containerCreatedAt !== null &&
      Date.now() - target.containerCreatedAt.getTime() > CONTAINER_TTL_MS;

    if (!target.containerId || containerExpired) {
      if (containerExpired) {
        await logEvent(targetId, "warn", "Container expirou (24h). Recriando.");
      }

      await prisma.postTarget.update({
        where: { id: targetId },
        data: { status: "CREATING_CONTAINER", attempts: { increment: 1 } },
      });

      const caption = captionFor(post.caption, target.captionOverride);
      const type = post.type as PostTypeName;
      const assets = post.media.map((pm) => pm.media);

      if (assets.length === 0) {
        await failTarget(targetId, "Post sem mídia anexada.", "no_media");
        return { kind: "failed", reason: "sem mídia" };
      }

      let containerId: string;
      let childIds: string[] = [];

      if (type === "CAROUSEL") {
        // Cada item do carrossel é um container próprio; o pai referência os filhos.
        childIds = [];
        for (const asset of assets.slice(0, 10)) {
          const childId = await driver.createContainer({
            igUserId: account.igUserId,
            accessToken,
            type: "CAROUSEL",
            isCarouselItem: true,
            imageUrl: asset.kind === "IMAGE" ? asset.publicUrl : undefined,
            videoUrl: asset.kind === "VIDEO" ? asset.publicUrl : undefined,
          });
          childIds.push(childId);
        }
        await prisma.postTarget.update({
          where: { id: targetId },
          data: { childContainerIds: childIds },
        });
        await logEvent(targetId, "info", `${childIds.length} itens do carrossel criados.`);

        containerId = await driver.createContainer({
          igUserId: account.igUserId,
          accessToken,
          type: "CAROUSEL",
          caption,
          children: childIds,
        });
      } else {
        const asset = assets[0];
        const input: CreateContainerInput = {
          igUserId: account.igUserId,
          accessToken,
          type,
          caption: type === "STORY" ? undefined : caption,
          imageUrl: asset.kind === "IMAGE" ? asset.publicUrl : undefined,
          videoUrl: asset.kind === "VIDEO" ? asset.publicUrl : undefined,
        };
        if (type === "REEL") {
          input.shareToFeed = post.shareToFeed;
          input.coverUrl = post.coverUrl ?? undefined;
          input.thumbOffsetMs = post.thumbOffsetMs ?? undefined;
          input.audioName = post.audioName ?? undefined;
        }
        containerId = await driver.createContainer(input);
      }

      await prisma.postTarget.update({
        where: { id: targetId },
        data: {
          containerId,
          containerCreatedAt: new Date(),
          status: "WAITING_CONTAINER",
          pollAttempts: 0,
          lastError: null,
          lastErrorCode: null,
        },
      });
      await logEvent(targetId, "info", `Container ${containerId} criado. Aguardando processamento.`);

      // Imagem fica pronta rapido; vídeo leva mais. Primeira checagem curta.
      const firstPoll = type === "REEL" ? 15_000 : 5_000;
      return { kind: "retry", delayMs: firstPoll, reason: "aguardando processamento" };
    }

    // ---- 4. Container existe: checar se processou -----------------------
    const status = await driver.getContainerStatus(target.containerId, accessToken);

    if (status.statusCode === "IN_PROGRESS") {
      const polls = target.pollAttempts + 1;
      if (polls > MAX_POLL_ATTEMPTS) {
        await failTarget(
          targetId,
          "Instagram não terminou de processar a mídia dentro do tempo limite.",
          "container_timeout",
        );
        await releaseSlot(account.id);
        return { kind: "failed", reason: "timeout de processamento" };
      }
      await prisma.postTarget.update({
        where: { id: targetId },
        data: { status: "WAITING_CONTAINER", pollAttempts: polls },
      });
      // Backoff suave: 10s nas primeiras, até 60s depois.
      const delay = Math.min(60_000, 10_000 + polls * 2_000);
      return { kind: "retry", delayMs: delay, reason: "processando" };
    }

    if (status.statusCode === "ERROR" || status.statusCode === "EXPIRED") {
      await releaseSlot(account.id);
      const msg = status.errorMessage ?? status.status ?? "Falha no processamento da mídia";
      // Container quebrado: zera para recriar na próxima tentativa.
      await prisma.postTarget.update({
        where: { id: targetId },
        data: {
          containerId: null,
          containerCreatedAt: null,
          childContainerIds: [],
          pollAttempts: 0,
          lastError: msg,
          lastErrorCode: status.statusCode.toLowerCase(),
          status: "QUEUED",
        },
      });
      await logEvent(targetId, "error", `Container ${status.statusCode}: ${msg}`);

      if (target.attempts + 1 >= MAX_ATTEMPTS) {
        await failTarget(targetId, msg, status.statusCode.toLowerCase());
        return { kind: "failed", reason: msg };
      }
      const delay = backoffMs("retryable", target.attempts + 1);
      return { kind: "retry", delayMs: delay, reason: "recriar container" };
    }

    if (status.statusCode === "PUBLISHED") {
      // Ja' estava publicado (worker caiu entre publicar e gravar).
      await prisma.postTarget.update({
        where: { id: targetId },
        data: { status: "PUBLISHED", publishedAt: target.publishedAt ?? new Date() },
      });
      await logEvent(targetId, "warn", "Container já constava como publicado na Meta.");
      await syncPostStatus(target.postId);
      return { kind: "done" };
    }

    // ---- 5. FINISHED: publicar -----------------------------------------
    // Transicao atomica: só um worker consegue sair de WAITING_CONTAINER
    // para PUBLISHING, o que impede publicação dupla.
    const claimed = await prisma.postTarget.updateMany({
      where: { id: targetId, status: { in: ["WAITING_CONTAINER", "QUEUED"] } },
      data: { status: "PUBLISHING" },
    });
    if (claimed.count === 0) {
      await logEvent(targetId, "info", "Outro worker já assumiu a publicação.");
      return { kind: "done" };
    }

    const igMediaId = await driver.publishContainer(
      account.igUserId,
      target.containerId,
      accessToken,
    );
    await markPublished(account.id);

    const permalink = await driver.getPermalink(igMediaId, accessToken);

    await prisma.postTarget.update({
      where: { id: targetId },
      data: {
        status: "PUBLISHED",
        igMediaId,
        permalink,
        publishedAt: new Date(),
        lastError: null,
        lastErrorCode: null,
        nextRetryAt: null,
      },
    });
    await logEvent(targetId, "info", `Publicado como ${igMediaId}.`, { permalink });

    // Métricas: 1h, 24h e 7d depois.
    await enqueueInsights(targetId, "1h", 60 * 60 * 1000);
    await enqueueInsights(targetId, "24h", 24 * 60 * 60 * 1000);
    await enqueueInsights(targetId, "7d", 7 * 24 * 60 * 60 * 1000);

    // Story com link: a API oficial não coloca link sticker, então avisamos
    // a pessoa para finalizar no app enquanto o Story está no ar.
    if (post.type === "STORY" && post.storyLink) {
      await prisma.reminder.create({
        data: {
          accountId: account.id,
          kind: "STORY_LINK_STICKER",
          dueAt: new Date(),
          title: `Adicionar link no Story de @${account.igUsername}`,
          body:
            "A API oficial do Instagram não permite inserir link sticker. " +
            "Abra o Story publicado no app e adicione o link manualmente.",
          link: post.storyLink,
        },
      });
      await logEvent(targetId, "warn", "Story publicado sem link sticker (limitacao da API). Reminder criado.");
    }

    await syncPostStatus(target.postId);
    return { kind: "done" };
  } catch (e) {
    await releaseSlot(account.id);
    return handleError(targetId, target.attempts, account.id, e);
  }
}

async function handleError(
  targetId: string,
  attempts: number,
  accountId: string,
  e: unknown,
): Promise<Outcome> {
  const err = e instanceof MetaApiError ? e : null;
  const message = e instanceof Error ? e.message : String(e);
  const classification: ErrorClass = err?.classification ?? "retryable";
  const code = err ? `${err.code ?? "?"}${err.subcode ? `/${err.subcode}` : ""}` : "unknown";

  await logEvent(targetId, "error", `[${classification}] ${message}`, {
    code: err?.code ?? null,
    subcode: err?.subcode ?? null,
    fbTraceId: err?.fbTraceId ?? null,
  });

  // Token morto: a conta inteira para, não só este post.
  if (classification === "auth") {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { status: "TOKEN_EXPIRED", statusMessage: message },
    });
    const stuck = await prisma.postTarget.findMany({
      where: {
        accountId,
        status: { in: ["PENDING", "QUEUED", "WAITING_CONTAINER", "CREATING_CONTAINER", "PUBLISHING"] },
      },
      select: { postId: true },
    });
    await prisma.postTarget.updateMany({
      where: {
        accountId,
        status: { in: ["PENDING", "QUEUED", "WAITING_CONTAINER", "CREATING_CONTAINER", "PUBLISHING"] },
      },
      data: {
        status: "FAILED",
        lastError: "Token da conta expirou ou foi revogado. Reconecte a conta.",
        lastErrorCode: "auth",
      },
    });
    // Os posts que dependiam desta conta precisam refletir isso no painel.
    for (const postId of new Set(stuck.map((t) => t.postId))) {
      await syncPostStatus(postId);
    }
    return { kind: "failed", reason: "token inválido" };
  }

  if (classification === "permanent" || attempts + 1 >= MAX_ATTEMPTS) {
    await failTarget(targetId, message, code);
    return { kind: "failed", reason: message };
  }

  const delay = backoffMs(classification, attempts + 1);
  await prisma.postTarget.update({
    where: { id: targetId },
    data: {
      status: "QUEUED",
      lastError: message,
      lastErrorCode: code,
      nextRetryAt: new Date(Date.now() + delay),
    },
  });
  return { kind: "retry", delayMs: delay, reason: classification };
}

async function failTarget(targetId: string, message: string, code: string): Promise<void> {
  const target = await prisma.postTarget.update({
    where: { id: targetId },
    data: { status: "FAILED", lastError: message, lastErrorCode: code, nextRetryAt: null },
  });
  await logEvent(targetId, "error", `Falhou definitivamente: ${message}`);
  await syncPostStatus(target.postId);
}

/** Deriva o status do Post a partir dos status dos seus targets. */
export async function syncPostStatus(postId: string): Promise<void> {
  const targets = await prisma.postTarget.findMany({
    where: { postId },
    select: { status: true },
  });
  if (targets.length === 0) return;

  const published = targets.filter((t) => t.status === "PUBLISHED").length;
  const failed = targets.filter((t) => t.status === "FAILED").length;
  const canceled = targets.filter((t) => t.status === "CANCELED" || t.status === "SKIPPED").length;
  const settled = published + failed + canceled;

  let status: "PUBLISHED" | "FAILED" | "PARTIALLY_PUBLISHED" | "PUBLISHING" | "CANCELED";
  if (settled < targets.length) {
    status = "PUBLISHING";
  } else if (published === targets.length) {
    status = "PUBLISHED";
  } else if (published === 0 && failed > 0) {
    status = "FAILED";
  } else if (published === 0 && canceled === targets.length) {
    status = "CANCELED";
  } else {
    status = "PARTIALLY_PUBLISHED";
  }

  await prisma.post.update({ where: { id: postId }, data: { status } });
}

/** Reenfileira o job conforme o resultado do processamento. */
export async function applyOutcome(targetId: string, outcome: Outcome): Promise<void> {
  if (outcome.kind === "retry") {
    await enqueuePublish(targetId, {
      delayMs: outcome.delayMs,
      // jobId novo a cada reagendamento: o anterior já foi consumido.
      jobId: `target-${targetId}-${Date.now()}`,
    });
  }
}
