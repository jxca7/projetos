import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { Notice, SectionTitle } from "@/components/ui";
import { PrepareForm, type PrepareJob } from "./prepare-form";

export const metadata = { title: "Preparar conta · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function PrepararPage() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não prepara contas.</Notice>;
  }

  const rows = await prisma.prepareJob.findMany({
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

  const initialJobs: PrepareJob[] = rows.map((j) => ({
    id: j.id,
    imageUrl: j.imageUrl,
    bio: j.bio,
    createdAt: j.createdAt.toISOString(),
    targets: j.targets,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Preparar conta"
        hint="Troca foto e bio pelo app (login da própria conta), no servidor. Sem abrir navegador no seu PC."
      />
      <PrepareForm initialJobs={initialJobs} />
    </div>
  );
}
