import "dotenv/config";
import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import {
  QUEUE_IMPORT,
  QUEUE_INSIGHTS,
  QUEUE_MAINTENANCE,
  QUEUE_PUBLISH,
  QUEUE_STORY_APP,
  QUEUE_PREPARE,
  QUEUE_PREPARE_TEST,
  maintenanceQueue,
  type ImportJobData,
  type InsightsJobData,
  type MaintenanceJobData,
  type PublishJobData,
  type StoryAppJobData,
  type PrepareJobData,
  type PrepareTestJobData,
} from "@/lib/queue";
import { applyOutcome, processPublishTarget } from "./publish";
import { processInsights } from "./insights";
import { processMaintenance } from "./maintenance";
import { processImport } from "./import";
import { processStoryApp } from "./story-app";
import { processPrepare } from "./prepare";
import { processPrepareTest } from "./prepare-test";
import { env } from "@/lib/env";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "8");

function log(msg: string, extra?: unknown) {
  const stamp = new Date().toISOString();
  if (extra !== undefined) console.log(`[${stamp}] ${msg}`, extra);
  else console.log(`[${stamp}] ${msg}`);
}

async function main() {
  const e = env();
  log(`worker iniciando (driver Meta: ${e.META_DRIVER}, concorrencia: ${CONCURRENCY})`);

  const publishWorker = new Worker<PublishJobData>(
    QUEUE_PUBLISH,
    async (job) => {
      const outcome = await processPublishTarget(job.data.targetId);
      await applyOutcome(job.data.targetId, outcome);
      return outcome;
    },
    {
      connection: redis(),
      concurrency: CONCURRENCY,
      // Teto global de chamadas a Graph API, independente das contas.
      limiter: { max: 30, duration: 10_000 },
    },
  );

  const insightsWorker = new Worker<InsightsJobData>(
    QUEUE_INSIGHTS,
    async (job) => processInsights(job.data),
    { connection: redis(), concurrency: 4, limiter: { max: 20, duration: 10_000 } },
  );

  const maintenanceWorker = new Worker<MaintenanceJobData>(
    QUEUE_MAINTENANCE,
    async (job) => processMaintenance(job.data),
    { connection: redis(), concurrency: 2 },
  );

  // Download de Reels: poucos de cada vez e com limite por minuto, para ser
  // gentil com o Instagram e não chamar atenção na conta do cookie.
  const importWorker = new Worker<ImportJobData>(
    QUEUE_IMPORT,
    async (job) => processImport(job.data),
    { connection: redis(), concurrency: 2, limiter: { max: 6, duration: 60_000 } },
  );

  // Postagem de story pelo app: uma conta por vez e espaçada, para não chamar
  // atenção (e porque o motor usa um arquivo temporário fixo por run).
  const storyAppWorker = new Worker<StoryAppJobData>(
    QUEUE_STORY_APP,
    async (job) => processStoryApp(job.data),
    { connection: redis(), concurrency: 1, limiter: { max: 4, duration: 60_000 } },
  );

  // Preparar conta (foto/bio): uma conta por vez e espaçada, como o story.
  const prepareWorker = new Worker<PrepareJobData>(
    QUEUE_PREPARE,
    async (job) => processPrepare(job.data),
    { connection: redis(), concurrency: 1, limiter: { max: 4, duration: 60_000 } },
  );

  // TESTE: aceitar convite pelo instagrapi. Uma conta por vez e espaçada.
  const prepareTestWorker = new Worker<PrepareTestJobData>(
    QUEUE_PREPARE_TEST,
    async (job) => processPrepareTest(job.data),
    { connection: redis(), concurrency: 1, limiter: { max: 4, duration: 60_000 } },
  );

  publishWorker.on("completed", (job, result) => {
    const r = result as { kind: string; reason?: string; delayMs?: number } | undefined;
    if (r?.kind === "retry") {
      log(`target ${job.data.targetId}: reagendado em ${Math.round((r.delayMs ?? 0) / 1000)}s (${r.reason})`);
    } else if (r?.kind === "failed") {
      log(`target ${job.data.targetId}: FALHOU (${r.reason})`);
    } else {
      log(`target ${job.data.targetId}: concluido`);
    }
  });
  publishWorker.on("failed", (job, err) => {
    log(`job de publicação ${job?.id} estourou: ${err.message}`);
  });
  insightsWorker.on("failed", (job, err) => {
    log(`job de métricas ${job?.id} falhou: ${err.message}`);
  });
  importWorker.on("completed", (job) => {
    log(`importação ${job.data.importId}: concluída`);
  });
  importWorker.on("failed", (job, err) => {
    log(`importação ${job?.data.importId} falhou: ${err.message}`);
  });
  storyAppWorker.on("completed", (job) => {
    log(`story ${job.data.targetId}: processado`);
  });
  storyAppWorker.on("failed", (job, err) => {
    log(`story ${job?.data.targetId} falhou: ${err.message}`);
  });
  prepareWorker.on("completed", (job) => {
    log(`preparar ${job.data.targetId}: processado`);
  });
  prepareWorker.on("failed", (job, err) => {
    log(`preparar ${job?.data.targetId} falhou: ${err.message}`);
  });
  prepareTestWorker.on("completed", (job) => {
    log(`preparar-teste ${job.data.targetId}: processado`);
  });
  prepareTestWorker.on("failed", (job, err) => {
    log(`preparar-teste ${job?.data.targetId} falhou: ${err.message}`);
  });

  // Rotinas periodicas.
  const mq = maintenanceQueue();
  await mq.upsertJobScheduler(
    "cron-check-token-expiry",
    { pattern: "0 */6 * * *" },
    { name: "check-token-expiry", data: { kind: "check-token-expiry" } },
  );
  await mq.upsertJobScheduler(
    "cron-refresh-instagram-tokens",
    { pattern: "0 4 * * *" },
    { name: "refresh-instagram-tokens", data: { kind: "refresh-instagram-tokens" } },
  );
  await mq.upsertJobScheduler(
    "cron-dispatch-reminders",
    { pattern: "*/5 * * * *" },
    { name: "dispatch-reminders", data: { kind: "dispatch-reminders" } },
  );

  const shutdown = async (signal: string) => {
    log(`recebido ${signal}, encerrando workers...`);
    await Promise.allSettled([
      publishWorker.close(),
      insightsWorker.close(),
      maintenanceWorker.close(),
      importWorker.close(),
      storyAppWorker.close(),
      prepareWorker.close(),
      prepareTestWorker.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("worker pronto");
}

main().catch((e) => {
  console.error("worker falhou ao iniciar:", e);
  process.exit(1);
});
