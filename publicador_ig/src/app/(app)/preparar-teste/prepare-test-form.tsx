"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createPrepareTestJobAction,
  retryPrepareTestTargetAction,
  clearPrepareTestJobsAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

type TargetStatus = "QUEUED" | "POSTING" | "DONE" | "FAILED" | "SKIPPED_2FA";

interface TestTarget {
  id: string;
  username: string;
  status: TargetStatus;
  error: string | null;
}

export interface PrepareTestJob {
  id: string;
  appId: string;
  createdAt: string;
  targets: TestTarget[];
}

const STATUS: Record<TargetStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  POSTING: { label: "Processando…", tone: "accent" },
  DONE: { label: "Aceito", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED_2FA: { label: "2FA/verificação", tone: "warn" },
};

function pendente(s: TargetStatus) {
  return s === "QUEUED" || s === "POSTING";
}

type Msg = { tone: "ok" | "warn" | "danger"; text: string } | null;

const APP_ID_KEY = "publicador_ig.teste_convite.app_id";

export function PrepareTestForm({ initialJobs }: { initialJobs: PrepareTestJob[] }) {
  const [jobs, setJobs] = useState<PrepareTestJob[]>(initialJobs);
  const [msg, setMsg] = useState<Msg>(null);

  const [appId, setAppId] = useState("");
  const [proxy, setProxy] = useState("");
  const [stickyPerAccount, setStickyPerAccount] = useState(true);
  const [accounts, setAccounts] = useState("");
  const [pending, startTransition] = useTransition();

  // Lembra o último ID de app usado (comodidade, só neste navegador).
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(APP_ID_KEY);
      if (salvo) setAppId(salvo);
    } catch {
      /* ignore */
    }
  }, []);

  const temPendente = jobs.some((j) => j.targets.some((t) => pendente(t.status)));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/prepare-test/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { jobs: PrepareTestJob[] };
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

  function testar() {
    if (!/^\d+$/.test(appId.trim())) {
      setMsg({ tone: "warn", text: "Informe o ID do app na Meta (só números)." });
      return;
    }
    if (!accounts.trim()) {
      setMsg({ tone: "warn", text: "Cole as contas (combo ou usuario:senha)." });
      return;
    }
    try {
      localStorage.setItem(APP_ID_KEY, appId.trim());
    } catch {
      /* ignore */
    }
    setMsg(null);
    startTransition(async () => {
      const r = await createPrepareTestJobAction({ appId, proxy, stickyPerAccount, accounts });
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
      await retryPrepareTestTargetAction(id);
      await puxar();
    });
  }

  function limpar() {
    startTransition(async () => {
      await clearPrepareTestJobsAction();
      await puxar();
    });
  }

  const algumFinalizado = jobs.some((j) => j.targets.every((t) => !pendente(t.status)));

  return (
    <div className="space-y-5">
      <Notice tone="warn">
        <strong>Teste.</strong> Aceita o convite do testador <strong>pelo instagrapi</strong>, sem abrir
        navegador — reusa a sessão logada da conta e chama o mesmo endpoint do site. É experimental: o
        Instagram pode mudar e quebrar. O jeito do navegador continua no <strong>Preparar conta</strong>.
      </Notice>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">ID do app na Meta (do convite)</span>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            inputMode="numeric"
            placeholder="ex.: 2202962557765125"
            className="w-full font-mono text-xs"
          />
          <span className="block text-[11px] text-faint">
            O mesmo app que mandou os convites. Fica guardado para a próxima vez, só neste navegador.
          </span>
        </label>

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
              <code>host:porta:usuario:senha</code> — cada conta ganha um IP residencial
              diferente e fixo. Evita que, se uma cair, caiam todas.
            </span>
          </label>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            Contas (uma por linha) — <code>usuario:senha</code> ou o combo completo
          </span>
          <textarea
            value={accounts}
            onChange={(e) => setAccounts(e.target.value)}
            rows={4}
            placeholder={"usuario:senha\nusuario:senha | useragent | techdata | cookie"}
            className="w-full font-mono text-xs"
          />
          <span className="block text-[11px] text-faint">
            Com o combo, entra sem 2FA. Use contas que tenham o <strong>convite pendente</strong>.
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={testar}>
            Testar convite
          </Button>
        </div>
      </Card>

      {jobs.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Testes {temPendente ? "· em andamento…" : ""}
            </span>
            {algumFinalizado ? (
              <button
                type="button"
                onClick={limpar}
                disabled={pending}
                className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
                title="Apaga os testes finalizados (e as senhas cifradas)"
              >
                Limpar finalizados
              </button>
            ) : null}
          </div>

          {jobs.map((job) => {
            const ok = job.targets.filter((t) => t.status === "DONE").length;
            return (
              <Card key={job.id} className="p-0">
                <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-muted">
                      app <span className="font-mono text-text">{job.appId}</span>
                    </p>
                    <p className="text-faint">
                      {ok}/{job.targets.length} aceito(s)
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {job.targets.map((t) => {
                    const s = STATUS[t.status];
                    return (
                      <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">@{t.username}</span>
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
