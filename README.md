# Prosecco-3d-Map
A 3d Map of the UNESCO area of the Prosecco Hills

## Mappa 3D Colline del Prosecco – web app

Prototipo della mappa turistica 3D, sviluppato per fasi secondo la specifica di progetto.
Stato attuale: **Fasi 1–7 completate** (plastico, nomi delle località, itinerari animati, monumenti, immagini e foto 360, interfaccia completa, area redazione).

## Requisiti
- Node.js 20 o superiore

## Avvio
```
npm install
npm run dev        # anteprima locale su http://localhost:5173
npm run build      # versione pubblicabile nella cartella dist/ (usa il modello caricato sulla pagina)
npm run build                    # versione standard (modello in public/models/plastico.glb), ad es. per GitHub Pages
npm run build:claude             # versione per la pagina pubblicata su Claude (modello nell'archivio della pagina)
```

## Ottimizzazione del plastico
Il file originale `plastico prosecco con monumenti.glb` (167 MB) viene ridotto a circa 16 MB:
```
npm run optimize -- "../plastico prosecco con monumenti.glb" public/models/plastico.glb
```
Lo script `scripts/optimize.mjs`:
- rimuove camere, luci, i nodi `Originale_Percorso_*` e i percorsi non semplificati (`Percorso N COLORE`);
- semplifica il terreno (circa 45% dei vertici) e i tubi dei percorsi semplificati (circa 15%);
- converte la texture del terreno in WebP e comprime la geometria (meshopt).
Va rieseguito ogni volta che si aggiorna il plastico in 3ds Max.

## Dati (modificabili, poi nel backend redazione)
- `public/data/localita.json`: 66 località con nome, livello (1|2|3), posizione u/v sulla mappa (0–1), itinerari, visibilità e fonte della posizione.
  Le posizioni vengono dai punti dei file Illustrator dei percorsi o, per le località fuori percorso, dalle etichette della mappa stradale.
  Per spostare una località: clic sul plastico, leggere "pixel mappa" nel pannello e dividere per 12292 (u) e 7898 (v).
- `public/data/itinerari.json`: i 4 itinerari con nome, colore, nodo del plastico e tracciato (dai file Illustrator).
Mappa stradale, file .ai e texture del terreno coprono la stessa area: per questo le coordinate u/v valgono per tutti.

## Contenuti multimediali (Fase 5)
```
python3 scripts/prepara_contenuti.py ".." public
```
Legge le cartelle "Immagini territorio" e "foto360 prosecco" della cartella di progetto e crea in `public/media`:
anteprime da 1600 px (WebP), icone a bullet point, foto 360 da 4000 px e miniature da 100 px.
L'associazione file → punto di interesse è nella tabella `ASSOCIAZIONI` dello script: per un file nuovo
va aggiunta una riga. Il risultato è `public/data/contenuti.json` (campi: tipo, titolo, descrizione, poi,
sempre_visibile, distanza_attivazione, fonte, diritti, note).

## Interfaccia (Fase 6)
- In alto a sinistra: **Veduta aerea** (territorio intero visto da sud) e **Prima persona**. Dalla veduta aerea, toccando il terreno si scende in prima persona in quel punto.
- In alto a destra: menu con **Cerca**, **Itinerari animati** (mostra/nascondi e volo), **Punti di interesse** per categoria, **Foto 360**, **Game**.
- Prima persona: W A S D o frecce, trascinamento per guardarsi intorno, Maiusc per correre; sul telefono joystick in basso a sinistra.
- Volo: camera a circa 10 m dal terreno, Avvia/Pausa, velocità 0,5×–4×, barra di avanzamento.
- Link diretti: `#localita-conegliano`, `#monumento-abbazia-di-follina`, `#itinerario-2`, `#foto-<id del contenuto>`. Con `#debug` si apre il pannello di prova (coordinate del terreno).
- Testi dell'interfaccia in `src/ui/i18n.ts` (pronti per altre lingue).

### Audio geoposizionati
`public/data/audio.json` (vuoto per ora): un elenco di
```json
{ "id": "benvenuto-follina", "itinerario": 2, "titolo": "Benvenuti a Follina",
  "file": "media/audio/follina.mp3", "u": 0.47, "v": 0.21, "raggio": 150 }
```
u e v sono le coordinate sulla mappa (pixel della mappa stradale diviso 12292 e 7898; il pannello `#debug` le mostra).
Quando la camera entra nel raggio (m) il volo si ferma, parte l'audio e il volo riprende alla fine o con Avvia.

### Giochi
`public/data/giochi.json` (vuoto: il menu mostra "Prossimamente"). Con un solo gioco abilitato il tasto Game lo avvia direttamente, con più giochi mostra l'elenco.

## Area redazione "Personalizza" (Fase 7)
Il pulsante **Personalizza** compare solo a chi può modificare (prototipo: chi è Editor o proprietario della pagina su Claude;
versione Supabase: utenti con ruolo `redazione`). Schede:
- **Località**: nome, livello 1/2/3, categoria nei Punti di interesse, visibilità, posizione scelta toccando il plastico.
- **Contenuti**: immagine, foto 360, testo, video, link, PDF; caricamento del file (le immagini vengono ridotte e trasformate in icona
  nel browser, le foto 360 portate a 4000 px con miniatura da 100 px), collocazione su località, monumento o punto libero,
  sempre visibile / distanza di attivazione, fonte, diritti, bozza o pubblicato.
- **Importa**: incollando link (Wikipedia, YouTube, siti autorizzati, PDF) crea bozze con tipo, titolo e fonte già compilati.
- **Audio**: audio geoposizionati lungo gli itinerari (file, punto, raggio).
- **Giochi**: titolo, tipo, testi, immagine, abilitazione (la meccanica non si modifica da qui).
- **Parametri**: soglie dei nomi, scala dei monumenti, dimensione delle icone, distanza di attivazione, volo e prima persona.

Le modifiche si sovrappongono ai file di `public/data` per id (stesso id = sostituisce, `eliminato: true` = nasconde, id nuovo = aggiunge)
e arrivano in tempo reale a chi ha la mappa aperta. Codice: `src/data/store.ts` (contratto e archivio del prototipo),
`src/data/supabaseStore.ts`, `src/admin/editor.ts`, `src/admin/media.ts`.

### Passaggio a Supabase (versione definitiva)
1. Creare un progetto Supabase ed eseguire `supabase/schema.sql` (tabelle, regole di accesso, archivio `media`, tempo reale).
2. Creare un file `.env` con `VITE_SUPABASE_URL=...` e `VITE_SUPABASE_ANON_KEY=...` e ricompilare: l'app usa Supabase al posto del database della pagina.
3. Registrare gli utenti della redazione e assegnare il ruolo come indicato in fondo a `schema.sql`.
4. Da completare: la schermata di accesso della redazione (la funzione `signIn` è già in `SupabaseStore`) e una Edge Function per il
   recupero automatico dei testi da Wikipedia e degli operatori da OpenStreetMap (con attribuzione e licenza).
`SupabaseStore` segue lo stesso contratto dell'archivio del prototipo ma va verificato sul primo progetto reale.

## Struttura
- `src/config.ts`: tutti i parametri (nomi dei nodi, scala, veduta aerea, colori)
- `src/scene/loadPlastico.ts`: caricamento del modello, separazione in territorio, itinerari e monumenti, quota del terreno con `getTerrainHeight(x, z)`
- `src/scene/geo.ts`: conversione u/v della mappa ↔ coordinate del plastico
- `src/layers/labels.ts`: Fase 2, nomi con scale importance code (soglie in `CONFIG.labels`)
- `src/layers/routes.ts`: Fase 3, sfere che percorrono gli itinerari avanti e indietro (`CONFIG.routes`)
- `src/layers/monuments.ts`: Fase 4, scala dei monumenti in funzione della distanza (`CONFIG.monuments`)
- `src/layers/content.ts`: Fase 5, icone immagini (impostor) e sfere 360 (`CONFIG.content`)
- `src/ui/viewers.ts`: scheda dell'immagine e visualizzatore 360 a schermo intero
- `src/app/pois.ts`: punti di interesse (località e monumenti) con i contenuti collegati
- `src/modes/firstPerson.ts`: vista in prima persona; `src/modes/routeFlight.ts`: volo lungo gli itinerari con audio
- `src/ui/menu.ts`: menu, ricerca, elenchi; `src/ui/poiCard.ts`: scheda del punto di interesse
- `src/main.ts`: scena, luci, controlli touch e mouse, pannello di prova
- `scripts/`: script di ottimizzazione e analisi del modello

## Dati ricavati dal modello
- Area: circa 40,4 × 25,8 km; 1 unità del modello ≈ 1 m in orizzontale
- Rilievo esagerato 1,6 volte in verticale (quota massima reale ≈ 1568 m)
- Monumenti trovati (8): campanile Roganzuolo, castello Conegliano, castello di San Salvatore, Col San Martino, abbazia di Follina, villa dei Cedri, parco archeologico del Livelet, Serravalle Vittorio Veneto
- Nel modello il nodo della villa è scritto "monumneto villa dei cedri": il codice accetta il refuso, ma conviene correggerlo nel file sorgente

## Comandi del plastico
- Mouse: sinistro sposta, destro ruota, rotella zooma
- Touch: un dito sposta, due dita zoomano e ruotano
- Clic o tap sul terreno: coordinate del modello e quota (servono per i punti di controllo lat/lon)


### Monumenti fuori posto
In `src/config.ts` › `monuments.position` si può riportare un monumento del modello sul punto corretto indicando `u, v` della mappa (es. `'abbazia di follina': { u: 0.4056, v: 0.2935 }`). Foto e 360° collegati al monumento lo seguono.


## Pubblicazione su GitHub Pages
Il flusso `.github/workflows/pages.yml` compila la webapp e la pubblica su GitHub Pages a ogni push sul ramo `main`
(Settings › Pages › Source: GitHub Actions). L'indirizzo sarà `https://<account>.github.io/Prosecco-3d-Map/`.
Su GitHub Pages i contenuti della redazione (Personalizza) non si salvano: per quello serve Supabase (vedi sopra).
