# Instagram + Dolphin Anty: cookies, bio e foto de perfil

Para cada conta do `config.json`, o script:

1. Abre o perfil no Dolphin Anty (pela API local).
2. Injeta os cookies do Instagram (arquivo JSON).
3. Abre `instagram.com/accounts/edit/` e troca a foto de perfil.
4. Troca a biografia e salva.
5. Fecha o perfil e passa para a próxima conta.

## Instalação (uma vez só)

1. Instale o **Node.js LTS**: https://nodejs.org (próximo, próximo, concluir).
2. Copie esta pasta `instagram_dolphin` para o seu PC.
3. Pegue o **token da API do Dolphin**: no painel do Dolphin Anty (site), vá em
   *API* → gerar token. Copie o token.

## Configuração

1. Copie `config.exemplo.json` e renomeie a cópia para **`config.json`**.
2. Preencha o arquivo:
   - `dolphinToken`: o token copiado acima.
   - `perfilId`: o ID do perfil no Dolphin. Ele aparece ao passar o mouse no perfil
     ou na URL ao editar o perfil.
   - `cookies`: o caminho do JSON de cookies da conta. Coloque os arquivos na pasta `cookies/`.
   - `bio`: o texto da biografia, com até 150 caracteres. Para quebrar linha, use `\n`.
   - `foto`: o caminho da foto (JPG ou PNG). Coloque as fotos na pasta `fotos/`.

   Se quiser trocar só a bio, apague a linha `foto`. Para trocar só a foto, apague a linha `bio`.

3. Os cookies devem estar no formato JSON exportado pelo Cookie-Editor ou EditThisCookie,
   ou seja, uma lista de objetos com `name`, `value` e `domain`. É obrigatório ter o `sessionid`.

## Como rodar

- **Clique duas vezes em `rodar.bat`.** Na primeira vez ele instala as dependências sozinho.
- Para rodar só uma conta, abra o terminal na pasta e digite: `rodar.bat conta2`

**O Dolphin Anty precisa estar aberto** enquanto o script roda.

No final aparece um resumo com ✔ ou ✘ para cada conta. Se der erro, um print da tela
é salvo na pasta `erros/`.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| Falha ao autenticar no Dolphin | Verifique se o Dolphin está aberto e se o token está certo |
| Não consegui abrir o perfil | Verifique se o ID está certo e se o perfil já não está aberto |
| Não está logado | O cookie expirou ou a conta caiu em checkpoint: exporte cookies novos |
| Botão "Enviar"/"Alterar foto" não encontrado | O Instagram mudou o layout. Mande o print da pasta `erros/` para ajustar |

## Avisos

- **Não envie `config.json`, `cookies/` nem `fotos/` para o GitHub.** Os cookies dão acesso
  às contas. O `.gitignore` já bloqueia esses arquivos.
- O script faz pausas aleatórias entre as ações. Mesmo assim, automação vai contra os termos do
  Instagram, então use com moderação.
