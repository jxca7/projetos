import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

/**
 * Le as caracteristicas do arquivo com ffprobe. Se o ffprobe nao estiver
 * instalado, devolve nulos e a validacao se limita ao que da' pra checar
 * sem ele (mime e tamanho).
 */
export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const empty: ProbeResult = {
    width: null,
    height: null,
    durationMs: null,
    videoCodec: null,
    audioCodec: null,
    hasAudio: false,
  };

  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout) as {
      streams?: FfprobeStream[];
      format?: { duration?: string };
    };

    const video = parsed.streams?.find((s) => s.codec_type === "video");
    const audio = parsed.streams?.find((s) => s.codec_type === "audio");
    const durationSec = Number(parsed.format?.duration ?? video?.duration ?? 0);

    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      durationMs: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      hasAudio: Boolean(audio),
    };
  } catch {
    return empty;
  }
}
