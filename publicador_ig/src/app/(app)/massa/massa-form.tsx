"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBulkPostAction } from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { formatDuration } from "@/lib/labels";

export interface BulkMedia {
  id: string;
  kind: "IMAGE" | "VIDEO";
  publicUrl: string;
  thumbnailUrl: string | null;
  originalName: string | null;
  sizeBytes: number;
  durationMs: number | null;
}

export interface BulkAccount {
  id: string;
  igUsername: string;
  profilePicUrl: string | null;
}

type Tipo = "REEL" | "IMAGE" | "STORY" | "CAROUSEL";

const TIPOS: { v: Tipo; label: string; hint: string }[] = [
  { v: "REEL", label: "Reels", hint: "Vídeo vertical publicado como Reel." },
  { v: "IMAGE", label: "Post", hint: "Imagem publicada no feed do perfil." },
  { v: "STORY", label: "Story", hint: "Publicação temporária (24h)." },
  { v: "CAROUSEL", label: "Carrossel", hint: "2 a 10 imagens/vídeos num único post." },
];

/** Quais mídias cada tipo aceita. */
function aceita(tipo: Tipo, kind: "IMAGE" | "VIDEO"): boolean {
  if (tipo === "REEL") return kind === "VIDEO";
  if (tipo === "IMAGE") return kind === "IMAGE";
  return true; // STORY e CAROUSEL aceitam imagem ou vídeo
}

export function BulkForm({ media, accounts }: { media: BulkMedia[]; accounts: BulkAccount[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>("REEL");
  const [selMedia, setSelMedia] = useState<string[]>([]);
  const [selAccounts, setSelAccounts] = useState<string[]>([]);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [ordem, setOrdem] = useState<"sequencial" | "aleatorio">("sequencial");
  const [caption, setCaption] = useState("");
  const [intervalo, setIntervalo] = useState(180);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const visiveis = useMemo(() => media.filter((m) => aceita(tipo, m.kind)), [media, tipo]);

  function trocarTipo(t: Tipo) {
    setTipo(t);
    // Mantém só as mídias que o novo tipo aceita.
    setSelMedia((prev) => prev.filter((id) => media.find((m) => m.id === id && aceita(t, m.kind))));
  }

  function toggleMedia(id: string) {
    setSelMedia((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 10) return prev; // teto de 10
      return [...prev, id];
    });
  }

  function toggleAccount(id: string) {
    setSelAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const nMidias = tipo === "CAROUSEL" ? (selMedia.length >= 2 ? 1 : 0) : selMedia.length;
  const totalPosts = nMidias * selAccounts.length;
  const tempoSeg = totalPosts > 0 ? (totalPosts - 1) * intervalo : 0;
  const tempoLabel =
    tempoSeg < 60 ? `${tempoSeg}s` : `~${Math.round(tempoSeg / 60)} min`;

  function publicar() {
    if (selMedia.length === 0) {
      setMsg({ tone: "warn", text: "Selecione ao menos uma mídia." });
      return;
    }
    if (tipo === "CAROUSEL" && selMedia.length < 2) {
      setMsg({ tone: "warn", text: "Carrossel precisa de 2 a 10 itens." });
      return;
    }
    if (selAccounts.length === 0) {
      setMsg({ tone: "warn", text: "Selecione ao menos uma conta." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await createBulkPostAction({
        type: tipo,
        mediaIds: selMedia,
        accountIds: selAccounts,
        accountOrder: ordem,
        shareToFeed,
        caption,
        intervalSeconds: intervalo,
      });
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error });
        return;
      }
      setMsg({
        tone: "ok",
        text: `${r.enfileirados} post(s) na fila (${r.posts} mídia(s) × ${r.contas} conta(s)). Acompanhe na Fila.`,
      });
      setSelMedia([]);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

        {/* Biblioteca */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-head text-base font-semibold">Biblioteca</h3>
            <span className="text-xs text-muted">
              {selMedia.length} selecionada(s){" "}
              {selMedia.length > 0 ? (
                <button type="button" onClick={() => setSelMedia([])} className="ml-1 text-accent hover:underline">
                  Limpar
                </button>
              ) : null}
            </span>
          </div>
          {visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Nenhuma mídia para este tipo. Envie na Biblioteca.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {visiveis.map((m) => {
                const ordemSel = selMedia.indexOf(m.id);
                const sel = ordemSel >= 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMedia(m.id)}
                    className={[
                      "relative aspect-square overflow-hidden rounded-[var(--r-sm)] border-2 bg-surface-2 transition",
                      sel ? "border-accent" : "border-transparent hover:border-border-strong",
                    ].join(" ")}
                  >
                    {m.kind === "IMAGE" || m.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.kind === "IMAGE" ? m.publicUrl : (m.thumbnailUrl as string)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-faint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-7">
                          <path d="m22 8-6 4 6 4V8Z" />
                          <rect x="2" y="6" width="14" height="12" rx="2" />
                        </svg>
                      </div>
                    )}
                    {sel ? (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-[var(--accent-ink)]">
                        {ordemSel + 1}
                      </span>
                    ) : null}
                    {m.kind === "VIDEO" && m.durationMs ? (
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                        {formatDuration(m.durationMs)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Tipo de postagem */}
        <Card className="space-y-3">
          <h3 className="font-head text-base font-semibold">Tipo de postagem</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPOS.map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => trocarTipo(t.v)}
                className={[
                  "rounded-[var(--r-sm)] border px-3 py-2.5 text-left transition",
                  tipo === t.v ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span className={["size-3.5 rounded-full border", tipo === t.v ? "border-accent bg-accent" : "border-border-strong"].join(" ")} />
                  <span className="text-sm font-medium">{t.label}</span>
                </div>
                <p className="mt-0.5 pl-5 text-xs text-muted">{t.hint}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Grade principal (só Reels) */}
        {tipo === "REEL" ? (
          <Card className="space-y-3">
            <h3 className="font-head text-base font-semibold">Grade principal dos Reels</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: true, label: "Reels + grade", hint: "Aparece também no perfil principal." },
                { v: false, label: "Só aba Reels", hint: "Não coloca o Reel na grade principal." },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setShareToFeed(o.v)}
                  className={[
                    "rounded-[var(--r-sm)] border px-3 py-2.5 text-left transition",
                    shareToFeed === o.v ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                  ].join(" ")}
                >
                  <span className="text-sm font-medium">{o.label}</span>
                  <p className="mt-0.5 text-xs text-muted">{o.hint}</p>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {/* Ordem das contas */}
        <Card className="space-y-3">
          <h3 className="font-head text-base font-semibold">Ordem das contas</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { v: "sequencial" as const, label: "Sequencial", hint: "1ª mídia na conta 1, 2, 3… depois a 2ª na mesma ordem." },
              { v: "aleatorio" as const, label: "Aleatório", hint: "Embaralha as contas uma vez; cada mídia segue essa ordem." },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setOrdem(o.v)}
                className={[
                  "rounded-[var(--r-sm)] border px-3 py-2.5 text-left transition",
                  ordem === o.v ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                ].join(" ")}
              >
                <span className="text-sm font-medium">{o.label}</span>
                <p className="mt-0.5 text-xs text-muted">{o.hint}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Legenda + intervalo */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="space-y-2">
            <h3 className="font-head text-base font-semibold">Legenda</h3>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
              rows={5}
              placeholder="Escreva a legenda… (vai em todos os posts)"
              className="w-full"
            />
            <p className="text-right text-[11px] text-faint">{caption.length}/2200</p>
          </Card>

          <Card className="space-y-2">
            <h3 className="font-head text-base font-semibold">Intervalo entre cada post</h3>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={600}
                step={5}
                value={intervalo}
                onChange={(e) => setIntervalo(Number(e.target.value))}
                className="flex-1"
              />
              <div className="grid w-16 place-items-center rounded-[var(--r-sm)] bg-accent-soft py-1 text-center">
                <span className="text-lg font-bold tabular-nums text-accent">{intervalo}</span>
                <span className="text-[10px] text-accent">segundos</span>
              </div>
            </div>
            <p className="text-xs text-muted">{intervalo}s entre cada post da fila.</p>
          </Card>
        </div>
      </div>

      {/* Coluna direita: contas + resumo */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="space-y-2 p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">{selAccounts.length} selecionada(s)</span>
            <button
              type="button"
              onClick={() => setSelAccounts(selAccounts.length === accounts.length ? [] : accounts.map((a) => a.id))}
              className="text-xs text-accent hover:underline"
            >
              {selAccounts.length === accounts.length ? "Limpar" : "Selecionar todas"}
            </button>
          </div>
          {accounts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Nenhuma conta ativa conectada. Conecte na tela Contas.
            </p>
          ) : (
            <ul className="max-h-80 overflow-auto">
              {accounts.map((a) => {
                const sel = selAccounts.includes(a.id);
                return (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2">
                      <input type="checkbox" checked={sel} onChange={() => toggleAccount(a.id)} className="size-4" />
                      <Avatar src={a.profilePicUrl} name={a.igUsername} size={26} />
                      <span className="min-w-0 flex-1 truncate">@{a.igUsername}</span>
                      <Badge tone="ok">Ativo</Badge>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="space-y-2">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Mídias</dt>
              <dd className="font-medium tabular-nums">{selMedia.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Contas</dt>
              <dd className="font-medium tabular-nums">{selAccounts.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Posts no total</dt>
              <dd className="font-medium tabular-nums">{totalPosts}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Intervalo</dt>
              <dd className="font-medium tabular-nums">{intervalo}s</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Tempo estimado</dt>
              <dd className="font-medium">{tempoLabel}</dd>
            </div>
          </dl>
          <Button type="button" className="w-full" disabled={pending} onClick={publicar}>
            {pending ? "Enfileirando…" : `Publicar ${totalPosts} post(s)`}
          </Button>
          <p className="text-[11px] text-faint">
            Mesma mídia em várias contas é conteúdo duplicado aos olhos do Instagram — o intervalo
            ajuda. Vão uma de cada vez, pela API oficial.
          </p>
        </Card>
      </div>
    </div>
  );
}
