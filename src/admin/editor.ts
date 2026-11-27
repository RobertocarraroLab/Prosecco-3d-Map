import { CONFIG } from '../config';
import type { Store, Coll } from '../data/store';
import type { Localita } from '../layers/labels';
import type { Contenuto } from '../layers/content';
import type { AudioPoint } from '../modes/routeFlight';
import { slug, capitalize } from '../app/pois';
import { processImage, process360 } from './media';

export interface GiocoRec { id: string; titolo: string; tipo?: string; testi?: string; immagine?: string; abilitato: boolean; }
export interface Settings { [k: string]: number | undefined; }

export interface EditorDeps {
  store: Store;
  data(): { localita: Localita[]; contenuti: Contenuto[]; audio: AudioPoint[]; giochi: GiocoRec[]; settings: Settings };
  defaults: Settings;
  monumenti: string[];
  itinerari: { id: number; nome: string }[];
  /** Chiude temporaneamente il pannello e attende un tocco sul plastico. */
  pickPoint(msg: string): Promise<{ u: number; v: number } | null>;
  focusUV(u: number, v: number): void;
}

type Tab = 'localita' | 'contenuti' | 'importa' | 'audio' | 'giochi' | 'parametri';
const TABS: [Tab, string][] = [
  ['localita', 'Località'], ['contenuti', 'Contenuti'], ['importa', 'Importa'],
  ['audio', 'Audio'], ['giochi', 'Giochi'], ['parametri', 'Parametri'],
];
const TIPI: [string, string][] = [
  ['immagine', 'Immagine'], ['foto360', 'Foto 360'], ['testo', 'Testo'],
  ['video', 'Video'], ['link', 'Link'], ['pdf', 'PDF'],
];

// --- piccoli costruttori DOM (i valori entrano sempre come testo, mai come HTML) ---
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, any>> = {}, ...kids: (Node | string | null)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k !== 'list' && k in e) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c !== null) e.append(c);
  return e;
}
const field = (label: string, input: HTMLElement, hint?: string) =>
  h('label', { class: 'f' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
const uniqueId = (base: string, taken: Set<string>) => {
  let id = slug(base) || 'elemento', n = 2;
  const b = id;
  while (taken.has(id)) id = `${b}-${n++}`;
  return id;
};
const fmtUV = (p?: { u: number; v: number } | null) => (p ? `u ${p.u.toFixed(4)} · v ${p.v.toFixed(4)}` : 'nessun punto');

/** Area "Personalizza": visibile solo alla redazione (Editor della pagina). */
export class Editor {
  private btn: HTMLButtonElement;
  private el: HTMLDivElement;
  private body: HTMLDivElement;
  private msg: HTMLDivElement;
  private tab: Tab = 'contenuti';
  private filter = '';
  private formOpen = false;

  constructor(private d: EditorDeps) {
    this.btn = h('button', { id: 'edit-btn', class: 'pill', 'aria-label': 'Personalizza', onclick: () => this.toggle() },
      h('span', { class: 'ico', text: '✎' }), h('span', { class: 'lbl', text: 'Personalizza' })) as HTMLButtonElement;
    this.el = h('div', { id: 'editor', hidden: true, role: 'dialog', 'aria-label': 'Personalizza' }) as HTMLDivElement;
    const tabs = h('nav', { class: 'tabs' }, ...TABS.map(([k, l]) =>
      h('button', { 'data-tab': k, text: l, onclick: () => { this.tab = k; this.filter = ''; this.render(); } })));
    this.msg = h('div', { class: 'msg', role: 'status' }) as HTMLDivElement;
    this.body = h('div', { class: 'body' }) as HTMLDivElement;
    this.el.append(
      h('header', {}, h('div', {}, h('b', { text: 'Personalizza' }), h('small', { text: `Redazione · ${d.store.name}` })),
        h('button', { class: 'x', 'aria-label': 'Chiudi', text: '×', onclick: () => this.toggle(false) })),
      tabs, this.msg, this.body);
    document.body.append(this.btn, this.el);
  }

  toggle(v: boolean = !!this.el.hidden) {
    this.el.hidden = !v;
    this.btn.classList.toggle('on', v);
    if (v) this.render();
  }

  /** Aggiorna l'elenco quando arrivano modifiche (non interrompe una scheda aperta). */
  refresh() { if (!this.el.hidden && !this.formOpen) this.render(); }

  private say(text: string, kind: 'ok' | 'err' | 'busy' = 'ok') {
    this.msg.textContent = text;
    this.msg.className = `msg ${kind}`;
    if (kind === 'ok') setTimeout(() => { if (this.msg.textContent === text) this.msg.className = 'msg'; }, 3500);
  }

  private render() {
    this.formOpen = false;
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.body.replaceChildren();
    ({ localita: () => this.listLocalita(), contenuti: () => this.listContenuti(), importa: () => this.importa(),
      audio: () => this.listAudio(), giochi: () => this.listGiochi(), parametri: () => this.parametri() })[this.tab]();
  }

  // ---------- elenco generico ----------
  private list<T>(items: T[], label: (t: T) => string, sub: (t: T) => string, onOpen: (t: T | null) => void, badge?: (t: T) => string) {
    const search = h('input', { type: 'search', placeholder: 'Filtra…', value: this.filter, class: 'filter' }) as HTMLInputElement;
    const ul = h('div', { class: 'rows' });
    const draw = () => {
      ul.replaceChildren();
      const q = this.filter.toLowerCase();
      const shown = items.filter((t) => !q || `${label(t)} ${sub(t)}`.toLowerCase().includes(q));
      for (const t of shown.slice(0, 300)) {
        ul.append(h('button', { class: 'row', onclick: () => onOpen(t) },
          h('span', { class: 'l', text: label(t) }), badge && badge(t) ? h('em', { text: badge(t) }) : null,
          h('small', { text: sub(t) })));
      }
      if (!shown.length) ul.append(h('p', { class: 'empty', text: 'Nessun elemento.' }));
    };
    search.addEventListener('input', () => { this.filter = search.value; draw(); });
    this.body.append(h('div', { class: 'bar' }, search, h('button', { class: 'pill add', text: '+ Nuovo', onclick: () => onOpen(null) })), ul);
    draw();
  }

  /** Scheda con Salva / Annulla / Elimina (eliminazione con conferma in due passi). */
  private form(title: string, fields: HTMLElement[], onSave: () => Promise<void>, onDelete?: () => Promise<void>) {
    this.formOpen = true;
    this.body.replaceChildren();
    const save = h('button', { class: 'pill primary', text: 'Salva' }) as HTMLButtonElement;
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await onSave(); this.say('Salvato: la mappa si aggiorna per tutti.'); this.render(); }
      catch (e) { this.say(`Non salvato: ${(e as Error).message || e}`, 'err'); save.disabled = false; }
    });
    let del: HTMLButtonElement | null = null;
    if (onDelete) {
      let armed = false;
      del = h('button', { class: 'pill danger', text: 'Elimina' }) as HTMLButtonElement;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del!.textContent = 'Conferma eliminazione'; setTimeout(() => { armed = false; if (del) del.textContent = 'Elimina'; }, 4000); return; }
        try { await onDelete(); this.say('Eliminato.'); this.render(); } catch (e) { this.say(`Non eliminato: ${(e as Error).message}`, 'err'); }
      });
    }
    this.body.append(
      h('div', { class: 'formhead' }, h('button', { class: 'back', text: '‹ Elenco', onclick: () => this.render() }), h('h3', { text: title })),
      h('div', { class: 'form' }, ...fields),
      h('div', { class: 'actions' }, save, h('button', { class: 'pill', text: 'Annulla', onclick: () => this.render() }), del),
    );
  }

  /** Campo posizione: mostra u/v, "Scegli sul plastico" e "Vedi". */
  private posField(pos: { u: number; v: number } | null, onChange: (p: { u: number; v: number }) => void, label = 'Posizione') {
    const txt = h('span', { class: 'uv', text: fmtUV(pos) });
    const pick = h('button', { class: 'pill', text: 'Scegli sul plastico' });
    pick.addEventListener('click', async () => {
      const p = await this.d.pickPoint('Tocca il plastico nel punto giusto (Esc per annullare)');
      if (p) { pos = p; txt.textContent = fmtUV(p); onChange(p); }
    });
    const see = h('button', { class: 'pill', text: 'Vedi', onclick: () => pos && this.d.focusUV(pos.u, pos.v) });
    return field(label, h('div', { class: 'pos' }, txt, pick, see));
  }

  private async save(coll: Coll, id: string, data: Record<string, any>) { await this.d.store.save(coll, id, data); }

  // ---------- Località ----------
  private listLocalita() {
    const L = [...this.d.data().localita].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    this.list(L, (l) => l.nome, (l) => `Livello ${l.livello}${l.visibile === false ? ' · nascosta' : ''}`, (l) => this.formLocalita(l));
  }

  private formLocalita(l: Localita | null) {
    const all = this.d.data().localita;
    const nome = h('input', { value: l?.nome ?? '', required: true }) as HTMLInputElement;
    const livello = h('select', {}, ...[1, 2, 3].map((n) => h('option', { value: String(n), text: `${n} – ${['località principali', 'paesi', 'frazioni e borghi'][n - 1]}` }))) as HTMLSelectElement;
    livello.value = String(l?.livello ?? 3);
    const cats = [...new Set(all.map((x) => (x as any).categoria).filter(Boolean))] as string[];
    const categoria = h('input', { value: (l as any)?.categoria ?? '', list: 'cat-list', placeholder: 'Predefinita in base al livello' }) as HTMLInputElement;
    const dl = h('datalist', { id: 'cat-list' }, ...cats.map((c) => h('option', { value: c })));
    const visibile = h('input', { type: 'checkbox', checked: l?.visibile !== false }) as HTMLInputElement;
    let pos = l ? { u: l.u, v: l.v } : null;
    this.form(l ? l.nome : 'Nuova località', [
      field('Nome', nome), field('Livello (scale importance code)', livello),
      field('Categoria nei Punti di interesse', h('div', {}, categoria, dl)),
      h('label', { class: 'check' }, visibile, h('span', { text: 'Visibile sulla mappa' })),
      this.posField(pos, (p) => (pos = p)),
    ], async () => {
      if (!nome.value.trim()) throw new Error('manca il nome');
      if (!pos) throw new Error('scegli la posizione sul plastico');
      const id = l?.id ?? uniqueId(nome.value, new Set(all.map((x) => x.id)));
      await this.save('localita', id, {
        ...(l ?? {}), nome: nome.value.trim(), livello: +livello.value, u: pos.u, v: pos.v,
        visibile: visibile.checked, categoria: categoria.value.trim() || null, itinerari: l?.itinerari ?? [],
        fonte: l?.fonte ?? 'redazione',
      });
    }, l ? () => this.d.store.remove('localita', l.id) : undefined);
  }

  // ---------- Contenuti ----------
  private poiOptions() {
    const loc = [...this.d.data().localita].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    return [
      h('option', { value: '', text: '— scegli —' }),
      h('option', { value: 'punto:', text: 'Punto libero sul plastico' }),
      h('optgroup', { label: 'Monumenti' }, ...this.d.monumenti.map((m) => h('option', { value: `monumento:${m}`, text: capitalize(m) }))),
      h('optgroup', { label: 'Località' }, ...loc.map((l) => h('option', { value: `localita:${l.id}`, text: l.nome }))),
    ];
  }

  private listContenuti() {
    const data = this.d.data();
    const locName = new Map(data.localita.map((l) => [l.id, l.nome]));
    const where = (c: Contenuto) => c.poi ? (c.poi.tipo === 'localita' ? locName.get(c.poi.id) ?? c.poi.id : capitalize(c.poi.id)) : c.posizione ? 'punto libero' : 'non posizionato';
    const tipo = (c: Contenuto) => TIPI.find(([k]) => k === c.tipo)?.[1] ?? c.tipo;
    this.list([...data.contenuti].sort((a, b) => a.titolo.localeCompare(b.titolo, 'it')),
      (c) => c.titolo, (c) => `${tipo(c)} · ${where(c)}`, (c) => this.formContenuto(c),
      (c) => (c.stato === 'bozza' ? 'bozza' : !c.poi && !c.posizione ? 'da posizionare' : ''));
  }

  private formContenuto(c: Contenuto | null) {
    const tipo = h('select', {}, ...TIPI.map(([k, l]) => h('option', { value: k, text: l }))) as HTMLSelectElement;
    tipo.value = c?.tipo ?? 'immagine';
    const titolo = h('input', { value: c?.titolo ?? '' }) as HTMLInputElement;
    const descr = h('textarea', { rows: 4, value: c?.descrizione ?? '' }) as HTMLTextAreaElement;
    const file = h('input', { type: 'file' }) as HTMLInputElement;
    const preview = h('div', { class: 'preview' });
    const showPrev = () => {
      preview.replaceChildren();
      const src = c?.tipo === 'foto360' ? c?.miniatura : c?.tipo === 'immagine' ? c?.file : '';
      if (src) preview.append(h('img', { src, alt: '' }));
    };
    showPrev();
    const url = h('input', { type: 'url', placeholder: 'https://…', value: c?.url ?? '' }) as HTMLInputElement;
    const where = h('select', {}, ...this.poiOptions()) as HTMLSelectElement;
    where.value = c?.poi ? `${c.poi.tipo}:${c.poi.id}` : c?.posizione ? 'punto:' : '';
    let pos = c?.posizione ?? null;
    const posF = this.posField(pos, (p) => (pos = p), 'Punto libero');
    const sempre = h('input', { type: 'checkbox', checked: c ? c.sempre_visibile : true }) as HTMLInputElement;
    const dist = h('input', { type: 'number', min: '0.5', step: '0.5', value: c?.distanza_attivazione ? String(c.distanza_attivazione / 1000) : '', placeholder: 'predefinita' }) as HTMLInputElement;
    const fonte = h('input', { value: c?.fonte ?? '' }) as HTMLInputElement;
    const diritti = h('input', { value: c?.diritti ?? '' }) as HTMLInputElement;
    const stato = h('select', {}, h('option', { value: 'pubblicato', text: 'Pubblicato' }), h('option', { value: 'bozza', text: 'Bozza (non visibile)' })) as HTMLSelectElement;
    stato.value = c?.stato ?? 'pubblicato';
    const fileF = field('File', h('div', {}, file, preview));
    const urlF = field('Indirizzo', url, 'Per video (YouTube…), link e PDF online');
    const sync = () => {
      const t = tipo.value;
      file.accept = t === 'pdf' ? 'application/pdf' : t === 'video' ? 'video/*' : 'image/*';
      fileF.hidden = t === 'testo' || t === 'link';
      (fileF.querySelector('small') ?? fileF.appendChild(h('small'))).textContent =
        t === 'immagine' ? 'Viene ridotta a 1600 px e trasformata in icona a bullet point'
        : t === 'foto360' ? 'Equirettangolare 2:1: ridotta a 4000 px, con miniatura da 100 px'
        : t === 'video' ? 'Oppure indica l’indirizzo del video qui sotto' : '';
      urlF.hidden = !['video', 'link', 'pdf'].includes(t);
      posF.hidden = where.value !== 'punto:';
    };
    tipo.addEventListener('change', sync);
    where.addEventListener('change', sync);
    sync();

    this.form(c ? c.titolo : 'Nuovo contenuto', [
      field('Tipo', tipo), field('Titolo', titolo), field('Descrizione', descr), fileF, urlF,
      field('Collocazione', where), posF,
      h('label', { class: 'check' }, sempre, h('span', { text: 'Sempre visibile (altrimenti compare avvicinandosi)' })),
      field('Distanza di attivazione (km)', dist), field('Fonte', fonte), field('Diritti / licenza', diritti), field('Stato', stato),
    ], async () => {
      const t = tipo.value as Contenuto['tipo'];
      if (!titolo.value.trim()) throw new Error('manca il titolo');
      if (url.value && !/^https:\/\//i.test(url.value)) throw new Error('l’indirizzo deve iniziare con https://');
      const rec: Record<string, any> = {
        ...(c ?? {}), tipo: t, titolo: titolo.value.trim(), descrizione: descr.value.trim(),
        url: url.value.trim() || null, sempre_visibile: sempre.checked,
        distanza_attivazione: dist.value ? Math.round(+dist.value * 1000) : null,
        fonte: fonte.value.trim() || null, diritti: diritti.value.trim() || null, stato: stato.value, visibile: true,
      };
      const [wt, wid] = where.value.split(':');
      rec.poi = wt === 'localita' || wt === 'monumento' ? { tipo: wt, id: wid } : null;
      rec.posizione = wt === 'punto' ? pos : null;
      if (wt === 'punto' && !pos) throw new Error('scegli il punto sul plastico');
      const f = file.files?.[0];
      if (f) {
        this.say('Elaborazione e caricamento del file…', 'busy');
        if (t === 'immagine') {
          const r = await processImage(f);
          rec.file = await this.d.store.upload(r.preview, 'anteprima.webp');
          rec.icona = await this.d.store.upload(r.icon, 'icona.webp');
          rec.icona_dim = r.iconDim;
        } else if (t === 'foto360') {
          const r = await process360(f);
          rec.file = await this.d.store.upload(r.full, 'foto360.jpg');
          rec.miniatura = await this.d.store.upload(r.thumb, 'foto360-100.jpg');
        } else {
          rec.file = await this.d.store.upload(f, f.name);
        }
      }
      if ((t === 'immagine' || t === 'foto360') && !rec.file) throw new Error('carica il file dell’immagine');
      if (t !== 'immagine') { delete rec.icona; delete rec.icona_dim; }
      const id = c?.id ?? uniqueId(titolo.value, new Set(this.d.data().contenuti.map((x) => x.id)));
      await this.save('contenuti', id, rec);
    }, c ? () => this.d.store.remove('contenuti', c.id) : undefined);
  }

  // ---------- Importa ----------
  private importa() {
    const ta = h('textarea', { rows: 6, placeholder: 'https://it.wikipedia.org/wiki/Abbazia_di_Follina\nhttps://www.youtube.com/watch?v=…\nhttps://www.sito-autorizzato.it/guida.pdf' }) as HTMLTextAreaElement;
    const go = h('button', { class: 'pill primary', text: 'Crea bozze' }) as HTMLButtonElement;
    go.addEventListener('click', async () => {
      const urls = ta.value.split(/\s+/).map((s) => s.trim()).filter((s) => /^https:\/\//i.test(s));
      if (!urls.length) { this.say('Incolla almeno un indirizzo https://', 'err'); return; }
      go.disabled = true;
      const taken = new Set(this.d.data().contenuti.map((x) => x.id));
      let n = 0;
      for (const u of urls) {
        const rec = draftFromUrl(u);
        const id = uniqueId(rec.titolo, taken);
        taken.add(id);
        try { await this.save('contenuti', id, rec); n++; } catch (e) { this.say(`Errore su ${u}: ${(e as Error).message}`, 'err'); }
      }
      go.disabled = false;
      ta.value = '';
      this.say(`${n} bozze create: completale e collocale nella scheda Contenuti.`);
    });
    this.body.append(
      h('p', { class: 'note', text: 'Incolla i link delle fonti che la DMO può usare (voci Wikipedia, video dei canali scelti, siti autorizzati, guide PDF con diritti). Per ciascuno viene creata una bozza con tipo, titolo e fonte già compilati: va completata, collocata sul plastico e pubblicata.' }),
      ta, h('div', { class: 'actions' }, go),
      h('p', { class: 'note muted', text: 'Il recupero automatico di testi da Wikipedia e degli operatori da OpenStreetMap richiede un servizio lato server: è previsto nella versione su Supabase (vedi README).' }),
    );
  }

  // ---------- Audio ----------
  private listAudio() {
    const it = new Map(this.d.itinerari.map((i) => [i.id, i.nome]));
    this.list(this.d.data().audio, (a) => a.titolo, (a) => `${it.get(a.itinerario) ?? 'Itinerario ' + a.itinerario} · ${a.file ? 'file audio' : 'voce'} · raggio ${a.raggio ?? 400} m`, (a) => this.formAudio(a));
  }

  private formAudio(a: AudioPoint | null) {
    const iti = h('select', {}, ...this.d.itinerari.map((i) => h('option', { value: String(i.id), text: i.nome }))) as HTMLSelectElement;
    iti.value = String(a?.itinerario ?? this.d.itinerari[0]?.id ?? 1);
    const titolo = h('input', { value: a?.titolo ?? '' }) as HTMLInputElement;
    const file = h('input', { type: 'file', accept: 'audio/*,video/mp4,video/webm' }) as HTMLInputElement;
    const testo = h('textarea', { rows: 3, value: a?.testo ?? '' }) as HTMLTextAreaElement;
    const raggio = h('input', { type: 'number', min: '20', step: '10', value: String(a?.raggio ?? 400) }) as HTMLInputElement;
    const inizio = h('input', { type: 'checkbox', checked: !!a?.inizio }) as HTMLInputElement;
    let pos = a ? { u: a.u, v: a.v } : null;
    this.form(a ? a.titolo : 'Nuovo audio', [
      field('Itinerario', iti), field('Titolo', titolo),
      field('Testo del commento', testo, 'Letto dalla sintesi vocale se non c\u2019è un file audio; resta sempre a schermo'),
      field('File audio (facoltativo)', file, a?.file ? 'Già caricato: scegline un altro solo per sostituirlo' : 'MP3, M4A, OGG'),
      this.posField(pos, (p) => (pos = p), 'Punto lungo il percorso'),
      field('Raggio di attivazione (m)', raggio),
      field('Commento di inizio', inizio, 'Parte appena si avvia il volo, ovunque sia il punto'),
    ], async () => {
      if (!titolo.value.trim()) throw new Error('manca il titolo');
      if (!pos) throw new Error('scegli il punto sul plastico');
      let src = a?.file ?? '';
      const f = file.files?.[0];
      if (f) { this.say('Caricamento dell’audio…', 'busy'); src = await this.d.store.upload(f, f.name); }
      if (!src && !testo.value.trim()) throw new Error('scrivi il testo del commento o carica un file audio');
      const id = a?.id ?? uniqueId(titolo.value, new Set(this.d.data().audio.map((x) => x.id)));
      await this.save('audio', id, { itinerario: +iti.value, titolo: titolo.value.trim(), testo: testo.value.trim() || null, file: src || null, u: pos.u, v: pos.v, raggio: +raggio.value || 400, inizio: inizio.checked });
    }, a ? () => this.d.store.remove('audio', a.id) : undefined);
  }

  // ---------- Giochi ----------
  private listGiochi() {
    this.body.append(h('p', { class: 'note', text: 'La redazione modifica testi e immagini dei giochi e li abilita; la meccanica di gioco non si modifica da qui.' }));
    this.list(this.d.data().giochi, (g) => g.titolo, (g) => `${g.tipo ?? 'gioco'} · ${g.abilitato ? 'abilitato' : 'non abilitato'}`, (g) => this.formGioco(g));
  }

  private formGioco(g: GiocoRec | null) {
    const titolo = h('input', { value: g?.titolo ?? '' }) as HTMLInputElement;
    const tipo = h('select', {}, ...['quiz', 'caccia al tesoro', 'memory'].map((t) => h('option', { value: t, text: t }))) as HTMLSelectElement;
    tipo.value = g?.tipo ?? 'quiz';
    const testi = h('textarea', { rows: 6, value: g?.testi ?? '' }) as HTMLTextAreaElement;
    const img = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
    const ab = h('input', { type: 'checkbox', checked: g?.abilitato ?? false }) as HTMLInputElement;
    this.form(g ? g.titolo : 'Nuovo gioco', [
      field('Titolo', titolo), field('Tipo', tipo), field('Testi (domande, indizi…)', testi), field('Immagine', img),
      h('label', { class: 'check' }, ab, h('span', { text: 'Abilitato nel menu Game' })),
    ], async () => {
      if (!titolo.value.trim()) throw new Error('manca il titolo');
      let immagine = g?.immagine ?? null;
      const f = img.files?.[0];
      if (f) { const r = await processImage(f); immagine = await this.d.store.upload(r.preview, 'gioco.webp'); }
      const id = g?.id ?? uniqueId(titolo.value, new Set(this.d.data().giochi.map((x) => x.id)));
      await this.save('giochi', id, { titolo: titolo.value.trim(), tipo: tipo.value, testi: testi.value, immagine, abilitato: ab.checked });
    }, g ? () => this.d.store.remove('giochi', g.id) : undefined);
  }

  // ---------- Parametri ----------
  private parametri() {
    const s = { ...this.d.defaults, ...this.d.data().settings };
    const P: [string, string, string, number][] = [
      ['labelL2Km', 'Nomi di livello 2 visibili sotto (km)', 'Distanza della camera', 1],
      ['labelL3Km', 'Nomi di livello 3 visibili sotto (km)', '', 1],
      ['monumentFarKm', 'Monumenti alla dimensione del plastico oltre (km)', 'Più vicino si riducono', 1],
      ['monumentNatural', 'Riduzione massima dei monumenti da vicino (1 : x)', '20 = scala reale; valori più bassi li riducono meno', 1],
      ['iconNearPx', 'Icone delle foto da vicino (px)', '', 1],
      ['iconFarPx', 'Icone delle foto da lontano (px)', '', 1],
      ['activationKm', 'Distanza di attivazione dei contenuti (km)', 'Per i contenuti non "sempre visibili"', 0.5],
      ['flightSpeed', 'Velocità del volo (m/s, a 1×)', '', 5],
      ['flightHeight', 'Altezza della camera nel volo (m)', 'Guarda il percorso a 45°', 50],
      ['walkSpeed', 'Velocità in prima persona (m/s)', '', 5],
    ].filter(([k]) => k !== 'walkSpeed' || CONFIG.firstPerson.enabled) as typeof P;
    const inputs = P.map(([k, l, hint, step]) => {
      const i = h('input', { type: 'number', step: String(step), min: '0', value: s[k] !== undefined ? String(s[k]) : '' }) as HTMLInputElement;
      i.dataset.k = k;
      return field(l, i, hint || undefined);
    });
    this.form('Parametri della mappa', inputs, async () => {
      const out: Settings = {};
      for (const f of inputs) { const i = f.querySelector('input')!; if (i.value !== '') out[i.dataset.k!] = +i.value; }
      await this.d.store.saveSettings(out);
    });
  }
}

/** Bozza di contenuto da un link (tipo, titolo e fonte dedotti dall'indirizzo). */
export function draftFromUrl(u: string): Record<string, any> {
  const url = new URL(u);
  const host = url.hostname.replace(/^www\./, '');
  const base = { url: u, poi: null, posizione: null, stato: 'bozza', visibile: true, sempre_visibile: true, distanza_attivazione: null, descrizione: '' };
  if (/wikipedia\.org$/.test(host) && url.pathname.startsWith('/wiki/')) {
    const titolo = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
    return { ...base, tipo: 'link', titolo, fonte: `Wikipedia (${host.split('.')[0]})`, diritti: 'CC BY-SA 4.0 – citare la fonte' };
  }
  if (/(youtube\.com|youtu\.be)$/.test(host)) return { ...base, tipo: 'video', titolo: 'Video da completare', fonte: 'YouTube', diritti: null };
  if (/\.pdf$/i.test(url.pathname)) {
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? 'Guida').replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
    return { ...base, tipo: 'pdf', titolo: name, fonte: host, diritti: null };
  }
  return { ...base, tipo: 'link', titolo: host, fonte: host, diritti: null };
}
