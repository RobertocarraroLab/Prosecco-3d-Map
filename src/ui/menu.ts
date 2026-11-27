import type { Poi } from '../app/pois';
import type { Contenuto } from '../layers/content';
import type { Itinerario } from '../layers/routes';
import { t } from './i18n';

export interface SearchEntry { text: string; sub: string; kind: string; key: string; }
export interface Gioco { id: string; titolo: string; abilitato: boolean; }

interface MenuDeps {
  pois: Poi[];
  itinerari: Itinerario[];
  foto360: Contenuto[];
  giochi: Gioco[];
  search: SearchEntry[];
  onSelect: (key: string) => void;              // naviga a un elemento (POI, contenuto, itinerario)
  onToggleRoute: (id: number, v: boolean) => void;
  onFly: (id: number) => void;
  onGame: (g: Gioco) => void;
  onOverview: () => void;                       // torna alla vista d'insieme del territorio
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, ' ');

/** Menu a tendina (icona circolare con tre linee in alto a destra). */
export class Menu {
  private btn: HTMLButtonElement;
  private panel: HTMLDivElement;
  private body: HTMLDivElement;
  private title: HTMLHeadingElement;
  private backBtn: HTMLButtonElement;

  constructor(private d: MenuDeps) {
    this.btn = document.createElement('button');
    this.btn.id = 'menu-btn';
    this.btn.setAttribute('aria-label', t('menu'));
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    this.panel = document.createElement('div');
    this.panel.id = 'menu';
    this.panel.hidden = true;
    this.panel.innerHTML = `<header><button class="back" aria-label="${t('back')}">‹</button><h2></h2>
      <button class="x" aria-label="${t('close')}">×</button></header><div class="body"></div>`;
    document.body.append(this.btn, this.panel);
    this.body = this.panel.querySelector('.body')!;
    this.title = this.panel.querySelector('h2')!;
    this.backBtn = this.panel.querySelector('.back')!;
    this.btn.addEventListener('click', () => (this.panel.hidden ? this.open() : this.close()));
    this.panel.querySelector('.x')!.addEventListener('click', () => this.close());
    this.backBtn.addEventListener('click', () => this.home());
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.panel.hidden) this.close(); });
  }

  dispose() { this.btn.remove(); this.panel.remove(); }

  open(section?: 'search') {
    this.panel.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    if (section === 'search') this.showSearch(); else this.home();
  }
  close() { this.panel.hidden = true; this.btn.setAttribute('aria-expanded', 'false'); }

  private setView(title: string, sub: boolean) {
    this.title.textContent = title;
    this.backBtn.hidden = !sub;
    this.body.replaceChildren();
  }

  private item(label: string, extra: string, onClick: () => void, icon = '') {
    const b = document.createElement('button');
    b.className = 'item';
    b.innerHTML = `${icon}<span class="l"></span><span class="e"></span><span class="chev">›</span>`;
    b.querySelector('.l')!.textContent = label;
    b.querySelector('.e')!.textContent = extra;
    b.addEventListener('click', onClick);
    this.body.appendChild(b);
    return b;
  }

  home() {
    this.setView(t('menu'), false);
    const I = (p: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${p}"/></svg>`;
    this.item(t('overview'), '', () => { this.close(); this.d.onOverview(); }, I('M3 18l6-12 4 7 3-4 5 9z'));
    this.item(t('search'), '', () => this.showSearch(), I('M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z'));
    // gli itinerari animati sono nella barra in alto a sinistra (vedi main.ts)
    if (false) this.item(t('routes'), String(this.d.itinerari.length), () => this.showRoutes(), I('M5 18a2 2 0 1 0 0 .1zM19 6a2 2 0 1 0 0 .1zM6.5 17.5C10 14 7 10 12 9s5-2 5.5-2.5l1 1c-.8.8-2 1.8-6.2 2.6S11 15 7.5 18.5z'));
    this.item(t('pois'), String(this.d.pois.length), () => this.showPois(), I('M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'));
    this.item(t('photos360'), String(this.d.foto360.length), () => this.showFoto(), I('M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2c-1.5 1.8-2.3 4.3-2.3 7s.8 5.2 2.3 7c1.5-1.8 2.3-4.3 2.3-7S13.5 6.8 12 5zM4 12h16'));
    this.item(t('game'), '', () => this.showGame(), I('M7 8h10a5 5 0 0 1 0 10c-1.6 0-2.4-1-3-2h-4c-.6 1-1.4 2-3 2A5 5 0 0 1 7 8zm0 3v1.5H5.5v1H7V15h1v-1.5h1.5v-1H8V11zm9 .5a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm2 2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z'));
  }

  // --- Cerca ---
  showSearch() {
    this.setView(t('search'), true);
    const wrap = document.createElement('div');
    wrap.className = 'search';
    wrap.innerHTML = `<input type="search" autocomplete="off" placeholder="${t('searchPlaceholder')}" aria-label="${t('search')}"><ul role="listbox"></ul>`;
    this.body.appendChild(wrap);
    const input = wrap.querySelector('input')!;
    const ul = wrap.querySelector('ul')!;
    let results: SearchEntry[] = [];
    let sel = 0;
    const render = () => {
      ul.replaceChildren();
      const q = norm(input.value.trim());
      if (!q) return;
      results = this.d.search
        .map((e) => { const n = norm(e.text); const i = n.indexOf(q); return { e, score: i < 0 ? -1 : (i === 0 ? 0 : n[i - 1] === ' ' ? 1 : 2) }; })
        .filter((r) => r.score >= 0)
        .sort((a, b) => a.score - b.score || a.e.text.length - b.e.text.length)
        .slice(0, 10).map((r) => r.e);
      sel = 0;
      if (!results.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('noResults'); ul.appendChild(li); return; }
      results.forEach((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.innerHTML = '<span class="k"></span><b></b><small></small>';
        li.querySelector('.k')!.textContent = r.kind;
        li.querySelector('b')!.textContent = r.text;
        li.querySelector('small')!.textContent = r.sub;
        li.classList.toggle('sel', i === sel);
        li.addEventListener('click', () => this.pick(r));
        ul.appendChild(li);
      });
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (!results.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        [...ul.children].forEach((li, i) => li.classList.toggle('sel', i === sel));
      }
      if (e.key === 'Enter') this.pick(results[sel]);
    });
    setTimeout(() => input.focus(), 50);
  }

  private pick(r: SearchEntry) {
    this.d.onSelect(r.key);
    if (matchMedia('(max-width: 640px)').matches) this.close();
  }

  // --- Itinerari ---
  showRoutes() {
    this.setView(t('routes'), true);
    for (const it of this.d.itinerari) {
      const row = document.createElement('div');
      row.className = 'route';
      const km = it.runner ? (it.runner.length / 1000).toFixed(1) : '–';
      row.innerHTML = `<label><input type="checkbox"><b class="swatch"></b><span></span></label>
        <small>${km} ${t('km')}</small><button class="pill fly">▶ ${t('fly')}</button>`;
      row.querySelector('span')!.textContent = it.data.nome;
      (row.querySelector('.swatch') as HTMLElement).style.background = it.data.colore;
      const cb = row.querySelector('input')!;
      cb.checked = it.visible;
      cb.addEventListener('change', () => this.d.onToggleRoute(it.data.id, cb.checked));
      row.querySelector('.fly')!.addEventListener('click', () => { this.d.onFly(it.data.id); this.close(); });
      this.body.appendChild(row);
    }
  }

  // --- Punti di interesse per categoria ---
  showPois() {
    this.setView(t('pois'), true);
    const cats = new Map<string, Poi[]>();
    for (const p of this.d.pois) cats.set(p.categoria, [...(cats.get(p.categoria) ?? []), p]);
    const order = [t('monuments'), t('level1'), t('level2'), t('level3')];
    const rank = (c: string) => (order.indexOf(c) < 0 ? 99 : order.indexOf(c));  // categorie della redazione in fondo
    for (const c of [...cats.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'it'))) {
      const det = document.createElement('details');
      det.className = 'cat';
      if (c === t('monuments')) det.open = true;
      det.innerHTML = '<summary><span></span><small></small></summary><div class="list"></div>';
      det.querySelector('summary span')!.textContent = c;
      det.querySelector('summary small')!.textContent = String(cats.get(c)!.length);
      const list = det.querySelector('.list')!;
      for (const p of cats.get(c)!.sort((a, b) => a.nome.localeCompare(b.nome, 'it'))) {
        const b = document.createElement('button');
        b.className = 'poi';
        b.innerHTML = '<span></span><small></small>';
        b.querySelector('span')!.textContent = p.nome;
        b.querySelector('small')!.textContent = p.contenuti.length ? `${p.contenuti.length} ${p.contenuti.length === 1 ? 'contenuto' : 'contenuti'}` : '';
        b.addEventListener('click', () => this.pick({ key: p.key, text: p.nome, sub: '', kind: '' }));
        list.appendChild(b);
      }
      this.body.appendChild(det);
    }
  }

  // --- Foto 360 ---
  showFoto() {
    this.setView(t('photos360'), true);
    const grid = document.createElement('div');
    grid.className = 'foto-grid';
    for (const c of this.d.foto360) {
      const b = document.createElement('button');
      b.innerHTML = '<img alt="" loading="lazy"><span></span>';
      (b.querySelector('img') as HTMLImageElement).src = c.miniatura ?? c.file;
      b.querySelector('span')!.textContent = c.titolo;
      b.addEventListener('click', () => this.d.onSelect(`foto-${c.id}`));
      grid.appendChild(b);
    }
    this.body.appendChild(grid);
  }

  // --- Game ---
  showGame() {
    const enabled = this.d.giochi.filter((g) => g.abilitato);
    if (enabled.length === 1) { this.close(); this.d.onGame(enabled[0]); return; }
    this.setView(t('game'), true);
    if (!enabled.length) {
      const p = document.createElement('p');
      p.className = 'soon';
      p.textContent = t('gameSoon');
      this.body.appendChild(p);
      return;
    }
    for (const g of enabled) this.item(g.titolo, '', () => { this.close(); this.d.onGame(g); });
  }
}
