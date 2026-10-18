# Instagram — tudo num menu só

Três tarefas no mesmo programa:
1. **Foto, bio e convite de testador**
2. **Conectar a conta no site**
3. **Testar cookies** (sem mexer em nada)

## Uma vez só
Instale o **Node.js LTS** (https://nodejs.org). O Microsoft Edge já vem no Windows.

## Como usar
Clique duas vezes em **`rodar.bat`**. Vai aparecer um menu — digite o número da tarefa e tecle Enter.

Os **cookies ficam todos na pasta `cookies/`** (um arquivo por conta, nome qualquer).
Formatos aceitos: JSON (Cookie-Editor), `cookies.txt` ou texto `sessionid=...; csrftoken=...; ds_user_id=...`.
O cookie precisa ter **sessionid, csrftoken e ds_user_id** — só o sessionid não basta.

As mesmas contas servem para as duas tarefas (foto/bio e conectar): quando uma dá certo, a conta
**não sai da pasta** — fica anotada em `feitos_perfil.txt` / `feitos_conectar.txt` e é pulada na
próxima vez. Para refazer tudo de uma tarefa, apague o `feitos_...txt` dela.
Cookies que não logam (mortos/IP) vão para `cookies/mortos/`.

---

## 1) Foto, bio e convite de testador
1. Jogue os cookies na pasta **`cookies/`**.
2. Bio: escreva no **`bio.txt`**. Foto: coloque um **`foto.jpg`** nesta pasta.
   (Bio/foto diferente por conta: `bios/<nome>.txt` e `fotos/<nome>.jpg`, onde `<nome>` é o nome do arquivo do cookie.)
3. No menu, escolha **1**.

Para cada conta: coloca os cookies, aceita o convite do testador, troca a foto e a bio.
Cada conta usa um perfil separado do Edge (pasta `navegador/`). Se o perfil ficar sem bio, ele avisa.

## 2) Conectar a conta no site
1. Coloque o link do site no **`site.txt`** e o login **do site** (email:senha) no **`site_login.txt`**.
2. Jogue os cookies na pasta **`cookies/`** (recomendado — pula login e 2FA).
   Se a pasta `cookies/` estiver vazia, ele usa o **`contas.txt`** (usuario:senha, uma por linha).
3. No menu, escolha **2**.

Ele clica em **+ Conectar Instagram → Conectar Instagram**, entra na conta e passa pelas telas:
**Mudar → Criador de conteúdo → Avançar → Blog pessoal → Concluir → Continuar → Permitir**.
No modo cookie, contas que pedem 2FA vão para `cookies/precisa_2fa/`.

## 3) Testar cookies (não altera nada)
1. Coloque os cookies para testar na pasta **`testar/`** (não na `cookies/`).
2. No menu, escolha **3** (ou **4** para ver as janelas abrindo).

Os que logaram vão para **`cookies_ok/`** (é só copiar para `cookies/`); os que falharam vão para
`testar/falharam/`. Um resumo fica em `resultado_cookies.txt`.

---

## Proxy (importante)
Crie um **`proxy.txt`** com `host:porta` ou `host:porta:usuario:senha`. **Use proxy do mesmo
IP/país de onde os cookies foram pegos** — senão o Instagram derruba a sessão e aparece "cookie morto".
O mesmo proxy vale para as três tarefas.

## Dicas para não tomar bloqueio
- Use proxy, de preferência do mesmo país das contas.
- Não conecte/poste em muitas contas de uma vez, muito rápido.
