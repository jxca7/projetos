#!/usr/bin/env python3
"""
Downloader de Reels do Instagram na MELHOR qualidade possivel.

Baixa os N reels mais recentes de uma conta (ou links avulsos). Para cada reel
pega a faixa de video de maior resolucao/bitrate e a melhor faixa de audio
(o Instagram entrega separadas, em DASH) e junta com o ffmpeg SEM recodificar.

Uso:
    python3 reels.py                          # modo interativo (pergunta tudo)
    python3 reels.py nome_da_conta -n 10      # os 10 reels mais recentes
    python3 reels.py nome_da_conta -n 0       # todos
    python3 reels.py https://www.instagram.com/reel/XXXX/ [outros links...]

Precisa de um cookies.txt (formato Netscape) de uma conta logada no Instagram.
Por padrao procura "cookies.txt" na pasta atual e na pasta do script.
"""
import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from urllib.parse import quote, urlsplit

# curl_cffi conecta exatamente como o Chrome (o Instagram bloqueia conexoes
# com "cara" de Python). Se nao estiver instalado, usa o requests comum.
def _instalar_curl_cffi():
    print("Instalando a biblioteca curl_cffi (so na primeira vez)...", flush=True)
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "curl_cffi"])
    return r.returncode == 0


try:
    from curl_cffi import requests as http
    CHROME = True
except ImportError:
    import importlib
    if _instalar_curl_cffi():
        importlib.invalidate_caches()
        try:
            from curl_cffi import requests as http
            CHROME = True
        except ImportError as e:
            print(f"curl_cffi instalou mas nao carregou: {e}", flush=True)
            if "too long" in str(e) or "muito long" in str(e):
                print("\n>>> O caminho da pasta e longo demais para o Windows. Mova a pasta do\n"
                      ">>> programa para C:\\reels, apague a pasta .venv e rode o instalar.bat.\n",
                      flush=True)
try:
    CHROME
except NameError:
    try:
        import requests as http
    except ImportError:
        sys.exit("Faltam bibliotecas. Rode o instalar.bat (ou pip install -r requirements.txt)")
    CHROME = False
ERROS_REDE = (http.exceptions.RequestException,)

VERSAO = "2026-10-16f"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
IG = "https://www.instagram.com"
ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


class ErroInstagram(Exception):
    pass


def log(msg="", erro=False):
    print(msg, file=sys.stderr if erro else sys.stdout, flush=True)


# --------------------------------------------------------------------------- pastas
# reels\              <- cookies.txt, proxy.txt e os .bat
#   videos\<conta>\   <- os reels baixados
#   sistema\          <- este programa, Python, ffmpeg e dados/ (historico, listas)
AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent if AQUI.name == "sistema" else AQUI
PASTA_VIDEOS = RAIZ / "videos" if AQUI.name == "sistema" else Path.cwd()
PASTA_DADOS = AQUI / "dados"


def dados_da_conta(nome):
    pasta = PASTA_DADOS / nome
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def organizar_pastas_antigas():
    """Move as pastas reels_<conta> do formato antigo para videos/<conta>,
    e o historico (baixados.txt, lista_reels.json) para sistema/dados/<conta>."""
    if AQUI.name != "sistema":
        return
    for arq in (RAIZ / "ids_das_contas.txt", AQUI / "ids_das_contas.txt"):
        if arq.is_file() and not (PASTA_DADOS / arq.name).exists():
            PASTA_DADOS.mkdir(parents=True, exist_ok=True)
            shutil.move(str(arq), PASTA_DADOS / arq.name)
    for velha in RAIZ.glob("reels_*"):
        if not velha.is_dir():
            continue
        nome = velha.name[len("reels_"):]
        dados = dados_da_conta(nome)
        for arq in ("baixados.txt", "lista_reels.json"):
            if not (velha / arq).exists():
                continue
            if arq == "baixados.txt" and (dados / arq).exists():
                with open(dados / arq, "a") as f:
                    f.write("\n" + (velha / arq).read_text())
                (velha / arq).unlink()
            else:
                shutil.move(str(velha / arq), dados / arq)
        destino = PASTA_VIDEOS / nome
        destino.mkdir(parents=True, exist_ok=True)
        for item in velha.iterdir():
            if not (destino / item.name).exists():
                shutil.move(str(item), destino / item.name)
        try:
            velha.rmdir()
            log(f"(organizado: {velha.name} -> videos\\{nome})")
        except OSError:
            pass


# --------------------------------------------------------------------------- sessao

def achar_cookies(caminho):
    if caminho:
        return Path(caminho)
    for pasta in (RAIZ, AQUI, Path.cwd(), Path.home() / "Downloads"):
        for nome in ("cookies.txt", "www.instagram.com_cookies.txt", "cookies.txt.txt"):
            if (pasta / nome).exists():
                return pasta / nome
    sys.exit(f"Nao achei o cookies.txt. Coloque o arquivo na pasta {RAIZ} ou use --cookies CAMINHO.")


def ler_proxy(valor):
    """Le o proxy do argumento ou do arquivo proxy.txt e devolve no formato de URL.

    Aceita (http ou socks5):
        socks5://host:porta:usuario:senha     |   host:porta:usuario:senha  (http)
        socks5://usuario:senha@host:porta     |   http://usuario:senha@host:porta
    """
    if not valor:
        for pasta in (RAIZ, AQUI, Path.cwd()):
            arq = next((pasta / n for n in ("proxy.txt", "proxy.txt.txt", "proxy")
                        if (pasta / n).is_file()), None)
            if arq:
                linhas = [l.strip() for l in arq.read_text(encoding="utf-8-sig").splitlines()]
                valor = next((l for l in linhas if l and not l.startswith("#")), None)
                break
    if not valor:
        return None
    valor = valor.strip()
    esquema = "http"
    if "://" in valor:
        esquema, valor = valor.split("://", 1)
        esquema = esquema.lower()
    if esquema == "socks5":
        esquema = "socks5h"  # resolve os enderecos pelo proxy tambem
    partes = valor.split(":", 3)
    if len(partes) == 4 and partes[1].isdigit():
        host, porta, usuario, senha = partes
        return f"{esquema}://{quote(usuario, safe='')}:{quote(senha, safe='')}@{host}:{porta}"
    return f"{esquema}://{valor}"


def nova_sessao(proxy=None):
    s = http.Session(impersonate="chrome") if CHROME else http.Session()
    if not CHROME:
        s.headers["User-Agent"] = UA
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    return s


def criar_sessao(caminho_cookies, proxy=None):
    jar = MozillaCookieJar(str(caminho_cookies))
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
    except Exception as e:
        sys.exit(f"Nao consegui ler {caminho_cookies}: {e}\n"
                 "Ele precisa estar no formato Netscape (exporte com 'Get cookies.txt LOCALLY').")
    s = nova_sessao(proxy)
    for c in jar:
        if "instagram.com" in c.domain:
            s.cookies.set(c.name, c.value, domain=".instagram.com", path="/")
    if "sessionid" not in s.cookies.keys():
        sys.exit("O cookies.txt nao tem o 'sessionid' do Instagram. Exporte de novo, "
                 "estando NA ABA do instagram.com e logado.")
    s.headers.update({
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "129477",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": s.cookies.get("csrftoken", ""),
        "Origin": IG,
        "Referer": IG + "/",
    })
    return s


def pedir_json(s, metodo, url, tentativas=4, **kw):
    """Faz a requisicao; em caso de limite (429) espera e tenta de novo."""
    espera = 60
    for tentativa in range(1, tentativas + 1):
        r = s.request(metodo, url, allow_redirects=False, timeout=30, **kw)
        if r.status_code != 200:
            trecho = re.sub(r"\s+", " ", r.text[:160])
            if r.headers.get("Location"):
                trecho = "redireciona para " + r.headers["Location"][:120] + " " + trecho
            log(f"   [HTTP {r.status_code}] {metodo} {urlsplit(url).netloc}{urlsplit(url).path} -> {trecho}",
                erro=True)
        if r.status_code == 429 or (r.status_code == 401 and "wait" in r.text.lower()):
            if tentativa == tentativas:
                raise ErroInstagram("O Instagram esta limitando as requisicoes (429). "
                                    "Espere 1 hora sem rodar e tente de novo.")
            log(f"   Instagram pediu para ir mais devagar. Esperando {espera}s...", erro=True)
            time.sleep(espera)
            espera *= 2
            continue
        if r.status_code in (301, 302):
            if "challenge" in r.headers.get("Location", ""):
                raise ErroInstagram("O Instagram pediu verificacao de seguranca. Abra o "
                                    "instagram.com no navegador, confirme que foi voce, "
                                    "exporte os cookies de novo e tente outra vez.")
            raise ErroInstagram("O Instagram nao aceitou o login dos cookies. "
                                "Exporte o cookies.txt de novo.")
        try:
            dados = r.json()
        except ValueError:
            raise ErroInstagram(f"Resposta inesperada do Instagram (HTTP {r.status_code}). "
                                "Os cookies podem ter expirado, ou o IP esta bloqueado.")
        if dados.get("require_login") or dados.get("message") in ("login_required", "checkpoint_required"):
            raise ErroInstagram("O Instagram nao aceitou o login dos cookies "
                                f"({dados.get('message')}). Exporte o cookies.txt de novo.")
        if r.status_code >= 400:
            raise ErroInstagram(f"Erro HTTP {r.status_code}: {dados.get('message', dados)}")
        return dados


# --------------------------------------------------------------------------- listagem

CACHE_IDS = PASTA_DADOS / "ids_das_contas.txt"


def ler_cache_ids():
    if not CACHE_IDS.exists():
        return {}
    pares = (l.split() for l in CACHE_IDS.read_text().splitlines())
    return {p[0]: p[1] for p in pares if len(p) == 2}


def id_da_conta(s, conta):
    """Descobre o ID numerico da conta. Tenta varios caminhos, do menos limitado
    pelo Instagram ao mais limitado, e guarda o resultado para as proximas vezes."""
    cache = ler_cache_ids()
    if conta in cache:
        return cache[conta]
    meu_id = s.cookies.get("ds_user_id")

    def pela_pagina():
        pag = nova_sessao()
        pag.proxies = s.proxies
        for nome in s.cookies.keys():
            pag.cookies.set(nome, s.cookies.get(nome), domain=".instagram.com", path="/")
        r = pag.get(f"{IG}/{conta}/", timeout=30,
                    headers={"Accept": "text/html,application/xhtml+xml",
                             "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"})
        if r.status_code == 404:
            raise ErroInstagram(f"A conta @{conta} nao existe.")
        for padrao in (r'"profilePage_(\d+)"', r'"profile_id":"(\d+)"', r'"target_id":"(\d+)"',
                       r'"id":"(\d+)","username":"' + re.escape(conta) + '"',
                       r'"username":"' + re.escape(conta) + r'","id":"(\d+)"'):
            for m in re.finditer(padrao, r.text):
                if m.group(1) != meu_id:
                    return m.group(1)

    def pela_busca():
        d = pedir_json(s, "GET", f"{IG}/web/search/topsearch/", tentativas=1,
                       params={"context": "blended", "query": conta})
        for item in d.get("users", []):
            u = item.get("user") or {}
            if (u.get("username") or "").lower() == conta:
                return str(u.get("pk") or u.get("pk_id") or u.get("id"))

    def pelo_app(tentativas):
        # mesma consulta pelo servidor do app de celular (limite separado do site)
        d = pedir_json(s, "GET", "https://i.instagram.com/api/v1/users/web_profile_info/",
                       tentativas=tentativas, params={"username": conta},
                       headers={"User-Agent": "Instagram 309.1.0.41.113 Android (33/13; 420dpi; "
                                              "1080x2400; samsung; SM-G991B; o1s; exynos2100; pt_BR)",
                                "X-IG-App-ID": "124024574287414"})
        user = (d.get("data") or {}).get("user")
        if not user:
            raise ErroInstagram(f"A conta @{conta} nao foi encontrada.")
        if user.get("is_private") and not user.get("followed_by_viewer"):
            raise ErroInstagram(f"A conta @{conta} e privada e voce nao a segue.")
        return str(user["id"])

    def anonimo():
        # sem login (pelo IP do proxy). Muitas vezes funciona quando a conta esta limitada.
        anon = nova_sessao()
        anon.headers.update({k: v for k, v in s.headers.items() if k.lower() != "x-csrftoken"})
        anon.proxies = s.proxies
        try:
            d = pedir_json(anon, "GET", f"{IG}/api/v1/users/web_profile_info/",
                           tentativas=1, params={"username": conta})
        except ErroInstagram as e:
            raise ErroInstagram(f"sem login: {e}".replace("login dos cookies", "acesso"))
        user = (d.get("data") or {}).get("user")
        return str(user["id"]) if user else None

    def pelo_site(tentativas):
        d = pedir_json(s, "GET", f"{IG}/api/v1/users/web_profile_info/",
                       tentativas=tentativas, params={"username": conta})
        user = (d.get("data") or {}).get("user")
        if not user:
            raise ErroInstagram(f"A conta @{conta} nao foi encontrada.")
        return str(user["id"])

    caminhos = [("pagina do perfil", pela_pagina), ("busca", pela_busca),
                ("sem login", anonimo), ("app", lambda: pelo_app(1)),
                ("site", lambda: pelo_site(1)), ("app, com espera", lambda: pelo_app(4))]
    ultimo_erro = None
    for nome, caminho in caminhos:
        log(f"   procurando o ID da conta: {nome}...")
        try:
            user_id = caminho()
        except ErroInstagram as e:
            if "nao existe" in str(e) or "privada" in str(e) or (
                    "login" in str(e) and not str(e).startswith("sem login")):
                raise
            ultimo_erro = e
            continue
        except ERROS_REDE as e:
            ultimo_erro = e
            continue
        if user_id:
            log(f"   ID de @{conta}: {user_id}")
            PASTA_DADOS.mkdir(parents=True, exist_ok=True)
            with open(CACHE_IDS, "a") as f:
                f.write(f"{conta} {user_id}\n")
            return user_id
    raise ErroInstagram(f"Nao consegui achar o ID de @{conta} ({ultimo_erro}). "
                        "Espere 1 hora sem rodar e tente de novo.")


DOC_REELS_DO_PERFIL = "7845543455542541"   # PolarisProfileReelsTabContentQuery
DOC_INFO_DO_POST = "27128499623469141"     # PolarisPostRootQuery (shortcode -> midia)


def graphql(s, doc_id, variaveis, referer=None):
    """Consulta GraphQL do site (a mesma que o instagram.com faz no navegador)."""
    d = pedir_json(s, "POST", f"{IG}/graphql/query",
                   data={"variables": json.dumps(variaveis, separators=(",", ":")),
                         "doc_id": doc_id, "server_timestamps": "true"},
                   headers={"Referer": referer or IG + "/"})
    if not d.get("data"):
        msg = (d.get("errors") or [{}])[0].get("message") or d.get("message") or str(d)[:150]
        raise ErroInstagram(f"consulta GraphQL falhou: {msg}")
    return d["data"]


def listar_reels_graphql(s, conta, user_id, quantidade):
    reels, depois = [], None
    tamanho = 50  # pede 50 por pagina; se o Instagram recusar, volta para 12
    while not quantidade or len(reels) < quantidade:
        variaveis = {"data": {"page_size": tamanho, "include_feed_video": True, "target_user_id": user_id},
                     "__relay_internal__pv__PolarisFeedShareMenurelayprovider": False}
        if depois:
            variaveis.update({"after": depois, "before": None, "first": tamanho, "last": None})
        try:
            d = graphql(s, DOC_REELS_DO_PERFIL, variaveis, f"{IG}/{conta}/reels/")
        except ErroInstagram as e:
            if tamanho == 12 or "429" in str(e) or "login" in str(e):
                raise
            tamanho = 12
            continue
        conexao = d.get("xdt_api__v1__clips__user__connection_v2") or {}
        for borda in conexao.get("edges", []):
            midia = (borda.get("node") or {}).get("media")
            if midia and midia.get("code"):
                reels.append(midia)
        log(f"   {len(reels)} reels listados...")
        pag = conexao.get("page_info") or {}
        depois = pag.get("end_cursor")
        if not pag.get("has_next_page") or not depois:
            break
        time.sleep(random.uniform(0.3, 0.7))
    return reels


def listar_reels_rest(s, conta, user_id, quantidade):
    reels, max_id = [], ""
    while not quantidade or len(reels) < quantidade:
        dados = {"target_user_id": user_id, "page_size": "12", "include_feed_video": "true"}
        if max_id:
            dados["max_id"] = max_id
        d = pedir_json(s, "POST", f"{IG}/api/v1/clips/user/", data=dados,
                       headers={"Referer": f"{IG}/{conta}/reels/"})
        for item in d.get("items", []):
            if item.get("media"):
                reels.append(item["media"])
        log(f"   {len(reels)} reels listados...")
        pag = d.get("paging_info") or {}
        max_id = pag.get("max_id")
        if not pag.get("more_available") or not max_id:
            break
        time.sleep(random.uniform(2, 4))
    return reels


def listar_reels(s, conta, quantidade):
    """Devolve ate `quantidade` reels (dicts de midia), do mais novo ao mais antigo."""
    user_id = id_da_conta(s, conta)
    try:
        reels = listar_reels_graphql(s, conta, user_id, quantidade)
    except ErroInstagram as e:
        if "429" in str(e):
            raise
        log(f"   listagem pelo GraphQL falhou ({e}); tentando o metodo antigo...", erro=True)
        reels = listar_reels_rest(s, conta, user_id, quantidade)
    return reels[:quantidade] if quantidade else reels


def visualizacoes(midia):
    """Numero de visualizacoes do reel (o Instagram usa nomes diferentes conforme a consulta)."""
    for chave in ("play_count", "ig_play_count", "view_count", "video_view_count", "fb_play_count"):
        valor = midia.get(chave)
        if isinstance(valor, int):
            return valor
    return None


def formatar_numero(n):
    if n is None:
        return "?"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f} mi".replace(".", ",")
    if n >= 1_000:
        return f"{n / 1_000:.1f} mil".replace(".", ",")
    return str(n)


def mais_vistos(s, reels, quantidade, mostrar=True):
    """Ordena os reels por visualizacoes (maior primeiro) e devolve os `quantidade` primeiros."""
    sem_numero = [m for m in reels if visualizacoes(m) is None]
    if sem_numero:
        log(f"   buscando as visualizacoes de {len(sem_numero)} reels que vieram sem o numero...")
        for i, midia in enumerate(sem_numero, 1):
            try:
                midia.update(info_do_reel(s, midia["code"]))
            except ErroInstagram as e:
                if "429" in str(e):
                    raise
                log(f"   {midia['code']}: {e}", erro=True)
            if i % 10 == 0:
                log(f"   {i}/{len(sem_numero)}...")
            time.sleep(random.uniform(1.5, 3))
    ordenados = sorted(reels, key=lambda m: visualizacoes(m) or -1, reverse=True)
    escolhidos = ordenados[:quantidade] if quantidade else ordenados
    if not mostrar:
        return escolhidos
    log("   Mais visualizados:")
    for pos, m in enumerate(escolhidos[:20], 1):
        log(f"   {pos:>3}. {m['code']}  {formatar_numero(visualizacoes(m))} visualizacoes")
    if len(escolhidos) > 20:
        log(f"   ... e mais {len(escolhidos) - 20}")
    return escolhidos


VALIDADE_LISTA = 24 * 3600  # segundos


def lista_salva(pasta, analisar):
    """Lista de reels (codigo + visualizacoes) salva numa execucao anterior, se ainda valer."""
    arq = pasta / "lista_reels.json"
    try:
        dados = json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    idade = time.time() - dados.get("quando", 0)
    if idade > VALIDADE_LISTA:
        return None
    if dados.get("analisar") and (not analisar or analisar > dados["analisar"]):
        return None  # a lista salva cobre menos reels do que o pedido agora
    reels = dados.get("reels") or []
    log(f"   usando a lista salva ha {int(idade // 60)} min ({len(reels)} reels). "
        "Para buscar de novo: use --atualizar-lista (ou apague sistema\\dados\\<conta>\\lista_reels.json)")
    return reels[:analisar] if analisar else reels


def salvar_lista(pasta, analisar, reels):
    pasta.mkdir(parents=True, exist_ok=True)
    resumo = [{"code": m["code"], "play_count": visualizacoes(m)} for m in reels]
    (pasta / "lista_reels.json").write_text(
        json.dumps({"quando": time.time(), "analisar": analisar, "reels": resumo}), encoding="utf-8")


def codigo_para_pk(codigo):
    pk = 0
    for c in codigo[:11]:
        pk = pk * 64 + ALFABETO.index(c)
    return str(pk)


def info_do_reel(s, codigo):
    """Dados completos de um reel (inclui as versoes de video e o manifesto DASH)."""
    try:
        d = graphql(s, DOC_INFO_DO_POST,
                    {"shortcode": codigo,
                     "__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider": False},
                    f"{IG}/reel/{codigo}/")
        itens = (d.get("xdt_api__v1__media__shortcode__web_info") or {}).get("items") or []
        if itens:
            return itens[0]
    except ErroInstagram as e:
        if "429" in str(e):
            raise
    d = pedir_json(s, "GET", f"{IG}/api/v1/media/{codigo_para_pk(codigo)}/info/")
    itens = d.get("items") or []
    if not itens:
        raise ErroInstagram("reel nao encontrado")
    return itens[0]


# --------------------------------------------------------------------------- qualidade

def melhores_faixas_dash(manifesto):
    """Do manifesto DASH, devolve (melhor_video, melhor_audio); cada um = dict ou None."""
    if not manifesto:
        return None, None
    try:
        raiz = ET.fromstring(manifesto)
    except ET.ParseError:
        return None, None
    videos, audios = [], []
    for aset in raiz.iter():
        if not aset.tag.endswith("AdaptationSet"):
            continue
        tipo_set = (aset.get("contentType") or aset.get("mimeType") or "").lower()
        for rep in aset:
            if not rep.tag.endswith("Representation"):
                continue
            base = next((e.text for e in rep if e.tag.endswith("BaseURL") and e.text), None)
            if not base:
                continue
            tipo = (rep.get("mimeType") or tipo_set).lower()
            faixa = {
                "url": base.strip(),
                "largura": int(rep.get("width") or 0),
                "altura": int(rep.get("height") or 0),
                "bitrate": int(rep.get("bandwidth") or 0),
            }
            (audios if "audio" in tipo else videos).append(faixa)
    melhor_v = max(videos, key=lambda f: (f["altura"] * f["largura"], f["bitrate"]), default=None)
    melhor_a = max(audios, key=lambda f: f["bitrate"], default=None)
    return melhor_v, melhor_a


def melhor_progressivo(midia):
    versoes = midia.get("video_versions") or []
    # o Instagram costuma listar a melhor primeiro; max() mantem a primeira em caso de empate
    return max(versoes, key=lambda v: (v.get("width") or 0) * (v.get("height") or 0), default=None)


# --------------------------------------------------------------------------- download

def baixar_arquivo(cdn, url, destino):
    """Baixa do servidor de videos. `cdn` e uma lista de sessoes: tenta a primeira
    (direto, sem gastar o proxy) e, se falhar, as seguintes (pelo proxy)."""
    for i, sessao in enumerate(cdn):
        try:
            r = sessao.get(url, stream=True, timeout=60)
            try:
                r.raise_for_status()
                with open(destino, "wb") as f:
                    for bloco in r.iter_content(1 << 20):
                        f.write(bloco)
            finally:
                r.close()
            return
        except ERROS_REDE:
            if i == len(cdn) - 1:
                raise


def achar_ffmpeg():
    """ffmpeg do sistema, ou o que o instalar.bat baixou na pasta ./ffmpeg (Windows)."""
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    local = AQUI / "ffmpeg"
    for exe in local.rglob("ffmpeg.exe") if local.exists() else []:
        return str(exe)
    return None


FFMPEG = achar_ffmpeg()


def juntar(video, audio, saida):
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-i", str(video)]
    if audio:
        cmd += ["-i", str(audio), "-map", "0:v:0", "-map", "1:a:0"]
    cmd += ["-c", "copy", "-movflags", "+faststart", str(saida)]
    subprocess.run(cmd, check=True)


def resolucao_real(arquivo):
    """Le a resolucao do video baixado (pelo ffmpeg), ex: '1080x1920'."""
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(arquivo)], capture_output=True, text=True,
                       errors="replace")
    m = re.search(r"Video:.*?, (\d{2,5})x(\d{2,5})", r.stderr)
    return f"{m.group(1)}x{m.group(2)}" if m else "?"


def baixar_reel(s, cdn, midia, pasta, conta=None):
    """Baixa um reel na melhor qualidade. Devolve (caminho, descricao_da_qualidade)."""
    codigo = midia["code"]
    # a listagem traz dados incompletos: busca os dados completos do reel
    # (versoes de video com resolucao, manifesto DASH, data, autor)
    if not midia.get("video_dash_manifest") or not midia.get("taken_at"):
        try:
            midia = {**midia, **info_do_reel(s, codigo)}
        except ErroInstagram as e:
            if "429" in str(e) or not midia.get("video_versions"):
                raise
            log(f"   (nao consegui os dados completos: {e}; usando o que a lista trouxe)", erro=True)
    if midia.get("media_type") != 2 and not midia.get("video_versions"):
        raise ErroInstagram("este post nao e video")

    dono = ((midia.get("user") or {}).get("username")) or conta or "instagram"
    data = datetime.fromtimestamp(midia.get("taken_at") or 0, timezone.utc).strftime("%Y%m%d")
    saida = pasta / f"{dono}_{data}_{codigo}.mp4"
    qualidade = baixar_video(cdn, midia, saida)

    if midia.get("caption") and (midia["caption"].get("text")):
        saida.with_suffix(".txt").write_text(midia["caption"]["text"], encoding="utf-8")
    return saida, qualidade


def baixar_video(cdn, midia, saida):
    """Baixa o video de uma midia (reel ou item de destaque) na melhor qualidade:
    melhor faixa de video + melhor audio do DASH, juntadas sem recodificar; se nao houver
    DASH, o maior arquivo unico. Devolve a descricao da qualidade."""
    pasta = saida.parent
    v, a = melhores_faixas_dash(midia.get("video_dash_manifest"))
    prog = melhor_progressivo(midia)
    usar_dash = v and (not prog or v["altura"] * v["largura"] >=
                       (prog.get("height") or 0) * (prog.get("width") or 0))

    with tempfile.TemporaryDirectory(dir=pasta) as tmp:
        tmp = Path(tmp)
        if usar_dash:
            baixar_arquivo(cdn, v["url"], tmp / "v.mp4")
            if a:
                baixar_arquivo(cdn, a["url"], tmp / "a.mp4")
            juntar(tmp / "v.mp4", tmp / "a.mp4" if a else None, tmp / "final.mp4")
            qualidade = f"{resolucao_real(tmp / 'final.mp4')} video {v['bitrate'] // 1000} kbps"
            qualidade += f" + audio {a['bitrate'] // 1000} kbps" if a else " (sem audio)"
        elif prog:
            baixar_arquivo(cdn, prog["url"], tmp / "final.mp4")
            qualidade = f"{resolucao_real(tmp / 'final.mp4')} (arquivo unico)"
        else:
            raise ErroInstagram("nenhuma versao de video encontrada")
        os.replace(tmp / "final.mp4", saida)
    return qualidade


def baixar_foto(cdn, midia, saida):
    """Baixa a foto na maior resolucao disponivel. Devolve a descricao da qualidade."""
    candidatas = (midia.get("image_versions2") or {}).get("candidates") or []
    if not candidatas and midia.get("display_url"):
        candidatas = [{"url": midia["display_url"], "width": 0, "height": 0}]
    if not candidatas:
        raise ErroInstagram("nenhuma versao de foto encontrada")
    melhor = max(candidatas, key=lambda c: (c.get("width") or 0) * (c.get("height") or 0))
    temp = saida.with_name(saida.name + ".parcial")
    baixar_arquivo(cdn, melhor["url"], temp)
    os.replace(temp, saida)
    return f"foto {melhor.get('width') or '?'}x{melhor.get('height') or '?'}"


# --------------------------------------------------------------------------- destaques

HEADERS_APP = {
    "User-Agent": "Instagram 309.1.0.41.113 Android (33/13; 420dpi; 1080x2400; samsung; "
                  "SM-G991B; o1s; exynos2100; pt_BR)",
    "X-IG-App-ID": "124024574287414",
}
QUERY_DESTAQUES = "7c16654f22c819fb63d1183034a5162f"
QUERY_ITENS_DESTAQUE = "45246d3fe16ccc6577e0bd297a5db1ab"


def listar_destaques(s, conta):
    """Lista os destaques da conta: [{'id', 'titulo', 'qtd'}], na ordem do perfil."""
    user_id = id_da_conta(s, conta)
    try:
        d = pedir_json(s, "GET", f"{IG}/api/v1/highlights/{user_id}/highlights_tray/", tentativas=2,
                       headers={"Referer": f"{IG}/{conta}/"})
        if "tray" in d:
            return [{"id": str(t["id"]).replace("highlight:", ""), "titulo": t.get("title") or "",
                     "qtd": t.get("media_count")} for t in d["tray"] if t.get("id")]
    except ErroInstagram as e:
        if "429" in str(e):
            raise
        log("   (lista de destaques: metodo 1 indisponivel, tentando o metodo 2)", erro=True)
    variaveis = {"user_id": user_id, "include_chaining": False, "include_reel": False,
                 "include_suggested_users": False, "include_logged_out_extras": False,
                 "include_highlight_reels": True}
    d = pedir_json(s, "GET", f"{IG}/graphql/query/",
                   params={"query_hash": QUERY_DESTAQUES,
                           "variables": json.dumps(variaveis, separators=(",", ":"))})
    bordas = (((d.get("data") or {}).get("user") or {}).get("edge_highlight_reels") or {}).get("edges")
    if bordas is None:
        raise ErroInstagram("o Instagram nao devolveu a lista de destaques")
    return [{"id": str(b["node"]["id"]), "titulo": b["node"].get("title") or "", "qtd": None}
            for b in bordas]


def item_graphql_para_api(n):
    """Converte um item de destaque do formato GraphQL antigo para o formato da API
    (video_versions / image_versions2), que e o que baixar_video/baixar_foto entendem."""
    item = {"pk": str(n.get("id") or ""), "taken_at": n.get("taken_at_timestamp") or 0}
    fotos = n.get("display_resources") or []
    item["image_versions2"] = {"candidates": [
        {"url": f["src"], "width": f.get("config_width") or 0, "height": f.get("config_height") or 0}
        for f in fotos if f.get("src")]}
    if not fotos and n.get("display_url"):
        item["display_url"] = n["display_url"]
    if n.get("is_video"):
        # MAIN antes de BASELINE: na mesma resolucao, MAIN tem melhor qualidade
        videos = sorted(n.get("video_resources") or [], key=lambda v: v.get("profile") != "MAIN")
        item["video_versions"] = [
            {"url": v["src"], "width": v.get("config_width") or 0, "height": v.get("config_height") or 0}
            for v in videos if v.get("src")]
        manifesto = (n.get("dash_info") or {}).get("video_dash_manifest")
        if manifesto:
            item["video_dash_manifest"] = manifesto
    return item


def itens_do_destaque(s, destaque_id):
    """Fotos e videos de um destaque, com todas as versoes (para escolher a melhor)."""
    rid = f"highlight:{destaque_id}"
    ultimo_erro = None
    # 1) GraphQL (o que o Instaloader usa)
    try:
        variaveis = {"reel_ids": [], "tag_names": [], "location_ids": [],
                     "highlight_reel_ids": [str(destaque_id)], "precomposed_overlay": False}
        d = pedir_json(s, "GET", f"{IG}/graphql/query/", tentativas=2,
                       params={"query_hash": QUERY_ITENS_DESTAQUE,
                               "variables": json.dumps(variaveis, separators=(",", ":"))})
        midias = (d.get("data") or {}).get("reels_media") or []
        if midias and midias[0].get("items"):
            return [item_graphql_para_api(n) for n in midias[0]["items"]]
        ultimo_erro = ErroInstagram("resposta sem itens")
    except ErroInstagram as e:
        if "429" in str(e):
            raise
        ultimo_erro = e
    # 2) e 3) API do site e do app
    for url, extra in ((f"{IG}/api/v1/feed/reels_media/", {}),
                       ("https://i.instagram.com/api/v1/feed/reels_media/", {"headers": HEADERS_APP})):
        try:
            d = pedir_json(s, "GET", url, tentativas=2, params={"reel_ids": rid}, **extra)
        except ErroInstagram as e:
            if "429" in str(e):
                raise
            ultimo_erro = e
            continue
        reel = (d.get("reels") or {}).get(rid) or ((d.get("reels_media") or [None])[0]) or {}
        if reel.get("items"):
            return reel["items"]
        ultimo_erro = ErroInstagram("destaque sem itens")
    raise ErroInstagram(f"nao consegui abrir o destaque ({ultimo_erro})")


NOMES_RESERVADOS = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                    *(f"LPT{i}" for i in range(1, 10))}


def nome_de_pasta(texto, reserva):
    """Transforma o nome do destaque num nome de pasta valido no Windows."""
    nome = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", texto or "").strip().rstrip(". ")[:80]
    if not nome:
        return reserva
    return f"_{nome}" if nome.upper() in NOMES_RESERVADOS else nome


def escolher_destaques(destaques, resposta):
    """'' -> todos; '1,3' ou '1 3' ou '2-4' -> esses numeros (1 = primeiro da lista)."""
    resposta = (resposta or "").strip()
    if not resposta:
        return destaques
    numeros = set()
    for parte in re.split(r"[,\s]+", resposta):
        if "-" in parte:
            ini, _, fim = parte.partition("-")
            if ini.isdigit() and fim.isdigit():
                numeros.update(range(int(ini), int(fim) + 1))
        elif parte.isdigit():
            numeros.add(int(parte))
    return [d for i, d in enumerate(destaques, 1) if i in numeros]


def baixar_destaques(s, cdn, conta, pasta_conta, dados, escolha, interativo, pausa):
    """Baixa os destaques da conta, cada um na sua pasta com o nome do destaque.
    Devolve (baixados, ja_existiam, falhas)."""
    log(f"Listando os destaques de @{conta}...")
    destaques = listar_destaques(s, conta)
    if not destaques:
        log("Essa conta nao tem destaques.")
        return 0, 0, 0
    # nome da pasta de cada destaque, decidido sobre a lista completa para que um
    # destaque caia sempre na mesma pasta, mesmo escolhendo so alguns
    usados = set()
    for i, d in enumerate(destaques, 1):
        nome = nome_de_pasta(d["titulo"], f"destaque_{d['id']}")
        if nome.lower() in usados:  # dois destaques com o mesmo nome
            nome = f"{nome}_{d['id']}"
        usados.add(nome.lower())
        d["pasta"] = nome
        qtd = d.get("qtd")
        qtd = f" ({qtd} {'item' if qtd == 1 else 'itens'})" if qtd else ""
        log(f"   {i:>2}. {d['titulo'] or '(sem nome)'}{qtd}")
    if escolha is None and interativo:
        escolha = perguntar("Quais destaques? (Enter = todos, ou numeros, ex: 1,3): ", "")
    destaques = escolher_destaques(destaques, escolha)
    if not destaques:
        log("Nenhum destaque escolhido.")
        return 0, 0, 0

    base = pasta_conta / "destaques"
    registro = dados / "destaques_baixados.txt"
    ja = ler_registro(registro)
    ok = pulados = falhas = 0
    for n, d in enumerate(destaques, 1):
        log(f"\n[destaque {n}/{len(destaques)}] {d['titulo'] or '(sem nome)'}")
        try:
            itens = itens_do_destaque(s, d["id"])
        except (ErroInstagram, *ERROS_REDE) as e:
            log(f"   FALHOU: {e}", erro=True)
            falhas += 1
            if "429" in str(e) or "login" in str(e):
                log("Parando: o Instagram bloqueou. Rode de novo mais tarde; "
                    "ele continua de onde parou.", erro=True)
                break
            continue
        pasta = base / d["pasta"]
        pasta.mkdir(parents=True, exist_ok=True)
        for j, item in enumerate(itens, 1):
            pk = str(item.get("pk") or item.get("id") or "").split("_")[0]
            prefixo = f"   [{j}/{len(itens)}]"
            if pk and pk in ja:
                pulados += 1
                continue
            data = datetime.fromtimestamp(item.get("taken_at") or 0, timezone.utc).strftime("%Y%m%d")
            arquivo = pasta / f"{j:03d}_{data}_{pk}"
            try:
                if item.get("video_versions") or item.get("video_dash_manifest"):
                    arquivo = arquivo.with_suffix(".mp4")
                    qualidade = baixar_video(cdn, item, arquivo)
                else:
                    arquivo = arquivo.with_suffix(".jpg")
                    qualidade = baixar_foto(cdn, item, arquivo)
                with open(registro, "a") as f:
                    f.write(pk + "\n")
                log(f"{prefixo} OK  {qualidade}  ->  {arquivo.name}")
                ok += 1
            except (ErroInstagram, *ERROS_REDE, subprocess.CalledProcessError, OSError) as e:
                log(f"{prefixo} FALHOU: {e}", erro=True)
                falhas += 1
        if n < len(destaques):
            time.sleep(random.uniform(pausa, pausa * 1.5))
    log(f"\nDestaques: {ok} baixados, {pulados} ja existiam, {falhas} falharam.")
    log(f"Pasta: {base.resolve()}")
    return ok, pulados, falhas


# --------------------------------------------------------------------------- main

def ler_registro(arquivo):
    return set(arquivo.read_text().split()) if arquivo.exists() else set()


def perguntar(texto, padrao=""):
    try:
        resp = input(texto).strip()
    except EOFError:
        resp = ""
    return resp or padrao


def main():
    p = argparse.ArgumentParser(description="Baixa Reels e Destaques do Instagram na melhor qualidade.")
    p.add_argument("alvo", nargs="*", help="nome da conta, link do perfil, ou links de reels")
    p.add_argument("-n", "--quantidade", type=int,
                   help="quantos reels baixar (os mais recentes). 0 = todos")
    p.add_argument("--mais-vistos", action="store_true",
                   help="baixar os reels MAIS VISUALIZADOS em vez dos mais recentes")
    p.add_argument("--analisar", type=int, default=0,
                   help="com --mais-vistos: quantos reels recentes analisar (padrao: todos)")
    p.add_argument("--atualizar-lista", action="store_true",
                   help="com --mais-vistos: ignora a lista salva e busca tudo de novo")
    p.add_argument("--destaques", action="store_true", help="baixar so os DESTAQUES (nao os reels)")
    p.add_argument("--reels-e-destaques", action="store_true", help="baixar os reels e os destaques")
    p.add_argument("--quais-destaques", metavar="NUMEROS",
                   help="quais destaques, pela ordem do perfil, ex: 1,3 ou 2-4 (padrao: todos)")
    p.add_argument("-o", "--saida", help="pasta de destino (padrao: videos/<conta>)")
    p.add_argument("--cookies", help="arquivo cookies.txt (padrao: ./cookies.txt)")
    p.add_argument("--proxy", help="proxy, ex: http://usuario:senha@host:porta "
                                   "(ou coloque no arquivo proxy.txt)")
    p.add_argument("--pausa", type=float, default=4, help="segundos entre downloads (padrao: 4)")
    p.add_argument("--sem-legenda", action="store_true", help="nao salvar a legenda em .txt")
    args = p.parse_args()

    if not FFMPEG:
        sys.exit("O ffmpeg nao esta instalado. Windows: rode o instalar.bat. "
                 "Ubuntu/Debian: sudo apt install -y ffmpeg")

    log(f"Downloader de Reels - versao {VERSAO}" + ("" if CHROME else
        "  (AVISO: curl_cffi nao instalado, rode o instalar.bat de novo)"))
    organizar_pastas_antigas()
    alvos = args.alvo
    if not alvos:
        alvos = [perguntar("Conta do Instagram (sem @) ou link do reel: ")]
        if not alvos[0]:
            sys.exit("Nada informado.")

    links = [a for a in alvos if re.search(r"/(reel|reels|p|tv)/[A-Za-z0-9_-]+", a)]
    proxy = ler_proxy(args.proxy)
    if proxy:
        u = urlsplit(proxy)
        log(f"Usando proxy {u.hostname}:{u.port}")
        ips = []
        for _ in range(2):
            try:
                ips.append(nova_sessao(proxy).get("https://api.ipify.org", timeout=20).text.strip())
            except ERROS_REDE as e:
                sys.exit(f"ERRO: o proxy nao respondeu ({e}). Confira o proxy.txt.")
        if ips[0] != ips[1]:
            log(f"   IP do proxy: {ips[0]} e depois {ips[1]} -> MUDA a cada pedido. O Instagram "
                "desconfia de login trocando de IP; se possivel use IP fixo (sessao 'sticky').")
        else:
            log(f"   IP do proxy: {ips[0]} (fixo)")
    else:
        log("SEM proxy (nao achei o proxy.txt na pasta do programa)")
    s = criar_sessao(achar_cookies(args.cookies), proxy)
    cdn = [nova_sessao()]
    if proxy:
        cdn.append(nova_sessao(proxy))

    conta = None
    fazer_reels, fazer_destaques = True, False
    try:
        if links:
            codigos = [re.search(r"/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)", l).group(1) for l in links]
            pasta = Path(args.saida).expanduser() if args.saida else PASTA_VIDEOS / "avulsos"
            dados = dados_da_conta("avulsos")
            reels = [{"code": c} for c in codigos]
        else:
            conta = alvos[0].strip().rstrip("/").split("/")[-1].lstrip("@").lower()
            if args.destaques:
                tipo = "2"
            elif args.reels_e_destaques:
                tipo = "3"
            elif not args.alvo:
                tipo = perguntar("O que baixar? [1] reels  [2] destaques  [3] reels e destaques"
                                 "  (Enter = 1): ", "1").strip()
            else:
                tipo = "1"
            fazer_reels = tipo != "2"
            fazer_destaques = tipo in ("2", "3")
            pasta = Path(args.saida).expanduser() if args.saida else PASTA_VIDEOS / conta
            dados = dados_da_conta(conta)
            qtd = args.quantidade
            if fazer_reels and qtd is None:
                qtd = int(perguntar("Quantos reels baixar? (Enter = todos): ", "0") or 0)
            vistos = args.mais_vistos
            if fazer_reels and not vistos and not args.alvo:
                vistos = perguntar("Quais? [1] mais recentes  [2] mais visualizados  (Enter = 1): ",
                                   "1").strip() == "2"
            if not fazer_reels:
                reels = []
            elif vistos:
                log(f"Listando os reels de @{conta} para achar os mais visualizados"
                    + (f" (entre os {args.analisar} mais recentes)" if args.analisar else "") + "...")
                reels = None if args.atualizar_lista else lista_salva(dados, args.analisar)
                if reels is None:
                    reels = listar_reels(s, conta, args.analisar)
                    log(f"{len(reels)} reels encontrados.")
                    reels = mais_vistos(s, reels, 0, mostrar=False)
                    salvar_lista(dados, args.analisar, reels)
                reels = mais_vistos(s, reels, qtd)
            else:
                log(f"Listando reels de @{conta}" + (f" (ate {qtd})" if qtd else " (todos)") + "...")
                reels = listar_reels(s, conta, qtd)
                log(f"{len(reels)} reels encontrados.")
    except (ErroInstagram, *ERROS_REDE) as e:
        sys.exit(f"ERRO: {e}")

    pasta.mkdir(parents=True, exist_ok=True)
    registro = dados / "baixados.txt"
    ja = ler_registro(registro) | ler_registro(pasta / "baixados.txt")
    ok = pulados = 0
    falhas = []
    bloqueado = False

    for i, midia in enumerate(reels, 1):
        codigo = midia["code"]
        prefixo = f"[{i}/{len(reels)}] {codigo}"
        if visualizacoes(midia) is not None:
            prefixo += f" ({formatar_numero(visualizacoes(midia))} visualizacoes)"
        if codigo in ja:
            log(f"{prefixo}  ja baixado, pulando")
            pulados += 1
            continue
        try:
            arquivo, qualidade = baixar_reel(s, cdn, midia, pasta, conta)
            if args.sem_legenda:
                arquivo.with_suffix(".txt").unlink(missing_ok=True)
            with open(registro, "a") as f:
                f.write(codigo + "\n")
            log(f"{prefixo}  OK  {qualidade}  ->  {arquivo.name}")
            ok += 1
        except (ErroInstagram, *ERROS_REDE, subprocess.CalledProcessError, OSError) as e:
            log(f"{prefixo}  FALHOU: {e}", erro=True)
            falhas.append(codigo)
            if isinstance(e, ErroInstagram) and ("login" in str(e) or "429" in str(e)):
                log("Parando: o Instagram bloqueou. Rode de novo mais tarde; "
                    "ele continua de onde parou.", erro=True)
                bloqueado = True
                break
        if i < len(reels):
            time.sleep(random.uniform(args.pausa, args.pausa * 1.5))

    if fazer_reels:
        log(f"\nReels: {ok} baixados, {pulados} ja existiam, {len(falhas)} falharam.")
        log(f"Pasta: {pasta.resolve()}")

    falhas_destaques = 0
    if fazer_destaques and not bloqueado:
        if fazer_reels:
            log("")
        try:
            _, _, falhas_destaques = baixar_destaques(
                s, cdn, conta, pasta, dados, args.quais_destaques, not args.alvo, args.pausa)
        except (ErroInstagram, *ERROS_REDE) as e:
            log(f"ERRO nos destaques: {e}", erro=True)
            falhas_destaques = 1

    if falhas or falhas_destaques:
        log("Rode o mesmo comando de novo para tentar so os que faltaram.", erro=True)
    return 1 if (falhas or falhas_destaques) else 0


if __name__ == "__main__":
    sys.exit(main())
