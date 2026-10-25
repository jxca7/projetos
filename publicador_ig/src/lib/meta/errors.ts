/**
 * Classificacao dos erros da Graph API.
 *
 * Isso importa mais do que parece: repetir uma chamada que falhou por motivo
 * permanente (token revogado, video em formato invalido) so queima rate limit
 * e chama atencao. O worker so faz retry no que e' de fato transitorio.
 */

export type ErrorClass =
  /** Tenta de novo com backoff curto. */
  | "retryable"
  /** Cota de publicacao da conta estourada: espera a janela de 24h virar. */
  | "quota"
  /** Rate limit da aplicacao ou do usuario: backoff longo. */
  | "rate_limited"
  /** Token invalido/expirado/revogado: a conta precisa reconectar. */
  | "auth"
  /** Nao vai funcionar repetindo: midia invalida, permissao faltando, etc. */
  | "permanent";

export class MetaApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  readonly fbTraceId: string | null;
  readonly httpStatus: number;
  readonly classification: ErrorClass;
  readonly raw: unknown;

  constructor(args: {
    message: string;
    code?: number | null;
    subcode?: number | null;
    type?: string | null;
    fbTraceId?: string | null;
    httpStatus: number;
    raw?: unknown;
  }) {
    super(args.message);
    this.name = "MetaApiError";
    this.code = args.code ?? null;
    this.subcode = args.subcode ?? null;
    this.type = args.type ?? null;
    this.fbTraceId = args.fbTraceId ?? null;
    this.httpStatus = args.httpStatus;
    this.raw = args.raw;
    this.classification = classifyMetaError(this.code, this.subcode, args.message, args.httpStatus);
  }

  get isRetryable(): boolean {
    return this.classification !== "permanent" && this.classification !== "auth";
  }
}

/** Subcodes de token que exigem reconectar a conta. */
const AUTH_SUBCODES = new Set([
  458, // app nao autorizado pelo usuario
  459, // usuario em checkpoint
  460, // senha trocada / sessao invalida
  463, // token expirado
  464, // usuario nao confirmado
  467, // token invalido
  492, // usuario nao e' admin da pagina
]);

/** Codigos de limite de requisicao (nao de conteudo). */
const RATE_LIMIT_CODES = new Set([
  4, // limite da aplicacao
  17, // limite do usuario
  32, // limite da pagina
  80004, // limite de chamadas do Instagram
  613, // limite de chamadas customizado
]);

/**
 * Familia 2207xxx: erros de criacao/upload de container de midia do Instagram.
 * Alguns sao transitorios (a Meta nao conseguiu baixar a midia agora), outros
 * sao definitivos (formato/aspect ratio invalido).
 */
const TRANSIENT_CONTAINER_CODES = new Set([
  2207003, // timeout ao baixar a midia da URL
  2207020, // falha ao buscar a midia
  2207032, // falha na criacao do container
  2207052, // erro desconhecido no upload
  2207053, // erro desconhecido
]);

const PERMANENT_CONTAINER_CODES = new Set([
  2207004, // imagem grande demais
  2207005, // formato de imagem invalido
  2207006, // formato de midia nao suportado
  2207008, // falha ao processar
  2207009, // aspect ratio da imagem invalido
  2207010, // legenda longa demais
  2207023, // formato de midia desconhecido
  2207026, // formato de video nao suportado
  2207035, // carrossel precisa de 2 a 10 itens
  2207036, // carrossel nao pode misturar tipos invalidos
  2207050, // conta restrita
  2207057, // duracao/aspect ratio do video fora do permitido
]);

export function classifyMetaError(
  code: number | null,
  subcode: number | null,
  message: string,
  httpStatus: number,
): ErrorClass {
  const msg = (message || "").toLowerCase();

  // Token / permissao do usuario
  if (code === 190 || code === 102 || code === 463 || (subcode && AUTH_SUBCODES.has(subcode))) {
    return "auth";
  }

  // Cota de publicacao de conteudo (25/50/100 posts por 24h, conforme a conta)
  if (code === 9) return "quota";
  if (msg.includes("publishing limit") || msg.includes("limit reached")) return "quota";

  if (code !== null && RATE_LIMIT_CODES.has(code)) return "rate_limited";
  if (httpStatus === 429) return "rate_limited";

  if (code !== null && PERMANENT_CONTAINER_CODES.has(code)) return "permanent";
  if (code !== null && TRANSIENT_CONTAINER_CODES.has(code)) return "retryable";

  // Permissoes faltando no app / escopo
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return "permanent";

  // Erros temporarios genericos da plataforma
  if (code === 1 || code === 2) return "retryable";
  if (httpStatus >= 500) return "retryable";

  // Erro de validacao nosso (400 sem codigo conhecido): nao insista.
  if (httpStatus >= 400 && httpStatus < 500) return "permanent";

  return "retryable";
}

/** Backoff sugerido, em milissegundos, por classe de erro e tentativa. */
export function backoffMs(classification: ErrorClass, attempt: number): number {
  const minute = 60_000;
  switch (classification) {
    case "quota":
      // A janela e' deslizante de 24h; checa de hora em hora.
      return 60 * minute;
    case "rate_limited":
      return Math.min(60 * minute, 5 * minute * 2 ** Math.max(0, attempt - 1));
    case "retryable":
      return Math.min(30 * minute, 30_000 * 2 ** Math.max(0, attempt - 1));
    default:
      return 0;
  }
}
