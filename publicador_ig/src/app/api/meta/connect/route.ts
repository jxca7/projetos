import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireContext, canManageAccounts } from "@/lib/session";
import { authorizeUrl, signState } from "@/lib/meta/oauth";
import { activeCredentials, NoMetaAppError } from "@/lib/meta";
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

  try {
    const creds = await activeCredentials(ctx.workspaceId);
    return NextResponse.redirect(authorizeUrl(state, creds));
  } catch (e) {
    // Sem app cadastrado não há para onde mandar a pessoa: avisa na tela
    // certa em vez de redirecionar para uma URL quebrada da Meta.
    const url = new URL("/apps-meta", env().APP_URL);
    url.searchParams.set(
      "erro",
      e instanceof NoMetaAppError ? e.message : "Não foi possível montar a conexão com a Meta.",
    );
    return NextResponse.redirect(url);
  }
}
