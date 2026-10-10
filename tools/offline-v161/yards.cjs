// offline loop for the loading yards (2026-10-10 (12)): the real assets/plants-v161.js + assets/yards-v161.js against stub globals, the lane / road boxes and the colliders measured in the live game
// (tools/probe-loading-v161.mjs -> JSON), trucks as boxes at the bay, trees as cylinders. No browser.
//   node tools/offline-v161/yards.cjs [--roads FILE] [--views top,iso] [--out DIR] [--no-yards]
const path = require('path'), fs = require('fs');
const { ctx, run, load } = require('./load.cjs');
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
const ROADS = opt('roads', path.join(__dirname, '..', '..', '..', 'out', 'probe_old.json'));
run(`
var lang='ru', stageIndex=16, CONCRETE_UNLOCK_STAGE=4, METAL_UNLOCK_STAGE=5, sawmillBuiltV118=true, concretePlantBuiltV118=true, metalYardBuiltV118=true;
var INDUSTRIAL_ZONE_OFFSET_X=-32, CONCRETE_PLANT_POS=new THREE.Vector3(-44.1,0,-10.3), METAL_YARD_POS=new THREE.Vector3(-39.3,0,-10.6);
var sourceTrees=[], planks=0, concretePlant=null, metalPlant=null;
var scene=new THREE.Group();
function makeLabelSprite(){const g=new THREE.Group();g.isSprite=true;return g}
function updateLabelSprite(){}
function industrialLevelV161(){return 1}
function productionSpeedMultiplier(){return 1}
function industrialSpeedV161(){return 1}
var CONCRETE_AUTO_INTERVAL=8, METAL_AUTO_INTERVAL=9;
function disposeObject3D(){}
var STATIC_COLLIDERS=[];
`);
load('assets/plants-v161.js');
if (!opt('no-yards', false)) load('assets/yards-v161.js'); else run('window.YardsV161=undefined');
run(`
window.PlantsV161.enabled=true;
const c=PlantsV161.buildConcrete(1); c.group.position.copy(CONCRETE_PLANT_POS); scene.add(c.group); concretePlant=c;
const m=PlantsV161.buildMetal(1); m.group.position.copy(METAL_YARD_POS); scene.add(m.group); metalPlant=m;
if(window.YardsV161) YardsV161.sync();
`);
// roads, trees, trucks from the live probe
const J = JSON.parse(fs.readFileSync(ROADS, 'utf8'));
const THREE = ctx.THREE;
const dbg = new THREE.Group(); dbg.name = 'dbg';
const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 1 }, o || {}));
for (const r of J.roads) { if (r.b[0] > -30 || r.b[5] > 10) continue; const b = r.b; if (b[3] - b[0] > 30) continue; const m = new THREE.Mesh(new THREE.BoxGeometry(b[3] - b[0], 0.04, b[5] - b[2]), mat(0x14161c)); m.position.set((b[0] + b[3]) / 2, 0.06, (b[2] + b[5]) / 2); dbg.add(m); }
const trees = [[-39.41, -3.28], [-41.36, -1.33], [-44.25, -1.85], [-45.19, -4.32], [-40.35, -5.75]];
if (!opt('no-yards', false)) trees.push([-43.2, -3.7]); else trees.push([-43.24, -6.27]);
for (const [x, z] of trees) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), mat(0x6b4a2b)); t.position.set(x, 0.6, z); dbg.add(t); const k = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), mat(0x5aa04a)); k.position.set(x, 1.6, z); dbg.add(k); }
const truck = (x, z, yaw, c) => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.2, 2.11), mat(c)); b.position.y = 0.7; g.add(b); g.position.set(x, 0, z); g.rotation.y = yaw; dbg.add(g); };
if (ctx.window.YardsV161) { const S = run('YardsV161.spec()'); truck(S.planks.stop.x, S.planks.stop.z, S.planks.yaw, 0xc88a3a); truck(S.concrete.stop.x, S.concrete.stop.z, S.concrete.yaw, 0xd0d0d0); truck(S.metal.stop.x, S.metal.stop.z, S.metal.yaw, 0x7a8896); }
// sawmill hall stub: the real colliders (rotated boxes from the live scan)
const saw = [[-50.26, -9.48, 2.47, 0.15, -0.4214], [-53.23, -8.59, 0.12, 2.12, -0.4214], [-53.81, -6.66, 0.385, 0.12, -0.4214], [-50.73, -5.28, 1.185, 0.12, -0.4214], [-52.42, -6.56, 0.955, 1.42, -0.4214]];
for (const [x, z, hx, hz, yaw] of saw) { const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 2.2, hz * 2), mat(0x9b6a4a)); m.position.set(x, 1.1, z); m.rotation.y = yaw; dbg.add(m); }
const ring = (x, z, r, c) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 24), mat(c)); m.position.set(x, 0.08, z); dbg.add(m); };
ring(-48.25, -6.0, 0.95, 0xe08a2a); ring(-53.32, -4.96, 0.9, 0xf0e0b0); ring(-47.2, -11.2, 1.0, 0x8fd0e0); ring(-35.9, -10.4, 1.0, 0x8fd0e0);
if (ctx.window.YardsV161) { const S = run('YardsV161.spec()'); ring(S.concrete.pile.x, S.concrete.pile.z, 0.9, 0xd8d8c0); ring(S.metal.pile.x, S.metal.pile.z, 0.9, 0xb8c8d0); }
const root = run('scene'); root.add(dbg);
const VIEW = { top: { az: 0, el: 1.5, dist: 30 }, iso: { az: 0.5, el: 0.6, dist: 24 }, south: { az: 0.0, el: 0.5, dist: 22 } };
(async () => {
  for (const v of String(opt('views', 'top,iso')).split(',')) {
    const t = opt('target', '-43,0,-6').split(',').map(Number);
    const r = render(root, Object.assign({ W: 780, H: 760, target: t, fov: 40 }, VIEW[v]));
    await save(r, path.join(OUT, `yards-off-${v}${opt('no-yards', false) ? '-old' : ''}.jpg`));
  }
  console.log('done', run('JSON.stringify(YardsV161&&YardsV161.snap())'));
})().catch((e) => { console.error(e); process.exit(1); });
