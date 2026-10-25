import { redis } from "../redis";

/**
 * Espacamento mínimo entre publicações na MESMA conta.
 *
 * A cota de 24h da Meta não é o único limite que importa: disparar 10 posts
 * seguidos no mesmo minuto numa conta é exatamente o padrão que o Instagram
 * trata como automação abusiva. Esse intervalo é um piso tecnico do produto,
 * não uma preferência do usuário.
 */
export const MIN_SECONDS_BETWEEN_PUBLISHES = Number(
  process.env.MIN_SECONDS_BETWEEN_PUBLISHES ?? "300",
);

function lastPublishKey(accountId: string): string {
  return `pacing:last-publish:${accountId}`;
}

function reservationKey(accountId: string): string {
  return `pacing:reserved:${accountId}`;
}

/**
 * Tenta reservar o slot de publicação da conta.
 *
 * Devolve 0 se pode publicar agora, ou quantos ms faltam. A reserva usa SET NX
 * com TTL, então dois workers concorrentes não publicam na mesma conta dentro
 * da janela.
 */
export async function reserveSlot(accountId: string): Promise<number> {
  const r = redis();
  const windowMs = MIN_SECONDS_BETWEEN_PUBLISHES * 1000;

  const acquired = await r.set(
    reservationKey(accountId),
    Date.now().toString(),
    "PX",
    windowMs,
    "NX",
  );

  if (acquired === "OK") return 0;

  const ttl = await r.pttl(reservationKey(accountId));
  // Soma um jitter para dois jobs que esperam o mesmo slot não acordarem juntos.
  const jitter = Math.floor(Math.random() * 20_000);
  return Math.max(5_000, (ttl > 0 ? ttl : windowMs) + jitter);
}

/** Libera a reserva quando a publicação falhou e não consumiu cota. */
export async function releaseSlot(accountId: string): Promise<void> {
  await redis().del(reservationKey(accountId));
}

export async function markPublished(accountId: string): Promise<void> {
  await redis().set(lastPublishKey(accountId), Date.now().toString(), "EX", 7 * 24 * 3600);
}

export async function lastPublishedAt(accountId: string): Promise<Date | null> {
  const v = await redis().get(lastPublishKey(accountId));
  return v ? new Date(Number(v)) : null;
}
