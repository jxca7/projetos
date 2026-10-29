import crypto from "node:crypto";

/**
 * Um IP por conta (sticky), em vez de uma proxy única para o lote inteiro.
 *
 * O erro clássico é apontar todas as contas para a mesma proxy: elas saem pelo
 * MESMO IP, o Instagram liga uma na outra e, se cai uma, caem todas. Aqui cada
 * conta ganha um "session-id" próprio e fixo; no IPRoyal (e afins) isso vira um
 * IP residencial diferente e estável por conta. Se uma cair, cai sozinha.
 */

/** ID de sessão fixo por conta: 8 chars (letras/números), como o IPRoyal exige. */
export function sessionIdFor(key: string): string {
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
}

/**
 * Resolve a proxy de UMA conta. Se a string tiver o marcador {session}, troca
 * por um id fixo derivado da conta (mesmo id em toda retentativa → mesmo IP).
 * Sem o marcador, devolve a proxy como está (comportamento antigo).
 */
export function resolveProxyForAccount(
  proxy: string | null | undefined,
  accountKey: string,
): string | null {
  const p = proxy?.trim();
  if (!p) return null;
  if (p.includes("{session}")) return p.split("{session}").join(sessionIdFor(accountKey));
  return p;
}

/**
 * Monta o formato sticky do IPRoyal a partir dos dados base `host:porta:user:senha`.
 * As opções vão na SENHA, separadas por "_": país, sessão (por conta) e duração.
 * Deixa o marcador {session} para o worker trocar por conta.
 *
 * Ex.: geo.iproyal.com:12321:USER:PASS
 *   -> geo.iproyal.com:12321:USER:PASS_country-br_session-{session}_lifetime-7d
 *
 * Se já vier com sessão/marcador, ou não for no formato de 4 partes, devolve igual.
 */
export function buildIproyalSticky(base: string, country = "br"): string {
  const p = base.trim();
  if (!p || p.includes("://") || p.includes("{session}") || p.includes("_session-")) return p;
  const partes = p.split(":");
  if (partes.length < 4) return p; // sem usuário/senha não dá para fazer sticky
  const [host, porta, usuario, ...resto] = partes;
  const senha = resto.join(":");
  return `${host}:${porta}:${usuario}:${senha}_country-${country}_session-{session}_lifetime-7d`;
}
