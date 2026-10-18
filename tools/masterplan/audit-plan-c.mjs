// Norm check of the masterplan C (docs/MASTERPLAN_C_PLAN.md, docs/ROAD_STANDARDS_V161.md).  node tools/masterplan/audit-plan-c.mjs [--json]
// Game metres; 1 game m = 2.5 real m. Exit code 1 if any HARD check fails.
import { buildPlan, CLS } from './plan-c.mjs';

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

if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else {
  console.log(`Masterplan C audit: ${P.counts.junctions} junctions (${P.counts.signals} signals, ${P.counts.roundabouts} roundabouts), ${P.counts.interchanges} interchanges, ${P.counts.blocks} blocks`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : r.hard ? 'FAIL' : 'WARN'}  ${r.name}\n      ${r.detail}`);
  const fails = results.filter((r) => !r.ok && r.hard).length;
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exitCode = fails ? 1 : 0;
}
