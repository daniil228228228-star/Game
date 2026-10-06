// offline loop for the fleet yard (backlog #8): the yard group built the way rebuildParkingV65 builds it (lot slab + throat + FleetYardV161.build), no browser.
//   node tools/offline-v161/fleet.cjs [--views front,iso,top,back] [--out DIR] [--probe]
const path = require('path'), fs = require('fs');
const L = require('./probe.cjs');
const { ctx, run, load } = L;
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
run(`
var STAGES = [{ archetype: 'house', baseSize: 2.2 }];
function isNightV40() { return false; }
`);
load('assets/buildings-v161.js'); load('assets/factory-v161.js');
run(`
function mkYard(withTrucks) {
  const OX = -32, g = new THREE.Group(); g.name = 'v116FleetYard';
  const lot = new THREE.Mesh(new THREE.BoxGeometry(11.92, .032, 3.72), new THREE.MeshStandardMaterial({ color: 0x30353b })); lot.position.set(-8.70 + OX, .053, 6.72); g.add(lot);
  const throat = new THREE.Mesh(new THREE.BoxGeometry(2.18, .034, .78), new THREE.MeshStandardMaterial({ color: 0x262a2f })); throat.position.set(-8.70 + OX, .057, 4.62); g.add(throat);
  const xs = [-13.45, -11.55, -9.65, -7.75, -5.85, -3.95], homes = xs.map((x) => ({ x: x + OX, z: 6.62 }));
  FleetYardV161.build(g, { OX, homes });
  if (withTrucks) for (const h of homes) { const t = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: 0xcc4444 })); t.position.set(h.x, 0.55, h.z); g.add(t); }
  scene.children.push(g); g.updateMatrixWorld(true);
  return g;
}
`);
const VIEW = { front: { az: Math.PI, el: 0.2 }, sw: { az: 2.5, el: 0.45 }, se: { az: 3.8, el: 0.45 }, rear: { az: 0, el: 0.2 }, iso: { az: 0.7, el: 0.5 }, iso2: { az: -0.7, el: 0.5 }, top: { az: 0, el: 1.45 }, back: { az: 3.1, el: 0.3 }, low: { az: -0.35, el: 0.28 } };
const views = String(opt('views', 'iso,top')).split(',');
if (opt('probe', false)) {
  const r = run(`(function(){ const g = mkYard(false); const obs = FleetYardV161.obstacles();
    const en = g.userData.v161Obstacles.map((b) => ({ shape: 'obb', pos: b.pos, hx: b.hx, hz: b.hz, yaw: b.yaw, flags: { player: true } }));
    const m = __BLD_PROBE__.measure(g, en, { sweep: false });
    const walk = [];
    const cx = -40.7, cz = 6.72;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a); let x = cx + dx * 9, z = cz + dz * 9, reached = false; for (let s = 0; s < 120; s++) { playerVelocity.set(-dx * 4, 0, -dz * 4); const r = resolvePlayerCircleCollisions(x - dx * 0.1, z - dz * 0.1, en); x = r.x; z = r.z; if (Math.hypot(x - cx, z - cz) < 0.5) reached = true; } walk.push([Math.round(a * 180 / Math.PI), reached]); }
    const dist = (e, x, z) => { const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw), dx = x - e.pos.x, dz = z - e.pos.z, lx = dx * cy - dz * sy, lz = dx * sy + dz * cy; return Math.hypot(Math.max(0, Math.abs(lx) - e.hx), Math.max(0, Math.abs(lz) - e.hz)); };
    let tot = 0, near = 0, worst = 0; const closest = en.map(() => 1e9), v = new THREE.Vector3(); const bad = [];
    g.traverse((o) => { if (!o.isMesh || o.userData.v161Soft || (o.material && o.material.transparent)) return; o.updateMatrixWorld(true); const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); if (v.y < 0.3 || v.y > 1.2) continue; let d = 1e9; en.forEach((e, k) => { const dd = dist(e, v.x, v.z); d = Math.min(d, dd); closest[k] = Math.min(closest[k], dd); }); tot++; if (d <= 0.1) near++; else { worst = Math.max(worst, d); if (bad.length < 6) bad.push([+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +d.toFixed(2)]); } } });
    return { m: { meshes: m.meshes, tris: m.tris, minY: m.minY, maxY: m.maxY }, nObs: en.length, walk, cover: near / tot, tot, worst, boxGap: Math.max(...closest), bad }; })()`);
  console.log(JSON.stringify(r));
  process.exit(0);
}
(async () => {
  const g = run('mkYard(' + (opt('trucks', false) ? 'true' : 'false') + ')');
  let meshes = 0, tris = 0; g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  console.log('fleet yard: meshes', meshes, 'tris', tris);
  const bb = new ctx.THREE.Box3().setFromObject(g); const tg = [(bb.min.x + bb.max.x) / 2, 0.5, (bb.min.z + bb.max.z) / 2];
  for (const v of views) {
    const r = render(g, Object.assign({ W: 1100, H: 640, target: tg }, VIEW[v], { dist: v === 'top' ? 17 : 15 }));
    await save(r, path.join(OUT, `fleet-${v}.jpg`));
  }
})().catch((e) => { console.error(e); process.exit(1); });
