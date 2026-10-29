import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Extensão de saída conforme o tipo (mantém o container original). */
const EXT_POR_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

/**
 * Remove os metadados do arquivo SEM recodificar (sem perda de qualidade).
 *
 * Usa `-c copy`: as faixas de vídeo/áudio (ou a imagem) são copiadas bit a bit,
 * só o container é reescrito sem os metadados — creation_time, localização/GPS,
 * modelo de aparelho, encoder, título, etc. É o mesmo arquivo em qualidade, só
 * sem o "rastro" que o Instagram poderia ler numa re-publicação.
 *
 * Devolve o caminho de um arquivo temporário já limpo, ou null se o ffmpeg não
 * estiver disponível ou falhar — aí o chamador segue com o arquivo original.
 * Quem chama é responsável por apagar o arquivo devolvido.
 */
export async function stripMetadata(inputPath: string, mimeType: string): Promise<string | null> {
  const ext = EXT_POR_MIME[mimeType];
  if (!ext) return null; // tipo que não tratamos: segue o original

  const out = path.join(os.tmpdir(), `clean-${crypto.randomBytes(8).toString("hex")}${ext}`);
  const args = [
    "-i", inputPath,
    "-map_metadata", "-1", // joga fora os metadados globais
    "-map_chapters", "-1", // e os capítulos
    "-c", "copy", // COPIA as faixas: nada de recodificar → zero perda
    "-fflags", "+bitexact", // não grava a assinatura do ffmpeg no container
  ];
  // faststart deixa o MP4/MOV pronto para streaming (move o índice para o início).
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    args.push("-movflags", "+faststart");
  }
  args.push("-y", out);

  try {
    await execFileAsync("ffmpeg", args, { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    // Sanidade: o arquivo saiu e não está vazio.
    const st = await fs.stat(out);
    if (st.size <= 0) {
      await fs.rm(out, { force: true });
      return null;
    }
    return out;
  } catch {
    await fs.rm(out, { force: true });
    return null;
  }
}
