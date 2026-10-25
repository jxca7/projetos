"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  group: string;
  badge?: number;
  badgeTone?: "danger" | "warn";
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Navegação lateral, usada em telas grandes. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const groups = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <nav className="space-y-5">
      {Object.entries(groups).map(([group, groupItems]) => (
        <div key={group}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {group}
          </p>
          <div className="space-y-0.5">
            {groupItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition",
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        item.badgeTone === "danger"
                          ? "bg-danger-soft text-danger"
                          : "bg-warn-soft text-warn",
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * Barra inferior do celular.
 *
 * Fica fixa porque, no uso real, a pessoa alterna entre publicar e conferir a
 * fila o tempo todo — e no telefone o menu em gaveta cobra dois toques por
 * troca de tela.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 px-1 py-2.5 text-[11px] transition",
                  active ? "font-medium text-accent" : "text-muted",
                )}
              >
                <span>{item.short}</span>
                {item.badge ? (
                  <span
                    className={cn(
                      "absolute top-1.5 right-1/2 translate-x-4 rounded-full px-1.5 text-[10px] font-medium",
                      item.badgeTone === "danger"
                        ? "bg-danger-soft text-danger"
                        : "bg-warn-soft text-warn",
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
