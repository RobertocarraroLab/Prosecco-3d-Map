import * as THREE from 'three';
import { CONFIG } from '../config';
import type { MapFrame } from '../scene/geo';

export interface Localita {
  id: string; nome: string; livello: 1 | 2 | 3; u: number; v: number;
  itinerari: number[]; visibile: boolean; fonte?: string;
}

interface Label { data: Localita; pos: THREE.Vector3; el: HTMLDivElement; w: number; h: number; occluded: boolean; }

/**
 * FASE 2 – Nomi delle località con scale importance code.
 * Etichette HTML proiettate sul plastico: compaiono per livello in base alla distanza,
 * senza sovrapposizioni (vince il livello più importante, poi il più vicino).
 */
export class LabelsLayer {
  labels: Label[] = [];
  visible = true;
  /** località evidenziata (ricerca, link diretto): sempre visibile e in primo piano */
  focusId: string | null = null;
  private container: HTMLDivElement;
  private ray = new THREE.Raycaster();
  private frame = 0;
  private tmp = new THREE.Vector3();

  constructor(
    data: Localita[], map: MapFrame, private terrain: THREE.Mesh,
    getHeight: (x: number, z: number) => number | null,
  ) {
    this.container = document.createElement('div');
    this.container.id = 'labels';
    document.body.appendChild(this.container);
    this.ray.firstHitOnly = true;

    // Una località presente in più livelli resta una sola volta, al livello più importante
    const byName = new Map<string, Localita>();
    for (const d of data) {
      const k = d.nome.toLowerCase();
      const prev = byName.get(k);
      if (!prev || d.livello < prev.livello) byName.set(k, d);
    }

    for (const d of byName.values()) {
      const { x, z } = map.toWorld(d.u, d.v);
      const y = (getHeight(x, z) ?? 0) + CONFIG.labels.heightOffset;
      const el = document.createElement('div');
      el.className = `loc l${d.livello}`;
      const dot = document.createElement('i');
      const txt = document.createElement('span');
      txt.textContent = d.nome;
      el.append(dot, txt);
      this.container.appendChild(el);
      this.labels.push({ data: d, pos: new THREE.Vector3(x, y, z), el, w: 0, h: 0, occluded: false });
    }
    // misura una volta le dimensioni
    requestAnimationFrame(() => {
      for (const l of this.labels) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
    });
    this.labels.sort((a, b) => a.data.livello - b.data.livello);
  }

  /** Rimuove le etichette (per ricostruirle dopo una modifica della redazione). */
  dispose() { this.container.remove(); this.labels = []; }

  setVisible(v: boolean) { this.visible = v; this.container.style.display = v ? '' : 'none'; }

  update(camera: THREE.PerspectiveCamera) {
    if (!this.visible) return;
    const W = innerWidth, H = innerHeight;
    const placed: [number, number, number, number][] = [];
    const checkOcclusion = CONFIG.labels.occlusion && this.frame++ % 6 === 0;

    // candidati ordinati: livello, poi distanza
    const cand = this.labels.map((l) => ({ l, d: camera.position.distanceTo(l.pos) }))
      .sort((a, b) => Number(b.l.data.id === this.focusId) - Number(a.l.data.id === this.focusId)
        || a.l.data.livello - b.l.data.livello || a.d - b.d);

    for (const { l, d } of cand) {
      const focus = l.data.id === this.focusId;
      let show = focus || (l.data.visibile && d <= CONFIG.labels.maxDistance[l.data.livello]);
      let sx = 0, sy = 0;
      if (show) {
        this.tmp.copy(l.pos).project(camera);
        if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) show = false;
        sx = (this.tmp.x * 0.5 + 0.5) * W;
        sy = (-this.tmp.y * 0.5 + 0.5) * H;
      }
      if (show && checkOcclusion) {
        const dir = this.tmp.copy(l.pos).sub(camera.position).normalize();
        this.ray.set(camera.position, dir);
        this.ray.far = d - 60;
        l.occluded = this.ray.intersectObject(this.terrain, false).length > 0;
      }
      if (show && l.occluded && !focus) show = false;
      l.el.classList.toggle('focus', focus);
      if (show) {
        // rettangolo: il punto è a sinistra, il testo a destra del punto
        const r: [number, number, number, number] = [sx - 6, sy - l.h / 2, sx - 6 + l.w, sy + l.h / 2];
        if (placed.some((p) => r[0] < p[2] + 4 && r[2] + 4 > p[0] && r[1] < p[3] + 2 && r[3] + 2 > p[1])) show = false;
        else placed.push(r);
      }
      if (show) l.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      l.el.classList.toggle('on', show);
    }
  }
}
