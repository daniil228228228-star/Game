// offline loop for the power plant / water works (2026-10-10 (13)): the real assets/infra-plants-v161.js against stub globals, flat-shaded pictures, no browser.
//   node tools/offline-v161/infra.cjs [--levels 1,2,3] [--pending] [--views iso,top,front] [--out DIR] [--kind power,water]
const path = require('path'), fs = require('fs');
const { ctx, run, load } = require('./load.cjs');
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
run(`var lang='ru'; var scene=new THREE.Group(); var v42World={power:null,water:null}; var player={position:new THREE.Vector3(0,0,0)}; function isNightV40(){return false}`);
load('assets/infra-plants-v161.js');
const levels = String(opt('levels', '1,2,3')).split(',').map(Number), kinds = String(opt('kind', 'power,water')).split(',');
const views = String(opt('views', 'iso,top')).split(',');
const VIEW = { iso: { az: 3.14 + 0.55, el: 0.55 }, isoback: { az: 0.55, el: 0.55 }, front: { az: 3.14, el: 0.2 }, top: { az: 0, el: 1.45 }, back: { az: 3.14, el: 0.5 }, side: { az: 1.57, el: 0.3 } };
const THREE = ctx.THREE;
for (const kind of kinds) for (const L of levels) for (const pend of (opt('pending', false) ? [false, true] : [false])) {
  const g = run(`InfraV161.build${kind === 'power' ? 'Power' : 'Water'}(${L}, ${pend}, {mode:'normal', ratio:${opt('low', false) ? 0.5 : 1}})`);
  g.updateMatrixWorld(true);
  let meshes = 0, tris = 0, minY = 1e9; const bb = new THREE.Box3();
  g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const b = new THREE.Box3().setFromObject(o); bb.union(b); minY = Math.min(minY, b.min.y); } });
  console.log(`${kind} L${L}${pend ? ' pending' : ''}: meshes ${meshes}, tris ${tris}, size ${bb.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join('x')}, minY ${minY.toFixed(3)}, footprint boxes ${g.userData.v161Footprint.length}`);
  for (const v of views) save(render(g, Object.assign({ W: 700, H: 700 }, VIEW[v])), path.join(OUT, `${kind}-L${L}${pend ? 'p' : ''}-${v}.jpg`));
}
