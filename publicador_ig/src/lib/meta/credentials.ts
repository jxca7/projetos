import { prisma } from "../prisma";
import { env } from "../env";
import { decryptSecret } from "../crypto";
import type { MetaCredentials } from "./types";

export class NoMetaAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoMetaAppError";
  }
}

/** Credenciais vindas do .env, para quem roda com um app só. */
function fromEnv(): MetaCredentials | null {
  const e = env();
  if (!e.META_APP_ID || !e.META_APP_SECRET) return null;
  return {
    metaAppId: null,
    appId: e.META_APP_ID,
    appSecret: e.META_APP_SECRET,
    graphVersion: e.META_GRAPH_VERSION,
    source: "env",
  };
}

function fromRow(row: {
  id: string;
  appId: string;
  appSecretEnc: string;
  graphVersion: string;
}): MetaCredentials {
  return {
    metaAppId: row.id,
    appId: row.appId,
    appSecret: decryptSecret(row.appSecretEnc),
    graphVersion: row.graphVersion,
    source: "db",
  };
}

/**
 * App que deve ser usado em novas conexões do workspace.
 *
 * Prefere o app marcado como ativo; se não houver nenhum cadastrado, cai para
 * o .env, que é o caminho de quem só tem um app.
 */
export async function activeCredentials(workspaceId: string): Promise<MetaCredentials> {
  const active = await prisma.metaApp.findFirst({
    where: { workspaceId, isActive: true },
  });
  if (active) return fromRow(active);

  const any = await prisma.metaApp.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  if (any) return fromRow(any);

  const envCreds = fromEnv();
  if (envCreds) return envCreds;

  throw new NoMetaAppError(
    "Nenhum app do Meta cadastrado. Vá em Apps Meta e cadastre o App ID e o App Secret antes de conectar contas.",
  );
}

/**
 * Credenciais do app que emitiu o token desta conta.
 *
 * Isto não é detalhe: o appsecret_proof é um HMAC do secret, então assinar com
 * o secret de outro app faz a Meta recusar todas as chamadas daquela conta.
 */
export async function credentialsForAccount(accountId: string): Promise<MetaCredentials> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: { workspaceId: true, igUsername: true, metaApp: true },
  });
  if (!account) throw new NoMetaAppError("Conta não encontrada.");

  if (account.metaApp) return fromRow(account.metaApp);

  // Conta conectada antes de existir cadastro de apps: usa o .env.
  const envCreds = fromEnv();
  if (envCreds) return envCreds;

  // Sem o app certo não dá para assinar: falhar aqui é melhor do que assinar
  // com o secret errado e receber um erro de token que não diz a causa.
  throw new NoMetaAppError(
    `@${account.igUsername} não está vinculada a nenhum app do Meta cadastrado. Reconecte a conta pelo app correto.`,
  );
}

// ---------------------------------------------------------------------------
// Atalhos que já devolvem o driver pronto
// ---------------------------------------------------------------------------

/**
 * Driver para publicar/ler em nome de uma conta.
 *
 * Em `mock` nem consulta o banco: o driver simulado não assina nada, e exigir
 * credenciais ali só faria o ambiente de desenvolvimento quebrar sem motivo.
 */
export async function driverForAccount(accountId: string) {
  const { meta } = await import("./index");
  if (env().META_DRIVER === "mock") return meta(null);
  return meta(await credentialsForAccount(accountId));
}

/** Driver para operações do workspace que ainda não têm conta, como o OAuth. */
export async function driverForWorkspace(workspaceId: string) {
  const { meta } = await import("./index");
  if (env().META_DRIVER === "mock") return meta(null);
  return meta(await activeCredentials(workspaceId));
}
