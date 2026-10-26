import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { Empty, Notice, SectionTitle } from "@/components/ui";
import { MIN_SECONDS_BETWEEN_PUBLISHES } from "@/lib/publishing/pacing";
import { Composer } from "./composer";

export const metadata = { title: "Publicar · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function PublicarPage() {
  const ctx = await requireContext();

  if (!canEdit(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não permite publicar.</Notice>;
  }

  const [accounts, folders, libraryMedia] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
      orderBy: { igUsername: "asc" },
      select: {
        id: true,
        igUsername: true,
        profilePicUrl: true,
        followersCount: true,
        quotaUsage: true,
        quotaTotal: true,
        folderId: true,
      },
    }),
    prisma.accountFolder.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      // Só contas ativas contam: pasta cheia de conta off engana na hora de escolher.
      include: { _count: { select: { accounts: { where: { status: "ACTIVE" } } } } },
    }),
    prisma.mediaAsset.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
      take: 60,
      select: {
        id: true, kind: true, publicUrl: true, thumbnailUrl: true,
        durationMs: true, sizeBytes: true, width: true, height: true, originalName: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Novo post"
        hint="Mesma mídia em várias contas, com legenda própria por conta e intervalo entre elas."
      />

      {accounts.length === 0 ? (
        <Empty
          title="Conecte uma conta primeiro"
          hint="Você precisa de pelo menos uma conta profissional ativa para publicar."
        />
      ) : (
        <Composer
          accounts={accounts}
          folders={folders.map((f) => ({ id: f.id, name: f.name, count: f._count.accounts }))}
          libraryMedia={libraryMedia}
          minSecondsBetweenPublishes={MIN_SECONDS_BETWEEN_PUBLISHES}
        />
      )}

      {accounts.length === 0 ? (
        <Link href="/contas" className="text-sm text-accent hover:underline">
          Ir para Contas
        </Link>
      ) : null}
    </div>
  );
}
