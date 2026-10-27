// offline loop for the offices (stage 6 / 7 / 11 / 14) and towers (8 / 9 / 12 / 15): the real stage numbers / position formulas, no browser.
//   node tools/offline-v161/tower.cjs [--stage 6|7|8|9|11|12|14|15] [--levels 1,3,5,10] [--views front,iso,side,top,back] [--out DIR] [--probe]
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
STAGES[6] = { name: 'Офис', archetype: 'office', baseSize: 2.4, height: 6.5, color: 0xd282ff };
STAGES[7] = { name: 'Бизнес-центр', archetype: 'office', baseSize: 2.8, height: 8.5, color: 0xb96cff };
STAGES[8] = { name: 'Небоскрёб', archetype: 'tower', baseSize: 2.2, height: 13, color: 0x8a5cff };
STAGES[9] = { name: 'Империя', archetype: 'tower', baseSize: 2.6, height: 16, color: 0xffd479, crown: true };
STAGES[10] = { archetype: 'warehouse', baseSize: 2.6, height: 3.6, expansionV159: true, padAngleV159: .40 };
STAGES[11] = { name: 'Исследовательский центр', archetype: 'office', baseSize: 2.5, height: 7.2, color: 0x6bafba, expansionV159: true, padAngleV159: 1.12 };
STAGES[12] = { name: 'Гранд-отель', archetype: 'tower', baseSize: 2.5, height: 11, color: 0xd9bd82, expansionV159: true, padAngleV159: 1.80 };
STAGES[14] = { name: 'Конгресс-центр', archetype: 'office', baseSize: 2.7, height: 8.2, color: 0xb1a78e, expansionV159: true, padAngleV159: 3.85 };
STAGES[15] = { name: 'Финансовый квартал', archetype: 'tower', baseSize: 2.6, height: 18, color: 0x7d99ad, crown: true, expansionV159: true, padAngleV159: 5.30 };
const BUILDING_OFFSET = 2.7, UPGRADE_PAD_OFFSET = 2.15;
function stagePosition(i) { if (STAGES[i].expansionV159) return new THREE.Vector3(Math.cos(STAGES[i].padAngleV159) * 63, 0, Math.sin(STAGES[i].padAngleV159) * 63); const a = i * 0.95, r = 7 + i * 4.6; return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); }
function buildingPosition(i) { const pad = stagePosition(i), dir = pad.clone().normalize(); if (STAGES[i].expansionV159) return pad.addScaledVector(dir, i === 10 ? 5 : 4.2); return pad.addScaledVector(dir, BUILDING_OFFSET); }
function upgradePadPosition(bp, i) { const dir = stagePosition(i).normalize(), t = new THREE.Vector3(-dir.z, 0, dir.x); if (STAGES[i].expansionV159) return bp.clone().addScaledVector(t, i === 10 ? 4.4 : 3.8); return bp.clone().addScaledVector(t, UPGRADE_PAD_OFFSET); }
function stageAccessAxisV92(i) { const p = buildingPosition(i); if (Math.abs(p.x) >= Math.abs(p.z)) return new THREE.Vector3(p.x >= 0 ? 1 : -1, 0, 0); return new THREE.Vector3(0, 0, p.z >= 0 ? 1 : -1); }
function stageRoadEndpointV367(i) { const p = buildingPosition(i), a = stageAccessAxisV92(i), r = Math.max(1.4, STAGES[i].baseSize * 0.64) + 0.12; return p.clone().addScaledVector(a, -r); }
`);
load('assets/buildings-v161.js'); load('assets/towers-v161.js');
const stage = +opt('stage', 6), levels = String(opt('levels', '1,3,5,10')).split(',').map(Number), views = String(opt('views', 'front,iso')).split(',');
const VIEW = { front: { az: 0, el: 0.18 }, iso: { az: 0.7, el: 0.5 }, side: { az: 1.5, el: 0.2 }, top: { az: 0, el: 1.45 }, back: { az: 3.1, el: 0.3 }, iso2: { az: -0.7, el: 0.5 }, iso3: { az: 2.4, el: 0.5 } };
run(`
function mk(idx, lv) {
  const st = STAGES[idx], height = st.height * (1 + (Math.min(lv, 5) - 1) * 0.18);
  const g = (st.archetype === 'office' ? buildOfficeV161 : buildTowerV161)(st, height, st.baseSize, Math.min(lv, 5));
  if (lv > 5) OfficeTowerV161.addGold(g, st, lv);
  g.rotation.y = 0; g.position.set(0, 0, 0);
  return g;
}`);
if (opt('probe', false)) {
  console.log('PROBE stage', stage);
  for (const lv of levels) {
    const r = run(`(function(){ const g = mk(${stage}, ${lv}); const axis = stageAccessAxisV92(${stage}); g.rotation.y = Math.atan2(-axis.x, -axis.z); const bp = buildingPosition(${stage}); g.position.copy(bp); g.updateMatrixWorld(true);
      const en = BuildingsV161.footprintWorld(g).map((b) => ({ shape: 'obb', pos: b.pos, hx: b.hx, hz: b.hz, yaw: b.yaw, flags: { player: true } }));
      const m = __BLD_PROBE__.measure(g, en, {ascii:${opt('ascii', false) ? 'true' : 'false'}});
      const pp = upgradePadPosition(bp, ${stage}); let dmin = 1e9; for (const e of en) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c, qx = Math.max(-e.hx, Math.min(e.hx, lx)), qz = Math.max(-e.hz, Math.min(e.hz, lz)); dmin = Math.min(dmin, Math.hypot(lx - qx, lz - qz)); }
      m.padDist = +dmin.toFixed(2);
      let door = null; g.traverse((o) => { if (o.userData && o.userData.v161Door) door = o; });
      if (door) { const w = new THREE.Vector3(); door.getWorldPosition(w); const end = stageRoadEndpointV367(${stage}), ox = w.x - bp.x, oz = w.z - bp.z, l1 = Math.hypot(ox, oz), l2 = Math.hypot(end.x - bp.x, end.z - bp.z); m.doorDot = +((ox * (end.x - bp.x) + oz * (end.z - bp.z)) / (l1 * l2)).toFixed(3); m.doorDist = +Math.hypot(bp.x + ox - end.x, bp.z + oz - end.z).toFixed(2); }
      return m; })()`);
    const keep = {}; for (const k of ['meshes', 'draw', 'tris', 'minY', 'maxY', 'size', 'footprintArea', 'colliderArea', 'overlap', 'uncovered', 'outside', 'outsideMax', 'sweepReached', 'padDist', 'doorDot', 'doorDist']) keep[k] = r[k];
    console.log('L' + lv, JSON.stringify(keep));
    if (r.ascii) console.log(r.ascii.join('\n'));
  }
  process.exit(0);
}
(async () => {
  console.log('pad local', JSON.stringify(run(`OfficeTowerV161.padLocal(${stage})`)));
  for (const lv of levels) {
    const g = run(`mk(${stage}, ${lv})`);
    g.updateMatrixWorld(true);
    let meshes = 0, tris = 0; g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const bb = new ctx.THREE.Box3().setFromObject(g);
    { const gm = g.children.find((c) => c.name === 'officeTowerGoldV161'); if (gm) { gm.geometry.computeBoundingBox(); console.log('  gold top', gm.geometry.boundingBox.max.y.toFixed(3), 'tris', gm.geometry.index.count / 3); } }
    console.log(`L${lv}: meshes ${meshes}, tris ${tris}, bbox ${bb.min.toArray().map((v) => v.toFixed(2))} .. ${bb.max.toArray().map((v) => v.toFixed(2))}, height ${(bb.max.y - bb.min.y).toFixed(2)}, tops ${JSON.stringify((g.userData.stackTops || []).map((t) => [t.x, t.y, t.z].map((v) => +v.toFixed(2))))}`);
    for (const v of views) {
      const r = render(g, Object.assign({ W: 585, H: 996 }, VIEW[v]));
      await save(r, path.join(OUT, `ot${stage}-L${lv}-${v}.jpg`));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
