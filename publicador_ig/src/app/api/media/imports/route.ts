import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";

/** Lista as importações recentes do workspace, para o acompanhamento ao vivo. */
export async function GET() {
  const ctx = await requireContext();

  const rows = await prisma.mediaImport.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { asset: { select: { thumbnailUrl: true, publicUrl: true, kind: true } } },
  });

  return NextResponse.json({
    imports: rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      account: r.account,
      sourceUrl: r.sourceUrl,
      status: r.status,
      title: r.title,
      error: r.error,
      downloaded: r.downloaded,
      skipped: r.skipped,
      thumbnailUrl: r.asset?.thumbnailUrl ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
