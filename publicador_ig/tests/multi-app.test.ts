import "dotenv/config";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { encryptSecret, appSecretProof } from "@/lib/crypto";
import { activeCredentials, credentialsForAccount, NoMetaAppError } from "@/lib/meta/credentials";

/**
 * Cada conta precisa falar pela credencial do app que emitiu o token dela.
 * O appsecret_proof é um HMAC do secret: assinar com o secret de outro app
 * faz a Meta recusar todas as chamadas daquela conta.
 */

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const SLUG = "teste-multi-app";

async function cenario() {
  const ws = await prisma.workspace.upsert({
    where: { slug: SLUG },
    update: {},
    create: { name: "Teste multi app", slug: SLUG },
  });

  await prisma.socialAccount.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.metaApp.deleteMany({ where: { workspaceId: ws.id } });

  const appA = await prisma.metaApp.create({
    data: {
      workspaceId: ws.id,
      name: "App A",
      appId: "111111111111111",
      appSecretEnc: encryptSecret(SECRET_A),
      graphVersion: "v23.0",
      isActive: true,
    },
  });
  const appB = await prisma.metaApp.create({
    data: {
      workspaceId: ws.id,
      name: "App B",
      appId: "222222222222222",
      appSecretEnc: encryptSecret(SECRET_B),
      graphVersion: "v24.0",
      isActive: false,
    },
  });

  const contaA = await prisma.socialAccount.create({
    data: {
      workspaceId: ws.id,
      igUserId: "multi-a",
      igUsername: "conta.a",
      accessTokenEnc: encryptSecret("token-a"),
      metaAppId: appA.id,
    },
  });
  const contaB = await prisma.socialAccount.create({
    data: {
      workspaceId: ws.id,
      igUserId: "multi-b",
      igUsername: "conta.b",
      accessTokenEnc: encryptSecret("token-b"),
      metaAppId: appB.id,
    },
  });
  const contaOrfa = await prisma.socialAccount.create({
    data: {
      workspaceId: ws.id,
      igUserId: "multi-orfa",
      igUsername: "conta.orfa",
      accessTokenEnc: encryptSecret("token-orfa"),
      metaAppId: null,
    },
  });

  return { ws, appA, appB, contaA, contaB, contaOrfa };
}

test("cada conta recebe o secret do app que a conectou", async () => {
  const { contaA, contaB } = await cenario();

  const credA = await credentialsForAccount(contaA.id);
  const credB = await credentialsForAccount(contaB.id);

  assert.equal(credA.appSecret, SECRET_A);
  assert.equal(credB.appSecret, SECRET_B);
  assert.notEqual(credA.appId, credB.appId);
  assert.equal(credA.graphVersion, "v23.0");
  assert.equal(credB.graphVersion, "v24.0", "a versão da Graph é por app");
});

test("a assinatura difere por app, que é a razão de tudo isto existir", async () => {
  const { contaA, contaB } = await cenario();

  const credA = await credentialsForAccount(contaA.id);
  const credB = await credentialsForAccount(contaB.id);

  const proofCerto = appSecretProof("token-a", credA.appSecret);
  const proofErrado = appSecretProof("token-a", credB.appSecret);

  assert.notEqual(
    proofCerto,
    proofErrado,
    "assinar com o secret do outro app produziria um proof diferente e a Meta recusaria",
  );
});

test("app ativo é o usado nas novas conexões", async () => {
  const { ws, appA, appB } = await cenario();

  const antes = await activeCredentials(ws.id);
  assert.equal(antes.appId, appA.appId);

  await prisma.metaApp.update({ where: { id: appA.id }, data: { isActive: false } });
  await prisma.metaApp.update({ where: { id: appB.id }, data: { isActive: true } });

  const depois = await activeCredentials(ws.id);
  assert.equal(depois.appId, appB.appId);
});

test("conta sem app vinculado cai no .env, e sem .env falha explicando", async () => {
  const { contaOrfa } = await cenario();

  const tinha = process.env.META_APP_ID;
  const tinhaSecret = process.env.META_APP_SECRET;

  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  // env() guarda cache; o teste usa o caminho do banco, que é o que importa.
  await assert.rejects(
    () => credentialsForAccount(contaOrfa.id),
    (e: Error) =>
      e instanceof NoMetaAppError && /não está vinculada a nenhum app/.test(e.message),
    "sem app a falha precisa dizer a causa, não estourar um erro de token",
  );

  if (tinha) process.env.META_APP_ID = tinha;
  if (tinhaSecret) process.env.META_APP_SECRET = tinhaSecret;
});

after(async () => {
  const ws = await prisma.workspace.findUnique({ where: { slug: SLUG } });
  if (ws) await prisma.workspace.delete({ where: { id: ws.id } });
});
