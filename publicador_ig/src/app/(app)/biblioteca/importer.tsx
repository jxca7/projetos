"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importReelsAction,
  importProfileAction,
  retryImportAction,
  clearImportsAction,
  saveIgCookiesAction,
  clearIgCookiesAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";

export type ImportStatus = "QUEUED" | "DOWNLOADING" | "DONE" | "DUPLICATE" | "FAILED";

export interface ImportRow {
  id: string;
  mode: "LINK" | "PROFILE";
  account: string | null;
  sourceUrl: string | null;
  status: ImportStatus;
  title: string | null;
  error: string | null;
  downloaded: number;
  skipped: number;
  thumbnailUrl: string | null;
  createdAt: string;
}

const STATUS: Record<ImportStatus, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  QUEUED: { label: "Na fila", tone: "neutral" },
  DOWNLOADING: { label: "Baixando…", tone: "accent" },
  DONE: { label: "Pronto", tone: "ok" },
  DUPLICATE: { label: "Já existia", tone: "warn" },
  FAILED: { label: "Falhou", tone: "danger" },
};

function isPendente(s: ImportStatus) {
  return s === "QUEUED" || s === "DOWNLOADING";
}

function urlCurta(u: string) {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

type Msg = { tone: "ok" | "warn" | "danger"; text: string } | null;

export function ReelImporter({
  initialImports,
  cookie,
}: {
  initialImports: ImportRow[];
  cookie: { configured: boolean; label: string | null };
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"links" | "perfil">("perfil");
  const [imports, setImports] = useState<ImportRow[]>(initialImports);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  const doneRef = useRef(initialImports.filter((i) => i.status === "DONE" || i.status === "DUPLICATE").length);
  const temPendente = imports.some((i) => isPendente(i.status));

  const puxar = useCallback(async () => {
    try {
      const res = await fetch("/api/media/imports", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { imports: ImportRow[] };
      setImports(json.imports);
      const done = json.imports.reduce((n, i) => n + (i.status === "DONE" || i.status === "DUPLICATE" ? 1 : 0), 0);
      if (done !== doneRef.current) {
        doneRef.current = done;
        router.refresh(); // algo entrou na biblioteca: recarrega a grade
      }
    } catch {
      /* rede instável; tenta no próximo ciclo */
    }
  }, [router]);

  useEffect(() => {
    if (!temPendente) return;
    const t = setInterval(() => void puxar(), 4000);
    return () => clearInterval(t);
  }, [temPendente, puxar]);

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
          <h3 className="font-head text-base font-semibold">Baixar do Instagram</h3>
          <p className="mt-0.5 text-sm text-muted">
            Baixa na melhor qualidade e salva direto na biblioteca. Baixe só conteúdo que você tem
            direito de usar.
          </p>
        </div>
        <CookieConfig cookie={cookie} onMsg={setMsg} busy={pending} />
      </div>

      {!cookie.configured ? (
        <Notice tone="warn">
          Configure o <strong>cookie</strong> da conta do Instagram (botão acima) antes de baixar — o
          Instagram exige login.
        </Notice>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {/* Abas */}
      <div className="flex gap-1 border-b border-border">
        {([
          ["perfil", "Perfil inteiro"],
          ["links", "Links avulsos"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={[
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              aba === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === "perfil" ? (
        <PerfilForm onMsg={setMsg} onDone={puxar} />
      ) : (
        <LinksForm onMsg={setMsg} onDone={puxar} />
      )}

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
              const titulo =
                imp.mode === "PROFILE"
                  ? imp.title || `@${imp.account}`
                  : imp.title || (imp.sourceUrl ? urlCurta(imp.sourceUrl) : "link");
              const sub =
                imp.error ??
                (imp.mode === "PROFILE"
                  ? `@${imp.account}`
                  : imp.sourceUrl
                    ? urlCurta(imp.sourceUrl)
                    : "");
              return (
                <li key={imp.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="size-9 shrink-0 overflow-hidden rounded-md bg-surface-2">
                    {imp.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imp.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-faint">
                        {imp.mode === "PROFILE" ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 21a8 8 0 0 1 16 0" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
                            <path d="m22 8-6 4 6 4V8Z" />
                            <rect x="2" y="6" width="14" height="12" rx="2" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{titulo}</p>
                    <p className={["truncate text-[11px]", imp.error ? "text-danger" : "text-faint"].join(" ")} title={sub}>
                      {sub}
                    </p>
                  </div>
                  {imp.mode === "PROFILE" && (imp.downloaded > 0 || imp.skipped > 0) ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {imp.downloaded} novo(s){imp.skipped ? ` · ${imp.skipped} repetido(s)` : ""}
                    </span>
                  ) : null}
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

/** Aba de perfil: todas as opções do downloader. */
function PerfilForm({ onMsg, onDone }: { onMsg: (m: Msg) => void; onDone: () => Promise<void> }) {
  const [account, setAccount] = useState("");
  const [conteudo, setConteudo] = useState<"reels" | "destaques" | "ambos">("reels");
  const [quantidade, setQuantidade] = useState("0");
  const [criterio, setCriterio] = useState<"recentes" | "vistos" | "curtidos">("recentes");
  const [analisar, setAnalisar] = useState("0");
  const [quaisDestaques, setQuaisDestaques] = useState("");
  const [pausa, setPausa] = useState("4");
  const [semLegenda, setSemLegenda] = useState(false);
  const [avancado, setAvancado] = useState(false);
  const [pending, startTransition] = useTransition();

  const mostraReels = conteudo !== "destaques";
  const mostraDestaques = conteudo !== "reels";

  function enviar() {
    if (!account.trim()) {
      onMsg({ tone: "warn", text: "Informe a conta (@ ou link do perfil)." });
      return;
    }
    startTransition(async () => {
      const r = await importProfileAction({
        account,
        conteudo,
        quantidade: Number(quantidade) || 0,
        criterio,
        analisar: Number(analisar) || 0,
        quaisDestaques,
        pausa: Number(pausa) || 4,
        semLegenda,
      });
      if (!r.ok) {
        onMsg({ tone: "danger", text: r.error });
        return;
      }
      onMsg({ tone: "ok", text: `@${r.account} na fila. Vai baixando aos poucos.` });
      setAccount("");
      await onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem] space-y-1">
          <span className="text-xs font-medium text-muted">Conta (@ ou link do perfil)</span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="nome_da_conta"
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">O que baixar</span>
          <select value={conteudo} onChange={(e) => setConteudo(e.target.value as typeof conteudo)} className="w-full">
            <option value="reels">Reels</option>
            <option value="destaques">Destaques</option>
            <option value="ambos">Reels e destaques</option>
          </select>
        </label>
      </div>

      {mostraReels ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-28 space-y-1">
            <span className="text-xs font-medium text-muted">Quantos</span>
            <input
              type="number"
              min={0}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="w-full"
            />
            <span className="block text-[11px] text-faint">0 = todos</span>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted">Ordem</span>
            <select value={criterio} onChange={(e) => setCriterio(e.target.value as typeof criterio)} className="w-full">
              <option value="recentes">Mais recentes</option>
              <option value="vistos">Mais visualizados</option>
              <option value="curtidos">Mais curtidos</option>
            </select>
          </label>
          {criterio !== "recentes" ? (
            <label className="w-40 space-y-1">
              <span className="text-xs font-medium text-muted">Analisar entre os N recentes</span>
              <input
                type="number"
                min={0}
                value={analisar}
                onChange={(e) => setAnalisar(e.target.value)}
                className="w-full"
              />
              <span className="block text-[11px] text-faint">0 = todos</span>
            </label>
          ) : null}
        </div>
      ) : null}

      {mostraDestaques ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Quais destaques (ordem do perfil)</span>
          <input
            value={quaisDestaques}
            onChange={(e) => setQuaisDestaques(e.target.value)}
            placeholder="vazio = todos · ex.: 1,3 ou 2-4"
            className="w-full max-w-xs"
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setAvancado((a) => !a)}
          className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        >
          {avancado ? "Ocultar avançado" : "Avançado"}
        </button>
        <Button type="button" disabled={pending} onClick={enviar}>
          Baixar perfil
        </Button>
      </div>

      {avancado ? (
        <div className="flex flex-wrap items-center gap-4 rounded-[var(--r-sm)] border border-border bg-surface-2 px-3 py-2">
          <label className="flex items-center gap-2 text-xs">
            Pausa entre downloads (s)
            <input
              type="number"
              min={1}
              max={60}
              value={pausa}
              onChange={(e) => setPausa(e.target.value)}
              className="w-20"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={semLegenda} onChange={(e) => setSemLegenda(e.target.checked)} className="size-4" />
            Não salvar a legenda
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Aba de links avulsos. */
function LinksForm({ onMsg, onDone }: { onMsg: (m: Msg) => void; onDone: () => Promise<void> }) {
  const [urls, setUrls] = useState("");
  const [pending, startTransition] = useTransition();

  function enviar() {
    const lista = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    if (lista.length === 0) {
      onMsg({ tone: "warn", text: "Cole ao menos um link de Reel." });
      return;
    }
    startTransition(async () => {
      const r = await importReelsAction({ urls: lista });
      if (!r.ok) {
        onMsg({ tone: "danger", text: r.error });
        return;
      }
      setUrls("");
      const partes = [`${r.queued} link(s) na fila`];
      if (r.invalid) partes.push(`${r.invalid} ignorado(s)`);
      onMsg({ tone: "ok", text: partes.join(", ") + "." });
      await onDone();
    });
  }

  return (
    <div className="space-y-2">
      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        rows={3}
        placeholder={"https://www.instagram.com/reel/XXXX/\nhttps://www.instagram.com/reel/YYYY/"}
        className="w-full font-mono text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-faint">Um link por linha (até 50).</p>
        <Button type="button" disabled={pending} onClick={enviar}>
          Importar links
        </Button>
      </div>
    </div>
  );
}

/** Configuração do cookie de login, num bloco recolhível. */
function CookieConfig({
  cookie,
  onMsg,
  busy,
}: {
  cookie: { configured: boolean; label: string | null };
  onMsg: (m: Msg) => void;
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
      onMsg({ tone: "ok", text: "Cookie salvo. Agora dá para baixar." });
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
              Instale a extensão <strong>Get cookies.txt LOCALLY</strong> no navegador, abra o
              instagram.com logado, exporte e cole aqui o conteúdo. Fica cifrado no servidor.
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
