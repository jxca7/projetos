# Postar story no MuMu (com link) — automação do app real

Aqui a gente controla o **app de verdade** do Instagram dentro do MuMu, então o **link no story
funciona** (coisa que a API não deixa). O script abre cada clone do Instagram e posta sozinho.

> Risco: várias contas no mesmo emulador (mesmo aparelho/IP) é sinal de fazenda de contas para o
> Instagram. Use com cuidado; proxy ajuda, mas não zera o risco.

## 1) Preparar o MuMu (uma vez)
1. No MuMu, **clone o Instagram** quantas vezes quiser (recurso de clonar app do MuMu).
2. **Entre na conta em cada clone** na mão (só a primeira vez).
3. Ative o **ADB** nas configurações do MuMu (às vezes "Modo desenvolvedor" ou "ADB"). Anote a **porta**.

## 2) Preparar o PC (uma vez)
1. Instale o **Python 3.12** (https://www.python.org/downloads/release/python-3127/) — marque "Add to PATH".
2. Nesta pasta, rode:  `pip install -r requirements.txt`
3. Instale o **adb** (vem no "Android platform-tools") e conecte no MuMu:
   `adb connect 127.0.0.1:PORTA`  (troque PORTA pela do MuMu).
   Se a porta não for a padrão, defina antes de rodar:  `set MUMU_ADB=127.0.0.1:PORTA`

## 3) Diagnóstico (pra eu calibrar os toques)
Antes de postar, preciso ver a tela do seu Instagram, porque os botões mudam por versão/idioma.
1. Liste os clones:  `python diagnostico.py`
2. Abra um deles e salve a tela:  `python diagnostico.py <pacote_do_clone>`
3. Isso gera **`tela.png`** e **`tela.xml`** — me mande os dois que eu acerto os cliques.

## 4) Postar (depois de calibrado)
_(em construção — o `postar_emulador.py` vai ler a lista de clones, a imagem e o link, e postar em cada um.)_
