import { prisma } from "../prisma";
import { decryptSecret } from "../crypto";
import { parseSignedRequest } from "./oauth";

export interface SignedRequestResult {
  /** Id do usuário na Meta, que para o fluxo do Instagram é o IG User ID. */
  userId: string;
  metaAppId: string;
  payload: Record<string, unknown>;
}

/**
 * Descobre qual app assinou o `signed_request`.
 *
 * O callback é um endereço só para todos os apps, e a requisição não diz qual
 * app a enviou. Testamos a assinatura contra cada app cadastrado: só o secret
 * certo valida, então isso identifica o app sem confiar em nada do corpo.
 */
export async function resolveSignedRequest(
  signedRequest: string,
): Promise<SignedRequestResult | null> {
  const apps = await prisma.metaApp.findMany({
    select: { id: true, appSecretEnc: true },
  });

  for (const app of apps) {
    let secret: string;
    try {
      secret = decryptSecret(app.appSecretEnc);
    } catch {
      continue;
    }
    const payload = parseSignedRequest(signedRequest, secret);
    if (!payload) continue;

    const userId = payload.user_id;
    if (typeof userId !== "string" && typeof userId !== "number") continue;

    return { userId: String(userId), metaAppId: app.id, payload };
  }
  return null;
}

/** Marca como revogadas as contas daquele usuário naquele app. */
export async function revokeAccountsFor(
  userId: string,
  metaAppId: string,
  motivo: string,
): Promise<number> {
  const result = await prisma.socialAccount.updateMany({
    where: { igUserId: userId, metaAppId },
    data: { status: "REVOKED", statusMessage: motivo },
  });
  return result.count;
}
