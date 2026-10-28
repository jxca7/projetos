import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { Notice, SectionTitle } from "@/components/ui";
import { PrepareTestForm, type PrepareTestJob } from "./prepare-test-form";

export const metadata = { title: "Preparar conta (teste) · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function PrepararTestePage() {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não prepara contas.</Notice>;
  }

  const rows = await prisma.prepareTestJob.findMany({
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

  const initialJobs: PrepareTestJob[] = rows.map((j) => ({
    id: j.id,
    appId: j.appId,
    createdAt: j.createdAt.toISOString(),
    targets: j.targets,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Preparar conta (teste)"
        hint="Aceita o convite do testador pelo instagrapi, sem navegador. Experimental, à parte do Preparar conta."
      />
      <PrepareTestForm initialJobs={initialJobs} />
    </div>
  );
}
