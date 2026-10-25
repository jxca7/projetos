# Convidar Testadores do Instagram em massa

Macro que repete, no **seu** painel da Meta e com o **seu** login, a sequência
de adicionar um Testador do Instagram — para você não digitar conta por conta.

## O que ele faz e o que não faz

- **Faz:** para cada @ da sua lista, clica em *Adicionar pessoas*, marca
  *Testador do Instagram*, digita o @, seleciona e clica em *Adicionar*.
- **Não faz:** aceitar o convite. Isso continua sendo em cada conta, no app do
  Instagram (Editar perfil → Apps e sites → Convites de testador).

## Avisos (leia antes)

- **Automatizar a interface da Meta vai contra os termos de desenvolvedor
  deles.** O risco é da sua conta de dev. A decisão de usar é sua.
- É **frágil**: quando a Meta muda o layout, os seletores quebram. Os textos dos
  botões ficam no topo de `convidar.mjs`, em `TEXTOS`, fáceis de ajustar.
- **Não testei contra o painel real** (precisa do seu login). Na primeira vez,
  rode com poucas contas (`MAX_POR_RUN=3`) e acompanhe a janela. Se travar, há
  um print do erro salvo em `.sessao-meta/erro-<conta>.png`.
- A **forma definitiva** de não precisar disto é sair do modo de desenvolvimento
  (App Review): em produção, a conta conecta por OAuth e não há tester nenhum.

## Como usar

Precisa de Node 18+ e Playwright. Dentro desta pasta:

```bash
npm init -y
npm install playwright
npx playwright install chromium

# monte a lista
cp contas.exemplo.txt contas.txt
# edite contas.txt com os seus @ (um por linha)

# rode (troque 123456 pelo ID do seu app na Meta)
APP_ID=123456 MAX_POR_RUN=3 node convidar.mjs
```

Na primeira execução, uma janela do navegador abre: **faça login na Meta** (e o
2FA, se pedir). Quando a página de *Funções do app* aparecer, volte ao terminal
e tecle Enter. O login fica salvo em `.sessao-meta/` e é reaproveitado depois.

Ele pula quem já foi convidado (guarda em `.sessao-meta/convidadas.txt`), então
pode rodar em tandas: `MAX_POR_RUN=3`, conferir, depois aumentar.

## Opções (variáveis de ambiente)

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `APP_ID` | — | ID do app na Meta (obrigatório) |
| `LISTA` | `contas.txt` | arquivo com os @ |
| `MAX_POR_RUN` | `0` (todas) | limita quantas por execução |
| `PERFIL` | `.sessao-meta` | pasta do login salvo e dos registros |
| `PAUSA` | `1500` | ms entre uma conta e a próxima |

A pasta `.sessao-meta/` guarda o seu login — **não suba para o Git** (já está no
`.gitignore`).
