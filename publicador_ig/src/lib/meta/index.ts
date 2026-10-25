import { env } from "../env";
import { GraphDriver } from "./graph-driver";
import { MockDriver } from "./mock-driver";
import type { MetaCredentials, MetaDriver } from "./types";

let mock: MockDriver | null = null;

/**
 * Driver da Meta para um conjunto de credenciais.
 *
 * Em `mock` as credenciais são ignoradas. Em `graph`, cada chamada usa o app
 * que emitiu aquele token — por isso o driver é construído por operação, e não
 * mantido como singleton global.
 */
export function meta(creds?: MetaCredentials | null): MetaDriver {
  if (env().META_DRIVER === "mock") {
    mock ??= new MockDriver();
    return mock;
  }
  if (!creds) {
    throw new Error("Driver graph exige credenciais do app do Meta.");
  }
  return new GraphDriver(creds);
}

export * from "./types";
export { MetaApiError, backoffMs, classifyMetaError } from "./errors";
export type { ErrorClass } from "./errors";
export {
  activeCredentials,
  credentialsForAccount,
  driverForAccount,
  driverForWorkspace,
  NoMetaAppError,
} from "./credentials";
