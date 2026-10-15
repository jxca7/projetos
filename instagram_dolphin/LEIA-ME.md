# Como usar

## Uma vez só
Instale o **Node.js LTS** (https://nodejs.org). O Microsoft Edge já vem no Windows.

## Toda vez
1. Jogue os arquivos de cookies na pasta **`cookies/`**. O nome dos arquivos pode ser qualquer um.
   Formatos aceitos: JSON, cookies.txt ou texto `sessionid=...; csrftoken=...`.
2. Bio: escreva no **`bio.txt`**.
3. Foto: coloque um **`foto.jpg`** nesta pasta, do lado do `bio.txt`.
4. Clique duas vezes em **`rodar.bat`**.

O script abre o Edge para uma conta de cada vez, coloca os cookies, troca a foto e a bio,
aceita os convites do testador (Permissões do site do app > Apps e sites > Convites do testador)
e fecha. Cada conta usa um perfil separado do Edge, guardado na pasta `navegador/`, então
o seu Edge normal não é mexido. As contas que deram certo vão para `cookies/feitos/`. As que
deram erro continuam em `cookies/`, então é só rodar de novo.

## Opcional
- **Proxy:** crie um `proxy.txt` com `host:porta` ou `host:porta:usuario:senha`.
  O mesmo proxy é usado para todas as contas.
- **Bio ou foto diferente por conta:** se o cookie se chama `maria.json`, crie
  `bios/maria.txt` ou `fotos/maria.jpg`. Uma conta sem arquivo próprio usa o `bio.txt`
  e o `foto.jpg` padrão.

Se der erro, aparece a mensagem na tela e um print é salvo na pasta `erros/`.
