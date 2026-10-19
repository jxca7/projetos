# Instagram — tudo num menu só

No mesmo programa:
1. **Foto/bio + Conectar (tudo de uma vez)** — para cada conta, faz a foto/bio/convite **e** já conecta no site, numa passada só.
2. **Só foto, bio e convite de testador**
3. **Só conectar a conta no site**
4. **Testar cookies** (sem mexer em nada)

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

## 1) Foto/bio + Conectar (tudo de uma vez)  ← só por cookie
Faz tudo para cada conta, numa passada só: entra logado pelo cookie, aceita o convite do testador,
troca a foto e a bio, e **já conecta no site** (como a conta já está logada, vai direto para o "Permitir").
1. Jogue os cookies na pasta **`cookies/`**.
2. Preencha o que a foto/bio e o conectar precisam (veja as opções 2 e 3 abaixo): `bio.txt`, `foto.jpg`,
   `site.txt`, `site_login.txt` e o **`contas.txt`** (veja a observação abaixo).
3. No menu, escolha **1**.

Se a foto ou a bio derem erro, ele avisa mas **mesmo assim tenta conectar**. Contas que deram certo
são anotadas e puladas da próxima vez (apague `feitos_tudo.txt` para refazer).

> **Importante:** a tela "Conectar Instagram" do site abre um login próprio e **pede a senha mesmo
> usando cookie** (o cookie só adianta a foto/bio e o login do site). Por isso, coloque a senha de
> cada conta no **`contas.txt`** (`usuario:senha`, uma por linha). O script descobre o @usuário pelo
> cookie e pega a senha certa ali. Contas com **2FA** vão para `cookies/precisa_2fa/`.

## 2) Só foto, bio e convite de testador
1. Jogue os cookies na pasta **`cookies/`**.
2. Bio: escreva no **`bio.txt`**. Foto: coloque um **`foto.jpg`** nesta pasta.
   (Bio/foto diferente por conta: `bios/<nome>.txt` e `fotos/<nome>.jpg`, onde `<nome>` é o nome do arquivo do cookie.)
3. No menu, escolha **2**.

Para cada conta: coloca os cookies, aceita o convite do testador, troca a foto e a bio.
Cada conta usa um perfil separado do Edge (pasta `navegador/`). Se o perfil ficar sem bio, ele avisa.

## 3) Só conectar a conta no site
1. Coloque o link do site no **`site.txt`** e o login **do site** (email:senha) no **`site_login.txt`**.
2. Coloque a senha de cada conta no **`contas.txt`** (`usuario:senha`, uma por linha).
3. Jogue os cookies na pasta **`cookies/`** (o cookie entra logado e já traz o @usuário da conta).
   Se a pasta `cookies/` estiver vazia, ele usa direto o **`contas.txt`** (login por usuário e senha).
4. No menu, escolha **3**.

Ele clica em **+ Conectar Instagram → Conectar Instagram**, entra na conta e passa pelas telas:
**Mudar → Criador de conteúdo → Avançar → Blog pessoal → Concluir → Continuar → Permitir**.

> A tela "Conectar Instagram" abre um login próprio do Instagram e **pede a senha mesmo com cookie**.
> Por isso o `contas.txt` é necessário aqui. O script acha a senha pelo @usuário que o cookie trouxe.
> Contas que pedem **2FA** vão para `cookies/precisa_2fa/`.

## 4) Testar cookies (não altera nada)
1. Coloque os cookies para testar na pasta **`testar/`** (não na `cookies/`).
2. No menu, escolha **4** (ou **5** para ver as janelas abrindo).

Os que logaram vão para **`cookies_ok/`** (é só copiar para `cookies/`); os que falharam vão para
`testar/falharam/`. Um resumo fica em `resultado_cookies.txt`.

## 6) Postar story (com link e destaque)
Fica na pasta **`story\`** (é em Python; na 1ª vez ele instala sozinho — precisa do **Python 3.12**).
1. Coloque os cookies das contas na pasta **`story\cookies\`** (separada da `cookies\` principal).
2. Coloque a imagem como **`story\story.jpg`**.
3. No **`story\link.txt`**: 1ª linha o link, 2ª linha (opcional) o texto da figurinha.
4. (Opcional) No **`story\destaque.txt`**: o nome do destaque.
5. No menu, escolha **6**.

O proxy é o mesmo `proxy.txt` da pasta principal (ou um `story\proxy.txt` próprio).

> Por que às vezes dá `login_required` / `PhotoNotUpload`: o story é enviado pela API do app do
> Instagram, que é bem mais rígida que o site. Ela pode recusar uma sessão de cookie que funciona no
> navegador — e quando isso começa a acontecer depois de ter funcionado, é o próprio Instagram
> limitando aquelas contas. Isso não é algo que o script consiga resolver.

---

## Proxy (importante)
Crie um **`proxy.txt`** com `host:porta` ou `host:porta:usuario:senha`. **Use proxy do mesmo
IP/país de onde os cookies foram pegos** — senão o Instagram derruba a sessão e aparece "cookie morto".
O mesmo proxy vale para as três tarefas.

## Dicas para não tomar bloqueio
- Use proxy, de preferência do mesmo país das contas.
- Não conecte/poste em muitas contas de uma vez, muito rápido.
