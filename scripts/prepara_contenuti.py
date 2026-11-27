"""
Fase 5 – Preparazione dei contenuti multimediali.

- Immagini (cartella "Immagini territorio"): anteprima 1600 px (WebP) e icona a bullet point
  (foto circolare con bordo bianco e asta inferiore, come "bullet point immagini.fbx").
- Foto 360 (cartella "foto360 prosecco"): versione da 4000 px di larghezza (JPEG) e miniatura da 100 px
  da mappare sulla sfera.
- Associa ogni file al punto di interesse citato nel nome (tabella ASSOCIAZIONI, modificabile)
  e scrive public/data/contenuti.json.

Uso: python3 scripts/prepara_contenuti.py "<cartella progetto>" public
"""
import json, os, re, sys, unicodedata
from PIL import Image, ImageDraw, ImageFilter, ImageOps

Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]

# nome file (senza estensione, senza numeri finali) -> titolo, punto di interesse, note
# poi: ("localita", id) oppure ("monumento", nome del nodo senza prefisso)
ASSOCIAZIONI = {
    "cantina, Nervesa Della Battaglia": ("Cantina a Nervesa della Battaglia", ("localita", "nervesa-della-battaglia"), None),
    "castle Brando in Cison di Valmarino": ("CastelBrando, Cison di Valmarino", ("localita", "cison-di-valmarino"), None),
    "castle of San Salvatore in Susegana": ("Castello di San Salvatore, Susegana", ("monumento", "castello di san salvatore"), None),
    "Chiesa di Rolle church in Rolle Cison di Valmarino": ("Chiesa di Rolle", ("localita", "rolle"), None),
    "cison di valmarino castelbrando": ("CastelBrando", ("localita", "cison-di-valmarino"), None),
    "Col Vetoraz conegliano": ("Col Vetoraz", ("localita", "conegliano"), "Posizione da verificare: il nome cita Conegliano"),
    "Combai": ("Combai", ("localita", "combai"), None),
    "Guia": ("Guia", ("localita", "guia"), None),
    "Meschio River in Cordignano": ("Il fiume Meschio a Cordignano", ("localita", "cordignano"), None),
    "Monumento ossario di Nervesa della battaglia": ("Ossario di Nervesa della Battaglia", ("localita", "nervesa-della-battaglia"), None),
    "mulino di Refrontolo": ("Mulino di Refrontolo", ("localita", "refrontolo"), None),
    "Nervesa della battaglia piave": ("Il Piave a Nervesa della Battaglia", ("localita", "nervesa-della-battaglia"), None),
    "Prosecco vinyard near Santo Stefano,": ("Vigneti di Prosecco a Santo Stefano", ("localita", "santo-stefano"), None),
    "Ruins Of The Abbey Of Sant'Eustachio Nervesa Della Battaglia": ("Rovine dell'abbazia di Sant'Eustachio", ("localita", "nervesa-della-battaglia"), None),
    "Ruins Of The Abbey Of Sant'Eustachio, Nervesa Della Battaglia": ("Rovine dell'abbazia di Sant'Eustachio", ("localita", "nervesa-della-battaglia"), None),
    "San pietro di feletto viale": ("Viale di San Pietro di Feletto", ("localita", "san-pietro-di-feletto"), None),
    "San pietro di feletto": ("San Pietro di Feletto", ("localita", "san-pietro-di-feletto"), None),
    "San Vigilio Church in Col San Martino": ("Chiesetta di San Vigilio, Col San Martino", ("localita", "col-san-martino"), None),
    "Santa Lucia di Piave": ("Santa Lucia di Piave", ("localita", "santa-lucia-di-piave"), None),
    "Santa Maria di Follina": ("Abbazia di Santa Maria di Follina", ("monumento", "abbazia di follina"), None),
    "Tarzo colline": ("Colline di Tarzo", ("localita", "tarzo"), None),
    "Tempio di S. Martino": ("Tempio di San Martino", None, "Nessuna località nel nome del file: da posizionare"),
    "chiesa di colle san martino a Valdobbiadene": ("Chiesa di Colle San Martino, Valdobbiadene", ("localita", "valdobbiadene"), None),
    "valdobiadene centro storico": ("Centro storico di Valdobbiadene", ("localita", "valdobbiadene"), None),
    "Conegliano colle con il Castello e le ville storiche": ("Il colle del Castello e le ville storiche, Conegliano", ("monumento", "castello conegliano"), None),
    "conegliano facciata affrescata della cattedrale": ("Facciata affrescata del Duomo di Conegliano", ("localita", "conegliano"), None),
    "Conegliano teatro Accademia in piazza Cima": ("Teatro Accademia in piazza Cima, Conegliano", ("localita", "conegliano"), None),
    "vittorio veneto centro storico di Serravalle": ("Centro storico di Serravalle, Vittorio Veneto", ("monumento", "serravalle vittorio veneto"), None),
    "vittorio veneto serravalle fontana di Santa Augusta": ("Fontana di Santa Augusta, Serravalle", ("monumento", "serravalle vittorio veneto"), None),
    "San_Pietro_di_Feletto_-_Facciata_della_pieve_-_Foto_di_Paolo_Steffan": ("Facciata della pieve di San Pietro di Feletto", ("localita", "san-pietro-di-feletto"), None),
    "vidor colline prosecco": ("Colline del Prosecco a Vidor", ("localita", "vidor"), None),
    # foto 360
    "conegliano formeniga3": ("Formeniga", ("localita", "conegliano"), "Posizione da verificare: il nome cita Conegliano"),
    "conegliano manzana3 albero rosso": ("Manzana, l'albero rosso", ("localita", "conegliano"), "Posizione da verificare: il nome cita Conegliano"),
    "valdobbiadene vigneto giallo anfiteatro1 corretta colore2": ("L'anfiteatro dei vigneti, Valdobbiadene", ("localita", "valdobbiadene"), None),
    "vittorio veneto serravalle collina 9600": ("Serravalle dalla collina", ("monumento", "serravalle vittorio veneto"), None),
}


def crediti(fname):
    """Crediti da mostrare nella scheda: le foto di Wikimedia Commons hanno "Foto di <autore>" nel nome."""
    m = re.search(r"Foto[_ ]di[_ ](.+?)(\.[a-z]+)?$", fname, re.I)
    return f"Foto di {m.group(1).replace('_', ' ')} – Wikimedia Commons" if m else None


def chiave(fname):
    base = os.path.splitext(fname)[0]
    base = base.replace("_Editorial_Use_Only", "")
    base = re.sub(r"[_ ]?\d{6,}$", "", base)   # codici numerici finali dei file d'archivio
    return base.strip()


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def icona_bullet(im, path, d=192, ring=9):
    """Foto ritagliata in cerchio, bordo bianco, ombra e asta inferiore (proporzioni del modello FBX)."""
    stick = int(d * 1.46)
    W, H = d + 16, d + stick + 8
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # ombra
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((8, 10, 8 + d, 10 + d), fill=(0, 0, 0, 110))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(5)))
    # asta: bianca con contorno scuro
    cx = W // 2
    dr = ImageDraw.Draw(canvas)
    dr.rectangle((cx - 3, 8 + d - 4, cx + 3, H - 1), fill=(38, 52, 59, 230))
    dr.rectangle((cx - 1, 8 + d - 4, cx + 1, H - 2), fill=(255, 255, 255, 255))
    # disco con foto
    photo = ImageOps.fit(im.convert("RGB"), (d - 2 * ring, d - 2 * ring), Image.LANCZOS)
    mask = Image.new("L", photo.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, photo.size[0] - 1, photo.size[1] - 1), fill=255)
    dr.ellipse((8, 4, 8 + d, 4 + d), fill=(255, 255, 255, 255))
    canvas.paste(photo, (8 + ring, 4 + ring), mask)
    canvas.save(path, "WEBP", quality=88)
    return {"w": W, "h": H, "disco": d + 8}


def main():
    loc = {l["id"]: l for l in json.load(open(os.path.join(OUT, "data", "localita.json")))}
    out_img = os.path.join(OUT, "media")
    os.makedirs(out_img, exist_ok=True)
    contenuti, report = [], []

    for cartella, tipo in (("Immagini territorio", "immagine"), ("foto360 prosecco", "foto360")):
        for f in sorted(os.listdir(os.path.join(SRC, cartella))):
            if not re.search(r"\.(jpe?g|png|webp)$", f, re.I):
                continue
            # le immagini "Editorial Use Only" non si possono usare a scopo promozionale: escluse dalla mappa
            if re.search(r"editorial[\s_-]*use[\s_-]*only", f, re.I):
                report.append(f"- {f}: escluso (licenza solo uso editoriale)")
                continue
            k = chiave(f)
            titolo, poi, nota = ASSOCIAZIONI.get(k, (k, None, "File non presente nella tabella delle associazioni"))
            if poi and poi[0] == "localita" and poi[1] not in loc:
                nota, poi = f"Località '{poi[1]}' non trovata", None
            sid = slug(k)
            # id univoco anche per file con lo stesso nome base
            n = 2
            base_id = sid
            while any(c["id"] == sid for c in contenuti):
                sid = f"{base_id}-{n}"; n += 1
            im = Image.open(os.path.join(SRC, cartella, f))
            im = ImageOps.exif_transpose(im).convert("RGB")
            rec = {"id": sid, "tipo": tipo, "titolo": titolo, "descrizione": "",
                   "poi": {"tipo": poi[0], "id": poi[1]} if poi else None,
                   "sempre_visibile": True, "distanza_attivazione": None,
                   "fonte": f"{cartella}/{f}", "diritti": crediti(f),
                   "note": nota, "visibile": poi is not None}
            if tipo == "immagine":
                prev = im.copy(); prev.thumbnail((1280, 1280), Image.LANCZOS)
                prev.save(os.path.join(out_img, f"{sid}.webp"), "WEBP", quality=80)
                rec["file"] = f"media/{sid}.webp"
                rec["icona"] = f"media/{sid}-icona.webp"
                rec["icona_dim"] = icona_bullet(im, os.path.join(OUT, rec["icona"]))
            else:
                full = im.resize((4000, 2000), Image.LANCZOS)
                full.save(os.path.join(out_img, f"{sid}-360.jpg"), "JPEG", quality=82, optimize=True, progressive=True)
                tiny = im.resize((100, 50), Image.LANCZOS)
                tiny.save(os.path.join(out_img, f"{sid}-360-100.jpg"), "JPEG", quality=85)
                rec["file"] = f"media/{sid}-360.jpg"
                rec["miniatura"] = f"media/{sid}-360-100.jpg"
            contenuti.append(rec)
            report.append((tipo, f, titolo, rec["poi"], nota))
            print(f"{tipo:9} {f[:60]:60} -> {rec['poi']}  {nota or ''}")

    json.dump(contenuti, open(os.path.join(OUT, "data", "contenuti.json"), "w"), ensure_ascii=False, indent=1)
    print(len(contenuti), "contenuti;", sum(1 for c in contenuti if not c["poi"]), "non associati")


if __name__ == "__main__":
    main()
