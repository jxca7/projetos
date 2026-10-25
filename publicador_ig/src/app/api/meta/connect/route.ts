import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireContext, canManageAccounts } from "@/lib/session";
import { authorizeUrl, signState } from "@/lib/meta/oauth";
import { env } from "@/lib/env";

/**
 * Inicia a conexão de contas: manda a pessoa para o dialogo da Meta.
 *
 * No driver mock não existe dialogo; voltamos direto para o callback para o
 * fluxo poder ser testado de ponta a ponta sem app aprovado.
 */
export async function GET() {
  const ctx = await requireContext();
  if (!canManageAccounts(ctx.role)) {
    return NextResponse.json({ error: "Sem permissão para conectar contas." }, { status: 403 });
  }

  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = signState(`${ctx.workspaceId}:${nonce}`);

  if (env().META_DRIVER === "mock") {
    const url = new URL("/api/meta/callback", env().APP_URL);
    url.searchParams.set("code", "mock-code");
    url.searchParams.set("state", state);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(authorizeUrl(state));
}
