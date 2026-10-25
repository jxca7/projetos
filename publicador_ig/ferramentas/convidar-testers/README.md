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

## Usar o seu Chrome em vez de um navegador próprio

Por padrão o script abre um navegador com um perfil de automação próprio (você
loga uma vez e fica salvo). Se preferir usar o seu Chrome, abra-o em modo de
depuração e passe o endereço:

```bash
# feche o Chrome, depois abra assim (o caminho muda por sistema):
#   macOS:   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-meta"
#   Windows: "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-meta"
#   Linux:   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-meta"

CDP=http://localhost:9222 APP_ID=123456 node convidar.mjs
```

No modo CDP o script usa a janela que já está aberta e **não fecha** o seu
navegador no fim.

> O Chrome (versão 136+) bloqueia a depuração no seu perfil padrão por
> segurança — por isso o `--user-data-dir` aponta para uma pasta separada. É um
> perfil de automação onde você loga **uma vez**; depois fica salvo. Não há como
> automatizar a sua sessão principal já aberta; isso é regra do próprio Chrome.

## Opções (variáveis de ambiente)

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `APP_ID` | — | ID do app na Meta (obrigatório) |
| `CDP` | — | endereço do seu Chrome em modo de depuração (ex.: `http://localhost:9222`) |
| `LISTA` | `contas.txt` | arquivo com os @ |
| `MAX_POR_RUN` | `0` (todas) | limita quantas por execução |
| `PERFIL` | `.sessao-meta` | pasta do login salvo e dos registros |
| `PAUSA` | `1500` | ms entre uma conta e a próxima |

A pasta `.sessao-meta/` guarda o seu login — **não suba para o Git** (já está no
`.gitignore`).
