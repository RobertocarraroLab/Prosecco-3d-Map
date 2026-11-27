import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { CONFIG } from '../config';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface Monumento { nome: string; node: THREE.Object3D; }
export interface Plastico {
  root: THREE.Object3D;
  terreno: THREE.Group;      // Terreno_3D + Basamento
  itinerari: THREE.Group;    // 4 percorsi semplificati
  monumenti: THREE.Group;
  terrainMesh: THREE.Mesh;
  routeMeshes: Record<string, THREE.Object3D>;  // per nome del nodo
  monumentiList: Monumento[];
  bounds: THREE.Box3;
  getTerrainHeight: (x: number, z: number) => number | null;
}

/** Stampa in console l'albero dei nodi con bounding box e numero di vertici. */
function logTree(obj: THREE.Object3D) {
  const rows: Record<string, unknown>[] = [];
  obj.traverse((o) => {
    if (o === obj) return;
    let vertici = 0;
    o.traverse((c) => { const g = (c as THREE.Mesh).geometry; if (g) vertici += g.attributes.position.count; });
    if (o.parent === obj || /Percorso|Terreno|Basamento/.test(o.name)) {
      const b = new THREE.Box3().setFromObject(o);
      const s = b.getSize(new THREE.Vector3());
      rows.push({ nome: o.name, vertici, larghezza_m: Math.round(s.x), altezza: Math.round(s.y), profondita_m: Math.round(s.z) });
    }
  });
  console.table(rows);
}

export async function loadPlastico(onProgress: (p: number) => void): Promise<Plastico> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(CONFIG.modelUrl, (e) => {
    if (e.total) onProgress(e.loaded / e.total);
  });
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  logTree(root);

  const terreno = new THREE.Group(); terreno.name = 'Gruppo_Territorio';
  const itinerari = new THREE.Group(); itinerari.name = 'Gruppo_Itinerari';
  const monumenti = new THREE.Group(); monumenti.name = 'Gruppo_Monumenti';
  const routeMeshes: Record<string, THREE.Object3D> = {};
  const monumentiList: Monumento[] = [];
  let terrainMesh: THREE.Mesh | null = null;

  // Raccolta per nome, poi spostamento nei gruppi mantenendo le trasformazioni mondo
  const toMove: [THREE.Object3D, THREE.Group][] = [];
  root.traverse((o) => {
    if (o.name === CONFIG.terrainNode || o.name === CONFIG.baseNode) {
      toMove.push([o, terreno]);
      if (o.name === CONFIG.terrainNode) terrainMesh = o as THREE.Mesh;
    }
    if (/^Percorso_\d+_.*_Semplificato$/.test(o.name)) { toMove.push([o, itinerari]); routeMeshes[o.name] = o; }
    if (CONFIG.monumentPattern.test(o.name)) {
      toMove.push([o, monumenti]);
      monumentiList.push({ nome: o.name.replace(CONFIG.monumentPattern, '').replace(/_/g, ' ').trim(), node: o });
    }
  });
  for (const [o, g] of toMove) g.attach(o);
  const out = new THREE.Group();
  out.add(terreno, itinerari, monumenti);

  // Materiali: superfici opache, percorsi leggermente emissivi per staccare dal terreno
  out.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat && 'roughness' in mat) { mat.roughness = Math.max(mat.roughness, 0.85); mat.metalness = 0; }
  });
  itinerari.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive = mat.color.clone(); mat.emissiveIntensity = 0.35;
      m.castShadow = false;
    }
  });

  if (!terrainMesh) throw new Error(`Nodo ${CONFIG.terrainNode} non trovato nel modello`);
  const tm = terrainMesh as THREE.Mesh;

  // Altimetria: riduce l'esagerazione verticale del modello a quella scelta in CONFIG
  // (si scala rispetto alla quota 0: anche la traslazione Y del nodo, dovuta alla quantizzazione, va scalata)
  const fy = CONFIG.verticalExaggeration / CONFIG.modelExaggeration;
  tm.scale.y *= fy;
  tm.position.y *= fy;
  tm.updateMatrixWorld(true);
  tm.geometry.computeBoundsTree();
  const bounds = new THREE.Box3().setFromObject(tm);
  paintWalls(tm, bounds);
  paintRoofs(monumenti);
  // il "Basamento" del file è un cubo di 1 m all'origine, non visibile: lo nascondo
  terreno.traverse((o) => { if (o.name === CONFIG.baseNode) o.visible = false; });

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const getTerrainHeight = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 1e5, z), down);
    ray.firstHitOnly = true;
    const hit = ray.intersectObject(tm, false)[0];
    return hit ? hit.point.y : null;
  };

  console.info('Monumenti trovati:', monumentiList.map((m) => m.nome));
  return { root: out, terreno, itinerari, monumenti, terrainMesh: tm, routeMeshes, monumentiList, bounds, getTerrainHeight };
}

/** Colora di grigio le pareti esterne del plastico (le facce entro CONFIG.wallEdge dal bordo). */
function paintWalls(tm: THREE.Mesh, b: THREE.Box3) {
  const mat = tm.material as THREE.MeshStandardMaterial;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMinXZ = { value: new THREE.Vector2(b.min.x, b.min.z) };
    shader.uniforms.uMaxXZ = { value: new THREE.Vector2(b.max.x, b.max.z) };
    shader.uniforms.uEdge = { value: CONFIG.wallEdge };
    shader.uniforms.uWall = { value: new THREE.Color(CONFIG.wallColor) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec2 uMinXZ; uniform vec2 uMaxXZ; uniform float uEdge; uniform vec3 uWall;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dEdge = min(min(vWPos.x - uMinXZ.x, uMaxXZ.x - vWPos.x), min(vWPos.z - uMinXZ.y, uMaxXZ.y - vWPos.z));
        if (dEdge < uEdge) diffuseColor.rgb = uWall;`);
  };
  mat.needsUpdate = true;
}

/** Monumenti in marrone chiaro; tetti in rosso, riconosciuti dal nome delle parti del modello. */
function paintRoofs(monumenti: THREE.Object3D) {
  const red = new THREE.MeshStandardMaterial({ color: CONFIG.roofColor, roughness: 0.85, metalness: 0 });
  const brown = new THREE.MeshStandardMaterial({ color: CONFIG.monumentColor, roughness: 0.9, metalness: 0 });
  let n = 0;
  monumenti.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = brown;   // tutto il monumento marrone chiaro, poi i tetti in rosso
    // monumento di appartenenza (figlio diretto del gruppo monumenti)
    let root: THREE.Object3D = m;
    while (root.parent && root.parent !== monumenti) root = root.parent;
    const nome = root.name.replace(CONFIG.monumentPattern, '').replace(/_/g, ' ').trim().toLowerCase();
    if (CONFIG.roofSkipMonuments.includes(nome)) return;
    // il nome può stare sulla mesh o su un nodo genitore (gruppi di più parti)
    for (let p: THREE.Object3D | null = m; p && p !== monumenti; p = p.parent) {
      if (CONFIG.roofPattern.test(p.name) && !CONFIG.roofExclude.test(p.name)) { m.material = red; n++; break; }
    }
  });
  console.info(`Tetti colorati: ${n} parti`);
}
