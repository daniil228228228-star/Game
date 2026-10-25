// Norm check of the masterplan C (docs/MASTERPLAN_C_PLAN.md, docs/ROAD_STANDARDS_V161.md).  node tools/masterplan/audit-plan-c.mjs [--json]
// Game metres; 1 game m = 2.5 real m. Exit code 1 if any HARD check fails.
import { buildPlan, CLS, kerbReturnR } from './plan-c.mjs';
import { matrix, ARMS, buildTurnGraph } from './turns-plan-c.mjs';
import { loadData, runRealWorld, accessRows } from './real-world-checks.mjs';
import { runMarkings } from './markings-checks.mjs';

const P = buildPlan();
const N = new Map(P.nodes.map((n) => [n.id, n])), E = P.edges;
const results = [];
const check = (name, ok, detail, hard = true) => results.push({ name, ok, detail, hard });
const R1 = (v) => Math.round(v * 10) / 10;
const inner = (x, z) => Math.abs(x) <= 160 && Math.abs(z) <= 160;
const urbanBox = (x, z) => x >= -282 && x <= 202 && z >= -162 && z <= 190;
const ramps = P.interchanges.flatMap((ic) => ic.ramps.map((r, i) => ({ ...r, ic: ic.id, id: `${ic.id}.${i}` })));

// 1. signal spacing along each street line
{
  const sig = P.junctions.filter((j) => j.type === 'signal'), bad = [], seen = [], accepted = [];
  for (const axis of [0, 1]) {
    const groups = new Map();
    for (const j of sig) { const k = j.at[1 - axis]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); }
    for (const [k, list] of groups) {
      list.sort((a, b) => a.at[axis] - b.at[axis]);
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i], b = list[i + 1], d = b.at[axis] - a.at[axis];
        // the two signals must sit on one continuous street (same line, no gap)
        const between = E.filter((e) => e.cls !== 'motorway' && e.dir === (axis === 0 ? 'x' : 'z') && [N.get(e.a), N.get(e.b)].every((n) => (axis === 0 ? n.z : n.x) === k && (axis === 0 ? n.x : n.z) >= a.at[axis] && (axis === 0 ? n.x : n.z) <= b.at[axis]));
        if (!between.length) continue;
        const terms = (a.terminal ? 1 : 0) + (b.terminal ? 1 : 0), cls = between[0].cls;
        const min = terms === 2 ? 36 : terms === 1 ? 50 : inner(a.at[0], a.at[1]) && inner(b.at[0], b.at[1]) ? 80 : 160;
        seen.push(d);
        if (d <= 14 && a.terminal && b.terminal) { accepted.push(`${a.at}->${b.at} ${d} offset-T pair of one diamond terminal group`); continue; }   // two T-junctions 12 m apart operated as ONE signal group (the ramps never cross the avenue)
        if (d < min && (a.big || b.big)) { accepted.push(`${a.at}->${b.at} ${d} < ${min}`); continue; }   // I2 is at grade by the owner's decision (2026-10-18): a documented deviation, listed in the detail
        if (d < min) bad.push(`${a.at}->${b.at} ${d} < ${min} (${cls}${terms ? ', ramp terminal' : ''})`);
      }
    }
  }
  check('signal spacing (downtown >= 80, outside >= 160, ramp terminals >= 36, terminal-to-signal >= 50)', !bad.length, (bad.length ? bad.join('; ') : `${seen.length} pairs, min ${Math.min(...seen)} m`) + (accepted.length ? ` | accepted: offset-T pairs of the I1 diamond (one signal group each) and I2 (owner-mandated at-grade crossing): ${accepted.join(', ')}` : ''));
}
// 2. block length
{
  const URBAN = ['residential', 'mixed', 'cbd', 'villas', 'east', 'waterfront', 'station', 'busterm', 'school', 'hospital', 'market'];
  const bad = P.blocks.filter((b) => URBAN.includes(b.zone) && Math.max(b.rect[2] - b.rect[0], b.rect[3] - b.rect[1]) > 60);
  const max = Math.max(...P.blocks.filter((b) => URBAN.includes(b.zone)).map((b) => Math.max(b.rect[2] - b.rect[0], b.rect[3] - b.rect[1])));
  check('urban block length <= 60 (150 m real)', !bad.length, bad.length ? bad.map((b) => `${b.id} ${b.zone} ${b.rect}`).join('; ') : `longest urban block side ${max} m; exempt: stadium, campus, park, industry, logistics, railyard`);
}
// 3. junction angles
{
  const bad = [];
  for (const j of P.junctions) { if (j.type === 'roundabout') continue; for (const a of j.arms) for (const b of j.arms) { const ang = Math.abs(Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0])) * 180 / Math.PI % 90; if (Math.min(ang, 90 - ang) > 15) bad.push(j.at.join(',')); } }
  check('junction angles 90 deg (+-15)', !bad.length, bad.length ? [...new Set(bad)].join('; ') : `${P.junctions.length} junctions, all arms on the 90-degree grid`);
}
// 4. interchange terminals
{
  const d = P.interchanges.filter((i) => i.kind === 'diamond').map((i) => ({ id: i.id, s: Math.hypot(i.terminals[0][0] - i.terminals[1][0], i.terminals[0][1] - i.terminals[1][1]) }));
  check('diamond ramp terminal spacing >= 36 (90 m real)', d.every((x) => x.s >= 36), d.map((x) => `${x.id} ${x.s} m`).join(', '));
}
// 5. bus stops
{
  const bad = [], info = [];
  for (const l of P.transit.lines) {
    const st = l.stops, ring = l.pts.length > 2 && l.pts[0][0] === l.pts[l.pts.length - 1][0] && l.pts[0][1] === l.pts[l.pts.length - 1][1];
    // distance along the route: project each stop onto the route polyline
    const along = (p) => { let s = 0, best = Infinity, at = 0; for (let i = 0; i + 1 < l.pts.length; i++) { const a = l.pts[i], b = l.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L || 1))), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best) { best = d; at = s + t * L; } s += L; } return at; };
    const pos = st.map(along).sort((a, b) => a - b), total = l.pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - l.pts[i - 1][0], p[1] - l.pts[i - 1][1]) : 0, 0);
    const gaps = pos.slice(1).map((p, i) => p - pos[i]); if (ring) gaps.push(total - pos[pos.length - 1] + pos[0]);
    gaps.forEach((g, i) => { const terminus = !ring && i === gaps.length - 1; if (g > 125 || g < (terminus ? 40 : 60)) bad.push(`${l.id} gap ${R1(g)}`); });
    info.push(`${l.id}: ${st.length} stops, gaps ${R1(Math.min(...gaps))}-${R1(Math.max(...gaps))}`);
    if (st.some((p) => E.some((e) => e.cls === 'motorway' && Math.abs((e.dir === 'x' ? N.get(e.a).z : N.get(e.a).x) - (e.dir === 'x' ? p[1] : p[0])) < 8))) bad.push(`${l.id}: a stop on a motorway`);
  }
  check('bus stop spacing 60-125 game m (150-300 m real), never on a motorway', !bad.length, (bad.length ? bad.join('; ') + ' | ' : '') + info.join('; '));
}
// 6. pedestrian crossing coverage on urban arterials / collectors
{
  const pts = []; // [x, z] of every way to cross
  for (const j of P.junctions) if (['signal', 'roundabout', 'mini'].includes(j.type)) pts.push(j.at);
  for (const c of P.crossings) pts.push(c.at);
  for (const f of [...P.footbridges, ...P.tunnels]) pts.push(f.at);
  const bad = []; let worst = 0;
  const lines = [...P.lines.V.map((l) => ({ ...l, vert: true, c: l.x })), ...P.lines.H.map((l) => ({ ...l, vert: false, c: l.z }))].filter((l) => l.cls === 'arterial' || l.cls === 'collector');
  for (const l of lines) for (const [a, b] of l.spans) {
    const on = pts.filter((p) => Math.abs((l.vert ? p[0] : p[1]) - l.c) < 1).map((p) => (l.vert ? p[1] : p[0])).filter((t) => t >= a - 1 && t <= b + 1).sort((p, q) => p - q);
    for (let t = a; t <= b; t += 2) {
      const x = l.vert ? l.c : t, z = l.vert ? t : l.c; if (!urbanBox(x, z)) continue;
      const near = Math.min(...on.map((o) => Math.abs(o - t)), Infinity); worst = Math.max(worst, near);
      if (near > 80) { bad.push(`${l.name || l.cls} at ${x},${z}: ${near === Infinity ? 'none' : R1(near)}`); t += 40; }
    }
  }
  check('crossing coverage: every point of an urban arterial / collector <= 80 game m (200 m real) from a crossing', !bad.length, bad.length ? bad.join('; ') : `worst distance ${R1(worst)} m`);
}
// 7. dead ends
{
  const ringAt = (p) => P.junctions.find((j) => j.type === 'roundabout' && Math.hypot(p[0] - j.at[0], p[1] - j.at[1]) <= (j.R || 11) + 1.0);   // dumbbell ramps end on their ring
  const attach = (p, tol = 0.8) => E.find((e) => { const a = N.get(e.a), b = N.get(e.b), dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.z) * dz) / (L * L))), q = [a.x + dx * t, a.z + dz * t]; return Math.hypot(q[0] - p[0], q[1] - p[1]) <= CLS[e.cls].w / 2 + tol; });
  const attach0 = attach, attachR = (p, tol) => attach0(p, tol) || (ringAt(p) ? { a: ringAt(p).id, cls: 'ring' } : undefined);
  const bad = [];
  for (const n of P.nodes.filter((x) => x.legs === 1)) {
    if (P.exits.includes(n.id)) continue;
    const e = E.find((x) => x.a === n.id || x.b === n.id);
    if (e && e.lot) continue;
    if (ramps.some((r) => [r.pts[0], r.pts[r.pts.length - 1]].some((p) => Math.hypot(p[0] - n.x, p[1] - n.z) < 8))) continue;
    bad.push(`${n.x},${n.z}`);
  }
  const onRamp = (p, self) => ramps.some((o) => o !== self && o.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2));   // a slip lane branches off / joins a ramp
  const loose = []; for (const r of ramps) for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) if (!attachR(p) && !onRamp(p, r)) loose.push(`${r.id} end ${p}`);
  check('no road ends nowhere (dead ends only at map exits / parking lots; every ramp end lies on a carriageway)', !bad.length && !loose.length, [...bad, ...loose].join('; ') || `${P.exits.length} map exits, ${ramps.length * 2} ramp ends attached`);
  // 8. reachability: graph of streets + ramps
  const parent = new Map(P.nodes.map((x) => [x.id, x.id])), find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; }, uni = (a, b) => parent.set(find(a), find(b));
  for (const e of E) uni(e.a, e.b);
  for (const r of ramps) { const a = attachR(r.pts[0]), b = attachR(r.pts[r.pts.length - 1]); if (a && b) uni(a.a, b.a); }
  const roots = new Set(P.nodes.map((x) => find(x.id)));
  const main = find(E.find((e) => e.name === 'Главный пр.').a);
  const unreached = P.blocks.filter((b) => !E.some((e) => { if (find(e.a) !== main) return false; const a = N.get(e.a), c = N.get(e.b), [x0, z0, x1, z1] = b.rect; const onX = e.dir === 'x' && (a.z === z0 || a.z === z1) && Math.min(a.x, c.x) < x1 && Math.max(a.x, c.x) > x0, onZ = e.dir === 'z' && (a.x === x0 || a.x === x1) && Math.min(a.z, c.z) < z1 && Math.max(a.z, c.z) > z0; return onX || onZ; }));
  check('one connected network, every block fronts a street of it', roots.size === 1 && !unreached.length, `${roots.size} component(s); ${unreached.length ? 'unreached: ' + unreached.map((b) => b.id + ' ' + b.zone).join(', ') : 'all ' + P.blocks.length + ' blocks reachable'}`);
}
// 9. ramps: heading at the attach points, curvature, at-grade conflicts
{
  const head = (pts, end) => { const [a, b] = end ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[0], pts[1]]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const bad = [], radii = [];
  for (const r of ramps) {
    for (const end of [false, true]) {
      const p = end ? r.pts[r.pts.length - 1] : r.pts[0], h = head(r.pts, end) * 180 / Math.PI;
      const e = E.filter((x) => { const a = N.get(x.a), b = N.get(x.b), dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), t = ((p[0] - a.x) * dx + (p[1] - a.z) * dz) / (L * L); if (t < -0.01 || t > 1.01) return false; const q = [a.x + dx * t, a.z + dz * t]; return Math.hypot(q[0] - p[0], q[1] - p[1]) <= CLS[x.cls].w / 2 + 0.8; })[0];
      if (!e) continue;
      const roadAng = e.dir === 'x' ? 0 : 90, diff = Math.abs(((h - roadAng) % 180 + 180) % 180), off = Math.min(diff, 180 - diff);
      const want = e.cls === 'motorway' || (r.ic === 'I4' && e.cls === 'arterial') || r.kind.startsWith('slip') || (r.ic === 'I1' && (r.kind === 'loop' || r.kind === 'outer')) ? 0 : 90;   // cloverleaf ramps merge into the avenue parallel (like the slips)   // merges run parallel; diamond terminals meet the crossing road square-on
      if (Math.abs(off - want) > 12) bad.push(`${r.id} ${end ? 'end' : 'start'} meets ${e.cls} at ${R1(off)} deg (want ${want})`);
    }
    for (let i = 1; i + 1 < r.pts.length; i++) { const [a, b, c] = [r.pts[i - 1], r.pts[i], r.pts[i + 1]], ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]), cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); if (cr > 1e-6 && ab > 0.5 && bc > 0.5) radii.push({ r: ab * bc * ac / (2 * cr), id: r.id }); }
  }
  const minR = radii.reduce((m, x) => (x.r < m.r ? x : m), { r: Infinity });
  check('ramps join motorways and slip lanes join the avenue parallel (+-12 deg); diamond terminals square-on', !bad.length, bad.join('; ') || `${ramps.length} ramps, ${ramps.length * 2} ends checked`);
  check('ramp curve radius >= 14 game m (35 m real, loop design speed ~40 km/h)', minR.r >= 14, `tightest ${R1(minR.r)} m on ${minR.id}`);
  // at-grade conflicts: a ramp may touch a road only where it attaches, and cross one only on a declared bridge
  const segX = (p1, p2, p3, p4) => { const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (Math.abs(d) < 1e-9) return null; const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d, u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null; };
  const bridged = (p) => ramps.some((r) => (r.bridges || []).some(([a, b]) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (L * L), q = [a[0] + dx * t, a[1] + dz * t]; return t >= -0.05 && t <= 1.05 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 3; }));
  const conflicts = [];
  for (const r of ramps) for (let i = 0; i + 1 < r.pts.length; i++) {
    const p1 = r.pts[i], p2 = r.pts[i + 1], nearEnd = (p) => [r.pts[0], r.pts[r.pts.length - 1]].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 30);
    for (const e of E) { const a = N.get(e.a), b = N.get(e.b), x = segX(p1, p2, [a.x, a.z], [b.x, b.z]); if (x && !nearEnd(x) && !bridged(x)) conflicts.push(`${r.id} x ${e.name || e.cls} at ${x.map(R1)}`); }
    for (const o of ramps) if (o !== r) for (let k = 0; k + 1 < o.pts.length; k++) { const q1 = o.pts[k], q2 = o.pts[k + 1], ang = Math.abs(Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) - Math.atan2(q2[1] - q1[1], q2[0] - q1[0])) % (2 * Math.PI); if (Math.min(ang, 2 * Math.PI - ang) < 0.14) continue;   // a shared lane / tangent split, not a crossing
      const x = segX(p1, p2, q1, q2); if (x && !nearEnd(x) && ![o.pts[0], o.pts[o.pts.length - 1]].some((q) => Math.hypot(q[0] - x[0], q[1] - x[1]) < 2) && !bridged(x)) conflicts.push(`${r.id} x ${o.id} at ${x.map(R1)}`); }
  }
  check('ramps cross other roads only on bridges', !conflicts.length, conflicts.length ? [...new Set(conflicts)].slice(0, 8).join('; ') : 'no at-grade conflict');
}
// 10. water and rail
{
  const pip = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) c = !c; } return c; };
  const river = [...P.water.river.banks.left, ...P.water.river.banks.right.slice().reverse()], sea = [...P.water.sea.coast, [420, 420], [-420, 420]];
  const wet = [];
  for (const b of P.blocks) { const [x0, z0, x1, z1] = b.lot; for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) if (pip([x, z], river) || pip([x, z], sea)) { wet.push(b.id); x = x1 + 1; break; } }
  const roadWet = E.filter((e) => !e.bridge && e.cls !== 'motorway').filter((e) => { const a = N.get(e.a), b = N.get(e.b); for (let t = 0; t <= 1; t += 0.05) { const p = [a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]; if (pip(p, river) || pip(p, sea)) return true; } return false; });
  check('no block or street in the water (outside bridges)', !wet.length && !roadWet.length, wet.length || roadWet.length ? `blocks ${wet.join(',')} streets ${roadWet.map((e) => e.id).join(',')}` : `${P.blocks.length} blocks and ${E.length} street edges dry`);
  check('no level crossings on the rail line', !(P.rail.spur.levelCrossings || []).length, `${P.grade.filter((g) => g.kind === 'underpass').length} road underpasses, ${(P.rail.spur.roadBridges || []).length} road bridge over the spur`);
}
// 11. motorway access only by interchanges (no junctions, signals or stops on M1 / M2)
{
  const bad = P.junctions.filter((j) => j.classes.includes('motorway') && !j.big), atGrade = P.junctions.filter((j) => j.classes.includes('motorway') && j.big);
  check('motorways have no at-grade junctions or signals (except I2, the owner-mandated crossing)', !bad.length, bad.length ? bad.map((j) => j.at).join('; ') : `${P.interchanges.length} interchanges (${P.interchanges.map((i) => i.kind).join(', ')}); at-grade: ${atGrade.map((j) => j.at).join(' ')}`);
}

// 12. duplicates and redundant roads (2026-10-18): no two street edges on the same line overlap, no two ramps run on top of each other, no ramp lies on a street without joining it,
//     every edge / ramp has an endpoint that leads somewhere (a graph node of degree >= 2, another ramp, a ring, a parking lot, or a map exit)
{
  const dup = [];
  // (a) collinear edges of the same axis that overlap by more than a node point
  for (let i = 0; i < E.length; i++) for (let k = i + 1; k < E.length; k++) {
    const a = E[i], b = E[k]; if (a.dir !== b.dir) continue;
    const A = [N.get(a.a), N.get(a.b)], B = [N.get(b.a), N.get(b.b)], ax = a.dir === 'x' ? 0 : 1, lat = (q) => q[1 - ax === 0 ? 'x' : 'z'];
    const la = A[0][a.dir === 'x' ? 'z' : 'x'], lb = B[0][b.dir === 'x' ? 'z' : 'x'];
    if (Math.abs(la - lb) > 1.5) continue;
    const a0 = Math.min(A[0][ax ? 'z' : 'x'], A[1][ax ? 'z' : 'x']), a1 = Math.max(A[0][ax ? 'z' : 'x'], A[1][ax ? 'z' : 'x']), b0 = Math.min(B[0][ax ? 'z' : 'x'], B[1][ax ? 'z' : 'x']), b1 = Math.max(B[0][ax ? 'z' : 'x'], B[1][ax ? 'z' : 'x']);
    if (Math.min(a1, b1) - Math.max(a0, b0) > 0.5) dup.push(`edges ${a.id}/${b.id} (${a.name || a.cls} / ${b.name || b.cls}) overlap on ${a.dir} ${la.toFixed(1)}..`);
    void lat;
  }
  // (b) two ramps on top of each other: more than 25 % of the points of one lie within 2.4 m of the other
  const samp = (r) => { const out = []; for (let i = 1; i < r.pts.length; i++) { const p = r.pts[i - 1], q = r.pts[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2)); for (let t = 0; t < n; t++) out.push([p[0] + (q[0] - p[0]) * t / n, p[1] + (q[1] - p[1]) * t / n]); } return out; };
  const dseg = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0; return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t); };
  const dpoly = (p, r) => { let m = 1e9; for (let i = 1; i < r.pts.length; i++) m = Math.min(m, dseg(p, r.pts[i - 1], r.pts[i])); return m; };
  for (let i = 0; i < ramps.length; i++) for (let k = i + 1; k < ramps.length; k++) {
    const a = ramps[i], b = ramps[k], sa = samp(a), near = sa.filter((p) => dpoly(p, b) < 2.4).length;
    // ramps are meant to share their first / last metres (a slip leaves its ramp); more than a quarter is a duplicate
    if (near / sa.length > 0.25) dup.push(`ramps ${a.id}/${b.id} (${a.kind}/${b.kind}) share ${Math.round(100 * near / sa.length)} % of their length`);
  }
  // (c) a ramp running along a street edge closer than 2.4 m for > 12 m without being attached to it
  for (const r of ramps) for (const e of E) {
    if (e.cls === 'motorway') continue;
    const a = N.get(e.a), b = N.get(e.b); let near = 0; for (const p of samp(r)) if (dseg(p, [a.x, a.z], [b.x, b.z]) < CLS[e.cls].w / 2 + 0.3) near += 2;
    if (near > 14 && !(r.attach || []).includes('cross')) dup.push(`ramp ${r.id} lies on street ${e.id} (${e.name || e.cls}) for ${near} m but is not attached to a cross street`);
  }
  // (d) ramps never leave the same motorway lane twice: two ramps starting within 3 m of each other
  for (let i = 0; i < ramps.length; i++) for (let k = i + 1; k < ramps.length; k++) for (const pi of [0, ramps[i].pts.length - 1]) for (const pk of [0, ramps[k].pts.length - 1]) {
    const A0 = ramps[i].pts[pi], B0 = ramps[k].pts[pk];
    if (Math.hypot(A0[0] - B0[0], A0[1] - B0[1]) < 3 && ramps[i].kind === ramps[k].kind && ramps[i].ic === ramps[k].ic && pi === pk) dup.push(`ramps ${ramps[i].id}/${ramps[k].id} of the same kind start / end at the same point ${A0}`);
  }
  check('no duplicate roads: no overlapping street edges, no ramp on top of another or on a street, no coincident ramp ends', !dup.length, dup.length ? dup.join('; ') : `${E.length} edges and ${ramps.length} ramps pairwise checked`);
}

// 13. lane drops: a street that changes width at a node with only two legs (not a junction) must taper: the compiler tapers the wider side over 20 x the one-sided offset
//     (1:20, the urban minimum is 1:15); this check lists every such place, its offset, the taper length and whether the edge is long enough to hold it.
{
  const bad = [], info = [];
  for (const n of P.nodes) {
    if (n.legs !== 2) continue;
    const es = E.filter((e) => (e.a === n.id || e.b === n.id) && !e.split);
    if (es.length !== 2 || es[0].dir !== es[1].dir || CLS[es[0].cls].w === CLS[es[1].cls].w) continue;
    const [wide, narrow] = CLS[es[0].cls].w >= CLS[es[1].cls].w ? es : [es[1], es[0]], off = (CLS[wide.cls].w - CLS[narrow.cls].w) / 2, L = Math.round(20 * off);
    const a = N.get(wide.a), b = N.get(wide.b), len = Math.hypot(a.x - b.x, a.z - b.z);
    info.push(`${n.x},${n.z} ${wide.cls}->${narrow.cls} offset ${off.toFixed(1)} m, taper ${L} m (1:20)`);
    if (L / off < 15 || len < L + 12) bad.push(`${n.x},${n.z}: taper ${L} m does not fit the ${len} m edge or is steeper than 1:15`);
    if (CLS[wide.cls].median > 0 && L < 24) bad.push(`${n.x},${n.z}: median nose needs >= 24 m`);
  }
  check('lane drops taper at 1:20 (>= 1:15) and fit their edge; the median ends in a nose', !bad.length, bad.length ? bad.join('; ') : (info.join('; ') || 'no width change outside junctions'));
}

// 14. axis kinks (2026-10-19): a place where the axis of a road turns by more than 15 degrees in ONE vertex without a radius is a defect (right angles, sharp knees).
//     (a) street graph: every node with exactly two legs that are not collinear must be a BEND (plan.bends: circular arc, R >= 9 game m for urban local / collector, 14 for service / port, 16 for arterial);
//         the legs must be long enough for the tangent length R plus the clearance to the far node's junction (6 m); roundabouts with two legs are circles, not kinks.
//     (b) ramps / slip lanes / semi-direct curves: every vertex of the centre line deflects by <= 15 degrees (arcs and cubics are sampled finely).
//     Real junctions (3+ legs) are excluded: their corners are kerb returns.
{
  const bad = [], info = [], MINR = { service: 14, arterial: 16, collector: 10, local: 9, motorway: 80 }, bendOf = new Map((P.bends || []).map((b) => [b.node, b]));
  for (const n of P.nodes) {
    if (n.legs !== 2) continue;
    const es = E.filter((e) => (e.a === n.id || e.b === n.id) && !e.split);
    if (es.length !== 2 || es[0].dir === es[1].dir) continue;
    const j = P.junctions.find((q) => q.id === n.id);
    if (j && j.type === 'roundabout') { info.push(`${n.x},${n.z} roundabout (circle)`); continue; }
    const b = bendOf.get(n.id), need = Math.max(...es.map((e) => MINR[e.cls] || 0));
    if (!b) { bad.push(`${n.x},${n.z}: 90 degree corner of ${es.map((e) => e.cls).join('/')} without a radius`); continue; }
    const lens = es.map((e) => { const o = N.get(e.a === n.id ? e.b : e.a); return Math.hypot(o.x - n.x, o.z - n.z); });
    if (b.R < need) bad.push(`${n.x},${n.z}: bend R ${b.R} < ${need} for ${es.map((e) => e.cls).join('/')}`);
    if (lens.some((l) => l < b.R + 6)) bad.push(`${n.x},${n.z}: leg ${Math.min(...lens)} m shorter than R ${b.R} + 6`);
    info.push(`${n.x},${n.z} ${es.map((e) => e.cls).join('/')} R ${b.R}`);
  }
  const knees = [];
  for (const r of ramps) for (let i = 1; i + 1 < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i], c = r.pts[i + 1], t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1) * 180 / Math.PI; if (d > 180) d = 360 - d;
    if (d > 15) knees.push(`${r.id} at ${R1(b[0])},${R1(b[1])} ${Math.round(d)} deg`);
  }
  if (knees.length) bad.push(...knees);
  check('no axis kink > 15 degrees without a radius: every two-leg corner is a bend (R >= 9 / 10 / 14 / 16 by class, legs hold R + 6), ramp vertices turn <= 15 degrees', !bad.length, bad.length ? bad.join('; ') : `${info.length} bends / circles: ${info.join('; ')}; ${ramps.length} ramps without a kink`);
}

// 15. kerb-return radius (2026-10-19): at every street corner of a junction the kerb arc must meet the norm of the classes (a square corner or R 3 where lorries / buses turn is a defect).
//     Minimum radii in game m (real x2.5; AASHTO Green Book / NACTO): arterial x arterial 4 (10 m), arterial x other 3 (7.5 m), collector / local 3 (7.5 m urban, 30-40 km/h),
//     service / port roads with semi-trailers (WB-67, inside radius 12-15 m + taper): 5 (12.5 m), with an arterial 6 (15 m).  The compiler draws kerbReturnR(): it must reach the minimum AND fit both legs
//     (the two tangent lengths + the half width of the cross street <= the edge length).
{
  const bad = [], seen = [], MIN = (a, b) => (a === 'service' || b === 'service') ? ((a === 'arterial' || b === 'arterial') ? 6 : 5) : (a === 'arterial' && b === 'arterial') ? 4 : 3;
  const tang = new Map();   // edge id + node -> largest tangent length used along the edge at that node
  for (const j of P.junctions) {
    if (j.type === 'roundabout' || j.bend) continue;
    for (const A of j.arms.filter((a) => a.dir[1] === 0)) for (const B of j.arms.filter((b) => b.dir[0] === 0)) {
      if (A.cls === 'motorway' || B.cls === 'motorway') continue;
      const r = kerbReturnR(A.cls, B.cls), m = MIN(A.cls, B.cls);
      seen.push(`${A.cls}x${B.cls}:${r}`);
      if (r < m) bad.push(`${j.id} ${j.at}: ${A.cls} x ${B.cls} kerb return R ${r} < norm ${m}`);
      for (const [arm, other] of [[A, B], [B, A]]) { const k = arm.edge + '@' + j.id, v = r + CLS[other.cls].w / 2; tang.set(k, Math.max(tang.get(k) || 0, v)); }
    }
  }
  for (const e of E) { if (!P.junctions.some((q) => q.id === e.a) || !P.junctions.some((q) => q.id === e.b)) continue;   /* a stub to the map exit / a pass-through node: the street runs on (the tangent can reach across it) */
    const ta = tang.get(e.id + '@' + e.a) || 0, tb = tang.get(e.id + '@' + e.b) || 0, a = N.get(e.a), b = N.get(e.b), L = Math.hypot(a.x - b.x, a.z - b.z); if (ta + tb > L - 1) bad.push(`${e.id} (${e.cls}, ${L} m): corner tangents ${R1(ta)} + ${R1(tb)} do not fit`); }
  const cnt = {}; for (const k of seen) cnt[k.split(':')[0]] = k.split(':')[1];
  check('kerb-return radius meets the class norm at every street corner (arterial 4-5, collector / local 3, service / port 5-8) and fits both legs', !bad.length, bad.length ? bad.join('; ') : `${seen.length} corners; radii ${JSON.stringify(cnt)}`);
}

// 16. right-hand traffic (Russia; 2026-10-19).  Frame: x east, z south, so the RIGHT of a heading (hx, hz) is (-hz, hx); a right turn is a clockwise turn on the screen (increasing angle).
//     The point order of every ramp IS its direction of travel.  For EVERY end of EVERY ramp (exit = first point, entry = last point) the audit computes, from the real vectors,
//       host heading at the join (the ramp's own heading along the host axis), the side of the host's centre line the ramp lies on, and for ramps parallel to their host the divergence
//       (exit: the ramp must veer to the RIGHT of the host heading; entry: it must come in from the right, i.e. veer LEFT towards the host).  `--table` prints the whole table.
//     Also: loops turn clockwise (net > +180), outer slips / direct ramps turn right (net > 0), roundabouts and mini roundabouts circulate counter-clockwise (`circulation: 'ccw'`),
//     bus shelters stand on the right of their traffic (tests/plan-c-roads.test.mjs, drawn positions).  (First version, same day: only the offset side of the end point was checked;
//     it was right but did not show the table nor the divergence direction.)
{
  const bad = [], info = [], rows = [];
  const hostAt = (p, type) => {
    let best = null;
    for (const e of E) { if ((type === 'motorway') !== (e.cls === 'motorway')) continue; const a = N.get(e.a), b = N.get(e.b); let d, axis, c;
      if (e.dir === 'x') { if (p[0] < Math.min(a.x, b.x) - 1 || p[0] > Math.max(a.x, b.x) + 1) continue; d = Math.abs(p[1] - a.z); axis = 0; c = a.z; }
      else { if (p[1] < Math.min(a.z, b.z) - 1 || p[1] > Math.max(a.z, b.z) + 1) continue; d = Math.abs(p[0] - a.x); axis = 1; c = a.x; }
      if (!best || d < best.d) best = { d, axis, c, cls: e.cls }; }
    return best;
  };
  const DN = (h) => h[0] > 0 ? 'E' : h[0] < 0 ? 'W' : h[1] > 0 ? 'S' : 'N';
  for (const r of ramps) {
    const n = r.pts.length; let turn = 0;
    for (let i = 1; i + 1 < n; i++) { const a = r.pts[i - 1], b = r.pts[i], c = r.pts[i + 1]; let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn += d; }
    turn = turn * 180 / Math.PI;
    for (const end of [0, 1]) {
      const p = r.pts[end ? n - 1 : 0], q = r.pts[end ? n - 2 : 1], h = end ? [p[0] - q[0], p[1] - q[1]] : [q[0] - p[0], q[1] - p[1]], H = hostAt(p, r.attach[end]);
      if (!H) { bad.push(`${r.id}: no host at the ${end ? 'end' : 'start'}`); continue; }
      const hh = H.axis === 0 ? [Math.sign(h[0]) || 1, 0] : [0, Math.sign(h[1]) || 1], right = [-hh[1], hh[0]], lat = (H.axis === 0 ? p[1] - H.c : p[0] - H.c) * (H.axis === 0 ? right[1] : right[0]);
      // divergence over 7 m of ramp next to the join (parallel ramps only): cross(host heading, ramp heading): > 0 = the ramp heads to the right of the host
      let k = end ? n - 2 : 1, acc = 0; while (k > 0 && k < n - 1 && acc < 7) { const a = r.pts[k], b = r.pts[k + (end ? -1 : 1)]; acc += Math.hypot(a[0] - b[0], a[1] - b[1]); k += end ? -1 : 1; }
      const far = r.pts[Math.max(0, Math.min(n - 1, k))], v = end ? [p[0] - far[0], p[1] - far[1]] : [far[0] - p[0], far[1] - p[1]], vl = Math.hypot(v[0], v[1]) || 1, along = (v[0] * hh[0] + v[1] * hh[1]) / vl, cr = (hh[0] * v[1] - hh[1] * v[0]) / vl;
      const parallel = along > 0.8, div = end ? -cr : cr;   // exit: veer right (+); entry: coming in = veering left towards the host when seen forwards (cr < 0), so div = -cr > 0
      const okSide = lat > 0.5, okDiv = !parallel || div > -0.02;
      rows.push(`${r.id} ${r.kind.padEnd(11)} ${end ? 'ENTRY' : 'EXIT '} (${R1(p[0])},${R1(p[1])}) host ${H.cls} ${H.axis ? 'x' : 'z'}=${H.c} heading ${DN(hh)}  side ${lat > 0 ? 'RIGHT' : 'LEFT '} ${R1(lat)} m  ${parallel ? 'divergence ' + (div > 0.02 ? 'right-hand (ok)' : div > -0.02 ? 'straight' : 'LEFT-hand') : 'crossing'}  ${okSide && okDiv ? 'OK' : 'FAIL'}`);
      if (!okSide) bad.push(`${r.id}: ${end ? 'joins' : 'leaves'} its host on the LEFT (${R1(p[0])},${R1(p[1])}, lateral ${R1(lat)})`);
      if (!okDiv) bad.push(`${r.id}: ${end ? 'merges' : 'diverges'} to the LEFT of the host heading at (${R1(p[0])},${R1(p[1])})`);
    }
    if (r.kind === 'loop' && turn < 180) bad.push(`${r.id}: loop turns ${Math.round(turn)} degrees (must be clockwise, > +180)`);
    if ((r.kind === 'outer' || r.kind === 'direct') && turn < 0) bad.push(`${r.id}: ${r.kind} ramp turns left (${Math.round(turn)})`);
    info.push(`${r.id} ${r.kind} ${Math.round(turn)}`);
  }
  for (const j of P.junctions) if ((j.type === 'roundabout' || j.type === 'mini') && j.circulation !== 'ccw') bad.push(`${j.id} ${j.at}: ${j.type} does not circulate counter-clockwise`);
  if (process.argv.includes('--table')) console.log(rows.join('\n'));
  check('right-hand traffic: every ramp exit / entry is on the right of its host and diverges / merges on the right, loops clockwise, slips right, roundabouts counter-clockwise', !bad.length, bad.length ? bad.join('; ') : `${rows.length} ramp ends (${rows.filter((x) => x.endsWith('OK')).length} OK, node / host / side table: --table); ${P.junctions.filter((j) => j.circulation === 'ccw').length} roundabouts ccw`);
}

// 17. turning-movement matrix (2026-10-19, tools/masterplan/turns-plan-c.mjs; `--turns` prints every row): directed graph of the network with one-way ramps, right-hand lines and junction turns.
//     (a) every movement between two arms of a cloverleaf / trumpet exists INSIDE the interchange with at most one ramp (12 movements of I1 / I3, 6 of I4);
//     (b) every ordered pair of arms of I1 / I2 / I3 / I4 incl. the U-turn of each arm is connected in the whole network (<= 800 m); a road that ends in a dead end after an interchange must offer a turnaround
//         (the arm "Portovaya east after the merge" has to be able to reach M2 north within 300 m: the roundabout at the east end of the Port road);
//     (c) I2 (at grade, no turn pockets): all 12 turning movements pass the junction box.
{
  const bad = [], summary = [];
  for (const ic of Object.keys(ARMS)) {
    const rows = matrix(P, ic); let direct = 0, tot = 0, uturns = [];
    for (const r of rows) {
      if (r.uturn) { uturns.push(r.full == null ? `${r.from}: NONE` : `${r.from} ${r.full} m`); if (r.full == null || r.full > 800) bad.push(`${ic} ${r.from}: no U-turn within 800 m (${r.full})`); continue; }
      if (r.full == null || r.full > 800) { bad.push(`${ic} ${r.from} -> ${r.to}: no path (${r.full})`); continue; }
      if (/x\d+/.test(r.from + r.to)) continue;   // helper arm
      tot++;
      const ramps = (r.directVia.match(/\bI\d\.\d\b/g) || []).length;
      if (r.direct != null && ramps <= 1) direct++; else bad.push(`${ic} ${r.from} -> ${r.to}: no direct movement inside the interchange (${r.direct == null ? 'none' : r.directVia})`);
    }
    const hx = rows.find((r) => /x275/.test(r.from) && /север/.test(r.to));
    if (hx && (hx.full == null || hx.full > 300)) bad.push(`${ic}: from the Port road after the loop merge to M2 north ${hx.full == null ? 'no path' : hx.full + ' m'} (> 300)`);
    summary.push(`${ic}: ${direct}/${tot} direct, U-turns ${uturns.join(', ')}${hx ? ', after-merge -> M2 north ' + hx.full + ' m' : ''}`);
  }
  check('turning movements: every arm pair of I1 / I2 / I3 / I4 connected directly (<= 1 ramp) and by U-turn (<= 800 m), a turnaround after the trumpet', !bad.length, bad.length ? bad.join('; ') : summary.join(' | '));
}

// Parking is a round trip, not just an undirected connection to a lot.
{
  const G = buildTurnGraph(P), bad = [];
  const centre = P.nodes.find((n) => n.x === 0 && n.z === 0);
  const centreStates = E.filter((e) => e.a === centre.id || e.b === centre.id).flatMap((e) =>
    e.a === centre.id ? [`${e.id}|1@0`, `${e.id}|-1@end`] : [`${e.id}|1@end`, `${e.id}|-1@0`]);
  for (const e of E.filter((e) => e.lot)) {
    const end = [N.get(e.a), N.get(e.b)].find((n) => n.legs === 1);
    if (!end) continue;
    const arrive = `${e.id}|${e.b === end.id ? 1 : -1}@end`, depart = `${e.id}|${e.b === end.id ? -1 : 1}@0`;
    if (!G.dijkstra(G.full, arrive, depart)) bad.push(`${e.lot}: no turnaround`);
    if (!centreStates.some((v) => G.dijkstra(G.full, arrive, v))) bad.push(`${e.lot}: no return to centre`);
    if (!centreStates.some((v) => G.dijkstra(G.full, v, arrive))) bad.push(`${e.lot}: no arrival from centre`);
  }
  check('parking arrivals have a legal turnaround and return to the city', !bad.length, bad.join('; ') || 'all lot endpoints have directed arrival / return paths');
}

// Independent check on emitted graph transitions: do not certify a RIRO route using its own permissive graph.
{
  const G = buildTurnGraph(P), bad = []; let pairs = 0;
  for (const j of P.junctions.filter((j) => j.type === 'riro')) {
    const n = N.get(j.id), es = E.filter((e) => e.a === n.id || e.b === n.id), major = es.find((e) => e.cls === 'arterial');
    if (!major) { bad.push(`${j.id}: no major arterial`); continue; }
    for (const a of es) for (const b of es) {
      const na = N.get(a.a === n.id ? a.b : a.a), nb = N.get(b.a === n.id ? b.b : b.a);
      const ix = Math.sign(n.x - na.x), iz = Math.sign(n.z - na.z), ox = Math.sign(nb.x - n.x), oz = Math.sign(nb.z - n.z);
      const allowed = ix * oz - iz * ox === 1 || (ix * ox + iz * oz === 1 && a.dir === major.dir);
      const u = `${a.id}|${a.b === n.id ? 1 : -1}@end`, v = `${b.id}|${b.a === n.id ? 1 : -1}@0`;
      if (G.nodeEdges.some((e) => e.u === u && e.v === v) !== allowed) bad.push(`${j.id}: ${a.id}->${b.id}`);
      pairs++;
    }
  }
  check('RIRO graph forbids left turns, minor through crossings and U-turns; preserves legal movements', !bad.length, bad.join('; ') || `${pairs} ordered approach pairs checked independently`);
}


// 18-26. real-world audit of interchanges / flyovers / ramps / footbridges (2026-10-25, tools/masterplan/real-world-checks.mjs, docs/PLAN_C_REAL_WORLD_AUDIT.md): grades, vertical curves (AASHTO K), radii by design
//     speed, clearance, barriers, earth slopes, steps in the profile, ramp terminals, footbridge ramps <= 8 %, and (part 2) a walkable path from the ground to the top of EVERY deck.
//     `--rw` prints the whole table (markdown with --md).
const RW = (() => { const D = loadData(), a = runRealWorld(P, D), b = accessRows(D), m = runMarkings(P, D); const gaps = [
  { node: 'Знаки на развязках', item: 'дорожные знаки (указатели направлений 6.9.x, ограничение скорости 3.24, 5.x «автомагистраль») на М1 / М2 / съездах', value: 'нет (в сети только знаки 2.4 / 2.5 / 4.3 на стойках у перекрёстков)', norm: 'знаки на развязках и съездах', source: 'ГОСТ Р 52290-2004; ГОСТ Р 52289-2019', verdict: 'ДОПУЩЕНИЕ', note: 'не реализовано: нужен новый вид инстансов (бюджет + 1 вызов отрисовки), список в docs/PLAN_C_REAL_WORLD_AUDIT.md' },
  { node: 'Съезды', item: 'сигнальные столбики 1.? / ограждение носов (гор), парапет-«зубья» 1.16.x у носов I4 и I2', value: 'зубья 1.16 есть на носах I1; на I2 острова и носах I4 нет', norm: 'направляющая разметка 1.16.1-1.16.3 на носах разделителей', source: 'ГОСТ Р 51256-2018 (1.16)', verdict: 'ДОПУЩЕНИЕ', note: 'носы I2 / I4 не размечены шевронами' },
  { node: 'Велодорожки', item: 'велодорожки / разметка 1.23', value: 'в плане C велодорожек нет', norm: '-', source: 'СП 42.13330 п. 11.?', verdict: 'ДОПУЩЕНИЕ', note: 'не проектировались' },
]; return { D, rows: [...a.rows, ...b.rows, ...m.rows, ...gaps], access: b.info }; })();
{
  const groups = [
    ['18. longitudinal grades: M1 <= 5 %, ramps <= 7 %, footbridge ramps <= 8 % (AASHTO GB Tab. 8-1 / 10.9.6; SP 34.13330; SP 59.13330)', /продольный уклон|уклон пандуса/],
    ['19. vertical curves: crest / sag K of every ramp and of M1 meet the AASHTO minimum for the speed the radius allows (Tab. 3-34 / 3-36)', /вертикальн/],
    ['20. horizontal radius: R >= V^2 / (127 (e + f)) for the design speed (AASHTO eq. 3-8); loops >= 30 km/h', /радиус/],
    ['21. clearance under every deck >= 5.0 m real (2.0 game m) over roads / sidewalks; footbridge 2.1 game m', /габарит/],
    ['22. barriers: a continuous parapet on both sides of every deck / ramp from a drop of 0.6 m (GOST 33128; was 1.3 m)', /ограждение/],
    ['23. earth slopes no steeper than 1:1.5, walls no higher than the deck (SP 34.13330 / AASHTO GB 4)', /откосов|стенки/],
    ['24. no steps in the profile of one road; every ramp end is flush with the road it joins', /ступень|разность высот/],
    ['25. footbridges: width, ramp scheme, no ramp on a neighbouring street', /ширина прохода|схема пандусов/],
    ['27. stop line 1.12 on every signalised approach, zebra 1.14.1 on every approach, yield line 1.13 on every minor approach / ring entry (GOST R 51256-2018)', /стоп-линия|зебра|линия 1\.13/],
    ['28. lines 1.1 / 1.5 / 1.2.1 / 1.2.2 continuous along streets, M1 and ramps; bus stops marked 1.17; symmetric motorway edges', /разметка осевая|краевые линии|разметка 1\.17|кромки симметричны/],
    ['29. kerb along every street edge, sidewalk along every urban street (no gaps > 3 / 6 m)', /бордюр вдоль|тротуар вдоль/],
    ['30. lighting: no dark stretch > 24 m on streets, ramps, decks, the city part of M1 / M2; no pole on the carriageway (SP 52.13330)', /освещение|опора не стоит/],
    ['26. every ribbon (deck, ramp, footbridge) can be climbed ON FOOT from the ground and left again (graph over the real access / surfaceY of the game, 0.5 m steps)', /проход пешком/],
  ];
  for (const [name, re] of groups) {
    const rows = RW.rows.filter((r) => re.test(r.item)), bad = rows.filter((r) => r.verdict === 'НАРУШЕНИЕ');
    check(name, rows.length > 0 && !bad.length, bad.length ? bad.map((r) => `${r.node}: ${r.value}`).join('; ') : `${rows.length} rows OK`);
  }
  const dev = RW.rows.filter((r) => r.verdict === 'ДОПУЩЕНИЕ');
  check('documented deviations (not hard): compact cloverleaf terminals / weaving (docs/PLAN_C_REAL_WORLD_AUDIT.md)', dev.length === 0, `${dev.length} rows: terminal taper of the loops 1:6..1:9 real instead of 1:15, weave 37 m on both M1 sides, one-lane ramps without an auxiliary lane`, false);
  if (process.argv.includes('--rw')) {
    const md = process.argv.includes('--md');
    if (md) { console.log('| Узел / съезд | Параметр | Значение | Норма | Источник | Вердикт | Комментарий |\n|---|---|---|---|---|---|---|'); for (const r of RW.rows) console.log(`| ${r.node} | ${r.item} | ${r.value} | ${r.norm} | ${r.source} | ${r.verdict} | ${r.note || ''} |`); }
    else for (const r of RW.rows) console.log(`${r.verdict.padEnd(10)} ${r.node.padEnd(26)} ${r.item.slice(0, 80).padEnd(80)} ${r.value} | ${r.norm}`);
  }
}

if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else {
  console.log(`Masterplan C audit: ${P.counts.junctions} junctions (${P.counts.signals} signals, ${P.counts.roundabouts} roundabouts), ${P.counts.interchanges} interchanges, ${P.counts.blocks} blocks`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : r.hard ? 'FAIL' : 'WARN'}  ${r.name}\n      ${r.detail}`);
  const fails = results.filter((r) => !r.ok && r.hard).length;
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
}
// Machine-readable mode must fail CI too, not just print a red item with exit code zero.
process.exitCode = results.some((r) => !r.ok && r.hard) ? 1 : 0;
