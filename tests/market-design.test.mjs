// Market design (2026-10-05 (7), "improve physics and design of every building, one at a time", family #3: the plaza and its 7 stalls; assets/market-v161.js).
// ONE browser launch on the old-format save (every staged flag built = all 7 stalls stand). Physics is the hard block B3 of tests/buildings-physics.test.mjs; this file is the design side:
//   1. 7 stalls, 7 different silhouettes (bbox, triangle count, front silhouette profile), each with a striped awning above the head (>= 1.75 m, two stripe colours) and a counter that a ray
//      from the customer side hits first, the counter faces the plaza centre (rotation == config, dot > 0.999)
//   2. stalls are one merged building each: meshes per stall <= 8; the whole market (plaza + 7 stalls) has fewer meshes and fewer draw calls than the old plaza + tents in the SAME camera
//      (the old builders are rebuilt in the same page through the game's own buildMarketPlazaV116 with MarketV161.enabled = false)
//   3. the picture equals the state: no stall prop is sized by stock (nothing implied: draw ranges untouched, identical geometry at 0 and 9999 planks / concrete / metal)
//   4. vacant (unlocked, not built) stalls show a lot only: pad + stakes + rope + flag (<= 4 meshes, nothing above 1.4 m, no awning / counter / deck / walls, no collider, the pad centre is
//      a standing place), a locked stall shows nothing, building it brings the stall back with its colliders
//   5. the exchange still works through the real #actionBtn with the colliders in place (stand in front of the counter, press, the panel opens)
//   6. life: the lanterns glow at night (shared material), the fountain jet moves; 0 console errors / 4xx
// SHOTS_DIR=<dir> writes the plaza overview (top / gate side), every stall front and one vacant lot.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 6000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
await ev(installProbe);
const IDS = ['team', 'fleet', 'tenders', 'operations', 'meta', 'bonus', 'exchange'];

// ---- 1. silhouettes, awning, counter, facing
const des = await ev((ids) => {
  const out = {}, cream = new THREE.Color(0xf3e8cf).convertSRGBToLinear();
  for (const id of ids) {
    const st = marketRuntimeV116.stalls.get(id), g = st.group, cfg = marketStallConfig(id), D = MarketV161.SPEC[id];
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), v = new THREE.Vector3();
    const bins = new Float32Array(26).fill(0), box = new THREE.Box3(); // front silhouette: highest point per 0.2 m column of local x (-2.6 .. 2.6)
    let tris = 0, meshes = 0; const colours = new Set(); let awnMinX = 1e9, awnMaxX = -1e9, awnMinY = 1e9, awnCream = 0, awnOther = 0;
    const accent = new THREE.Color(cfg.accent).convertSRGBToLinear();
    const meshList = g.children.filter((c) => c.isMesh);
    for (const m of meshList) {
      meshes++; const pa = m.geometry.attributes.position, ca = m.geometry.attributes.color; tris += (m.geometry.index ? m.geometry.index.count : pa.count) / 3;
      const mm = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(mm); box.expandByPoint(v);
        const b = Math.min(25, Math.max(0, Math.floor((v.x + 2.6) / 0.2))); if (v.y > bins[b]) bins[b] = v.y;
        if (m.name === 'v161MarketPaint' && ca && v.y >= 1.75 && v.y <= 3.0) { // awning / roof stripes: the colours of the paint above the head
          awnMinX = Math.min(awnMinX, v.x); awnMaxX = Math.max(awnMaxX, v.x); awnMinY = Math.min(awnMinY, v.y);
          const dc = Math.hypot(ca.getX(i) - cream.r, ca.getY(i) - cream.g, ca.getZ(i) - cream.b);
          if (dc < 0.02) awnCream++; else awnOther++;
          colours.add([ca.getX(i), ca.getY(i), ca.getZ(i)].map((q) => q.toFixed(2)).join(','));
        }
      }
    }
    // rays from the customer side (local +z) at 0.6 m height towards the counter, and from above at the counter centre: what is hit first
    const ray = new THREE.Raycaster(), o = new THREE.Vector3(0, 0.6, D.hd + 1.6).applyMatrix4(g.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(g.matrixWorld);
    ray.set(o, d); const hf = ray.intersectObjects(meshList, false)[0];
    const o2 = new THREE.Vector3(0, 5, D.hd - 0.2).applyMatrix4(g.matrixWorld); ray.set(o2, new THREE.Vector3(0, -1, 0)); const hu = ray.intersectObjects(meshList, false)[0];
    const front = new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld).setY(0).normalize(), to = new THREE.Vector3(MARKET_PLAZA_CENTER_V116.x - g.position.x, 0, MARKET_PLAZA_CENTER_V116.z - g.position.z).normalize();
    const size = box.getSize(new THREE.Vector3());
    out[id] = {
      meshes, tris, size: [size.x, size.y, size.z].map((q) => +q.toFixed(2)), profile: [...bins].map((q) => +q.toFixed(2)),
      awning: { minY: +awnMinY.toFixed(2), width: +(awnMaxX - awnMinX).toFixed(2), cream: awnCream, other: awnOther, colours: colours.size },
      counterFront: hf ? { z: +(D.hd + 1.6 - hf.distance).toFixed(2), mesh: hf.object.name, y: +hf.point.y.toFixed(2) } : null, topHit: hu ? { y: +(hu.point.y).toFixed(2), mesh: hu.object.name } : null,
      dot: +front.dot(to).toFixed(4), rotOk: Math.abs(g.rotation.y - cfg.facing) < 1e-6, hd: D.hd, sprites: g.children.filter((c) => c.isSprite).length,
      parent: g.parent === scene,
    };
  }
  return out;
}, IDS);
const D = IDS.map((id) => ({ id, ...des[id] }));
console.log('stalls:\n  ' + D.map((s) => `${s.id}: ${s.meshes} meshes, ${s.tris} tris, bbox ${s.size.join('x')}, awning from ${s.awning.minY} m, ${s.awning.colours} stripe colours, counter hit at z ${s.counterFront && s.counterFront.z}`).join('\n  '));
check(D.length === 7 && D.every((s) => s.parent && s.rotOk && s.dot > 0.999), `7 stalls stand in the scene, each facing the plaza centre unchanged (rotation == config, front dot ${J(D.map((s) => s.dot))})`);
const pairs = []; for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) pairs.push([D[i], D[j]]);
const bboxDiff = (a, b) => Math.max(...a.size.map((v, k) => Math.abs(v - b.size[k])));
const profDiff = (a, b) => a.profile.reduce((acc, v, k) => acc + Math.abs(v - b.profile[k]) * 0.2, 0);   // m2 between the two front silhouettes
const worstBox = pairs.reduce((m, [a, b]) => Math.min(m, bboxDiff(a, b)), 9), worstProf = pairs.reduce((m, [a, b]) => Math.min(m, profDiff(a, b)), 99);
check(pairs.every(([a, b]) => bboxDiff(a, b) >= 0.05 || a.tris !== b.tris) && new Set(D.map((s) => s.tris)).size === 7 && new Set(D.map((s) => s.size.join('x'))).size === 7, `7 different bboxes and triangle counts (smallest bbox difference between two stalls ${worstBox.toFixed(2)} m)`);
check(worstProf >= 0.15, `the front silhouettes differ pairwise by at least 0.15 m2 (smallest ${worstProf.toFixed(2)} m2): every trade is readable without the icon`);
check(D.every((s) => s.awning.minY >= 1.75 && s.awning.width >= 1.7 && s.awning.cream > 8 && s.awning.other > 8 && s.awning.colours >= 2), `every stall has a striped awning above the head, >= 1.7 m wide, cream + accent stripes (${J(D.map((s) => [s.id, s.awning.minY, s.awning.width, s.awning.colours]))})`);
check(D.every((s) => s.counterFront && s.counterFront.z >= s.hd - 0.25 && s.counterFront.z <= s.hd + 0.12 && s.counterFront.y < 1.3 && s.topHit && s.topHit.y >= 1.8), `every stall has a counter / front wall that a ray from the customer side hits first at the front plane, and a roof above it (${J(D.map((s) => [s.id, s.counterFront && s.counterFront.z, s.topHit && s.topHit.y]))})`);
check(D.every((s) => s.meshes <= 8 && s.sprites === 3), `one merged building per stall: <= 8 meshes (${J(D.map((s) => s.meshes))}), 3 sprites (icon, name, info line) as before`);

// ---- 3. nothing implied by stock: identical geometry at 0 and at 9999
const sig = () => ev((ids) => ids.map((id) => { const g = marketRuntimeV116.stalls.get(id).group; let s = ''; g.traverse((o) => { if (o.isMesh) s += `${o.name}:${o.geometry.attributes.position.count}:${o.geometry.index ? o.geometry.index.count : 0}:${o.geometry.drawRange.start}/${o.geometry.drawRange.count}:${o.visible};`; }); return s + g.children.length; }), IDS);
await ev(() => { planks = 0; concrete = 0; metal = 0; });
await page.waitForTimeout(1500);
const s0 = await sig();
await ev(() => { planks = 9999; concrete = 9999; metal = 9999; });
await page.waitForTimeout(1500);
const s9 = await sig();
check(J(s0) === J(s9), 'stall props are neutral: identical meshes / vertex counts / draw ranges at 0 and 9999 planks, concrete and metal (no stack implies a stock the game does not show)');
check(s0.every((s) => !/:\d+\/\d+:/.test(s)), 'no stall mesh uses a draw range (nothing is sized by a number)');

// ---- 4. vacant lots (unlocked, not built) show a lot only
const lots = await ev(() => {
  const P = __BLD_PROBE__, keepStage = stageIndex, out = {};
  const run = (stage, drop) => {
    for (const id of drop) { const st = marketRuntimeV116.stalls.get(id); if (st) { scene.remove(st.group); disposeObject3D(st.group); marketRuntimeV116.stalls.delete(id); } marketStallsBuiltV118.delete(id); }
    stageIndex = stage; refreshMarketStallsV118(); __TYCOON_V83_COLLISIONS__.rebuild();
    return { vacant: [...marketRuntimeV116.vacant.keys()].sort(), stalls: [...marketRuntimeV116.stalls.keys()].sort() };
  };
  out.s3 = run(3, ['meta', 'bonus']);                    // meta unlocks at 6, bonus at 4: nothing visible for them yet
  out.s4 = run(4, []);
  out.s6 = run(6, []);
  const lot = marketRuntimeV116.vacant.get('meta'), cfg = marketStallConfig('meta');
  lot.updateMatrixWorld(true);
  const meshes = []; let maxY = -1, tris = 0; lot.traverse((o) => { if (o.isMesh) { meshes.push(o.name); tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const b = new THREE.Box3().setFromObject(o); maxY = Math.max(maxY, b.max.y); } });
  out.lot = { name: lot.name, meshes, maxY: +maxY.toFixed(2), tris, rot: +(lot.rotation.y - cfg.facing).toFixed(6), own: P.ownEntries(lot).length, atPad: P.blockedAt(cfg.pos.x, cfg.pos.z), ghost: !!scene.getObjectByName('marketStallV116_meta'), inScene: lot.parent === scene,
    colliders: __TYCOON_V83_COLLISIONS__.registry.size && [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label).startsWith('market-stall-meta')).length };
  out.pos = { x: cfg.pos.x, z: cfg.pos.z };
  return out;
});
console.log('lots:', J({ s3: lots.s3, s4: lots.s4.vacant, s6: lots.s6.vacant, lot: lots.lot }));
check(lots.s3.vacant.length === 0 && J(lots.s4.vacant) === J(['bonus']) && J(lots.s6.vacant) === J(['bonus', 'meta']), `unlock stages unchanged: stage 3 no lot, stage 4 only the bonus lot, stage 6 bonus + meta (${J([lots.s3.vacant, lots.s4.vacant, lots.s6.vacant])})`);
check(lots.lot.inScene && lots.lot.name === 'marketLotV161_meta' && !lots.lot.ghost, 'a vacant stall is a lot group in the scene, not the stall (no built stall of that id)');
check(lots.lot.meshes.length <= 4 && lots.lot.meshes.every((n) => n.startsWith('v161Lot')) && lots.lot.maxY <= 1.4 && lots.lot.tris <= 600, `the lot is an empty frame: ${lots.lot.meshes.length} meshes ${J(lots.lot.meshes)}, nothing above ${lots.lot.maxY} m, ${lots.lot.tris} triangles: no awning, counter, deck or wall`);
check(lots.lot.own === 0 && lots.lot.colliders === 0 && !lots.lot.atPad.hit && Math.abs(lots.lot.rot) < 1e-6, `the lot has no collider and its pad centre is a standing place (${J(lots.lot.atPad)}), aligned with the future stall (rotation == facing)`);
// build it again (real function): the stall is back with its own boxes, the lot is gone
const back = await ev(() => {
  money = 1e9; marketStallBuild('meta'); marketStallBuild('bonus');
  const st = marketRuntimeV116.stalls.get('meta');
  return { built: marketStallsBuiltV118.has('meta') && marketStallsBuiltV118.has('bonus'), stall: !!st, lotGone: !marketRuntimeV116.vacant.has('meta') && !marketRuntimeV116.vacant.has('bonus'),
    boxes: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label).startsWith('market-stall-meta')).length };
});
check(back.built && back.stall && back.lotGone && back.boxes >= 1, `building the vacant stall through marketStallBuild brings the stall back with its colliders (${J(back)})`);
await ev(() => { stageIndex = 1; refreshMarketStallsV118(); });

// ---- 2. meshes and draw calls of the whole market, before (old builders) and after, in one camera
const cmp = await ev(() => {
  const P = __BLD_PROBE__, C = MARKET_PLAZA_CENTER_V116, target = new THREE.Vector3(C.x, 0.4, C.z), gate = Math.atan2(-C.z, -C.x);
  const roots = () => [scene.getObjectByName('marketPlazaV116'), ...[...marketRuntimeV116.stalls.values()].map((s) => s.group), ...marketRuntimeV116.vacant.values()];
  const count = () => { let m = 0, sp = 0; for (const r of roots()) r.traverse((o) => { if (o.isMesh) m++; if (o.isSprite) sp++; }); return { meshes: m, sprites: sp }; };
  const view = () => P.overview(roots(), { target, az: Math.PI / 2 - gate, el: 0.95, dist: 19 });
  const rebuild = (enabled) => {
    MarketV161.enabled = enabled;
    { const pl = scene.getObjectByName('marketPlazaV116'); if (pl) { scene.remove(pl); disposeObject3D(pl); } }
    for (const m of [marketRuntimeV116.stalls, marketRuntimeV116.vacant]) { for (const v of m.values()) { const gg = v.group || v; scene.remove(gg); disposeObject3D(gg); } m.clear(); }
    buildMarketPlazaV116(); __TYCOON_V83_COLLISIONS__.rebuild(); P.forceScan();
  };
  const out = {};
  const a = view(); out.now = { ...count(), draw: a.draw, tris: a.tris };
  rebuild(false); const b = view(); out.old = { ...count(), draw: b.draw, tris: b.tris };
  const oldPlazaMin = (() => { const pl = scene.getObjectByName('marketPlazaV116'); return P.measure(pl, []).minY; })();
  out.oldPlazaMinY = oldPlazaMin;
  rebuild(true); const c = view(); out.new = { ...count(), draw: c.draw, tris: c.tris };
  out.shots = {};
  return out;
});
console.log('market meshes / draw calls (same camera):', J({ old: cmp.old, new: cmp.new, firstMeasure: cmp.now, oldPlazaMinY: cmp.oldPlazaMinY }));
check(cmp.new.meshes < cmp.old.meshes && cmp.new.draw <= cmp.old.draw && cmp.new.sprites === cmp.old.sprites && cmp.now.draw === cmp.new.draw, `the whole market costs less to draw: meshes ${cmp.old.meshes} -> ${cmp.new.meshes}, draw calls ${cmp.old.draw} -> ${cmp.new.draw} (sprites ${cmp.old.sprites} -> ${cmp.new.sprites}), triangles ${cmp.old.tris} -> ${cmp.new.tris}`);
check(cmp.oldPlazaMinY < -0.02, `(for the record) the old plaza stood at min y ${cmp.oldPlazaMinY}: the new one is within 5 cm (checked in buildings-physics B3)`);

// ---- pictures (new market after the rebuild above)
if (SHOTS) {
  const shots = await ev((ids) => {
    const P = __BLD_PROBE__, C = MARKET_PLAZA_CENTER_V116, target = new THREE.Vector3(C.x, 0.4, C.z), gate = Math.atan2(-C.z, -C.x), out = {};
    const roots = () => [scene.getObjectByName('marketPlazaV116'), ...[...marketRuntimeV116.stalls.values()].map((s) => s.group), ...marketRuntimeV116.vacant.values()];
    out['overview-top'] = P.overview(roots(), { target, az: 0, el: 1.5, dist: 22 }).url;
    out['overview-gate'] = P.overview(roots(), { target, az: Math.PI / 2 - gate, el: 0.62, dist: 21 }).url;
    out['overview-high'] = P.overview(roots(), { target, az: Math.PI / 2 - gate, el: 0.95, dist: 19 }).url;
    for (const id of ids) { const gg = marketRuntimeV116.stalls.get(id).group; Object.assign(out, Object.fromEntries(Object.entries(P.shoot(gg, ['front', 'iso'], { only: [gg] }).shots).map(([v, u]) => [`${id}-${v}`, u]))); }
    const cfg = marketStallConfig('meta'); const st = marketRuntimeV116.stalls.get('meta'); scene.remove(st.group); disposeObject3D(st.group); marketRuntimeV116.stalls.delete('meta'); marketStallsBuiltV118.delete('meta');
    const keep = stageIndex; stageIndex = 6; refreshMarketStallsV118(); P.forceScan();
    const lot = marketRuntimeV116.vacant.get('meta'); out['vacant-front'] = P.shoot(lot, ['front'], { only: [lot] }).shots.front; out['vacant-iso'] = P.shoot(lot, ['iso'], { only: [lot, scene.getObjectByName('marketPlazaV116')] }).shots.iso;
    money = 1e9; marketStallBuild('meta'); stageIndex = keep; refreshMarketStallsV118();
    return out;
  }, IDS);
  for (const [k, url] of Object.entries(shots)) fs.writeFileSync(path.join(SHOTS, `market-${k}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
}

// ---- 5. the exchange through the real #actionBtn with the colliders in place
const walk = await ev(() => {
  const cfg = marketStallConfig('exchange'), st = marketRuntimeV116.stalls.get('exchange'), g = st.group, D = MarketV161.SPEC.exchange;
  money = 100000; planks = 5000; concrete = 1; metal = 1;
  const v = g.localToWorld(new THREE.Vector3(0, 0, D.hd + 0.5)); player.position.set(v.x, 0, v.z);
  return { x: v.x, z: v.z, push: __BLD_PROBE__.blockedAt(v.x, v.z).moved };
});
const opened = await page.waitForFunction(() => {
  const host = document.getElementById('systemsOverlay');
  if (host?.classList.contains('show') && host.classList.contains('v119-exchange-mode')) return true;
  const btn = document.getElementById('actionBtn');
  if (btn && !btn.hidden && !btn.disabled) btn.click();
  return false;
}, null, { timeout: 40000, polling: 'raf' }).then(() => true, () => false);
const still = await ev(() => ({ x: player.position.x, z: player.position.z }));
check(opened, `standing in front of the exchange counter (pushed ${walk.push} m by the colliders) the real #actionBtn opens the exchange panel`);
check(Math.hypot(still.x - walk.x, still.z - walk.z) < 0.05, 'the player was not pushed away from the counter while pressing (the front side is a standing place)');
await ev(() => { document.getElementById('marketExchangeCloseV119')?.click(); player.position.set(0, 0, 0); });

// ---- 6. life: lantern glow at night, the jet moves
const lamp0 = await ev(() => MarketV161.mats().lamp.emissiveIntensity);
await ev(() => { v40State.timeOfDay = 22; });
const night = await page.waitForFunction(() => MarketV161.mats().lamp.emissiveIntensity > 0.8, null, { timeout: 40000, polling: 250 }).then(() => true, () => false);
const jetA = await ev(() => scene.getObjectByName('marketPlazaV116').userData.jet.scale.y);
await page.waitForTimeout(700);
const jetB = await ev(() => scene.getObjectByName('marketPlazaV116').userData.jet.scale.y);
await ev(() => { v40State.timeOfDay = 12; });
check(night && lamp0 < 0.8, `the lanterns of the plaza and the stalls glow at night through the shared lamp material (emissive ${lamp0.toFixed(2)} by day, > 0.8 at 22:00)`);
check(Math.abs(jetA - jetB) > 1e-4, `the fountain jet moves (${jetA.toFixed(3)} -> ${jetB.toFixed(3)})`);

check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
