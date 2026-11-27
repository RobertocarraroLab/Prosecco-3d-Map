import * as THREE from 'three';
import type { Contenuto } from '../layers/content';

/** Scheda di un contenuto (immagine, testo…): immagine grande, titolo, fonte e diritti. */
export class ContentPopup {
  private el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'popup';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="popup-title">
        <button class="close" aria-label="Chiudi">×</button>
        <img alt="">
        <div class="body"><h2 id="popup-title"></h2><p class="desc"></p>
          <a class="pill ext" target="_blank" rel="noopener noreferrer"></a><p class="meta"></p></div>
      </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }
  open(c: Contenuto, luogo: string) {
    const img = this.el.querySelector('img')!;
    const hasImg = c.tipo === 'immagine' && !!c.file;
    img.hidden = !hasImg;
    if (hasImg) { img.src = c.file; img.alt = c.titolo; } else img.removeAttribute('src');
    // collegamento esterno (video, link, PDF): solo indirizzi https
    const a = this.el.querySelector<HTMLAnchorElement>('.ext')!;
    const url = c.url && /^https:\/\//i.test(c.url) ? c.url : (c.tipo !== 'immagine' && c.file?.startsWith('/_blob/') ? c.file : '');
    a.hidden = !url;
    if (url) {
      a.href = url;
      a.textContent = c.tipo === 'video' ? 'Guarda il video ↗' : c.tipo === 'pdf' ? 'Apri il PDF ↗' : 'Apri il collegamento ↗';
    }
    this.el.querySelector('h2')!.textContent = c.titolo;
    this.el.querySelector('.desc')!.textContent = c.descrizione || '';
    const meta = [luogo, c.fonte && !c.fonte.includes('/') ? `Fonte: ${c.fonte}` : '', c.diritti ? `Diritti: ${c.diritti}` : ''].filter(Boolean).join(' · ');
    this.el.querySelector('.meta')!.textContent = meta;
    this.el.hidden = false;
  }
  close() { this.el.hidden = true; }
}

/**
 * Visualizzatore di foto 360 equirettangolari a schermo intero.
 * Trascina per ruotare, rotella o pizzico per lo zoom. "Plastico 3D" torna alla veduta aerea.
 */
export class Viewer360 {
  private el: HTMLDivElement;
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 1, 1100);
  private mesh?: THREE.Mesh;
  private lon = 0; private lat = 0;
  private drag: { x: number; y: number; lon: number; lat: number } | null = null;
  private pinch = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  isOpen = false;
  onBackToMap: () => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'viewer360';
    this.el.hidden = true;
    this.el.innerHTML = `
      <canvas></canvas>
      <div class="bar">
        <button class="pill back">Plastico 3D</button>
        <span class="title"></span>
        <button class="pill close" aria-label="Chiudi">×</button>
      </div>
      <p class="hint">Trascina per guardarti intorno · pizzica o usa la rotella per lo zoom</p>
      <div class="loading">Caricamento della foto 360…</div>`;
    document.body.appendChild(this.el);
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    this.el.querySelector('.back')!.addEventListener('click', () => { this.close(); this.onBackToMap(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) this.close(); });

    const cv = this.el.querySelector('canvas')!;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, lon: this.lon, lat: this.lat };
      if (this.pointers.size === 2) { this.drag = null; this.pinch = this.pinchDist(); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        this.setFov(this.camera.fov * (this.pinch / d));
        this.pinch = d;
      } else if (this.drag) {
        const k = this.camera.fov / innerHeight;
        this.lon = this.drag.lon - (e.clientX - this.drag.x) * k;
        this.lat = THREE.MathUtils.clamp(this.drag.lat + (e.clientY - this.drag.y) * k, -85, 85);
      }
    });
    const up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size === 0) this.drag = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.setFov(this.camera.fov + e.deltaY * 0.05); }, { passive: false });
  }

  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
  private setFov(f: number) { this.camera.fov = THREE.MathUtils.clamp(f, 30, 100); this.camera.updateProjectionMatrix(); }

  open(c: Contenuto) {
    const cv = this.el.querySelector('canvas')!;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.SphereGeometry(500, 96, 48);
      geo.scale(-1, 1, 1);
      this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      this.scene.add(this.mesh);
    }
    this.el.querySelector('.title')!.textContent = c.titolo;
    const loading = this.el.querySelector<HTMLElement>('.loading')!;
    loading.hidden = false;
    new THREE.TextureLoader().load(c.file, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer!.capabilities.getMaxAnisotropy();
      const mat = this.mesh!.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = tex; mat.needsUpdate = true;
      loading.hidden = true;
    });
    this.lon = 0; this.lat = 0; this.setFov(75);
    this.el.hidden = false;
    this.isOpen = true;
    this.el.requestFullscreen?.().catch(() => {}); // schermo intero dove il browser lo consente
    this.resize();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.isOpen || !this.renderer) return;
    const phi = THREE.MathUtils.degToRad(90 - this.lat), theta = THREE.MathUtils.degToRad(this.lon);
    this.camera.lookAt(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    this.renderer.render(this.scene, this.camera);
  }
}
