import { env } from "../env";
import { appSecretProof } from "../crypto";
import { MetaApiError } from "./errors";

const DEFAULT_TIMEOUT_MS = 30_000;

function baseUrl(): string {
  return `https://graph.facebook.com/${env().META_GRAPH_VERSION}`;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function withProof(params: Record<string, string>, accessToken: string): Record<string, string> {
  const secret = env().META_APP_SECRET;
  // A troca do `code` do OAuth é a única chamada sem access token.
  if (!accessToken) return { ...params };
  const out: Record<string, string> = { ...params, access_token: accessToken };
  // Exigido quando "Require App Secret" esta ligado no app. Mandar sempre é
  // inofensivo e evita um 400 difícil de diagnosticar depois.
  if (secret) out.appsecret_proof = appSecretProof(accessToken, secret);
  return out;
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

async function request<T>(
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
  const full = withProof(clean, accessToken);

  const url = new URL(`${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
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

export const graph = {
  get: <T>(
    path: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ) => request<T>("GET", path, accessToken, params, timeoutMs),
  post: <T>(
    path: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined>,
    timeoutMs?: number,
  ) => request<T>("POST", path, accessToken, params, timeoutMs),
  baseUrl,
};
