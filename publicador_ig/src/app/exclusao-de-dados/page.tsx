export const metadata = {
  title: "Exclusão de dados · Publicador IG",
  description: "Acompanhamento de pedidos de exclusão de dados.",
};

/**
 * Página pública apontada pela resposta do callback de exclusão de dados.
 *
 * A Meta devolve este endereço à pessoa que pediu a exclusão, e verifica que
 * ele existe. Sem ela, o cadastro do app é reprovado.
 */
export default async function ExclusaoDeDadosPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { codigo } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Exclusão de dados</h1>

      {codigo ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Código de confirmação</p>
          <p className="mt-1 font-mono text-lg break-all">{codigo}</p>
          <p className="mt-3 text-sm">
            O pedido foi processado. Os dados da conta do Instagram associada a este código foram
            removidos.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Esta página mostra o andamento de um pedido de exclusão. O código de confirmação chega
          pelo Instagram, ao remover o aplicativo.
        </p>
      )}

      <section className="mt-8 space-y-3 text-sm text-muted">
        <h2 className="font-medium text-text">O que é removido</h2>
        <p>
          Ao receber o pedido, apagamos o registro da conta conectada: o token de acesso guardado,
          as publicações feitas por ela através da plataforma, as métricas coletadas e o histórico
          de eventos.
        </p>
        <p>
          As publicações que já foram ao ar no Instagram <strong>não</strong> são removidas por
          aqui — elas pertencem à conta e só podem ser apagadas no próprio aplicativo do Instagram.
        </p>
        <h2 className="pt-2 font-medium text-text">Como pedir a exclusão</h2>
        <p>
          No Instagram, abra Configurações → Apps e sites, encontre este aplicativo e remova o
          acesso. O pedido chega automaticamente e o código de confirmação é exibido.
        </p>
      </section>
    </main>
  );
}
