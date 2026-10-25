import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

export interface StoredFile {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
  checksum: string;
}

export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** Caminho em disco, quando o driver for local (para servir o arquivo). */
  localPath?(key: string): string;
}

export function buildKey(workspaceId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().slice(0, 10) || "";
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = crypto.randomBytes(8).toString("hex");
  return `${workspaceId}/${stamp}/${rand}${ext}`;
}

function checksumOf(body: Buffer): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

class LocalStorage implements StorageDriver {
  readonly name = "local" as const;
  private root: string;

  constructor() {
    this.root = path.resolve(process.cwd(), env().STORAGE_LOCAL_DIR);
  }

  localPath(key: string): string {
    // Impede key com ../ de escapar do diretorio de storage.
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep)) {
      throw new Error("Caminho de storage invalido");
    }
    return resolved;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredFile> {
    const dest = this.localPath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    return {
      storageKey: key,
      publicUrl: `${env().PUBLIC_MEDIA_BASE_URL.replace(/\/$/, "")}/${key}`,
      sizeBytes: body.byteLength,
      checksum: checksumOf(body),
    };
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.localPath(key), { force: true });
  }
}

class S3Storage implements StorageDriver {
  readonly name = "s3" as const;

  async put(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const e = env();
    const client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(e.S3_ENDPOINT),
      credentials: {
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: e.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // A Meta baixa a midia por HTTP sem autenticacao.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return {
      storageKey: key,
      publicUrl: `${e.PUBLIC_MEDIA_BASE_URL.replace(/\/$/, "")}/${key}`,
      sizeBytes: body.byteLength,
      checksum: checksumOf(body),
    };
  }

  async delete(key: string): Promise<void> {
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const e = env();
    const client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(e.S3_ENDPOINT),
      credentials: {
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    });
    await client.send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
  }
}

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;
  cached = env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return cached;
}
