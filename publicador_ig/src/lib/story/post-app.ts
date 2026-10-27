import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PYTHON = process.env.IG_DL_PYTHON || "python3";
const SCRIPT = process.env.IG_STORY_SCRIPT || path.join(process.cwd(), "vendor/ig-story/postar_story.py");
const RUN_TIMEOUT_MS = Number(process.env.IG_STORY_TIMEOUT_MS ?? 5 * 60 * 1000);

export class StoryPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryPostError";
  }
}

export type StoryOutcome = "DONE" | "FAILED" | "SKIPPED_2FA";

export interface StoryResult {
  outcome: StoryOutcome;
  igStoryId: string | null;
  message: string;
  stdout: string;
  stderr: string;
}

export interface StoryInput {
  username: string;
  password: string;
  imageBytes: Buffer;
  link?: string | null;
  /** Texto que aparece na figurinha de link. */
  linkLabel?: string | null;
  /** Nome do destaque (cria se não existir). Vazio = não destaca. */
  highlight?: string | null;
  /** Proxy opcional: host:porta, host:porta:usuario:senha ou http://user:senha@host:porta */
  proxy?: string | null;
}

/**
 * Posta UM story numa conta, pelo motor vendorizado (instagrapi). Monta uma
 * pasta temporária com os arquivos que o script espera (story.jpg, link.txt,
 * destaque.txt, contas.txt com uma conta) e roda. Lê o resultado da saída.
 */
export async function postStoryApp(input: StoryInput): Promise<StoryResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `igstory-${crypto.randomBytes(6).toString("hex")}-`));
  const script = path.join(dir, "postar_story.py");
  try {
    await fs.copyFile(SCRIPT, script);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new StoryPostError(
      "Motor da story (postar_story.py) não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  // Arquivos que o script lê da própria pasta.
  await fs.writeFile(path.join(dir, "story.jpg"), input.imageBytes);
  await fs.writeFile(
    path.join(dir, "link.txt"),
    [input.link?.trim() ?? "", input.linkLabel?.trim() ?? ""].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(dir, "destaque.txt"), input.highlight?.trim() ?? "", "utf8");
  // O script lê proxy.txt da própria pasta (host:porta, host:porta:user:senha ou URL).
  if (input.proxy?.trim()) {
    await fs.writeFile(path.join(dir, "proxy.txt"), input.proxy.trim(), { mode: 0o600 });
  }
  // Uma conta por run: usuário:senha. mode 0600.
  await fs.writeFile(
    path.join(dir, "contas.txt"),
    `${input.username.replace(/^@/, "")}:${input.password}\n`,
    { mode: 0o600 },
  );

  try {
    const { stdout, stderr } = await executar([script], dir);
    return interpretar(input.username, stdout, stderr);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Lê a saída do script e decide o desfecho da conta. */
function interpretar(username: string, stdout: string, stderr: string): StoryResult {
  const out = stdout + "\n" + stderr;
  const idMatch = out.match(/id\s+(\d{3,})/i);
  const igStoryId = idMatch ? idMatch[1] : null;

  // Linha do RESUMO para esta conta (✔ / ✘ / ⏭), ou os marcadores soltos.
  const resumo = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[✔✘⏭]/.test(l));

  const texto = out.toLowerCase();
  const pediu2fa =
    resumo.some((l) => l.startsWith("⏭")) ||
    /2fa|verifica|checkpoint|challenge|two[-_ ]?factor/.test(texto);

  const sucesso = resumo.some((l) => l.startsWith("✔")) || /story postado/.test(texto);

  if (sucesso) {
    const avisoDestaque = /não consegui destacar|nao consegui destacar/.test(texto);
    const avisoLink = /não devolveu a figurinha|nao devolveu a figurinha/.test(texto);
    const avisos = [
      avisoLink ? "a figurinha de link pode não ter aparecido" : "",
      avisoDestaque ? "o destaque falhou" : "",
    ].filter(Boolean);
    return {
      outcome: "DONE",
      igStoryId,
      message: avisos.length ? `Story postado, mas ${avisos.join(" e ")}.` : "Story postado.",
      stdout,
      stderr,
    };
  }

  if (pediu2fa) {
    return {
      outcome: "SKIPPED_2FA",
      igStoryId: null,
      message: "Conta pediu 2FA/verificação. Resolva no app e tente de novo.",
      stdout,
      stderr,
    };
  }

  // Erro: pega a linha ✘ ou a primeira linha com "ERRO".
  const linhaErro =
    resumo.find((l) => l.startsWith("✘")) ??
    out.split("\n").map((l) => l.trim()).find((l) => /erro/i.test(l)) ??
    "";
  const msg = linhaErro.replace(/^✘\s*/, "").replace(new RegExp(`^\\[?${username}\\]?:?\\s*`, "i"), "");
  return {
    outcome: "FAILED",
    igStoryId: null,
    message: msg.slice(0, 400) || "Não foi possível postar (o Instagram recusou a conta).",
    stdout,
    stderr,
  };
}

/** Roda o processo com teto de tempo, sem stdin. */
function executar(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    const cap = 512 * 1024;
    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new StoryPostError("Python não encontrado no servidor (IG_DL_PYTHON)."));
      } else {
        reject(e);
      }
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}
