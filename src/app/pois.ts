import * as THREE from 'three';
import type { MapFrame } from '../scene/geo';
import type { Localita } from '../layers/labels';
import type { MonumentsLayer } from '../layers/monuments';
import { isLive, type Contenuto } from '../layers/content';
import { t } from '../ui/i18n';

/** Un punto di interesse: località o monumento, con i contenuti collegati. */
export interface Poi {
  key: string;                 // usato anche come link diretto (#localita-conegliano)
  nome: string;
  tipo: 'localita' | 'monumento';
  categoria: string;
  livello?: number;
  ground: () => THREE.Vector3; // punto sul terreno
  contenuti: Contenuto[];
  labelId?: string;
}

export const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const LOWER = new Set(['di', 'del', 'della', 'dei', 'delle', 'in', 'a', 'al', 'e']);
/** Maiuscola iniziale delle parole, tranne articoli e preposizioni (es. "Abbazia di Follina"). */
export const capitalize = (s: string) => s.split(' ')
  .map((w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

export function buildPois(
  localita: Localita[], monuments: MonumentsLayer, contenuti: Contenuto[], map: MapFrame,
  getHeight: (x: number, z: number) => number | null,
): Poi[] {
  const pois: Poi[] = [];
  const cat = { 1: t('level1'), 2: t('level2'), 3: t('level3') } as Record<number, string>;
  const seen = new Set<string>();
  for (const l of [...localita].sort((a, b) => a.livello - b.livello)) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    const { x, z } = map.toWorld(l.u, l.v);
    const p = new THREE.Vector3(x, getHeight(x, z) ?? 0, z);
    pois.push({
      key: `localita-${l.id}`, nome: l.nome, tipo: 'localita', categoria: (l as any).categoria || cat[l.livello], livello: l.livello,
      ground: () => p, labelId: l.id,
      contenuti: contenuti.filter((c) => isLive(c) && c.poi?.tipo === 'localita' && c.poi.id === l.id),
    });
  }
  for (const m of monuments.items) {
    pois.push({
      key: `monumento-${slug(m.m.nome)}`, nome: capitalize(m.m.nome), tipo: 'monumento', categoria: t('monuments'),
      ground: () => m.pivot.position,
      contenuti: contenuti.filter((c) => isLive(c) && c.poi?.tipo === 'monumento' && c.poi.id.toLowerCase() === m.m.nome.toLowerCase()),
    });
  }
  return pois;
}
