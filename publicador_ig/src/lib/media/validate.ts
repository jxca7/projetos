import type { ProbeResult } from "./probe";

/**
 * Especificações de mídia do Instagram para publicação via API.
 *
 * Validar aqui tem dois ganhos: a pessoa recebe o erro na hora do upload, em
 * portugues, em vez de um código 2207057 vinte minutos depois; e não gastamos
 * uma das ~50 publicações diarias da conta numa mídia que ia ser recusada.
 *
 * Numeros conferidos com a documentacao da Meta; são os limites praticos, não
 * os recomendados (recomendado para Reels é 1080x1920, 9:16).
 */
export const SPECS = {
  image: {
    mimeTypes: ["image/jpeg", "image/png"],
    maxBytes: 8 * 1024 * 1024,
    minAspect: 4 / 5, // 0.8 (retrato mais alto permitido no feed)
    maxAspect: 1.91, // paisagem mais larga permitida no feed
  },
  reel: {
    mimeTypes: ["video/mp4", "video/quicktime"],
    maxBytes: 1024 * 1024 * 1024,
    minDurationMs: 3_000,
    maxDurationMs: 15 * 60 * 1000,
    minAspect: 0.01,
    maxAspect: 10,
    recommendedAspect: 9 / 16,
    videoCodecs: ["h264", "hevc", "h265"],
    audioCodecs: ["aac"],
  },
  story: {
    imageMimeTypes: ["image/jpeg", "image/png"],
    videoMimeTypes: ["video/mp4", "video/quicktime"],
    maxImageBytes: 8 * 1024 * 1024,
    maxVideoBytes: 100 * 1024 * 1024,
    maxDurationMs: 60_000,
  },
} as const;

export interface ValidationIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

export interface ValidationInput {
  kind: "IMAGE" | "VIDEO";
  mimeType: string;
  sizeBytes: number;
  probe: ProbeResult;
  usedFor: "REEL" | "IMAGE" | "CAROUSEL" | "STORY" | "LIBRARY";
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function validateMedia(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { kind, mimeType, sizeBytes, probe, usedFor } = input;

  // Modo biblioteca: a mídia fica salva para uso futuro em qualquer tipo de
  // post, então só o que inviabiliza qualquer uso bloqueia (formato e tamanho);
  // proporção e duração viram aviso, conferidas de novo ao montar o post.
  if (usedFor === "LIBRARY") {
    const aceitos =
      kind === "IMAGE"
        ? ["image/jpeg", "image/png"]
        : ["video/mp4", "video/quicktime"];
    if (!aceitos.includes(mimeType)) {
      issues.push({
        level: "error",
        field: "mimeType",
        message: `Formato ${mimeType || "desconhecido"} não aceito. Use JPEG, PNG, MP4 ou MOV.`,
      });
    }
    const maxBytes = kind === "IMAGE" ? SPECS.image.maxBytes : SPECS.reel.maxBytes;
    if (sizeBytes > maxBytes) {
      issues.push({
        level: "error",
        field: "sizeBytes",
        message: `Arquivo de ${mb(sizeBytes)} excede o limite de ${mb(maxBytes)}.`,
      });
    }
    return issues;
  }

  const aspect =
    probe.width && probe.height && probe.height > 0 ? probe.width / probe.height : null;

  if (usedFor === "REEL") {
    if (kind !== "VIDEO") {
      issues.push({ level: "error", field: "kind", message: "Reel exige um arquivo de vídeo." });
      return issues;
    }
    const s = SPECS.reel;
    if (!(s.mimeTypes as readonly string[]).includes(mimeType)) {
      issues.push({
        level: "error",
        field: "mimeType",
        message: `Formato ${mimeType} não aceito em Reels. Use MP4 (H.264 + AAC) ou MOV.`,
      });
    }
    if (sizeBytes > s.maxBytes) {
      issues.push({
        level: "error",
        field: "sizeBytes",
        message: `Vídeo de ${mb(sizeBytes)} excede o limite de ${mb(s.maxBytes)}.`,
      });
    }
    if (probe.durationMs !== null) {
      if (probe.durationMs < s.minDurationMs) {
        issues.push({
          level: "error",
          field: "duration",
          message: `Reel precisa ter ao menos 3 segundos (este tem ${(probe.durationMs / 1000).toFixed(1)}s).`,
        });
      }
      if (probe.durationMs > s.maxDurationMs) {
        issues.push({
          level: "error",
          field: "duration",
          message: `Reel pode ter no máximo 15 minutos (este tem ${Math.round(probe.durationMs / 60000)} min).`,
        });
      }
    }
    if (aspect !== null && (aspect < s.minAspect || aspect > s.maxAspect)) {
      issues.push({
        level: "error",
        field: "aspect",
        message: `Proporção ${aspect.toFixed(2)}:1 fora do permitido para Reels.`,
      });
    }
    if (aspect !== null && Math.abs(aspect - s.recommendedAspect) > 0.08) {
      issues.push({
        level: "warning",
        field: "aspect",
        message: `Proporção ${aspect.toFixed(2)}:1 não é 9:16 — o Instagram vai cortar ou adicionar barras.`,
      });
    }
    if (probe.videoCodec && !(s.videoCodecs as readonly string[]).includes(probe.videoCodec.toLowerCase())) {
      issues.push({
        level: "warning",
        field: "videoCodec",
        message: `Codec de vídeo ${probe.videoCodec} pode ser recusado. O aceito com segurança é H.264.`,
      });
    }
    if (!probe.hasAudio) {
      issues.push({
        level: "warning",
        field: "áudio",
        message: "Vídeo sem faixa de áudio. Reels sem áudio tem entrega pior e podem falhar no processamento.",
      });
    } else if (probe.audioCodec && !(s.audioCodecs as readonly string[]).includes(probe.audioCodec.toLowerCase())) {
      issues.push({
        level: "warning",
        field: "audioCodec",
        message: `Codec de áudio ${probe.audioCodec} pode ser recusado. Use AAC.`,
      });
    }
    return issues;
  }

  if (usedFor === "IMAGE" || usedFor === "CAROUSEL") {
    if (kind !== "IMAGE" && usedFor === "IMAGE") {
      issues.push({ level: "error", field: "kind", message: "Post de feed simples exige imagem." });
      return issues;
    }
    if (kind === "IMAGE") {
      const s = SPECS.image;
      if (!(s.mimeTypes as readonly string[]).includes(mimeType)) {
        issues.push({
          level: "error",
          field: "mimeType",
          message: `Formato ${mimeType} não aceito. Use JPEG ou PNG.`,
        });
      }
      if (sizeBytes > s.maxBytes) {
        issues.push({
          level: "error",
          field: "sizeBytes",
          message: `Imagem de ${mb(sizeBytes)} excede o limite de ${mb(s.maxBytes)}.`,
        });
      }
      if (aspect !== null && (aspect < s.minAspect || aspect > s.maxAspect)) {
        issues.push({
          level: "error",
          field: "aspect",
          message: `Proporção ${aspect.toFixed(2)}:1 fora do permitido (de 4:5 a 1.91:1).`,
        });
      }
    }
    return issues;
  }

  // STORY
  const s = SPECS.story;
  if (kind === "IMAGE") {
    if (!(s.imageMimeTypes as readonly string[]).includes(mimeType)) {
      issues.push({ level: "error", field: "mimeType", message: `Formato ${mimeType} não aceito em Stories.` });
    }
    if (sizeBytes > s.maxImageBytes) {
      issues.push({
        level: "error",
        field: "sizeBytes",
        message: `Imagem de ${mb(sizeBytes)} excede o limite de ${mb(s.maxImageBytes)} para Stories.`,
      });
    }
  } else {
    if (!(s.videoMimeTypes as readonly string[]).includes(mimeType)) {
      issues.push({ level: "error", field: "mimeType", message: `Formato ${mimeType} não aceito em Stories.` });
    }
    if (sizeBytes > s.maxVideoBytes) {
      issues.push({
        level: "error",
        field: "sizeBytes",
        message: `Vídeo de ${mb(sizeBytes)} excede o limite de ${mb(s.maxVideoBytes)} para Stories.`,
      });
    }
    if (probe.durationMs !== null && probe.durationMs > s.maxDurationMs) {
      issues.push({
        level: "error",
        field: "duration",
        message: `Story aceita no máximo 60 segundos (este tem ${(probe.durationMs / 1000).toFixed(0)}s).`,
      });
    }
  }
  if (aspect !== null && Math.abs(aspect - 9 / 16) > 0.1) {
    issues.push({
      level: "warning",
      field: "aspect",
      message: `Story fora de 9:16 (${aspect.toFixed(2)}:1) será cortado.`,
    });
  }
  return issues;
}

export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** Limite de caracteres da legenda, imposto pelo Instagram. */
export const CAPTION_MAX_LENGTH = 2_200;
/** Limite de hashtags por post. */
export const HASHTAG_MAX_COUNT = 30;

export function validateCaption(caption: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (caption.length > CAPTION_MAX_LENGTH) {
    issues.push({
      level: "error",
      field: "caption",
      message: `Legenda com ${caption.length} caracteres excede o limite de ${CAPTION_MAX_LENGTH}.`,
    });
  }
  const hashtags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > HASHTAG_MAX_COUNT) {
    issues.push({
      level: "error",
      field: "caption",
      message: `${hashtags.length} hashtags excede o limite de ${HASHTAG_MAX_COUNT}.`,
    });
  }
  const mentions = caption.match(/@[A-Za-z0-9_.]+/g) ?? [];
  if (mentions.length > 20) {
    issues.push({
      level: "warning",
      field: "caption",
      message: `${mentions.length} menções na legenda. Acima de 20 o Instagram costuma tratar como spam.`,
    });
  }
  return issues;
}
