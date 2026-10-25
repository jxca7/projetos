import crypto from "node:crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(env().APP_ENCRYPTION_KEY, "hex");
}

/**
 * Cifra um segredo (access token da Meta) para guardar no banco.
 * Formato: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Formato de segredo cifrado invalido");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    key(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Assinatura appsecret_proof exigida pela Meta quando ativada no app. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
}
