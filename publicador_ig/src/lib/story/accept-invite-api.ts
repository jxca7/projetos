import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveProxyForAccount } from "@/lib/proxy-session";

const PYTHON = process.env.IG_DL_PYTHON || "python3";
const API_SCRIPT =
  process.env.IG_ACCEPT_API_SCRIPT || path.join(process.cwd(), "vendor/ig-story/aceitar_convite_api.py");
const PREP_SCRIPT = process.env.IG_PREPARE_SCRIPT || path.join(process.cwd(), "vendor/ig-story/preparar.py");
const STORY_SCRIPT = process.env.IG_STORY_SCRIPT || path.join(process.cwd(), "vendor/ig-story/postar_story.py");
const RUN_TIMEOUT_MS = Number(process.env.IG_ACCEPT_API_TIMEOUT_MS ?? 3 * 60 * 1000);

export class AcceptApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptApiError";
  }
}

export type AcceptApiOutcome = "DONE" | "FAILED" | "SKIPPED_2FA";

export interface AcceptApiResult {
  outcome: AcceptApiOutcome;
  message: string;
  /** Sessão do instagrapi após o run (JSON), para persistir e reusar. null se não gerou. */
  sessionOut: string | null;
  stdout: string;
  stderr: string;
}

export interface AcceptApiInput {
  username: string;
  password: string;
  /** Combo completo (cookie-first). Igual ao Story. */
  combo?: string | null;
  /** ID do app na Meta (só dígitos). */
  appId: string;
  proxy?: string | null;
  sessionIn?: string | null;
}

/** Aceita o convite do testador numa conta, pelo instagrapi (sem navegador). TESTE. */
export async function acceptInviteApi(input: AcceptApiInput): Promise<AcceptApiResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `iginviteapi-${crypto.randomBytes(6).toString("hex")}-`));
  const apiScript = path.join(dir, "aceitar_convite_api.py");
  const prepScript = path.join(dir, "preparar.py");
  const storyScript = path.join(dir, "postar_story.py");
  try {
    // aceitar_convite_api.py importa preparar.py e postar_story.py da mesma pasta.
    await fs.copyFile(API_SCRIPT, apiScript);
    await fs.copyFile(PREP_SCRIPT, prepScript);
    await fs.copyFile(STORY_SCRIPT, storyScript);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new AcceptApiError(
      "Motor de aceitar convite (API) não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  const username = input.username.replace(/^@/, "");
  const combo = input.combo?.trim();
  const cookieMode = Boolean(combo);

  await fs.writeFile(path.join(dir, "app_id.txt"), input.appId.trim(), "utf8");
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
    const { stdout, stderr } = await executar([apiScript], dir);
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
function interpretar(username: string, stdout: string, stderr: string): Omit<AcceptApiResult, "sessionOut"> {
  const out = stdout + "\n" + stderr;
  const linhas = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const resumo = linhas.find((l) => /^[✔✘⏭]/.test(l));

  if (resumo?.startsWith("✔")) {
    return {
      outcome: "DONE",
      message: resumo.replace(/^✔\s*/, "").replace(new RegExp(`^${username}:?\\s*`, "i"), "") || "Convite aceito.",
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
    message: msg.slice(0, 400) || "Não foi possível aceitar o convite.",
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
        reject(new AcceptApiError("Python não encontrado no servidor (IG_DL_PYTHON)."));
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
