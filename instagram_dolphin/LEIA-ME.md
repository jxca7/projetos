# Como usar

## Uma vez só
1. Instale o **Node.js LTS** (https://nodejs.org).
2. Abra o `token.txt` e cole o token da API do Dolphin no lugar do texto que está lá.

## Toda vez
1. Jogue os arquivos de cookies (JSON) na pasta **`cookies/`**.
   **O nome do arquivo tem que ser o nome do perfil no Dolphin.**
   Exemplo: o perfil `maria` no Dolphin usa o arquivo `cookies/maria.json`.
2. Bio: escreva no **`bio.txt`**.
3. Foto: coloque um **`foto.jpg`** nesta pasta, do lado do `bio.txt`.
4. Com o Dolphin aberto, clique duas vezes em **`rodar.bat`**.

O script faz uma conta de cada vez. Os cookies das contas que deram certo vão para
`cookies/feitos/`. Os que deram erro continuam em `cookies/`, então é só rodar de novo
para tentar só esses.

## Opcional: bio ou foto diferente para cada conta
- Coloque `bios/maria.txt` ou `fotos/maria.jpg`, com o mesmo nome do arquivo de cookies.
- Uma conta que não tem arquivo próprio usa o `bio.txt` e o `foto.jpg` padrão.

Se der erro, aparece a mensagem na tela e um print é salvo na pasta `erros/`.
