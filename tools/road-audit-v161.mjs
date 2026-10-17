// Road geometry audit against real practice (docs/ROAD_STANDARDS_V161.md): direction histogram, segments off the axes, junction angles outside 75..105 degrees.
//   node tools/road-audit-v161.mjs [--late]      (--late = a stage-16 save with everything built; default = the fresh old-format save)
import { openGame, OLD_SAVE } from '../tests/lib/harness.mjs';

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: process.argv.includes('--late') ? LATE : OLD_SAVE, waitMs: 12000 });
try {
  const segs = await g.page.evaluate(() => (window.__TYCOON_V84_ROADS__?.segments?.() || []).map((s) => ({ a: [s.a.x, s.a.z], b: [s.b.x, s.b.z], role: s.role, w: s.width })));
  const len = (s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const long = segs.filter((s) => len(s) > 1.5);
  const ang = (s) => (Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180 / Math.PI + 360) % 180;
  const off = long.filter((s) => { const a = ang(s) % 90; return Math.min(a, 90 - a) > 3; });
  const key = (p) => Math.round(p[0] / 0.8) + ',' + Math.round(p[1] / 0.8);
  const nodes = new Map();
  segs.forEach((s, i) => { for (const [e, p] of [[0, s.a], [1, s.b]]) { const k = key(p); if (!nodes.has(k)) nodes.set(k, []); nodes.get(k).push([i, e]); } });
  let bad = 0, pairs = 0;
  for (const lst of nodes.values()) {
    const dirs = [];
    for (const [i, e] of lst) { const s = segs[i], [a, b] = e === 0 ? [s.a, s.b] : [s.b, s.a]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) continue; dirs.push((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 360); }
    for (let x = 0; x < dirs.length; x++) for (let y = x + 1; y < dirs.length; y++) { let da = Math.abs(dirs[x] - dirs[y]); da = Math.min(da, 360 - da); pairs++; if ((da > 3 && da < 75) || (da > 105 && da < 177)) bad++; }
  }
  const roles = {}; for (const s of segs) roles[s.role] = (roles[s.role] || 0) + 1;
  console.log(JSON.stringify({ segments: segs.length, long: long.length, roles, offAxis: off.length, junctionPairs: pairs, junctionPairsOutside75to105: bad }));
  process.exitCode = bad === 0 && off.length <= 2 ? 0 : 1;
} finally { await g.close(); }
