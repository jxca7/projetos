import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { activeCredentials } from "@/lib/meta";
import { authorizeUrl, redirectUri, signState } from "@/lib/meta/oauth";
import { finalizeConnection, NoProAccountError } from "@/lib/meta/connect";
import { connectAccountBrowser } from "@/lib/meta/connect-browser";
import type { ConnectJobData } from "@/lib/queue";

/** Conecta UMA conta: navegador faz o OAuth, captura o code, o app grava o token. */
export async function processConnect(data: ConnectJobData): Promise<void> {
  const target = await prisma.connectTarget.findUnique({
    where: { id: data.targetId },
    include: { job: true },
  });
  if (!target) return;
  if (target.status === "DONE") return;

  await prisma.connectTarget.update({
    where: { id: target.id },
    data: { status: "POSTING", error: null },
  });

  try {
    const combo = decryptSecret(target.comboEnc);
    const proxy = target.job.proxyEnc ? decryptSecret(target.job.proxyEnc) : null;

    // URL de autorização do OAuth, com um state assinado deste workspace.
    const creds = await activeCredentials(target.job.workspaceId);
    const nonce = crypto.randomBytes(16).toString("base64url");
    const state = signState(`${target.job.workspaceId}:${nonce}`);
    const oauthUrl = authorizeUrl(state, creds);

    const result = await connectAccountBrowser({
      username: target.username,
      combo,
      oauthUrl,
      redirectPrefix: redirectUri(),
      proxy,
    });

    if (result.outcome === "GOT_CODE" && result.code) {
      // Troca o code pelo token e grava a(s) conta(s).
      const { created, updated, usernames } = await finalizeConnection(
        target.job.workspaceId,
        result.code,
      );
      await prisma.connectTarget.update({
        where: { id: target.id },
        data: {
          status: "DONE",
          error: null,
          connected: usernames.join(", ") || target.username,
          doneAt: new Date(),
        },
      });
      void created;
      void updated;
      return;
    }

    // Salva o print da falha COMO MÍDIA (a rota de mídia só serve o que está
    // registrado) e põe o link no erro, para a gente ver a tela.
    let msgErro = result.message;
    if (result.shotPng && result.shotPng.length > 0) {
      try {
        const { ingestMedia } = await import("@/lib/media/ingest");
        const { asset } = await ingestMedia({
          workspaceId: target.job.workspaceId,
          body: result.shotPng,
          originalName: `conectar-${target.username}.png`,
          mimeType: "image/png",
          usedFor: "LIBRARY",
        });
        msgErro = `${result.message} · print: ${asset.publicUrl}`;
      } catch {
        /* sem print não bloqueia */
      }
    }
    await prisma.connectTarget.update({
      where: { id: target.id },
      data: {
        status: result.outcome === "SKIPPED_2FA" ? "SKIPPED_2FA" : "FAILED",
        error: msgErro,
      },
    });
  } catch (e) {
    const msg =
      e instanceof NoProAccountError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Erro inesperado ao conectar a conta.";
    await prisma.connectTarget.update({
      where: { id: target.id },
      data: { status: "FAILED", error: msg.slice(0, 400) },
    });
    // Não relança: não repete sozinho (evita lockout da conta).
  }
}
