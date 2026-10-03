#!/usr/bin/env python3
"""Lista restaurantes de Joinville no Google Places (API New) e salva em CSV.

Uso:
    export GOOGLE_PLACES_API_KEY=...   (ou configure no ambiente)
    python3 buscar_places.py                      # sushi (padrão)
    python3 buscar_places.py pizzaria hamburgueria

A cidade é dividida numa grade de retângulos para contornar o limite de
60 resultados por busca do Google. Resultados repetidos são removidos.
"""
import csv
import json
import os
import sys
import time
import urllib.request

API_URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join([
    "places.id", "places.displayName", "places.formattedAddress",
    "places.websiteUri", "places.nationalPhoneNumber", "places.googleMapsUri",
    "places.delivery", "places.takeout", "places.rating",
    "places.userRatingCount", "places.businessStatus", "places.primaryType",
    "nextPageToken",
])

# Área aproximada de Joinville (sul, oeste, norte, leste) e tamanho da grade
LAT_MIN, LNG_MIN, LAT_MAX, LNG_MAX = -26.42, -49.02, -26.13, -48.74
GRADE = 4

TERMOS_PADRAO = ["sushi", "comida japonesa", "temakeria", "poke"]


def buscar(chave, texto, retangulo):
    resultados, token = [], None
    while True:
        corpo = {
            "textQuery": f"{texto} Joinville",
            "languageCode": "pt-BR",
            "regionCode": "BR",
            "pageSize": 20,
            "locationRestriction": {"rectangle": retangulo},
        }
        if token:
            corpo["pageToken"] = token
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(corpo).encode(),
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": chave,
                "X-Goog-FieldMask": FIELDS,
            },
        )
        with urllib.request.urlopen(req) as resp:
            dados = json.load(resp)
        resultados += dados.get("places", [])
        token = dados.get("nextPageToken")
        if not token:
            return resultados
        time.sleep(2)


def retangulos():
    dlat = (LAT_MAX - LAT_MIN) / GRADE
    dlng = (LNG_MAX - LNG_MIN) / GRADE
    for i in range(GRADE):
        for j in range(GRADE):
            yield {
                "low": {"latitude": LAT_MIN + i * dlat, "longitude": LNG_MIN + j * dlng},
                "high": {"latitude": LAT_MIN + (i + 1) * dlat, "longitude": LNG_MIN + (j + 1) * dlng},
            }


def main():
    chave = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not chave:
        sys.exit("Defina a variável de ambiente GOOGLE_PLACES_API_KEY.")
    termos = sys.argv[1:] or TERMOS_PADRAO

    lugares = {}
    for termo in termos:
        for ret in retangulos():
            for p in buscar(chave, termo, ret):
                lugares.setdefault(p["id"], p)
        print(f"{termo}: {len(lugares)} lugares únicos até agora", file=sys.stderr)

    nome_arquivo = f"places_joinville_{'_'.join(t.replace(' ', '-') for t in termos)}.csv"
    with open(nome_arquivo, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["nome", "endereco", "site", "telefone", "delivery", "retirada",
                    "nota", "avaliacoes", "situacao", "tipo", "google_maps"])
        for p in sorted(lugares.values(), key=lambda p: p["displayName"]["text"].lower()):
            if "Joinville" not in p.get("formattedAddress", ""):
                continue
            w.writerow([
                p["displayName"]["text"], p.get("formattedAddress", ""),
                p.get("websiteUri", ""), p.get("nationalPhoneNumber", ""),
                {True: "sim", False: "não"}.get(p.get("delivery"), ""),
                {True: "sim", False: "não"}.get(p.get("takeout"), ""),
                p.get("rating", ""), p.get("userRatingCount", ""),
                p.get("businessStatus", ""), p.get("primaryType", ""),
                p.get("googleMapsUri", ""),
            ])
    print(f"Salvo em {nome_arquivo}", file=sys.stderr)


if __name__ == "__main__":
    main()
