"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createConnectJobAction,
  retryConnectTargetAction,
  clearConnectJobsAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

type TargetStatus = "QUEUED" | "POSTING" | "DONE" | "FAILED" | "SKIPPED_2FA";

interface ConnectTarget {
  id: string;
  username: string;
  status: TargetStatus;
  error: string | null;
  connected: string | null;
}

export interface ConnectJob {
  id: string;
  createdAt: string;
  targets: ConnectTarget[];
}

const STATUS: Record<TargetStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  POSTING: { label: "Conectando…", tone: "accent" },
  DONE: { label: "Conectada", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED_2FA: { label: "2FA/verificação", tone: "warn" },
};

function pendente(s: TargetStatus) {
  return s === "QUEUED" || s === "POSTING";
}

type Msg = { tone: "ok" | "warn" | "danger"; text: string } | null;

export function ConnectForm({ initialJobs }: { initialJobs: ConnectJob[] }) {
  const [jobs, setJobs] = useState<ConnectJob[]>(initialJobs);
  const [msg, setMsg] = useState<Msg>(null);

  const [proxy, setProxy] = useState("");
  const [stickyPerAccount, setStickyPerAccount] = useState(true);
  const [accounts, setAccounts] = useState("");
  const [pending, startTransition] = useTransition();

  const temPendente = jobs.some((j) => j.targets.some((t) => pendente(t.status)));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/connect/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { jobs: ConnectJob[] };
      setJobs(json.jobs);
    } catch {
      /* tenta no próximo ciclo */
    }
  }, []);

  useEffect(() => {
    if (!temPendente) return;
    const t = setInterval(() => void puxar(), 4000);
    return () => clearInterval(t);
  }, [temPendente, puxar]);

  function conectar() {
    if (!accounts.trim()) {
      setMsg({ tone: "warn", text: "Cole os combos das contas (com cookie)." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await createConnectJobAction({ proxy, stickyPerAccount, accounts });
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error });
        return;
      }
      setMsg({ tone: "ok", text: `Na fila para ${r.contas} conta(s).` });
      setAccounts("");
      await puxar();
    });
  }

  function tentarDeNovo(id: string) {
    startTransition(async () => {
      await retryConnectTargetAction(id);
      await puxar();
    });
  }

  function limpar() {
    startTransition(async () => {
      await clearConnectJobsAction();
      await puxar();
    });
  }

  const algumFinalizado = jobs.some((j) => j.targets.every((t) => !pendente(t.status)));

  return (
    <div className="space-y-5">
      <Notice tone="warn">
        Conecta as contas <strong>sozinho</strong>: um navegador no servidor faz o OAuth logado pelo
        cookie de cada conta e clica até o <strong>Permitir</strong>. Requer que as contas já tenham
        <strong> aceitado o convite de testador</strong>. Use <strong>um IP por conta</strong> e vá
        devagar.
      </Notice>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Proxy (recomendado)</span>
          <input
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="host:porta  ·  host:porta:user:senha  ·  http://user:senha@host:porta"
            className="w-full font-mono text-xs"
          />
          <label className="mt-1.5 flex items-start gap-2">
            <input
              type="checkbox"
              checked={stickyPerAccount}
              onChange={(e) => setStickyPerAccount(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="text-[11px] text-muted">
              <strong>Um IP por conta (IPRoyal sticky).</strong> Cole os dados base{" "}
              <code>host:porta:usuario:senha</code> — cada conta conecta por um IP diferente e fixo.
            </span>
          </label>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            Contas (uma por linha) — <strong>combo completo</strong>{" "}
            <code>Login:Pass|UserAgent|TechData|Cookie</code>
          </span>
          <textarea
            value={accounts}
            onChange={(e) => setAccounts(e.target.value)}
            rows={5}
            placeholder={"usuario:senha | useragent | techdata | cookie"}
            className="w-full font-mono text-xs"
          />
          <span className="block text-[11px] text-faint">
            Precisa do <strong>cookie (sessionid)</strong> no combo — é por ele que o navegador entra
            sem 2FA. Uma de cada vez, espaçadas.
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={conectar}>
            Conectar contas
          </Button>
        </div>
      </Card>

      {jobs.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Conexões {temPendente ? "· em andamento…" : ""}
            </span>
            {algumFinalizado ? (
              <button
                type="button"
                onClick={limpar}
                disabled={pending}
                className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
                title="Apaga os registros finalizados (os combos cifrados)"
              >
                Limpar finalizados
              </button>
            ) : null}
          </div>

          {jobs.map((job) => {
            const ok = job.targets.filter((t) => t.status === "DONE").length;
            return (
              <Card key={job.id} className="p-0">
                <div className="border-b border-border px-4 py-3 text-xs text-faint">
                  {ok}/{job.targets.length} conectada(s)
                </div>
                <ul className="divide-y divide-border">
                  {job.targets.map((t) => {
                    const s = STATUS[t.status];
                    return (
                      <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          @{t.username}
                          {t.connected && t.connected !== t.username ? (
                            <span className="text-faint"> → {t.connected}</span>
                          ) : null}
                        </span>
                        {t.error ? (
                          <span className="hidden max-w-[45%] truncate text-[11px] text-danger sm:inline" title={t.error}>
                            {t.error}
                          </span>
                        ) : null}
                        <Badge tone={s.tone} dot>
                          {s.label}
                        </Badge>
                        {t.status === "FAILED" || t.status === "SKIPPED_2FA" ? (
                          <Button
                            variant="ghost"
                            type="button"
                            className="px-2 py-1 text-xs"
                            disabled={pending}
                            onClick={() => tentarDeNovo(t.id)}
                          >
                            Tentar de novo
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
