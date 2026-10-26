import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { MediaAsset } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { storage, buildKey } from "@/lib/storage";
import { probeMedia } from "./probe";
import { validateMedia, hasBlockingIssue, type ValidationIssue } from "./validate";
import { extractPoster } from "./thumbnail";

/** 1 GB, o teto da Meta para Reels. */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Mime aceito -> tipo interno. É a mesma lista usada no upload manual. */
export const ALLOWED = new Map<string, "IMAGE" | "VIDEO">([
  ["image/jpeg", "IMAGE"],
  ["image/png", "IMAGE"],
  ["video/mp4", "VIDEO"],
  ["video/quicktime", "VIDEO"],
]);

export type UsedFor = "REEL" | "IMAGE" | "CAROUSEL" | "STORY" | "LIBRARY";

export interface IngestInput {
  workspaceId: string;
  body: Buffer;
  originalName: string;
  mimeType: string;
  usedFor: UsedFor;
}

export interface IngestResult {
  asset: MediaAsset;
  /** Arquivo idêntico já existia na biblioteca: devolvemos o existente. */
  duplicate: boolean;
  /** Avisos que não bloqueiam (corte, codec, etc). */
  warnings: ValidationIssue[];
}

/** Formato não suportado (mime fora da lista). */
export class UnsupportedMediaError extends Error {
  constructor(mimeType: string) {
    super(`Tipo ${mimeType || "desconhecido"} não aceito. Use JPEG, PNG, MP4 ou MOV.`);
    this.name = "UnsupportedMediaError";
  }
}

/** Arquivo grande demais. */
export class MediaTooLargeError extends Error {
  constructor() {
    super("Arquivo acima de 1 GB.");
    this.name = "MediaTooLargeError";
  }
}

/** Mídia reprovada nas regras do Instagram. */
export class MediaRejectedError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("Mídia reprovada nas regras do Instagram.");
    this.name = "MediaRejectedError";
    this.issues = issues;
  }
}

/**
 * Ponto único de entrada de mídia na biblioteca: dedup por checksum, inspeção
 * com ffprobe, validação pelas regras do Instagram, extração de capa e gravação
 * no storage. Usado tanto pelo upload manual quanto pela importação de Reels.
 */
export async function ingestMedia(input: IngestInput): Promise<IngestResult> {
  const { workspaceId, body, originalName, mimeType, usedFor } = input;

  const kind = ALLOWED.get(mimeType);
  if (!kind) throw new UnsupportedMediaError(mimeType);
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new MediaTooLargeError();

  const checksum = crypto.createHash("sha256").update(body).digest("hex");

  // Dedup: arquivo idêntico já na biblioteca deste workspace volta o existente,
  // em vez de guardar de novo. É o que evita duplicata na origem.
  const existente = await prisma.mediaAsset.findFirst({
    where: { workspaceId, checksum },
  });
  if (existente) {
    return { asset: existente, duplicate: true, warnings: [] };
  }

  // ffprobe lê de arquivo, não de buffer: grava num temporário para inspecionar.
  const tmp = path.join(
    os.tmpdir(),
    `up-${crypto.randomBytes(8).toString("hex")}${path.extname(originalName)}`,
  );
  let issues: ValidationIssue[] = [];
  let probe;
  let posterBuf: Buffer | null = null;
  try {
    await fs.writeFile(tmp, body);
    probe = await probeMedia(tmp);
    issues = validateMedia({ kind, mimeType, sizeBytes: body.byteLength, probe, usedFor });
    if (!hasBlockingIssue(issues) && kind === "VIDEO") {
      posterBuf = await extractPoster(tmp);
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }

  if (hasBlockingIssue(issues)) {
    throw new MediaRejectedError(issues);
  }

  const stored = await storage().put(buildKey(workspaceId, originalName || "mídia"), body, mimeType);

  // Guarda a capa do vídeo, quando foi possível extrair.
  let thumbnailKey: string | null = null;
  let thumbnailUrl: string | null = null;
  if (posterBuf) {
    const poster = await storage().put(
      buildKey(workspaceId, "poster.jpg"),
      posterBuf,
      "image/jpeg",
    );
    thumbnailKey = poster.storageKey;
    thumbnailUrl = poster.publicUrl;
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      workspaceId,
      kind,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      durationMs: probe?.durationMs ?? null,
      originalName: originalName || null,
      thumbnailKey,
      thumbnailUrl,
    },
  });

  return { asset, duplicate: false, warnings: issues.filter((i) => i.level === "warning") };
}
