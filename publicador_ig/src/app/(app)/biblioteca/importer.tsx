"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importReelsAction,
  retryImportAction,
  clearImportsAction,
  saveIgCookiesAction,
  clearIgCookiesAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

export type ImportStatus = "QUEUED" | "DOWNLOADING" | "DONE" | "DUPLICATE" | "FAILED";

export interface ImportRow {
  id: string;
  sourceUrl: string;
  status: ImportStatus;
  title: string | null;
  error: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

const STATUS: Record<ImportStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  DOWNLOADING: { label: "Baixando…", tone: "accent" },
  DONE: { label: "Na biblioteca", tone: "ok" },
  DUPLICATE: { label: "Já existia", tone: "warn" },
  FAILED: { label: "Falhou", tone: "danger" },
};

function isPendente(s: ImportStatus) {
  return s === "QUEUED" || s === "DOWNLOADING";
}

/** Encurta a URL para caber na linha. */
function urlCurta(u: string) {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

export function ReelImporter({
  initialImports,
  cookie,
}: {
  initialImports: ImportRow[];
  cookie: { configured: boolean; label: string | null };
}) {
  const router = useRouter();
  const [urls, setUrls] = useState("");
  const [imports, setImports] = useState<ImportRow[]>(initialImports);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Quantos concluíram, para disparar um refresh da grade quando um novo asset entra.
  const doneRef = useRef(initialImports.filter((i) => i.status === "DONE" || i.status === "DUPLICATE").length);
  const temPendente = imports.some((i) => isPendente(i.status));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/media/imports", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { imports: ImportRow[] };
      setImports(json.imports);
      const done = json.imports.filter((i) => i.status === "DONE" || i.status === "DUPLICATE").length;
      if (done > doneRef.current) {
        doneRef.current = done;
        // Algo novo entrou na biblioteca: recarrega a grade.
        router.refresh();
      }
    } catch {
      /* rede instável; tenta de novo no próximo ciclo */
    }
  }, [router]);

  // Enquanto houver download em andamento, acompanha a cada 4s.
  useEffect(() => {
    if (!temPendente) return;
    const t = setInterval(() => void puxar(), 4000);
    return () => clearInterval(t);
  }, [temPendente, puxar]);

  function importar() {
    const lista = urls
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (lista.length === 0) {
      setMsg({ tone: "warn", text: "Cole ao menos um link de Reel." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await importReelsAction({ urls: lista });
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error });
        return;
      }
      setUrls("");
      const partes = [`${r.queued} link(s) na fila`];
      if (r.invalid) partes.push(`${r.invalid} ignorado(s) (não eram do Instagram)`);
      setMsg({ tone: "ok", text: partes.join(", ") + "." });
      await puxar();
    });
  }

  function tentarDeNovo(id: string) {
    startTransition(async () => {
      await retryImportAction(id);
      await puxar();
    });
  }

  function limpar() {
    startTransition(async () => {
      await clearImportsAction();
      await puxar();
    });
  }

  const concluidas = imports.filter((i) => !isPendente(i.status)).length;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-head text-base font-semibold">Importar Reels do Instagram</h3>
          <p className="mt-0.5 text-sm text-muted">
            Cole um ou vários links (um por linha). O servidor baixa e salva direto na biblioteca.
          </p>
        </div>
        <CookieConfig cookie={cookie} onMsg={setMsg} busy={pending} />
      </div>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <div className="space-y-2">
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={3}
          placeholder={"https://www.instagram.com/reel/XXXXXXXXX/\nhttps://www.instagram.com/reel/YYYYYYYYY/"}
          className="w-full font-mono text-xs"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-faint">
            Dá para colar a lista inteira de uma vez (até 50). Vão baixando aos poucos para não
            sobrecarregar a conta do cookie.
          </p>
          <Button type="button" disabled={pending} onClick={importar}>
            Importar
          </Button>
        </div>
      </div>

      {imports.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Importações {temPendente ? "· baixando…" : ""}
            </span>
            {concluidas > 0 ? (
              <button
                type="button"
                onClick={limpar}
                disabled={pending}
                className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
              >
                Limpar concluídas
              </button>
            ) : null}
          </div>
          <ul className="divide-y divide-border rounded-[var(--r-sm)] border border-border">
            {imports.map((imp) => {
              const s = STATUS[imp.status];
              return (
                <li key={imp.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-2">
                    {imp.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imp.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-faint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
                          <path d="m22 8-6 4 6 4V8Z" />
                          <rect x="2" y="6" width="14" height="12" rx="2" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{imp.title || urlCurta(imp.sourceUrl)}</p>
                    {imp.error ? (
                      <p className="truncate text-[11px] text-danger" title={imp.error}>
                        {imp.error}
                      </p>
                    ) : (
                      <p className="truncate text-[11px] text-faint">{urlCurta(imp.sourceUrl)}</p>
                    )}
                  </div>
                  <Badge tone={s.tone} dot>
                    {s.label}
                  </Badge>
                  {imp.status === "FAILED" ? (
                    <Button
                      variant="ghost"
                      type="button"
                      className="px-2 py-1 text-xs"
                      disabled={pending}
                      onClick={() => tentarDeNovo(imp.id)}
                    >
                      Tentar de novo
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/** Configuração do cookie de login, num bloco recolhível. */
function CookieConfig({
  cookie,
  onMsg,
  busy,
}: {
  cookie: { configured: boolean; label: string | null };
  onMsg: (m: { tone: "ok" | "warn" | "danger"; text: string }) => void;
  busy: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [label, setLabel] = useState(cookie.label ?? "");
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (texto.trim().length < 50) {
      onMsg({ tone: "warn", text: "Cole o conteúdo do cookies.txt." });
      return;
    }
    startTransition(async () => {
      const r = await saveIgCookiesAction({ cookies: texto, label });
      if (!r.ok) {
        onMsg({ tone: "danger", text: r.error });
        return;
      }
      setTexto("");
      setAberto(false);
      onMsg({ tone: "ok", text: "Cookie salvo. Agora dá para baixar conteúdo que exige login." });
      router.refresh();
    });
  }

  function remover() {
    startTransition(async () => {
      await clearIgCookiesAction();
      onMsg({ tone: "ok", text: "Cookie removido." });
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        type="button"
        className="px-3 py-1.5 text-xs"
        disabled={busy}
        onClick={() => setAberto((a) => !a)}
      >
        <span className={cookie.configured ? "text-ok" : undefined}>●</span>{" "}
        {cookie.configured ? "Cookie configurado" : "Configurar cookie"}
      </Button>

      {aberto ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(92vw,30rem)] space-y-3 rounded-[var(--r)] border border-border bg-surface p-4 shadow-lg">
          <div>
            <h4 className="text-sm font-semibold">Cookie da conta do Instagram</h4>
            <p className="mt-1 text-xs text-muted">
              O Instagram só mostra muitos Reels para quem está logado. Instale a extensão{" "}
              <strong>Get cookies.txt LOCALLY</strong> no navegador, abra o instagram.com logado,
              exporte e cole aqui o conteúdo. Fica cifrado no servidor.
            </p>
            <p className="mt-1 text-xs text-faint">
              Use uma conta secundária: baixar muito de uma vez pode gerar limite na conta do cookie.
            </p>
          </div>

          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Rótulo (ex.: @minha_conta_secundaria)"
            className="w-full text-sm"
          />
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            placeholder="# Netscape HTTP Cookie File ..."
            className="w-full font-mono text-[11px]"
          />
          <div className="flex items-center justify-between gap-2">
            {cookie.configured ? (
              <Button variant="ghost" type="button" className="px-2 py-1.5 text-xs" disabled={pending} onClick={remover}>
                Remover cookie
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" type="button" className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => setAberto(false)}>
                Fechar
              </Button>
              <Button type="button" className="px-3 py-1.5 text-xs" disabled={pending} onClick={salvar}>
                Salvar cookie
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
