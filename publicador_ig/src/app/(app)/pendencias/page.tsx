import { prisma } from "@/lib/prisma";
import { requireContext } from "@/lib/session";
import { completeReminderAction } from "@/app/actions";
import { Button, Card, Empty, Notice, SectionTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/labels";

export const metadata = { title: "Pendências · Publicador IG" };
export const dynamic = "force-dynamic";

export default async function PendenciasPage() {
  const ctx = await requireContext();

  const reminders = await prisma.reminder.findMany({
    where: {
      account: { workspaceId: ctx.workspaceId },
      status: { in: ["PENDING", "SENT"] },
    },
    include: { account: true },
    orderBy: { dueAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Pendências"
        hint="O que a API oficial não faz e precisa da sua mao no app."
      />

      <Notice tone="accent" title="Por que isso existe">
        A API oficial do Instagram publica Stories, mas descarta link sticker, enquete e menção.
        Nenhuma ferramenta faz isso por API — quem promete, usa automação não oficial e queima a
        conta. A plataforma publica o Story e avisa aqui para você adicionar o link no app,
        enquanto ele está no ar.
      </Notice>

      {reminders.length === 0 ? (
        <Empty
          title="Nenhuma pendência"
          hint="Quando um Story com link for publicado, ele aparece aqui."
        />
      ) : (
        <div className="space-y-3">
          {reminders.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.title}</p>
                  {r.body ? <p className="mt-1 text-sm text-muted">{r.body}</p> : null}
                  {r.link ? (
                    <p className="mt-2 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">
                      {r.link}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted">
                    @{r.account.igUsername} · {formatDateTime(r.dueAt, ctx.timezone)}
                  </p>
                </div>
                <form
                  action={async () => {
                    "use server";
                    await completeReminderAction(r.id);
                  }}
                >
                  <Button variant="secondary" type="submit" className="px-3 py-1.5 text-sm">
                    Marcar como feito
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
