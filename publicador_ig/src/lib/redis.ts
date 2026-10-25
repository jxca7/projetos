import IORedis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export function redis(): IORedis {
  if (globalForRedis.redis) return globalForRedis.redis;
  const client = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null, // exigido pelo BullMQ
    enableReadyCheck: false,
  });
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = client;
  return client;
}
