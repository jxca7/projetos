import "dotenv/config";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeUrl,
  parseSignedRequest,
  scopesFor,
  signState,
  verifyState,
  redirectUri,
  deauthorizeUrl,
  dataDeletionUrl,
  INSTAGRAM_LOGIN_SCOPES,
  FACEBOOK_LOGIN_SCOPES,
} from "@/lib/meta/oauth";
import type { MetaCredentials } from "@/lib/meta/types";

const SECRET = "f".repeat(32);

function creds(flow: "INSTAGRAM_LOGIN" | "FACEBOOK_LOGIN"): MetaCredentials {
  return {
    metaAppId: "app1",
    loginFlow: flow,
    appId: "1447375873390135",
    appSecret: SECRET,
    graphVersion: "v23.0",
    source: "db",
  };
}

function assinar(payload: object, secret = SECRET): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${sig}.${b64}`;
}

test("Instagram Login vai para o diálogo do Instagram, não do Facebook", () => {
  const url = new URL(authorizeUrl("estado", creds("INSTAGRAM_LOGIN")));
  assert.equal(url.host, "www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "1447375873390135");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("Facebook Login vai para o diálogo do Facebook, com a versão da Graph", () => {
  const url = new URL(authorizeUrl("estado", creds("FACEBOOK_LOGIN")));
  assert.equal(url.host, "www.facebook.com");
  assert.ok(url.pathname.startsWith("/v23.0/dialog/oauth"));
});

test("as permissões são diferentes por fluxo e não podem ser misturadas", () => {
  const ig = scopesFor("INSTAGRAM_LOGIN");
  const fb = scopesFor("FACEBOOK_LOGIN");

  assert.deepEqual([...ig], [...INSTAGRAM_LOGIN_SCOPES]);
  assert.deepEqual([...fb], [...FACEBOOK_LOGIN_SCOPES]);

  // Os nomes antigos foram descontinuados no fluxo do Instagram em jan/2025.
  assert.ok(ig.every((s) => s.startsWith("instagram_business_")));
  assert.ok(!ig.includes("instagram_basic"));
  assert.ok(fb.includes("instagram_content_publish"));
  assert.ok(!fb.some((s) => s.startsWith("instagram_business_")));
});

test("a redirect_uri não tem barra no final, que é o que gera Invalid redirect_uri", () => {
  for (const url of [redirectUri(), deauthorizeUrl(), dataDeletionUrl()]) {
    assert.ok(!url.endsWith("/"), `${url} não pode terminar com barra`);
    assert.ok(url.startsWith("http"), `${url} precisa do protocolo`);
  }
  assert.notEqual(redirectUri(), deauthorizeUrl());
  assert.notEqual(deauthorizeUrl(), dataDeletionUrl());
});

test("state assinado detecta adulteração", () => {
  const state = signState("workspace123:nonce");
  assert.equal(verifyState(state), "workspace123:nonce");

  assert.equal(verifyState("workspace456:nonce.assinaturafalsa"), null);
  assert.equal(verifyState("sem-ponto"), null);
  // Trocar o payload mantendo a assinatura não passa.
  const [payload, mac] = [state.slice(0, state.lastIndexOf(".")), state.slice(state.lastIndexOf(".") + 1)];
  assert.equal(verifyState(`${payload}X.${mac}`), null);
});

test("signed_request só é aceito com o secret certo", () => {
  const assinado = assinar({ user_id: "17841400000000000", algorithm: "HMAC-SHA256" });

  const ok = parseSignedRequest(assinado, SECRET);
  assert.equal(ok?.user_id, "17841400000000000");

  // É assim que o callback descobre qual app enviou: só o secret certo valida.
  assert.equal(parseSignedRequest(assinado, "0".repeat(32)), null);
});

test("signed_request com payload trocado é recusado", () => {
  const assinado = assinar({ user_id: "111" });
  const [sig] = assinado.split(".");
  const outroPayload = Buffer.from(JSON.stringify({ user_id: "999" })).toString("base64url");

  assert.equal(
    parseSignedRequest(`${sig}.${outroPayload}`, SECRET),
    null,
    "trocar o payload mantendo a assinatura não pode passar",
  );
  assert.equal(parseSignedRequest("lixo", SECRET), null);
  assert.equal(parseSignedRequest("", SECRET), null);
});
