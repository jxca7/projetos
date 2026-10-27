import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/** Interpretador e script do downloader (vendor/ig-downloader/reels.py). */
const PYTHON = process.env.IG_DL_PYTHON || "python3";
const SCRIPT = process.env.IG_DL_SCRIPT || path.join(process.cwd(), "vendor/ig-downloader/reels.py");

/** Teto de tempo de um run do downloader (perfis grandes demoram). */
const RUN_TIMEOUT_MS = Number(process.env.IG_DL_TIMEOUT_MS ?? 30 * 60 * 1000);

export class ReelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelDownloadError";
  }
}

/**
 * Só aceitamos links do próprio Instagram. Além de ser o escopo do recurso,
 * impede que o campo de URL vire um baixador genérico apontando para a rede
 * interna do servidor (SSRF).
 */
export function isInstagramUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

/** Nome de conta válido do Instagram (sem @). */
export function isInstagramHandle(raw: string): boolean {
  return /^[A-Za-z0-9._]{1,30}$/.test(raw.trim());
}

/** Extrai o handle de um link de perfil ou devolve o próprio handle. */
export function normalizeHandle(raw: string): string {
  const t = raw.trim();
  if (isInstagramUrl(t)) {
    try {
      const seg = new URL(t).pathname.split("/").filter(Boolean);
      return (seg[0] ?? "").replace(/^@/, "").toLowerCase();
    } catch {
      return "";
    }
  }
  return t.replace(/^@/, "").toLowerCase();
}

export type Criterio = "recentes" | "vistos" | "curtidos";
export type Conteudo = "reels" | "destaques" | "ambos";

export interface ProfileOptions {
  /** 0 = todos. */
  quantidade: number;
  criterio: Criterio;
  /** Com vistos/curtidos: analisar só entre os N mais recentes. 0 = todos. */
  analisar: number;
  conteudo: Conteudo;
  /** Quais destaques, pela ordem do perfil. Ex.: "1,3" ou "2-4". Vazio = todos. */
  quaisDestaques?: string;
  /** Segundos entre downloads. */
  pausa: number;
  semLegenda: boolean;
}

export interface DownloadedFile {
  path: string;
  mimeType: "video/mp4" | "video/quicktime" | "image/jpeg" | "image/png";
  caption: string | null;
}

export interface DownloaderResult {
  /** Diretório temporário (o chamador ingere os arquivos e depois apaga). */
  dir: string;
  files: DownloadedFile[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** O processo foi morto por estourar o tempo. */
  timedOut: boolean;
}

const MIME_POR_EXT: Record<string, DownloadedFile["mimeType"]> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Percorre a pasta de saída e lista os arquivos de mídia (com legenda irmã). */
async function coletarArquivos(outDir: string): Promise<DownloadedFile[]> {
  const achados: DownloadedFile[] = [];
  async function walk(dir: string) {
    let entradas: import("node:fs").Dirent[];
    try {
      entradas = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const mime = MIME_POR_EXT[ext];
      if (!mime) continue; // ignora .txt de legenda, .json, .part, etc.
      // Legenda irmã (<arquivo>.txt), quando o downloader a salvou.
      let caption: string | null = null;
      try {
        caption = await fs.readFile(full.replace(/\.[^.]+$/, ".txt"), "utf8");
      } catch {
        /* sem legenda */
      }
      achados.push({ path: full, mimeType: mime, caption });
    }
  }
  await walk(outDir);
  return achados;
}

/** Monta os argumentos do reels.py a partir das opções de perfil. */
function argsDePerfil(o: ProfileOptions): string[] {
  const a: string[] = [];
  if (o.conteudo === "destaques") a.push("--destaques");
  else if (o.conteudo === "ambos") a.push("--reels-e-destaques");

  if (o.conteudo !== "destaques") {
    a.push("-n", String(Math.max(0, o.quantidade)));
    if (o.criterio === "vistos") a.push("--mais-vistos");
    else if (o.criterio === "curtidos") a.push("--mais-curtidos");
    if (o.criterio !== "recentes") {
      if (o.analisar > 0) a.push("--analisar", String(o.analisar));
      a.push("--atualizar-lista"); // nada de cache entre runs
    }
  }
  if (o.conteudo !== "reels" && o.quaisDestaques?.trim()) {
    a.push("--quais-destaques", o.quaisDestaques.trim());
  }
  return a;
}

/**
 * Executa o downloader (reels.py) para uma lista de links OU um perfil.
 * Copia o script para um diretório temporário por run, de modo que o histórico
 * dele comece zerado e sempre baixe — a dedup por checksum da biblioteca é quem
 * decide o que já existe. O chamador é dono de `dir` e deve apagá-lo depois.
 */
export async function runDownloader(opts: {
  cookiesPath: string;
  links?: string[];
  account?: string;
  profile?: ProfileOptions;
  pausa?: number;
  semLegenda?: boolean;
}): Promise<DownloaderResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `igdl-${crypto.randomBytes(6).toString("hex")}-`));
  const outDir = path.join(dir, "out");
  const scriptCopia = path.join(dir, "reels.py");
  await fs.mkdir(outDir, { recursive: true });
  // Cópia do script: isola o histórico (dados/) deste run dos demais.
  try {
    await fs.copyFile(SCRIPT, scriptCopia);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    throw new ReelDownloadError(
      "Downloader (reels.py) não encontrado na imagem. Reconstrua com docker compose up -d --build.",
    );
  }

  // Alvo posicional primeiro, depois as opções.
  const args: string[] = [scriptCopia];
  if (opts.links && opts.links.length > 0) {
    args.push(...opts.links);
    if (opts.semLegenda) args.push("--sem-legenda");
  } else if (opts.account) {
    args.push(opts.account);
    if (opts.profile) {
      args.push(...argsDePerfil(opts.profile));
      if (opts.profile.semLegenda) args.push("--sem-legenda");
    }
  } else {
    await fs.rm(dir, { recursive: true, force: true });
    throw new ReelDownloadError("Nada para baixar: informe links ou uma conta.");
  }
  args.push("-o", outDir, "--cookies", opts.cookiesPath);
  args.push("--pausa", String(opts.profile?.pausa ?? opts.pausa ?? 4));

  const { stdout, stderr, exitCode, timedOut } = await executar(args, dir);
  const files = await coletarArquivos(outDir);

  // Sem nenhum arquivo produzido e com erro: é falha de verdade.
  if (files.length === 0 && exitCode !== 0) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new ReelDownloadError(mensagemDeErro(stderr || stdout, timedOut));
  }

  return { dir, files, stdout, stderr, exitCode, timedOut };
}

/** Roda o processo com teto de tempo, sem stdin (evita travar em prompt). */
function executar(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 1024 * 1024; // guarda no máximo ~1 MB de cada stream
    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new ReelDownloadError("Python não encontrado no servidor (IG_DL_PYTHON)."));
      } else {
        reject(e);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

/** Última linha útil do downloader, traduzida nos casos comuns. */
function mensagemDeErro(saida: string, timedOut: boolean): string {
  if (timedOut) return "Download demorou demais e foi interrompido.";
  const s = saida.toLowerCase();
  if (s.includes("nao achei o cookies") || s.includes("cookies")) {
    return "Configure o cookie da conta na própria tela de importação (o Instagram exige login).";
  }
  if (s.includes("429") || s.includes("login") || s.includes("bloqueou")) {
    return "O Instagram pediu login ou limitou a conta do cookie. Espere e tente de novo, ou use outra conta no cookie.";
  }
  if (s.includes("privad") || s.includes("not found") || s.includes("nao encontr")) {
    return "Perfil/conteúdo privado ou inexistente para a conta do cookie.";
  }
  const linhas = saida.trim().split("\n").filter(Boolean);
  const ultima = linhas.length ? linhas[linhas.length - 1] : "";
  return `Falha no download: ${ultima.slice(0, 300) || "erro desconhecido"}`;
}
