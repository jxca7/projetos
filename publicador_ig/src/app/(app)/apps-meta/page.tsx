import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { Card, Notice, SectionTitle } from "@/components/ui";
import { env } from "@/lib/env";
import {
  FACEBOOK_LOGIN_SCOPES,
  INSTAGRAM_LOGIN_SCOPES,
  dataDeletionUrl,
  deauthorizeUrl,
  redirectUri,
} from "@/lib/meta/oauth";
import { Copiavel } from "./copiavel";
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
    loginFlow: a.loginFlow,
    facebookAppId: a.facebookAppId,
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
        <h3 className="font-medium">URLs que precisam estar salvas no seu app</h3>
        <p className="mt-1 text-sm text-muted">
          A Meta compara estas URLs caractere a caractere. Qualquer diferença — http em vez de
          https, barra no final — vira <code>Invalid redirect_uri</code> no login.
        </p>
        <div className="mt-3 space-y-2">
          <Copiavel label="OAuth redirect URI (obrigatória)" value={redirectUri()} />
          <Copiavel label="Desautorização" value={deauthorizeUrl()} />
          <Copiavel label="Exclusão de dados" value={dataDeletionUrl()} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Em Configurações → Básico, preencha também <strong className="text-text">App Domains</strong>{" "}
          e <strong className="text-text">Site URL</strong> com o domínio desta instalação.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface-2">
          <h3 className="font-medium">Instagram Login (recomendado)</h3>
          <p className="mt-1 text-sm text-muted">
            Não exige Página do Facebook. Use o <strong className="text-text">Instagram App ID</strong>{" "}
            e o <strong className="text-text">Instagram App Secret</strong> — não o App ID do Facebook.
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>
              No app: <strong className="text-text">Instagram → API setup with Instagram login</strong>.
            </li>
            <li>
              Em <strong className="text-text">Business login settings</strong>, cole a OAuth
              redirect URI acima.
            </li>
            <li>
              Em <strong className="text-text">Funções → Testadores do Instagram</strong>, adicione
              o @ de cada conta. Cada uma precisa aceitar o convite no app do Instagram.
            </li>
            <li>A conta precisa ser Business ou Creator.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">
            Permissões: <code className="break-all">{INSTAGRAM_LOGIN_SCOPES.join(", ")}</code>
          </p>
          <p className="mt-2 text-sm text-warn">
            O token vale 60 dias. A plataforma renova sozinha todo dia de madrugada — se o worker
            ficar parado mais de 60 dias, as contas precisam autorizar de novo.
          </p>
        </Card>

        <Card className="bg-surface-2">
          <h3 className="font-medium">Facebook Login (clássico)</h3>
          <p className="mt-1 text-sm text-muted">
            Exige que cada conta esteja vinculada a uma Página do Facebook que você administra. Em
            troca, uma autorização só traz todas as contas das suas Páginas de uma vez, e o token
            de Página não expira.
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>No app, adicione o produto Instagram e configure o Facebook Login.</li>
            <li>Em Facebook Login → Configurações, cole a OAuth redirect URI acima.</li>
            <li>Use o App ID e a Chave Secreta do Facebook no cadastro aqui.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">
            Permissões: <code className="break-all">{FACEBOOK_LOGIN_SCOPES.join(", ")}</code>
          </p>
        </Card>
      </div>

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
