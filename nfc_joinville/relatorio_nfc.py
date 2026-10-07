#!/usr/bin/env python3
"""Gera PDF e planilha com lugares de Joinville que podem vender etiqueta NFC, com link de WhatsApp."""
import json
import re
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

DATA = "07/10/2026"
GRUPOS = [
    ("1. NFC, RFID, cartões e etiquetas (mais prováveis)",
     r"nfc|rfid|card|cart[õo]|crach|identifica|\btag\b|chip|etiquet|r[óo]tulo|safetag|giltar|dahctar|inventygraf"),
    ("2. Componentes eletrônicos e maker", r"componente|eletr[ôo]nic|maker|arduino|htron|hiteck|valgri|tokyo|lecomp|mr electron"),
    ("3. Controle de acesso e segurança eletrônica", r"controle de acesso|catraca|biometri|seguran[çc]a eletr|alarme|portaria|giltar"),
    ("3. Gráficas e personalizados (cartão ou placa NFC sob encomenda)",
     r"gr[áa]fica|brinde|personaliz|placa|comunica|print|plot|impress|adesivo|sinaliza|homenage|presente"),
]
FORA = re.compile(r"automa[çc][ãa]o industrial|rob[óo]tica industrial|kuka|pneum|hidr[áa]ul|iiot|celular|assist[êe]ncia|"
                  r"brech|vigil[âa]ncia|monitoramento|facilities|placas? (automotiv|mercosul)|mcA placas|maxi placas|placas norte", re.I)


def whatsapp(r):
    dig = re.sub(r"\D", "", r["telefone"])
    if r["whatsapp"]:
        return r["whatsapp"], "celular"
    if len(dig) == 10 and dig.startswith("47"):
        return "https://wa.me/55" + dig, "fixo"
    return "", ""


def main():
    R = json.load(open("dados_places.json", encoding="utf-8"))
    usados, grupos = set(), []
    for titulo, pad in GRUPOS:
        rx = re.compile(pad, re.I)
        itens = []
        for r in R:
            if r["maps"] in usados or FORA.search(r["nome"]) or not rx.search(r["nome"] + " " + r["site"]):
                continue
            usados.add(r["maps"])
            m = re.search(r"([^,]+), Joinville", r["endereco"])
            r["bairro"] = m.group(1).split(" - ")[-1].strip() if m else ""
            r["wa"], r["tipo_tel"] = whatsapp(r)
            itens.append(r)
        itens.sort(key=lambda r: (r["tipo_tel"] != "celular", -(r["aval"] or 0)))
        if itens:
            grupos.append((titulo, itens))

    wb = Workbook()
    ws = wb.active
    ws.title = "Lugares"
    ws.append(["Grupo", "Nome", "WhatsApp", "Telefone", "Tipo de número", "Bairro", "Endereço", "Site", "Nota", "Avaliações", "Google Maps"])
    for c in ws[1]:
        c.font, c.fill = Font(name="Arial", bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1E8449")
    for titulo, itens in grupos:
        for r in itens:
            ws.append([titulo, r["nome"], r["wa"], r["telefone"], r["tipo_tel"], r["bairro"], r["endereco"], r["site"],
                       r["nota"] or None, r["aval"] or None, r["maps"]])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = Font(name="Arial", size=10)
        for i in (2, 7, 10):
            if row[i].value:
                row[i].hyperlink, row[i].font = row[i].value, Font(name="Arial", size=10, color="0563C1", underline="single")
    for col, w in zip("ABCDEFGHIJK", [40, 42, 30, 16, 12, 18, 55, 40, 8, 11, 40]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes, ws.auto_filter.ref = "C2", ws.dimensions
    wb.save("nfc_joinville.xlsx")

    pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
    cel = ParagraphStyle("c", fontName="DV", fontSize=7.3, leading=9)
    lnk = ParagraphStyle("l", parent=cel, textColor=colors.HexColor("#0563C1"))
    hdr = ParagraphStyle("h", fontName="DVB", fontSize=8, leading=10, textColor=colors.white)
    h1 = ParagraphStyle("h1", fontName="DVB", fontSize=16, leading=20, spaceAfter=4)
    h2 = ParagraphStyle("h2", fontName="DVB", fontSize=12, leading=15, spaceBefore=10, spaceAfter=4)
    txt = ParagraphStyle("t", fontName="DV", fontSize=8.5, leading=11)
    story = [Paragraph("Onde achar etiqueta NFC em Joinville", h1),
             Paragraph(f"Levantamento de {DATA} no Google Maps. Nenhum lugar teve o estoque confirmado: mande mensagem antes de ir. "
                       "WhatsApp: números de celular quase sempre têm; em número fixo (marcado \"fixo\") o WhatsApp pode não existir. "
                       "Em cada grupo, os de celular vêm primeiro. Os links são clicáveis.", txt)]
    for titulo, itens in grupos:
        d = [[Paragraph(h, hdr) for h in ["#", "Nome", "WhatsApp", "Telefone", "Bairro", "Site", "Nota"]]]
        for i, r in enumerate(itens, 1):
            wa = f'<link href="{r["wa"]}">{r["wa"].replace("https://", "")}</link>' + (" (fixo)" if r["tipo_tel"] == "fixo" else "") if r["wa"] else "—"
            d.append([Paragraph(str(i), cel), Paragraph(escape(r["nome"]), cel), Paragraph(wa, lnk),
                      Paragraph(escape(r["telefone"]), cel), Paragraph(escape(r["bairro"]), cel),
                      Paragraph(f'<link href="{escape(r["site"])}">{escape(r["site"].split("?")[0][:45])}</link>', lnk) if r["site"] else Paragraph("", cel),
                      Paragraph(f'{r["nota"]} ({r["aval"]})' if r["nota"] else "", cel)])
        t = Table(d, colWidths=[22, 200, 150, 78, 90, 190, 55], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E8449")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F6F4")]),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
                               ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
        story += [Paragraph(f"{titulo} ({len(itens)})", h2), t]

    def rodape(c, doc):
        c.setFont("DV", 7)
        c.setFillColor(colors.grey)
        c.drawString(28, 16, f"Etiqueta NFC em Joinville · {DATA}")
        c.drawRightString(landscape(A4)[0] - 28, 16, f"Página {doc.page}")
    SimpleDocTemplate("nfc_joinville.pdf", pagesize=landscape(A4), leftMargin=28, rightMargin=28, topMargin=28,
                      bottomMargin=30, title="Etiqueta NFC em Joinville").build(story, onFirstPage=rodape, onLaterPages=rodape)
    for titulo, itens in grupos:
        print(titulo, len(itens), "com WhatsApp celular:", sum(r["tipo_tel"] == "celular" for r in itens))
        for r in itens[:40]:
            print("   ", r["nome"][:60], "|", r["bairro"], "|", r["wa"], r["tipo_tel"])


if __name__ == "__main__":
    main()
