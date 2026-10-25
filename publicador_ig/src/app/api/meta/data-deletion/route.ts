import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { resolveSignedRequest } from "@/lib/meta/webhooks";

/**
 * Callback de exclusão de dados, exigido pela Meta no cadastro do app.
 *
 * A Meta espera uma resposta JSON com uma URL onde a pessoa acompanha o pedido
 * e um código de confirmação. Apagamos o que é da conta — tokens, publicações,
 * métricas e histórico — e devolvemos o código.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");

  if (typeof signed !== "string") {
    return NextResponse.json({ error: "signed_request ausente" }, { status: 400 });
  }

  const resolved = await resolveSignedRequest(signed);
  if (!resolved) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  const confirmationCode = crypto.randomBytes(12).toString("hex");

  const contas = await prisma.socialAccount.findMany({
    where: { igUserId: resolved.userId, metaAppId: resolved.metaAppId },
    select: { id: true },
  });

  if (contas.length > 0) {
    const ids = contas.map((c) => c.id);
    // Apagar a conta leva junto destinos, eventos e métricas pelo cascade do
    // schema. A mídia enviada pertence ao workspace, não à conta, e fica.
    await prisma.socialAccount.deleteMany({ where: { id: { in: ids } } });
  }

  const url = new URL("/exclusao-de-dados", env().APP_URL);
  url.searchParams.set("codigo", confirmationCode);

  return NextResponse.json({
    url: url.toString(),
    confirmation_code: confirmationCode,
  });
}
