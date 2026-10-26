import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Binário do yt-dlp. Sobrescrevível por env em ambientes fora do padrão. */
const YT_DLP = process.env.YTDLP_PATH || "yt-dlp";

/** Teto de download (bate com o limite de 1 GB da biblioteca). */
const MAX_FILESIZE = "1024M";

/** Timeout de um download, em ms. Reels são curtos; 5 min cobre rede ruim. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface DownloadedReel {
  /** Caminho do arquivo baixado (dentro de `dir`). */
  filePath: string;
  mimeType: string;
  title: string | null;
  uploader: string | null;
  /** Diretório temporário a limpar quando terminar de usar o arquivo. */
  dir: string;
}

export class ReelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelDownloadError";
  }
}

/**
 * Só aceitamos links do próprio Instagram. Além de ser o escopo do recurso,
 * isso impede que o campo de URL vire um baixador genérico apontando para a
 * rede interna do servidor (SSRF).
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

/** Traduz os erros mais comuns do yt-dlp para português. */
function friendlyError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("login required") || s.includes("rate-limit") || s.includes("not available")) {
    return "O Instagram pediu login para esse conteúdo. Configure o cookie da sua conta na própria tela de importação (ou o link é privado).";
  }
  if (s.includes("private") || s.includes("not authorized")) {
    return "Conteúdo privado: a conta que você usou no cookie precisa seguir/ter acesso a esse perfil.";
  }
  if (s.includes("404") || s.includes("not found") || s.includes("unable to download webpage")) {
    return "Link não encontrado. Confira se o Reel/post ainda existe e se a URL está completa.";
  }
  if (s.includes("filesize") || s.includes("max-filesize")) {
    return "Vídeo acima de 1 GB.";
  }
  // Mensagem genérica, mas com a última linha útil do yt-dlp.
  const lastLine = stderr.trim().split("\n").filter(Boolean).pop() ?? "";
  return `Falha ao baixar: ${lastLine.slice(0, 300) || "erro desconhecido no yt-dlp"}`;
}

/**
 * Baixa um Reel/post do Instagram com yt-dlp para um diretório temporário.
 * `cookiesPath`, quando informado, é um arquivo cookies.txt (Netscape) que dá
 * acesso ao conteúdo que exige login. O chamador é dono do `dir` devolvido e
 * deve apagá-lo depois de ingerir o arquivo.
 */
export async function downloadReel(
  url: string,
  opts: { cookiesPath?: string } = {},
): Promise<DownloadedReel> {
  if (!isInstagramUrl(url)) {
    throw new ReelDownloadError("Use um link do Instagram (instagram.com/reel/... ou /p/...).");
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `reel-${crypto.randomBytes(6).toString("hex")}-`));

  const args: string[] = [];
  if (opts.cookiesPath) args.push("--cookies", opts.cookiesPath);
  args.push(
    "--no-playlist", // um link de reel não deve arrastar o perfil inteiro
    "--no-progress",
    "--no-warnings",
    "--quiet",
    "--no-part",
    "-f",
    "mp4/bestvideo*+bestaudio/best",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4", // garante container .mp4 (compatível com Reels)
    "--max-filesize",
    MAX_FILESIZE,
    "--retries",
    "3",
    "--write-info-json",
    "-o",
    path.join(dir, "media.%(ext)s"),
    url,
  );

  try {
    await execFileAsync(YT_DLP, args, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    const err = e as { stderr?: string; stdout?: string; code?: string; killed?: boolean };
    if (err.killed) throw new ReelDownloadError("Download demorou demais e foi cancelado.");
    if (err.code === "ENOENT") {
      throw new ReelDownloadError(
        "yt-dlp não está instalado no servidor. Reconstrua a imagem (docker compose up -d --build).",
      );
    }
    throw new ReelDownloadError(friendlyError(err.stderr ?? err.stdout ?? ""));
  }

  // Encontra o arquivo de vídeo gerado (ignora o .info.json).
  const files = await fs.readdir(dir);
  const videoName = files.find((f) => !f.endsWith(".info.json") && !f.endsWith(".part"));
  if (!videoName) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new ReelDownloadError("O yt-dlp não produziu nenhum arquivo de vídeo.");
  }

  // Lê título/autor do .info.json, quando houver.
  let title: string | null = null;
  let uploader: string | null = null;
  const infoName = files.find((f) => f.endsWith(".info.json"));
  if (infoName) {
    try {
      const info = JSON.parse(await fs.readFile(path.join(dir, infoName), "utf8")) as {
        title?: string;
        description?: string;
        uploader?: string;
        uploader_id?: string;
      };
      title = (info.title || info.description || "").slice(0, 300) || null;
      uploader = info.uploader || info.uploader_id || null;
    } catch {
      // info.json corrompido não impede a importação.
    }
  }

  return {
    filePath: path.join(dir, videoName),
    mimeType: "video/mp4",
    title,
    uploader,
    dir,
  };
}
