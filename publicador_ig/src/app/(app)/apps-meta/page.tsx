import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { Card, Notice, SectionTitle } from "@/components/ui";
import { env } from "@/lib/env";
import { REQUIRED_SCOPES, redirectUri } from "@/lib/meta/oauth";
import { MetaAppsManager, TESTERS_POR_APP, type MetaAppRow } from "./manager";

export const metadata = { title: "Apps Meta · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function AppsMetaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const ctx = await requireContext();
  const { erro } = await searchParams;

  if (!canManageAccounts(ctx.role)) {
    return <Notice tone="danger">Seu perfil no workspace não gerencia apps do Meta.</Notice>;
  }

  const [apps, totalContas, contasSemApp] = await Promise.all([
    prisma.metaApp.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { accounts: true } } },
    }),
    prisma.socialAccount.count({ where: { workspaceId: ctx.workspaceId } }),
    prisma.socialAccount.count({ where: { workspaceId: ctx.workspaceId, metaAppId: null } }),
  ]);

  const rows: MetaAppRow[] = apps.map((a) => ({
    id: a.id,
    name: a.name,
    appId: a.appId,
    graphVersion: a.graphVersion,
    isActive: a.isActive,
    notes: a.notes,
    accountCount: a._count.accounts,
  }));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Apps do Meta"
        hint="As credenciais que autorizam a publicação. Os secrets ficam cifrados."
      />

      {erro ? <Notice tone="danger">{erro}</Notice> : null}

      <Notice tone="accent" title="Você não precisa de App Review para publicar nas suas contas">
        Em <strong>modo de desenvolvimento</strong>, o app publica normalmente nas contas que
        tiverem um papel nele. O App Review e a Verificação do Negócio só passam a ser
        obrigatórios quando <em>outras pessoas</em> forem conectar as contas delas no seu produto.
      </Notice>

      <MetaAppsManager apps={rows} totalContas={totalContas} contasSemApp={contasSemApp} />

      <Card className="bg-surface-2">
        <h3 className="font-medium">Como deixar um app pronto para publicar</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>
            No app, adicione o produto <strong className="text-text">Instagram</strong> e
            configure o Facebook Login.
          </li>
          <li>
            Em <strong className="text-text">Funções → Testadores do Instagram</strong>, adicione
            o @ de cada conta que vai publicar. Cada conta precisa{" "}
            <strong className="text-text">aceitar o convite</strong> no app do Instagram, em
            Configurações → Apps e sites → Convites de testador.
          </li>
          <li>
            Cada conta precisa ser <strong className="text-text">Business ou Creator</strong> e
            estar vinculada a uma Página do Facebook que você administra.
          </li>
          <li>
            Em Facebook Login → Configurações, cadastre esta URL de redirecionamento:
            <code className="mt-1 block rounded-md bg-surface px-2 py-1 font-mono text-xs break-all">
              {redirectUri()}
            </code>
          </li>
          <li>
            Permissões usadas:
            <code className="mt-1 block rounded-md bg-surface px-2 py-1 font-mono text-xs break-all">
              {REQUIRED_SCOPES.join(", ")}
            </code>
          </li>
        </ol>
      </Card>

      <Card className="bg-surface-2">
        <h3 className="font-medium">Por que mais de um app</h3>
        <p className="mt-2 text-sm text-muted">
          Um app do Meta aceita no máximo <strong className="text-text">{TESTERS_POR_APP} testers</strong>.
          Em modo de desenvolvimento só quem tem papel no app consegue autorizar, então esse número
          é o teto de contas por app — com 93 contas, não cabe em um só. Cada app também tem o
          próprio balde de rate limit, o que distribui o risco de estourar o limite de chamadas.
        </p>
        <p className="mt-2 text-sm text-muted">
          Por isso cada conta guarda qual app a conectou: o <code>appsecret_proof</code> é
          assinado com o secret daquele app. Assinar com o secret de outro faz a Meta recusar
          todas as chamadas daquela conta.
        </p>
      </Card>

      {env().META_DRIVER === "mock" ? (
        <Notice tone="warn">
          O <code>.env</code> está com <code>META_DRIVER=mock</code>: nada é enviado à Meta ainda.
          Cadastre os apps aqui, depois mude para <code>graph</code> para valer.
        </Notice>
      ) : null}
    </div>
  );
}
