import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { classifyMetaError, backoffMs, MetaApiError } from "@/lib/meta/errors";
import { encryptSecret, decryptSecret, appSecretProof } from "@/lib/crypto";
import { validateCaption, validateMedia, hasBlockingIssue, CAPTION_MAX_LENGTH } from "@/lib/media/validate";
import { slugify } from "@/lib/utils";

const noProbe = {
  width: null,
  height: null,
  durationMs: null,
  videoCodec: null,
  audioCodec: null,
  hasAudio: false,
};

test("token inválido é classificado como auth, não como retry", () => {
  assert.equal(classifyMetaError(190, null, "Invalid OAuth access token", 400), "auth");
  assert.equal(classifyMetaError(102, null, "Session has expired", 400), "auth");
  assert.equal(classifyMetaError(null, 463, "Token expired", 400), "auth");
});

test("limite de publicação vira classe quota", () => {
  assert.equal(classifyMetaError(9, null, "limit reached", 400), "quota");
  assert.equal(
    classifyMetaError(null, null, "The user has reached the publishing limit", 400),
    "quota",
  );
});

test("rate limit da aplicação e 429 viram rate_limited", () => {
  assert.equal(classifyMetaError(4, null, "Application request limit reached", 400), "rate_limited");
  assert.equal(classifyMetaError(17, null, "User request limit reached", 400), "rate_limited");
  assert.equal(classifyMetaError(null, null, "Too many requests", 429), "rate_limited");
});

test("erro de formato de mídia é permanente; falha de download é transitoria", () => {
  assert.equal(classifyMetaError(2207026, null, "Vídeo format not supported", 400), "permanent");
  assert.equal(classifyMetaError(2207057, null, "Aspect ratio not supported", 400), "permanent");
  assert.equal(classifyMetaError(2207020, null, "Media fetch failed", 400), "retryable");
  assert.equal(classifyMetaError(2207003, null, "Timeout fetching media", 400), "retryable");
});

test("5xx da Meta é transitorio", () => {
  assert.equal(classifyMetaError(null, null, "Internal error", 500), "retryable");
  assert.equal(classifyMetaError(1, null, "Unknown error", 400), "retryable");
});

test("MetaApiError marca o que não vale repetir", () => {
  const auth = new MetaApiError({ message: "Invalid OAuth", code: 190, httpStatus: 400 });
  const transient = new MetaApiError({ message: "fetch failed", code: 2207020, httpStatus: 400 });
  assert.equal(auth.isRetryable, false);
  assert.equal(transient.isRetryable, true);
});

test("backoff cresce e tem teto", () => {
  assert.equal(backoffMs("permanent", 3), 0);
  assert.equal(backoffMs("quota", 1), 60 * 60_000);
  const a = backoffMs("retryable", 1);
  const b = backoffMs("retryable", 3);
  assert.ok(b > a, "backoff deve crescer com a tentativa");
  assert.ok(backoffMs("retryable", 50) <= 30 * 60_000, "backoff tem teto");
  assert.ok(backoffMs("rate_limited", 50) <= 60 * 60_000, "rate limit tem teto");
});

test("cripto dos tokens faz round-trip e detecta adulteracao", () => {
  const token = "EAAG...token-de-pagina-da-meta";
  const enc = encryptSecret(token);
  assert.notEqual(enc, token, "não pode guardar em texto claro");
  assert.equal(decryptSecret(enc), token);

  const parts = enc.split(".");
  // Mexe no ciphertext: GCM tem que rejeitar.
  const tampered = [parts[0], parts[1], parts[2], Buffer.from("outro-valor").toString("base64url")].join(".");
  assert.throws(() => decryptSecret(tampered));
});

test("appsecret_proof é um HMAC estável", () => {
  const a = appSecretProof("token", "segredo");
  const b = appSecretProof("token", "segredo");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, appSecretProof("token", "outro-segredo"));
});

test("legenda respeita limite de caracteres e de hashtags", () => {
  assert.equal(validateCaption("texto curto #um").length, 0);

  const longa = "a".repeat(CAPTION_MAX_LENGTH + 1);
  assert.ok(validateCaption(longa).some((i) => i.level === "error"));

  const muitasTags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
  assert.ok(validateCaption(muitasTags).some((i) => i.level === "error"));

  const muitasMencoes = Array.from({ length: 25 }, (_, i) => `@user${i}`).join(" ");
  const issues = validateCaption(muitasMencoes);
  assert.ok(issues.some((i) => i.level === "warning"));
});

test("reel exige vídeo e recusa duração fora do permitido", () => {
  const imagemComoReel = validateMedia({
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    probe: noProbe,
    usedFor: "REEL",
  });
  assert.ok(hasBlockingIssue(imagemComoReel));

  const curto = validateMedia({
    kind: "VIDEO",
    mimeType: "video/mp4",
    sizeBytes: 1_000_000,
    probe: { ...noProbe, width: 1080, height: 1920, durationMs: 1_500, videoCodec: "h264", audioCodec: "aac", hasAudio: true },
    usedFor: "REEL",
  });
  assert.ok(hasBlockingIssue(curto), "reel de 1.5s deve ser recusado");

  const ok = validateMedia({
    kind: "VIDEO",
    mimeType: "video/mp4",
    sizeBytes: 1_000_000,
    probe: { ...noProbe, width: 1080, height: 1920, durationMs: 8_000, videoCodec: "h264", audioCodec: "aac", hasAudio: true },
    usedFor: "REEL",
  });
  assert.equal(hasBlockingIssue(ok), false);
  assert.equal(ok.length, 0, "9:16 com h264/aac não deve gerar aviso");
});

test("reel fora de 9:16 passa mas avisa sobre corte", () => {
  const quadrado = validateMedia({
    kind: "VIDEO",
    mimeType: "video/mp4",
    sizeBytes: 1_000_000,
    probe: { ...noProbe, width: 1080, height: 1080, durationMs: 8_000, videoCodec: "h264", audioCodec: "aac", hasAudio: true },
    usedFor: "REEL",
  });
  assert.equal(hasBlockingIssue(quadrado), false);
  assert.ok(quadrado.some((i) => i.level === "warning" && i.field === "aspect"));
});

test("imagem de feed recusa proporção fora de 4:5..1.91:1", () => {
  const altaDemais = validateMedia({
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 500_000,
    probe: { ...noProbe, width: 500, height: 1500 },
    usedFor: "IMAGE",
  });
  assert.ok(hasBlockingIssue(altaDemais));
});

test("story recusa vídeo acima de 60s", () => {
  const longo = validateMedia({
    kind: "VIDEO",
    mimeType: "video/mp4",
    sizeBytes: 5_000_000,
    probe: { ...noProbe, width: 1080, height: 1920, durationMs: 75_000 },
    usedFor: "STORY",
  });
  assert.ok(hasBlockingIssue(longo));
});

test("slug tira acento e normaliza", () => {
  // O resultado e' ASCII de proposito: slug com acento quebra URL.
  assert.equal(slugify("Agência do João!"), "agencia-do-joao");
});
