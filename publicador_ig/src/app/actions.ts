"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireContext, canEdit, canManageAccounts } from "@/lib/session";
import { schedulePost, cancelPost, retryFailedTargets, ScheduleError } from "@/lib/publishing/scheduler";
import { maintenanceQueue } from "@/lib/queue";

/** Garante que o recurso pertence ao workspace do usuário logado. */
async function ownedPost(postId: string, workspaceId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new Error("Post não encontrado neste workspace.");
  return post;
}

const createPostSchema = z.object({
  type: z.enum(["REEL", "IMAGE", "CAROUSEL", "STORY"]),
  caption: z.string().max(5000).default(""),
  storyLink: z.string().url().optional().or(z.literal("")),
  scheduledAt: z.string().optional(),
  publishNow: z.boolean().default(false),
  staggerSeconds: z.coerce.number().int().min(5).max(3600).default(90),
  shareToFeed: z.boolean().default(true),
  mediaIds: z.array(z.string().min(1)).min(1),
  accountIds: z.array(z.string().min(1)).min(1),
  captionOverrides: z.record(z.string(), z.string()).default({}),
  requiresApproval: z.boolean().default(false),
});

export type CreatePostInput = z.input<typeof createPostSchema>;

export async function createAndSchedulePost(input: CreatePostInput) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, errors: ["Sem permissão para publicar."] };

  const parsed = createPostSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const data = parsed.data;

  // Mídia e contas tem que ser do próprio workspace.
  const [media, accounts] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { id: { in: data.mediaIds }, workspaceId: ctx.workspaceId },
    }),
    prisma.socialAccount.findMany({
      where: { id: { in: data.accountIds }, workspaceId: ctx.workspaceId },
    }),
  ]);

  if (media.length !== data.mediaIds.length) {
    return { ok: false as const, errors: ["Alguma mídia selecionada não pertence a este workspace."] };
  }
  if (accounts.length !== data.accountIds.length) {
    return { ok: false as const, errors: ["Alguma conta selecionada não pertence a este workspace."] };
  }

  const orderedMedia = data.mediaIds
    .map((id, position) => ({ mediaId: id, position }))
    .filter((m) => media.some((x) => x.id === m.mediaId));

  const post = await prisma.post.create({
    data: {
      workspaceId: ctx.workspaceId,
      authorId: ctx.userId,
      type: data.type,
      caption: data.caption,
      storyLink: data.storyLink || null,
      shareToFeed: data.shareToFeed,
      staggerSeconds: data.staggerSeconds,
      publishNow: data.publishNow,
      scheduledAt: data.publishNow
        ? new Date()
        : data.scheduledAt
          ? new Date(data.scheduledAt)
          : null,
      requiresApproval: data.requiresApproval,
      media: { create: orderedMedia },
      targets: {
        create: accounts.map((a) => ({
          accountId: a.id,
          captionOverride: data.captionOverrides[a.id]?.trim() || null,
        })),
      },
    },
  });

  // Post que precisa de aprovação fica parado até alguem aprovar.
  if (data.requiresApproval) {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "PENDING_APPROVAL" },
    });
    revalidatePath("/fila");
    return { ok: true as const, postId: post.id, queued: 0, warnings: [], pendingApproval: true };
  }

  try {
    const result = await schedulePost(post.id);
    revalidatePath("/fila");
    revalidatePath("/");
    return {
      ok: true as const,
      postId: post.id,
      queued: result.queued,
      warnings: result.warnings,
      pendingApproval: false,
    };
  } catch (e) {
    // O post fica como rascunho para a pessoa corrigir sem perder o trabalho.
    if (e instanceof ScheduleError) {
      return { ok: false as const, errors: e.issues, postId: post.id };
    }
    throw e;
  }
}

export async function approveAndSchedule(postId: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) {
    return { ok: false as const, errors: ["Somente admin ou dono aprova post."] };
  }
  await ownedPost(postId, ctx.workspaceId);

  await prisma.post.update({
    where: { id: postId },
    data: { approvedAt: new Date(), approvedById: ctx.userId },
  });

  try {
    const r = await schedulePost(postId);
    revalidatePath("/fila");
    return { ok: true as const, queued: r.queued, warnings: r.warnings };
  } catch (e) {
    if (e instanceof ScheduleError) return { ok: false as const, errors: e.issues };
    throw e;
  }
}

export async function cancelPostAction(postId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, errors: ["Sem permissão."] };
  await ownedPost(postId, ctx.workspaceId);

  const canceled = await cancelPost(postId);
  revalidatePath("/fila");
  revalidatePath(`/posts/${postId}`);
  return { ok: true as const, canceled };
}

export async function retryPostAction(postId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, errors: ["Sem permissão."] };
  await ownedPost(postId, ctx.workspaceId);

  const retried = await retryFailedTargets(postId);
  revalidatePath(`/posts/${postId}`);
  return { ok: true as const, retried };
}

export async function disconnectAccountAction(accountId: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const };

  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspaceId },
  });
  if (!account) return { ok: false as const };

  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { status: "DISABLED", statusMessage: "Desconectada pelo usuário." },
  });
  revalidatePath("/contas");
  return { ok: true as const };
}

export async function refreshQuotaAction(accountId: string) {
  const ctx = await requireContext();
  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspaceId },
  });
  if (!account) return { ok: false as const };

  await maintenanceQueue().add("refresh-account-quota", {
    kind: "refresh-account-quota",
    accountId,
  });
  revalidatePath("/contas");
  return { ok: true as const };
}

export async function completeReminderAction(reminderId: string) {
  const ctx = await requireContext();
  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, account: { workspaceId: ctx.workspaceId } },
  });
  if (!reminder) return { ok: false as const };

  await prisma.reminder.update({ where: { id: reminderId }, data: { status: "DONE" } });
  revalidatePath("/pendencias");
  return { ok: true as const };
}

export async function goToPost(postId: string) {
  redirect(`/posts/${postId}`);
}

// ---------------------------------------------------------------------------
// Pastas de contas
// ---------------------------------------------------------------------------

const folderNameSchema = z
  .string()
  .trim()
  .min(1, "A pasta precisa de um nome.")
  .max(40, "Nome de pasta muito longo (máximo 40).");

export async function createFolderAction(name: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const parsed = folderNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const existing = await prisma.accountFolder.findFirst({
    where: { workspaceId: ctx.workspaceId, name: parsed.data },
  });
  if (existing) return { ok: false as const, error: `Já existe uma pasta chamada "${parsed.data}".` };

  const count = await prisma.accountFolder.count({ where: { workspaceId: ctx.workspaceId } });
  const folder = await prisma.accountFolder.create({
    data: { workspaceId: ctx.workspaceId, name: parsed.data, position: count },
  });

  revalidatePath("/contas");
  revalidatePath("/publicar");
  return { ok: true as const, folderId: folder.id };
}

export async function renameFolderAction(folderId: string, name: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const parsed = folderNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const folder = await prisma.accountFolder.findFirst({
    where: { id: folderId, workspaceId: ctx.workspaceId },
  });
  if (!folder) return { ok: false as const, error: "Pasta não encontrada." };

  const clash = await prisma.accountFolder.findFirst({
    where: { workspaceId: ctx.workspaceId, name: parsed.data, id: { not: folderId } },
  });
  if (clash) return { ok: false as const, error: `Já existe uma pasta chamada "${parsed.data}".` };

  await prisma.accountFolder.update({ where: { id: folderId }, data: { name: parsed.data } });
  revalidatePath("/contas");
  revalidatePath("/publicar");
  return { ok: true as const };
}

/** Apaga a pasta. As contas voltam para "sem pasta" — nenhuma conta é removida. */
export async function deleteFolderAction(folderId: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const folder = await prisma.accountFolder.findFirst({
    where: { id: folderId, workspaceId: ctx.workspaceId },
  });
  if (!folder) return { ok: false as const, error: "Pasta não encontrada." };

  await prisma.accountFolder.delete({ where: { id: folderId } });
  revalidatePath("/contas");
  revalidatePath("/publicar");
  return { ok: true as const };
}

export async function assignAccountsToFolderAction(
  accountIds: string[],
  folderId: string | null,
) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };
  if (accountIds.length === 0) return { ok: false as const, error: "Nenhuma conta selecionada." };

  if (folderId) {
    const folder = await prisma.accountFolder.findFirst({
      where: { id: folderId, workspaceId: ctx.workspaceId },
    });
    if (!folder) return { ok: false as const, error: "Pasta não encontrada." };
  }

  const result = await prisma.socialAccount.updateMany({
    // O filtro por workspace impede mover conta de outro workspace.
    where: { id: { in: accountIds }, workspaceId: ctx.workspaceId },
    data: { folderId },
  });

  revalidatePath("/contas");
  revalidatePath("/publicar");
  return { ok: true as const, moved: result.count };
}

// ---------------------------------------------------------------------------
// Operações em massa sobre contas
// ---------------------------------------------------------------------------

/**
 * Reativa contas que foram desligadas aqui dentro.
 *
 * Só funciona para contas DISABLED, que é o estado de quem desconectou pelo
 * painel: o token continua válido. Conta com token expirado ou revogado não
 * volta por botão — precisa passar pelo OAuth de novo, porque quem derrubou
 * o acesso foi a Meta, não nós.
 */
export async function reactivateAccountsAction(accountIds?: string[]) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const where = {
    workspaceId: ctx.workspaceId,
    status: "DISABLED" as const,
    ...(accountIds?.length ? { id: { in: accountIds } } : {}),
  };

  const candidates = await prisma.socialAccount.findMany({
    where,
    select: { id: true, tokenExpiresAt: true },
  });

  const now = new Date();
  const reusable = candidates.filter(
    (a) => a.tokenExpiresAt === null || a.tokenExpiresAt > now,
  );
  const stale = candidates.filter(
    (a) => a.tokenExpiresAt !== null && a.tokenExpiresAt <= now,
  );

  if (reusable.length > 0) {
    await prisma.socialAccount.updateMany({
      where: { id: { in: reusable.map((a) => a.id) } },
      data: { status: "ACTIVE", statusMessage: null },
    });
  }
  // As que já estavam com token vencido vão para o estado honesto.
  if (stale.length > 0) {
    await prisma.socialAccount.updateMany({
      where: { id: { in: stale.map((a) => a.id) } },
      data: {
        status: "TOKEN_EXPIRED",
        statusMessage: "Token venceu enquanto a conta estava desativada. Reconecte pelo OAuth.",
      },
    });
  }

  revalidatePath("/contas");
  revalidatePath("/contas-off");
  return { ok: true as const, reactivated: reusable.length, needsOauth: stale.length };
}

export async function disconnectAccountsAction(accountIds: string[]) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };
  if (accountIds.length === 0) return { ok: false as const, error: "Nenhuma conta selecionada." };

  const result = await prisma.socialAccount.updateMany({
    where: { id: { in: accountIds }, workspaceId: ctx.workspaceId },
    data: { status: "DISABLED", statusMessage: "Desconectada pelo usuário." },
  });

  revalidatePath("/contas");
  revalidatePath("/contas-off");
  return { ok: true as const, disconnected: result.count };
}

/** Recoloca na fila todos os destinos falhos de contas que voltaram a funcionar. */
export async function retryAllFailedAction() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const failed = await prisma.postTarget.findMany({
    where: {
      post: { workspaceId: ctx.workspaceId },
      status: "FAILED",
      account: { status: "ACTIVE" },
    },
    select: { postId: true },
    distinct: ["postId"],
  });

  let total = 0;
  for (const { postId } of failed) {
    total += await retryFailedTargets(postId);
  }

  revalidatePath("/saude");
  revalidatePath("/fila");
  return { ok: true as const, retried: total };
}
