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

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
    orderBy: { igUsername: "asc" },
    select: {
      id: true,
      igUsername: true,
      followersCount: true,
      quotaUsage: true,
      quotaTotal: true,
    },
  });

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
