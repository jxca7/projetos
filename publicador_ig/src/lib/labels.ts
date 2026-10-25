import type { PostStatus, TargetStatus, AccountStatus, PostType } from "@/generated/prisma/enums";

type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

export const POST_STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  PENDING_APPROVAL: { label: "Aguardando aprovação", tone: "warn" },
  SCHEDULED: { label: "Agendado", tone: "accent" },
  PUBLISHING: { label: "Publicando", tone: "accent" },
  PARTIALLY_PUBLISHED: { label: "Publicado em parte", tone: "warn" },
  PUBLISHED: { label: "Publicado", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
};

export const TARGET_STATUS: Record<TargetStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Não agendado", tone: "neutral" },
  QUEUED: { label: "Na fila", tone: "accent" },
  CREATING_CONTAINER: { label: "Enviando a mídia", tone: "accent" },
  WAITING_CONTAINER: { label: "Instagram processando", tone: "accent" },
  PUBLISHING: { label: "Publicando", tone: "accent" },
  PUBLISHED: { label: "Publicado", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  SKIPPED: { label: "Ignorado", tone: "warn" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
};

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Ativa", tone: "ok" },
  TOKEN_EXPIRED: { label: "Reconectar", tone: "danger" },
  REVOKED: { label: "Acesso revogado", tone: "danger" },
  DISABLED: { label: "Desativada", tone: "neutral" },
};

export const POST_TYPE: Record<PostType, string> = {
  REEL: "Reel",
  IMAGE: "Feed",
  CAROUSEL: "Carrossel",
  STORY: "Story",
};

/** Traduz o código de erro guardado no target para algo acionavel. */
export const ERROR_HINTS: Record<string, string> = {
  quota_full:
    "A conta chegou ao limite de publicações da Meta nas últimas 24h. A fila retoma sozinha quando a janela virar.",
  auth: "O token da conta expirou ou foi revogado. Reconecte a conta em Contas.",
  account_inactive: "A conta não estava ativa quando o post foi agendado.",
  container_timeout:
    "O Instagram não terminou de processar a mídia. Normalmente é vídeo muito longo ou codec fora do padrão.",
  no_media: "O post ficou sem mídia anexada.",
  error: "O Instagram recusou a mídia no processamento. Confira formato, duração e proporção.",
  expired: "O envio da mídia expirou antes de publicar. A fila recria o envio.",
  max_attempts: "Esgotou as tentativas. Veja o histórico do destino para a causa.",
  token_unreadable: "O token guardado não pode ser lido. Reconecte a conta.",
};

export function formatDateTime(d: Date | null, timezone: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(d);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

export function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
