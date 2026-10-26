import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Extrai um frame de capa (poster) do vídeo com ffmpeg, para a grade da
 * biblioteca. Devolve um JPEG, ou null se o ffmpeg não estiver disponível ou
 * falhar — nesse caso a biblioteca mostra um ícone de vídeo no lugar.
 */
export async function extractPoster(videoPath: string): Promise<Buffer | null> {
  const out = path.join(os.tmpdir(), `poster-${crypto.randomBytes(8).toString("hex")}.jpg`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-ss", "1", // pega 1s para fugir de frame preto inicial
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale=640:-2",
        "-q:v", "4",
        "-y",
        out,
      ],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return await fs.readFile(out);
  } catch {
    return null;
  } finally {
    await fs.rm(out, { force: true });
  }
}
