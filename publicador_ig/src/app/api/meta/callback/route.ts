import { NextResponse, type NextRequest } from "next/server";
import { MetaApiError, NoMetaAppError } from "@/lib/meta";
import { verifyState } from "@/lib/meta/oauth";
import { finalizeConnection, NoProAccountError } from "@/lib/meta/connect";
import { requireContext, canManageAccounts } from "@/lib/session";
import { env } from "@/lib/env";

function back(message: string, kind: "ok" | "erro" = "ok") {
  const url = new URL("/contas", env().APP_URL);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) {
    return back("Sem permissão para conectar contas.", "erro");
  }

  const params = req.nextUrl.searchParams;

  // A pessoa pode ter recusado no dialogo da Meta.
  const denied = params.get("error");
  if (denied) {
    return back(params.get("error_description") ?? `Autorização recusada (${denied}).`, "erro");
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("Resposta do OAuth incompleta.", "erro");

  const payload = verifyState(state);
  if (!payload) return back("State do OAuth inválido. Tente conectar novamente.", "erro");

  const [workspaceId] = payload.split(":");
  if (workspaceId !== ctx.workspaceId) {
    return back("State do OAuth pertence a outro workspace.", "erro");
  }

  try {
    const { created, updated, skipped } = await finalizeConnection(ctx.workspaceId, code);
    const parts = [`${created} conta(s) conectada(s)`];
    if (updated > 0) parts.push(`${updated} atualizada(s)`);
    if (skipped > 0) parts.push(`${skipped} ignorada(s) pelo limite do plano`);
    return back(parts.join(", ") + ".");
  } catch (e) {
    if (e instanceof NoProAccountError) return back(e.message, "erro");
    if (e instanceof NoMetaAppError) return back(e.message, "erro");
    const message =
      e instanceof MetaApiError
        ? `Meta recusou a conexão: ${e.message}${e.code ? ` (code ${e.code})` : ""}`
        : e instanceof Error
          ? e.message
          : "Falha desconhecida ao conectar.";
    return back(message, "erro");
  }
}
