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

/** Ícones por rota — traço fino, 20px, herdam a cor. */
function NavIcon({ href, className }: { href: string; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("size-5", className),
  };
  switch (href) {
    case "/":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "/publicar":
      return (
        <svg {...common}>
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
        </svg>
      );
    case "/fila":
      return (
        <svg {...common}>
          <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
          <path d="m3 12 9 4.5 9-4.5" />
          <path d="m3 16.5 9 4.5 9-4.5" />
        </svg>
      );
    case "/contas":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13A4 4 0 0 1 16 11" />
        </svg>
      );
    case "/apps-meta":
      return (
        <svg {...common}>
          <path d="M9 2v6M15 2v6M9 16v6M15 16v6" />
          <rect x="5" y="8" width="14" height="8" rx="2" />
        </svg>
      );
    case "/contas-off":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="m17 8 5 5M22 8l-5 5" />
        </svg>
      );
    case "/saude":
      return (
        <svg {...common}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
    case "/pendencias":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      );
    case "/story-link":
      return (
        <svg {...common}>
          <rect x="4" y="2" width="16" height="20" rx="4" />
          <path d="M10.5 12.5a2.5 2.5 0 0 1 0-3l1-1a2.5 2.5 0 0 1 3.5 3.5l-.7.7" />
          <path d="M13.5 11.5a2.5 2.5 0 0 1 0 3l-1 1a2.5 2.5 0 0 1-3.5-3.5l.7-.7" />
        </svg>
      );
    case "/preparar":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M5.5 21a7 7 0 0 1 13 0" />
          <path d="m18 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
        </svg>
      );
    case "/conectar":
      return (
        <svg {...common}>
          <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
        </svg>
      );
    case "/preparar-teste":
      return (
        <svg {...common}>
          <circle cx="11" cy="8" r="4" />
          <path d="M4.5 21a7 7 0 0 1 12 0" />
          <path d="M16 15.5v4M14 17.5h4" />
        </svg>
      );
    case "/massa":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Navegação lateral — telas grandes. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const groups = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <nav className="space-y-6">
      {Object.entries(groups).map(([group, groupItems]) => (
        <div key={group}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
            {group}
          </p>
          <div className="space-y-1">
            {groupItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
                  ) : null}
                  <NavIcon
                    href={item.href}
                    className={cn("shrink-0 transition-colors", active ? "text-accent" : "text-faint group-hover:text-muted")}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
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

/** Barra inferior fixa — celular. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 backdrop-blur-lg lg:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-accent" : "text-faint",
                )}
              >
                {active ? (
                  <span className="absolute top-0 h-[3px] w-8 rounded-full bg-accent" />
                ) : null}
                <NavIcon href={item.href} className="size-[22px]" />
                <span>{item.short}</span>
                {item.badge ? (
                  <span
                    className={cn(
                      "absolute right-[22%] top-1.5 size-2 rounded-full ring-2 ring-surface",
                      item.badgeTone === "danger" ? "bg-danger" : "bg-warn",
                    )}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
