import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Monumento } from '../scene/loadPlastico';
import type { MapFrame } from '../scene/geo';

interface Scaled { m: Monumento; pivot: THREE.Group; natural: number; factor: number; center: THREE.Vector3; height: number; }

/**
 * FASE 4 – Ridimensionamento automatico dei monumenti.
 * Nel plastico i monumenti sono molto ingranditi (visibili da lontano). Avvicinandosi si riducono
 * in proporzione alla distanza fino alla dimensione naturale. Il ridimensionamento parte dalla base
 * (pivot a terra), così il monumento non affonda nel terreno e non fluttua.
 */
export class MonumentsLayer {
  items: Scaled[] = [];
  /** Ingrandimento extra di tutti i monumenti (es. durante il volo lungo un itinerario). */
  boost = 1;

  constructor(list: Monumento[], parent: THREE.Object3D, getHeight: (x: number, z: number) => number | null, map?: MapFrame) {
    for (const m of list) {
      const box = new THREE.Box3().setFromObject(m.node);
      const base = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
      const pivot = new THREE.Group();
      pivot.name = `Pivot_${m.nome}`;
      pivot.position.copy(base);
      parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(m.node);
      // monumento fuori posto nel modello: sposta il pivot (con il monumento) sul punto corretto
      const fix = map && CONFIG.monuments.position[m.nome];
      const center = box.getCenter(new THREE.Vector3());
      if (fix) {
        const { x, z } = map.toWorld(fix.u, fix.v);
        center.x += x - base.x; center.z += z - base.z;
        base.x = x; base.z = z;
        pivot.position.x = x; pivot.position.z = z;
        pivot.position.y = getHeight(x, z) ?? base.y;
        base.y = pivot.position.y;
        console.info(`Monumento "${m.nome}" spostato sul punto corretto`);
      }
      const natural = CONFIG.monuments.naturalScale[m.nome] ?? CONFIG.monuments.defaultNaturalScale;

      // Appoggio a terra: quota minima del terreno sotto l'impronta del monumento a scala naturale
      const r = 0.3 * Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * natural;
      let ground = Infinity;
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2, rr = k === 8 ? 0 : r;
        const h = getHeight(base.x + Math.cos(a) * rr, base.z + Math.sin(a) * rr);
        if (h !== null) ground = Math.min(ground, h);
      }
      // appoggia la base del monumento sul terreno: abbassa quelli sospesi e solleva quelli affondati
      if (Number.isFinite(ground) && Math.abs(base.y - ground) > 1) {
        console.info(`Monumento "${m.nome}" ${base.y > ground ? 'abbassato' : 'sollevato'} di ${Math.round(Math.abs(base.y - ground))} m fino al terreno`);
        pivot.position.y = ground - CONFIG.monuments.sink;
      }
      this.items.push({ m, pivot, natural, factor: CONFIG.monuments.sizeFactor[m.nome] ?? 1, center, height: box.max.y - box.min.y });
    }
  }

  /** Riapplica scala naturale e ingrandimenti da CONFIG (dopo una modifica dei parametri). */
  applyConfig() {
    for (const it of this.items) {
      it.natural = CONFIG.monuments.naturalScale[it.m.nome] ?? CONFIG.monuments.defaultNaturalScale;
      it.factor = CONFIG.monuments.sizeFactor[it.m.nome] ?? 1;
    }
  }

  update(camera: THREE.Camera) {
    for (const it of this.items) {
      const d = camera.position.distanceTo(it.pivot.position);
      const target = THREE.MathUtils.clamp(d / CONFIG.monuments.farDistance, it.natural, 1) * it.factor * this.boost;
      // transizione morbida
      const s = THREE.MathUtils.lerp(it.pivot.scale.x, target, 0.2);
      it.pivot.scale.setScalar(s);
    }
  }

  /** Centro attuale del monumento (dopo il ridimensionamento), per inquadrarlo. */
  focusPoint(i: Scaled) {
    return new THREE.Box3().setFromObject(i.pivot).getCenter(new THREE.Vector3());
  }
}
