"use client";

import { useState } from "react";

/** Campo somente leitura com botão de copiar, para colar no painel da Meta. */
export function Copiavel({ label, value }: { label: string; value: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        <button
          type="button"
          className="shrink-0 text-xs text-accent hover:underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1800);
            } catch {
              // Sem permissão de área de transferência: a pessoa copia na mão.
              setCopiado(false);
            }
          }}
        >
          {copiado ? "copiado" : "copiar"}
        </button>
      </div>
      <code className="mt-1.5 block font-mono text-xs break-all">{value}</code>
    </div>
  );
}
