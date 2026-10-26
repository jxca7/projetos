import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { MediaLibrary, type MediaItem } from "./library";
import { ReelImporter, type ImportRow } from "./importer";

export const metadata = { title: "Biblioteca · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function BibliotecaPage() {
  const ctx = await requireContext();
  const podeEditar = canEdit(ctx.role);

  const [rows, importRows, cookie] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { postMedia: true } } },
    }),
    podeEditar
      ? prisma.mediaImport.findMany({
          where: { workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 40,
          include: { asset: { select: { thumbnailUrl: true } } },
        })
      : Promise.resolve([]),
    podeEditar
      ? prisma.instagramCookie.findUnique({ where: { workspaceId: ctx.workspaceId } })
      : Promise.resolve(null),
  ]);

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

  const initialImports: ImportRow[] = importRows.map((r) => ({
    id: r.id,
    sourceUrl: r.sourceUrl,
    status: r.status,
    title: r.title,
    error: r.error,
    thumbnailUrl: r.asset?.thumbnailUrl ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-5">
      {podeEditar ? (
        <ReelImporter
          initialImports={initialImports}
          cookie={{ configured: Boolean(cookie), label: cookie?.label ?? null }}
        />
      ) : null}
      <MediaLibrary initial={initial} />
    </div>
  );
}
