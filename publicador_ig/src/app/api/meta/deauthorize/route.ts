import { NextResponse, type NextRequest } from "next/server";
import { resolveSignedRequest, revokeAccountsFor } from "@/lib/meta/webhooks";

/**
 * Callback de desautorização, exigido pela Meta no cadastro do app.
 *
 * Chega quando alguém remove o app pelas configurações do Instagram ou do
 * Facebook. A partir daí o token está morto: marcar a conta aqui evita o
 * worker descobrir isso só na próxima publicação, com erro de token.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");

  if (typeof signed !== "string") {
    return NextResponse.json({ error: "signed_request ausente" }, { status: 400 });
  }

  const resolved = await resolveSignedRequest(signed);
  if (!resolved) {
    // Assinatura que não bate com nenhum app: não é a Meta falando conosco.
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  const afetadas = await revokeAccountsFor(
    resolved.userId,
    resolved.metaAppId,
    "Acesso removido pelo usuário no Instagram. Reconecte para voltar a publicar.",
  );

  return NextResponse.json({ ok: true, revoked: afetadas });
}
