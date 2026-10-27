import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PYTHON = process.env.IG_DL_PYTHON || "python3";
const SCRIPT = process.env.IG_ACCEPT_SCRIPT || path.join(process.cwd(), "vendor/ig-story/aceitar_convite.py");
const RUN_TIMEOUT_MS = Number(process.env.IG_ACCEPT_TIMEOUT_MS ?? 3 * 60 * 1000);

export class AcceptInviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptInviteError";
  }
}

export type AcceptOutcome = "DONE" | "FAILED" | "SKIPPED_2FA";

export interface AcceptResult {
  outcome: AcceptOutcome;
  message: string;
  stdout: string;
  stderr: string;
}

export interface AcceptInput {
  username: string;
  /** Combo completo: precisa do cookie (sessionid) para entrar no navegador. */
  combo: string;
  proxy?: string | null;
}

/** Aceita o convite do testador numa conta, via navegador headless no servidor. */
export async function acceptInvite(input: AcceptInput): Promise<AcceptResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `iginvite-${crypto.randomBytes(6).toString("hex")}-`));
  const script = path.join(dir, "aceitar_convite.py");
  try {
    await fs.copyFile(SCRIPT, script);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new AcceptInviteError(
      "Motor de aceitar convite não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  const username = input.username.replace(/^@/, "");
  const cookiesDir = path.join(dir, "cookies");
  await fs.mkdir(cookiesDir, { recursive: true });
  await fs.writeFile(path.join(cookiesDir, `${username}.txt`), input.combo.trim() + "\n", { mode: 0o600 });
  if (input.proxy?.trim()) {
    await fs.writeFile(path.join(dir, "proxy.txt"), input.proxy.trim(), { mode: 0o600 });
  }

  try {
    const { stdout, stderr } = await executar([script], dir);
    return interpretar(username, stdout, stderr);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function interpretar(username: string, stdout: string, stderr: string): AcceptResult {
  const out = stdout + "\n" + stderr;
  const linha = out.split("\n").map((l) => l.trim()).find((l) => /^[✔✘⏭]/.test(l)) ?? "";
  const limpa = linha.replace(/^[✔✘⏭]\s*/, "").replace(new RegExp(`^${username}:?\\s*`, "i"), "");
  if (linha.startsWith("✔")) {
    return { outcome: "DONE", message: limpa || "Convite aceito.", stdout, stderr };
  }
  if (linha.startsWith("⏭")) {
    return { outcome: "DONE", message: limpa || "Nada pendente.", stdout, stderr };
  }
  return {
    outcome: "FAILED",
    message: limpa.slice(0, 400) || "Não foi possível aceitar o convite.",
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
        reject(new AcceptInviteError("Python não encontrado no servidor (IG_DL_PYTHON)."));
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
