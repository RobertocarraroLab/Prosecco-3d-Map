import * as THREE from 'three';
import { CONFIG } from '../config';
import type { MapFrame } from '../scene/geo';
import type { Localita } from './labels';
import type { MonumentsLayer } from './monuments';
import { genericIcon, iconSize } from './icons';

export interface Contenuto {
  id: string;
  tipo: 'immagine' | 'foto360' | 'testo' | 'video' | 'audio' | 'link' | 'pdf';
  titolo: string; descrizione?: string;
  poi: { tipo: 'localita' | 'monumento'; id: string } | null;
  sempre_visibile: boolean; distanza_attivazione: number | null;
  file: string; icona?: string; icona_dim?: { w: number; h: number; disco: number }; miniatura?: string;
  fonte?: string; diritti?: string | null; note?: string | null; visibile: boolean;
  url?: string;                          // video, link, PDF: indirizzo esterno (https)
  posizione?: { u: number; v: number };  // punto libero sul plastico, in alternativa a poi
  stato?: 'bozza' | 'pubblicato';        // le bozze non compaiono sulla mappa
}

/** Contenuto pubblicato e posizionato (su un punto di interesse o in un punto libero). */
export const isLive = (c: Contenuto) => c.visibile !== false && c.stato !== 'bozza' && (!!c.poi || !!c.posizione);

interface Item {
  c: Contenuto; obj: THREE.Object3D; pick: THREE.Object3D; anchor: () => THREE.Vector3;
  index: number; count: number; shown: number; // 0..1 per la dissolvenza
  has360: boolean;                              // nel gruppo c'è almeno una foto 360 (servono più spazio)
  sphere?: THREE.Mesh; stem?: THREE.Line;
}

/**
 * FASE 5 – Contenuti multimediali posizionati sul territorio.
 * Immagini: icona circolare con asta (impostor sempre rivolto all'utente, dimensione costante a schermo).
 * Foto 360: piccola sfera con la miniatura equirettangolare, sospesa e collegata al punto con una linea.
 * Di default compaiono solo avvicinandosi (distanza di attivazione), salvo "sempre visibile".
 */
export class ContentLayer {
  items: Item[] = [];
  group = new THREE.Group();
  private ray = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(
    data: Contenuto[], localita: Localita[], map: MapFrame,
    getHeight: (x: number, z: number) => number | null, monuments: MonumentsLayer,
  ) {
    this.group.name = 'Contenuti';
    const loader = new THREE.TextureLoader();
    const locById = new Map(localita.map((l) => [l.id, l]));
    const byPoi = new Map<string, Contenuto[]>();
    for (const c of data) {
      if (!isLive(c)) continue;
      const k = c.poi ? `${c.poi.tipo}:${c.poi.id}` : `punto:${c.posizione!.u.toFixed(4)},${c.posizione!.v.toFixed(4)}`;
      byPoi.set(k, [...(byPoi.get(k) ?? []), c]);
    }

    for (const [k, list] of byPoi) {
      const first = list[0];
      const anchor = first.poi
        ? this.makeAnchor(first.poi, locById, map, getHeight, monuments)
        : this.pointAnchor(first.posizione!, map, getHeight);
      if (!anchor) { console.warn('Punto di interesse non trovato:', k); continue; }
      const start = this.items.length;
      list.forEach((c, index) => {
        if (c.tipo === 'foto360') this.add360(c, anchor, index, list.length, loader);
        else this.addImage(c, anchor, index, list.length, loader);
      });
      const has360 = list.some((c) => c.tipo === 'foto360');
      for (const it of this.items.slice(start)) it.has360 = has360;
    }
  }

  private makeAnchor(
    poi: NonNullable<Contenuto['poi']>, loc: Map<string, Localita>, map: MapFrame,
    getHeight: (x: number, z: number) => number | null, monuments: MonumentsLayer,
  ): (() => THREE.Vector3) | null {
    if (poi.tipo === 'localita') {
      const l = loc.get(poi.id);
      if (!l) return null;
      const { x, z } = map.toWorld(l.u, l.v);
      const p = new THREE.Vector3(x, getHeight(x, z) ?? 0, z);
      return () => p;
    }
    const m = monuments.items.find((i) => i.m.nome.toLowerCase() === poi.id.toLowerCase());
    if (!m) return null;
    // sopra la sommità del monumento, che cambia con il ridimensionamento
    const p = new THREE.Vector3();
    return () => p.set(m.pivot.position.x, m.pivot.position.y + m.height * m.pivot.scale.x, m.pivot.position.z);
  }

  private pointAnchor(p: { u: number; v: number }, map: MapFrame, getHeight: (x: number, z: number) => number | null) {
    const { x, z } = map.toWorld(p.u, p.v);
    const v = new THREE.Vector3(x, getHeight(x, z) ?? 0, z);
    return () => v;
  }

  /** Rimuove il livello (per ricostruirlo dopo una modifica della redazione). */
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      const mats = m.material ? ([] as THREE.Material[]).concat(m.material as THREE.Material) : [];
      for (const mat of mats) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
      m.geometry?.dispose();
    });
    this.items = [];
  }

  private addImage(c: Contenuto, anchor: () => THREE.Vector3, index: number, count: number, loader: THREE.TextureLoader) {
    const tex = loader.load(c.icona || genericIcon(c.tipo));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);           // la punta dell'asta tocca il punto di interesse
    sprite.renderOrder = 10;
    sprite.userData.contenuto = c;
    const dim = (c.icona && c.icona_dim) || { ...iconSize(), disco: 200 };
    sprite.userData.aspect = dim.w / dim.h;
    sprite.visible = false;
    this.group.add(sprite);
    this.items.push({ c, obj: sprite, pick: sprite, anchor, index, count, shown: 0, has360: false });
  }

  private add360(c: Contenuto, anchor: () => THREE.Vector3, index: number, count: number, loader: THREE.TextureLoader) {
    const tex = loader.load(c.miniatura ?? c.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0 }),
    );
    sphere.userData.contenuto = c;
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(1.14, 32, 20),   // contorno nero della sfera
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0 }),
    );
    sphere.add(ring);
    const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    g.add(sphere, stem);
    g.visible = false;
    g.renderOrder = 10;
    this.group.add(g);
    this.items.push({ c, obj: g, pick: sphere, anchor, index, count, shown: 0, has360: true, sphere, stem });
  }

  /** Metri per pixel alla distanza d, con la camera corrente. */
  private mpp(camera: THREE.PerspectiveCamera, d: number) {
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / innerHeight;
  }

  update(camera: THREE.PerspectiveCamera, dt: number) {
    const C = CONFIG.content;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    for (const it of this.items) {
      const a = it.anchor();
      const d = camera.position.distanceTo(a);
      const limit = it.c.distanza_attivazione ?? C.activationDistance;
      const want = it.c.sempre_visibile || d <= limit ? 1 : 0;
      it.shown = THREE.MathUtils.clamp(it.shown + (want ? dt : -dt) / C.fadeSeconds, 0, 1);
      it.obj.visible = it.shown > 0.01;
      if (!it.obj.visible) continue;

      const mpp = this.mpp(camera, d);
      // dimensione a schermo: interpolata sulla distanza (scala logaritmica) tra lontano e vicino
      const t = THREE.MathUtils.clamp(
        Math.log(C.iconFarDistance / d) / Math.log(C.iconFarDistance / C.iconNearDistance), 0, 1);
      const iconPx = THREE.MathUtils.lerp(C.iconHeightFarPx, C.iconHeightNearPx, t);
      const k = iconPx / C.iconHeightNearPx;
      // sfere 360: crescono con la distanza in modo più contenuto delle icone
      const ks = THREE.MathUtils.lerp(C.sphereFarRefPx, C.sphereNearRefPx, t) / C.sphereNearRefPx;
      // affianca i contenuti dello stesso punto, perpendicolari alla vista (più spazio se ci sono sfere 360)
      const gapPx = Math.max(C.spacingPx * k, it.has360 ? 2 * C.sphereRadiusPx * ks + 14 : 0);
      const spread = (it.index - (it.count - 1) / 2) * gapPx * mpp;
      const base = this.tmp.copy(a).addScaledVector(this.right, spread);

      if (it.sphere && it.stem) {
        // come le icone: piccole da lontano, più grandi da vicino (crescita più contenuta)
        const r = C.sphereRadiusPx * ks * mpp;
        const h = C.stemHeightPx * ks * mpp;
        it.obj.position.copy(base);
        it.sphere.position.set(0, h + r, 0);
        it.sphere.scale.setScalar(r);
        it.sphere.rotation.y += dt * 0.25;
        it.stem.scale.set(1, h, 1);
        (it.sphere.material as THREE.MeshBasicMaterial).opacity = it.shown;
        ((it.sphere.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = it.shown;
        (it.stem.material as THREE.LineBasicMaterial).opacity = it.shown * 0.9;
      } else {
        const s = it.obj as THREE.Sprite;
        const hgt = iconPx * mpp;
        s.position.copy(base);
        s.scale.set(hgt * s.userData.aspect, hgt, 1);
        s.material.opacity = it.shown;
      }
    }
  }

  /** Restituisce il contenuto toccato, se c'è. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): Contenuto | null {
    this.ray.setFromCamera(ndc, camera);
    const targets = this.items.filter((i) => i.obj.visible && i.shown > 0.5).map((i) => i.pick);
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    // per le icone ignora la parte trasparente sotto il disco (l'asta)
    const c = hit.object.userData.contenuto as Contenuto;
    if ((hit.object as THREE.Sprite).isSprite && hit.uv && hit.uv.y < 0.55) return null;
    return c;
  }
}
