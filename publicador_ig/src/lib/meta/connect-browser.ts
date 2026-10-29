import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveProxyForAccount } from "@/lib/proxy-session";

const PYTHON = process.env.IG_DL_PYTHON || "python3";
const CONNECT_SCRIPT =
  process.env.IG_CONNECT_SCRIPT || path.join(process.cwd(), "vendor/ig-story/conectar.py");
const ACCEPT_SCRIPT =
  process.env.IG_ACCEPT_SCRIPT || path.join(process.cwd(), "vendor/ig-story/aceitar_convite.py");
const RUN_TIMEOUT_MS = Number(process.env.IG_CONNECT_TIMEOUT_MS ?? 4 * 60 * 1000);

export class ConnectBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectBrowserError";
  }
}

export type ConnectBrowserOutcome = "GOT_CODE" | "FAILED" | "SKIPPED_2FA";

export interface ConnectBrowserResult {
  outcome: ConnectBrowserOutcome;
  code: string | null;
  message: string;
  stdout: string;
  stderr: string;
}

export interface ConnectBrowserInput {
  username: string;
  /** Combo completo: Login:Pass|UserAgent|TechData|Cookie (precisa do sessionid). */
  combo: string;
  /** URL de autorização do OAuth, já com o state do workspace. */
  oauthUrl: string;
  /** Começo do redirect_uri, para o script capturar o ?code=. */
  redirectPrefix: string;
  proxy?: string | null;
}

/**
 * Abre o OAuth no navegador do servidor (logado pelo cookie da conta), clica até
 * o "Permitir" e captura o `code`. Uma conta por run. O token em si é trocado
 * depois pela finalizeConnection, com o code devolvido aqui.
 */
export async function connectAccountBrowser(input: ConnectBrowserInput): Promise<ConnectBrowserResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `igconnect-${crypto.randomBytes(6).toString("hex")}-`));
  const connectScript = path.join(dir, "conectar.py");
  const acceptScript = path.join(dir, "aceitar_convite.py");
  try {
    // conectar.py importa aceitar_convite.py da mesma pasta: copio os dois.
    await fs.copyFile(CONNECT_SCRIPT, connectScript);
    await fs.copyFile(ACCEPT_SCRIPT, acceptScript);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new ConnectBrowserError(
      "Motor de conectar (conectar.py) não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  const username = input.username.replace(/^@/, "");
  try {
    const cookiesDir = path.join(dir, "cookies");
    await fs.mkdir(cookiesDir, { recursive: true });
    await fs.writeFile(path.join(cookiesDir, `${username}.txt`), input.combo.trim() + "\n", { mode: 0o600 });
    await fs.writeFile(path.join(dir, "oauth_url.txt"), input.oauthUrl.trim(), "utf8");
    await fs.writeFile(path.join(dir, "redirect_prefix.txt"), input.redirectPrefix.trim(), "utf8");

    // Um IP por conta: {session} na proxy vira um id fixo desta conta (sticky).
    const proxyConta = resolveProxyForAccount(input.proxy, username);
    if (proxyConta) {
      await fs.writeFile(path.join(dir, "proxy.txt"), proxyConta, { mode: 0o600 });
    }

    const { stdout, stderr } = await executar([connectScript], dir);
    return interpretar(username, stdout, stderr);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Lê a saída (✔ CODE=.../⏭/✘). */
function interpretar(username: string, stdout: string, stderr: string): ConnectBrowserResult {
  const out = stdout + "\n" + stderr;
  const linhas = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const resumo = linhas.find((l) => /^[✔✘⏭]/.test(l)) ?? "";

  const mCode = resumo.match(/CODE=([^\s]+)/);
  if (resumo.startsWith("✔") && mCode) {
    return { outcome: "GOT_CODE", code: mCode[1], message: "Autorizado.", stdout, stderr };
  }
  if (resumo.startsWith("⏭") || /2fa|verifica/i.test(out)) {
    return {
      outcome: "SKIPPED_2FA",
      code: null,
      message: "Conta pediu 2FA/verificação. Resolva no app e tente de novo.",
      stdout,
      stderr,
    };
  }
  const msg = resumo.replace(/^✘\s*/, "").replace(new RegExp(`^${username}:?\\s*`, "i"), "");
  return {
    outcome: "FAILED",
    code: null,
    message: msg.slice(0, 400) || "Não foi possível conectar a conta.",
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
        reject(new ConnectBrowserError("Python não encontrado no servidor (IG_DL_PYTHON)."));
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
