"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Tema = "light" | "dark";

/** Alterna claro/escuro, grava a escolha e aplica no <html>. */
export function ThemeToggle() {
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem("tema") as Tema | null;
      if (salvo === "dark" || salvo === "light") {
        setTema(salvo);
        return;
      }
    } catch {
      /* sem storage: segue o sistema */
    }
    const sistema = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTema(sistema);
  }, []);

  function aplicar(t: Tema) {
    setTema(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("tema", t);
    } catch {
      /* ignora */
    }
  }

  const opcoes: { t: Tema; label: string; icon: React.ReactNode }[] = [
    {
      t: "light",
      label: "Claro",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      t: "dark",
      label: "Escuro",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className="inline-flex rounded-[var(--r-sm)] border border-border bg-surface-2 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.t}
          type="button"
          onClick={() => aplicar(o.t)}
          aria-pressed={tema === o.t}
          title={o.label}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[calc(var(--r-sm)-3px)] px-2.5 py-1 text-xs font-medium transition-colors",
            tema === o.t ? "bg-surface text-text shadow-[var(--shadow-sm)]" : "text-faint hover:text-muted",
          )}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
