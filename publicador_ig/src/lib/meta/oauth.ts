import crypto from "node:crypto";
import { env } from "../env";
import type { LoginFlowName, MetaCredentials } from "./types";

/**
 * Permissões do fluxo "Instagram API with Instagram Login".
 *
 * Os nomes antigos (`instagram_basic`, `instagram_content_publish`) foram
 * descontinuados neste fluxo em janeiro de 2025 — app que ainda manda os
 * antigos não consegue chamar os endpoints.
 */
export const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const;

/** Permissões do fluxo clássico, via Página do Facebook. */
export const FACEBOOK_LOGIN_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
] as const;

export function scopesFor(flow: LoginFlowName): readonly string[] {
  return flow === "INSTAGRAM_LOGIN" ? INSTAGRAM_LOGIN_SCOPES : FACEBOOK_LOGIN_SCOPES;
}

function appBase(): string {
  return env().APP_URL.replace(/\/$/, "");
}

/**
 * URL de retorno do OAuth.
 *
 * Tem que ser idêntica à cadastrada no app, incluindo o protocolo e sem barra
 * no final — a Meta compara string com string e responde "Invalid redirect_uri"
 * em qualquer diferença.
 */
export function redirectUri(): string {
  return `${appBase()}/api/meta/callback`;
}

/** Chamada pela Meta quando alguém remove o app. */
export function deauthorizeUrl(): string {
  return `${appBase()}/api/meta/deauthorize`;
}

/** Chamada pela Meta quando alguém pede exclusão dos dados. */
export function dataDeletionUrl(): string {
  return `${appBase()}/api/meta/data-deletion`;
}

/** Assina o state do OAuth para detectar CSRF na volta. */
export function signState(payload: string): string {
  const mac = crypto.createHmac("sha256", env().AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyState(state: string): string | null {
  const idx = state.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = state.slice(0, idx);
  const expected = signState(payload);
  const a = Buffer.from(state);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

export function authorizeUrl(state: string, creds: MetaCredentials): string {
  if (creds.loginFlow === "INSTAGRAM_LOGIN") {
    // Business Login for Instagram: o diálogo é do próprio Instagram e o
    // client_id é o Instagram App ID, não o App ID do Facebook.
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", creds.appId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_LOGIN_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  const url = new URL(`https://www.facebook.com/${creds.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", creds.appId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", FACEBOOK_LOGIN_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/**
 * Valida o `signed_request` que a Meta envia nos callbacks de desautorização e
 * exclusão de dados. É um HMAC-SHA256 do payload com o App Secret.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): Record<string, unknown> | null {
  const [sigB64, payloadB64] = signedRequest.split(".", 2);
  if (!sigB64 || !payloadB64) return null;

  const expected = crypto.createHmac("sha256", appSecret).update(payloadB64).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
