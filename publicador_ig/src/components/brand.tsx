import { cn } from "@/lib/utils";

/** Marca do produto: quadrado com gradiente da marca e um símbolo de envio. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[11px] bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] text-white shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[58%]" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z" />
        <path d="m10 13.5 4-4" />
      </svg>
    </span>
  );
}
