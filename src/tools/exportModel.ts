import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { CONFIG } from '../config';
import type { MonumentsLayer } from '../layers/monuments';
import type { RoutesLayer } from '../layers/routes';

/**
 * Esporta il plastico così come appare nella mappa (solo per uso interno, build con VITE_EXPORT):
 * rilievo ridotto, pareti grigie, monumenti colorati, appoggiati a terra e spostati, itinerari come tubi.
 * Restituisce un GLB, poi convertito in FBX con Blender.
 */
export async function exportModel(
  plastico: { root: THREE.Object3D; terrainMesh: THREE.Mesh; bounds: THREE.Box3 },
  monuments: MonumentsLayer, routes: RoutesLayer,
): Promise<Blob> {
  for (const it of monuments.items) it.pivot.scale.setScalar(it.factor);   // dimensione del modello (vista da lontano)
  plastico.root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = 'Plastico_Colline_del_Prosecco';

  const toFloat = (src: THREE.BufferGeometry) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes) as [string, THREE.BufferAttribute][]) {
      if (k === 'color' || k.startsWith('_')) continue;
      const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
      const get = [a.getX, a.getY, a.getZ, a.getW];
      for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) arr[i * s + j] = get[j].call(a, i);
      g.setAttribute(k, new THREE.BufferAttribute(arr, s));
    }
    if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    return g;
  };
  const plain = (m: THREE.Material) => {
    const s = m as THREE.MeshStandardMaterial;
    const n = new THREE.MeshStandardMaterial({ color: s.color?.clone() ?? new THREE.Color(0xffffff), map: s.map ?? null, roughness: s.roughness ?? 0.9, metalness: 0, side: s.side });
    n.name = m.name;
    if (n.map) n.map.userData.mimeType = 'image/jpeg';
    return n;
  };

  // copia degli oggetti visibili, con le trasformazioni del mondo (posizioni e scale come nella mappa)
  const matCache = new Map<THREE.Material, THREE.Material>();
  plastico.root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = toFloat(m.geometry);
    geo.applyMatrix4(m.matrixWorld);
    let mats: THREE.Material | THREE.Material[];
    if (m === plastico.terrainMesh) {
      // pareti del plastico in grigio: triangoli lungo i bordi (come nello shader della mappa)
      const b = plastico.bounds, e = CONFIG.wallEdge, pos = geo.attributes.position;
      const idx = geo.index ? Array.from(geo.index.array) : [...Array(pos.count).keys()];
      const top: number[] = [], wall: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        let x = 0, z = 0;
        for (let k = 0; k < 3; k++) { x += pos.getX(idx[t + k]) / 3; z += pos.getZ(idx[t + k]) / 3; }
        const d = Math.min(x - b.min.x, b.max.x - x, z - b.min.z, b.max.z - z);
        (d < e ? wall : top).push(idx[t], idx[t + 1], idx[t + 2]);
      }
      geo.setIndex([...top, ...wall]);
      geo.clearGroups(); geo.addGroup(0, top.length, 0); geo.addGroup(top.length, wall.length, 1);
      const wallMat = new THREE.MeshStandardMaterial({ color: CONFIG.wallColor, roughness: 0.9, metalness: 0 });
      wallMat.name = 'Pareti_plastico';
      mats = [plain(m.material as THREE.Material), wallMat];
    } else {
      const src = Array.isArray(m.material) ? m.material : [m.material];
      const conv = src.map((s) => { if (!matCache.has(s)) matCache.set(s, plain(s)); return matCache.get(s)!; });
      mats = Array.isArray(m.material) ? conv : conv[0];
    }
    const mesh = new THREE.Mesh(geo, mats);
    mesh.name = (m.name || m.parent?.name || 'parte').replace(/_/g, ' ');
    out.add(mesh);
  });

  // itinerari: tubi lungo i tracciati vettoriali (le linee colorate della mappa)
  for (const it of routes.itinerari) {
    const mat = new THREE.MeshStandardMaterial({ color: it.data.colore, roughness: 0.6, metalness: 0 });
    mat.name = it.data.nome;
    let k = 0;
    for (const line of it.lines as THREE.Mesh[]) {
      if ((line.material as THREE.Material).depthWrite === false) continue;   // alone bianco
      const a = line.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
      const b = line.geometry.attributes.instanceEnd as THREE.InterleavedBufferAttribute;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < a.count; i++) pts.push(new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)));
      pts.push(new THREE.Vector3(b.getX(a.count - 1), b.getY(a.count - 1), b.getZ(a.count - 1)));
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length, 22, 6, false), mat);
      tube.name = `${it.data.nome} tratto ${++k}`;
      out.add(tube);
    }
  }

  const glb = await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: 16384 });
  return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
}
