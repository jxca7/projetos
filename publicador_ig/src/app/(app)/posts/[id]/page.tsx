import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { cancelPostAction, retryPostAction } from "@/app/actions";
import { Badge, Button, Card, Notice, SectionTitle, Stat } from "@/components/ui";
import {
  ERROR_HINTS,
  POST_STATUS,
  POST_TYPE,
  TARGET_STATUS,
  formatDateTime,
  formatDuration,
  formatNumber,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;

  const post = await prisma.post.findFirst({
    // Amarra ao workspace: id de outro workspace responde 404, não vaza dado.
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      media: { include: { media: true }, orderBy: { position: "asc" } },
      author: { select: { name: true, email: true } },
      targets: {
        include: {
          account: true,
          metrics: { orderBy: { collectedAt: "desc" }, take: 1 },
          events: { orderBy: { createdAt: "desc" }, take: 12 },
        },
        orderBy: { scheduledAt: "asc" },
      },
    },
  });

  if (!post) notFound();

  const s = POST_STATUS[post.status];
  const published = post.targets.filter((t) => t.status === "PUBLISHED");
  const failed = post.targets.filter((t) => t.status === "FAILED");
  const totals = published.reduce(
    (acc, t) => {
      const m = t.metrics[0];
      return {
        reach: acc.reach + (m?.reach ?? 0),
        views: acc.views + (m?.views ?? 0),
        interactions: acc.interactions + (m?.totalInteractions ?? 0),
      };
    },
    { reach: 0, views: 0, interactions: 0 },
  );

  return (
    <div className="space-y-7">
      <div>
        <Link href="/fila" className="text-sm text-muted hover:underline">
          ← Voltar para a fila
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{POST_TYPE[post.type]}</h1>
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              Criado por {post.author?.name ?? post.author?.email ?? "—"} ·{" "}
              {formatDateTime(post.createdAt, ctx.timezone)}
            </p>
          </div>

          <div className="flex gap-2">
            {failed.length > 0 ? (
              <form
                action={async () => {
                  "use server";
                  await retryPostAction(post.id);
                }}
              >
                <Button type="submit" className="px-3 py-1.5 text-sm">
                  Tentar novamente ({failed.length})
                </Button>
              </form>
            ) : null}
            {["SCHEDULED", "PUBLISHING", "PENDING_APPROVAL", "DRAFT"].includes(post.status) ? (
              <form
                action={async () => {
                  "use server";
                  await cancelPostAction(post.id);
                }}
              >
                <Button variant="secondary" type="submit" className="px-3 py-1.5 text-sm">
                  Cancelar
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>

      {published.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Publicados" value={`${published.length}/${post.targets.length}`} />
          <Stat label="Alcance somado" value={formatNumber(totals.reach)} />
          <Stat label="Views somadas" value={formatNumber(totals.views)} />
          <Stat label="Interações" value={formatNumber(totals.interactions)} />
        </div>
      ) : null}

      <Card>
        <SectionTitle title="Conteúdo" />
        {post.caption ? (
          <p className="whitespace-pre-wrap text-sm">{post.caption}</p>
        ) : (
          <p className="text-sm text-muted">Sem legenda.</p>
        )}

        {post.storyLink ? (
          <p className="mt-3 text-sm">
            <span className="text-muted">Link do Story: </span>
            <span className="break-all">{post.storyLink}</span>
          </p>
        ) : null}

        <ul className="mt-4 space-y-2 border-t border-border pt-4">
          {post.media.map((pm) => (
            <li key={pm.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Badge>{pm.media.kind === "VIDEO" ? "vídeo" : "imagem"}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {pm.media.originalName ?? pm.media.storageKey}
              </span>
              <span className="text-xs text-muted">
                {pm.media.width}×{pm.media.height}
                {pm.media.durationMs ? ` · ${formatDuration(pm.media.durationMs)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <section>
        <SectionTitle
          title="Destinos"
          hint="Cada conta tem seu próprio estado, histórico e métricas."
        />
        <div className="space-y-3">
          {post.targets.map((t) => {
            const ts = TARGET_STATUS[t.status];
            const m = t.metrics[0];
            const hint = t.lastErrorCode ? ERROR_HINTS[t.lastErrorCode] : null;

            return (
              <Card key={t.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">@{t.account.igUsername}</p>
                      <Badge tone={ts.tone}>{ts.label}</Badge>
                      {t.attempts > 1 ? <Badge>{t.attempts} tentativas</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Agendado: {formatDateTime(t.scheduledAt, ctx.timezone)}
                      {t.publishedAt
                        ? ` · Publicado: ${formatDateTime(t.publishedAt, ctx.timezone)}`
                        : ""}
                      {t.nextRetryAt
                        ? ` · Próxima tentativa: ${formatDateTime(t.nextRetryAt, ctx.timezone)}`
                        : ""}
                    </p>
                    {t.captionOverride ? (
                      <p className="mt-2 max-w-xl whitespace-pre-wrap rounded-lg bg-surface-2 p-2.5 text-xs">
                        <span className="font-medium">Legenda própria: </span>
                        {t.captionOverride}
                      </p>
                    ) : null}
                  </div>

                  {t.permalink ? (
                    <a
                      href={t.permalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 text-sm text-accent hover:underline"
                    >
                      Ver no Instagram
                    </a>
                  ) : null}
                </div>

                {t.status === "FAILED" ? (
                  <div className="mt-3">
                    <Notice tone="danger" title="Falhou">
                      {hint ?? t.lastError ?? "Sem detalhe registrado."}
                      {hint && t.lastError ? (
                        <span className="mt-1 block text-xs opacity-80">
                          Mensagem da Meta: {t.lastError}
                        </span>
                      ) : null}
                    </Notice>
                  </div>
                ) : null}

                {m ? (
                  <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-6">
                    {[
                      ["Alcance", m.reach],
                      ["Views", m.views],
                      ["Curtidas", m.likes],
                      ["Comentários", m.comments],
                      ["Salvos", m.saved],
                      ["Compart.", m.shares],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="tabular-nums">{formatNumber(value as number | null)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {t.events.length > 0 ? (
                  <details className="mt-3 border-t border-border pt-3">
                    <summary className="cursor-pointer text-sm text-muted">
                      Histórico ({t.events.length})
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {t.events.map((ev) => (
                        <li key={ev.id} className="flex gap-3 text-xs">
                          <span className="shrink-0 tabular-nums text-muted">
                            {formatDateTime(ev.createdAt, ctx.timezone)}
                          </span>
                          <span
                            className={
                              ev.level === "error"
                                ? "text-danger"
                                : ev.level === "warn"
                                  ? "text-warn"
                                  : "text-muted"
                            }
                          >
                            {ev.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
