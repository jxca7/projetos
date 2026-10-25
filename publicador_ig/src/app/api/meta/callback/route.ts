import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { meta, MetaApiError } from "@/lib/meta";
import { redirectUri, verifyState, REQUIRED_SCOPES } from "@/lib/meta/oauth";
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

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId: ctx.workspaceId },
  });
  const maxAccounts = subscription?.maxAccounts ?? 2;

  try {
    const driver = meta();
    const shortLived = await driver.exchangeCodeForToken(code, redirectUri());
    const longLived = await driver.exchangeForLongLivedToken(shortLived);
    const discovered = await driver.listInstagramAccounts(longLived.accessToken);

    if (discovered.length === 0) {
      return back(
        "Nenhuma conta profissional do Instagram encontrada. A conta precisa ser Business " +
          "ou Creator e estar vinculada a uma Página do Facebook.",
        "erro",
      );
    }

    const existing = await prisma.socialAccount.count({ where: { workspaceId: ctx.workspaceId } });
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const acc of discovered) {
      const already = await prisma.socialAccount.findUnique({
        where: { workspaceId_igUserId: { workspaceId: ctx.workspaceId, igUserId: acc.igUserId } },
      });

      if (!already && existing + created >= maxAccounts) {
        skipped += 1;
        continue; // estourou o limite do plano
      }

      await prisma.socialAccount.upsert({
        where: { workspaceId_igUserId: { workspaceId: ctx.workspaceId, igUserId: acc.igUserId } },
        update: {
          igUsername: acc.igUsername,
          igAccountType: acc.igAccountType,
          pageId: acc.pageId,
          pageName: acc.pageName,
          profilePicUrl: acc.profilePicUrl,
          followersCount: acc.followersCount,
          accessTokenEnc: encryptSecret(acc.accessToken),
          tokenExpiresAt: longLived.expiresAt,
          scopes: [...REQUIRED_SCOPES],
          status: "ACTIVE",
          statusMessage: null,
          lastSyncedAt: new Date(),
        },
        create: {
          workspaceId: ctx.workspaceId,
          igUserId: acc.igUserId,
          igUsername: acc.igUsername,
          igAccountType: acc.igAccountType,
          pageId: acc.pageId,
          pageName: acc.pageName,
          profilePicUrl: acc.profilePicUrl,
          followersCount: acc.followersCount,
          accessTokenEnc: encryptSecret(acc.accessToken),
          tokenExpiresAt: longLived.expiresAt,
          scopes: [...REQUIRED_SCOPES],
          status: "ACTIVE",
          lastSyncedAt: new Date(),
        },
      });

      if (already) updated += 1;
      else created += 1;
    }

    const parts = [`${created} conta(s) conectada(s)`];
    if (updated > 0) parts.push(`${updated} atualizada(s)`);
    if (skipped > 0) parts.push(`${skipped} ignorada(s) pelo limite do plano (${maxAccounts})`);
    return back(parts.join(", ") + ".");
  } catch (e) {
    const message =
      e instanceof MetaApiError
        ? `Meta recusou a conexão: ${e.message}${e.code ? ` (code ${e.code})` : ""}`
        : e instanceof Error
          ? e.message
          : "Falha desconhecida ao conectar.";
    return back(message, "erro");
  }
}
