"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { requireContext, canEdit, canManageAccounts } from "@/lib/session";
import { schedulePost, cancelPost, retryFailedTargets, ScheduleError } from "@/lib/publishing/scheduler";
import { maintenanceQueue, enqueueImport, enqueueStoryApp } from "@/lib/queue";
import { isInstagramUrl, isInstagramHandle, normalizeHandle } from "@/lib/media/download";

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

// ---------------------------------------------------------------------------
// Apps do Meta
// ---------------------------------------------------------------------------

const metaAppSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao app.").max(60),
  loginFlow: z.enum(["INSTAGRAM_LOGIN", "FACEBOOK_LOGIN"]).default("INSTAGRAM_LOGIN"),
  facebookAppId: z
    .string()
    .trim()
    .regex(/^\d{6,25}$/, "O App ID do Facebook é só números.")
    .optional()
    .or(z.literal("")),
  appId: z
    .string()
    .trim()
    .regex(/^\d{6,25}$/, "O App ID é só números."),
  appSecret: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{32}$/, "O App Secret tem 32 caracteres hexadecimais."),
  graphVersion: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/, "A versão da Graph API tem o formato v23.0.")
    .default("v23.0"),
  notes: z.string().trim().max(300).optional(),
});

export type MetaAppInput = z.input<typeof metaAppSchema>;

export async function saveMetaAppAction(input: MetaAppInput, metaAppDbId?: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const parsed = metaAppSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const clash = await prisma.metaApp.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      appId: data.appId,
      ...(metaAppDbId ? { id: { not: metaAppDbId } } : {}),
    },
  });
  if (clash) {
    return { ok: false as const, error: `O App ID ${data.appId} já está cadastrado.` };
  }

  if (metaAppDbId) {
    const existing = await prisma.metaApp.findFirst({
      where: { id: metaAppDbId, workspaceId: ctx.workspaceId },
    });
    if (!existing) return { ok: false as const, error: "App não encontrado." };

    await prisma.metaApp.update({
      where: { id: metaAppDbId },
      data: {
        name: data.name,
        loginFlow: data.loginFlow,
        appId: data.appId,
        facebookAppId: data.facebookAppId || null,
        appSecretEnc: encryptSecret(data.appSecret),
        graphVersion: data.graphVersion,
        notes: data.notes || null,
      },
    });
    revalidatePath("/apps-meta");
    return { ok: true as const, metaAppId: metaAppDbId };
  }

  const total = await prisma.metaApp.count({ where: { workspaceId: ctx.workspaceId } });
  const created = await prisma.metaApp.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: data.name,
      loginFlow: data.loginFlow,
      appId: data.appId,
      facebookAppId: data.facebookAppId || null,
      appSecretEnc: encryptSecret(data.appSecret),
      graphVersion: data.graphVersion,
      notes: data.notes || null,
      // O primeiro app vira o ativo: sem isso nada conecta.
      isActive: total === 0,
    },
  });

  revalidatePath("/apps-meta");
  revalidatePath("/contas");
  return { ok: true as const, metaAppId: created.id };
}

export async function activateMetaAppAction(metaAppDbId: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const app = await prisma.metaApp.findFirst({
    where: { id: metaAppDbId, workspaceId: ctx.workspaceId },
  });
  if (!app) return { ok: false as const, error: "App não encontrado." };

  // Só um ativo por workspace: é ele que assina as próximas conexões.
  await prisma.$transaction([
    prisma.metaApp.updateMany({
      where: { workspaceId: ctx.workspaceId },
      data: { isActive: false },
    }),
    prisma.metaApp.update({ where: { id: metaAppDbId }, data: { isActive: true } }),
  ]);

  revalidatePath("/apps-meta");
  return { ok: true as const };
}

/**
 * Apaga o cadastro do app.
 *
 * As contas conectadas por ele continuam no banco, mas param de publicar: o
 * token delas só é aceito pela Meta com o secret desse app. Por isso o aviso
 * é explícito e as contas afetadas são marcadas.
 */
export async function deleteMetaAppAction(metaAppDbId: string) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const app = await prisma.metaApp.findFirst({
    where: { id: metaAppDbId, workspaceId: ctx.workspaceId },
    include: { _count: { select: { accounts: true } } },
  });
  if (!app) return { ok: false as const, error: "App não encontrado." };

  const afetadas = app._count.accounts;

  await prisma.$transaction(async (tx) => {
    if (afetadas > 0) {
      await tx.socialAccount.updateMany({
        where: { metaAppId: metaAppDbId },
        data: {
          status: "TOKEN_EXPIRED",
          statusMessage:
            "O app do Meta que conectou esta conta foi removido. Reconecte pelo app ativo.",
        },
      });
    }
    await tx.metaApp.delete({ where: { id: metaAppDbId } });

    // Se o ativo saiu, promove outro para o painel não ficar sem app.
    const restantes = await tx.metaApp.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
    });
    if (restantes.length > 0 && !restantes.some((a) => a.isActive)) {
      await tx.metaApp.update({ where: { id: restantes[0].id }, data: { isActive: true } });
    }
  });

  revalidatePath("/apps-meta");
  revalidatePath("/contas");
  revalidatePath("/contas-off");
  return { ok: true as const, afetadas };
}

// ---------------------------------------------------------------------------
// Biblioteca de mídia
// ---------------------------------------------------------------------------

export async function toggleMediaFavoriteAction(mediaId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspaceId },
  });
  if (!asset) return { ok: false as const, error: "Mídia não encontrada." };

  const atualizado = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { favorite: !asset.favorite },
  });
  revalidatePath("/biblioteca");
  return { ok: true as const, favorite: atualizado.favorite };
}

/**
 * Apaga uma mídia da biblioteca e seus arquivos no storage.
 * Mídia usada por um post publicado não pode ser apagada (o histórico quebraria).
 */
export async function deleteMediaAction(mediaId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspaceId },
    include: { _count: { select: { postMedia: true } } },
  });
  if (!asset) return { ok: false as const, error: "Mídia não encontrada." };

  if (asset._count.postMedia > 0) {
    return {
      ok: false as const,
      error: `Em uso por ${asset._count.postMedia} post(s). Remova dos posts antes de apagar.`,
    };
  }

  // Apaga os arquivos primeiro; se o storage falhar, o registro fica para nova tentativa.
  const { storage } = await import("@/lib/storage");
  try {
    await storage().delete(asset.storageKey);
    if (asset.thumbnailKey) await storage().delete(asset.thumbnailKey);
  } catch {
    /* arquivo pode já não existir; segue para remover o registro */
  }

  await prisma.mediaAsset.delete({ where: { id: mediaId } });
  revalidatePath("/biblioteca");
  revalidatePath("/publicar");
  return { ok: true as const };
}

/**
 * Remove duplicatas: mídias com o mesmo checksum, mantendo a mais antiga (e as
 * que estão em uso). Útil para limpar uploads repetidos de antes do dedup.
 */
export async function removeDuplicateMediaAction() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const assets = await prisma.mediaAsset.findMany({
    where: { workspaceId: ctx.workspaceId, checksum: { not: null } },
    include: { _count: { select: { postMedia: true } } },
    orderBy: { createdAt: "asc" },
  });

  const vistos = new Set<string>();
  const apagar: typeof assets = [];
  for (const a of assets) {
    const chave = a.checksum as string;
    if (vistos.has(chave)) {
      if (a._count.postMedia === 0) apagar.push(a); // nunca remove o que está em uso
    } else {
      vistos.add(chave);
    }
  }

  const { storage } = await import("@/lib/storage");
  for (const a of apagar) {
    try {
      await storage().delete(a.storageKey);
      if (a.thumbnailKey) await storage().delete(a.thumbnailKey);
    } catch {
      /* segue */
    }
    await prisma.mediaAsset.delete({ where: { id: a.id } });
  }

  revalidatePath("/biblioteca");
  return { ok: true as const, removed: apagar.length };
}

// ---------------------------------------------------------------------------
// Importação de Reels do Instagram para a biblioteca
// ---------------------------------------------------------------------------

const MAX_URLS_POR_VEZ = 50;

/** O downloader precisa do login da conta; sem cookie nada baixa. */
async function exigirCookie(workspaceId: string): Promise<string | null> {
  const jar = await prisma.instagramCookie.findUnique({ where: { workspaceId } });
  return jar
    ? null
    : "Configure o cookie da conta do Instagram (botão \"Configurar cookie\") antes de importar.";
}

/** Enfileira o download de um ou vários Reels/posts do Instagram. */
export async function importReelsAction(input: { urls: string[] }) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão para importar mídia." };

  const semCookie = await exigirCookie(ctx.workspaceId);
  if (semCookie) return { ok: false as const, error: semCookie };

  // Normaliza, remove vazios e duplicatas, e separa o que não é link do Instagram.
  const brutos = (input.urls ?? [])
    .map((u) => u.trim())
    .filter(Boolean);
  const vistos = new Set<string>();
  const validas: string[] = [];
  let invalidas = 0;
  for (const u of brutos) {
    if (vistos.has(u)) continue;
    vistos.add(u);
    if (isInstagramUrl(u)) validas.push(u);
    else invalidas++;
  }

  if (validas.length === 0) {
    return { ok: false as const, error: "Nenhum link válido do Instagram.", invalid: invalidas };
  }
  if (validas.length > MAX_URLS_POR_VEZ) {
    return {
      ok: false as const,
      error: `São ${validas.length} links de uma vez. O limite é ${MAX_URLS_POR_VEZ} por envio.`,
    };
  }

  let enfileiradas = 0;
  for (const url of validas) {
    const imp = await prisma.mediaImport.create({
      data: {
        workspaceId: ctx.workspaceId,
        mode: "LINK",
        sourceUrl: url,
        status: "QUEUED",
        createdById: ctx.userId,
      },
    });
    await enqueueImport(imp.id);
    enfileiradas++;
  }

  revalidatePath("/biblioteca");
  return { ok: true as const, queued: enfileiradas, invalid: invalidas };
}

const profileImportSchema = z.object({
  account: z.string().min(1),
  conteudo: z.enum(["reels", "destaques", "ambos"]).default("reels"),
  quantidade: z.coerce.number().int().min(0).max(1000).default(0),
  criterio: z.enum(["recentes", "vistos", "curtidos"]).default("recentes"),
  analisar: z.coerce.number().int().min(0).max(1000).default(0),
  quaisDestaques: z.string().max(100).optional().default(""),
  pausa: z.coerce.number().min(1).max(60).default(4),
  semLegenda: z.boolean().default(false),
});

export type ProfileImportInput = z.input<typeof profileImportSchema>;

/** Enfileira o download de um PERFIL inteiro (reels e/ou destaques). */
export async function importProfileAction(input: ProfileImportInput) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão para importar mídia." };

  const semCookie = await exigirCookie(ctx.workspaceId);
  if (semCookie) return { ok: false as const, error: semCookie };

  const parsed = profileImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Opções inválidas. Confira os campos." };
  }
  const o = parsed.data;

  const conta = normalizeHandle(o.account);
  if (!isInstagramHandle(conta)) {
    return { ok: false as const, error: "Conta inválida. Use o @ (sem o arroba) ou o link do perfil." };
  }

  const imp = await prisma.mediaImport.create({
    data: {
      workspaceId: ctx.workspaceId,
      mode: "PROFILE",
      account: conta,
      status: "QUEUED",
      createdById: ctx.userId,
      title: `@${conta}: na fila`,
      options: {
        conteudo: o.conteudo,
        quantidade: o.quantidade,
        criterio: o.criterio,
        analisar: o.analisar,
        quaisDestaques: o.quaisDestaques?.trim() || undefined,
        pausa: o.pausa,
        semLegenda: o.semLegenda,
      },
    },
  });
  await enqueueImport(imp.id);

  revalidatePath("/biblioteca");
  return { ok: true as const, account: conta };
}

/** Reenfileira uma importação que falhou. */
export async function retryImportAction(importId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const imp = await prisma.mediaImport.findFirst({
    where: { id: importId, workspaceId: ctx.workspaceId },
  });
  if (!imp) return { ok: false as const, error: "Importação não encontrada." };

  await prisma.mediaImport.update({
    where: { id: imp.id },
    data: { status: "QUEUED", error: null },
  });
  await enqueueImport(imp.id);
  revalidatePath("/biblioteca");
  return { ok: true as const };
}

/** Limpa da lista as importações já concluídas ou com erro. */
export async function clearImportsAction() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const r = await prisma.mediaImport.deleteMany({
    where: { workspaceId: ctx.workspaceId, status: { in: ["DONE", "DUPLICATE", "FAILED"] } },
  });
  revalidatePath("/biblioteca");
  return { ok: true as const, removed: r.count };
}

/** Salva (cifrado) o cookies.txt do Instagram usado nos downloads com login. */
export async function saveIgCookiesAction(input: { cookies: string; label?: string }) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const cookies = (input.cookies ?? "").trim();
  // Checagem de sanidade: é mesmo um cookies.txt do Instagram?
  if (cookies.length < 50 || !cookies.toLowerCase().includes("instagram")) {
    return {
      ok: false as const,
      error: "Isso não parece um cookies.txt do Instagram. Exporte com a extensão e cole o conteúdo inteiro.",
    };
  }

  const label = (input.label ?? "").trim().slice(0, 80) || null;
  const cookiesEnc = encryptSecret(cookies);
  await prisma.instagramCookie.upsert({
    where: { workspaceId: ctx.workspaceId },
    create: { workspaceId: ctx.workspaceId, cookiesEnc, label },
    update: { cookiesEnc, label },
  });
  revalidatePath("/biblioteca");
  return { ok: true as const };
}

/** Remove o cookie salvo. */
export async function clearIgCookiesAction() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  await prisma.instagramCookie.deleteMany({ where: { workspaceId: ctx.workspaceId } });
  revalidatePath("/biblioteca");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Story com link e destaque (pelo app — instagrapi, login por usuário e senha)
// ---------------------------------------------------------------------------

const MAX_CONTAS_STORY = 100;

/** Lê o textarea "usuario:senha" (uma por linha), ignorando vazios e duplicatas. */
function parseContas(texto: string): { usuario: string; senha: string }[] {
  const vistos = new Set<string>();
  const contas: { usuario: string; senha: string }[] = [];
  for (const linha of (texto ?? "").split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#") || !l.includes(":")) continue;
    const i = l.indexOf(":");
    const usuario = l.slice(0, i).trim().replace(/^@/, "").toLowerCase();
    const senha = l.slice(i + 1).trim();
    if (!usuario || !senha || vistos.has(usuario)) continue;
    vistos.add(usuario);
    contas.push({ usuario, senha });
  }
  return contas;
}

export async function createStoryAppJobAction(input: {
  mediaId: string;
  link?: string;
  linkLabel?: string;
  highlight?: string;
  proxy?: string;
  accounts: string;
}) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão para postar." };

  const contas = parseContas(input.accounts);
  if (contas.length === 0) {
    return { ok: false as const, error: "Informe ao menos uma conta no formato usuario:senha." };
  }
  if (contas.length > MAX_CONTAS_STORY) {
    return { ok: false as const, error: `Máximo de ${MAX_CONTAS_STORY} contas por vez.` };
  }

  const link = (input.link ?? "").trim();
  if (link && !/^https?:\/\//i.test(link)) {
    return { ok: false as const, error: "O link precisa começar com http:// ou https://" };
  }

  // Proxy opcional: host:porta, host:porta:usuario:senha ou http://user:senha@host:porta
  const proxy = (input.proxy ?? "").trim();
  if (proxy && !/^(https?|socks5h?):\/\//i.test(proxy) && !/^[^\s:]+:\d+(:[^\s:]+:[^\s]+)?$/.test(proxy)) {
    return {
      ok: false as const,
      error: "Proxy inválido. Use host:porta, host:porta:usuario:senha ou http://user:senha@host:porta",
    };
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: input.mediaId, workspaceId: ctx.workspaceId },
  });
  if (!asset) return { ok: false as const, error: "Imagem não encontrada nesta conta." };
  if (asset.kind !== "IMAGE") {
    return { ok: false as const, error: "O story aqui usa uma imagem (JPG/PNG)." };
  }

  const job = await prisma.storyAppJob.create({
    data: {
      workspaceId: ctx.workspaceId,
      imageKey: asset.storageKey,
      imageUrl: asset.publicUrl,
      link: link || null,
      linkLabel: (input.linkLabel ?? "").trim() || null,
      highlight: (input.highlight ?? "").trim() || null,
      proxyEnc: proxy ? encryptSecret(proxy) : null,
      createdById: ctx.userId,
      targets: {
        create: contas.map((c) => ({
          username: c.usuario,
          passwordEnc: encryptSecret(c.senha),
        })),
      },
    },
    include: { targets: { select: { id: true } } },
  });

  for (const t of job.targets) await enqueueStoryApp(t.id);

  revalidatePath("/story-link");
  return { ok: true as const, jobId: job.id, contas: contas.length };
}

/** Reenfileira o story de uma conta que falhou. */
export async function retryStoryTargetAction(targetId: string) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  const target = await prisma.storyAppTarget.findFirst({
    where: { id: targetId, job: { workspaceId: ctx.workspaceId } },
  });
  if (!target) return { ok: false as const, error: "Não encontrado." };

  await prisma.storyAppTarget.update({
    where: { id: target.id },
    data: { status: "QUEUED", error: null },
  });
  await enqueueStoryApp(target.id);
  revalidatePath("/story-link");
  return { ok: true as const };
}

/** Apaga os jobs de story já finalizados (e, com eles, as senhas cifradas). */
export async function clearStoryJobsAction() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) return { ok: false as const, error: "Sem permissão." };

  // Só remove jobs sem nenhuma conta ainda em andamento.
  const jobs = await prisma.storyAppJob.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { targets: { select: { status: true } } },
  });
  const finalizados = jobs
    .filter((j) => j.targets.every((t) => t.status === "DONE" || t.status === "FAILED" || t.status === "SKIPPED_2FA"))
    .map((j) => j.id);
  if (finalizados.length) {
    await prisma.storyAppJob.deleteMany({ where: { id: { in: finalizados } } });
  }
  revalidatePath("/story-link");
  return { ok: true as const, removed: finalizados.length };
}
