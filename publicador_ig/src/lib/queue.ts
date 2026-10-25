import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import { redis } from "./redis";

export const QUEUE_PUBLISH = "publish";
export const QUEUE_INSIGHTS = "insights";
export const QUEUE_MAINTENANCE = "maintenance";

export interface PublishJobData {
  targetId: string;
}

export interface InsightsJobData {
  targetId: string;
  /** Qual coleta e' esta: 1h, 24h ou 7d depois da publicacao. */
  pass: "1h" | "24h" | "7d";
}

export type MaintenanceJobData =
  | { kind: "refresh-account-quota"; accountId: string }
  | { kind: "check-token-expiry" }
  | { kind: "dispatch-reminders" };

const globalForQueues = globalThis as unknown as {
  publishQueue?: Queue<PublishJobData>;
  insightsQueue?: Queue<InsightsJobData>;
  maintenanceQueue?: Queue<MaintenanceJobData>;
};

/**
 * Jobs de publicacao nao usam o retry do BullMQ: a decisao de repetir depende
 * da classe do erro da Meta (transitorio, cota, token morto) e e' tomada no
 * processador, que reagenda o job com o backoff certo. Deixar o BullMQ
 * repetindo sozinho faria o worker insistir em erro permanente.
 */
export const PUBLISH_JOB_OPTS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function publishQueue(): Queue<PublishJobData> {
  if (!globalForQueues.publishQueue) {
    globalForQueues.publishQueue = new Queue<PublishJobData>(QUEUE_PUBLISH, {
      connection: redis(),
    });
  }
  return globalForQueues.publishQueue;
}

export function insightsQueue(): Queue<InsightsJobData> {
  if (!globalForQueues.insightsQueue) {
    globalForQueues.insightsQueue = new Queue<InsightsJobData>(QUEUE_INSIGHTS, {
      connection: redis(),
    });
  }
  return globalForQueues.insightsQueue;
}

export function maintenanceQueue(): Queue<MaintenanceJobData> {
  if (!globalForQueues.maintenanceQueue) {
    globalForQueues.maintenanceQueue = new Queue<MaintenanceJobData>(QUEUE_MAINTENANCE, {
      connection: redis(),
    });
  }
  return globalForQueues.maintenanceQueue;
}

/** Enfileira (ou reenfileira) a publicacao de um target. */
export async function enqueuePublish(
  targetId: string,
  opts: { delayMs?: number; jobId?: string } = {},
): Promise<string> {
  const job = await publishQueue().add(
    "publish-target",
    { targetId },
    {
      ...PUBLISH_JOB_OPTS,
      delay: Math.max(0, opts.delayMs ?? 0),
      // jobId deterministico evita duplicar o job do mesmo target.
      jobId: opts.jobId ?? `target-${targetId}`,
    },
  );
  return job.id ?? `target-${targetId}`;
}

export async function cancelPublish(targetId: string): Promise<void> {
  const job = await publishQueue().getJob(`target-${targetId}`);
  if (job) {
    try {
      await job.remove();
    } catch {
      // Job em execucao nao pode ser removido; o processador checa o status
      // no banco antes de publicar e aborta sozinho.
    }
  }
}

export async function enqueueInsights(
  targetId: string,
  pass: InsightsJobData["pass"],
  delayMs: number,
): Promise<void> {
  await insightsQueue().add(
    "collect",
    { targetId, pass },
    {
      delay: Math.max(0, delayMs),
      jobId: `insights-${targetId}-${pass}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
    },
  );
}

export function publishQueueEvents(): QueueEvents {
  return new QueueEvents(QUEUE_PUBLISH, { connection: redis() });
}
