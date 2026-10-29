import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { Notice, SectionTitle } from "@/components/ui";
import { ConnectForm, type ConnectJob } from "./connect-form";

export const metadata = { title: "Conectar contas · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function ConectarPage() {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não conecta contas.</Notice>;
  }

  const rows = await prisma.connectJob.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      targets: {
        orderBy: { username: "asc" },
        select: { id: true, username: true, status: true, error: true, connected: true },
      },
    },
  });

  const initialJobs: ConnectJob[] = rows.map((j) => ({
    id: j.id,
    createdAt: j.createdAt.toISOString(),
    targets: j.targets,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Conectar contas"
        hint="O servidor faz o OAuth sozinho, logado pelo cookie de cada conta, com um IP por conta."
      />
      <ConnectForm initialJobs={initialJobs} />
    </div>
  );
}
