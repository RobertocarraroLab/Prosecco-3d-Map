import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CONFIG } from '../config';
import type { MapFrame } from '../scene/geo';

export interface ItinerarioData {
  id: number; nome: string; colore: string; nodo: string;
  catene: [number, number][][];   // tratti del percorso in coordinate u,v
}

interface Runner { curve: THREE.CatmullRomCurve3; length: number; s: number; dir: 1 | -1; mesh: THREE.Mesh; }
export interface Itinerario { data: ItinerarioData; lines: THREE.Object3D[]; runner?: Runner; visible: boolean; }

/**
 * FASE 3 – Itinerari animati.
 * Il percorso è disegnato come linea di spessore costante sullo schermo, a partire dal tracciato
 * vettoriale dei file Illustrator, appoggiato al terreno. I tubi del plastico restano nascosti.
 * Una sola sfera per itinerario percorre il tratto principale in un senso e poi nel senso inverso.
 */
export class RoutesLayer {
  itinerari: Itinerario[] = [];
  group = new THREE.Group();
  private materials: LineMaterial[] = [];
  private halos = new Set<LineMaterial>();
  private getH: (x: number, z: number) => number | null;

  constructor(
    data: ItinerarioData[], map: MapFrame,
    getHeight: (x: number, z: number) => number | null,
    routeNodes: Record<string, THREE.Object3D>,
  ) {
    this.group.name = 'Itinerari_Vettoriali';
    this.getH = getHeight;
    // i tubi del plastico sono sostituiti dalle linee
    for (const n of Object.values(routeNodes)) n.visible = false;

    const R = CONFIG.routes;
    for (const d of data) {
      const color = new THREE.Color(d.colore);
      const lineMat = this.lineMaterial(color, R.lineWidth, 1);
      const haloMat = this.lineMaterial(new THREE.Color('#ffffff'), R.lineWidth + 3, 1, true);
      const lines: THREE.Object3D[] = [];
      let main: THREE.Vector3[] | null = null;

      for (const chain of d.catene) {
        const pts = this.drape(chain, map, getHeight);
        if (pts.length < 2) continue;
        const flat = pts.flatMap((p) => [p.x, p.y, p.z]);
        for (const [mat, order] of [[haloMat, 1], [lineMat, 2]] as const) {
          const geo = new LineGeometry();
          geo.setPositions(flat);
          const line = new Line2(geo, mat);
          line.computeLineDistances();
          line.renderOrder = order;
          this.group.add(line);
          lines.push(line);
        }
      }
      // percorso del volo: il tratto più lungo, nel verso del disegno, seguito dai tratti che ne proseguono la fine
      const path = this.joinChains(d.catene, map);
      if (path.length >= 2) main = this.drape(path, map, getHeight);

      let runner: Runner | undefined;
      if (main) {
        const curve = new THREE.CatmullRomCurve3(main, false, 'centripetal');
        curve.arcLengthDivisions = Math.max(400, main.length);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.35 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
        mesh.renderOrder = 3;
        this.group.add(mesh);
        const length = curve.getLength();
        runner = { curve, length, s: Math.random() * length, dir: 1, mesh };
      }
      this.itinerari.push({ data: d, lines, runner, visible: true });
    }
  }

  private lineMaterial(color: THREE.Color, width: number, opacity: number, halo = false) {
    const m = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: opacity < 1, opacity, worldUnits: false });
    m.resolution.set(innerWidth, innerHeight);
    // l'alone bianco è disegnato prima e senza scrivere la profondità, così la linea colorata resta sopra
    if (halo) { m.depthWrite = false; this.halos.add(m); }
    this.materials.push(m);
    return m;
  }

  /**
   * Unisce i tratti di un itinerario in un unico percorso continuo: parte dal tratto più lungo
   * (nel verso in cui è disegnato, dove c'è il commento di benvenuto) e aggiunge in coda i tratti
   * che iniziano o finiscono a meno di CONFIG.routes.joinGap metri dalla fine. Le diramazioni brevi restano escluse.
   */
  private joinChains(catene: [number, number][][], map: MapFrame): [number, number][] {
    const w = (p: [number, number]) => map.toWorld(p[0], p[1]);
    const dist = (a: [number, number], b: [number, number]) => { const A = w(a), B = w(b); return Math.hypot(A.x - B.x, A.z - B.z); };
    const len = (c: [number, number][]) => c.slice(1).reduce((t, p, i) => t + dist(c[i], p), 0);
    const list = catene.filter((c) => c.length >= 2).sort((a, b) => len(b) - len(a));
    if (!list.length) return [];
    const path = [...list[0]];
    const used = new Set([list[0]]);
    for (;;) {
      let best: { d: number; c: [number, number][]; seq: [number, number][] } | null = null;
      for (const c of list) {
        if (used.has(c) || len(c) < CONFIG.routes.minBranch) continue;
        const end = path[path.length - 1];
        for (const seq of [c, [...c].reverse()]) {
          const d = dist(end, seq[0]);
          if (d <= CONFIG.routes.joinGap && (!best || d < best.d)) best = { d, c, seq };
        }
      }
      if (!best) return path;
      used.add(best.c);
      path.push(...best.seq);
    }
  }

  /** Infittisce il tracciato (un punto ogni ~CONFIG.routes.step metri) e lo appoggia sul terreno. */
  private drape(chain: [number, number][], map: MapFrame, getHeight: (x: number, z: number) => number | null) {
    const out: THREE.Vector3[] = [];
    const step = CONFIG.routes.step;
    const w = chain.map(([u, v]) => map.toWorld(u, v));
    for (let i = 0; i < w.length - 1; i++) {
      const a = w[i], b = w[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
        out.push(new THREE.Vector3(x, (getHeight(x, z) ?? 0) + CONFIG.routes.lift, z));
      }
    }
    const last = w[w.length - 1];
    out.push(new THREE.Vector3(last.x, (getHeight(last.x, last.z) ?? 0) + CONFIG.routes.lift, last.z));
    return out;
  }

  setVisible(id: number, v: boolean) {
    const it = this.itinerari.find((i) => i.data.id === id);
    if (!it) return;
    it.visible = v;
    for (const l of it.lines) l.visible = v;
    if (it.runner) it.runner.mesh.visible = v;
  }

  resize(w: number, h: number) { for (const m of this.materials) m.resolution.set(w, h); }

  /**
   * Spessore delle linee secondo l'altezza della camera sul terreno: sottili da lontano, spesse da vicino
   * (interpolazione logaritmica tra CONFIG.routes.farHeight e nearHeight).
   */
  private updateWidth(camera: THREE.Camera) {
    const R = CONFIG.routes, p = camera.position;
    const h = Math.max(1, p.y - (this.getH(p.x, p.z) ?? 0));
    const t = THREE.MathUtils.clamp(Math.log(R.farHeight / h) / Math.log(R.farHeight / R.nearHeight), 0, 1);
    const w = R.lineWidthFar + (R.lineWidthNear - R.lineWidthFar) * t;
    for (const m of this.materials) m.linewidth = this.halos.has(m) ? w + Math.max(2, w * 0.3) : w;
  }

  update(dt: number, camera: THREE.Camera) {
    this.updateWidth(camera);
    const step = CONFIG.routes.sphereSpeed * dt;
    for (const it of this.itinerari) {
      const r = it.runner;
      if (!it.visible || !r) continue;
      r.s += step * r.dir;
      if (r.s >= r.length) { r.s = r.length; r.dir = -1; }
      if (r.s <= 0) { r.s = 0; r.dir = 1; }
      r.curve.getPointAt(r.s / r.length, r.mesh.position);
      const dist = camera.position.distanceTo(r.mesh.position);
      const radius = Math.max(CONFIG.routes.sphereMinRadius, dist * CONFIG.routes.sphereScreenSize);
      r.mesh.scale.setScalar(radius);
      r.mesh.position.y += radius * 0.6;
    }
  }
}
