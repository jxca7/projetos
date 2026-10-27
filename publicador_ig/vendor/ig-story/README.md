# ig-story (vendorizado)

`postar_story.py` é o postador de stories do projeto `instagram_tudo`
(branch `claude/great-fermat-rymemy`), copiado para cá para ser o motor do
recurso "Story com link e destaque (pelo app)".

Posta pela API do app do Instagram (instagrapi), logando por **usuário e senha**
(ou sessionid), com figurinha de link e adição ao destaque — coisas que a API
oficial da Meta não faz.

- Dependências: `python3`, `instagrapi`, `Pillow`, e a fonte `DejaVuSans-Bold`
  (instaladas na imagem Docker).
- O worker roda o script numa pasta temporária por conta, montada com
  `story.jpg`, `link.txt`, `destaque.txt` e `contas.txt` (uma conta).
- Para atualizar: copie a versão nova da branch de origem por cima e rebuild.
