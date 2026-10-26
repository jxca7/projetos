import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { BulkOffAccounts, type OffAccount } from "./bulk";

export const metadata = { title: "Contas off · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function ContasOffPage() {
  const ctx = await requireContext();

  if (!canManageAccounts(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não gerencia contas.</Notice>;
  }

  const umDiaAtras = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [rows, falhasPorConta] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { workspaceId: ctx.workspaceId, status: { not: "ACTIVE" } },
      orderBy: [{ status: "asc" }, { igUsername: "asc" }],
      include: { folder: { select: { name: true } } },
    }),
    prisma.postTarget.groupBy({
      by: ["accountId"],
      where: {
        post: { workspaceId: ctx.workspaceId },
        status: "FAILED",
        updatedAt: { gte: umDiaAtras },
      },
      _count: { _all: true },
    }),
  ]);
  const falhas = new Map(falhasPorConta.map((f) => [f.accountId, f._count._all]));

  const now = new Date();
  const accounts: OffAccount[] = rows.map((a) => ({
    id: a.id,
    igUsername: a.igUsername,
    profilePicUrl: a.profilePicUrl,
    status: a.status,
    statusMessage: a.statusMessage,
    folderName: a.folder?.name ?? null,
    tokenExpired: a.tokenExpiresAt !== null && a.tokenExpiresAt <= now,
    tokenExpiresAt: a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : null,
    failures24h: falhas.get(a.id) ?? 0,
    timezone: ctx.timezone,
  }));

  const precisaLogin = accounts.filter((a) => a.status === "TOKEN_EXPIRED").length;
  const revogadas = accounts.filter((a) => a.status === "REVOKED").length;
  const desligadas = accounts.filter((a) => a.status === "DISABLED").length;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Contas off"
        hint="Token vencido, acesso revogado ou desligada aqui no painel."
      />

      {accounts.length === 0 ? (
        <Empty
          title="Todas as contas estão ativas"
          hint="Nada para resolver. Contas aparecem aqui assim que a Meta recusa o token ou você desliga alguma."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Total off", accounts.length, "text-danger"],
              ["Precisa login", precisaLogin, "text-warn"],
              ["Revogadas", revogadas, "text-danger"],
              ["Desligadas aqui", desligadas, "text-muted"],
            ].map(([label, value, cls]) => (
              <Card key={String(label)} className="p-4">
                <div className={`text-2xl font-semibold tabular-nums ${value === 0 ? "text-muted" : cls}`}>
                  {String(value)}
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {label}
                </div>
              </Card>
            ))}
          </div>

          <BulkOffAccounts accounts={accounts} />
        </>
      )}

      <Card className="bg-surface-2">
        <h3 className="font-medium">Por que não existe &ldquo;reconectar tudo&rdquo; num clique</h3>
        <p className="mt-2 text-sm text-muted">
          Quando a Meta invalida um token, só o dono da conta consegue autorizar de novo, pela tela
          de OAuth da própria Meta. Qualquer ferramenta que prometa reconectar sem essa passagem
          está guardando senha e entrando por fora — é assim que conta some. Aqui o botão leva você
          ao OAuth, onde uma autorização resolve todas as contas de uma vez.
        </p>
      </Card>
    </div>
  );
}
