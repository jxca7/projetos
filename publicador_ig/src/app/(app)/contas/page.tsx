import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { env } from "@/lib/env";
import { AccountsManager, type AccountRow, type FolderRow } from "./manager";

export const metadata = { title: "Contas · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const ctx = await requireContext();
  const { ok, erro } = await searchParams;

  const [rows, folders, subscription] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ status: "asc" }, { igUsername: "asc" }],
      include: { _count: { select: { targets: true } } },
    }),
    prisma.accountFolder.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { _count: { select: { accounts: true } } },
    }),
    prisma.subscription.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const maxAccounts = subscription?.maxAccounts ?? 2;
  const canManage = canManageAccounts(ctx.role);
  const atLimit = rows.length >= maxAccounts;

  const accounts: AccountRow[] = rows.map((a) => ({
    id: a.id,
    igUsername: a.igUsername,
    status: a.status,
    statusMessage: a.statusMessage,
    folderId: a.folderId,
    followersCount: a.followersCount,
    pageName: a.pageName,
    quotaUsage: a.quotaUsage,
    quotaTotal: a.quotaTotal,
    tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
    publishedCount: a._count.targets,
  }));

  const folderRows: FolderRow[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    count: f._count.accounts,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Contas conectadas"
        hint={`${rows.length} de ${maxAccounts} do plano ${subscription?.tier ?? "FREE"}.`}
        action={
          canManage ? (
            <Link
              href="/api/meta/connect"
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={atLimit}
            >
              Conectar Instagram
            </Link>
          ) : null
        }
      />

      {ok ? <Notice tone="ok">{ok}</Notice> : null}
      {erro ? <Notice tone="danger">{erro}</Notice> : null}

      {env().META_DRIVER === "mock" ? (
        <Notice tone="accent" title="Modo de desenvolvimento">
          META_DRIVER está como <code>mock</code>: as contas e as publicações são simuladas e nada
          vai para o Instagram. Mude para <code>graph</code> no .env para usar a API real.
        </Notice>
      ) : null}

      {atLimit ? (
        <Notice tone="warn">
          Você chegou ao limite de {maxAccounts} conta(s) do seu plano. Contas novas serão
          ignoradas na próxima conexão.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <Empty
          title="Nenhuma conta conectada"
          hint="A conta do Instagram precisa ser Business ou Creator. No fluxo Facebook Login ela também precisa estar vinculada a uma Página; no Instagram Login, não. Conecte somente contas que você possui ou gerencia com autorização do dono."
        />
      ) : (
        <AccountsManager
          folders={folderRows}
          accounts={accounts}
          timezone={ctx.timezone}
          canManage={canManage}
        />
      )}

      <Card className="bg-surface-2">
        <h3 className="font-medium">O que a API oficial permite e o que não permite</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>
            <strong className="text-text">Permite:</strong> publicar Reels, posts de feed,
            carrossel e Stories; agendar; ler métricas; publicar nas contas em que você tem
            permissão de Página.
          </li>
          <li>
            <strong className="text-text">Não permite:</strong> inserir link sticker, enquete ou
            menção em Story — a Meta descarta esses elementos. A plataforma cria uma pendência
            para você colar o link no app enquanto o Story está no ar.
          </li>
          <li>
            <strong className="text-text">Não permite:</strong> criar contas, seguir, curtir,
            comentar em massa ou enviar direct automatizado. Nada disso existe na API oficial.
          </li>
          <li>
            <strong className="text-text">Limite por conta:</strong> a Meta impõe um teto de
            publicações por janela de 24h, lido da própria API e mostrado em cada conta.
          </li>
        </ul>
      </Card>
    </div>
  );
}
