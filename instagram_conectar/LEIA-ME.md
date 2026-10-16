# Conectar Instagram no site

## Uma vez só
1. Instale o **Node.js LTS** (https://nodejs.org).
2. Coloque o link do site no **`site.txt`**.
3. Coloque o e-mail e a senha **do site** no **`site_login.txt`**, no formato `email:senha`.
   Se o arquivo não existir, rode uma vez que ele é criado.

## Toda vez
1. Escreva as contas no **`contas.txt`**, uma por linha, no formato `usuario:senha`:
   ```
   usuario1:senha1
   usuario2:senha2
   ```
   Se o arquivo não existir, rode uma vez que ele é criado.
2. Clique duas vezes em **`rodar.bat`**.

Para cada conta, o script:
1. Abre o site e fecha o pop-up da extensão ("Agora não").
2. Clica em **+ Conectar Instagram**, no canto superior direito, e depois em **Conectar Instagram** na janelinha.
3. Entra na conta do Instagram com o login e a senha.
   **Se pedir 2FA (código), pula a conta**: ela vai para o `2fa.txt` e o script passa para a próxima.
4. Clica em **Agora não → Mudar → Criador de conteúdo → Avançar → Avançar → Blog pessoal →
   Concluir → Continuar → Concluir → Permitir** (na tela "... está solicitando acesso a: ...").
5. Desloga do Instagram e passa para a próxima conta.

As contas que deram certo saem do `contas.txt` e vão para o `feitos.txt`. As que pediram 2FA vão
para o `2fa.txt`. As que deram outro erro continuam no `contas.txt`, então é só rodar de novo.
Se der erro, um print é salvo na pasta `erros/`.

## Se precisar fazer algo na mão
Se o `site_login.txt` estiver vazio ou errado, o script espera até 5 minutos para você entrar no
site na mão, na janela do Edge que ele abriu.


## Opcional
- **Proxy:** crie um `proxy.txt` com `host:porta` ou `host:porta:usuario:senha`.
