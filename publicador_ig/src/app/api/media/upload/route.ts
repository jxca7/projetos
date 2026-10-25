import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireContext, canEdit } from "@/lib/session";
import { storage, buildKey } from "@/lib/storage";
import { probeMedia } from "@/lib/media/probe";
import { validateMedia, hasBlockingIssue, type ValidationIssue } from "@/lib/media/validate";

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB, o teto da Meta para Reels

const ALLOWED = new Map<string, "IMAGE" | "VIDEO">([
  ["image/jpeg", "IMAGE"],
  ["image/png", "IMAGE"],
  ["video/mp4", "VIDEO"],
  ["video/quicktime", "VIDEO"],
]);

export async function POST(req: NextRequest) {
  const ctx = await requireContext();
  if (!canEdit(ctx.role)) {
    return NextResponse.json({ error: "Sem permissão para enviar mídia." }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const usedForRaw = String(form.get("usedFor") ?? "IMAGE");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  }
  if (!["REEL", "IMAGE", "CAROUSEL", "STORY"].includes(usedForRaw)) {
    return NextResponse.json({ error: "Tipo de post inválido." }, { status: 400 });
  }
  const usedFor = usedForRaw as "REEL" | "IMAGE" | "CAROUSEL" | "STORY";

  const kind = ALLOWED.get(file.type);
  if (!kind) {
    return NextResponse.json(
      { error: `Tipo ${file.type || "desconhecido"} não aceito. Use JPEG, PNG, MP4 ou MOV.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 1 GB." }, { status: 413 });
  }

  const body = Buffer.from(await file.arrayBuffer());

  // ffprobe le de arquivo, não de buffer: grava num temporario para inspecionar
  // antes de aceitar a mídia no storage definitivo.
  const tmp = path.join(os.tmpdir(), `up-${crypto.randomBytes(8).toString("hex")}${path.extname(file.name)}`);
  let issues: ValidationIssue[] = [];
  let probe;
  try {
    await fs.writeFile(tmp, body);
    probe = await probeMedia(tmp);
    issues = validateMedia({ kind, mimeType: file.type, sizeBytes: body.byteLength, probe, usedFor });
  } finally {
    await fs.rm(tmp, { force: true });
  }

  if (hasBlockingIssue(issues)) {
    return NextResponse.json(
      { error: "Mídia reprovada nas regras do Instagram.", issues },
      { status: 422 },
    );
  }

  const stored = await storage().put(
    buildKey(ctx.workspaceId, file.name || "mídia"),
    body,
    file.type,
  );

  const asset = await prisma.mediaAsset.create({
    data: {
      workspaceId: ctx.workspaceId,
      kind,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType: file.type,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      durationMs: probe?.durationMs ?? null,
      originalName: file.name || null,
    },
  });

  return NextResponse.json({
    id: asset.id,
    kind: asset.kind,
    publicUrl: asset.publicUrl,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    sizeBytes: asset.sizeBytes,
    // Avisos não bloqueiam, mas a pessoa precisa saber (corte, codec, etc).
    warnings: issues.filter((i) => i.level === "warning"),
  });
}
