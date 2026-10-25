import crypto from "node:crypto";
import { env } from "../env";

/**
 * Permissões necessarias no app da Meta.
 *
 * Todas exigem App Review. instagram_content_publish é a que efetivamente
 * permite publicar; sem ela o app só le dados.
 */
export const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
] as const;

export function redirectUri(): string {
  return `${env().APP_URL.replace(/\/$/, "")}/api/meta/callback`;
}

/** Assina o state do OAuth para detectar CSRF na volta. */
export function signState(payload: string): string {
  const mac = crypto
    .createHmac("sha256", env().AUTH_SECRET)
    .update(payload)
    .digest("base64url");
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

export function authorizeUrl(state: string): string {
  const e = env();
  const url = new URL(`https://www.facebook.com/${e.META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", e.META_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}
