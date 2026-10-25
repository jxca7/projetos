import "dotenv/config";
import { schedulePost, ScheduleError } from "@/lib/publishing/scheduler";

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("uso: tsx scripts/schedule.ts <postId>");
    process.exit(1);
  }
  try {
    const r = await schedulePost(postId);
    console.log(`${r.queued} destinos na fila`);
    console.log(`primeiro: ${r.firstAt.toISOString()}`);
    console.log(`último:   ${r.lastAt.toISOString()}`);
    for (const w of r.warnings) console.log(`aviso: ${w}`);
  } catch (e) {
    if (e instanceof ScheduleError) {
      console.error("não foi possível agendar:");
      for (const i of e.issues) console.error(`  - ${i}`);
      process.exit(1);
    }
    throw e;
  }
}

main().then(() => process.exit(0));
