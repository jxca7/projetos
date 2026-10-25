import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { meta } from "@/lib/meta";
import { storage, buildKey } from "@/lib/storage";
import { probeMedia } from "@/lib/media/probe";
import { validateMedia, hasBlockingIssue } from "@/lib/media/validate";
import { slugify } from "@/lib/utils";

const SEED_EMAIL = process.env.SEED_EMAIL ?? "dono@exemplo.com";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "senha-de-teste-123";

async function upsertMedia(
  workspaceId: string,
  filePath: string,
  kind: "IMAGE" | "VIDEO",
  mimeType: string,
  usedFor: "REEL" | "IMAGE" | "CAROUSEL" | "STORY",
) {
  const body = await fs.readFile(filePath);
  const probe = await probeMedia(filePath);

  const issues = validateMedia({
    kind,
    mimeType,
    sizeBytes: body.byteLength,
    probe,
    usedFor,
  });
  for (const i of issues) {
    console.log(`  ${i.level === "error" ? "ERRO" : "aviso"}: ${i.message}`);
  }
  if (hasBlockingIssue(issues)) {
    throw new Error(`Mídia ${path.basename(filePath)} reprovada na validação.`);
  }

  const key = buildKey(workspaceId, path.basename(filePath));
  const stored = await storage().put(key, body, mimeType);

  return prisma.mediaAsset.create({
    data: {
      workspaceId,
      kind,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
      originalName: path.basename(filePath),
    },
  });
}

async function main() {
  console.log("== seed ==");

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      name: "Dono do Workspace",
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
    },
  });
  console.log(`usuário: ${user.email}`);

  const slug = slugify("Agência Exemplo");
  const workspace = await prisma.workspace.upsert({
    where: { slug },
    update: {},
    create: { name: "Agência Exemplo", slug, timezone: "America/Sao_Paulo" },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: { tier: "AGENCY", maxAccounts: 50, maxPostsPerMonth: 5000 },
    create: {
      workspaceId: workspace.id,
      tier: "AGENCY",
      maxAccounts: 50,
      maxPostsPerMonth: 5000,
    },
  });
  console.log(`workspace: ${workspace.name} (${workspace.slug})`);

  // Contas: no driver mock vem uma lista fixa; no driver real, viriam do OAuth.
  // Driver mock: ignora credenciais.
  const discovered = await meta(null).listInstagramAccounts("seed-token");
  for (const acc of discovered) {
    await prisma.socialAccount.upsert({
      where: { workspaceId_igUserId: { workspaceId: workspace.id, igUserId: acc.igUserId } },
      update: {
        igUsername: acc.igUsername,
        accessTokenEnc: encryptSecret(acc.accessToken),
        status: "ACTIVE",
        followersCount: acc.followersCount,
        lastSyncedAt: new Date(),
      },
      create: {
        workspaceId: workspace.id,
        igUserId: acc.igUserId,
        igUsername: acc.igUsername,
        igAccountType: acc.igAccountType,
        pageId: acc.pageId,
        pageName: acc.pageName,
        profilePicUrl: acc.profilePicUrl,
        followersCount: acc.followersCount,
        accessTokenEnc: encryptSecret(acc.accessToken),
        tokenExpiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
        scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
        status: "ACTIVE",
        lastSyncedAt: new Date(),
      },
    });
  }
  console.log(`contas conectadas: ${discovered.length}`);

  // Mídia de teste gerada com ffmpeg pelo script de fixtures.
  const fixtures = path.resolve(process.cwd(), "scripts/fixtures");
  const reelPath = path.join(fixtures, "reel.mp4");
  const imagePath = path.join(fixtures, "post.jpg");

  console.log("validando mídia:");
  const reel = await upsertMedia(workspace.id, reelPath, "VIDEO", "video/mp4", "REEL");
  const image = await upsertMedia(workspace.id, imagePath, "IMAGE", "image/jpeg", "IMAGE");
  console.log(`  reel: ${reel.width}x${reel.height}, ${(reel.durationMs ?? 0) / 1000}s`);
  console.log(`  imagem: ${image.width}x${image.height}`);

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { igUsername: "asc" },
  });

  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      type: "REEL",
      caption:
        "Lançamento da coleção nova. Link na bio para ver tudo.\n\n#moda #novidade #brasil",
      shareToFeed: true,
      staggerSeconds: 10, // curto só para o teste; o padrão do produto é 90s
      publishNow: true,
      media: { create: [{ mediaId: reel.id, position: 0 }] },
      targets: {
        create: accounts.map((a, i) => ({
          accountId: a.id,
          // Legenda própria por conta: marcas diferentes, texto diferente.
          captionOverride:
            i === 0
              ? undefined
              : `Novidade chegando na @${a.igUsername}. Passa aqui pra ver.\n\n#novidade #${a.igUsername.replace(/\./g, "")}`,
        })),
      },
    },
    include: { targets: true },
  });

  console.log(`post criado: ${post.id} (${post.targets.length} destinos)`);
  console.log("\nrode agora:");
  console.log("  pnpm worker        # em um terminal");
  console.log(`  pnpm tsx scripts/schedule.ts ${post.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
