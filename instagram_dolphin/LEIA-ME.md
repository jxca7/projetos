# Como usar

## Uma vez só
1. Instale o **Node.js LTS** (https://nodejs.org).
2. Abra o `token.txt` e cole o token da API do Dolphin no lugar do texto que está lá.
3. Abra o `perfil.txt` e escreva o **nome do perfil do Dolphin** que vai ser usado.
   Se você só tem um perfil no Dolphin, pode deixar o arquivo vazio.

## Toda vez
1. Jogue os arquivos de cookies (JSON) na pasta **`cookies/`**. O nome dos arquivos pode ser qualquer um.
2. Bio: escreva no **`bio.txt`**.
3. Foto: coloque um **`foto.jpg`** nesta pasta, do lado do `bio.txt`.
4. Com o Dolphin aberto, clique duas vezes em **`rodar.bat`**.

O script usa o mesmo perfil para todas as contas, uma de cada vez. Antes de cada conta,
ele apaga os cookies do Instagram da conta anterior. As contas que deram certo vão para
`cookies/feitos/`. As que deram erro continuam em `cookies/`, então é só rodar de novo.

## Opcional: bio ou foto diferente para cada conta
- Se o cookie se chama `maria.json`, crie `bios/maria.txt` ou `fotos/maria.jpg`.
- Uma conta que não tem arquivo próprio usa o `bio.txt` e o `foto.jpg` padrão.

Se der erro, aparece a mensagem na tela e um print é salvo na pasta `erros/`.
