"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  createPrepareJobAction,
  retryPrepareTargetAction,
  clearPrepareJobsAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

type TargetStatus = "QUEUED" | "POSTING" | "DONE" | "FAILED" | "SKIPPED_2FA";

interface PrepareTarget {
  id: string;
  username: string;
  status: TargetStatus;
  error: string | null;
}

export interface PrepareJob {
  id: string;
  imageUrl: string | null;
  bio: string | null;
  storyImageUrl: string | null;
  storyLink: string | null;
  createdAt: string;
  targets: PrepareTarget[];
}

const STATUS: Record<TargetStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  POSTING: { label: "Processando…", tone: "accent" },
  DONE: { label: "Pronto", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED_2FA: { label: "2FA/verificação", tone: "warn" },
};

function pendente(s: TargetStatus) {
  return s === "QUEUED" || s === "POSTING";
}

type Msg = { tone: "ok" | "warn" | "danger"; text: string } | null;

export function PrepareForm({ initialJobs }: { initialJobs: PrepareJob[] }) {
  const inputFile = useRef<HTMLInputElement>(null);
  const inputStory = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<PrepareJob[]>(initialJobs);
  const [msg, setMsg] = useState<Msg>(null);

  const [mediaId, setMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [enviandoImg, setEnviandoImg] = useState(false);
  const [bio, setBio] = useState("");
  const [storyMediaId, setStoryMediaId] = useState<string | null>(null);
  const [storyPreview, setStoryPreview] = useState<string | null>(null);
  const [enviandoStory, setEnviandoStory] = useState(false);
  const [storyLink, setStoryLink] = useState("");
  const [storyLinkLabel, setStoryLinkLabel] = useState("");
  const [storyHighlight, setStoryHighlight] = useState("");
  const [acceptInvite, setAcceptInvite] = useState(false);
  const [proxy, setProxy] = useState("");
  const [stickyPerAccount, setStickyPerAccount] = useState(true);
  const [accounts, setAccounts] = useState("");
  const [pending, startTransition] = useTransition();

  const temPendente = jobs.some((j) => j.targets.some((t) => pendente(t.status)));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/prepare/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { jobs: PrepareJob[] };
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

  /** Sobe a imagem para a biblioteca. `alvo` diz se é a foto do perfil ou a do story. */
  async function enviarImagem(file: File | undefined, alvo: "foto" | "story") {
    if (!file) return;
    const story = alvo === "story";
    const setEnviando = story ? setEnviandoStory : setEnviandoImg;
    const input = story ? inputStory : inputFile;
    setMsg(null);
    setEnviando(true);
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
      if (story) {
        setStoryMediaId(json.id);
        setStoryPreview(json.publicUrl);
      } else {
        setMediaId(json.id);
        setPreview(json.publicUrl);
      }
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  }

  function preparar() {
    if (!mediaId && !bio.trim() && !storyMediaId && !acceptInvite) {
      setMsg({ tone: "warn", text: "Escolha uma foto, uma bio, um story e/ou aceitar o convite." });
      return;
    }
    if (!accounts.trim()) {
      setMsg({ tone: "warn", text: "Cole as contas (combo ou usuario:senha)." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await createPrepareJobAction({
        mediaId: mediaId ?? undefined,
        bio,
        storyMediaId: storyMediaId ?? undefined,
        storyLink,
        storyLinkLabel,
        storyHighlight,
        proxy,
        stickyPerAccount,
        acceptInvite,
        accounts,
      });
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
      await retryPrepareTargetAction(id);
      await puxar();
    });
  }

  function limpar() {
    startTransition(async () => {
      await clearPrepareJobsAction();
      await puxar();
    });
  }

  const algumFinalizado = jobs.some((j) => j.targets.every((t) => !pendente(t.status)));

  return (
    <div className="space-y-5">
      <Notice tone="warn">
        Troca foto/bio e posta o story logando com <strong>a conta</strong> (combo com cookie entra sem 2FA) — use só
        nas suas contas, em volume moderado. Dados cifrados no servidor.
      </Notice>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap gap-4">
          {/* Foto de perfil */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted">Foto de perfil (opcional)</span>
            <button
              type="button"
              onClick={() => inputFile.current?.click()}
              className="grid size-28 place-items-center overflow-hidden rounded-full border-2 border-dashed border-border-strong bg-surface-2 text-faint transition-colors hover:border-accent"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-full object-cover" />
              ) : enviandoImg ? (
                <span className="text-xs">Enviando…</span>
              ) : (
                <span className="px-2 text-center text-[11px]">Escolher foto</span>
              )}
            </button>
            <input
              ref={inputFile}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => void enviarImagem(e.target.files?.[0], "foto")}
            />
          </div>

          {/* Bio */}
          <div className="min-w-[14rem] flex-1 space-y-1">
            <span className="text-xs font-medium text-muted">Bio (opcional, até 150)</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              maxLength={150}
              placeholder="A bio que vai em todas as contas da lista"
              className="w-full"
            />
            <span className="block text-right text-[11px] text-faint">{bio.length}/150</span>
          </div>
        </div>

        {/* Story — postado na mesma sessão, depois da foto/bio */}
        <div className="flex flex-wrap gap-4 border-t border-border pt-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted">Story (opcional)</span>
            <button
              type="button"
              onClick={() => inputStory.current?.click()}
              className="grid h-36 w-20 place-items-center overflow-hidden rounded-[var(--r-sm)] border-2 border-dashed border-border-strong bg-surface-2 text-faint transition-colors hover:border-accent"
            >
              {storyPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={storyPreview} alt="" className="size-full object-cover" />
              ) : enviandoStory ? (
                <span className="text-xs">Enviando…</span>
              ) : (
                <span className="px-2 text-center text-[11px]">Escolher imagem</span>
              )}
            </button>
            <input
              ref={inputStory}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => void enviarImagem(e.target.files?.[0], "story")}
            />
            {storyMediaId ? (
              <button
                type="button"
                onClick={() => {
                  setStoryMediaId(null);
                  setStoryPreview(null);
                }}
                className="block text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline"
              >
                Remover
              </button>
            ) : null}
          </div>

          <div className="min-w-[14rem] flex-1 space-y-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Link da figurinha (opcional)</span>
              <input
                value={storyLink}
                onChange={(e) => setStoryLink(e.target.value)}
                placeholder="https://..."
                disabled={!storyMediaId}
                className="w-full text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Texto da figurinha (opcional)</span>
              <input
                value={storyLinkLabel}
                onChange={(e) => setStoryLinkLabel(e.target.value)}
                placeholder="Vazio = o domínio do link"
                disabled={!storyMediaId}
                className="w-full text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">Destaque (opcional)</span>
              <input
                value={storyHighlight}
                onChange={(e) => setStoryHighlight(e.target.value)}
                placeholder="Nome do destaque (cria se não existir)"
                disabled={!storyMediaId}
                className="w-full text-xs"
              />
            </label>
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-[var(--r-sm)] border border-border bg-surface-2 px-3 py-2">
          <input
            type="checkbox"
            checked={acceptInvite}
            onChange={(e) => setAcceptInvite(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-xs">
            <strong>Aceitar o convite do testador também</strong> — abre um navegador no servidor e
            clica em “Aceitar”. Exige o <strong>combo</strong> (com cookie) em todas as contas. Proxy
            recomendado.
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
            Com o combo, entra sem 2FA e a sessão fica salva por conta. Uma de cada vez, espaçadas.
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" disabled={pending || enviandoImg || enviandoStory} onClick={preparar}>
            Preparar contas
          </Button>
        </div>
      </Card>

      {jobs.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Preparações {temPendente ? "· em andamento…" : ""}
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
                  <div className="size-10 shrink-0 overflow-hidden rounded-full bg-surface-2">
                    {job.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={job.imageUrl} alt="" className="size-full object-cover" />
                    ) : job.storyImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={job.storyImageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-[10px] text-faint">bio</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate">
                      {job.imageUrl ? <span className="text-accent">foto</span> : null}
                      {job.imageUrl && job.bio ? " · " : ""}
                      {job.bio ? <span className="text-muted">bio: {job.bio}</span> : null}
                      {job.storyImageUrl && (job.imageUrl || job.bio) ? " · " : ""}
                      {job.storyImageUrl ? (
                        <span className="text-accent">story{job.storyLink ? " com link" : ""}</span>
                      ) : null}
                    </p>
                    <p className="text-faint">
                      {ok}/{job.targets.length} pronto(s)
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
