"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  createStoryAppJobAction,
  retryStoryTargetAction,
  clearStoryJobsAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

type TargetStatus = "QUEUED" | "POSTING" | "DONE" | "FAILED" | "SKIPPED_2FA";

interface StoryTarget {
  id: string;
  username: string;
  status: TargetStatus;
  error: string | null;
}

export interface StoryJob {
  id: string;
  imageUrl: string;
  link: string | null;
  highlight: string | null;
  createdAt: string;
  targets: StoryTarget[];
}

const STATUS: Record<TargetStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  POSTING: { label: "Postando…", tone: "accent" },
  DONE: { label: "Postado", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED_2FA: { label: "2FA/verificação", tone: "warn" },
};

function pendente(s: TargetStatus) {
  return s === "QUEUED" || s === "POSTING";
}

type Msg = { tone: "ok" | "warn" | "danger"; text: string } | null;

export function StoryForm({ initialJobs }: { initialJobs: StoryJob[] }) {
  const inputFile = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<StoryJob[]>(initialJobs);
  const [msg, setMsg] = useState<Msg>(null);

  // Formulário
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [enviandoImg, setEnviandoImg] = useState(false);
  const [link, setLink] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [highlight, setHighlight] = useState("");
  const [proxy, setProxy] = useState("");
  const [stickyPerAccount, setStickyPerAccount] = useState(true);
  const [accounts, setAccounts] = useState("");
  const [pending, startTransition] = useTransition();

  const temPendente = jobs.some((j) => j.targets.some((t) => pendente(t.status)));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/story-app/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { jobs: StoryJob[] };
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

  async function enviarImagem(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setEnviandoImg(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("usedFor", "LIBRARY");
      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ tone: "danger", text: json.error ?? "Falha ao enviar a imagem." });
        return;
      }
      setMediaId(json.id);
      setPreview(json.publicUrl);
    } finally {
      setEnviandoImg(false);
      if (inputFile.current) inputFile.current.value = "";
    }
  }

  function postar() {
    if (!mediaId) {
      setMsg({ tone: "warn", text: "Escolha a imagem do story." });
      return;
    }
    if (!accounts.trim()) {
      setMsg({ tone: "warn", text: "Cole as contas (usuario:senha, uma por linha)." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await createStoryAppJobAction({ mediaId, link, linkLabel, highlight, proxy, stickyPerAccount, accounts });
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error });
        return;
      }
      setMsg({ tone: "ok", text: `Story na fila para ${r.contas} conta(s).` });
      setAccounts("");
      await puxar();
    });
  }

  function tentarDeNovo(id: string) {
    startTransition(async () => {
      await retryStoryTargetAction(id);
      await puxar();
    });
  }

  function limpar() {
    startTransition(async () => {
      await clearStoryJobsAction();
      await puxar();
    });
  }

  const algumFinalizado = jobs.some((j) => j.targets.every((t) => !pendente(t.status)));

  return (
    <div className="space-y-5">
      <Notice tone="warn">
        Posta pela API do app, logando com <strong>a senha de cada conta</strong> — use só nas suas
        contas e sem exagerar no volume. As senhas ficam cifradas no servidor. Link e destaque não
        existem na API oficial; por isso o story vai por aqui.
      </Notice>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap gap-4">
          {/* Imagem */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted">Imagem do story</span>
            <button
              type="button"
              onClick={() => inputFile.current?.click()}
              className="grid aspect-[9/16] w-32 place-items-center overflow-hidden rounded-[var(--r-sm)] border-2 border-dashed border-border-strong bg-surface-2 text-faint transition-colors hover:border-accent"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-full object-cover" />
              ) : enviandoImg ? (
                <span className="text-xs">Enviando…</span>
              ) : (
                <span className="px-2 text-center text-xs">Clique para escolher (JPG/PNG)</span>
              )}
            </button>
            <input
              ref={inputFile}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => void enviarImagem(e.target.files?.[0])}
            />
          </div>

          {/* Campos */}
          <div className="min-w-[14rem] flex-1 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Link da figurinha</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://..."
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Texto da figurinha (opcional)</span>
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="ex.: Clique aqui"
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Destaque (opcional)</span>
              <input
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                placeholder="nome do destaque — cria se não existir"
                className="w-full"
              />
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
              <span className="block text-[11px] text-faint">
                {stickyPerAccount
                  ? "Ligado: um IP por conta. Ideal para várias contas."
                  : "Desligado: a mesma proxy para todas as contas deste envio (arriscado para muitas contas)."}
              </span>
            </label>
          </div>
        </div>

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
            Com o combo (cookie + aparelho), entra sem 2FA e a sessão fica salva por conta. Só
            usuario:senha também funciona (loga por senha). Uma de cada vez, espaçadas; 2FA é pulado.
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" disabled={pending || enviandoImg} onClick={postar}>
            Postar story
          </Button>
        </div>
      </Card>

      {jobs.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Postagens {temPendente ? "· em andamento…" : ""}
            </span>
            {algumFinalizado ? (
              <button
                type="button"
                onClick={limpar}
                disabled={pending}
                className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
                title="Apaga os jobs finalizados (e as senhas cifradas)"
              >
                Limpar finalizados
              </button>
            ) : null}
          </div>

          {jobs.map((job) => {
            const ok = job.targets.filter((t) => t.status === "DONE").length;
            return (
              <Card key={job.id} className="p-0">
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="h-14 w-9 shrink-0 overflow-hidden rounded bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.imageUrl} alt="" className="size-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate">
                      {job.link ? (
                        <span className="text-accent">🔗 {job.link}</span>
                      ) : (
                        <span className="text-faint">sem link</span>
                      )}
                      {job.highlight ? <span className="text-muted"> · destaque “{job.highlight}”</span> : null}
                    </p>
                    <p className="text-faint">
                      {ok}/{job.targets.length} postado(s)
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
                          <span className="hidden max-w-[40%] truncate text-[11px] text-danger sm:inline" title={t.error}>
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
