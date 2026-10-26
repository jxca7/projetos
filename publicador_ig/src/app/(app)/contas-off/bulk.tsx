"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { disconnectAccountsAction, reactivateAccountsAction } from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { ACCOUNT_STATUS, formatDateTime } from "@/lib/labels";
import type { AccountStatus } from "@/generated/prisma/enums";

export interface OffAccount {
  id: string;
  igUsername: string;
  profilePicUrl: string | null;
  status: AccountStatus;
  statusMessage: string | null;
  folderName: string | null;
  tokenExpired: boolean;
  tokenExpiresAt: string | null;
  failures24h: number;
  timezone: string;
}

/** Instrução específica por estado, mostrada na caixa de cada conta. */
function instrucao(a: OffAccount): string {
  if (a.status === "TOKEN_EXPIRED") {
    return "O Instagram pediu login nesse @. Abra o Instagram, confirme a tela da Meta e reconecte. A conta não está suspensa.";
  }
  if (a.status === "REVOKED") {
    return "O acesso foi revogado no Instagram ou no Business Manager. Confira a conta no app e reconecte pelo OAuth.";
  }
  if (a.tokenExpired) {
    return "Desligada aqui, mas o token já venceu: precisa passar pelo OAuth de novo.";
  }
  return "Desligada aqui no painel. Dá para reativar direto, porque o token ainda vale.";
}

export function BulkOffAccounts({ accounts }: { accounts: OffAccount[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const reativaveis = accounts.filter((a) => a.status === "DISABLED" && !a.tokenExpired);
  const precisaOauth = accounts.filter((a) => a.status !== "DISABLED" || a.tokenExpired);

  function toggle(id: string) {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function run(fn: () => Promise<unknown>) {
    setMsg(null);
    startTransition(async () => {
      const r = (await fn()) as {
        ok: boolean;
        error?: string;
        reactivated?: number;
        needsOauth?: number;
        disconnected?: number;
      };
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error ?? "Não foi possível concluir." });
        return;
      }
      if (r.reactivated !== undefined) {
        const partes = [`${r.reactivated} conta(s) reativada(s)`];
        if (r.needsOauth) partes.push(`${r.needsOauth} com token vencido precisam do OAuth`);
        setMsg({ tone: r.needsOauth ? "warn" : "ok", text: partes.join("; ") + "." });
      } else if (r.disconnected !== undefined) {
        setMsg({ tone: "ok", text: `${r.disconnected} conta(s) desconectada(s).` });
      }
      setSelected([]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {/* Ações em massa */}
      <Card>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/api/meta/connect"
            className="rounded-[var(--r-sm)] bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] transition hover:brightness-105"
          >
            Reconectar todas ({precisaOauth.length})
          </Link>
          <Button
            variant="secondary"
            type="button"
            disabled={pending || reativaveis.length === 0}
            onClick={() => run(() => reactivateAccountsAction())}
          >
            Reativar desligadas ({reativaveis.length})
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={pending || selected.length === 0}
            onClick={() => run(() => disconnectAccountsAction(selected))}
          >
            Desconectar selecionadas ({selected.length})
          </Button>
          <Button variant="ghost" type="button" disabled={pending} onClick={() => router.refresh()}>
            Atualizar
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Uma única passagem pelo OAuth reconecta todas as contas que você autorizar na tela da
          Meta — não precisa repetir conta a conta.
        </p>
      </Card>

      {/* Lista */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.length === accounts.length && accounts.length > 0}
              onChange={(e) => setSelected(e.target.checked ? accounts.map((a) => a.id) : [])}
            />
            Selecionar todas
          </label>
          <span className="text-xs text-muted">{accounts.length} conta(s)</span>
        </div>
        <ul className="divide-y divide-border">
          {accounts.map((a) => {
            const s = ACCOUNT_STATUS[a.status];
            const podeReativar = a.status === "DISABLED" && !a.tokenExpired;
            return (
              <li key={a.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1.5 size-4 shrink-0"
                    checked={selected.includes(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <Avatar src={a.profilePicUrl} name={a.igUsername} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">@{a.igUsername}</span>
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                      {a.folderName ? <Badge>{a.folderName}</Badge> : null}
                    </div>

                    {/* Caixa de instrução */}
                    <div className="mt-2 rounded-[var(--r-sm)] border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
                      {instrucao(a)}
                    </div>

                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                      {a.failures24h > 0 ? (
                        <span className="text-danger">{a.failures24h} falha(s) em 24h</span>
                      ) : null}
                      {a.tokenExpiresAt ? (
                        <span>
                          Token {a.tokenExpired ? "expirou" : "expira"}{" "}
                          {formatDateTime(new Date(a.tokenExpiresAt), a.timezone)}
                        </span>
                      ) : null}
                      {a.statusMessage ? (
                        <span className="w-full text-faint">Meta disse: {a.statusMessage}</span>
                      ) : null}
                    </p>
                  </div>

                  {/* Ações por conta */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      href="/api/meta/connect"
                      className="rounded-[var(--r-sm)] bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105"
                    >
                      Reconectar
                    </Link>
                    {podeReativar ? (
                      <Button
                        variant="secondary"
                        type="button"
                        className="px-2.5 py-1.5 text-xs"
                        disabled={pending}
                        onClick={() => run(() => reactivateAccountsAction([a.id]))}
                      >
                        Reativar
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      type="button"
                      className="px-2 py-1.5 text-xs"
                      disabled={pending}
                      title="Desconectar"
                      onClick={() => run(() => disconnectAccountsAction([a.id]))}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
