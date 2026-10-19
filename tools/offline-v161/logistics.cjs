// offline loop for the warehouse (stage 3) and the logistics terminal (stage 10): the real stage numbers / position formulas, no browser.
//   node tools/offline-v161/logistics.cjs [--stage 3|10] [--levels 1,3,5,10] [--views front,iso,side,top] [--out DIR] [--probe]
const path = require('path'), fs = require('fs');
const L = require('./probe.cjs');
const { ctx, run, load } = L;
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
run(`
var STAGES = [];
for (let i = 0; i < 16; i++) STAGES.push({ archetype: 'x', baseSize: 2.4, height: 3, color: 0x888888 });
STAGES[3] = { name: 'Склад', archetype: 'warehouse', baseSize: 2.2, height: 2.4, color: 0x9aa5b1 };
STAGES[10] = { name: 'Терминал', archetype: 'warehouse', baseSize: 2.6, height: 3.6, color: 0x859caa, expansionV159: true, padAngleV159: .40 };
const BUILDING_OFFSET = 2.7, UPGRADE_PAD_OFFSET = 2.15;
function stagePosition(i) { if (STAGES[i].expansionV159) return new THREE.Vector3(Math.cos(STAGES[i].padAngleV159) * 63, 0, Math.sin(STAGES[i].padAngleV159) * 63); const a = i * 0.95, r = 7 + i * 4.6; return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); }
function buildingPosition(i) { const pad = stagePosition(i), dir = pad.clone().normalize(); if (STAGES[i].expansionV159) return pad.addScaledVector(dir, i === 10 ? 5 : 4.2); return pad.addScaledVector(dir, BUILDING_OFFSET); }
function upgradePadPosition(bp, i) { const dir = stagePosition(i).normalize(), t = new THREE.Vector3(-dir.z, 0, dir.x); if (STAGES[i].expansionV159) return bp.clone().addScaledVector(t, i === 10 ? 4.4 : 3.8); return bp.clone().addScaledVector(t, UPGRADE_PAD_OFFSET); }
function stageAccessAxisV92(i) { const p = buildingPosition(i); if (Math.abs(p.x) >= Math.abs(p.z)) return new THREE.Vector3(p.x >= 0 ? 1 : -1, 0, 0); return new THREE.Vector3(0, 0, p.z >= 0 ? 1 : -1); }
`);
load('assets/buildings-v161.js'); load('assets/warehouse-v161.js');
const stage = +opt('stage', 3), levels = String(opt('levels', '1,3,5,10')).split(',').map(Number), views = String(opt('views', 'front,iso')).split(',');
const VIEW = { front: { az: 0, el: 0.18 }, iso: { az: 0.7, el: 0.5 }, side: { az: 1.5, el: 0.2 }, top: { az: 0, el: 1.45 }, back: { az: 3.1, el: 0.3 }, iso2: { az: -0.7, el: 0.5 } };
run(`
function mk(idx, lv) {
  const st = STAGES[idx], height = st.height * (1 + (Math.min(lv, 5) - 1) * 0.18);
  const g = buildLogisticsV161(st, height, st.baseSize, Math.min(lv, 5));
  if (lv > 5) LogisticsV161.addGold(g, st, lv);
  g.rotation.y = 0;
  const bp = buildingPosition(idx); g.position.set(0, 0, 0);
  return g;
}`);
if (opt('probe', false)) {
  console.log('PROBE stage', stage);
  for (const lv of levels) {
    const r = run(`(function(){ const g = mk(${stage}, ${lv}); const axis = stageAccessAxisV92(${stage}); g.rotation.y = Math.atan2(-axis.x, -axis.z); const bp = buildingPosition(${stage}); g.position.copy(bp); g.updateMatrixWorld(true);
      const en = BuildingsV161.footprintWorld(g).map((b) => ({ shape: 'obb', pos: b.pos, hx: b.hx, hz: b.hz, yaw: b.yaw, flags: { player: true } }));
      const m = __BLD_PROBE__.measure(g, en, {});
      const pp = upgradePadPosition(bp, ${stage}); let dmin = 1e9; for (const e of en) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c, qx = Math.max(-e.hx, Math.min(e.hx, lx)), qz = Math.max(-e.hz, Math.min(e.hz, lz)); dmin = Math.min(dmin, Math.hypot(lx - qx, lz - qz)); }
      m.padDist = +dmin.toFixed(2); return m; })()`);
    const keep = {}; for (const k of ['meshes', 'draw', 'tris', 'minY', 'maxY', 'footprintArea', 'colliderArea', 'overlap', 'uncovered', 'outside', 'outsideMax', 'reach', 'padDist']) keep[k] = r[k];
    console.log('L' + lv, JSON.stringify(keep));
  }
  process.exit(0);
}
(async () => {
  console.log('pad local', JSON.stringify(run(`LogisticsV161.padLocal(${stage})`)));
  for (const lv of levels) {
    const g = run(`mk(${stage}, ${lv})`);
    g.updateMatrixWorld(true);
    let meshes = 0, tris = 0; g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const bb = new ctx.THREE.Box3().setFromObject(g);
    console.log(`L${lv}: meshes ${meshes}, tris ${tris}, bbox ${bb.min.toArray().map((v) => v.toFixed(2))} .. ${bb.max.toArray().map((v) => v.toFixed(2))}, fp ${JSON.stringify(g.userData.v161Footprint.map((f) => [f.x, f.z, f.hx, f.hz].map((v) => +v.toFixed(2))))}`);
    for (const v of views) {
      const r = render(g, Object.assign({ W: 585, H: 996 }, VIEW[v]));
      await save(r, path.join(OUT, `lg${stage}-L${lv}-${v}.jpg`));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
