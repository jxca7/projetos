# ig-downloader (vendorizado)

`reels.py` é o downloader de Reels/destaques do Instagram do próprio projeto
(branch `claude/instagram-reels-downloader-bkjo1e`), copiado para cá para ser o
motor de importação da Biblioteca. O worker o chama como subprocesso.

- Dependências: `python3`, `ffmpeg`, `curl_cffi`, `requests[socks]` (instaladas
  na imagem Docker).
- É chamado sempre com argumentos posicionais, então roda sem perguntar nada.
- Para atualizar: copie a versão nova do script da branch acima por cima deste
  arquivo e rebuild da imagem.

Não editar à mão: mudanças devem vir da branch de origem.
