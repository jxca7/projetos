import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button, Field, Notice } from "@/components/ui";
import { BrandMark } from "@/components/brand";

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
      if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
      redirect("/login?erro=credenciais");
    }
  }

  return (
    <main className="relative grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Painel de marca */}
      <section className="relative hidden overflow-hidden bg-[linear-gradient(150deg,var(--accent),var(--accent-2))] p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 20% 10%, rgba(255,255,255,.5), transparent 60%), radial-gradient(50% 40% at 90% 90%, rgba(255,255,255,.35), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3 text-white">
          <BrandMark className="size-10 bg-white/15 shadow-none ring-1 ring-white/30" />
          <span className="font-head text-lg font-semibold">Publicador IG</span>
        </div>

        <div className="relative max-w-md text-white">
          <h1 className="font-head text-[2.4rem] font-bold leading-[1.1]">
            Suas contas, publicando juntas.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/85">
            Agende Reels, feed, carrossel e Stories em dezenas de contas de uma vez — pela API
            oficial da Meta, com fila, métricas e controle de falha.
          </p>
          <ul className="mt-7 space-y-2.5 text-sm text-white/90">
            {[
              "API oficial — nada de automação que queima conta",
              "Legenda própria por conta e intervalo entre elas",
              "Saúde das contas e cota lida em tempo real",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="size-4 shrink-0" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          Conecte apenas contas que você possui ou gerencia com autorização do dono.
        </p>
      </section>

      {/* Formulário */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-10" />
            <span className="font-head text-lg font-semibold">Publicador IG</span>
          </div>

          <h2 className="font-head text-2xl font-semibold tracking-tight">Entrar</h2>
          <p className="mt-1 text-sm text-muted">Acesse o painel da sua operação.</p>

          <form action={entrar} className="mt-7 space-y-4">
            {erro ? <Notice tone="danger">E-mail ou senha incorretos.</Notice> : null}
            <Field label="E-mail">
              <input name="email" type="email" required autoComplete="email" placeholder="voce@exemplo.com" />
            </Field>
            <Field label="Senha">
              <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
            </Field>
            <Button type="submit" className="mt-1 w-full py-2.5">
              Entrar
            </Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-faint">
            A conta do Instagram precisa ser Business ou Creator. A publicação é feita pela API
            oficial da Meta, nas contas em que você tem permissão.
          </p>
        </div>
      </section>
    </main>
  );
}
