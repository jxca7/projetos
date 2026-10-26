"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  disconnectAccountsAction,
  reactivateAccountsAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { ACCOUNT_STATUS } from "@/lib/labels";
import type { AccountStatus } from "@/generated/prisma/enums";

export interface OffAccount {
  id: string;
  igUsername: string;
  profilePicUrl: string | null;
  status: AccountStatus;
  statusMessage: string | null;
  folderName: string | null;
  tokenExpired: boolean;
}

/** O que cada estado exige de quem administra. */
const ACAO_POR_ESTADO: Record<string, string> = {
  TOKEN_EXPIRED:
    "A Meta invalidou o token. Só volta passando pelo OAuth de novo — não há botão que resolva.",
  REVOKED:
    "O acesso foi revogado no Instagram ou no Business Manager. Confira a conta no app e reconecte.",
  DISABLED: "Desligada aqui no painel. Pode ser reativada direto, se o token ainda valer.",
};

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

      <Card>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/api/meta/connect"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Reconectar pelo OAuth ({precisaOauth.length})
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
        </div>
        <p className="mt-3 text-xs text-muted">
          Uma única passagem pelo OAuth reconecta todas as contas que você autorizar na tela da
          Meta — não precisa repetir conta a conta.
        </p>
      </Card>

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
            const dica = a.tokenExpired && a.status === "DISABLED"
              ? "Desligada aqui, mas o token já venceu: precisa do OAuth."
              : ACAO_POR_ESTADO[a.status];
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={selected.includes(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <Avatar src={a.profilePicUrl} name={a.igUsername} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">@{a.igUsername}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {a.folderName ? <Badge>{a.folderName}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{dica}</p>
                  {a.statusMessage ? (
                    <p className="mt-0.5 text-xs text-muted">Meta disse: {a.statusMessage}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
