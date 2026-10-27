// Roundabout at the city hub (assets/roundabout-v161.js, 2026-10-18). One launch on the late save, one on a fresh game.
//   * fresh game (one street at the hub): no roundabout (nothing without a reason); late city (4 arms): one group of <= 4 meshes
//   * no stage-road knee / junction within 14 m of the hub (real practice: the first junction is a few car lengths away), every arm is axis-aligned
//   * the ring sits above the old dashes (v95 markings top 0.084) and its asphalt is the road material
//   * routes of the game (buildRoadRoute) through the hub run around the island, in the kernel's lane direction (increasing atan2(z, x)), never over the island, U-turn = a lap
//   * the island is solid for the player (a walk from 8 directions never gets inside r 1.7)
//   * no legacy roadside prop stands on a drawn street or in the circle
//   * draw calls: the whole layer adds <= 3
import { openGame, check } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR;
const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };

{
  const g = await openGame({ save: 'clear', waitMs: 4000 });
  try {
    const f = await g.page.evaluate(() => ({ has: !!window.RoundaboutV161, active: window.RoundaboutV161 && window.RoundaboutV161.active(), arms: window.RoundaboutV161 && window.RoundaboutV161.arms.length }));
    check(f.has && !f.active, `fresh game: no roundabout with ${f.arms} street(s) at the hub (${J(f)})`);
    check(g.errors.length === 0, `fresh: no console errors (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); }
}

const g = await openGame({ save: LATE, waitMs: 12000 });
const { page } = g;
const ev = (fn, a) => page.evaluate(fn, a);
try {
  const info = await ev(() => {
    const R = window.RoundaboutV161, grp = R.group, P = R.params;
    const meshes = []; grp && grp.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const dashTop = (() => { let top = 0; scene.traverse((o) => { if (o.name === 'v95UnifiedMarkings') o.traverse((k) => { if (k.isMesh) { k.geometry.computeBoundingBox(); top = Math.max(top, k.position.y + k.geometry.boundingBox.max.y); } }); }); return top; })();
    const roadMesh = (() => { const g0 = scene.getObjectByName('v113UnifiedStarterRoadSurface'); return g0 && g0.children.find((k) => k.isMesh && k.visible && k.geometry.attributes.position.count > 100); })();
    const asph = meshes.find((m) => m.name === 'v161RoundaboutAsphalt');
    let ymin = 9, ymax = -9; if (asph) { const p = asph.geometry.attributes.position; for (let i = 0; i < p.count; i++) { ymin = Math.min(ymin, p.getY(i)); ymax = Math.max(ymax, p.getY(i)); } }
    const segs = window.__TYCOON_V84_ROADS__.segments().filter((s) => s.role === 'stage' || s.role === 'stage-road' || s.role === 'stage-driveway');
    const ends = []; for (const s of segs) for (const q of [s.a, s.b]) { const r = Math.hypot(q.x, q.z); if (r > 0.5) ends.push(+r.toFixed(2)); }
    const nearest = Math.min(...ends);
    const armOk = R.arms.every((a) => { const k = a / (Math.PI / 2); return Math.abs(k - Math.round(k)) < 0.02; });
    // legacy roadside props on streets / in the circle
    const bad = []; const v = new THREE.Vector3(); const all = window.__TYCOON_V84_ROADS__.segments();
    scene.traverse((o) => {
      if (!o.userData || !o.userData.v37LegacyRoadside || !o.userData.v161Prop) return;
      let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) vis = false;
      if (!vis) return;
      o.getWorldPosition(v);
      let hit = Math.hypot(v.x, v.z) < P.R + 1.2;
      for (const s of all) { const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, q = dx * dx + dz * dz, t = q ? Math.max(0, Math.min(1, ((v.x - s.a.x) * dx + (v.z - s.a.z) * dz) / q)) : 0; if (Math.hypot(v.x - s.a.x - dx * t, v.z - s.a.z - dz * t) < (s.width || 2.36) / 2 + 0.6) hit = true; }
      if (hit) bad.push([o.userData.v161Prop, +v.x.toFixed(1), +v.z.toFixed(1)]);
    });
    return { active: R.active(), arms: R.arms.map((a) => +a.toFixed(2)), meshes: meshes.map((m) => [m.name, m.geometry.attributes.position.count, m.renderOrder]), dashTop: +dashTop.toFixed(3), ymin: +ymin.toFixed(3), roadMat: !!roadMesh, asphColor: asph && asph.material.color.getHexString(), roadColor: roadMesh && roadMesh.material.color.getHexString(), po: asph && asph.material.polygonOffsetFactor, nearest, armOk, bad };
  });
  check(info.active && info.arms.length === 4 && info.armOk, `late city: the roundabout stands with 4 axis-aligned arms (${J(info.arms)})`);
  check(info.meshes.length >= 3 && info.meshes.length <= 4, `merged: ${info.meshes.length} meshes (${J(info.meshes)})`);
  check(info.ymin > info.dashTop + 0.002 && info.asphColor === info.roadColor && info.roadMat, `the ring asphalt (y ${info.ymin}) lies above the old dashes (top ${info.dashTop}) and has the road colour (${info.asphColor} / ${info.roadColor})`);
  check(info.nearest >= 14, `no stage-road knee / junction closer than 14 m to the hub (nearest ${info.nearest} m)`);
  check(info.bad.length === 0, `no legacy roadside prop on a street or in the circle (${J(info.bad)})`);

  // routes through the hub
  const rt = await ev(() => {
    const R = window.RoundaboutV161, P = R.params, V = (x, z) => new THREE.Vector3(x, 0, z);
    const lap = (pts) => pts.map((p) => Math.hypot(p.x, p.z));
    const dir = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) { const a0 = Math.atan2(pts[i - 1].z, pts[i - 1].x), a1 = Math.atan2(pts[i].z, pts[i].x); if (Math.hypot(pts[i].x, pts[i].z) > P.LANE - 0.05 && Math.hypot(pts[i].x, pts[i].z) < P.LANE + 0.05 && Math.hypot(pts[i - 1].x, pts[i - 1].z) > P.LANE - 0.05 && Math.hypot(pts[i - 1].x, pts[i - 1].z) < P.LANE + 0.05) s += Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)); } return s; };
    const out = {};
    for (const [k, a, b] of [['we', V(-9, 0), V(9, 0)], ['ns', V(0, -12), V(0, 12)], ['ne', V(0, 12), V(11, 0)]]) { const r = buildRoadRoute(a, b); out[k] = { n: r.length, minR: Math.min(...lap(r.slice(1, -1).length ? r.slice(1, -1) : r)), swept: +dir(r).toFixed(2), start: [r[0].x, r[0].z], end: [r[r.length - 1].x, r[r.length - 1].z] }; }
    const u = R.route([V(0, 12), V(0, 0), V(0, 12)]); out.u = { swept: +dir(u).toFixed(2), n: u.length };
    const e = R.route([V(0, 0), V(0, 12)]); out.fromHub = { n: e.length, first: [+e[0].x.toFixed(2), +e[0].z.toFixed(2)] };
    const ok = R.route([V(30, 30), V(40, 30)]); out.far = ok.length;
    return out;
  });
  check(rt.we.minR >= 3.0 && rt.we.swept > 3.0 && rt.we.swept < 3.3, `west -> east goes half a lap in the lane direction (swept ${rt.we.swept} rad, min radius ${rt.we.minR.toFixed(2)})`);
  check(rt.ne.swept > 4.6 && rt.ne.swept < 4.8, `north -> east takes three quarters of the lap (${rt.ne.swept} rad, as in a left-hand circulating system)`);
  check(rt.ns.swept > 3.0 && rt.ns.swept < 3.3 && rt.u.swept > 6.1 && rt.u.swept < 6.4, `south -> north half a lap (${rt.ns.swept}), a U-turn is a whole lap (${rt.u.swept})`);
  check(rt.fromHub.n === 2 && Math.abs(Math.hypot(rt.fromHub.first[0], rt.fromHub.first[1]) - 3.1) < 0.05 && rt.far === 2, `a route that starts at the hub is cut at the circle; routes elsewhere are untouched (${J({ fromHub: rt.fromHub, far: rt.far })})`);

  // solid island: the player walked at the centre from 8 directions
  const walk = await ev(() => {
    const res = [];
    const reg = window.__TYCOON_V83_COLLISIONS__;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle'));
      let x = Math.cos(a) * 5, z = Math.sin(a) * 5, depth = 9;
      const saved = playerVelocity.clone();
      for (let s = 0; s < 70; s++) { const nx = x - Math.cos(a) * 0.1, nz = z - Math.sin(a) * 0.1; playerVelocity.set(-Math.cos(a) * 4, 0, -Math.sin(a) * 4); const r = resolvePlayerCircleCollisions(nx, nz, entries); x = r.x; z = r.z; depth = Math.min(depth, Math.hypot(x, z)); }
      playerVelocity.copy(saved);
      res.push(+depth.toFixed(2));
    }
    return { res, has: !!reg };
  });
  check(walk.res.every((d) => d >= 1.5), `a player walking at the island from 8 directions stays outside r 1.7 (min distances ${J(walk.res)})`);

  // draw calls: the layer adds <= 3
  const dc = await ev(async () => {
    const R = window.RoundaboutV161, frame = () => new Promise((r) => requestAnimationFrame(r));
    renderer.shadowMap.autoUpdate = false;
    const meas = async () => { let best = 1e9; for (let i = 0; i < 3; i++) { await frame(); await frame(); renderer.info.reset(); renderer.render(scene, camera); best = Math.min(best, renderer.info.render.calls); } return best; };
    const with_ = await meas(); R.group.visible = false; const without = await meas(); R.group.visible = true;
    return { with_, without };
  });
  check(dc.with_ - dc.without <= 3, `draw calls: the roundabout adds ${dc.with_ - dc.without} (<= 3)`);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [name, h, tilt] of [['top', 22, 0.001], ['iso', 18, 0.7]]) {
      const url = await ev(({ h, tilt }) => { const c = camera; c.position.set(0, h, h * Math.tan(tilt)); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); renderer.render(scene, c); return renderer.domElement.toDataURL('image/jpeg', 0.85); }, { h, tilt });
      fs.writeFileSync(path.join(SHOTS, `roundabout-${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  check(g.errors.length === 0, `no console/page errors (${J(g.errors.slice(0, 4))})`);
} catch (e) { console.error('FAIL: exception ' + (e && e.stack || e)); process.exitCode = 1; } finally { await g.close(); }
