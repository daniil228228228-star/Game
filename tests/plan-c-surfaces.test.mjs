// Plan C surfaces (2026-10-19 (15)), NO browser: z-fighting layers, solid fill under decks / banks, continuous road profile, retaining walls and grass banks, closed wall ends.
// The data is read from assets/plan-c-data-v161.js; the probes are tools/probe-coplanar-plan-c.mjs and tools/probe-profile-plan-c.mjs (they print the details when a rule fails).
//   node tests/plan-c-surfaces.test.mjs
import fs from 'node:fs';
import { loadData, surfaces, scan } from '../tools/probe-coplanar-plan-c.mjs';
import { buildTop } from '../tools/probe-profile-plan-c.mjs';

const D = loadData(), P = D.palette, names = Object.keys(P);
const hex = D.colors.map((h) => typeof h === 'string' ? parseInt(h.replace('#', ''), 16) : h);
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok: ' : 'FAIL: ') + msg); if (!ok) failed++; };

// ---- 1. z-fighting: two different-coloured up-facing surfaces of the road family (r / p / d layers, paint included) must not overlap at less than 12 mm for any real area
{
  const T = surfaces(D), r = scan(T, { tol: 0.012, colours: names, hex });
  const bad = r.places.filter((p) => /[rpd]:/.test(p.k) && p.n >= 6);
  check(bad.length === 0, `no coplanar road-family layers closer than 12 mm (${T.length} triangles; ${bad.length} places: ${bad.slice(0, 4).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)}) ${p.k} x${p.n}`).join('; ')})`);
  // the road family also lies over the lots: paint / yard lines / parking over the ground zones
  const bad2 = r.places.filter((p) => /p:white/.test(p.k) && /g:(parking|indus|industry)/.test(p.k) && p.n >= 6);
  check(bad2.length === 0, `lot markings are clear of their lots by >= 12 mm (${bad2.length})`);
}

// ---- 2. the road profile is continuous: the top asphalt under every ribbon axis (and 30 % of the width to both sides) equals the ribbon's own profile (no step, no hole)
{
  const asph = new Set([P.asph, P.ramp]), top = buildTop(D, asph), bad = []; let n = 0;
  for (const rb of D.struct.ribbons) {
    if (/^FB/.test(rb.id)) continue;   // footbridges are concrete, not asphalt
    const pts = rb.p;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 0.5)), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      for (let j = 0; j < k; j++) for (const off of [0, -rb.w * 0.3, rb.w * 0.3]) {
        const t = j / k, x = a[0] + (b[0] - a[0]) * t - dz * off, z = a[1] + (b[1] - a[1]) * t + dx * off, hy = a[2] + (b[2] - a[2]) * t + 0.05, y = top(x, z, hy + 1.5); n++;
        if (y === null || Math.abs(y - hy) > 0.03) bad.push([rb.id, +x.toFixed(1), +z.toFixed(1), y === null ? null : +y.toFixed(3), +hy.toFixed(3)]);
      }
    }
  }
  check(bad.length === 0, `road profile: the drawn asphalt follows every ribbon within 3 cm (${n} samples, bad ${bad.length}: ${JSON.stringify(bad.slice(0, 3))})`);
  // and along the axis no jump bigger than the slope allows (6.85 % + 3 cm per 0.5 m)
  let jumps = 0, worst = 0;
  for (const rb of D.struct.ribbons) for (let i = 0; i + 1 < rb.p.length; i++) { const a = rb.p[i], b = rb.p[i + 1], run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, g = Math.abs(b[2] - a[2]) / run; if (g > worst) worst = g; if (g > 0.0685 + 0.003 && !/^FB/.test(rb.id)) jumps++; }
  check(jumps === 0, `ribbon grade <= 6.85 % on every segment (worst ${(worst * 100).toFixed(2)} %, over ${jumps})`);

  // A ramp can match its OWN axis perfectly while its merge wedge protrudes
  // above a neighbouring STREET lane. Check every actual directed route, not
  // only the ramp axes. Ignore genuinely separated overpasses above 0.8 m.
  const routeBad=[],joinBad=[],vertices=new Map(D.graph.navigation.vertices.map(([id,...p])=>[id,p]));let routeSamples=0;
  for(const arc of D.graph.navigation.arcs){
    for(const [id,p]of [[arc.u,arc.p[0]],[arc.v,arc.p.at(-1)]]){
      const q=vertices.get(id);
      if(!q||Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])>.003)joinBad.push([arc.id,id,p,q]);
    }
    for(const p of arc.p){
      const y=top(p[0],p[1],p[2]+.8);routeSamples++;
      if(y===null||Math.abs(y-p[2]-.05)>.03)routeBad.push([arc.id,arc.road,p,y]);
    }
  }
  check(joinBad.length===0,`directed route joins preserve position and height (${D.graph.navigation.arcs.length} arcs, bad ${joinBad.length}: ${JSON.stringify(joinBad.slice(0,3))})`);
  check(routeBad.length===0,`drawn pavement matches ALL route samples within 3 cm (${routeSamples} samples, bad ${routeBad.length}: ${JSON.stringify(routeBad.slice(0,3))})`);
}

// ---- 3. solid fill: under a deck / ramp higher than 0.6 m the ground is NOT walkable unless another road passes underneath (a bridge); the grass banks are solid down to 0.35 m
{
  const asph = new Set([P.asph, P.ramp]), top = buildTop(D, asph), bad = []; let n = 0;
  for (const [ic, kind, pts] of D.graph.ramps) for (let i = 0; i < pts.length; i++) {
    const [x, z, h] = pts[i]; if (h < 0.6) continue; n++;
    let under = false;
    for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, 3], [3, -3], [-3, -3]]) { const y = top(x + dx, z + dz, 0.4); if (y !== null) { under = true; break; } }
    if (!under && D.ground(x, z)) bad.push([ic + '.' + kind, +x.toFixed(1), +z.toFixed(1), +h.toFixed(2)]);
  }
  check(bad.length === 0, `ground under ramp axes higher than 0.6 m is solid fill unless a road passes underneath (${n} samples, bad ${bad.length}: ${JSON.stringify(bad.slice(0, 3))})`);
  check(D.struct.fills.length > 400 && D.struct.fills.every((q) => q.length === 8 && q.every(Number.isFinite)), `${D.struct.fills.length} fill quads, finite`);
  // the walker's height decides: at fill points whose only surface is a deck higher than a step (0.8 m) a ground walker (hint 0) is refused, a walker on the deck (hint = its height) and the
  // hint-less query (teleport, minimap) are accepted - so the strip under a ramp cannot be entered from the side and the player can never be lifted onto a deck from below
  let high = 0, refused = 0, onDeck = 0, noHint = 0;
  for (const q of D.struct.fills.filter((_, i) => i % 5 === 0)) {
    const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cz = (q[1] + q[3] + q[5] + q[7]) / 4, s = D.surfaces(cx, cz);
    if (!D.inFill(cx, cz) || !s.length || Math.min(...s) <= 0.8 || !D.access(cx, cz, 0.45)) continue;
    high++; if (!D.access(cx, cz, 0.45, 0)) refused++; if (D.access(cx, cz, 0.45, Math.min(...s))) onDeck++; if (D.access(cx, cz, 0.45)) noHint++;
  }
  check(high > 20 && refused === high && onDeck === high && noHint === high, `access(x, z, margin, hint): ${high} deck-only fill points refused at ground level (${refused}), accepted on the deck (${onDeck}) and without a hint (${noHint})`);
}

// ---- 4. retaining walls: grass banks wherever the free ground allows; the few walls left are mid-tone concrete with a plinth and panel joints, never taller than the deck itself
{
  let wallLen = 0, tall = 0, maxH = 0, slopeTris = 0;
  for (const c of Object.values(D.cells)) {
    const s = c.d && c.d.s;
    if (s) for (let i = 0; i < s.length; i += 9) if (s[i + 8] === P.wall) { const l = Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]), h = Math.max(s[i + 5], s[i + 7]); wallLen += l; maxH = Math.max(maxH, h); if (h > 3.2) tall += l; }
    const v = c.d && c.d.v; if (v) for (let i = 0; i < v.length; i += 10) if (v[i + 9] === P.slope) slopeTris++;
  }
  console.log(`INFO: retaining wall faces ${wallLen.toFixed(0)} m long, ${tall.toFixed(0)} m of them taller than 3.2 m, max ${maxH.toFixed(2)} m; grass bank triangles ${slopeTris}`);
  check(maxH <= D.struct.deckH + 0.01, `no retaining wall taller than the deck (${maxH.toFixed(2)} <= ${D.struct.deckH})`);
  check(slopeTris > 800, `grass banks are the rule (${slopeTris} bank triangles)`);
  // 2026-10-25: 500 -> 560 m: the M1 profile of the real-world audit (5 % grade, 145 m approach, K 19 / 25) keeps the tall stretch of the causeway longer (+45 m) and earth slopes are limited to 1:1.5 (+20 m of wall instead of a 1:1.25 bank); all of it still lies in the two cores (checked: I1 376 m, I4 145 m)
  check(tall < 560, `walls taller than 3.2 m total < 560 m: only the cores of I1 (M1 over the avenue) and I4 (${tall.toFixed(0)} m)`);
}

// ---- 5. wall ends are closed: a retaining-wall face (own colour) that ends higher than 0.35 m touches a cap / connector / bank triangle / another wall face at that point
{
  const key = (x, z) => Math.round(x * 50) + ',' + Math.round(z * 50), cols = new Map(), add = (x, z, lo, hi, tag) => { const k = key(x, z); let a = cols.get(k); if (!a) cols.set(k, a = []); a.push([lo, hi, tag]); };
  const ends = [];
  for (const c of Object.values(D.cells)) {
    const s = c.d && c.d.s;
    if (s) for (let i = 0; i < s.length; i += 9) {
      const q = s.slice(i, i + 9), id = i + ':' + q[0] + ',' + q[1];
      add(q[0], q[1], Math.min(q[4], q[5]), Math.max(q[4], q[5]), id); add(q[2], q[3], Math.min(q[6], q[7]), Math.max(q[6], q[7]), id);
      if (q[8] === P.wall) { ends.push([q[0], q[1], Math.min(q[4], q[5]), Math.max(q[4], q[5]), id]); ends.push([q[2], q[3], Math.min(q[6], q[7]), Math.max(q[6], q[7]), id]); }
    }
    const v = c.d && c.d.v; if (v) for (let i = 0; i < v.length; i += 10) for (let j = 0; j < 9; j += 3) add(v[i + j], v[i + j + 2], v[i + j + 1], v[i + j + 1], 'v' + i);
  }
  const open = [];
  for (const [x, z, lo, hi, id] of ends) {
    if (hi < 0.4) continue;
    const others = (cols.get(key(x, z)) || []).filter((o) => o[2] !== id);
    // the face of a wall run continues in the next face (same x, z, overlapping heights) or is closed by a cap / connector / bank triangle that spans its top
    const covers = others.some(([a, b]) => a <= hi + 0.1 && b >= hi - 0.1) || others.some(([a, b]) => b - a > 0.2 && a <= lo + 0.1);
    if (!covers) open.push([+x.toFixed(1), +z.toFixed(1), +hi.toFixed(2)]);
  }
  check(open.length === 0, `retaining-wall ends higher than 0.4 m are closed (${ends.length} ends, open ${open.length}: ${JSON.stringify(open.slice(0, 4))})`);
}


// ---- 2026-10-25 (owner, c1t): floating grass wedges, single sheets, lamps in the carriageway, zebras gone
{
  const T = surfaces(D), slope = T.filter((t) => t.ci === P.slope), road = T.filter((t) => t.ci === P.asph || t.ci === P.ramp);
  const grid = 4, B = new Map(), key = (i, j) => i * 100003 + j;
  road.forEach((t, n) => { const xs = t.p.map((q) => q[0]), zs = t.p.map((q) => q[2]); for (let i = Math.floor(Math.min(...xs) / grid); i <= Math.floor(Math.max(...xs) / grid); i++) for (let j = Math.floor(Math.min(...zs) / grid); j <= Math.floor(Math.max(...zs) / grid); j++) { const k = key(i, j); if (!B.has(k)) B.set(k, []); B.get(k).push(n); } });
  const bary = (t, x, z, m = 0.02) => { const [a, b, c] = t.p; const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(den) < 1e-12) return null; const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den, w = 1 - u - v; if (u < m || v < m || w < m) return null; return a[1] * u + b[1] * v + c[1] * w; };
  const above = []; let n = 0;
  for (const t of slope) { const [a, b, c] = t.p, area = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2, m = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(area / 0.3))));
    for (let i = 0; i < m; i++) for (let j = 0; j + i < m; j++) { const u = (i + 0.33) / m, v = (j + 0.33) / m, w = 1 - u - v, x = a[0] * u + b[0] * v + c[0] * w, z = a[2] * u + b[2] * v + c[2] * w, y = a[1] * u + b[1] * v + c[1] * w; n++;
      for (const k of B.get(key(Math.floor(x / grid), Math.floor(z / grid))) || []) { const yr = bary(road[k], x, z); if (yr !== null && y - yr > 0.25) { above.push([+x.toFixed(1), +z.toFixed(1), +(y - yr).toFixed(2)]); break; } } } }
  check(above.length === 0, `no grass bank triangle floats over a drivable surface (${slope.length} bank triangles, ${n} samples, over a road: ${above.length} ${JSON.stringify(above.slice(0, 3))})`);
  // every bank end has its vertical cap: the cap is a wall-layer quad in the bank colour (emitTri3 used to DROP vertical triangles, so every bank stood open and showed its back as a floating wedge)
  let caps = 0; for (const c of Object.values(D.cells)) { const q = c.d && c.d.s; if (q) for (let i = 0; i < q.length; i += 9) if (q[i + 8] === P.slope) caps++; }
  check(caps >= 20, `grass bank ends are closed by vertical caps (${caps} cap quads)`);
  // no vertical / degenerate triangle in any list (the generator drops them silently otherwise)
  let vert = 0; for (const c of Object.values(D.cells)) for (const L of ['g', 'r', 'p', 'd']) { const v = c[L] && c[L].v; if (!v) continue; for (let i = 0; i < v.length; i += 10) { const a = [v[i], v[i + 1], v[i + 2]], b = [v[i + 3], v[i + 4], v[i + 5]], d = [v[i + 6], v[i + 7], v[i + 8]], ny = Math.abs((b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2])), cx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), cz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]); if (ny < 1e-6 && Math.hypot(cx, ny, cz) / 2 > 0.02) vert++; } }
  check(vert === 0, `no vertical triangles in the triangle lists (they would be dropped: ${vert})`);
  // every material of the city is double-sided and opaque: a wall seen from behind never vanishes
  const src = fs.readFileSync(new URL('../assets/plan-c-v161.js', import.meta.url), 'utf8');
  check(/new THREE\.MeshStandardMaterial\(\{[^}]*side: THREE\.DoubleSide/.test(src) && !/transparent: *true/.test(src.slice(0, src.indexOf('instanced'))), 'city surface material is DoubleSide and opaque (walls / piers / parapets / banks are seen from both sides)');
  // lamps never stand on the carriageway: no lamp foot inside an asphalt / ramp triangle of its own level
  const lamps = []; for (const c of Object.values(D.cells)) { const l = c.f && c.f.lamp; if (l) for (let i = 0; i < l.length; i += 4) lamps.push([l[i], l[i + 1], l[i + 3]]); }
  const inLane = [];
  for (const [x, z, y] of lamps) for (const k of B.get(key(Math.floor(x / grid), Math.floor(z / grid))) || []) { const yr = bary(road[k], x, z, 0); if (yr !== null && Math.abs(yr - y) < 0.4) { inLane.push([x, z, y]); break; } }
  const near = [];   // 2026-10-26: also not within 0.3 m of the pavement (owner: lamp on the road beside the barrier)
  for (const [x, z, y] of lamps) { let hit = false; for (let a = 0; a < 8 && !hit; a++) { const px = x + Math.cos(a * Math.PI / 4) * 0.12, pz = z + Math.sin(a * Math.PI / 4) * 0.12; for (const k of B.get(key(Math.floor(px / grid), Math.floor(pz / grid))) || []) { const yr = bary(road[k], px, pz, 0); if (yr !== null && Math.abs(yr - y) < 0.4) { hit = true; break; } } } if (hit) near.push([x, z, y]); }
  check(near.length === 0, `no lamp base within 0.12 m of a carriageway (a pole on a parapet cap stands on the pavement edge) (${near.length}: ${JSON.stringify(near.slice(0, 4))})`);
  check(inLane.length === 0, `no lamp pole stands inside a carriageway polygon (${lamps.length} lamps, ${inLane.length} inside: ${JSON.stringify(inLane.slice(0, 4))})`);
  // ground zebras are off
  let zebra = 0; for (const c of Object.values(D.cells)) { const q = c.p && c.p.q; if (q) for (let i = 0; i < q.length; i += 6) { const w = Math.abs(q[i + 2] - q[i]), h = Math.abs(q[i + 3] - q[i + 1]); if (q[i + 5] === P.white && Math.abs(Math.min(w, h) - 0.5) < 1e-6 && Math.max(w, h) >= 1.0 && Math.max(w, h) <= 1.7) zebra++; } }
  check(zebra === 0, `no zebra bars on the ground (${zebra})`);
}

// ---- 2026-10-26 (owner: "ограждение должно стоять на покрытии и быть вровень с бетоном"): the parapet's outer face is in the SAME plane as the wall panel / bank top under it (<= 2 cm), and its base is on the deck
{
  const walls = []; for (const c of Object.values(D.cells)) { const q = c.d && c.d.s; if (q) for (let i = 0; i < q.length; i += 9) walls.push(q.slice(i, i + 9)); }
  const cellW = new Map(), K = (x, z) => Math.floor(x / 8) + ',' + Math.floor(z / 8);
  for (const w of walls) { const k = K((w[0] + w[2]) / 2, (w[1] + w[3]) / 2); (cellW.get(k) || cellW.set(k, []).get(k)).push(w); }
  let n = 0; const bad = [], baseBad = [];
  for (const rb of D.struct.ribbons) {
    if (/^FB/.test(rb.id)) continue;
    const pts = rb.p;
    for (let i = 1; i + 1 < pts.length; i += 2) {
      const e0 = /^M/.test(rb.id) ? 0.15 : 0.3, a = pts[i - 1], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, p = pts[i]; if (p[2] < 1.0 || (Math.abs(p[1] + 240) < 8 && Math.abs(p[0]) < 30)) continue;   // the loop heads beside M1 share its parapet line
      for (const sg of [-1, 1]) {
        const px = p[0] - tz * sg, pz = p[1] + tx * sg; let panel = null, par = null;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const w of cellW.get(K(p[0] + dx * 8, p[1] + dz * 8)) || []) {
          const mx = (w[0] + w[2]) / 2, mz = (w[1] + w[3]) / 2, lat = ((mx - p[0]) * -tz + (mz - p[1]) * tx) * sg, lon = (mx - p[0]) * tx + (mz - p[1]) * tz;
          if (Math.abs(lon) > 1.2 || lat < rb.w / 2 + e0 - 0.2 || lat > rb.w / 2 + e0 + 0.2) continue;   // the neighbouring structures of a cloverleaf core (loops 0.5-1 m away) are other objects
          const bot = Math.min(w[4], w[6]), top = Math.max(w[5], w[7]);
          if (w[8] === P.wall && top > p[2] - 0.5) { if (panel === null || Math.abs(lat - rb.w / 2 - e0) < Math.abs(panel - rb.w / 2 - e0)) panel = lat; }
          else if (w[8] === P.conc && bot > p[2] - 0.1 && top - bot > 0.3 && bot < p[2] + 0.3) { if (par === null || Math.abs(lat - rb.w / 2 - e0) < Math.abs(par - rb.w / 2 - e0)) par = lat; }
          if (w[8] === P.conc && top - bot > 0.3 && bot < p[2] + 0.3 && Math.abs(bot - (p[2] + 0.05)) > 0.03 && bot > p[2] - 0.1 && w[4] === w[6] && Math.abs(w[4] - w[6]) < 1e-6 && bot > p[2] + 0.1) baseBad.push([+mx.toFixed(1), +mz.toFixed(1)]);
        }
        if (panel !== null && par !== null) { n++; if (Math.abs(panel - par) > 0.02) bad.push([rb.id, +px.toFixed(1), +pz.toFixed(1), +(par - panel).toFixed(2)]); }
      }
    }
  }
  check(n > 50 && bad.length === 0, `parapet outer face coplanar with the wall panel under it within 2 cm (${n} samples, bad ${bad.length}: ${JSON.stringify(bad.slice(0, 4))})`);
  check(baseBad.length === 0, `parapet bases rest on the deck surface (${baseBad.length} floating)`);
}

console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
