"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  activateMetaAppAction,
  deleteMetaAppAction,
  saveMetaAppAction,
} from "@/app/actions";
import { Badge, Button, Card, Field, Notice } from "@/components/ui";

export interface MetaAppRow {
  id: string;
  name: string;
  appId: string;
  graphVersion: string;
  isActive: boolean;
  notes: string | null;
  accountCount: number;
}

/** Cada app do Meta aguenta no máximo 50 testers. */
export const TESTERS_POR_APP = 50;

export function MetaAppsManager({
  apps,
  totalContas,
  contasSemApp,
}: {
  apps: MetaAppRow[];
  totalContas: number;
  contasSemApp: number;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState(apps.length === 0);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>, sucesso?: (r: never) => string) {
    setMsg(null);
    startTransition(async () => {
      const r = (await fn()) as { ok: boolean; error?: string } & Record<string, unknown>;
      if (!r.ok) {
        setMsg({ tone: "danger", text: r.error ?? "Não foi possível concluir." });
        return;
      }
      if (sucesso) setMsg({ tone: "ok", text: sucesso(r as never) });
      setEditando(null);
      setCriando(false);
      router.refresh();
    });
  }

  const capacidade = apps.length * TESTERS_POR_APP;

  return (
    <div className="space-y-5">
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {apps.length > 0 ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Capacidade de contas</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                {totalContas}{" "}
                <span className="text-base font-normal text-muted">
                  de ~{capacidade} ({apps.length} app
                  {apps.length > 1 ? "s" : ""} × {TESTERS_POR_APP} testers)
                </span>
              </p>
            </div>
            {totalContas > capacidade ? (
              <Badge tone="danger">
                Faltam ~{Math.ceil((totalContas - capacidade) / TESTERS_POR_APP)} app(s)
              </Badge>
            ) : (
              <Badge tone="ok">Folga para {capacidade - totalContas}</Badge>
            )}
          </div>
          {contasSemApp > 0 ? (
            <p className="mt-3 text-sm text-warn">
              {contasSemApp} conta(s) sem app vinculado. Foram conectadas antes do cadastro de
              apps e usam as credenciais do .env — reconecte-as para amarrar ao app certo.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="space-y-3">
        {apps.map((app) =>
          editando === app.id ? (
            <AppForm
              key={app.id}
              inicial={app}
              pending={pending}
              onCancel={() => setEditando(null)}
              onSubmit={(dados) =>
                run(
                  () => saveMetaAppAction(dados, app.id),
                  () => `App "${dados.name}" atualizado.`,
                )
              }
            />
          ) : (
            <Card key={app.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    {app.isActive ? <Badge tone="ok">Ativo</Badge> : null}
                    <Badge>{app.graphVersion}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">App ID: {app.appId}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    App Secret guardado cifrado · {app.accountCount} de {TESTERS_POR_APP} contas
                  </p>
                  {app.notes ? <p className="mt-1 text-sm text-muted">{app.notes}</p> : null}
                  {app.accountCount >= TESTERS_POR_APP ? (
                    <p className="mt-1 text-sm text-danger">
                      Este app atingiu o limite de testers. Cadastre outro app para conectar mais
                      contas.
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {!app.isActive ? (
                    <Button
                      variant="secondary"
                      type="button"
                      className="px-2.5 py-1.5 text-xs"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => activateMetaAppAction(app.id),
                          () => `"${app.name}" agora é o app das próximas conexões.`,
                        )
                      }
                    >
                      Usar este app
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-2.5 py-1.5 text-xs"
                    onClick={() => setEditando(app.id)}
                  >
                    editar
                  </Button>
                  <Button
                    variant="danger"
                    type="button"
                    className="px-2.5 py-1.5 text-xs"
                    disabled={pending}
                    onClick={() => {
                      const aviso =
                        app.accountCount > 0
                          ? `Apagar "${app.name}"? As ${app.accountCount} conta(s) conectadas por ele PARAM de publicar até serem reconectadas — o token delas só é aceito com o secret deste app.`
                          : `Apagar "${app.name}"?`;
                      if (window.confirm(aviso)) {
                        run(
                          () => deleteMetaAppAction(app.id),
                          (r: never) => {
                            const n = (r as { afetadas: number }).afetadas;
                            return n > 0
                              ? `App apagado. ${n} conta(s) marcadas para reconectar.`
                              : "App apagado.";
                          },
                        );
                      }
                    }}
                  >
                    apagar
                  </Button>
                </div>
              </div>
            </Card>
          ),
        )}
      </div>

      {criando ? (
        <AppForm
          pending={pending}
          onCancel={apps.length > 0 ? () => setCriando(false) : undefined}
          onSubmit={(dados) =>
            run(
              () => saveMetaAppAction(dados),
              () => `App "${dados.name}" cadastrado.`,
            )
          }
        />
      ) : (
        <Button type="button" onClick={() => setCriando(true)}>
          Cadastrar outro app
        </Button>
      )}

      {apps.length > 0 ? (
        <Card className="bg-surface-2">
          <p className="text-sm text-muted">
            Depois de cadastrar, vá em{" "}
            <Link href="/contas" className="text-accent hover:underline">
              Contas
            </Link>{" "}
            e use <strong className="text-text">Conectar Instagram</strong>. A autorização usa o
            app marcado como ativo, e cada conta fica amarrada ao app que a conectou.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function AppForm({
  inicial,
  pending,
  onCancel,
  onSubmit,
}: {
  inicial?: MetaAppRow;
  pending: boolean;
  onCancel?: () => void;
  onSubmit: (dados: {
    name: string;
    appId: string;
    appSecret: string;
    graphVersion: string;
    notes?: string;
  }) => void;
}) {
  const [name, setName] = useState(inicial?.name ?? "");
  const [appId, setAppId] = useState(inicial?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [graphVersion, setGraphVersion] = useState(inicial?.graphVersion ?? "v23.0");
  const [notes, setNotes] = useState(inicial?.notes ?? "");

  return (
    <Card className="border-accent/40">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name, appId, appSecret, graphVersion, notes: notes || undefined });
        }}
      >
        <h3 className="font-semibold">{inicial ? `Editar ${inicial.name}` : "Novo app do Meta"}</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" hint="Só para você identificar. Ex.: Clientes A.">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="App ID" hint="Identificação do aplicativo, no painel da Meta.">
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              inputMode="numeric"
              required
            />
          </Field>
          <Field
            label="App Secret"
            hint={
              inicial
                ? "Preencha para substituir o secret guardado."
                : "Em Configurações do app → Básico → Chave Secreta."
            }
          >
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              required={!inicial}
              autoComplete="off"
            />
          </Field>
          <Field label="Versão da Graph API" hint="Suba junto com os deprecations da Meta.">
            <input value={graphVersion} onChange={(e) => setGraphVersion(e.target.value)} />
          </Field>
        </div>

        <Field label="Observações (opcional)">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: app do cliente X, contas 1 a 50"
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {inicial ? "Salvar" : "Cadastrar app"}
          </Button>
          {onCancel ? (
            <Button variant="ghost" type="button" onClick={onCancel}>
              cancelar
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
