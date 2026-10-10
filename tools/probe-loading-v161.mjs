// Scene probe for the loading points (2026-10-10 (12)): where every resource is picked up / dropped / where trucks stop, and which road meshes lie under or near each point.
// node tools/probe-loading-v161.mjs [old|full]   -> JSON on stdout
import { openGame, OLD_SAVE } from '../tests/lib/harness.mjs';
const mode = process.argv[2] || 'old';
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const out = await g.page.evaluate(() => {
  scene.updateMatrixWorld(true);
  const P = (v) => v ? { x: +v.x.toFixed(2), z: +v.z.toFixed(2) } : null;
  const pts = {};
  const add = (k, v) => { if (v) pts[k] = P(v); };
  add('SAWMILL_POS', SAWMILL_POS); add('CONCRETE_PLANT_POS', CONCRETE_PLANT_POS); add('METAL_YARD_POS', METAL_YARD_POS); add('GENERATOR_POS', GENERATOR_POS);
  for (const k of Object.keys(LOGISTICS_ZONES)) add('zone.' + k, LOGISTICS_ZONES[k].pos);
  for (const c of ['planks', 'concrete', 'metal']) add('truckSource.' + c, cargoInfo(c).source);
  add('PLANK_TRUCK_BAY', PLANK_TRUCK_BAY_POS_V161);
  const nodes = serviceAccessGraph();
  for (const n of nodes) add('node.' + n.id, n.p);
  const roads = [];
  scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { roads.push({ o, grp: p.name || 'stageRoads' }); break; } } });
  const rb = roads.map(({ o, grp }) => { const b = new THREE.Box3().setFromObject(o); return { name: o.name, grp, b: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(2)) }; });
  return { pts, nodes: nodes.map((n) => ({ id: n.id, parent: n.parent, ...P(n.p) })), roads: rb };
});
console.log(JSON.stringify(out, null, 1));
await g.close();
