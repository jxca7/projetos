import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { processPublishTarget } from "@/worker/publish";
import { encryptSecret } from "@/lib/crypto";

/**
 * Exercita os caminhos de falha contra o banco de verdade, com o driver mock
 * forcando um erro especifico (MOCK_FORCE_ERROR).
 *
 * Roda um cenario por processo, porque o erro forcado e' lido do ambiente.
 */

async function makeScenario(label: string) {
  const ws = await prisma.workspace.upsert({
    where: { slug: `teste-${label}` },
    update: {},
    create: { name: `Teste ${label}`, slug: `teste-${label}` },
  });
  await prisma.subscription.upsert({
    where: { workspaceId: ws.id },
    update: { maxAccounts: 10 },
    create: { workspaceId: ws.id, tier: "PRO", maxAccounts: 10, maxPostsPerMonth: 999 },
  });

  const account = await prisma.socialAccount.upsert({
    where: { workspaceId_igUserId: { workspaceId: ws.id, igUserId: `ig-${label}` } },
    update: { status: "ACTIVE", statusMessage: null },
    create: {
      workspaceId: ws.id,
      igUserId: `ig-${label}`,
      igUsername: `conta.${label}`,
      accessTokenEnc: encryptSecret("token-de-teste"),
      status: "ACTIVE",
    },
  });

  const media = await prisma.mediaAsset.create({
    data: {
      workspaceId: ws.id,
      kind: "VIDEO",
      storageKey: `teste/${label}.mp4`,
      publicUrl: `https://exemplo.test/${label}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 1_000_000,
      width: 1080,
      height: 1920,
      durationMs: 8000,
    },
  });

  const post = await prisma.post.create({
    data: {
      workspaceId: ws.id,
      type: "REEL",
      caption: "teste de falha",
      media: { create: [{ mediaId: media.id, position: 0 }] },
      targets: { create: [{ accountId: account.id, status: "QUEUED" }] },
    },
    include: { targets: true },
  });

  return { ws, account, post, target: post.targets[0] };
}

async function main() {
  const mode = process.env.MOCK_FORCE_ERROR ?? "none";
  console.log(`\n== cenario: ${mode} ==`);
  const { account, target, post } = await makeScenario(mode);

  const outcome = await processPublishTarget(target.id);
  const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: target.id } });
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
  const postAfter = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });

  console.log(`resultado do job: ${outcome.kind}${"reason" in outcome ? ` (${outcome.reason})` : ""}`);
  console.log(`target: status=${after.status} tentativas=${after.attempts} erro="${(after.lastError ?? "").slice(0, 70)}"`);
  console.log(`conta:  status=${acc.status} msg="${(acc.statusMessage ?? "").slice(0, 60)}"`);
  console.log(`post:   status=${postAfter.status}`);

  if (mode === "auth") {
    assert.equal(outcome.kind, "failed", "token morto nao deve virar retry");
    assert.equal(postAfter.status, "FAILED", "o post deve refletir a falha no painel");
    assert.equal(acc.status, "TOKEN_EXPIRED", "a conta inteira deve ser marcada");
    assert.equal(after.status, "FAILED");
    assert.match(after.lastError ?? "", /Reconecte a conta/);
    console.log("OK: token morto para a conta inteira em vez de ficar tentando");
  }

  if (mode === "quota") {
    assert.equal(outcome.kind, "retry", "cota cheia deve reagendar, nao falhar");
    assert.equal(after.status, "QUEUED");
    assert.equal(after.attempts, 0, "cota cheia nao deve consumir tentativa");
    assert.equal(acc.quotaUsage, acc.quotaTotal);
    assert.ok((outcome as { delayMs: number }).delayMs >= 30 * 60_000, "espera longa na cota");
    console.log("OK: cota cheia reagenda sem gastar tentativa");
  }

  if (mode === "permanent") {
    assert.equal(outcome.kind, "failed", "formato invalido nao deve virar retry");
    assert.equal(after.status, "FAILED");
    assert.equal(after.attempts, 1, "deve falhar na primeira, sem insistir");
    assert.equal(acc.status, "ACTIVE", "erro de midia nao derruba a conta");
    assert.equal(postAfter.status, "FAILED");
    console.log("OK: erro permanente falha de primeira e nao afeta a conta");
  }

  if (mode === "rate_limit") {
    assert.equal(outcome.kind, "retry", "rate limit deve reagendar");
    assert.match(after.lastError ?? "", /request limit/i);
    assert.equal(acc.status, "ACTIVE");
    console.log("OK: rate limit reagenda e nao e' confundido com cota da conta");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exit(1);
  });
