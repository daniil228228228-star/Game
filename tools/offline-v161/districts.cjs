// offline loop for the district identities (2026-10-10 (13)): assets/infra-plants-v161.js (kit) + assets/districts-v161.js against stub globals, flat-shaded pictures.
//   node tools/offline-v161/districts.cjs [--levels 1,3] [--views iso,top,front] [--out DIR] [--ids industrial,business,waterfront]
const path = require('path'), fs = require('fs');
const { ctx, run, load } = require('./load.cjs');
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
run(`var lang='ru'; var scene=new THREE.Group(); var cityWorldRuntime={districtIdentity:new Map()}; var player={position:new THREE.Vector3(0,0,0)}; function isNightV40(){return false}`);
load('assets/infra-plants-v161.js'); load('assets/districts-v161.js');
const levels = String(opt('levels', '1,3')).split(',').map(Number), ids = String(opt('ids', 'industrial,business,waterfront')).split(',');
const views = String(opt('views', 'iso,top')).split(',');
const VIEW = { iso: { az: 0.55, el: 0.55 }, iso2: { az: 3.9, el: 0.5 }, top: { az: 0, el: 1.45 }, front: { az: 0, el: 0.2 } };
const THREE = ctx.THREE;
for (const id of ids) for (const L of levels) {
  const g = run(`DistrictsV161.build('${id}', ${L})`);
  g.updateMatrixWorld(true);
  let meshes = 0, tris = 0, minY = 1e9; const bb = new THREE.Box3();
  g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const b = new THREE.Box3().setFromObject(o); bb.union(b); minY = Math.min(minY, b.min.y); } });
  console.log(`${id} L${L}: meshes ${meshes}, tris ${tris}, size ${bb.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join('x')}, box x ${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)} z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)}, minY ${minY.toFixed(3)}, footprint ${g.userData.v161Footprint.length}`);
  for (const v of views) save(render(g, Object.assign({ W: 700, H: 700 }, VIEW[v])), path.join(OUT, `dist-${id}-L${L}-${v}.jpg`));
}
