import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext, canManageAccounts } from "@/lib/session";
import { disconnectAccountAction, refreshQuotaAction } from "@/app/actions";
import { Badge, Button, Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { ACCOUNT_STATUS, formatDateTime, formatNumber } from "@/lib/labels";
import { env } from "@/lib/env";

export const metadata = { title: "Contas · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const ctx = await requireContext();
  const { ok, erro } = await searchParams;

  const [accounts, subscription] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ status: "asc" }, { igUsername: "asc" }],
      include: {
        _count: { select: { targets: true } },
      },
    }),
    prisma.subscription.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const maxAccounts = subscription?.maxAccounts ?? 2;
  const canManage = canManageAccounts(ctx.role);
  const atLimit = accounts.length >= maxAccounts;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Contas conectadas"
        hint={`${accounts.length} de ${maxAccounts} do plano ${subscription?.tier ?? "FREE"}.`}
        action={
          canManage ? (
            <Link
              href="/api/meta/connect"
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={atLimit}
            >
              Conectar contas
            </Link>
          ) : null
        }
      />

      {ok ? <Notice tone="ok">{ok}</Notice> : null}
      {erro ? <Notice tone="danger">{erro}</Notice> : null}

      {env().META_DRIVER === "mock" ? (
        <Notice tone="accent" title="Modo de desenvolvimento">
          META_DRIVER esta como <code>mock</code>: as contas e as publicações são simuladas e nada
          vai para o Instagram. Mude para <code>graph</code> no .env para usar a API real.
        </Notice>
      ) : null}

      {atLimit ? (
        <Notice tone="warn">
          Você chegou ao limite de {maxAccounts} conta(s) do seu plano. Contas novas serão ignoradas
          na próxima conexão.
        </Notice>
      ) : null}

      {accounts.length === 0 ? (
        <Empty
          title="Nenhuma conta conectada"
          hint="A conta do Instagram precisa ser Business ou Creator e estar vinculada a uma Página do Facebook. Conecte somente contas que você possui ou gerencia com autorização do dono."
        />
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const s = ACCOUNT_STATUS[a.status];
            const used = a.quotaUsage ?? 0;
            const total = a.quotaTotal ?? 0;
            const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">@{a.igUsername}</p>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {a.igAccountType ? <Badge>{a.igAccountType}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {formatNumber(a.followersCount)} seguidores
                      {a.pageName ? ` · Página: ${a.pageName}` : ""}
                      {` · ${a._count.targets} publicação(oes) pela plataforma`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Token valido até: {formatDateTime(a.tokenExpiresAt, ctx.timezone)} · Última
                      sincronização: {formatDateTime(a.lastSyncedAt, ctx.timezone)}
                    </p>
                    {a.statusMessage ? (
                      <p className="mt-2 text-sm text-danger">{a.statusMessage}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {total > 0 ? (
                      <div className="w-40">
                        <div className="flex justify-between text-xs text-muted">
                          <span>Cota 24h</span>
                          <span className="tabular-nums">
                            {used}/{total}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={pct >= 90 ? "h-full bg-danger" : "h-full bg-accent"}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[11px] text-muted">
                          lido da API em {formatDateTime(a.quotaCheckedAt, ctx.timezone)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Cota ainda não consultada</p>
                    )}

                    {canManage ? (
                      <div className="flex gap-2">
                        <form
                          action={async () => {
                            "use server";
                            await refreshQuotaAction(a.id);
                          }}
                        >
                          <Button variant="secondary" type="submit" className="px-2.5 py-1.5 text-xs">
                            Atualizar cota
                          </Button>
                        </form>
                        {a.status === "ACTIVE" ? (
                          <form
                            action={async () => {
                              "use server";
                              await disconnectAccountAction(a.id);
                            }}
                          >
                            <Button variant="danger" type="submit" className="px-2.5 py-1.5 text-xs">
                              Desconectar
                            </Button>
                          </form>
                        ) : (
                          <Link
                            href="/api/meta/connect"
                            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
                          >
                            Reconectar
                          </Link>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="bg-surface-2">
        <h3 className="font-medium">O que a API oficial permite e o que não permite</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>
            <strong className="text-text">Permite:</strong> publicar Reels, posts de feed,
            carrossel e Stories; agendar; ler métricas; publicar na mesma conta em que você tem
            permissão de Página.
          </li>
          <li>
            <strong className="text-text">Não permite:</strong> inserir link sticker, enquete ou
            menção em Story — a Meta descarta esses elementos. A plataforma cria uma pendência para
            você colar o link no app enquanto o Story está no ar.
          </li>
          <li>
            <strong className="text-text">Não permite:</strong> criar contas, seguir, curtir,
            comentar em massa ou enviar direct automatizado. Nada disso existe na API oficial.
          </li>
          <li>
            <strong className="text-text">Limite por conta:</strong> a Meta impoe um teto de
            publicações por janela de 24h, lido da própria API e mostrado acima.
          </li>
        </ul>
      </Card>
    </div>
  );
}
