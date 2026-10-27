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
  /** Sessão do instagrapi após o run (JSON), para persistir e reusar. null se não gerou. */
  sessionOut: string | null;
  stdout: string;
  stderr: string;
}

export interface StoryInput {
  username: string;
  password: string;
  /**
   * Linha de combo completa: `usuario:senha | useragent | techdata | cookie`.
   * Quando presente, o login entra pelo COOKIE (sem 2FA), com a identidade do
   * aparelho (useragent/techdata). A senha fica de reserva.
   */
  combo?: string | null;
  imageBytes: Buffer;
  link?: string | null;
  /** Texto que aparece na figurinha de link. */
  linkLabel?: string | null;
  /** Nome do destaque (cria se não existir). Vazio = não destaca. */
  highlight?: string | null;
  /** Proxy opcional: host:porta, host:porta:usuario:senha ou http://user:senha@host:porta */
  proxy?: string | null;
  /** Sessão salva do instagrapi desta conta (JSON), para reusar e evitar 2FA. */
  sessionIn?: string | null;
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

  const username = input.username.replace(/^@/, "");
  const combo = input.combo?.trim();
  const cookieMode = Boolean(combo);

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

  // Modo COOKIE (combo): a linha inteira vira um arquivo em cookies/<usuario>.txt —
  // o script entra pelo cookie e usa o usuario:senha de dentro dela como reserva.
  // Modo SENHA: só usuario:senha em contas.txt.
  if (cookieMode) {
    const cookiesDir = path.join(dir, "cookies");
    await fs.mkdir(cookiesDir, { recursive: true });
    await fs.writeFile(path.join(cookiesDir, `${username}.txt`), combo + "\n", { mode: 0o600 });
  } else {
    await fs.writeFile(path.join(dir, "contas.txt"), `${username}:${input.password}\n`, { mode: 0o600 });
  }

  // Sessão persistida: restaura antes do run (evita logar de novo → sem 2FA).
  const sessoesDir = path.join(dir, "sessoes");
  await fs.mkdir(sessoesDir, { recursive: true });
  const sessaoCookie = path.join(sessoesDir, `${username}.json`);
  const sessaoSenha = path.join(sessoesDir, `senha_${username}.json`);
  if (input.sessionIn?.trim()) {
    await fs.writeFile(cookieMode ? sessaoCookie : sessaoSenha, input.sessionIn, { mode: 0o600 });
  }

  try {
    const { stdout, stderr } = await executar([script], dir);
    const base = interpretar(input.username, stdout, stderr);
    // Lê a sessão que o run deixou (cookie ou senha), para persistir.
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

/** Lê a saída do script e decide o desfecho da conta (sem a sessão, que o chamador anexa). */
function interpretar(username: string, stdout: string, stderr: string): Omit<StoryResult, "sessionOut"> {
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
