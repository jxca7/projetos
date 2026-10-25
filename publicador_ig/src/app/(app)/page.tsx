import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { Badge, Card, Empty, Notice, SectionTitle, Stat } from "@/components/ui";
import {
  ACCOUNT_STATUS,
  ERROR_HINTS,
  POST_TYPE,
  TARGET_STATUS,
  formatDateTime,
  formatNumber,
} from "@/lib/labels";

export const metadata = { title: "Visão geral · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireContext();
  const ws = { workspaceId: ctx.workspaceId };
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [accounts, scheduledCount, publishedWeek, failedWeek, upcoming, recentFailures, reach] =
    await Promise.all([
      prisma.socialAccount.findMany({ where: ws, orderBy: { igUsername: "asc" } }),
      prisma.postTarget.count({
        where: { post: ws, status: { in: ["QUEUED", "WAITING_CONTAINER", "CREATING_CONTAINER"] } },
      }),
      prisma.postTarget.count({
        where: { post: ws, status: "PUBLISHED", publishedAt: { gte: sevenDaysAgo } },
      }),
      prisma.postTarget.count({
        where: { post: ws, status: "FAILED", updatedAt: { gte: sevenDaysAgo } },
      }),
      prisma.postTarget.findMany({
        where: {
          post: ws,
          status: { in: ["QUEUED", "WAITING_CONTAINER", "CREATING_CONTAINER", "PUBLISHING"] },
        },
        include: { account: true, post: true },
        orderBy: [{ scheduledAt: "asc" }],
        take: 8,
      }),
      prisma.postTarget.findMany({
        where: { post: ws, status: "FAILED" },
        include: { account: true, post: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.metricSnapshot.aggregate({
        _sum: { reach: true, views: true },
        where: { target: { post: ws }, collectedAt: { gte: sevenDaysAgo } },
      }),
    ]);

  const active = accounts.filter((a) => a.status === "ACTIVE");
  const broken = accounts.filter((a) => a.status !== "ACTIVE");

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-0.5 text-sm text-muted">
            Fuso do workspace: {ctx.timezone.replace("_", " ")}
          </p>
        </div>
        <Link
          href="/publicar"
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Novo post
        </Link>
      </div>

      {broken.length > 0 ? (
        <Notice tone="danger" title={`${broken.length} conta(s) precisam de atenção`}>
          {broken.map((a) => `@${a.igUsername}`).join(", ")} não vao publicar até serem
          reconectadas. <Link href="/contas" className="underline">Abrir contas</Link>
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Contas ativas"
          value={active.length}
          hint={accounts.length > active.length ? `${broken.length} com problema` : "todas ok"}
        />
        <Stat label="Na fila" value={scheduledCount} hint="destinos aguardando" />
        <Stat label="Publicados (7d)" value={publishedWeek} hint={failedWeek > 0 ? `${failedWeek} falharam` : "nenhuma falha"} />
        <Stat
          label="Alcance (7d)"
          value={formatNumber(reach._sum.reach ?? 0)}
          hint={`${formatNumber(reach._sum.views ?? 0)} views`}
        />
      </div>

      <section>
        <SectionTitle
          title="Próximos na fila"
          hint="Os destinos são distribuídos no tempo de propósito, para não disparar tudo de uma vez."
          action={
            <Link href="/fila" className="text-sm text-accent hover:underline">
              Ver fila completa
            </Link>
          }
        />
        {upcoming.length === 0 ? (
          <Empty
            title="Nada na fila"
            hint="Crie um post e escolha as contas de destino para começar."
          />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {upcoming.map((t) => {
                const s = TARGET_STATUS[t.status];
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/posts/${t.postId}`} className="font-medium hover:underline">
                        {POST_TYPE[t.post.type]}
                      </Link>
                      <span className="ml-2 text-sm text-muted">@{t.account.igUsername}</span>
                    </span>
                    <span className="text-sm tabular-nums text-muted">
                      {formatDateTime(t.scheduledAt, ctx.timezone)}
                    </span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {recentFailures.length > 0 ? (
        <section>
          <SectionTitle title="Falhas recentes" hint="O que exige decisão sua." />
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {recentFailures.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/posts/${t.postId}`} className="font-medium hover:underline">
                      {POST_TYPE[t.post.type]}
                    </Link>
                    <span className="text-sm text-muted">@{t.account.igUsername}</span>
                    <Badge tone="danger">Falhou</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {t.lastErrorCode && ERROR_HINTS[t.lastErrorCode]
                      ? ERROR_HINTS[t.lastErrorCode]
                      : (t.lastError ?? "Sem detalhe registrado.")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle title="Contas" action={<Link href="/contas" className="text-sm text-accent hover:underline">Gerenciar</Link>} />
        {accounts.length === 0 ? (
          <Empty
            title="Nenhuma conta conectada"
            hint="Conecte contas profissionais do Instagram que você possui ou gerencia com autorização do dono."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => {
              const s = ACCOUNT_STATUS[a.status];
              const used = a.quotaUsage ?? 0;
              const total = a.quotaTotal ?? 0;
              const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
              return (
                <Card key={a.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">@{a.igUsername}</p>
                      <p className="text-xs text-muted">
                        {formatNumber(a.followersCount)} seguidores
                      </p>
                    </div>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  {total > 0 ? (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-muted">
                        <span>Cota 24h</span>
                        <span className="tabular-nums">
                          {used}/{total}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
