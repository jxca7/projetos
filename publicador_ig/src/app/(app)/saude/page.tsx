import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { retryAllFailedAction } from "@/app/actions";
import { Badge, Button, Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { ACCOUNT_STATUS, ERROR_HINTS, formatDateTime, formatNumber } from "@/lib/labels";
import { Avatar } from "@/components/avatar";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Saúde · Publicador IG" };
export const dynamic = "force-dynamic";

/** Tolerância antes de considerar um destino atrasado. */
const ATRASO_MS = 5 * 60 * 1000;

function Metric({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint: string;
  tone: "accent" | "ok" | "warn" | "danger" | "neutral";
}) {
  const ring = {
    accent: "border-accent/40",
    ok: "border-ok/40",
    warn: "border-warn/40",
    danger: "border-danger/40",
    neutral: "border-border",
  }[tone];
  const text = {
    accent: "text-accent",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    neutral: "text-text",
  }[tone];

  return (
    <div className={`rounded-xl border ${ring} bg-surface p-4`}>
      <div className={`text-3xl font-semibold tabular-nums ${value === 0 ? "text-muted" : text}`}>
        {formatNumber(value)}
      </div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
    </div>
  );
}

export default async function SaudePage() {
  const ctx = await requireContext();
  const ws = { workspaceId: ctx.workspaceId };
  const now = new Date();
  const umaHoraAtras = new Date(now.getTime() - 60 * 60 * 1000);
  const umDiaAtras = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    emExecucao,
    publicados1h,
    pendentes,
    atrasados,
    comErro,
    accounts,
    errosRecentes,
    proximos,
  ] = await Promise.all([
    prisma.postTarget.count({
      where: { post: ws, status: { in: ["CREATING_CONTAINER", "WAITING_CONTAINER", "PUBLISHING"] } },
    }),
    prisma.postTarget.count({
      where: { post: ws, status: "PUBLISHED", publishedAt: { gte: umaHoraAtras } },
    }),
    prisma.postTarget.count({
      where: { post: ws, status: "QUEUED" },
    }),
    prisma.postTarget.count({
      where: {
        post: ws,
        status: "QUEUED",
        scheduledAt: { lt: new Date(now.getTime() - ATRASO_MS) },
        // Reagendamento por cota ou rate limit não é atraso: é a fila esperando
        // de propósito. Só conta como atrasado o que não tem retry marcado.
        nextRetryAt: null,
      },
    }),
    prisma.postTarget.count({
      where: { post: ws, status: "FAILED", updatedAt: { gte: umDiaAtras } },
    }),
    prisma.socialAccount.findMany({
      where: ws,
      orderBy: [{ status: "asc" }, { igUsername: "asc" }],
      include: { folder: { select: { name: true } } },
    }),
    prisma.postTarget.findMany({
      where: { post: ws, status: "FAILED", updatedAt: { gte: umDiaAtras } },
      include: { account: { select: { igUsername: true } }, post: { select: { type: true } } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.postTarget.findMany({
      where: { post: ws, status: { in: ["QUEUED", "WAITING_CONTAINER", "CREATING_CONTAINER"] } },
      include: { account: { select: { igUsername: true } }, post: { select: { type: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
    }),
  ]);

  const ativas = accounts.filter((a) => a.status === "ACTIVE");
  const off = accounts.filter((a) => a.status !== "ACTIVE");

  // Contas que já gastaram boa parte da cota de 24h.
  const perto = ativas.filter(
    (a) => a.quotaTotal && a.quotaUsage !== null && a.quotaUsage / a.quotaTotal >= 0.8,
  );

  // A tela de monitoramento mostra exceção, não inventário: com dezenas de
  // contas, listar todas esconde justamente o que precisa de ação.
  const atencao = [...off, ...perto].sort((a, b) => {
    const pa = a.quotaTotal ? (a.quotaUsage ?? 0) / a.quotaTotal : 0;
    const pb = b.quotaTotal ? (b.quotaUsage ?? 0) / b.quotaTotal : 0;
    if (a.status !== "ACTIVE" && b.status === "ACTIVE") return -1;
    if (b.status !== "ACTIVE" && a.status === "ACTIVE") return 1;
    return pb - pa;
  });

  // Agrupa os erros por código: é isso que diz se o problema é sistêmico.
  const porCodigo = new Map<string, number>();
  for (const t of errosRecentes) {
    const k = t.lastErrorCode ?? "desconhecido";
    porCodigo.set(k, (porCodigo.get(k) ?? 0) + 1);
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saúde das contas</h1>
          <p className="mt-0.5 text-sm text-muted">
            {accounts.length} conta(s) conectada(s) · leitura de{" "}
            {formatDateTime(now, ctx.timezone)}
          </p>
        </div>
        <AutoRefresh seconds={90} />
      </div>

      <section>
        <SectionTitle title="Fila ao vivo" />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <Metric
            value={emExecucao}
            label="Em execução"
            hint="enviando ao Instagram agora"
            tone="accent"
          />
          <Metric value={publicados1h} label="Publicados 1h" hint="na última hora" tone="ok" />
          <Metric value={pendentes} label="Pendentes" hint="aguardando o horário" tone="neutral" />
          <Metric
            value={atrasados}
            label="Atrasados"
            hint="passaram do horário"
            tone={atrasados > 0 ? "warn" : "neutral"}
          />
          <Metric
            value={comErro}
            label="Com erro"
            hint="falharam em 24h"
            tone={comErro > 0 ? "danger" : "neutral"}
          />
        </div>

        {atrasados > 0 ? (
          <div className="mt-3">
            <Notice tone="warn" title="Há destinos atrasados">
              Isso quase sempre significa que o worker não está rodando. Sem{" "}
              <code>pnpm worker</code> ativo, a fila não anda — o painel continua aceitando
              agendamento, mas nada é publicado.
            </Notice>
          </div>
        ) : null}
      </section>

      {comErro > 0 ? (
        <section>
          <SectionTitle
            title="Erros nas últimas 24h"
            hint="Agrupados por causa: código repetido indica problema sistêmico, não azar."
            action={
              <form
                action={async () => {
                  "use server";
                  await retryAllFailedAction();
                }}
              >
                <Button type="submit" className="px-3 py-1.5 text-xs">
                  Repetir todos os falhos
                </Button>
              </form>
            }
          />
          <div className="mb-3 flex flex-wrap gap-2">
            {[...porCodigo.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([codigo, n]) => (
                <Badge key={codigo} tone="danger">
                  {codigo} · {n}
                </Badge>
              ))}
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {errosRecentes.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/posts/${t.postId}`} className="font-medium hover:underline">
                      @{t.account.igUsername}
                    </Link>
                    <span className="text-xs text-muted">
                      {formatDateTime(t.updatedAt, ctx.timezone)}
                    </span>
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

      {off.length > 0 ? (
        <Notice tone="danger" title={`${off.length} conta(s) fora do ar`}>
          {off
            .slice(0, 8)
            .map((a) => `@${a.igUsername}`)
            .join(", ")}
          {off.length > 8 ? ` e mais ${off.length - 8}` : ""}.{" "}
          <Link href="/contas-off" className="underline">
            Resolver agora
          </Link>
        </Notice>
      ) : null}

      {perto.length > 0 ? (
        <Notice tone="warn" title={`${perto.length} conta(s) perto do limite de 24h`}>
          {perto
            .slice(0, 5)
            .map((a) => `@${a.igUsername} (${a.quotaUsage}/${a.quotaTotal})`)
            .join(", ")}
          {perto.length > 5 ? ` e mais ${perto.length - 5}` : ""}. A fila segura sozinha quando
          estourar e retoma na virada da janela.
        </Notice>
      ) : null}

      <section>
        <SectionTitle title="Próximos a publicar" />
        {proximos.length === 0 ? (
          <Empty title="Fila vazia" hint="Nada aguardando publicação." />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {proximos.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate">
                    <Link href={`/posts/${t.postId}`} className="font-medium hover:underline">
                      @{t.account.igUsername}
                    </Link>
                  </span>
                  <span className="text-sm tabular-nums text-muted">
                    {formatDateTime(t.scheduledAt, ctx.timezone)}
                  </span>
                  {t.nextRetryAt ? <Badge tone="warn">reagendado</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle
          title="Contas que pedem atenção"
          hint="Só o que foge do normal: cota alta ou conta fora do ar. O resto está em Contas."
          action={
            <Link href="/contas" className="text-sm text-accent hover:underline">
              Ver todas as {accounts.length}
            </Link>
          }
        />
        {atencao.length === 0 ? (
          <Empty
            title="Nenhuma conta pedindo atenção"
            hint={`As ${ativas.length} contas ativas estão com cota folgada e token válido.`}
          />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {atencao.slice(0, 15).map((a) => {
                const s = ACCOUNT_STATUS[a.status];
                const used = a.quotaUsage ?? 0;
                const total = a.quotaTotal ?? 0;
                const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Avatar src={a.profilePicUrl} name={a.igUsername} size={34} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">@{a.igUsername}</span>
                      {a.folder ? (
                        <span className="ml-2 text-xs text-muted">{a.folder.name}</span>
                      ) : null}
                    </span>
                    {total > 0 ? (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className={`block h-full rounded-full ${pct >= 90 ? "bg-danger" : "bg-warn"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="text-xs tabular-nums text-muted">
                          {used}/{total}
                        </span>
                      </span>
                    ) : null}
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </li>
                );
              })}
            </ul>
            {atencao.length > 15 ? (
              <p className="border-t border-border px-5 py-3 text-sm text-muted">
                e mais {atencao.length - 15} conta(s).{" "}
                <Link href="/contas" className="text-accent hover:underline">
                  Ver em Contas
                </Link>
              </p>
            ) : null}
          </Card>
        )}
      </section>

    </div>
  );
}
