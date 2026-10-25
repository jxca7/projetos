import { env } from "../env";
import { GraphDriver } from "./graph-driver";
import { MockDriver } from "./mock-driver";
import type { MetaDriver } from "./types";

let cached: MetaDriver | null = null;

/**
 * Driver ativo. META_DRIVER=mock roda tudo localmente; META_DRIVER=graph fala
 * com a API oficial da Meta.
 */
export function meta(): MetaDriver {
  if (cached) return cached;
  cached = env().META_DRIVER === "graph" ? new GraphDriver() : new MockDriver();
  return cached;
}

export * from "./types";
export { MetaApiError, backoffMs, classifyMetaError } from "./errors";
export type { ErrorClass } from "./errors";
