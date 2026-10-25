import "dotenv/config";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

/**
 * Exercita os callbacks que a Meta exige, contra o servidor de verdade.
 * Prova que a assinatura identifica o app certo e que o efeito é o esperado.
 */

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SECRET_CERTO = "1".repeat(32);
const SECRET_OUTRO = "2".repeat(32);
const SLUG = "teste-callbacks";
const IG_USER_ID = "17841499999999999";

function assinar(payload: object, secret: string): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${sig}.${b64}`;
}

async function post(path: string, signedRequest: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signedRequest }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function cenario() {
  const ws = await prisma.workspace.upsert({
    where: { slug: SLUG },
    update: {},
    create: { name: "Teste callbacks", slug: SLUG },
  });
  await prisma.socialAccount.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.metaApp.deleteMany({ where: { workspaceId: ws.id } });

  const appCerto = await prisma.metaApp.create({
    data: {
      workspaceId: ws.id,
      name: "App certo",
      loginFlow: "INSTAGRAM_LOGIN",
      appId: "900000000000001",
      appSecretEnc: encryptSecret(SECRET_CERTO),
    },
  });
  const appOutro = await prisma.metaApp.create({
    data: {
      workspaceId: ws.id,
      name: "App outro",
      loginFlow: "INSTAGRAM_LOGIN",
      appId: "900000000000002",
      appSecretEnc: encryptSecret(SECRET_OUTRO),
    },
  });

  // Mesmo @ conectado nos dois apps: só o do app que assinou pode ser afetado.
  await prisma.socialAccount.create({
    data: {
      workspaceId: ws.id,
      igUserId: IG_USER_ID,
      igUsername: "conta.callback",
      accessTokenEnc: encryptSecret("tok"),
      metaAppId: appCerto.id,
      status: "ACTIVE",
    },
  });
  const outraWs = await prisma.workspace.upsert({
    where: { slug: `${SLUG}-2` },
    update: {},
    create: { name: "Teste callbacks 2", slug: `${SLUG}-2` },
  });
  await prisma.socialAccount.deleteMany({ where: { workspaceId: outraWs.id } });
  await prisma.socialAccount.create({
    data: {
      workspaceId: outraWs.id,
      igUserId: IG_USER_ID,
      igUsername: "conta.callback",
      accessTokenEnc: encryptSecret("tok"),
      metaAppId: appOutro.id,
      status: "ACTIVE",
    },
  });

  return { ws, outraWs, appCerto, appOutro };
}

async function main() {
  const { appCerto, appOutro } = await cenario();

  console.log("1. desautorização assinada pelo app certo...");
  const r1 = await post(
    "/api/meta/deauthorize",
    assinar({ user_id: IG_USER_ID, algorithm: "HMAC-SHA256" }, SECRET_CERTO),
  );
  assert.equal(r1.status, 200, "assinatura válida deve ser aceita");
  assert.equal(r1.body.revoked, 1, "deve revogar só a conta daquele app");

  const doCerto = await prisma.socialAccount.findFirst({ where: { metaAppId: appCerto.id } });
  const doOutro = await prisma.socialAccount.findFirst({ where: { metaAppId: appOutro.id } });
  assert.equal(doCerto?.status, "REVOKED");
  assert.equal(
    doOutro?.status,
    "ACTIVE",
    "a mesma conta ligada a outro app não pode ser afetada",
  );
  console.log("   OK: revogou só a conta do app que assinou");

  console.log("2. exclusão de dados assinada pelo outro app...");
  const antes = await prisma.socialAccount.count({ where: { metaAppId: appOutro.id } });
  assert.equal(antes, 1);

  const r2 = await post(
    "/api/meta/data-deletion",
    assinar({ user_id: IG_USER_ID, algorithm: "HMAC-SHA256" }, SECRET_OUTRO),
  );
  assert.equal(r2.status, 200);
  assert.ok(r2.body.confirmation_code, "a Meta exige confirmation_code");
  assert.ok(String(r2.body.url).startsWith("http"), "a Meta exige url de acompanhamento");

  const depois = await prisma.socialAccount.count({ where: { metaAppId: appOutro.id } });
  assert.equal(depois, 0, "a conta daquele app deve ser apagada");
  const sobrou = await prisma.socialAccount.count({ where: { metaAppId: appCerto.id } });
  assert.equal(sobrou, 1, "a conta do outro app não pode ser apagada junto");
  console.log("   OK: apagou só os dados daquele app e devolveu o código");

  console.log("3. assinatura de app desconhecido...");
  const r3 = await post(
    "/api/meta/deauthorize",
    assinar({ user_id: IG_USER_ID }, "9".repeat(32)),
  );
  assert.equal(r3.status, 401);
  console.log("   OK: recusada");

  for (const slug of [SLUG, `${SLUG}-2`]) {
    const ws = await prisma.workspace.findUnique({ where: { slug } });
    if (ws) await prisma.workspace.delete({ where: { id: ws.id } });
  }
}

main()
  .then(() => {
    console.log("\ntodos os callbacks passaram");
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("FALHOU:", e.message);
    for (const slug of [SLUG, `${SLUG}-2`]) {
      const ws = await prisma.workspace.findUnique({ where: { slug } });
      if (ws) await prisma.workspace.delete({ where: { id: ws.id } });
    }
    process.exit(1);
  });
