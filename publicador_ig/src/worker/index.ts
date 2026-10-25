import "dotenv/config";
import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import {
  QUEUE_INSIGHTS,
  QUEUE_MAINTENANCE,
  QUEUE_PUBLISH,
  maintenanceQueue,
  type InsightsJobData,
  type MaintenanceJobData,
  type PublishJobData,
} from "@/lib/queue";
import { applyOutcome, processPublishTarget } from "./publish";
import { processInsights } from "./insights";
import { processMaintenance } from "./maintenance";
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
