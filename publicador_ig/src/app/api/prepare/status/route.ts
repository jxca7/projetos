import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";

/** Jobs de preparar conta recentes, com o estado de cada conta. */
export async function GET() {
  const ctx = await requireContext();

  const jobs = await prisma.prepareJob.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      targets: {
        orderBy: { username: "asc" },
        select: { id: true, username: true, status: true, error: true },
      },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      imageUrl: j.imageUrl,
      bio: j.bio,
      storyImageUrl: j.storyImageUrl,
      storyLink: j.storyLink,
      createdAt: j.createdAt.toISOString(),
      targets: j.targets,
    })),
  });
}
