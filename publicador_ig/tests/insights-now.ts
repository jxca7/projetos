import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { processInsights } from "@/worker/insights";

async function main() {
  const targets = await prisma.postTarget.findMany({ where: { status: "PUBLISHED" } });
  for (const t of targets) {
    await processInsights({ targetId: t.id, pass: "1h" });
  }
  const snaps = await prisma.metricSnapshot.findMany({
    include: { target: { include: { account: true } } },
    orderBy: { collectedAt: "desc" },
  });
  console.log(`snapshots coletados: ${snaps.length}`);
  for (const s of snaps) {
    console.log(
      `  @${s.target.account.igUsername.padEnd(18)} alcance=${s.reach} views=${s.views} likes=${s.likes} saves=${s.saved}`,
    );
  }
}
main().then(() => process.exit(0));
