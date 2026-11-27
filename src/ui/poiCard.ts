import type { Poi } from '../app/pois';
import type { Contenuto } from '../layers/content';
import { t } from './i18n';
import { genericIcon } from '../layers/icons';

/** Scheda del punto di interesse selezionato: nome, tipo e contenuti collegati. */
export class PoiCard {
  private el: HTMLDivElement;
  current: Poi | null = null;
  onOpenContent: (c: Contenuto) => void = () => {};
  onWalk: (p: Poi) => void = () => {};
  /** Mostra il pulsante "Esplora a piedi" (prima persona). */
  walkEnabled = true;
  onClose: () => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'poicard';
    this.el.hidden = true;
    this.el.innerHTML = `<button class="x" aria-label="${t('close')}">×</button>
      <p class="kind"></p><h2></h2><div class="thumbs"></div>
      <button class="pill walk">${t('walkHere')}</button>`;
    document.body.appendChild(this.el);
    this.el.querySelector('.x')!.addEventListener('click', () => { this.hide(); this.onClose(); });
    this.el.querySelector('.walk')!.addEventListener('click', () => this.current && this.onWalk(this.current));
  }

  show(p: Poi) {
    this.current = p;
    this.el.querySelector('.kind')!.textContent = p.tipo === 'monumento' ? t('monument') : `${t('locality')} · ${p.categoria.toLowerCase()}`;
    this.el.querySelector('h2')!.textContent = p.nome;
    (this.el.querySelector('.walk') as HTMLElement).hidden = !this.walkEnabled;
    const th = this.el.querySelector('.thumbs')!;
    th.replaceChildren();
    if (!p.contenuti.length) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = t('noContents');
      th.appendChild(e);
    }
    for (const c of p.contenuti) {
      const b = document.createElement('button');
      const generic = c.tipo !== 'foto360' && c.tipo !== 'immagine';
      b.className = c.tipo === 'foto360' ? 'is360' : generic ? 'generic' : '';
      b.innerHTML = '<img alt="" loading="lazy"><span></span>';
      (b.querySelector('img') as HTMLImageElement).src = c.tipo === 'foto360' ? (c.miniatura ?? c.file) : generic ? genericIcon(c.tipo) : c.file;
      b.querySelector('span')!.textContent = c.titolo;
      b.title = c.titolo;
      b.addEventListener('click', () => this.onOpenContent(c));
      th.appendChild(b);
    }
    this.el.hidden = false;
  }

  hide() { this.el.hidden = true; this.current = null; }
}
