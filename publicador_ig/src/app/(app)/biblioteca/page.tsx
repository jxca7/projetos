import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { MediaLibrary, type MediaItem } from "./library";

export const metadata = { title: "Biblioteca · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function BibliotecaPage() {
  const ctx = await requireContext();

  const rows = await prisma.mediaAsset.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { postMedia: true } } },
  });

  const initial: MediaItem[] = rows.map((m) => ({
    id: m.id,
    kind: m.kind,
    publicUrl: m.publicUrl,
    thumbnailUrl: m.thumbnailUrl,
    durationMs: m.durationMs,
    sizeBytes: m.sizeBytes,
    width: m.width,
    height: m.height,
    originalName: m.originalName,
    favorite: m.favorite,
    usedCount: m._count.postMedia,
  }));

  return <MediaLibrary initial={initial} />;
}
