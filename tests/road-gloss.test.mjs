// Asphalt must stay matte (user report 2026-10-17: a blown-out white wedge on the roads of a built city).
// Root cause: polishBuiltMeshesV43(scene) (tycoon-v161.html, v43 polish, called from the rebuild paths) shaved 6 % off the roughness of EVERY material on each call, and the road
// materials are shared, so after a few dozen calls the asphalt had roughness 0.22 (a mirror) and the sun lit it white. Now once per material.
// One launch on the late save: every near-black asphalt material (0x040507 in the render) keeps roughness >= 0.85 after the world settled and after repeated rebuilds.
import { openGame, check } from './lib/harness.mjs';
const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 9000 });
const ev = (fn, arg) => g.page.evaluate(fn, arg);
try {
  const dist = () => ev(() => { const out = { n: 0, min: 9, glossy: 0 }; scene.traverse((o) => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.type !== 'MeshStandardMaterial' || m.color.getHexString() !== '040507') return; out.n++; out.min = Math.min(out.min, m.roughness); if (m.roughness < 0.85) out.glossy++; }); return out; });
  const before = await dist();
  check(before.n > 5 && before.glossy === 0, `asphalt is matte after boot (${JSON.stringify(before)})`);
  // the rebuild paths that call the v43 polish over and over
  await ev(() => { for (let i = 0; i < 40; i++) { try { window.__TYCOON_V83_COLLISIONS__.rebuild(); window.__TYCOON_V84_ROADS__?.refreshAccessRoads?.(); } catch (_) {} } });
  await g.page.waitForTimeout(6000);
  const after = await dist();
  check(after.n > 5 && after.glossy === 0 && after.min >= 0.85, `asphalt stays matte after 40 rebuilds and 6 s (${JSON.stringify(after)})`);
  check(g.errors.length === 0, `no console/page errors (${JSON.stringify(g.errors.slice(0, 3))})`);
} finally { await g.close(); }
