// Ottimizza il plastico: rimuove camere/luci/percorsi non usati, comprime geometria (meshopt) e texture (webp)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, quantize, meshopt, textureCompress, reorder, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, input, output] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const drop = /^(Camera|Luce_|Light$|Originale_Percorso|Percorso \d )/;
for (const node of doc.getRoot().listNodes()) {
  const n = node.getName();
  if (drop.test(n)) { node.setCamera(null); node.dispose(); }
}
for (const c of doc.getRoot().listCameras()) c.dispose();
await doc.transform(dedup(), weld(), prune());
// Semplificazione mirata: i percorsi (tubi) e il terreno sono la parte più pesante
const targets = { Terreno_3D: { ratio: 0.45, error: 0.0004 }, _Semplificato: { ratio: 0.15, error: 0.0008 } };
for (const node of doc.getRoot().listNodes()) {
  const name = node.getName(); const mesh = node.getMesh(); if (!mesh) continue;
  const key = Object.keys(targets).find((k) => name.includes(k)); if (!key) continue;
  for (const prim of mesh.listPrimitives()) {
    const before = prim.getAttribute('POSITION').getCount();
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ...targets[key] });
    console.log(`semplificato ${name}: ${before} -> ${prim.getAttribute('POSITION').getCount()} vertici`);
  }
}
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 16 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
console.log('nodes', doc.getRoot().listNodes().map(n=>n.getName()).filter(n=>/monum|Percorso|Terreno|Basamento/.test(n)).join(' | '));
