import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { driverForAccount, credentialsForAccount } from "@/lib/meta";
import { encryptSecret } from "@/lib/crypto";
import { meta } from "@/lib/meta";
import { env } from "@/lib/env";
import type { MaintenanceJobData } from "@/lib/queue";

const TOKEN_WARNING_DAYS = 7;
/** Renova com folga: token vencido exige autorizar tudo de novo. */
const REFRESH_ANTES_DE_DIAS = 10;

export async function processMaintenance(data: MaintenanceJobData): Promise<void> {
  switch (data.kind) {
    case "refresh-account-quota": {
      const account = await prisma.socialAccount.findUnique({ where: { id: data.accountId } });
      if (!account || account.status !== "ACTIVE") return;
      try {
        const driver = await driverForAccount(account.id);
        const limit = await driver.getPublishingLimit(
          account.igUserId,
          decryptSecret(account.accessTokenEnc),
        );
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: {
            quotaUsage: limit.quotaUsage,
            quotaTotal: limit.quotaTotal,
            quotaCheckedAt: new Date(),
          },
        });
      } catch {
        // Cota é informativa no painel; falhar aqui não bloqueia nada.
      }
      return;
    }

    case "refresh-instagram-tokens": {
      // O token do fluxo do Instagram vale 60 dias e morre se ninguém renovar.
      // Renovamos com folga; a Meta só aceita renovar token com mais de 24h.
      const limite = new Date(Date.now() + REFRESH_ANTES_DE_DIAS * 24 * 60 * 60 * 1000);
      const contas = await prisma.socialAccount.findMany({
        where: {
          status: "ACTIVE",
          tokenExpiresAt: { not: null, lte: limite },
          metaApp: { loginFlow: "INSTAGRAM_LOGIN" },
        },
        select: { id: true, igUsername: true, accessTokenEnc: true },
        take: 200,
      });

      for (const conta of contas) {
        try {
          const driver =
            env().META_DRIVER === "mock"
              ? meta(null)
              : meta(await credentialsForAccount(conta.id));

          const renovado = await driver.refreshLongLivedToken(
            decryptSecret(conta.accessTokenEnc),
          );
          if (!renovado) continue; // fluxo do Facebook: nada a fazer

          await prisma.socialAccount.update({
            where: { id: conta.id },
            data: {
              accessTokenEnc: encryptSecret(renovado.accessToken),
              tokenExpiresAt: renovado.expiresAt,
              tokenRefreshedAt: new Date(),
              statusMessage: null,
            },
          });
        } catch (e) {
          // Falhar a renovação de uma conta não pode parar as outras.
          const message = e instanceof Error ? e.message : String(e);
          await prisma.socialAccount.update({
            where: { id: conta.id },
            data: {
              statusMessage: `Não foi possível renovar o token: ${message}`,
            },
          });
        }
      }
      return;
    }

    case "check-token-expiry": {
      // Marca contas cujo token está perto de expirar, para o painel avisar
      // antes de a publicação começar a falhar.
      const soon = new Date(Date.now() + TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000);
      const expiring = await prisma.socialAccount.findMany({
        where: { status: "ACTIVE", tokenExpiresAt: { not: null, lte: soon } },
        select: { id: true, igUsername: true, tokenExpiresAt: true },
      });
      for (const acc of expiring) {
        const expired = acc.tokenExpiresAt !== null && acc.tokenExpiresAt <= new Date();
        await prisma.socialAccount.update({
          where: { id: acc.id },
          data: {
            status: expired ? "TOKEN_EXPIRED" : "ACTIVE",
            statusMessage: expired
              ? "Token expirou. Reconecte a conta."
              : `Token expira em ${acc.tokenExpiresAt?.toLocaleDateString("pt-BR")}. Reconecte a conta.`,
          },
        });
      }
      return;
    }

    case "dispatch-reminders": {
      const due = await prisma.reminder.findMany({
        where: { status: "PENDING", dueAt: { lte: new Date() } },
        take: 200,
      });
      // O envio (push/e-mail) entra aqui. Por ora marcamos como enviado para
      // o painel mostrar na lista de pendências da pessoa.
      if (due.length > 0) {
        await prisma.reminder.updateMany({
          where: { id: { in: due.map((r) => r.id) } },
          data: { status: "SENT", sentAt: new Date() },
        });
      }
      return;
    }
  }
}
