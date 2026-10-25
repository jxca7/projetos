import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

/**
 * Cria (ou atualiza a senha de) um usuário dono, com workspace e plano.
 *
 * Em produção o banco começa vazio e o painel não tem tela de cadastro — este
 * é o jeito de criar o primeiro acesso. Rodar assim (na pasta do projeto):
 *
 *   docker compose run --rm --no-deps \
 *     -e EMAIL="voce@exemplo.com" \
 *     -e SENHA="uma-senha-forte" \
 *     -e WORKSPACE="Minha Agência" \
 *     web pnpm tsx scripts/criar-usuario.ts
 */

function obrig(nome: string): string {
  const v = (process.env[nome] || "").trim();
  if (!v) {
    console.error(`Faltou ${nome}. Veja o exemplo no topo de scripts/criar-usuario.ts.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = obrig("EMAIL").toLowerCase();
  const senha = obrig("SENHA");
  const nomeWorkspace = (process.env.WORKSPACE || "Meu Workspace").trim();
  const nomeUsuario = (process.env.NOME || email.split("@")[0]).trim();

  if (senha.length < 8) {
    console.error("A senha precisa ter ao menos 8 caracteres.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(senha, 10);

  // Cria o usuário, ou atualiza a senha se o e-mail já existir.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: nomeUsuario },
    create: { email, name: nomeUsuario, passwordHash },
  });

  // Garante um workspace com slug único e o usuário como dono.
  let slug = slugify(nomeWorkspace) || "workspace";
  const existente = await prisma.workspace.findUnique({ where: { slug } });
  if (existente) {
    const jaEhMembro = await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: existente.id },
    });
    if (!jaEhMembro) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const workspace =
    existente && (await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: existente.id },
    }))
      ? existente
      : await prisma.workspace.create({
          data: { name: nomeWorkspace, slug },
        });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  // Sem billing ligado ainda: dá capacidade folgada para não travar no limite.
  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      tier: "AGENCY",
      maxAccounts: Number(process.env.MAX_CONTAS || "500"),
      maxPostsPerMonth: 100000,
    },
  });

  console.log("Pronto. Entre no painel com:");
  console.log(`  e-mail: ${email}`);
  console.log(`  workspace: ${workspace.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Erro:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
