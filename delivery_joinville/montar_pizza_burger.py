#!/usr/bin/env python3
"""Junta a varredura do Google Places com os links achados na web e gera o
relatório final de pizzarias e hamburguerias/lanchonetes de Joinville.

Uso: python3 montar_pizza_burger.py   (lê dados/v_pizza.csv, dados/v_burger.csv, dados/extras_verif.json)
"""
import csv
import unicodedata
import json
import re
import subprocess
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from gerar_relatorio import plataforma

DATA = "03/10/2026"
PIZZA = re.compile(r"pizz|forner|trattor", re.I)
HAMB = re.compile(r"burg|búrg|hamb|smash", re.I)
LANCHE = re.compile(r"lanch|\bx[- ]|\bxis|dog|sandu", re.I)
# Links da web que o Google associou a outro estabelecimento por engano: entram só como link avulso
ERRADOS = {"Pizzaria Joinville", "The Famous Burger", "J.J. Burguer", "Sabor + Pizzaria e Hamburgueria"}
# Achados só na web, com Joinville indicado pela própria plataforma
SO_WEB = {"Pizzaria Joinville": "América", "The Famous Burger": "Nova Brasília", "BBQ Storm": "João Costa",
          "Hamburgueria Burguesly": "Jardim Paraíso", "Ap Hamburgueria": ""}


def cid(url):
    m = re.search(r"cid=(\d+)", url or "")
    return m.group(1) if m else url


def curl(url):
    return subprocess.run(["curl", "-sL", "-m", "25", url], capture_output=True, text=True).stdout


def status_goomer(link):
    m = re.search(r"https?://(?:www\.)?goomer\.app/([^/?]+)", link)
    url = f"https://{m.group(1)}.goomer.app/" if m else link
    h = curl(url)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        return "Inativa (404)"
    s = json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("settings") or {}
    plano = (s.get("subscription_info") or {}).get("pack_type")
    if plano in (None, "free"):
        return "Inativa (404)"
    try:
        n = len(json.loads(curl(s.get("menu_url", ""))).get("products", []))
    except Exception:
        n = 0
    return "Ativa" if n else "Conferir"


def status_cardapioweb(link):
    if "app.cardapioweb.com/" not in link:
        return "Conferir"
    return "Ativa" if re.search(r"<title>[^<]+", curl(link)) else "Inativa"


def main():
    lugares = {}
    for f in ("dados/v_pizza.csv", "dados/v_burger.csv"):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            lugares[cid(r["google_maps"])] = r
    sel = {}
    for k, r in lugares.items():
        tipos, nome = r["tipos"], r["nome"]
        cats = []
        if "pizza" in tipos or PIZZA.search(nome):
            cats.append("Pizzaria")
        if "hamburger_restaurant" in tipos or HAMB.search(nome):
            cats.append("Hamburgueria")
        elif LANCHE.search(nome):
            cats.append("Lanchonete")
        if cats:
            sel[k] = dict(r, categoria=" e ".join(cats), links=[r["site"]] if r["site"] else [], origem="Google")

    for e in json.load(open("dados/extras_verif.json", encoding="utf-8")):
        if e["status"] == "joinville" and e["nome"] not in ERRADOS:
            k = cid(e["maps"])
            if k in sel:
                if e["link"] not in sel[k]["links"]:
                    sel[k]["links"].append(e["link"])
                continue
        if e["nome"] in SO_WEB:
            cat = "Pizzaria" if e["categoria"] == "pizza" else "Hamburgueria"
            sel["web:" + e["nome"]] = dict(nome=e["nome"], endereco=SO_WEB[e["nome"]] and f"{SO_WEB[e['nome']]}, Joinville - SC",
                                           site="", telefone="", delivery="", nota="", avaliacoes="", situacao="OPERATIONAL",
                                           google_maps="", categoria=cat, links=[e["link"]], origem="Só na web")

    # Lojas Goomer / Cardápio Web levantadas antes (plataformas_lista.csv), com status já conferido
    cache = {}
    def norm(t):
        t = unicodedata.normalize("NFKD", t.lower()).encode("ascii", "ignore").decode()
        return " ".join(w for w in re.sub(r"[^a-z0-9 ]", " ", t).split() if w not in {"joinville", "de", "da", "do", "e", "the"})
    por_nome = {norm(r["nome"]): k for k, r in sel.items()}
    for l in csv.DictReader(open("plataformas_lista.csv", encoding="utf-8")):
        if l["categoria"] not in ("Hambúrguer e lanches", "Pizza e italiana"):
            continue
        cache[l["link"]] = {"Inativa (404)": "Inativa (404)"}.get(l["status"], l["status"])
        n = norm(l["nome"])
        alvo = [k for k in por_nome if k == n or (min(len(n.split()), len(k.split())) >= 2 and (n in k or k in n))]
        if alvo:
            r = sel[por_nome[alvo[0]]]
            if l["link"] not in r["links"]:
                r["links"].append(l["link"])
        elif not any(l["link"] in r["links"] for r in sel.values()):
            cat = "Pizzaria" if l["categoria"] == "Pizza e italiana" else "Hamburgueria"
            sel["lista:" + l["nome"]] = dict(nome=l["nome"], endereco="", site="", telefone="", delivery="", nota="",
                                             avaliacoes="", situacao="OPERATIONAL", google_maps="", categoria=cat,
                                             links=[l["link"]], origem="Busca na web")
    for r in sel.values():
        st = []
        for l in r["links"]:
            if "goomer" in l:
                cache.setdefault(l, status_goomer(l))
                st.append(f"Goomer: {cache[l]}")
            elif "cardapioweb" in l:
                cache.setdefault(l, status_cardapioweb(l))
                st.append(f"Cardápio Web: {cache[l]}")
        r["status_link"] = "; ".join(st)
        r["plataformas"] = ", ".join(dict.fromkeys(plataforma(l) for l in r["links"])) or "Sem site no Google"
        m = re.search(r"([^,]+), Joinville", r["endereco"] or "")
        r["bairro"] = m.group(1).split(" - ")[-1].strip() if m else ""
    linhas = sorted(sel.values(), key=lambda r: (r["categoria"], r["nome"].lower()))
    salvar_xlsx(linhas)
    salvar_pdf(linhas)
    com = [r for r in linhas if r["links"]]
    print(f"total {len(linhas)}; com link {len(com)}")
    for c in ("Pizzaria", "Hamburgueria", "Lanchonete"):
        print(c, sum(c in r["categoria"] for r in linhas), "com link", sum(c in r["categoria"] for r in com))


def salvar_xlsx(linhas):
    wb = Workbook()
    cab = ["Categoria", "Nome", "Bairro", "Link 1", "Link 2", "Link 3", "Plataformas", "Status Goomer/Cardápio Web",
           "Telefone", "Faz delivery?", "Nota Google", "Nº avaliações", "Endereço", "Google Maps", "Origem"]
    abas = [("Com site de pedido", [r for r in linhas if r["links"]]), ("Sem site no Google", [r for r in linhas if not r["links"]])]
    for i, (titulo, dados) in enumerate(abas):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = titulo
        ws.append(cab)
        for c in ws[1]:
            c.font, c.fill = Font(name="Arial", bold=True, color="FFFFFF"), PatternFill("solid", fgColor="C0392B")
        for r in dados:
            l = r["links"] + ["", "", ""]
            ws.append([r["categoria"], r["nome"], r["bairro"], l[0], l[1], l[2], r["plataformas"], r["status_link"],
                       r["telefone"], r["delivery"] or "sem info", float(r["nota"]) if r["nota"] else None,
                       int(r["avaliacoes"]) if r["avaliacoes"] else None, r["endereco"], r["google_maps"], r["origem"]])
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.font = Font(name="Arial", size=10)
            for j in (3, 4, 5, 13):
                if row[j].value:
                    row[j].hyperlink, row[j].font = row[j].value, Font(name="Arial", size=10, color="0563C1", underline="single")
        for col, w in zip("ABCDEFGHIJKLMNO", [24, 36, 18, 45, 35, 25, 22, 26, 16, 12, 11, 12, 50, 35, 12]):
            ws.column_dimensions[col].width = w
        ws.freeze_panes, ws.auto_filter.ref = "C2", ws.dimensions
    n = wb.create_sheet("Notas")
    for t in [f"Levantamento de {DATA}.",
              "Fonte principal: Google Places API, varredura de Joinville inteira (área subdividida até nenhuma busca bater o limite de 60 resultados).",
              "Termos: pizzaria, pizza delivery, pizza, pizzaria e esfiharia, hamburgueria, hamburguer, burger, smash burger, lanches, lanchonete, x-salada, hot dog; e filtros de tipo do Google (pizzaria, hamburgueria, fast food, lanchonete).",
              "Complemento: links de pedido achados na web (MenuDino, Anota.ai, pedir.delivery, Ola.click, Neemo, Brendi, Chefware etc.), conferidos no Google.",
              "Categoria: tipo cadastrado no Google ou nome do lugar. 'Lanchonete' = lanches em geral, sem indicação clara de hamburgueria.",
              "Status Goomer: lojas do plano grátis mostram erro 404 (Inativa); plano pago com produtos = Ativa.",
              "Link 1 é o site cadastrado no Google; Links 2 e 3 vieram de buscas na web."]:
        n.append([t])
    n.column_dimensions["A"].width = 140
    wb.save("pizzarias_hamburguerias_joinville.xlsx")


def salvar_pdf(linhas):
    pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
    cel = ParagraphStyle("c", fontName="DV", fontSize=6.8, leading=8.2)
    lnk = ParagraphStyle("l", parent=cel, textColor=colors.HexColor("#0563C1"))
    hdr = ParagraphStyle("h", fontName="DVB", fontSize=7.5, leading=9, textColor=colors.white)
    h1 = ParagraphStyle("h1", fontName="DVB", fontSize=16, leading=20, spaceAfter=4)
    h2 = ParagraphStyle("h2", fontName="DVB", fontSize=12.5, leading=16, spaceBefore=8, spaceAfter=4)
    txt = ParagraphStyle("t", fontName="DV", fontSize=8.5, leading=11)

    def tabela(itens):
        d = [[Paragraph(h, hdr) for h in ["#", "Nome", "Bairro", "Site / link de pedido", "Plataforma", "Status", "Telefone", "Nota"]]]
        for i, r in enumerate(itens, 1):
            links = "<br/>".join(f'<link href="{escape(l)}">{escape(l.split("?")[0][:58])}</link>' for l in r["links"])
            d.append([Paragraph(str(i), cel), Paragraph(escape(r["nome"]), cel), Paragraph(escape(r["bairro"]), cel),
                      Paragraph(links, lnk), Paragraph(escape(r["plataformas"]), cel),
                      Paragraph(escape(r["status_link"]), cel), Paragraph(escape(r["telefone"]), cel),
                      Paragraph(f'{float(r["nota"]):.1f} ({r["avaliacoes"]})' if r["nota"] else "", cel)])
        t = Table(d, colWidths=[24, 150, 80, 220, 80, 95, 77, 50], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#C0392B")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F6F6")]),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
                               ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        return t

    def rodape(c, doc):
        c.setFont("DV", 7)
        c.setFillColor(colors.grey)
        c.drawString(28, 16, f"Pizzarias e hamburguerias de Joinville com site de pedido · {DATA}")
        c.drawRightString(landscape(A4)[0] - 28, 16, f"Página {doc.page}")

    com = [r for r in linhas if r["links"]]
    story = [Paragraph("Pizzarias e hamburguerias de Joinville com site de pedido", h1),
             Paragraph(f"Levantamento de {DATA}. Varredura completa de Joinville no Google Places, somada a links de pedido "
                       "achados na web. Aqui estão só os lugares com algum site ou link de pedido; a planilha traz também os "
                       f"{len(linhas) - len(com)} lugares sem site cadastrado no Google. No Goomer, lojas do plano grátis dão erro 404 "
                       "(\"Inativa\"). Os links são clicáveis.", txt)]
    for i, c in enumerate(("Pizzaria", "Hamburgueria", "Lanchonete")):
        itens = [r for r in com if r["categoria"].split(" e ")[0] == c]
        titulo = {"Pizzaria": "Pizzarias (inclui pizzaria e hamburgueria)", "Hamburgueria": "Hamburguerias",
                  "Lanchonete": "Lanchonetes e lanches"}[c]
        if i:
            story.append(PageBreak())
        story += [Paragraph(f"{titulo} ({len(itens)})", h2), tabela(itens)]
    SimpleDocTemplate("pizzarias_hamburguerias_joinville.pdf", pagesize=landscape(A4), leftMargin=28, rightMargin=28,
                      topMargin=28, bottomMargin=30, title="Pizzarias e hamburguerias de Joinville").build(
        story, onFirstPage=rodape, onLaterPages=rodape)


if __name__ == "__main__":
    main()
