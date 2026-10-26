"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Foto de perfil da conta, com fallback para a inicial num círculo da cor da
 * marca. As URLs de foto do Instagram expiram, então se a imagem falhar ao
 * carregar caímos no fallback em vez de mostrar imagem quebrada.
 */
export function Avatar({
  src,
  name,
  size = 36,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const inicial = (name || "?").trim().charAt(0).toUpperCase();
  const mostraImg = Boolean(src) && !falhou;

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-inset ring-black/10",
        "bg-[linear-gradient(135deg,var(--accent),var(--accent-2))]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {mostraImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFalhou(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span aria-hidden>{inicial}</span>
      )}
    </span>
  );
}
