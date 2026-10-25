import Link from "next/link";
import { signOut } from "@/auth";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const ws = { workspaceId: ctx.workspaceId };

  const [contasOff, pendencias, falhas] = await Promise.all([
    prisma.socialAccount.count({ where: { ...ws, status: { not: "ACTIVE" } } }),
    prisma.reminder.count({
      where: { account: ws, status: { in: ["PENDING", "SENT"] } },
    }),
    prisma.postTarget.count({
      where: {
        post: ws,
        status: "FAILED",
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const items: NavItem[] = [
    { href: "/", label: "Visão geral", short: "Início", group: "Principal" },
    { href: "/publicar", label: "Publicar", short: "Publicar", group: "Publicar" },
    { href: "/fila", label: "Fila", short: "Fila", group: "Publicar" },
    { href: "/contas", label: "Contas", short: "Contas", group: "Contas" },
    {
      href: "/contas-off",
      label: "Contas off",
      short: "Off",
      group: "Contas",
      badge: contasOff || undefined,
      badgeTone: "danger",
    },
    {
      href: "/saude",
      label: "Saúde",
      short: "Saúde",
      group: "Monitorar",
      badge: falhas || undefined,
      badgeTone: "danger",
    },
    {
      href: "/pendencias",
      label: "Pendências",
      short: "Pendências",
      group: "Monitorar",
      badge: pendencias || undefined,
      badgeTone: "warn",
    },
  ];

  // No celular a barra inferior mostra só o que se usa o tempo todo.
  const bottomItems = items.filter((i) =>
    ["/", "/publicar", "/fila", "/contas", "/saude"].includes(i.href),
  );

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-border px-5 py-4 lg:w-60 lg:border-r lg:border-b-0 lg:py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/" className="block text-base font-semibold tracking-tight">
              Publicador IG
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted">{ctx.workspaceName}</p>
          </div>
          <form action={sair} className="lg:hidden">
            <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
              Sair
            </Button>
          </form>
        </div>

        <div className="mt-5 hidden lg:block">
          <SideNav items={items} />
        </div>

        <div className="mt-6 hidden border-t border-border pt-4 lg:block">
          <p className="truncate text-xs text-muted">{ctx.userEmail}</p>
          <form action={sair}>
            <Button variant="ghost" type="submit" className="mt-1 px-0 text-xs">
              Sair
            </Button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-6 pb-24 lg:px-8 lg:pb-6">{children}</main>

      <BottomNav items={bottomItems} />
    </div>
  );
}
