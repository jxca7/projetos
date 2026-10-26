"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  assignAccountsToFolderAction,
  createFolderAction,
  deleteFolderAction,
  disconnectAccountsAction,
  refreshQuotaAction,
  renameFolderAction,
} from "@/app/actions";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { ACCOUNT_STATUS, formatDateTime, formatNumber } from "@/lib/labels";
import type { AccountStatus } from "@/generated/prisma/enums";

export interface FolderRow {
  id: string;
  name: string;
  count: number;
}

export interface AccountRow {
  id: string;
  igUsername: string;
  profilePicUrl: string | null;
  status: AccountStatus;
  statusMessage: string | null;
  folderId: string | null;
  followersCount: number | null;
  pageName: string | null;
  quotaUsage: number | null;
  quotaTotal: number | null;
  tokenExpiresAt: string | null;
  publishedCount: number;
}

const SEM_PASTA = "__sem_pasta__";
const PAGINA = 30;

export function AccountsManager({
  folders,
  accounts,
  timezone,
  canManage,
}: {
  folders: FolderRow[];
  accounts: AccountRow[];
  timezone: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("__todas__");
  const [busca, setBusca] = useState("");
  // Renderiza em blocos: com ~100 contas, jogar a lista inteira na tela deixa
  // a página com dezenas de milhares de pixels e trava a rolagem no celular.
  const [limite, setLimite] = useState(PAGINA);
  const [selected, setSelected] = useState<string[]>([]);
  const [novaPasta, setNovaPasta] = useState("");
  const [criando, setCriando] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const semPasta = accounts.filter((a) => !a.folderId).length;

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === SEM_PASTA && a.folderId) return false;
      if (filter !== "__todas__" && filter !== SEM_PASTA && a.folderId !== filter) return false;
      if (!termo) return true;
      return (
        a.igUsername.toLowerCase().includes(termo) ||
        (a.pageName ?? "").toLowerCase().includes(termo)
      );
    });
  }, [accounts, filter, busca]);

  // Filtro novo começa do topo, senão a pessoa vê um recorte arbitrário.
  const chaveFiltro = `${filter}|${busca.trim().toLowerCase()}`;
  const [ultimaChave, setUltimaChave] = useState(chaveFiltro);
  if (chaveFiltro !== ultimaChave) {
    setUltimaChave(chaveFiltro);
    setLimite(PAGINA);
  }

  const exibidas = visiveis.slice(0, limite);

  function run(fn: () => Promise<unknown>, sucesso?: (r: never) => string) {
    setMsg(null);
    startTransition(async () => {
      const r = (await fn()) as { ok: boolean; error?: string } & Record<string, unknown>;
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error ?? "Não foi possível concluir." });
        return;
      }
      if (sucesso) setMsg({ tone: "ok", text: sucesso(r as never) });
      setSelected([]);
      router.refresh();
    });
  }

  function toggle(id: string) {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const todasVisiveisMarcadas =
    visiveis.length > 0 && visiveis.every((a) => selected.includes(a.id));

  return (
    <div className="space-y-5">
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {/* ---- Pastas ---- */}
      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pastas</h2>
            <p className="mt-0.5 text-sm text-muted">
              Agrupe as contas e, ao publicar, escolha a pasta para selecionar o grupo inteiro.
            </p>
          </div>
          {canManage ? (
            criando ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nome = novaPasta;
                  run(
                    () => createFolderAction(nome),
                    () => `Pasta "${nome}" criada.`,
                  );
                  setNovaPasta("");
                  setCriando(false);
                }}
              >
                <input
                  autoFocus
                  value={novaPasta}
                  onChange={(e) => setNovaPasta(e.target.value)}
                  placeholder="Nome da pasta"
                  className="w-44"
                />
                <Button type="submit" className="px-3 py-1.5 text-xs" disabled={pending}>
                  Criar
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  className="px-2 py-1.5 text-xs"
                  onClick={() => setCriando(false)}
                >
                  cancelar
                </Button>
              </form>
            ) : (
              <Button
                variant="secondary"
                type="button"
                className="px-3 py-1.5 text-xs"
                onClick={() => setCriando(true)}
              >
                Nova pasta
              </Button>
            )
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <FolderChip
            label={`Todas · ${accounts.length}`}
            active={filter === "__todas__"}
            onClick={() => setFilter("__todas__")}
          />
          <FolderChip
            label={`Sem pasta · ${semPasta}`}
            active={filter === SEM_PASTA}
            onClick={() => setFilter(SEM_PASTA)}
          />
          {folders.map((f) => (
            <FolderChip
              key={f.id}
              label={`${f.name} · ${f.count}`}
              active={filter === f.id}
              onClick={() => setFilter(f.id)}
              onRename={
                canManage
                  ? () => {
                      const nome = window.prompt("Novo nome da pasta", f.name);
                      if (nome && nome !== f.name) {
                        run(
                          () => renameFolderAction(f.id, nome),
                          () => `Pasta renomeada para "${nome}".`,
                        );
                      }
                    }
                  : undefined
              }
              onDelete={
                canManage
                  ? () => {
                      const ok = window.confirm(
                        `Apagar a pasta "${f.name}"? As ${f.count} conta(s) continuam conectadas e voltam para "sem pasta".`,
                      );
                      if (ok) {
                        run(
                          () => deleteFolderAction(f.id),
                          () => `Pasta "${f.name}" apagada. As contas continuam conectadas.`,
                        );
                        if (filter === f.id) setFilter("__todas__");
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </Card>

      {/* ---- Ações em massa ---- */}
      {canManage && selected.length > 0 ? (
        <Card className="border-accent/40">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{selected.length} selecionada(s)</span>
            <select
              className="w-48"
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const destino = v === SEM_PASTA ? null : v;
                const nome =
                  v === SEM_PASTA ? "sem pasta" : (folders.find((f) => f.id === v)?.name ?? "pasta");
                run(
                  () => assignAccountsToFolderAction(selected, destino),
                  (r: never) => `${(r as { moved: number }).moved} conta(s) movida(s) para ${nome}.`,
                );
                e.target.value = "";
              }}
            >
              <option value="">Mover para...</option>
              <option value={SEM_PASTA}>Sem pasta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              variant="danger"
              type="button"
              className="px-3 py-1.5 text-xs"
              disabled={pending}
              onClick={() =>
                run(
                  () => disconnectAccountsAction(selected),
                  (r: never) =>
                    `${(r as { disconnected: number }).disconnected} conta(s) desconectada(s).`,
                )
              }
            >
              Desconectar
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="px-2 py-1.5 text-xs"
              onClick={() => setSelected([])}
            >
              limpar seleção
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ---- Lista ---- */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={todasVisiveisMarcadas}
              onChange={(e) => {
                const ids = visiveis.map((a) => a.id);
                setSelected((p) =>
                  e.target.checked
                    ? [...new Set([...p, ...ids])]
                    : p.filter((x) => !ids.includes(x)),
                );
              }}
            />
            Selecionar {visiveis.length} do filtro
          </label>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo @, nome ou página"
            className="max-w-xs flex-1"
          />
          <span className="text-xs text-muted">
            {exibidas.length} de {visiveis.length}
          </span>
        </div>

        {visiveis.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            Nenhuma conta nesse filtro.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {exibidas.map((a) => {
              const s = ACCOUNT_STATUS[a.status];
              const used = a.quotaUsage ?? 0;
              const total = a.quotaTotal ?? 0;
              const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={selected.includes(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <Avatar src={a.profilePicUrl} name={a.igUsername} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">@{a.igUsername}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatNumber(a.followersCount)} seguidores
                      {a.pageName ? ` · ${a.pageName}` : ""} · {a.publishedCount} publicação(ões)
                      {a.tokenExpiresAt
                        ? ` · token até ${formatDateTime(new Date(a.tokenExpiresAt), timezone)}`
                        : ""}
                    </p>
                    {a.statusMessage ? (
                      <p className="mt-1 text-xs text-danger">{a.statusMessage}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {total > 0 ? (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className={`block h-full rounded-full ${pct >= 90 ? "bg-danger" : "bg-accent"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="text-xs tabular-nums text-muted">
                          {used}/{total}
                        </span>
                      </span>
                    ) : null}
                    {canManage ? (
                      a.status === "ACTIVE" ? (
                        <Button
                          variant="ghost"
                          type="button"
                          className="px-2 py-1 text-xs"
                          disabled={pending}
                          onClick={() => run(() => refreshQuotaAction(a.id))}
                        >
                          atualizar cota
                        </Button>
                      ) : (
                        <Link
                          href="/api/meta/connect"
                          className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
                        >
                          reconectar
                        </Link>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {visiveis.length > exibidas.length ? (
          <div className="border-t border-border px-5 py-3 text-center">
            <Button
              variant="secondary"
              type="button"
              className="px-3 py-1.5 text-xs"
              onClick={() => setLimite((v) => v + PAGINA)}
            >
              Mostrar mais {Math.min(PAGINA, visiveis.length - exibidas.length)} de{" "}
              {visiveis.length - exibidas.length} restantes
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function FolderChip({
  label,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-lg border px-1 text-sm transition",
        active ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2",
      ].join(" ")}
    >
      <button type="button" onClick={onClick} className="px-2 py-1.5">
        {label}
      </button>
      {onRename ? (
        <button
          type="button"
          onClick={onRename}
          title="Renomear"
          className="px-1 text-xs text-muted hover:text-text"
        >
          editar
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          title="Apagar pasta"
          className="px-1 pr-2 text-xs text-muted hover:text-danger"
        >
          apagar
        </button>
      ) : null}
    </span>
  );
}
