import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveProxyForAccount } from "@/lib/proxy-session";

const PYTHON = process.env.IG_DL_PYTHON || "python3";
const PREP_SCRIPT = process.env.IG_PREPARE_SCRIPT || path.join(process.cwd(), "vendor/ig-story/preparar.py");
const STORY_SCRIPT = process.env.IG_STORY_SCRIPT || path.join(process.cwd(), "vendor/ig-story/postar_story.py");
const RUN_TIMEOUT_MS = Number(process.env.IG_PREPARE_TIMEOUT_MS ?? 5 * 60 * 1000);

export class PrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrepareError";
  }
}

export type PrepareOutcome = "DONE" | "FAILED" | "SKIPPED_2FA";

export interface PrepareResult {
  outcome: PrepareOutcome;
  message: string;
  sessionOut: string | null;
  stdout: string;
  stderr: string;
}

export interface PrepareInput {
  username: string;
  password: string;
  /** Combo completo (cookie-first). Igual ao Story. */
  combo?: string | null;
  /** Bytes da foto de perfil. Opcional. */
  imageBytes?: Buffer | null;
  /** Nova bio. Opcional. (Ao menos foto, bio ou story tem de vir.) */
  bio?: string | null;
  /** Story postado na mesma sessão, depois da foto/bio. Opcional. */
  storyBytes?: Buffer | null;
  storyLink?: string | null;
  /** Texto que aparece na figurinha de link. */
  storyLinkLabel?: string | null;
  /** Nome do destaque (cria se não existir). Vazio = não destaca. */
  storyHighlight?: string | null;
  proxy?: string | null;
  sessionIn?: string | null;
}

/** Prepara UMA conta (foto, bio e/ou story) numa sessão só. Reusa o motor/sessão do Story. */
export async function prepareAccount(input: PrepareInput): Promise<PrepareResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `igprep-${crypto.randomBytes(6).toString("hex")}-`));
  const prepScript = path.join(dir, "preparar.py");
  const storyScript = path.join(dir, "postar_story.py");
  try {
    // preparar.py importa o postar_story.py da mesma pasta: copio os dois.
    await fs.copyFile(PREP_SCRIPT, prepScript);
    await fs.copyFile(STORY_SCRIPT, storyScript);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new PrepareError(
      "Motor de preparar conta não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  const username = input.username.replace(/^@/, "");
  const combo = input.combo?.trim();
  const cookieMode = Boolean(combo);

  if (input.imageBytes && input.imageBytes.length > 0) {
    await fs.writeFile(path.join(dir, "foto.jpg"), input.imageBytes);
  }
  await fs.writeFile(path.join(dir, "bio.txt"), input.bio?.trim() ?? "", "utf8");
  if (input.storyBytes && input.storyBytes.length > 0) {
    await fs.writeFile(path.join(dir, "story.jpg"), input.storyBytes);
    await fs.writeFile(
      path.join(dir, "link.txt"),
      [input.storyLink?.trim() ?? "", input.storyLinkLabel?.trim() ?? ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(dir, "destaque.txt"), input.storyHighlight?.trim() ?? "", "utf8");
  }
  const proxyConta = resolveProxyForAccount(input.proxy, username);
  if (proxyConta) {
    await fs.writeFile(path.join(dir, "proxy.txt"), proxyConta, { mode: 0o600 });
  }

  if (cookieMode) {
    const cookiesDir = path.join(dir, "cookies");
    await fs.mkdir(cookiesDir, { recursive: true });
    await fs.writeFile(path.join(cookiesDir, `${username}.txt`), combo + "\n", { mode: 0o600 });
  } else {
    await fs.writeFile(path.join(dir, "contas.txt"), `${username}:${input.password}\n`, { mode: 0o600 });
  }

  const sessoesDir = path.join(dir, "sessoes");
  await fs.mkdir(sessoesDir, { recursive: true });
  const sessaoCookie = path.join(sessoesDir, `${username}.json`);
  const sessaoSenha = path.join(sessoesDir, `senha_${username}.json`);
  if (input.sessionIn?.trim()) {
    await fs.writeFile(cookieMode ? sessaoCookie : sessaoSenha, input.sessionIn, { mode: 0o600 });
  }

  try {
    const { stdout, stderr } = await executar([prepScript], dir);
    const base = interpretar(username, stdout, stderr);
    let sessionOut: string | null = null;
    for (const p of [sessaoCookie, sessaoSenha]) {
      try {
        sessionOut = await fs.readFile(p, "utf8");
        break;
      } catch {
        /* não existe */
      }
    }
    return { ...base, sessionOut };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Lê a saída (✔/⏭/✘) e decide o desfecho. */
function interpretar(username: string, stdout: string, stderr: string): Omit<PrepareResult, "sessionOut"> {
  const out = stdout + "\n" + stderr;
  const linhas = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const resumo = linhas.find((l) => /^[✔✘⏭]/.test(l));

  if (resumo?.startsWith("✔")) {
    const message = resumo.replace(/^✔\s*/, "").replace(new RegExp(`^${username}:?\\s*`, "i"), "") || "Pronto.";
    // Parcial (ex.: "foto, bio ok; problema em story: ..."): marca como falha para aparecer na lista.
    return {
      outcome: message.includes("; problema em") ? "FAILED" : "DONE",
      message,
      stdout,
      stderr,
    };
  }
  if (resumo?.startsWith("⏭") || /2fa|verifica|checkpoint|challenge/i.test(out)) {
    return {
      outcome: "SKIPPED_2FA",
      message: "Conta pediu 2FA/verificação. Resolva no app e tente de novo.",
      stdout,
      stderr,
    };
  }
  const msg = (resumo ?? linhas[linhas.length - 1] ?? "")
    .replace(/^✘\s*/, "")
    .replace(new RegExp(`^${username}:?\\s*`, "i"), "");
  return {
    outcome: "FAILED",
    message: msg.slice(0, 400) || "Não foi possível preparar a conta.",
    stdout,
    stderr,
  };
}

function executar(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
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
        reject(new PrepareError("Python não encontrado no servidor (IG_DL_PYTHON)."));
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
