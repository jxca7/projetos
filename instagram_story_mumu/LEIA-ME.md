# Postar story no MuMu (com link) — automação do app real

Aqui a gente controla o **app de verdade** do Instagram dentro do MuMu, então o **link no story
funciona** (coisa que a API não deixa). O script abre cada clone do Instagram e posta sozinho.

> Risco: várias contas no mesmo emulador (mesmo aparelho/IP) é sinal de fazenda de contas para o
> Instagram. Use com cuidado; proxy ajuda, mas não zera o risco.

## 1) Preparar o MuMu (uma vez)
1. No MuMu, **clone o Instagram** quantas vezes quiser (recurso de clonar app do MuMu).
2. **Entre na conta em cada clone** na mão (só a primeira vez).
3. Em **Opções do desenvolvedor → Depuração ADB**, escolha **"Habilitar conexão local"** e **reinicie o MuMu**.
   (Não precisa escolher porta — o script acha sozinho.)

## 2) Preparar o PC (uma vez)
1. Instale o **Python 3.12** (https://www.python.org/downloads/release/python-3127/) — marque "Add to PATH".
2. Nesta pasta, rode:  `pip install -r requirements.txt`
3. Instale o **adb** (vem no "Android platform-tools"). O script acha a porta do MuMu sozinho;
   se precisar forçar, rode antes:  `set MUMU_ADB=127.0.0.1:PORTA`

## 3) Diagnóstico (pra eu calibrar os toques)
Antes de postar, preciso ver a tela do seu Instagram, porque os botões mudam por versão/idioma.
1. Liste os clones:  `python diagnostico.py`
2. Abra um deles e salve a tela:  `python diagnostico.py <pacote_do_clone>`
3. Isso gera **`tela.png`** e **`tela.xml`** — me mande os dois que eu acerto os cliques.

## 4) Postar (v1 — calibracao)
1. Coloque a imagem como **`imagem.jpg`** nesta pasta.
2. No **`link.txt`**: 1a linha o link, 2a linha (opcional) o texto da figurinha.
3. (Opcional) **`clones.txt`**: quais clones (ex.: `1-10` ou `1,3,5`). Vazio = todos.
4. Dois cliques no **`rodar.bat`** e digite **`postar`**.

Esta primeira versao tira um **print de cada passo** na pasta **`passos/`**. Rode em 1 clone,
depois me mande a pasta `passos/` para eu acertar os cliques que faltam (abrir story, escolher
foto e compartilhar). O botao do link ja esta mapeado ("Sticker de ligacao").
