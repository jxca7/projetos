#!/usr/bin/env python3
"""Varredura exaustiva no Google Places (API New) para uma categoria em Joinville.

Divide a cidade em retângulos; quando um retângulo devolve o máximo de
resultados (60), ele é subdividido em 4 e buscado de novo, até não haver
mais áreas "cheias". Combina termos de texto e filtros de tipo do Google.

Uso: GOOGLE_PLACES_API_KEY=... python3 varredura_places.py <saida.csv> <config>
Configs: pizza, hamburguer
"""
import csv
import json
import os
import sys
import time
import urllib.request

API_URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.websiteUri",
    "places.nationalPhoneNumber", "places.googleMapsUri", "places.delivery", "places.takeout",
    "places.rating", "places.userRatingCount", "places.businessStatus", "places.primaryType",
    "places.types", "nextPageToken",
])
JOINVILLE = (-26.45, -49.05, -26.10, -48.72)  # sul, oeste, norte, leste (inclui Pirabeiraba)

CONFIGS = {
    "pizza": [
        ("pizzaria", None), ("pizza delivery", None), ("pizza", None), ("pizzaria e esfiharia", None),
        ("restaurante", "pizza_restaurant"), ("pizza", "pizza_delivery"),
    ],
    "hamburguer": [
        ("hamburgueria", None), ("hamburguer", None), ("burger", None), ("smash burger", None),
        ("lanches", None), ("lanchonete", None), ("x-salada", None), ("hot dog", None),
        ("restaurante", "hamburger_restaurant"), ("lanchonete", "fast_food_restaurant"),
        ("lanches", "sandwich_shop"), ("lanches", "snack_bar"),
    ],
}

chamadas = 0


def buscar(chave, texto, tipo, ret):
    global chamadas
    res, token = [], None
    while True:
        corpo = {"textQuery": f"{texto} Joinville", "languageCode": "pt-BR", "regionCode": "BR", "pageSize": 20,
                 "locationRestriction": {"rectangle": ret}}
        if tipo:
            corpo.update(includedType=tipo, strictTypeFiltering=True)
        if token:
            corpo["pageToken"] = token
        req = urllib.request.Request(API_URL, data=json.dumps(corpo).encode(), headers={
            "Content-Type": "application/json", "X-Goog-Api-Key": chave, "X-Goog-FieldMask": FIELDS})
        for tentativa in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    dados = json.load(r)
                break
            except Exception:
                if tentativa == 3:
                    raise
                time.sleep(2 ** tentativa)
        chamadas += 1
        res += dados.get("places", [])
        token = dados.get("nextPageToken")
        if not token:
            return res
        time.sleep(1.5)


def varrer(chave, texto, tipo, s, w, n, e, nivel, lugares):
    ret = {"low": {"latitude": s, "longitude": w}, "high": {"latitude": n, "longitude": e}}
    achados = buscar(chave, texto, tipo, ret)
    for p in achados:
        lugares.setdefault(p["id"], p)
    if len(achados) >= 60 and nivel < 6:
        mlat, mlng = (s + n) / 2, (w + e) / 2
        for q in ((s, w, mlat, mlng), (s, mlng, mlat, e), (mlat, w, n, mlng), (mlat, mlng, n, e)):
            varrer(chave, texto, tipo, *q, nivel + 1, lugares)


def main():
    saida, config = sys.argv[1], sys.argv[2]
    chave = os.environ["GOOGLE_PLACES_API_KEY"]
    lugares = {}
    s, w, n, e = JOINVILLE
    passos = 4  # grade inicial 4x4
    dlat, dlng = (n - s) / passos, (e - w) / passos
    for texto, tipo in CONFIGS[config]:
        for i in range(passos):
            for j in range(passos):
                varrer(chave, texto, tipo, s + i * dlat, w + j * dlng, s + (i + 1) * dlat, w + (j + 1) * dlng, 0, lugares)
        print(f"{texto} [{tipo or 'texto'}]: {len(lugares)} lugares únicos, {chamadas} chamadas", file=sys.stderr)

    with open(saida, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["nome", "endereco", "site", "telefone", "delivery", "retirada", "nota", "avaliacoes",
                     "situacao", "tipo", "tipos", "google_maps"])
        for p in sorted(lugares.values(), key=lambda p: p["displayName"]["text"].lower()):
            if "Joinville" not in p.get("formattedAddress", ""):
                continue
            wr.writerow([p["displayName"]["text"], p.get("formattedAddress", ""), p.get("websiteUri", ""),
                         p.get("nationalPhoneNumber", ""), {True: "sim", False: "não"}.get(p.get("delivery"), ""),
                         {True: "sim", False: "não"}.get(p.get("takeout"), ""), p.get("rating", ""),
                         p.get("userRatingCount", ""), p.get("businessStatus", ""), p.get("primaryType", ""),
                         " ".join(p.get("types", [])), p.get("googleMapsUri", "")])
    print(f"Salvo em {saida} ({chamadas} chamadas à API)", file=sys.stderr)


if __name__ == "__main__":
    main()
