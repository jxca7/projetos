# Conectar Instagram no site

## Uma vez só
1. Instale o **Node.js LTS** (https://nodejs.org).
2. Coloque o link do site no **`site.txt`**.
3. Coloque o e-mail e a senha **do site** no **`site_login.txt`**, no formato `email:senha`.
   Se o arquivo não existir, rode uma vez que ele é criado.

## Toda vez
Tem dois jeitos de entrar na conta. O script escolhe sozinho: **se tiver cookies na pasta
`cookies/`, ele usa cookie; se a pasta estiver vazia, ele usa o `contas.txt` (usuário e senha).**

### Jeito 1 — COOKIE (recomendado, pula o login e o 2FA)
1. Jogue os arquivos de cookies na pasta **`cookies/`**. Um arquivo por conta; o nome pode ser qualquer um.
   Formatos aceitos: JSON (Cookie-Editor), `cookies.txt` ou texto `sessionid=...; csrftoken=...; ds_user_id=...`.
   Dica: o cookie precisa ter **sessionid, csrftoken e ds_user_id**. Só o sessionid não basta.
2. Clique duas vezes em **`rodar.bat`**.

A conta já entra logada, então o script não digita login nem senha e **não cai no 2FA** —
vai direto para o "Permitir".

### Jeito 2 — USUÁRIO E SENHA
1. Deixe a pasta `cookies/` vazia e escreva as contas no **`contas.txt`**, uma por linha, `usuario:senha`:
   ```
   usuario1:senha1
   usuario2:senha2
   ```
   Se o arquivo não existir, rode uma vez que ele é criado.
2. Clique duas vezes em **`rodar.bat`**.

### O que o script faz em cada conta
1. Abre o site e fecha o pop-up da extensão ("Agora não").
2. Clica em **+ Conectar Instagram**, no canto superior direito, e depois em **Conectar Instagram** na janelinha.
3. Entra na conta (pelo cookie, ou digitando login e senha).
   No modo senha, **se pedir 2FA (código), pula a conta**.
4. Clica em **Agora não → Mudar → Criador de conteúdo → Avançar → Avançar → Blog pessoal →
   Concluir → Continuar → Concluir → Permitir** (na tela "... está solicitando acesso a: ...").
5. Desloga do Instagram e passa para a próxima conta.

**No modo cookie**, as contas que deram certo vão para `cookies/feitos/`, as que pediram 2FA para
`cookies/precisa_2fa/`, e os cookies que não logaram (mortos ou de outro IP) para `cookies/mortos/`.
**No modo senha**, as que deram certo saem do `contas.txt` e vão para o `feitos.txt`, as de 2FA para
o `2fa.txt`, e as de outro erro continuam no `contas.txt` (é só rodar de novo).
Se der erro, um print é salvo na pasta `erros/`.

## Se precisar fazer algo na mão
Se o `site_login.txt` estiver vazio ou errado, o script espera até 5 minutos para você entrar no
site na mão, na janela do Edge que ele abriu.


## Opcional
- **Proxy:** crie um `proxy.txt` com `host:porta` ou `host:porta:usuario:senha`.
