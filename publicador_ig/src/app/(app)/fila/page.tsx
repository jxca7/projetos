import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { approveAndSchedule, cancelPostAction } from "@/app/actions";
import { Badge, Button, Card, Empty, SectionTitle } from "@/components/ui";
import { POST_STATUS, POST_TYPE, TARGET_STATUS, formatDateTime } from "@/lib/labels";

export const metadata = { title: "Fila · Publicador IG" };
export const dynamic = "force-dynamic";

const OPEN_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "PUBLISHING",
  "PARTIALLY_PUBLISHED",
] as const;

export default async function FilaPage() {
  const ctx = await requireContext();

  const [open, done] = await Promise.all([
    prisma.post.findMany({
      where: { workspaceId: ctx.workspaceId, status: { in: [...OPEN_STATUSES] } },
      include: { targets: { include: { account: true }, orderBy: { scheduledAt: "asc" } } },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.post.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: { in: ["PUBLISHED", "FAILED", "CANCELED"] },
      },
      include: { targets: { select: { status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-8">
      <SectionTitle
        title="Fila"
        hint="Cada post vira um destino por conta, com horário próprio."
        action={
          <Link
            href="/publicar"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Novo post
          </Link>
        }
      />

      {open.length === 0 ? (
        <Empty title="Nada em andamento" hint="Posts agendados e em publicação aparecem aqui." />
      ) : (
        <div className="space-y-3">
          {open.map((post) => {
            const s = POST_STATUS[post.status];
            const needsApproval = post.status === "PENDING_APPROVAL";
            return (
              <Card key={post.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/posts/${post.id}`} className="font-medium hover:underline">
                        {POST_TYPE[post.type]}
                      </Link>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <span className="text-sm text-muted">
                        {post.targets.length} destino(s)
                      </span>
                    </div>
                    {post.caption ? (
                      <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-muted">
                        {post.caption}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">
                      Início: {formatDateTime(post.scheduledAt, ctx.timezone)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {needsApproval ? (
                      <form
                        action={async () => {
                          "use server";
                          await approveAndSchedule(post.id);
                        }}
                      >
                        <Button type="submit" className="px-3 py-1.5 text-xs">
                          Aprovar e agendar
                        </Button>
                      </form>
                    ) : null}
                    <form
                      action={async () => {
                        "use server";
                        await cancelPostAction(post.id);
                      }}
                    >
                      <Button variant="secondary" type="submit" className="px-3 py-1.5 text-xs">
                        Cancelar
                      </Button>
                    </form>
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  {post.targets.map((t) => {
                    const ts = TARGET_STATUS[t.status];
                    return (
                      <li key={t.id}>
                        <Badge tone={ts.tone}>
                          @{t.account.igUsername} · {ts.label}
                          {t.scheduledAt
                            ? ` · ${formatDateTime(t.scheduledAt, ctx.timezone)}`
                            : ""}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <section>
        <SectionTitle title="Histórico" hint="Últimos 20 posts encerrados." />
        {done.length === 0 ? (
          <Empty title="Sem histórico ainda" />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {done.map((post) => {
                const s = POST_STATUS[post.status];
                const published = post.targets.filter((t) => t.status === "PUBLISHED").length;
                return (
                  <li key={post.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link
                      href={`/posts/${post.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {POST_TYPE[post.type]}
                      {post.caption ? (
                        <span className="ml-2 font-normal text-muted">{post.caption}</span>
                      ) : null}
                    </Link>
                    <span className="text-sm tabular-nums text-muted">
                      {published}/{post.targets.length}
                    </span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
