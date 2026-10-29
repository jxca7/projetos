import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { meta, activeCredentials } from "@/lib/meta";
import { env as appEnv } from "@/lib/env";
import { redirectUri, scopesFor } from "@/lib/meta/oauth";

export interface ConnectResult {
  created: number;
  updated: number;
  skipped: number;
  usernames: string[];
}

export class NoProAccountError extends Error {
  constructor() {
    super(
      "Nenhuma conta profissional do Instagram encontrada. A conta precisa ser Business ou Creator.",
    );
    this.name = "NoProAccountError";
  }
}

/**
 * Troca o `code` do OAuth pelo token e grava/atualiza as contas do workspace.
 *
 * Extraído do callback para ser reusado pelo "Conectar automático" (o navegador
 * no servidor captura o code e chama isto). Respeita o teto do plano.
 */
export async function finalizeConnection(workspaceId: string, code: string): Promise<ConnectResult> {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  const maxAccounts = subscription?.maxAccounts ?? 2;

  const isMock = appEnv().META_DRIVER === "mock";
  const creds = isMock
    ? {
        metaAppId: null,
        loginFlow: "FACEBOOK_LOGIN" as const,
        appId: "",
        appSecret: "",
        graphVersion: "",
        source: "env" as const,
      }
    : await activeCredentials(workspaceId);
  const driver = meta(isMock ? null : creds);

  const shortLived = await driver.exchangeCodeForToken(code, redirectUri());
  const longLived = await driver.exchangeForLongLivedToken(shortLived);
  const discovered = await driver.listInstagramAccounts(longLived.accessToken);

  if (discovered.length === 0) throw new NoProAccountError();

  const existing = await prisma.socialAccount.count({ where: { workspaceId } });
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const usernames: string[] = [];

  for (const acc of discovered) {
    const already = await prisma.socialAccount.findUnique({
      where: { workspaceId_igUserId: { workspaceId, igUserId: acc.igUserId } },
    });

    if (!already && existing + created >= maxAccounts) {
      skipped += 1;
      continue; // estourou o limite do plano
    }

    await prisma.socialAccount.upsert({
      where: { workspaceId_igUserId: { workspaceId, igUserId: acc.igUserId } },
      update: {
        igUsername: acc.igUsername,
        igAccountType: acc.igAccountType,
        pageId: acc.pageId,
        pageName: acc.pageName,
        profilePicUrl: acc.profilePicUrl,
        followersCount: acc.followersCount,
        accessTokenEnc: encryptSecret(acc.accessToken),
        tokenExpiresAt: longLived.expiresAt,
        scopes: [...scopesFor(creds.loginFlow)],
        status: "ACTIVE",
        statusMessage: null,
        metaAppId: creds.metaAppId,
        lastSyncedAt: new Date(),
      },
      create: {
        workspaceId,
        igUserId: acc.igUserId,
        igUsername: acc.igUsername,
        igAccountType: acc.igAccountType,
        pageId: acc.pageId,
        pageName: acc.pageName,
        profilePicUrl: acc.profilePicUrl,
        followersCount: acc.followersCount,
        accessTokenEnc: encryptSecret(acc.accessToken),
        tokenExpiresAt: longLived.expiresAt,
        scopes: [...scopesFor(creds.loginFlow)],
        status: "ACTIVE",
        metaAppId: creds.metaAppId,
        lastSyncedAt: new Date(),
      },
    });

    usernames.push(acc.igUsername);
    if (already) updated += 1;
    else created += 1;
  }

  return { created, updated, skipped, usernames };
}
