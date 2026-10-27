import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { Notice, SectionTitle } from "@/components/ui";
import { StoryForm, type StoryJob } from "./story-form";

export const metadata = { title: "Story + link · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function StoryLinkPage() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não posta conteúdo.</Notice>;
  }

  const rows = await prisma.storyAppJob.findMany({
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

  const initialJobs: StoryJob[] = rows.map((j) => ({
    id: j.id,
    imageUrl: j.imageUrl,
    link: j.link,
    highlight: j.highlight,
    createdAt: j.createdAt.toISOString(),
    targets: j.targets,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Story com link e destaque"
        hint="Posta pelo app (login da própria conta) o que a API oficial não faz: figurinha de link e destaque."
      />
      <StoryForm initialJobs={initialJobs} />
    </div>
  );
}
