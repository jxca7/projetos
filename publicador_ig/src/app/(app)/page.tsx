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
          tone={broken.length > 0 ? "warn" : "ok"}
          hint={accounts.length > active.length ? `${broken.length} com problema` : "todas ok"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          }
        />
        <Stat
          label="Na fila"
          value={scheduledCount}
          tone={scheduledCount > 0 ? "accent" : "neutral"}
          hint="destinos aguardando"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          }
        />
        <Stat
          label="Publicados (7d)"
          value={publishedWeek}
          tone="ok"
          hint={failedWeek > 0 ? `${failedWeek} falharam` : "nenhuma falha"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m22 4-10 10.01-3-3" />
            </svg>
          }
        />
        <Stat
          label="Alcance (7d)"
          value={formatNumber(reach._sum.reach ?? 0)}
          tone="accent"
          hint={`${formatNumber(reach._sum.views ?? 0)} views`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
            </svg>
          }
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
        <SectionTitle
          title="Contas"
          hint={accounts.length > 6 ? `Mostrando 6 de ${accounts.length}.` : undefined}
          action={
            <Link href="/contas" className="text-sm font-medium text-accent hover:underline">
              Gerenciar todas
            </Link>
          }
        />
        {accounts.length === 0 ? (
          <Empty
            title="Nenhuma conta conectada"
            hint="Conecte contas profissionais do Instagram que você possui ou gerencia com autorização do dono."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.slice(0, 6).map((a) => {
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
