# Postar story com link

## Uma vez só
Instale o **Python**: https://www.python.org/downloads/
Na primeira tela do instalador, **marque "Add python.exe to PATH"**.

## Toda vez
1. Jogue os arquivos de cookies na pasta **`cookies/`**. O nome dos arquivos pode ser qualquer um.
   Formatos aceitos: JSON, cookies.txt ou texto `sessionid=...`. O que importa é o `sessionid`.
2. Coloque a imagem do story nesta pasta com o nome **`story.jpg`** (PNG também serve).
3. Escreva o link na 1ª linha do **`link.txt`**. Se deixar vazio, o story vai sem link.
   Na 2ª linha, se quiser, coloque o texto que aparece na figurinha. Se não colocar, aparece o domínio do link.
4. (Opcional) Para destacar o story: escreva o nome do destaque no **`destaque.txt`**. Se já existir um
   destaque com esse nome, o story entra nele; se não, cria um novo. Vazio = não destaca.
5. Clique duas vezes em **`rodar.bat`**. Na primeira vez ele instala tudo sozinho, e demora uns minutos.

O script posta em uma conta de cada vez, esperando de 1 a 3 minutos entre elas. As contas que
deram certo vão para `cookies/feitos/`. As que deram erro continuam em `cookies/` e ficam
anotadas no `erros.txt`.

## Tempo de espera entre as contas
Por padrão, o script espera de **30 a 90 segundos** depois de cada conta que postou
(isso evita bloqueio). As contas que falharam (2FA, cookie morto) esperam só uns segundos.
Para mudar, crie o **`intervalo.txt`** com `min-max` (ex.: `20-60`) ou um número só (ex.: `40`).
Quanto menor, mais rápido — e maior o risco de bloqueio.

## Opcional
- **Proxy:** crie um `proxy.txt` com `host:porta` ou `host:porta:usuario:senha`.

## Dicas para não tomar bloqueio
- Use proxy, de preferência do mesmo país das contas.
- Não use encurtador de link (bit.ly e parecidos).
- Não poste o mesmo link em muitas contas de uma vez.
