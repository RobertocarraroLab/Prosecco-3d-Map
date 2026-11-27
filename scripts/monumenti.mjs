// Misura gli ingombri dei monumenti nel plastico (altezza e base in unità del modello ≈ metri)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
for (const n of doc.getRoot().listScenes()[0].listChildren()) {
  if (!/^monu/i.test(n.getName())) continue;
  const b = getBounds(n);
  const s = b.max.map((v, i) => Math.round(v - b.min[i]));
  console.log(n.getName().padEnd(42), 'L×H×P', s.join(' × '), ' base y', Math.round(b.min[1]), ' scala nodo', n.getScale()[0].toFixed(2));
}
