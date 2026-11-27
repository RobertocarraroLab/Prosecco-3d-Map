import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(process.argv[2]);
const out={};
for (const n of doc.getRoot().listScenes()[0].listChildren()) {
  let v=0,b=0; n.traverse(c=>{const m=c.getMesh(); if(m) for(const p of m.listPrimitives()){v+=p.getAttribute('POSITION').getCount(); for(const a of p.listAttributes()) b+=a.getArray().byteLength; if(p.getIndices()) b+=p.getIndices().getArray().byteLength;}});
  out[n.getName()]=[v,(b/1e6).toFixed(1)+'MB raw'];
}
console.log(out);
