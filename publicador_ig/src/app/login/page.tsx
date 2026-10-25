import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button, Card, Field, Notice } from "@/components/ui";

export const metadata = { title: "Entrar · Publicador IG" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");

  const { erro } = await searchParams;

  async function entrar(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? "").toLowerCase(),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (e) {
      // next-auth sinaliza o redirect por exceção; só tratamos credencial ruim.
      if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
      redirect("/login?erro=credenciais");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Publicador IG</h1>
        <p className="mt-1 text-sm text-muted">
          Agendamento em múltiplas contas profissionais do Instagram pela API oficial da Meta.
        </p>
      </div>

      <Card>
        <form action={entrar} className="space-y-4">
          {erro ? <Notice tone="danger">E-mail ou senha incorretos.</Notice> : null}
          <Field label="E-mail">
            <input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Senha">
            <input name="password" type="password" required autoComplete="current-password" />
          </Field>
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-xs text-muted">
        Conecte apenas contas que você possui ou gerencia com autorização do dono. A conta precisa
        ser Business ou Creator e estar vinculada a uma Página do Facebook.
      </p>
    </main>
  );
}
