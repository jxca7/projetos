import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { Notice, SectionTitle } from "@/components/ui";
import { BulkForm, type BulkMedia, type BulkAccount } from "./massa-form";

export const metadata = { title: "Postagem em Massa · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function MassaPage() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não publica.</Notice>;
  }

  const [mediaRows, accountRows] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
    }),
    prisma.socialAccount.findMany({
      where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
      orderBy: { igUsername: "asc" },
      select: { id: true, igUsername: true, profilePicUrl: true },
    }),
  ]);

  const media: BulkMedia[] = mediaRows.map((m) => ({
    id: m.id,
    kind: m.kind,
    publicUrl: m.publicUrl,
    thumbnailUrl: m.thumbnailUrl,
    originalName: m.originalName,
    sizeBytes: m.sizeBytes,
    durationMs: m.durationMs,
  }));

  const accounts: BulkAccount[] = accountRows.map((a) => ({
    id: a.id,
    igUsername: a.igUsername,
    profilePicUrl: a.profilePicUrl,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Postagem em Massa"
        hint="Publique Reels, Posts ou Stories nas contas conectadas, uma de cada vez, com intervalo."
      />
      <BulkForm media={media} accounts={accounts} />
    </div>
  );
}
