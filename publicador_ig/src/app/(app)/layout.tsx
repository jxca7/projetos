import Link from "next/link";
import { signOut } from "@/auth";
import { requireContext } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Badge, Button } from "@/components/ui";

const NAV = [
  { href: "/", label: "Visão geral" },
  { href: "/publicar", label: "Publicar" },
  { href: "/fila", label: "Fila" },
  { href: "/contas", label: "Contas" },
  { href: "/pendencias", label: "Pendências" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();

  const [needsAttention, pendingReminders] = await Promise.all([
    prisma.socialAccount.count({
      where: { workspaceId: ctx.workspaceId, status: { not: "ACTIVE" } },
    }),
    prisma.reminder.count({
      where: { account: { workspaceId: ctx.workspaceId }, status: { in: ["PENDING", "SENT"] } },
    }),
  ]);

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-border px-5 py-5 lg:w-60 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between lg:block">
          <div>
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

        <nav className="mt-5 flex flex-wrap gap-1 lg:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
            >
              <span>{item.label}</span>
              {item.href === "/contas" && needsAttention > 0 ? (
                <Badge tone="danger">{needsAttention}</Badge>
              ) : null}
              {item.href === "/pendencias" && pendingReminders > 0 ? (
                <Badge tone="warn">{pendingReminders}</Badge>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="mt-6 hidden border-t border-border pt-4 lg:block">
          <p className="truncate text-xs text-muted">{ctx.userEmail}</p>
          <form action={sair}>
            <Button variant="ghost" type="submit" className="mt-1 px-0 text-xs">
              Sair
            </Button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">{children}</main>
    </div>
  );
}
