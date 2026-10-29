"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteMediaAction,
  removeDuplicateMediaAction,
  toggleMediaFavoriteAction,
} from "@/app/actions";
import { Button, Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { formatBytes, formatDuration } from "@/lib/labels";

export interface MediaItem {
  id: string;
  kind: "IMAGE" | "VIDEO";
  publicUrl: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  favorite: boolean;
  usedCount: number;
}

type Filtro = "todas" | "favoritas" | "videos" | "imagens";

export function MediaLibrary({ initial }: { initial: MediaItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [itens, setItens] = useState<MediaItem[]>(initial);
  // Quando o servidor recarrega (ex.: um Reel importado entrou na biblioteca),
  // `initial` muda e refletimos a verdade do banco na grade.
  useEffect(() => {
    setItens(initial);
  }, [initial]);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [pending, startTransition] = useTransition();

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter((m) => {
      if (filtro === "favoritas" && !m.favorite) return false;
      if (filtro === "videos" && m.kind !== "VIDEO") return false;
      if (filtro === "imagens" && m.kind !== "IMAGE") return false;
      if (termo && !(m.originalName ?? "").toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [itens, filtro, busca]);

  async function enviar(files: FileList | null) {
    if (!files || files.length === 0) return;
    setMsg(null);
    setEnviando(true);
    const novos: MediaItem[] = [];
    const erros: string[] = [];
    let duplicadas = 0;

    for (const file of Array.from(files)) {
      const kind = file.type.startsWith("video") ? "VIDEO" : "IMAGE";
      const form = new FormData();
      form.set("file", file);
      form.set("usedFor", "LIBRARY");
      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        erros.push(`${file.name}: ${json.error ?? "falha"}`);
        continue;
      }
      if (json.duplicate) {
        duplicadas++;
        continue;
      }
      novos.push({
        id: json.id,
        kind,
        publicUrl: json.publicUrl,
        thumbnailUrl: json.thumbnailUrl ?? null,
        durationMs: json.durationMs ?? null,
        sizeBytes: json.sizeBytes,
        width: json.width ?? null,
        height: json.height ?? null,
        originalName: file.name,
        favorite: false,
        usedCount: 0,
      });
    }

    setItens((prev) => [...novos, ...prev]);
    setEnviando(false);
    if (inputRef.current) inputRef.current.value = "";
    const partes: string[] = [];
    if (novos.length) partes.push(`${novos.length} enviada(s)`);
    if (duplicadas) partes.push(`${duplicadas} já existia(m)`);
    if (erros.length) partes.push(`${erros.length} com erro`);
    if (partes.length) {
      setMsg({ tone: erros.length ? "warn" : "ok", text: partes.join(", ") + "." });
    }
  }

  function favoritar(id: string) {
    setItens((prev) => prev.map((m) => (m.id === id ? { ...m, favorite: !m.favorite } : m)));
    startTransition(async () => {
      const r = await toggleMediaFavoriteAction(id);
      if (!r.ok) {
        setItens((prev) => prev.map((m) => (m.id === id ? { ...m, favorite: !m.favorite } : m)));
        setMsg({ tone: "danger", text: r.error });
      }
    });
  }

  function apagar(id: string, nome: string) {
    if (!window.confirm(`Apagar "${nome}"? Isso remove o arquivo em definitivo.`)) return;
    startTransition(async () => {
      const r = (await deleteMediaAction(id)) as {
        ok: boolean;
        error?: string;
        inUse?: number;
      };
      if (!r.ok) {
        // Em uso por posts: oferece remover mesmo assim (desvincula dos posts).
        if (r.inUse && r.inUse > 0) {
          if (
            window.confirm(
              `Essa mídia está em ${r.inUse} post(s). Remover mesmo assim? Ela sai desses posts e o arquivo é apagado. (Publicações na fila bloqueiam a remoção.)`,
            )
          ) {
            const f = await deleteMediaAction(id, true);
            if (!f.ok) {
              setMsg({ tone: "danger", text: f.error });
              return;
            }
            setItens((prev) => prev.filter((m) => m.id !== id));
          }
          return;
        }
        setMsg({ tone: "danger", text: r.error ?? "Não foi possível apagar." });
        return;
      }
      setItens((prev) => prev.filter((m) => m.id !== id));
    });
  }

  function removerDuplicatas() {
    startTransition(async () => {
      const r = await removeDuplicateMediaAction();
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error });
        return;
      }
      setMsg({
        tone: "ok",
        text: r.removed > 0 ? `${r.removed} duplicata(s) removida(s).` : "Nenhuma duplicata.",
      });
      router.refresh();
    });
  }

  const totalBytes = itens.reduce((s, m) => s + m.sizeBytes, 0);
  const videos = itens.filter((m) => m.kind === "VIDEO").length;
  const imagens = itens.length - videos;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Biblioteca de mídia"
        hint={`${videos} vídeo(s) · ${imagens} imagem(ns) · ${formatBytes(totalBytes)}`}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              type="button"
              className="px-3 py-1.5 text-xs"
              disabled={pending}
              onClick={removerDuplicatas}
            >
              Remover duplicados
            </Button>
            <Button type="button" className="px-3 py-1.5 text-xs" onClick={() => inputRef.current?.click()}>
              Enviar
            </Button>
          </div>
        }
      />

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void enviar(e.dataTransfer.files);
        }}
        className={[
          "rounded-[var(--r)] border-2 border-dashed p-8 text-center transition-colors",
          arrastando ? "border-accent bg-accent-soft" : "border-border-strong",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,video/mp4,video/quicktime"
          multiple
          onChange={(e) => void enviar(e.target.files)}
          className="hidden"
        />
        <div className="mx-auto mb-2 grid size-11 place-items-center rounded-full bg-surface-2 text-faint ring-1 ring-inset ring-border">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
        </div>
        <p className="text-sm font-medium">
          {enviando ? "Enviando e validando..." : "Arraste arquivos ou clique em Enviar"}
        </p>
        <p className="mt-1 text-xs text-muted">MP4, MOV, JPG, PNG · até 1 GB por arquivo</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["todas", `Todas · ${itens.length}`],
            ["favoritas", `Favoritas · ${itens.filter((m) => m.favorite).length}`],
            ["videos", `Vídeos · ${videos}`],
            ["imagens", `Imagens · ${imagens}`],
          ] as [Filtro, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={[
              "rounded-[var(--r-sm)] border px-3 py-1.5 text-xs font-medium transition-colors",
              filtro === f ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar pelo nome"
          className="max-w-xs flex-1"
        />
      </div>

      {visiveis.length === 0 ? (
        <Empty
          title={itens.length === 0 ? "Biblioteca vazia" : "Nada neste filtro"}
          hint={
            itens.length === 0
              ? "Envie vídeos e imagens para reaproveitar em vários posts."
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visiveis.map((m) => (
            <Card key={m.id} className="group overflow-hidden p-0">
              <div className="relative aspect-square overflow-hidden bg-surface-2">
                {m.kind === "IMAGE" || m.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.kind === "IMAGE" ? m.publicUrl : (m.thumbnailUrl as string)}
                    alt={m.originalName ?? ""}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-faint">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-9">
                      <path d="m22 8-6 4 6 4V8Z" />
                      <rect x="2" y="6" width="14" height="12" rx="2" />
                    </svg>
                  </div>
                )}

                {m.kind === "VIDEO" ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
                      <path d="M8 5v14l11-7L8 5Z" />
                    </svg>
                    {m.durationMs ? formatDuration(m.durationMs) : "vídeo"}
                  </span>
                ) : null}

                {m.usedCount > 0 ? (
                  <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white group-hover:opacity-0">
                    {m.usedCount}×
                  </span>
                ) : null}

                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => favoritar(m.id)}
                    title="Favoritar"
                    className="grid size-7 place-items-center rounded-md bg-black/50 text-white hover:bg-black/70"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill={m.favorite ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className={m.favorite ? "size-4 text-amber-300" : "size-4"}
                    >
                      <path d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7L12 17.3Z" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => apagar(m.id, m.originalName ?? "arquivo")}
                    title="Apagar"
                    className="grid size-7 place-items-center rounded-md bg-black/50 text-white hover:bg-danger"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>

                {m.favorite ? (
                  <span className="absolute left-2 bottom-2 group-hover:opacity-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 text-amber-300 drop-shadow">
                      <path d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7L12 17.3Z" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <div className="px-2.5 py-2">
                <p className="truncate text-xs font-medium">{m.originalName ?? "sem nome"}</p>
                <p className="text-[11px] text-faint">
                  {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                  {formatBytes(m.sizeBytes)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
