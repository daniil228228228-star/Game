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
  // junction spacing / block length of the drawn stage streets (docs/ROAD_STANDARDS_V161.md: the game is ~0.4 of real size; junctions closer than 7 m (about 18 m real) or blocks longer than 60 m (150 m real) are reported)
  const st = segs.filter((s) => /^stage/.test(s.role));
  const pk = (p) => Math.round(p[0] * 2) / 2 + ',' + Math.round(p[1] * 2) / 2;
  const onSeg = (p, s) => { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz; if (L2 < 1e-9) return false; const t = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / L2; return t > 0.01 && t < 0.99 && Math.hypot(s.a[0] + dx * t - p[0], s.a[1] + dz * t - p[1]) < 0.3; };
  const P = new Map(); for (const s of st) for (const p of [s.a, s.b]) P.set(pk(p), p);
  const edges = new Map();
  for (const s of st) { const cuts = [s.a, s.b, ...[...P.values()].filter((p) => onSeg(p, s))].sort((u, v) => Math.hypot(u[0] - s.a[0], u[1] - s.a[1]) - Math.hypot(v[0] - s.a[0], v[1] - s.a[1])); for (let i = 1; i < cuts.length; i++) { const u = pk(cuts[i - 1]), v = pk(cuts[i]); if (u !== v) edges.set([u, v].sort().join('|'), [cuts[i - 1], cuts[i]]); } }
  const deg = new Map(); for (const k of edges.keys()) for (const n of k.split('|')) deg.set(n, (deg.get(n) || 0) + 1);
  const junc = new Set([...deg].filter(([k, c]) => c >= 3 && Math.hypot(...k.split(',').map(Number)) > 0.5).map(([k]) => k));
  const spacing = []; for (const [k, [u, v]] of edges) { const [a, b] = k.split('|'); if (junc.has(a) && junc.has(b)) spacing.push(+Math.hypot(u[0] - v[0], u[1] - v[1]).toFixed(1)); }
  spacing.sort((a, b) => a - b);
  const blocks = [...edges.values()].map(([u, v]) => Math.hypot(u[0] - v[0], u[1] - v[1])).filter((l) => l > 60);
  console.log(JSON.stringify({ junctions: junc.size, minSpacing: spacing[0] ?? null, spacingList: spacing.slice(0, 6), blocksOver60: blocks.length }));
  const roles = {}; for (const s of segs) roles[s.role] = (roles[s.role] || 0) + 1;
  console.log(JSON.stringify({ segments: segs.length, long: long.length, roles, offAxis: off.length, junctionPairs: pairs, junctionPairsOutside75to105: bad }));
  process.exitCode = bad === 0 && off.length <= 2 ? 0 : 1;
} finally { await g.close(); }
