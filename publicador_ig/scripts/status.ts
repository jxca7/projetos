import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      targets: { include: { account: true }, orderBy: { scheduledAt: "asc" } },
    },
  });

  for (const p of posts) {
    console.log(`\npost ${p.id}  tipo=${p.type}  status=${p.status}`);
    for (const t of p.targets) {
      const bits = [
        `@${t.account.igUsername}`.padEnd(20),
        t.status.padEnd(20),
        t.igMediaId ? `media=${t.igMediaId.slice(0, 22)}` : "",
        t.attempts > 0 ? `tentativas=${t.attempts}` : "",
        t.lastError ? `erro="${t.lastError.slice(0, 60)}"` : "",
      ];
      console.log(`  ${bits.filter(Boolean).join("  ")}`);
    }
  }

  const accounts = await prisma.socialAccount.findMany({ orderBy: { igUsername: "asc" } });
  console.log("\ncotas por conta (janela de 24h):");
  for (const a of accounts) {
    console.log(
      `  @${a.igUsername.padEnd(18)} ${a.quotaUsage ?? "?"}/${a.quotaTotal ?? "?"}  status=${a.status}`,
    );
  }

  const metrics = await prisma.metricSnapshot.count();
  const reminders = await prisma.reminder.count();
  console.log(`\nsnapshots de metrica: ${metrics}   reminders: ${reminders}`);
}

main().then(() => process.exit(0));
