import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Destaca o card com um brilho sutil da cor da marca. */
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--r)] border border-border bg-surface p-5 shadow-[var(--shadow-sm)]",
        glow && "shadow-[var(--glow)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 max-w-prose text-sm text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted ring-border",
  ok: "bg-ok-soft text-ok ring-transparent",
  warn: "bg-warn-soft text-warn ring-transparent",
  danger: "bg-danger-soft text-danger ring-transparent",
  accent: "bg-accent-soft text-accent ring-transparent",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-faint",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  accent: "bg-accent",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", DOT[tone])} /> : null}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
}) {
  const accentText: Record<Tone, string> = {
    neutral: "text-text",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    accent: "text-accent",
  };
  return (
    <div className="group relative overflow-hidden rounded-[var(--r)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
        {icon ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border">
            {icon}
          </span>
        ) : null}
      </div>
      <div className={cn("mt-2 text-[1.7rem] font-semibold leading-none tabular-nums font-head", accentText[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary:
      "text-[var(--accent-ink)] bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] shadow-[var(--shadow-sm)] hover:shadow-[var(--glow)] hover:brightness-[1.05]",
    secondary: "border border-border bg-surface text-text hover:bg-surface-2 hover:border-border-strong",
    danger: "bg-danger-soft text-danger hover:brightness-[0.97]",
    ghost: "text-muted hover:bg-surface-2 hover:text-text",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--r-sm)] px-3.5 py-2 text-sm font-semibold",
        "transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none disabled:hover:brightness-100",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // A dica fica FORA do <label> para não entrar no nome acessível do campo.
  return (
    <div className="block">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{label}</span>
        {children}
      </label>
      {hint ? <span className="mt-1.5 block text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-[var(--r)] border border-dashed border-border-strong bg-surface/40 px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-faint ring-1 ring-inset ring-border">
        <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="font-semibold">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function Notice({
  tone = "warn",
  title,
  children,
}: {
  tone?: "warn" | "danger" | "ok" | "accent";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    ok: "bg-ok-soft text-ok",
    accent: "bg-accent-soft text-accent",
  };
  return (
    <div className={cn("rounded-[var(--r)] px-4 py-3 text-sm ring-1 ring-inset ring-black/5", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-0.5 opacity-90" : undefined}>{children}</div>
    </div>
  );
}
