"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { createAndSchedulePost } from "@/app/actions";
import { Badge, Button, Card, Field, Notice, SectionTitle } from "@/components/ui";
import { CAPTION_MAX_LENGTH, HASHTAG_MAX_COUNT } from "@/lib/media/validate";
import { formatBytes, formatDuration } from "@/lib/labels";

type PostType = "REEL" | "IMAGE" | "CAROUSEL" | "STORY";

export interface AccountOption {
  id: string;
  igUsername: string;
  followersCount: number | null;
  quotaUsage: number | null;
  quotaTotal: number | null;
  folderId: string | null;
}

export interface FolderOption {
  id: string;
  name: string;
  count: number;
}

interface UploadedMedia {
  id: string;
  kind: "IMAGE" | "VIDEO";
  publicUrl: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  warnings: { message: string }[];
  name: string;
}

const TYPES: { value: PostType; label: string; hint: string }[] = [
  { value: "REEL", label: "Reel", hint: "Vídeo 9:16, de 3s a 15min" },
  { value: "IMAGE", label: "Feed", hint: "Uma imagem, de 4:5 a 1.91:1" },
  { value: "CAROUSEL", label: "Carrossel", hint: "De 2 a 10 itens" },
  { value: "STORY", label: "Story", hint: "Imagem ou vídeo de até 60s" },
];

const ACCEPT: Record<PostType, string> = {
  REEL: "video/mp4,video/quicktime",
  IMAGE: "image/jpeg,image/png",
  CAROUSEL: "image/jpeg,image/png,video/mp4,video/quicktime",
  STORY: "image/jpeg,image/png,video/mp4,video/quicktime",
};

function localDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function Composer({
  accounts,
  folders,
  minSecondsBetweenPublishes,
}: {
  accounts: AccountOption[];
  folders: FolderOption[];
  minSecondsBetweenPublishes: number;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<PostType>("REEL");
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [caption, setCaption] = useState("");
  const [storyLink, setStoryLink] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [buscaConta, setBuscaConta] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [openOverride, setOpenOverride] = useState<string | null>(null);
  const [publishNow, setPublishNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState(() =>
    localDatetimeValue(new Date(Date.now() + 30 * 60 * 1000)),
  );
  const [stagger, setStagger] = useState(90);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const hashtagCount = useMemo(
    () => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    [caption],
  );

  const maxMedia = type === "CAROUSEL" ? 10 : 1;

  const contasVisiveis = useMemo(() => {
    const termo = buscaConta.trim().toLowerCase();
    if (!termo) return accounts;
    return accounts.filter((a) => a.igUsername.toLowerCase().includes(termo));
  }, [accounts, buscaConta]);

  /** Marca ou desmarca a pasta inteira de uma vez. */
  function toggleFolder(folderId: string | null) {
    const ids = accounts.filter((a) => a.folderId === folderId).map((a) => a.id);
    if (ids.length === 0) return;
    const todasMarcadas = ids.every((id) => selected.includes(id));
    setSelected((prev) =>
      todasMarcadas
        ? prev.filter((id) => !ids.includes(id))
        : [...new Set([...prev, ...ids])],
    );
  }

  const semPastaCount = accounts.filter((a) => !a.folderId).length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErrors([]);
    setUploading(true);

    const accepted: UploadedMedia[] = [];
    const problems: string[] = [];

    for (const file of Array.from(files).slice(0, maxMedia - media.length)) {
      const form = new FormData();
      form.set("file", file);
      form.set("usedFor", type);

      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) {
        const detail = Array.isArray(json.issues)
          ? json.issues.map((i: { message: string }) => i.message).join(" ")
          : "";
        problems.push(`${file.name}: ${json.error ?? "falha no envio"} ${detail}`.trim());
        continue;
      }
      accepted.push({ ...json, name: file.name });
    }

    setMedia((prev) => [...prev, ...accepted]);
    setErrors(problems);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function toggleAccount(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    setErrors([]);
    setWarnings([]);

    startTransition(async () => {
      const result = await createAndSchedulePost({
        type,
        caption,
        storyLink: type === "STORY" ? storyLink : "",
        publishNow,
        scheduledAt: publishNow ? undefined : new Date(scheduledAt).toISOString(),
        staggerSeconds: stagger,
        shareToFeed,
        requiresApproval,
        mediaIds: media.map((m) => m.id),
        accountIds: selected,
        captionOverrides: overrides,
      });

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      if (result.pendingApproval) {
        router.push("/fila");
        return;
      }
      router.push(`/posts/${result.postId}`);
    });
  }

  const totalSeconds = selected.length > 1 ? (selected.length - 1) * stagger : 0;
  const ready = media.length > 0 && selected.length > 0 && !uploading && !pending;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card>
          <SectionTitle title="Tipo de publicação" />
          <div className="grid gap-2 sm:grid-cols-4">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setType(t.value);
                  setMedia([]);
                }}
                className={[
                  "rounded-lg border px-3 py-2.5 text-left transition",
                  type === t.value
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:bg-surface-2",
                ].join(" ")}
              >
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{t.hint}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Mídia"
            hint={
              type === "CAROUSEL"
                ? "De 2 a 10 itens, na ordem em que vao aparecer."
                : "A validação roda antes de ir para o Instagram, para não gastar cota da conta."
            }
          />

          {media.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {media.map((m, i) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-xs tabular-nums text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="text-xs text-muted">
                    {m.width}×{m.height}
                    {m.durationMs ? ` · ${formatDuration(m.durationMs)}` : ""} ·{" "}
                    {formatBytes(m.sizeBytes)}
                  </span>
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-2 py-1 text-xs"
                    onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                  >
                    remover
                  </Button>
                  {m.warnings?.length > 0 ? (
                    <p className="w-full text-xs text-warn">
                      {m.warnings.map((w) => w.message).join(" ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {media.length < maxMedia ? (
            <div>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT[type]}
                multiple={type === "CAROUSEL"}
                onChange={(e) => void handleFiles(e.target.files)}
                className="block w-full cursor-pointer rounded-lg border border-dashed border-border bg-surface px-3 py-6 text-sm text-muted"
              />
              {uploading ? (
                <p className="mt-2 text-sm text-muted">Enviando e validando a mídia...</p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Legenda" />
          {type === "STORY" ? (
            <Notice tone="warn" title="Story não aceita legenda nem link pela API">
              A Meta ignora legenda, link sticker, enquete e menção em Stories publicados por API.
              Informe o link abaixo e a plataforma cria uma pendência para você adicionar no app.
            </Notice>
          ) : (
            <>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Escreva a legenda. Hashtags contam para o limite de 30."
              />
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
                <span className={caption.length > CAPTION_MAX_LENGTH ? "text-danger" : "text-muted"}>
                  {caption.length}/{CAPTION_MAX_LENGTH} caracteres
                </span>
                <span className={hashtagCount > HASHTAG_MAX_COUNT ? "text-danger" : "text-muted"}>
                  {hashtagCount}/{HASHTAG_MAX_COUNT} hashtags
                </span>
              </div>
            </>
          )}

          {type === "STORY" ? (
            <div className="mt-4">
              <Field
                label="Link do Story (opcional)"
                hint="Vira uma pendência com o link pronto para colar, porque a API não insere o sticker."
              >
                <input
                  type="url"
                  value={storyLink}
                  onChange={(e) => setStoryLink(e.target.value)}
                  placeholder="https://..."
                />
              </Field>
            </div>
          ) : null}

          {type === "REEL" ? (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shareToFeed}
                onChange={(e) => setShareToFeed(e.target.checked)}
                className="size-4"
              />
              Mostrar também no feed do perfil
            </label>
          ) : null}
        </Card>

        <Card>
          <SectionTitle
            title="Contas de destino"
            hint="Legenda própria por conta evita publicar texto idêntico em vários perfis, o que o Instagram penaliza."
          />
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">
              Nenhuma conta ativa. Conecte uma conta antes de publicar.
            </p>
          ) : (
            <>
              {folders.length > 0 || semPastaCount > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {folders.map((f) => {
                    const ids = accounts.filter((a) => a.folderId === f.id).map((a) => a.id);
                    const marcadas = ids.filter((id) => selected.includes(id)).length;
                    const todas = ids.length > 0 && marcadas === ids.length;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleFolder(f.id)}
                        disabled={ids.length === 0}
                        className={[
                          "rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40",
                          todas
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-border hover:bg-surface-2",
                        ].join(" ")}
                      >
                        {f.name} · {marcadas}/{ids.length}
                      </button>
                    );
                  })}
                  {semPastaCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggleFolder(null)}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-2"
                    >
                      Sem pasta · {semPastaCount}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={buscaConta}
                  onChange={(e) => setBuscaConta(e.target.value)}
                  placeholder="Buscar conta pelo @"
                  className="max-w-xs flex-1"
                />
                <Button
                  variant="secondary"
                  type="button"
                  className="px-2.5 py-1.5 text-xs"
                  onClick={() => {
                    const ids = contasVisiveis.map((a) => a.id);
                    const todas = ids.every((id) => selected.includes(id));
                    setSelected((prev) =>
                      todas
                        ? prev.filter((id) => !ids.includes(id))
                        : [...new Set([...prev, ...ids])],
                    );
                  }}
                >
                  {contasVisiveis.every((a) => selected.includes(a.id)) && contasVisiveis.length > 0
                    ? "Desmarcar visíveis"
                    : `Marcar visíveis (${contasVisiveis.length})`}
                </Button>
                {selected.length > 0 ? (
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-2 py-1.5 text-xs"
                    onClick={() => setSelected([])}
                  >
                    limpar ({selected.length})
                  </Button>
                ) : null}
              </div>

              <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {contasVisiveis.map((a) => {
                  const isSelected = selected.includes(a.id);
                  const used = a.quotaUsage ?? 0;
                  const total = a.quotaTotal ?? 0;
                  const nearLimit = total > 0 && used / total >= 0.9;
                  return (
                    <li key={a.id} className="rounded-lg border border-border">
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAccount(a.id)}
                            className="size-4 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              @{a.igUsername}
                            </span>
                            {total > 0 ? (
                              <span
                                className={nearLimit ? "text-xs text-danger" : "text-xs text-muted"}
                              >
                                cota {used}/{total} nas últimas 24h
                              </span>
                            ) : null}
                          </span>
                        </label>
                        {isSelected && type !== "STORY" ? (
                          <Button
                            variant="ghost"
                            type="button"
                            className="px-2 py-1 text-xs"
                            onClick={() => setOpenOverride(openOverride === a.id ? null : a.id)}
                          >
                            {overrides[a.id] ? "legenda própria ✓" : "legenda própria"}
                          </Button>
                        ) : null}
                      </div>
                      {openOverride === a.id ? (
                        <div className="border-t border-border px-3 py-3">
                          <textarea
                            value={overrides[a.id] ?? ""}
                            onChange={(e) =>
                              setOverrides((prev) => ({ ...prev, [a.id]: e.target.value }))
                            }
                            placeholder={`Legenda específica para @${a.igUsername}. Vazio usa a legenda principal.`}
                            className="min-h-24"
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {contasVisiveis.length === 0 ? (
                  <li className="py-6 text-center text-sm text-muted">
                    Nenhuma conta encontrada para &ldquo;{buscaConta}&rdquo;.
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <SectionTitle title="Quando publicar" />
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={publishNow}
                onChange={() => setPublishNow(true)}
                className="size-4"
              />
              Agora
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={!publishNow}
                onChange={() => setPublishNow(false)}
                className="size-4"
              />
              Agendar
            </label>
            {!publishNow ? (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            ) : null}

            <Field
              label="Intervalo entre contas"
              hint={`${stagger}s entre uma conta e a seguinte. Publicar em várias contas no mesmo instante é o padrão que o Instagram trata como automação coordenada.`}
            >
              <input
                type="number"
                min={5}
                max={3600}
                value={stagger}
                onChange={(e) => setStagger(Number(e.target.value))}
              />
            </Field>

            {selected.length > 1 ? (
              <p className="text-xs text-muted">
                {selected.length} contas levam cerca de{" "}
                {totalSeconds >= 60
                  ? `${Math.round(totalSeconds / 60)} min`
                  : `${totalSeconds}s`}{" "}
                para completar.
              </p>
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Exigir aprovação antes de publicar
                <span className="block text-xs text-muted">
                  Útil quando quem escreve não é quem aprova.
                </span>
              </span>
            </label>
          </div>
        </Card>

        {errors.length > 0 ? (
          <Notice tone="danger" title="Corrija antes de publicar">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {warnings.length > 0 ? (
          <Notice tone="warn" title="Avisos">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge>{media.length} mídia</Badge>
            <Badge>{selected.length} conta(s)</Badge>
            {minSecondsBetweenPublishes > 0 ? (
              <Badge>
                piso de {minSecondsBetweenPublishes >= 60
                  ? `${Math.round(minSecondsBetweenPublishes / 60)}min`
                  : `${minSecondsBetweenPublishes}s`}{" "}
                por conta
              </Badge>
            ) : null}
          </div>
          <Button type="button" disabled={!ready} onClick={submit} className="w-full">
            {pending
              ? "Enfileirando..."
              : requiresApproval
                ? "Enviar para aprovação"
                : publishNow
                  ? "Publicar agora"
                  : "Agendar"}
          </Button>
          <p className="mt-2 text-xs text-muted">
            A publicação é feita pela API oficial da Meta, nas contas em que você tem permissão de
            Página.
          </p>
        </Card>
      </div>
    </div>
  );
}
