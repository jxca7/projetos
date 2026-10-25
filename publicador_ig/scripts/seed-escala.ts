import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { slugify } from "@/lib/utils";

/**
 * Gera contas e pastas em volume, para checar se o painel aguenta a escala
 * real de quem administra dezenas de perfis. Só roda com o driver mock.
 */

const TOTAL = Number(process.env.SEED_CONTAS ?? "93");
const PASTAS = ["Clientes A", "Clientes B", "Nichos", "Testes"];

function handle(i: number): string {
  const bases = ["loja", "marca", "studio", "nicho", "perfil", "canal", "shop", "midia"];
  return `${bases[i % bases.length]}${String(i).padStart(3, "0")}`;
}

async function main() {
  if (process.env.META_DRIVER === "graph") {
    throw new Error("Não rode isto com META_DRIVER=graph: criaria contas falsas no seu banco real.");
  }

  const slug = slugify("Agência Exemplo");
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) throw new Error("Rode `pnpm seed` antes.");

  await prisma.subscription.update({
    where: { workspaceId: workspace.id },
    data: { maxAccounts: Math.max(TOTAL + 10, 100) },
  });

  const folders = [];
  for (const [i, name] of PASTAS.entries()) {
    folders.push(
      await prisma.accountFolder.upsert({
        where: { workspaceId_name: { workspaceId: workspace.id, name } },
        update: {},
        create: { workspaceId: workspace.id, name, position: i },
      }),
    );
  }

  let criadas = 0;
  for (let i = 0; i < TOTAL; i++) {
    const igUserId = `escala-${String(i).padStart(4, "0")}`;
    // Deixa ~1/3 sem pasta, como no uso real de quem ainda não organizou tudo.
    const folderId = i % 3 === 0 ? null : folders[i % folders.length].id;

    // Alguns estados fora do ar, para a tela de Contas off ter o que mostrar.
    const status =
      i % 29 === 0 ? "TOKEN_EXPIRED" : i % 37 === 0 ? "DISABLED" : i % 41 === 0 ? "REVOKED" : "ACTIVE";

    const quotaTotal = 50;
    // A API nunca reporta uso acima do teto; o seed respeita isso.
    const quotaUsage = status === "ACTIVE" ? Math.floor(Math.random() * (quotaTotal + 1)) : 0;

    await prisma.socialAccount.upsert({
      where: { workspaceId_igUserId: { workspaceId: workspace.id, igUserId } },
      update: { folderId, status, quotaUsage, quotaTotal, quotaCheckedAt: new Date() },
      create: {
        workspaceId: workspace.id,
        igUserId,
        igUsername: handle(i),
        igAccountType: "BUSINESS",
        pageId: `page-${i}`,
        pageName: `Página ${handle(i)}`,
        followersCount: Math.floor(Math.random() * 4000),
        accessTokenEnc: encryptSecret(`mock-token-${i}`),
        tokenExpiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
        scopes: ["instagram_basic", "instagram_content_publish"],
        status,
        statusMessage:
          status === "TOKEN_EXPIRED"
            ? "Error validating access token: Session has expired"
            : status === "REVOKED"
              ? "Acesso revogado no Business Manager"
              : null,
        folderId,
        quotaUsage,
        quotaTotal,
        quotaCheckedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });
    criadas++;
  }

  const total = await prisma.socialAccount.count({ where: { workspaceId: workspace.id } });
  const off = await prisma.socialAccount.count({
    where: { workspaceId: workspace.id, status: { not: "ACTIVE" } },
  });
  console.log(`${criadas} contas geradas · ${total} no total · ${off} fora do ar`);
  console.log(`pastas: ${PASTAS.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
