import * as THREE from 'three';

/**
 * Conversione tra coordinate della mappa (u, v normalizzate 0–1 sull'area della texture del terreno,
 * identica all'artboard dei file Illustrator e alla mappa stradale 12292×7898 px) e coordinate del modello.
 * u cresce verso est, v verso sud.
 */
export class MapFrame {
  constructor(private bounds: THREE.Box3) {}
  toWorld(u: number, v: number): { x: number; z: number } {
    const { min, max } = this.bounds;
    return { x: min.x + u * (max.x - min.x), z: min.z + v * (max.z - min.z) };
  }
  toUV(x: number, z: number): { u: number; v: number } {
    const { min, max } = this.bounds;
    return { u: (x - min.x) / (max.x - min.x), v: (z - min.z) / (max.z - min.z) };
  }
}
