import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { meta, MetaApiError } from "@/lib/meta";
import type { PostTypeName } from "@/lib/meta/types";
import type { InsightsJobData } from "@/lib/queue";

/** Coleta as métricas de uma publicação e grava um snapshot. */
export async function processInsights(data: InsightsJobData): Promise<void> {
  const target = await prisma.postTarget.findUnique({
    where: { id: data.targetId },
    include: { account: true, post: { select: { type: true } } },
  });

  if (!target || !target.igMediaId || target.status !== "PUBLISHED") return;
  if (target.account.status !== "ACTIVE") return;

  let accessToken: string;
  try {
    accessToken = decryptSecret(target.account.accessTokenEnc);
  } catch {
    return;
  }

  try {
    const metrics = await meta().getInsights(
      target.igMediaId,
      accessToken,
      target.post.type as PostTypeName,
    );
    await prisma.metricSnapshot.create({
      data: {
        targetId: target.id,
        reach: metrics.reach,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saved: metrics.saved,
        totalInteractions: metrics.totalInteractions,
        raw: metrics.raw === undefined ? undefined : (metrics.raw as object),
      },
    });
  } catch (e) {
    // Métricas são secundarias: registramos e seguimos. O BullMQ repete o job.
    const message = e instanceof Error ? e.message : String(e);
    await prisma.targetEvent.create({
      data: {
        targetId: target.id,
        level: "warn",
        message: `Falha ao coletar métricas (${data.pass}): ${message}`,
      },
    });
    if (e instanceof MetaApiError && e.classification === "auth") {
      await prisma.socialAccount.update({
        where: { id: target.accountId },
        data: { status: "TOKEN_EXPIRED", statusMessage: message },
      });
      return; // não vale repetir
    }
    throw e;
  }
}
