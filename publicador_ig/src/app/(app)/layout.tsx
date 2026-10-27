import Link from "next/link";
import { signOut } from "@/auth";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand";

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
    { href: "/biblioteca", label: "Biblioteca", short: "Mídia", group: "Publicar" },
    { href: "/story-link", label: "Story + link", short: "Story", group: "Publicar" },
    { href: "/contas", label: "Contas", short: "Contas", group: "Contas" },
    { href: "/apps-meta", label: "Apps Meta", short: "Apps", group: "Contas" },
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

  const bottomItems = items.filter((i) =>
    ["/", "/publicar", "/fila", "/contas", "/saude"].includes(i.href),
  );

  const inicial = (ctx.userName || ctx.userEmail).trim().charAt(0).toUpperCase();

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[90rem] flex-col lg:flex-row">
      {/* Topo no celular */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-head text-sm font-semibold">Publicador IG</span>
        </Link>
        <form action={sair}>
          <Button variant="ghost" type="submit" className="px-2.5 py-1.5 text-xs">
            Sair
          </Button>
        </form>
      </header>

      {/* Sidebar no desktop */}
      <aside className="hidden shrink-0 border-r border-border lg:flex lg:w-64 lg:flex-col">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandMark className="size-9" />
          <div className="min-w-0">
            <Link href="/" className="block font-head text-[15px] font-semibold tracking-tight">
              Publicador IG
            </Link>
            <p className="truncate text-xs text-faint">{ctx.workspaceName}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <SideNav items={items} />
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-3 flex items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] text-sm font-semibold text-[var(--accent-ink)]">
              {inicial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{ctx.userName ?? "Você"}</p>
              <p className="truncate text-xs text-faint">{ctx.userEmail}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <form action={sair}>
              <Button variant="ghost" type="submit" className="px-2.5 py-1.5 text-xs">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-9 lg:pb-9">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      <BottomNav items={bottomItems} />
    </div>
  );
}
