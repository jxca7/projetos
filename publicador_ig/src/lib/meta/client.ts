import { appSecretProof } from "../crypto";
import { MetaApiError } from "./errors";
import type { MetaCredentials } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const err = (body as GraphErrorBody)?.error;
    throw new MetaApiError({
      message: err?.message || `Graph API respondeu ${res.status}`,
      code: err?.code ?? null,
      subcode: err?.error_subcode ?? null,
      type: err?.type ?? null,
      fbTraceId: err?.fbtrace_id ?? null,
      httpStatus: res.status,
      raw: body,
    });
  }
  return body as T;
}

/**
 * Cliente da Graph API preso a um app.
 *
 * As credenciais são injetadas em vez de lidas do ambiente: o appsecret_proof
 * é um HMAC do secret do app que emitiu o token, então usar o secret de outro
 * app faz toda chamada falhar com erro de assinatura.
 */
export class GraphClient {
  constructor(private readonly creds: MetaCredentials) {}

  private baseUrl(): string {
    return `https://graph.facebook.com/${this.creds.graphVersion}`;
  }

  private withProof(params: Record<string, string>, accessToken: string): Record<string, string> {
    // A troca do `code` do OAuth é a única chamada sem access token.
    if (!accessToken) return { ...params };
    const out: Record<string, string> = { ...params, access_token: accessToken };
    // Exigido quando "Require App Secret" está ligado no app. Mandar sempre é
    // inofensivo e evita um 400 difícil de diagnosticar depois.
    if (this.creds.appSecret) {
      out.appsecret_proof = appSecretProof(accessToken, this.creds.appSecret);
    }
    return out;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    accessToken: string,
    params: Record<string, string | number | boolean | undefined> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") clean[k] = String(v);
    }
    const full = this.withProof(clean, accessToken);

    const url = new URL(`${this.baseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (method === "GET") {
        for (const [k, v] of Object.entries(full)) url.searchParams.set(k, v);
        const res = await fetch(url, { method: "GET", signal: controller.signal });
        return await parseResponse<T>(res);
      }
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams(full),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
      });
      return await parseResponse<T>(res);
    } catch (e) {
      if (e instanceof MetaApiError) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new MetaApiError({
          message: `Timeout de ${timeoutMs}ms chamando ${path}`,
          httpStatus: 504,
          code: 1,
        });
      }
      throw new MetaApiError({
        message: e instanceof Error ? e.message : "Falha de rede na Graph API",
        httpStatus: 503,
        code: 1,
        raw: e,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(
    path: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ) {
    return this.request<T>("GET", path, accessToken, params, timeoutMs);
  }

  post<T>(
    path: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ) {
    return this.request<T>("POST", path, accessToken, params, timeoutMs);
  }
}
