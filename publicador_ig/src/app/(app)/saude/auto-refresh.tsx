"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Recarrega os dados do servidor em intervalo fixo.
 *
 * Usa router.refresh() em vez de polling por fetch: a página continua sendo
 * server component e a consulta nova vem com os dados já renderizados.
 */
export function AutoRefresh({ seconds = 90 }: { seconds?: number }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const tick = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          startTransition(() => router.refresh());
          return seconds;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [router, seconds]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">
        {pending ? (
          "atualizando..."
        ) : (
          <>
            próxima leitura em <span className="tabular-nums text-text">{left}s</span>
          </>
        )}
      </span>
      <Button
        variant="secondary"
        type="button"
        className="px-3 py-1.5 text-xs"
        disabled={pending}
        onClick={() => {
          setLeft(seconds);
          startTransition(() => router.refresh());
        }}
      >
        Atualizar agora
      </Button>
    </div>
  );
}
