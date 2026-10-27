import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import { redis } from "./redis";

export const QUEUE_PUBLISH = "publish";
export const QUEUE_INSIGHTS = "insights";
export const QUEUE_MAINTENANCE = "maintenance";
export const QUEUE_IMPORT = "import";
export const QUEUE_STORY_APP = "story-app";
export const QUEUE_PREPARE = "prepare";

export interface PublishJobData {
  targetId: string;
}

export interface InsightsJobData {
  targetId: string;
  /** Qual coleta é esta: 1h, 24h ou 7d depois da publicação. */
  pass: "1h" | "24h" | "7d";
}

export type MaintenanceJobData =
  | { kind: "refresh-account-quota"; accountId: string }
  | { kind: "check-token-expiry" }
  | { kind: "refresh-instagram-tokens" }
  | { kind: "dispatch-reminders" };

export interface ImportJobData {
  importId: string;
}

export interface StoryAppJobData {
  targetId: string;
}

export interface PrepareJobData {
  targetId: string;
}

const globalForQueues = globalThis as unknown as {
  publishQueue?: Queue<PublishJobData>;
  insightsQueue?: Queue<InsightsJobData>;
  maintenanceQueue?: Queue<MaintenanceJobData>;
  importQueue?: Queue<ImportJobData>;
  storyAppQueue?: Queue<StoryAppJobData>;
  prepareQueue?: Queue<PrepareJobData>;
};

/**
 * Jobs de publicação não usam o retry do BullMQ: a decisão de repetir depende
 * da classe do erro da Meta (transitorio, cota, token morto) e é tomada no
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

/** Enfileira (ou reenfileira) a publicação de um target. */
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
      // Job em execução não pode ser removido; o processador checa o status
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

export function importQueue(): Queue<ImportJobData> {
  if (!globalForQueues.importQueue) {
    globalForQueues.importQueue = new Queue<ImportJobData>(QUEUE_IMPORT, {
      connection: redis(),
    });
  }
  return globalForQueues.importQueue;
}

/**
 * Enfileira o download de um Reel. Um job por MediaImport (jobId determinístico),
 * então reenfileirar a mesma importação não duplica o download. Deixamos o
 * BullMQ tentar de novo em falha transitória, com backoff largo para ser gentil
 * com o Instagram.
 */
export async function enqueueImport(importId: string): Promise<void> {
  const q = importQueue();
  const jobId = `import-${importId}`;
  // O BullMQ ignora um add com jobId já existente (inclusive concluído/falho), o
  // que mataria o "tentar de novo". Remove o job anterior antes de reenfileirar.
  const anterior = await q.getJob(jobId);
  if (anterior) {
    try {
      await anterior.remove();
    } catch {
      // Job em execução não pode ser removido; o processador checa o status no
      // banco e não rebaixa uma importação já resolvida.
    }
  }
  await q.add(
    "download-reel",
    { importId },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}

export function storyAppQueue(): Queue<StoryAppJobData> {
  if (!globalForQueues.storyAppQueue) {
    globalForQueues.storyAppQueue = new Queue<StoryAppJobData>(QUEUE_STORY_APP, {
      connection: redis(),
    });
  }
  return globalForQueues.storyAppQueue;
}

/** Enfileira a postagem de um story numa conta. Um job por target. */
export async function enqueueStoryApp(targetId: string): Promise<void> {
  const q = storyAppQueue();
  const jobId = `story-${targetId}`;
  const anterior = await q.getJob(jobId);
  if (anterior) {
    try {
      await anterior.remove();
    } catch {
      /* em execução: o processador checa o status no banco */
    }
  }
  await q.add(
    "post-story",
    { targetId },
    {
      jobId,
      attempts: 1, // login/post não deve repetir sozinho (evita lockout)
      removeOnComplete: { age: 24 * 3600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}

export function prepareQueue(): Queue<PrepareJobData> {
  if (!globalForQueues.prepareQueue) {
    globalForQueues.prepareQueue = new Queue<PrepareJobData>(QUEUE_PREPARE, {
      connection: redis(),
    });
  }
  return globalForQueues.prepareQueue;
}

/** Enfileira a preparação (foto/bio) de uma conta. Um job por target. */
export async function enqueuePrepare(targetId: string): Promise<void> {
  const q = prepareQueue();
  const jobId = `prepare-${targetId}`;
  const anterior = await q.getJob(jobId);
  if (anterior) {
    try {
      await anterior.remove();
    } catch {
      /* em execução: o processador checa o status no banco */
    }
  }
  await q.add(
    "prepare-account",
    { targetId },
    {
      jobId,
      attempts: 1, // login/ação não repete sozinho (evita lockout)
      removeOnComplete: { age: 24 * 3600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}

export function publishQueueEvents(): QueueEvents {
  return new QueueEvents(QUEUE_PUBLISH, { connection: redis() });
}
