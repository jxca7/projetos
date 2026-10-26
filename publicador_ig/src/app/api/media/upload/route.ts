import { NextResponse, type NextRequest } from "next/server";
import { requireContext, canEdit } from "@/lib/session";
import {
  ingestMedia,
  MediaRejectedError,
  MediaTooLargeError,
  UnsupportedMediaError,
  type UsedFor,
} from "@/lib/media/ingest";

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
  if (!["REEL", "IMAGE", "CAROUSEL", "STORY", "LIBRARY"].includes(usedForRaw)) {
    return NextResponse.json({ error: "Tipo de post inválido." }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());

  try {
    const { asset, duplicate, warnings } = await ingestMedia({
      workspaceId: ctx.workspaceId,
      body,
      originalName: file.name,
      mimeType: file.type,
      usedFor: usedForRaw as UsedFor,
    });
    return NextResponse.json({
      id: asset.id,
      kind: asset.kind,
      publicUrl: asset.publicUrl,
      thumbnailUrl: asset.thumbnailUrl,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      sizeBytes: asset.sizeBytes,
      duplicate,
      warnings,
    });
  } catch (e) {
    if (e instanceof UnsupportedMediaError) {
      return NextResponse.json({ error: e.message }, { status: 415 });
    }
    if (e instanceof MediaTooLargeError) {
      return NextResponse.json({ error: e.message }, { status: 413 });
    }
    if (e instanceof MediaRejectedError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    throw e;
  }
}
