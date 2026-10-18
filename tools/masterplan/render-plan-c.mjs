// Draws the masterplan C (tools/masterplan/plan-c.mjs) as a map: SVG, then PNG through Chromium, then a 256-colour palette PNG.
//   node tools/masterplan/render-plan-c.mjs [outDir=docs/masterplan-c] [--svg-only] [--keep-svg]
// Output: plan-C-overview.png (whole city + legend) and detail crops (hub, downtown, the four interchanges, station).
// Layer order: land use -> water -> blocks + buildings -> rail embankment -> ground roads (casings, fills, markings) -> junction furniture
// -> rail tracks -> elevated decks (motorway over crossroads / rail, ramp bridges) -> pedestrians (footbridges, tunnels) -> transit -> labels -> frame.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPlan, CLS } from './plan-c.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), OUT = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'docs/masterplan-c');
const P = buildPlan();
fs.mkdirSync(OUT, { recursive: true });
const f = (n) => (Math.round(n * 100) / 100).toString();
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const N = new Map(P.nodes.map((n) => [n.id, n]));
const J = new Map(P.junctions.map((j) => [j.id, j]));

const COL = {
  rural: '#eceee2', urban: '#f6f4ef', ink: '#262a30', inkSoft: '#5b5f66', halo: '#ffffff',
  field1: '#eef0d6', field2: '#e7ebc9', field3: '#f0e8cc', forest: '#bcd7a3', tree: '#9fc487', treeDark: '#8bb873', park: '#cfe6b7', verge: '#dceccb', embank: '#d3e7bd',
  water: '#a9d2ef', waterEdge: '#82b5da', waterInk: '#2f6a98', beach: '#f2e5c1', promenade: '#ece5d6', port: '#e1e3e6', quay: '#8f969e', parking: '#e7e4dd',
  res: '#ebe5d8', resB: '#dccdb5', resS: '#b9a687', cbd: '#e5e0d6', cbdB: '#d1c7b7', cbdS: '#a69a87', tall: '#bcb09e', mixed: '#e8e2d6',
  villa: '#e2e9cf', villaB: '#e4d4ba', east: '#e7e5de', eastB: '#d5d0c6', eastS: '#aea89a', ind: '#e3dfe8', indB: '#ccc5d6', indS: '#a39ab3', log: '#e6e2db', logB: '#d4cdc1', logS: '#aaa293',
  civic: '#e9dfd2', civicB: '#d8c3a8', civicS: '#a88c6c', sport: '#c4e0a8', pitch: '#8fc271',
  motor: '#f5a557', motorC: '#c0762f', ramp: '#f8bb7c', rampC: '#c58644', art: '#fdd985', artC: '#c6a24e', coll: '#ffffff', collC: '#c3baa8', loc: '#ffffff', locC: '#d1c9b8', serv: '#f3f1ec', servC: '#cdc6b9',
  median: '#a9cf8f', medianM: '#9cc584', rail: '#545a62', ballast: '#cfcabd', sig: '#d6332a', ped: '#6f42c1', tun: '#1c6dd0', deckEdge: '#6c6a63', shadow: '#000000',
};
const ROAD = {   // fill, casing, casing extra (m)
  motorway: [COL.motor, COL.motorC, 0.55], ramp: [COL.ramp, COL.rampC, 0.45], arterial: [COL.art, COL.artC, 0.5], collector: [COL.coll, COL.collC, 0.4], local: [COL.loc, COL.locC, 0.35], service: [COL.serv, COL.servC, 0.35],
};
const ZONE_FILL = { residential: COL.res, mixed: COL.mixed, cbd: COL.cbd, villas: COL.villa, east: COL.east, industrial: COL.ind, logistics: COL.log, railyard: '#e3e0d9', station: '#ede6da', busterm: '#e9e5dd', hospital: COL.civic, school: COL.civic, market: COL.civic, campus: '#e3e9d3', stadium: COL.sport, park: COL.park, waterfront: COL.res };

// ---------------------------------------------------------------- svg helpers
const pathOf = (pts, close) => 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + (close ? 'Z' : '');
const line = (a, b, st) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" ${st}/>`;
const rect = (x, z, w, h, st) => `<rect x="${f(x)}" y="${f(z)}" width="${f(w)}" height="${f(h)}" ${st}/>`;
const circ = (x, z, r, st) => `<circle cx="${f(x)}" cy="${f(z)}" r="${f(r)}" ${st}/>`;
const poly = (pts, st) => `<path d="${pathOf(pts, true)}" ${st}/>`;
const pl = (pts, st) => `<path d="${pathOf(pts)}" fill="none" ${st}/>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const rightOf = (h) => [-h[1], h[0]];
function offsetPl(pts, o) {   // parallel polyline (o > 0 = right of travel)
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], h = norm([b[0] - a[0], b[1] - a[1]]), r = rightOf(h); return [p[0] + r[0] * o, p[1] + r[1] * o]; });
}
function cutPl(pts, from, to) {   // sub-polyline by arc length
  const out = []; let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t0 = (from - s) / L, t1 = (to - s) / L;
    if (t1 >= 0 && t0 <= 1) { const u0 = Math.max(0, t0), u1 = Math.min(1, t1); if (!out.length) out.push([a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0]); out.push([a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1]); }
    s += L;
  }
  return out;
}
const plLen = (pts) => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
function pointAt(pts, s) { let acc = 0; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc + L >= s) { const t = (s - acc) / L; return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], h: norm([b[0] - a[0], b[1] - a[1]]) }; } acc += L; } const n = pts.length; return { p: pts[n - 1], h: norm([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]) }; }

// ---------------------------------------------------------------- geometry of the plan used by several layers
const edgePts = (e) => { const a = N.get(e.a), b = N.get(e.b); return [[a.x, a.z], [b.x, b.z]]; };
const halfW = (cls) => CLS[cls].w / 2;
function trimAt(nodeId, e) {   // how far road markings stay away from a node
  const n = N.get(nodeId), j = J.get(nodeId);
  if (!j) return n.legs > 1 ? 1.5 : 0;
  if (j.type === 'roundabout') return j.R + 6.5;
  if (j.type === 'mini') return 5.5;
  const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (e.dir === 'x')).map((a) => halfW(a.cls));
  const ch = cross.length ? Math.max(...cross) : 0;
  if (j.type === 'signal') return ch + 5.2;
  if (j.type === 'riro' && e.cls === 'arterial') return 0;
  return ch + 0.8;
}
function trimmedEdge(e) { const [a, b] = edgePts(e), L = Math.hypot(b[0] - a[0], b[1] - a[1]), t0 = trimAt(e.a, e), t1 = trimAt(e.b, e); return L - t0 - t1 > 1 ? cutPl([a, b], t0, L - t1) : null; }
const ramps = P.interchanges.flatMap((ic) => ic.ramps.map((r) => ({ ...r, ic: ic.id })));

// ---------------------------------------------------------------- label placement with collision boxes
function Labels(ppm) {
  const boxes = [];
  const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  return {
    reserve(b) { boxes.push(b); },
    free(b) { return !hit(b); },
    text(x, z, txt, px, opt = {}) {   // px = font size in screen pixels
      const fs = px / ppm, w = (opt.wf || 0.56) * fs * String(txt).length + fs * 0.4, h = fs * 1.15, rotd = opt.rot || 0, vert = Math.abs(rotd) === 90;
      const bw = vert ? h : w, bh = vert ? w : h, b = [x - bw / 2, z - bh / 2, x + bw / 2, z + bh / 2];
      if (!opt.force && hit(b)) return '';
      boxes.push(b);
      const halo = opt.halo === false ? '' : ` paint-order="stroke" stroke="${opt.haloCol || COL.halo}" stroke-width="${f(fs * (opt.haloW || 0.32))}" stroke-linejoin="round"`;
      return `<text transform="translate(${f(x)} ${f(z + (vert ? 0 : fs * 0.36))}) rotate(${rotd})${vert ? ` translate(0 ${f(fs * 0.36)})` : ''}" font-size="${f(fs)}" text-anchor="middle" fill="${opt.fill || COL.ink}" font-weight="${opt.weight || 600}"${opt.ls ? ` letter-spacing="${f(opt.ls * fs)}"` : ''}${opt.italic ? ' font-style="italic"' : ''}${opt.op ? ` opacity="${opt.op}"` : ''}${halo}>${esc(txt)}</text>`;
    },
  };
}

// ---------------------------------------------------------------- layers
function defs(ppm) {
  const t = Math.max(1.6, 7 / ppm);
  return `<defs>
<pattern id="forest" width="${f(t * 2.2)}" height="${f(t * 2.2)}" patternUnits="userSpaceOnUse"><rect width="${f(t * 2.2)}" height="${f(t * 2.2)}" fill="${COL.forest}"/><circle cx="${f(t * 0.6)}" cy="${f(t * 0.6)}" r="${f(t * 0.5)}" fill="${COL.tree}"/><circle cx="${f(t * 1.7)}" cy="${f(t * 1.5)}" r="${f(t * 0.42)}" fill="${COL.treeDark}"/></pattern>
<pattern id="field" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><rect width="12" height="12" fill="${COL.field1}"/><rect width="12" height="5" fill="${COL.field2}"/></pattern>
<pattern id="field2" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-62)"><rect width="10" height="10" fill="${COL.field3}"/><rect width="10" height="4" fill="${COL.field1}"/></pattern>
<pattern id="pave" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#efe9dd"/><path d="M0 0H2M0 0V2" stroke="#e2dacb" stroke-width="0.12"/></pattern>
<pattern id="stalls" width="1.25" height="5" patternUnits="userSpaceOnUse"><rect width="1.25" height="5" fill="${COL.parking}"/><path d="M0 0V2.1M0 2.9V5" stroke="#ffffff" stroke-width="0.14"/></pattern>
<pattern id="sand" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="${COL.beach}"/><circle cx="1" cy="1" r="0.18" fill="#e3d2a6"/><circle cx="2.4" cy="2.1" r="0.14" fill="#e3d2a6"/></pattern>
</defs>`;
}

function landuse() {
  let s = rect(-420, -480, 840, 900, `fill="${COL.rural}"`);
  const fillOf = { forest: 'url(#forest)', field: 'url(#field)', industry: COL.ind, verge: COL.verge, park: 'url(#forest)', parking: 'url(#stalls)', embankment: COL.embank, beach: 'url(#sand)', promenade: 'url(#pave)', port: COL.port, urban: COL.urban };
  const order = ['field', 'forest', 'verge', 'park', 'industry', 'urban', 'embankment', 'beach', 'promenade', 'port', 'parking'];
  for (const k of order) for (const a of P.areas.filter((x) => x.kind === k)) s += poly(a.poly, `fill="${fillOf[k]}"`);
  // countryside north of M1: field parcels split into crop strips, hedgerows, irregular woods, farmsteads, unpaved lanes
  const R = P.rural, crops = [['#ece4b8', '#e3d9a2'], ['#dce8b6', '#cfe0a3'], ['#e9dfc3', '#dfd2b0'], ['#e8e0a0', '#dccf86'], ['#d6e4c0', '#c8dbad']];
  R.fields.forEach((fd, i) => {
    const xs = fd.poly.map((p) => p[0]), zs = fd.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), [c1, c2] = crops[fd.crop];
    s += `<clipPath id="fld${i}"><path d="${pathOf(fd.poly, true)}"/></clipPath><g clip-path="url(#fld${i})">` + poly(fd.poly, `fill="${c1}"`);
    const n = fd.strips, along = fd.angle === 0;
    for (let k = 1; k < n; k += 2) s += along ? rect(x0, z0 + (z1 - z0) * k / n, x1 - x0, (z1 - z0) / n, `fill="${c2}"`) : rect(x0 + (x1 - x0) * k / n, z0, (x1 - x0) / n, z1 - z0, `fill="${c2}"`);
    for (let t = 0; t < (along ? z1 - z0 : x1 - x0); t += 2.2) s += along ? line([x0, z0 + t], [x1, z0 + t], 'stroke="#ffffff" stroke-width="0.25" opacity="0.25"') : line([x0 + t, z0], [x0 + t, z1], 'stroke="#ffffff" stroke-width="0.25" opacity="0.25"');
    s += `</g>` + poly(fd.poly, 'fill="none" stroke="#a9c58c" stroke-width="1.1" stroke-dasharray="1.6 0.7" stroke-linejoin="round"');
  });
  for (const fo of R.forests) s += poly(fo, `fill="url(#forest)" stroke="#94bb7b" stroke-width="0.6" stroke-linejoin="round"`);
  for (const ln of R.lanes) s += pl(ln, 'stroke="#d9c9a3" stroke-width="2.0" stroke-linejoin="round"') + pl(ln, 'stroke="#c4b086" stroke-width="0.3" stroke-dasharray="1.2 1.2"');
  for (const fm of R.farms) {
    const [x, z] = fm.at;
    s += rect(x - 10, z - 7, 20, 14, `fill="#ece6d4" stroke="#cbbf9f" stroke-width="0.3"`) + bld([x - 8, z - 5, x + 1, z - 1], '#d8b48c', '#9c7b55', 0.25) + bld([x + 3, z - 5, x + 8, z + 4], '#c9c3b5', '#8f897b', 0.25) + bld([x - 8, z + 1, x - 2, z + 5], '#e0cfb2', '#a68f6a', 0.2) + circ(x + 0, z + 3.2, 1.6, `fill="#d9d3c3" stroke="#8f897b" stroke-width="0.2"`);
    for (let k = 0; k < 4; k++) s += tree(x - 11 + k * 2.4, z - 8.5, 1.2, COL.treeDark);
  }
  // Лесопарк south of M1: paths through the wood and a pond in a clearing
  s += `<path d="M -296 -200 C -250 -222 -200 -180 -150 -205 S -60 -228 -6 -196" stroke="#efe6cf" stroke-width="1.2" fill="none"/><path d="M -120 -238 C -110 -210 -140 -190 -118 -168" stroke="#efe6cf" stroke-width="1.1" fill="none"/>`;
  s += `<ellipse cx="-70" cy="-202" rx="15" ry="8" fill="${COL.park}"/><ellipse cx="-70" cy="-202" rx="9" ry="4.6" fill="${COL.water}" stroke="${COL.waterEdge}" stroke-width="0.3"/>`;
  // interchange infields and motorway verges (grass under every ramp, not farmland / factories)
  for (const ic of P.interchanges) if (ic.kind === 'trumpet') s += `<ellipse cx="${f(ic.at[0] - 21)}" cy="${f(ic.at[1] + 22)}" rx="31" ry="27" fill="${COL.verge}"/>`;
  for (const e of P.edges.filter((x) => x.cls === 'motorway')) s += pl(edgePts(e), `stroke="${COL.verge}" stroke-width="24" stroke-linecap="butt"`);
  for (const r of ramps) s += pl(r.pts, `stroke="${COL.verge}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"`);
  for (const a of P.areas.filter((x) => x.kind === 'parking')) s += poly(a.poly, 'fill="url(#stalls)" stroke="#bdb6a6" stroke-width="0.3"') + `<text x="${f((a.poly[0][0] + a.poly[1][0]) / 2)}" y="${f((a.poly[0][1] + a.poly[2][1]) / 2 + 2.5)}" font-size="7" text-anchor="middle" fill="#1c6dd0" font-weight="800" opacity="0.8">P+R</text>`;
  // riverside park: trees on both banks, a path on the east bank
  const rnd2 = mulberry(9), rv = P.water.river, rx = (z) => { let best = rv.pts[0]; for (const p of rv.pts) if (Math.abs(p[1] - z) < Math.abs(best[1] - z)) best = p; return best[0]; };
  s += pl(rv.pts.filter((p) => p[1] > -168 && p[1] < 196).map((p) => [p[0] + 15.5, p[1]]), 'stroke="#f3eee2" stroke-width="1.2" stroke-linejoin="round"');
  for (let i = 0; i < 300; i++) {
    const z = -166 + rnd2() * 362, side = rnd2() < 0.5 ? -1 : 1, x = rx(z) + side * (11.6 + rnd2() * 9);
    if ([-160, -120, -80, 0, 80, 160].some((zz) => Math.abs(z - zz) < 7) || x < -229.5 || x > -197.5 || Math.abs(x - rx(z) - 15.5) < 1.4) continue;
    s += tree(x, z, 1.0 + rnd2() * 0.7, rnd2() < 0.5 ? COL.tree : COL.treeDark);
  }
  // waterfront boulevard along the sea: lawn, curved path, a row of trees (the marina keeps its quay open)
  const cst = P.water.sea.coast.filter((p) => p[0] >= -196 && p[0] <= 40);
  s += pl(cst.map((p) => [p[0], p[1] - 6]), `stroke="${COL.park}" stroke-width="7" stroke-linejoin="round"`) + pl(cst.map((p) => [p[0], p[1] - 6]), 'stroke="#f3eee2" stroke-width="1.2"');
  for (let x = -190; x <= 36; x += 6) { if (x > -116 && x < -4) continue; const p = cst.reduce((b, q) => Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b, cst[0]); s += tree(x, p[1] - 8.6, 1.1, COL.treeDark); }
  return s;
}

function water() {
  let s = '';
  const W = P.water, sea = [...W.sea.coast, [420, 420], [-420, 420]], rv = W.river;
  const riverPoly = [...rv.banks.left, ...rv.banks.right.slice().reverse()];
  s += poly(rv.mouth, `fill="url(#sand)"`) + poly(riverPoly, `fill="${COL.water}" stroke="${COL.waterEdge}" stroke-width="0.8" stroke-linejoin="round"`);
  { // reeds on the inside of the bends, a sand bar where the river meets the sea
    const rr = mulberry(31);
    for (const side of [rv.banks.left, rv.banks.right]) for (let i = 2; i < side.length - 2; i += 1) { if (rr() < 0.55) continue; const p = side[i], q = side[i + 1], d = norm([q[0] - p[0], q[1] - p[1]]), n = rightOf(d), o = side === rv.banks.left ? -1 : 1; for (let k = 0; k < 3; k++) { const b = [p[0] + d[0] * k * 1.2 + n[0] * o * 0.4, p[1] + d[1] * k * 1.2 + n[1] * o * 0.4]; s += line(b, [b[0] + n[0] * o * 1.3 + d[0] * 0.3, b[1] + n[1] * o * 1.3 + d[1] * 0.3], 'stroke="#7fa866" stroke-width="0.28"'); } }
    s += `<path d="M -226 206 Q -214 201 -204 205 Q -214 208 -226 206 Z" fill="url(#sand)" stroke="#e0cf9e" stroke-width="0.2"/>`;
  }
  s += poly(sea, `fill="${COL.water}"`);
  for (const [x, z, r] of W.rocks) s += circ(x, z, r, `fill="#b7b2a6" stroke="#8a857a" stroke-width="0.25"`) + circ(x + r * 0.7, z + r * 0.4, r * 0.55, `fill="#c5c0b4" stroke="#8a857a" stroke-width="0.2"`);
  // shoreline: soft edge + surf lines on the beach / promenade, quay walls along the port
  const cst = W.sea.coast, portStart = cst.findIndex((p) => p[0] >= 40);
  s += pl(cst.slice(0, portStart + 1), `stroke="${COL.waterEdge}" stroke-width="0.9"`) + pl(cst.slice(portStart), `stroke="${COL.quay}" stroke-width="1.1"`);
  for (let i = 0; i < 3; i++) s += pl(cst.slice(0, portStart).filter((p) => p[0] < -116 || p[0] > -4).map((p) => [p[0], p[1] + 3 + i * 3.2]), `stroke="#ffffff" stroke-width="0.35" opacity="${0.4 - i * 0.1}" stroke-dasharray="${6 + i * 3} ${4 + i * 2}"`);
  // marina: two curved breakwaters with a light at each head, pontoons with berths
  const M = W.marina;
  for (const m of M.moles) { s += pl(m, `stroke="#bfb7a3" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"`) + pl(m, `stroke="#e8e2d3" stroke-width="2.2" stroke-linecap="round"`); const e = m[m.length - 1]; s += circ(e[0], e[1], 1.4, `fill="#d6332a" stroke="#fff" stroke-width="0.4"`); }
  for (let i = 0; i < 6; i++) { const x = M.x0 + 20 + i * 12.5; s += rect(x - 0.4, 209, 0.8, 17, `fill="#fbfaf7" stroke="#b5ad9c" stroke-width="0.1"`); for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) s += rect(sd < 0 ? x - 3.6 : x + 0.6, 211 + k * 3, 3.0, 1.1, `fill="#ffffff" stroke="#8fa3b5" stroke-width="0.08"`); }
  // ships alongside the piers
  for (const sh of W.ships) {
    const [x, z] = sh.at, L = sh.len, w = sh.w;
    s += poly([[x - w / 2, z - L / 2 + w * 0.6], [x, z - L / 2], [x + w / 2, z - L / 2 + w * 0.6], [x + w / 2, z + L / 2], [x - w / 2, z + L / 2]], `fill="${sh.kind === 'яхта' ? '#ffffff' : '#6b7480'}" stroke="#3f454d" stroke-width="0.3"`);
    if (sh.kind === 'контейнеровоз') for (let k = 0; k < Math.floor(L / 4) - 2; k++) s += rect(x - w / 2 + 1, z - L / 2 + w * 0.8 + k * 4, w - 2, 3.2, `fill="${['#c97b5b', '#6a8fb0', '#c9a24d', '#9aa864'][k % 4]}"`);
    else if (sh.kind === 'балкер') for (let k = 0; k < 4; k++) s += rect(x - w / 2 + 1.2, z - L / 2 + w + k * 5.5, w - 2.4, 4, `fill="#4f5762"`);
    s += rect(x - w / 2 + 0.8, z + L / 2 - 4.5, w - 1.6, 3.4, `fill="#f1efe9"`);
  }
  return s;
}

// buildings ------------------------------------------------------------------------------------------------
function bars(lot, depth, rnd, gapP) {   // perimeter block: four bars, optional courtyard gaps, unit separators
  const [x0, z0, x1, z1] = lot, out = [], seps = [];
  const pushBar = (bx0, bz0, bx1, bz1, along) => {
    const L = along === 'x' ? bx1 - bx0 : bz1 - bz0; if (L < 3) return;
    if (rnd() < gapP && L > 16) {   // a gate into the courtyard
      const g = (along === 'x' ? bx0 : bz0) + L * (0.35 + rnd() * 0.3), gw = 2.6;
      if (along === 'x') { pushBar(bx0, bz0, g - gw / 2, bz1, 'n'); pushBar(g + gw / 2, bz0, bx1, bz1, 'n'); } else { pushBar(bx0, bz0, bx1, g - gw / 2, 'n'); pushBar(bx0, g + gw / 2, bx1, bz1, 'n'); }
      return;
    }
    out.push([bx0, bz0, bx1, bz1]);
    const ax = (bx1 - bx0) > (bz1 - bz0);
    for (let s = (ax ? bx0 : bz0) + 7 + rnd() * 3; s < (ax ? bx1 : bz1) - 5; s += 7 + rnd() * 5) seps.push(ax ? [[s, bz0], [s, bz1]] : [[bx0, s], [bx1, s]]);
  };
  pushBar(x0, z0, x1, z0 + depth, 'x'); pushBar(x0, z1 - depth, x1, z1, 'x');
  pushBar(x0, z0 + depth, x0 + depth, z1 - depth, 'z'); pushBar(x1 - depth, z0 + depth, x1, z1 - depth, 'z');
  return { out, seps };
}
const bld = (r, fill, stroke, sw = 0.18) => rect(r[0], r[1], r[2] - r[0], r[3] - r[1], `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`);
const tree = (x, z, r, c = COL.tree) => circ(x, z, r, `fill="${c}" stroke="#86ad6e" stroke-width="0.12"`);

// varied perimeter building: the street facade stays on the building line, the courtyard side is ragged, each unit its own shade
const SHADES = { res: ['#dccdb5', '#d5c4a8', '#e3d6c0', '#cdbb9e', '#d9cbb8'], cbd: ['#d1c7b7', '#c7bcab', '#d9d0c2', '#bdb2a1', '#cfc3b0'] };
function frontage(side, lot, depth, rnd, pal, stroke, gapP) {   // side: 'n' | 's' | 'w' | 'e'; returns svg of units along that side
  const [x0, z0, x1, z1] = lot, horiz = side === 'n' || side === 's', a = horiz ? x0 + (side === 'n' ? 0 : 0) : z0 + depth, b = horiz ? x1 : z1 - depth;
  let s = '', t = a;
  while (t < b - 2) {
    let L = Math.min(b - t, 7 + rnd() * 7); if (b - (t + L) < 4) L = b - t;
    if (rnd() < gapP && L < b - a - 4 && t > a + 3) { t += 2.8; continue; }   // a passage into the courtyard
    const d = depth + (rnd() - 0.4) * 2.2, c = pal[Math.floor(rnd() * pal.length)];
    const r = side === 'n' ? [t, z0, t + L, z0 + d] : side === 's' ? [t, z1 - d, t + L, z1] : side === 'w' ? [x0, t, x0 + d, t + L] : [x1 - d, t, x1, t + L];
    s += bld(r, c, stroke, 0.16); t += L;
  }
  return s;
}
function urbanBlock(b, rnd, zone) {
  const lot = [b.lot[0] + 0.6, b.lot[1] + 0.6, b.lot[2] - 0.6, b.lot[3] - 0.6], [x0, z0, x1, z1] = lot, w = x1 - x0, h = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const cbd = zone === 'cbd', pal = cbd ? SHADES.cbd : SHADES.res, stroke = cbd ? COL.cbdS : COL.resS, depth = cbd ? 7 : zone === 'waterfront' ? 6 : 5.6;
  const yardTrees = (ix0, iz0, ix1, iz1, n) => { let s = ''; if (ix1 - ix0 < 5 || iz1 - iz0 < 5) return s; for (let i = 0; i < n; i++) s += tree(ix0 + 1.5 + rnd() * (ix1 - ix0 - 3), iz0 + 1.5 + rnd() * (iz1 - iz0 - 3), 0.9 + rnd() * 0.8, rnd() < 0.5 ? COL.tree : COL.treeDark); return s; };
  const roll = rnd();
  let s = '';
  if (zone === 'waterfront') {   // mid-rise terraces facing the sea, gardens behind
    s += frontage('n', lot, 6, rnd, pal, stroke, 0.25);
    for (let x = x0 + 2; x + 8 < x1; x += 13) s += bld([x, z1 - 8, x + 8, z1], pal[Math.floor(rnd() * pal.length)], stroke, 0.18);
    return s + yardTrees(x0, z0 + 8, x1, z1 - 9, 4);
  }
  if (cbd && roll < 0.28) {   // office tower on a podium
    s += bld([x0, z0, x1, z1], pal[1], stroke, 0.2);
    const tx = x0 + 3 + rnd() * (w - 17), tz = z0 + 3 + rnd() * (h - 17);
    s += bld([tx, tz, tx + 13, tz + 13], COL.tall, stroke, 0.35) + bld([tx + 3, tz + 3, tx + 10, tz + 10], '#a99d8b', stroke, 0.2) + line([tx + 6.5, tz + 3], [tx + 6.5, tz + 10], `stroke="${stroke}" stroke-width="0.12"`);
    return s;
  }
  if (cbd || roll < 0.38) {   // closed perimeter block with a courtyard
    for (const sd of ['n', 's', 'w', 'e']) s += frontage(sd, lot, depth, rnd, pal, stroke, cbd ? 0.06 : 0.16);
    return s + yardTrees(x0 + depth + 2, z0 + depth + 2, x1 - depth - 2, z1 - depth - 2, cbd ? 3 : 5);
  }
  if (roll < 0.58) {   // U-shape open to one side, playground in the yard
    const open = ['n', 's', 'w', 'e'][Math.floor(rnd() * 4)];
    for (const sd of ['n', 's', 'w', 'e']) if (sd !== open) s += frontage(sd, lot, depth, rnd, pal, stroke, 0.1);
    s += rect(cx - 3, cz - 2.5, 6, 5, `fill="#e8d9b7" stroke="#c9b48d" stroke-width="0.15"`);
    return s + yardTrees(x0 + depth + 1, z0 + depth + 1, x1 - depth - 1, z1 - depth - 1, 6);
  }
  if (roll < 0.74) {   // L-shape on the corner + two point houses
    const sx = rnd() < 0.5 ? 'w' : 'e', sz = rnd() < 0.5 ? 'n' : 's';
    s += frontage(sz, lot, depth, rnd, pal, stroke, 0.1) + frontage(sx, lot, depth, rnd, pal, stroke, 0.1);
    const px = sx === 'w' ? x1 - 9 : x0 + 1, pz = sz === 'n' ? z1 - 9 : z0 + 1;
    s += bld([px, pz, px + 8, pz + 8], pal[2], stroke, 0.2) + bld([sx === 'w' ? px - 11 : px + 11, pz, (sx === 'w' ? px - 11 : px + 11) + 8, pz + 8], pal[3], stroke, 0.2);
    return s + yardTrees(x0 + depth + 1, z0 + depth + 1, x1 - depth - 1, z1 - depth - 1, 5);
  }
  if (roll < 0.9) {   // parallel slabs along the longer side
    const n = 3;
    for (let k = 0; k < n; k++) { if (w >= h) { const zz = z0 + k * (h - 5.5) / (n - 1); s += bld([x0 + 1 + rnd() * 2, zz, x1 - 1 - rnd() * 2, zz + 5.5], pal[k % pal.length], stroke, 0.18); } else { const xx = x0 + k * (w - 5.5) / (n - 1); s += bld([xx, z0 + 1 + rnd() * 2, xx + 5.5, z1 - 1 - rnd() * 2], pal[k % pal.length], stroke, 0.18); } }
    return s + yardTrees(x0 + 2, z0 + 2, x1 - 2, z1 - 2, 4);
  }
  for (const [px, pz] of [[x0 + 1, z0 + 1], [x1 - 10, z0 + 1], [x0 + 1, z1 - 10], [x1 - 10, z1 - 10], [cx - 4.5, cz - 4.5]]) s += bld([px, pz, px + 9, pz + 9], pal[Math.floor(rnd() * pal.length)], stroke, 0.22);   // point towers in a green
  return s + yardTrees(x0 + 11, z0 + 2, x1 - 11, z1 - 2, 5);
}
function streetTrees() {   // rows on the sidewalks of avenues and district streets, never inside a junction
  let s = '';
  for (const e of P.edges.filter((x) => (x.cls === 'arterial' || x.cls === 'collector') && !x.bridge && !x.underRail)) {
    const [a, b] = edgePts(e), L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = norm([b[0] - a[0], b[1] - a[1]]), r = rightOf(d), o = CLS[e.cls].w / 2 + CLS[e.cls].sidewalk * 0.55;
    const n0 = N.get(e.a), n1 = N.get(e.b); if (n0.z < -164 || n1.z < -164 || n0.z > 190 || Math.abs(n0.x) > 282 || Math.abs(n1.x) > 282) continue;
    for (let t = 9; t < L - 9; t += 6) { const p = [a[0] + d[0] * t, a[1] + d[1] * t]; if (Math.hypot(p[0], p[1]) < 27) continue; for (const sd of [-1, 1]) s += circ(p[0] + r[0] * o * sd, p[1] + r[1] * o * sd, 0.75, `fill="${COL.treeDark}" opacity="0.9"`); }
  }
  return s;
}

function blockContent(b, detail) {
  const rnd = mulberry(1000 + +b.id.slice(1) * 97), [x0, z0, x1, z1] = b.lot, w = x1 - x0, h = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let s = rect(x0, z0, w, h, `fill="${ZONE_FILL[b.zone] || COL.res}"`);
  const zone = b.zone, inset = (r, m) => [r[0] + m, r[1] + m, r[2] - m, r[3] - m];
  if (zone === 'cbd' || zone === 'mixed' || zone === 'residential' || zone === 'waterfront') {
    if (zone === 'cbd' && Math.abs(cx + 20) < 1 && Math.abs(cz + 20) < 1) {   // city hall: U-shape opening to the square + a tower
      const r = inset(b.lot, 1);
      s += bld([r[0], r[1], r[2], r[1] + 7], COL.civicB, COL.civicS, 0.25) + bld([r[0], r[1] + 7, r[0] + 7, r[3]], COL.civicB, COL.civicS, 0.25) + bld([r[2] - 7, r[1] + 7, r[2], r[3] - 9], COL.civicB, COL.civicS, 0.25);
      s += rect(r[0] + 1.5, r[1] + 1.5, 4, 4, `fill="#c4a983" stroke="${COL.civicS}" stroke-width="0.25"`);
      for (let i = 0; i < 4; i++) s += tree(r[0] + 11 + i * 4.5, r[1] + 12 + (i % 2) * 5, 1.3);
      return s;
    }
    if (zone === 'cbd' && Math.abs(cx - 20) < 1 && Math.abs(cz - 20) < 1) {   // cathedral on its own square
      s += rect(x0, z0, w, h, 'fill="url(#pave)"');
      const c = [cx + 3, cz + 3];
      s += bld([c[0] - 9, c[1] - 3, c[0] + 9, c[1] + 3], COL.civicB, COL.civicS, 0.3) + bld([c[0] - 3, c[1] - 8, c[0] + 3, c[1] + 8], COL.civicB, COL.civicS, 0.3) + circ(c[0], c[1], 3.4, `fill="#c9a96b" stroke="${COL.civicS}" stroke-width="0.3"`);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s += tree(c[0] + dx * 12, c[1] + dz * 11, 1.4);
      return s;
    }
    return s + urbanBlock(b, rnd, zone);
  }
  if (zone === 'villas') {
    const nx = Math.max(1, Math.floor(w / 12)), nz = Math.max(1, Math.floor(h / 12)), pw = w / nx, ph = h / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const px = x0 + i * pw, pz = z0 + j * ph;
      if (detail) s += rect(px, pz, pw, ph, `fill="none" stroke="#c7d1ad" stroke-width="0.25"`);
      const hw = 4.2 + rnd() * 1.6, hh = 4 + rnd() * 1.4, hx = px + (pw - hw) / 2 + (rnd() - 0.5) * 2, hz = pz + (ph - hh) / 2 + (rnd() - 0.5) * 2;
      s += bld([hx, hz, hx + hw, hz + hh], COL.villaB, COL.resS, 0.16);
      if (rnd() < 0.3) s += rect(hx + hw + 0.8, hz + 0.6, 2, 1.4, `fill="#7ec3ea" stroke="#5f9fc7" stroke-width="0.1"`);
      s += tree(px + 1.5 + rnd() * (pw - 3), pz + ph - 1.6, 1.1, COL.treeDark);
    }
    return s;
  }
  if (zone === 'east') {   // micro-district: parallel slabs, green between, a kindergarten
    const vertical = rnd() < 0.5;
    for (let k = 0; k < 3; k++) {
      if (vertical) { const xx = x0 + 2 + k * (w - 8) / 2; s += bld([xx, z0 + 3, xx + 4, z1 - 3], COL.eastB, COL.eastS); }
      else { const zz = z0 + 2 + k * (h - 8) / 2; s += bld([x0 + 3, zz, x1 - 3, zz + 4], COL.eastB, COL.eastS); }
    }
    for (let i = 0; i < 6; i++) s += tree(x0 + 4 + rnd() * (w - 8), z0 + 4 + rnd() * (h - 8), 1.1);
    return s;
  }
  if (zone === 'school') {
    s += bld([x0 + 1.5, z0 + 1.5, x0 + 16, z0 + 7], COL.civicB, COL.civicS, 0.25) + bld([x0 + 1.5, z0 + 7, x0 + 7, z0 + 17], COL.civicB, COL.civicS, 0.25);
    const fx0 = x0 + 10, fz0 = z0 + 10, fx1 = x1 - 2, fz1 = z1 - 2;
    s += rect(fx0, fz0, fx1 - fx0, fz1 - fz0, `fill="#c96f4a" rx="${f((fz1 - fz0) / 2.2)}"`) + rect(fx0 + 2, fz0 + 2, fx1 - fx0 - 4, fz1 - fz0 - 4, `fill="${COL.pitch}" stroke="#fff" stroke-width="0.15"`);
    return s;
  }
  if (zone === 'hospital') {
    s += bld([cx - 13, z0 + 3, cx + 13, z0 + 9], COL.civicB, COL.civicS, 0.25) + bld([cx - 3, z0 + 9, cx + 3, z1 - 8], COL.civicB, COL.civicS, 0.25) + bld([cx - 13, z1 - 10, cx + 13, z1 - 4], COL.civicB, COL.civicS, 0.25);
    s += circ(x0 + 5, z1 - 5, 2.6, `fill="#d7dccf" stroke="#9aa08f" stroke-width="0.2"`) + `<text x="${f(x0 + 5)}" y="${f(z1 - 4.1)}" font-size="2.6" text-anchor="middle" fill="#5d6455" font-weight="800">H</text>`;
    for (let i = 0; i < 5; i++) s += tree(x1 - 3 - rnd() * 7, z0 + 12 + rnd() * (h - 24), 1.2);
    return s;
  }
  if (zone === 'market') {
    s += bld([x0 + 2, z0 + 2, x1 - 2, z0 + 14], '#d6bf9f', COL.civicS, 0.3) + line([x0 + 2, z0 + 8], [x1 - 2, z0 + 8], `stroke="${COL.civicS}" stroke-width="0.2"`);
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) s += rect(x0 + 3 + i * (w - 6) / 6, z0 + 18 + k * 7, (w - 6) / 6 - 1.2, 4, `fill="${['#e9a46a', '#7fb2d6', '#9ccc86'][(i + k) % 3]}" stroke="#a88c6c" stroke-width="0.12"`);
    return s;
  }
  if (zone === 'campus') {
    s += rect(x0, z0, w, h, `fill="#dfe8cf"`) + pl([[x0, z0], [x1, z1]], 'stroke="#f3eee2" stroke-width="1.6"') + pl([[x1, z0], [x0, z1]], 'stroke="#f3eee2" stroke-width="1.6"');
    s += bld([cx - 12, cz - 5, cx + 12, cz + 5], COL.civicB, COL.civicS, 0.3) + circ(cx, cz, 3.2, `fill="#c9a96b" stroke="${COL.civicS}" stroke-width="0.25"`);
    for (const [ax, az] of [[x0 + 2, z0 + 2], [x1 - 20, z0 + 2], [x0 + 2, z1 - 9], [x1 - 20, z1 - 9]]) s += bld([ax, az, ax + 18, az + 7], COL.civicB, COL.civicS, 0.25);
    for (let i = 0; i < 14; i++) s += tree(x0 + 4 + rnd() * (w - 8), z0 + 12 + rnd() * (h - 24), 1.2);
    return s;
  }
  if (zone === 'stadium') {
    s += rect(x0 + 2, z1 - 12, w - 4, 10, 'fill="url(#stalls)"');
    s += `<ellipse cx="${f(cx)}" cy="${f(cz - 5)}" rx="${f(w * 0.4)}" ry="${f(h * 0.32)}" fill="#cfcac0" stroke="#8d897d" stroke-width="0.35"/><ellipse cx="${f(cx)}" cy="${f(cz - 5)}" rx="${f(w * 0.3)}" ry="${f(h * 0.21)}" fill="#c96f4a"/>`;
    s += rect(cx - w * 0.22, cz - 5 - h * 0.14, w * 0.44, h * 0.28, `fill="${COL.pitch}" stroke="#fff" stroke-width="0.2"`) + line([cx, cz - 5 - h * 0.14], [cx, cz - 5 + h * 0.14], 'stroke="#fff" stroke-width="0.2"');
    return s;
  }
  if (zone === 'park') {
    s += rect(x0, z0, w, h, 'fill="url(#forest)" opacity="0.55"');
    s += `<path d="M ${f(x0)} ${f(z0 + h * 0.3)} C ${f(cx)} ${f(z0)} ${f(cx)} ${f(z1)} ${f(x1)} ${f(z0 + h * 0.7)}" stroke="#f3eee2" stroke-width="1.3" fill="none"/>`;
    if (h > 50) s += `<ellipse cx="${f(cx + 2)}" cy="${f(cz)}" rx="${f(w * 0.28)}" ry="${f(h * 0.14)}" fill="${COL.water}" stroke="${COL.waterEdge}" stroke-width="0.3"/>`;
    return s;
  }
  if (zone === 'station') {
    s += rect(x0, z0, w, h, 'fill="url(#pave)"');
    s += bld([x0 + 1, z0 + 0.5, x1 - 1, z0 + 9], '#cdbfa6', '#8f7f66', 0.35);
    for (let i = 1; i < 8; i++) s += line([x0 + 1 + i * (w - 2) / 8, z0 + 0.5], [x0 + 1 + i * (w - 2) / 8, z0 + 9], 'stroke="#a8977a" stroke-width="0.12"');
    s += circ(cx, cz + 6, 2.4, `fill="${COL.water}" stroke="#b9ad97" stroke-width="0.4"`);
    for (let i = 0; i < 6; i++) s += tree(x0 + 4 + i * (w - 8) / 5, z1 - 2.5, 1.0);
    return s;
  }
  if (zone === 'busterm') {
    s += rect(x0, z0, w, h, 'fill="url(#pave)"') + bld([x0 + 4, z0 + 4, x1 - 4, z0 + 9], '#d3d7db', '#8b939b', 0.25);
    for (let i = 0; i < 7; i++) s += pl([[x0 + 5 + i * 4, z0 + 9], [x0 + 7 + i * 4, z0 + 12], [x0 + 9 + i * 4, z0 + 9]], 'stroke="#8b939b" stroke-width="0.25"');
    return s;
  }
  if (zone === 'railyard') return s;
  if (zone === 'logistics') {
    const n = Math.max(1, Math.round(w / 34));
    for (let i = 0; i < n; i++) { const a = x0 + 2 + i * w / n, c = a + w / n - 4; s += bld([a, z0 + 3, c, z0 + h * 0.6], COL.logB, COL.logS, 0.25); for (let k = a + 2; k < c - 1; k += 3) s += rect(k, z0 + h * 0.6, 1.8, 1.2, `fill="#bfb7a8"`); }
    s += rect(x0 + 2, z1 - 6, w - 4, 4.5, 'fill="url(#stalls)" opacity="0.8"');
    return s;
  }
  if (zone === 'industrial') {
    const nx = Math.max(1, Math.round(w / 36)), nz = Math.max(1, Math.round(h / 26));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = x0 + 2 + i * w / nx, c = a + w / nx - 5, d = z0 + 2 + j * h / nz, e = d + h / nz * 0.62;
      if (rnd() < 0.82) s += bld([a, d, c, e], COL.indB, COL.indS, 0.25) + line([a, (d + e) / 2], [c, (d + e) / 2], `stroke="${COL.indS}" stroke-width="0.12"`);
      else for (let t = 0; t < 3; t++) s += circ(a + 4 + t * 6, d + 4, 2.4, `fill="#d9d4e0" stroke="${COL.indS}" stroke-width="0.25"`);
    }
    s += circ(x1 - 6, z1 - 6, 1.2, `fill="#9c93ab" stroke="${COL.indS}" stroke-width="0.2"`);
    return s;
  }
  return s;
}

function port() {
  let s = '';
  const rnd = mulberry(71), cols = ['#c97b5b', '#6a8fb0', '#9aa864', '#c9a24d', '#8c7aa8', '#5f8f8b'];
  const stack = (x0, z0, x1, z1, vert) => {
    if (vert) { for (let x = x0; x + 2.4 <= x1; x += 3.1) for (let z = z0; z + 6 <= z1; z += 6.8) s += rect(x, z, 2.4, 6, `fill="${cols[Math.floor(rnd() * cols.length)]}" opacity="0.85"`); }
    else for (let z = z0; z + 2.4 <= z1; z += 3.1) for (let x = x0; x + 6 <= x1; x += 6.8) s += rect(x, z, 6, 2.4, `fill="${cols[Math.floor(rnd() * cols.length)]}" opacity="0.85"`);
  };
  for (const p of P.water.piers) {
    stack(p.x0 + 6, p.z0 + 3, Math.min(p.x1, 296) - 6, p.z1 - 3, true);
    for (const x of [p.x0 + 1.8, p.x1 - 1.8]) {   // crane rails along the quay + ship-to-shore gantry cranes with their booms over the water
      if (x > 298) continue;
      const out = x < p.x0 + 5 ? -1 : 1;
      s += line([x, p.z0 + 1], [x, p.z1 - 1], 'stroke="#7d848c" stroke-width="0.3"');
      for (let z = p.z0 + 6; z < p.z1 - 3; z += 12) s += line([x - out * 2, z], [x + out * 9, z], 'stroke="#e05a2a" stroke-width="0.8"') + rect(x - 2.2, z - 1.3, 4.4, 2.6, `fill="#e05a2a" stroke="#8a2f12" stroke-width="0.2"`);
    }
  }
  stack(258, 168, 296, 208); stack(204, 216, 296, 220);
  s += bld([44, 168, 76, 192], COL.logB, COL.logS, 0.3) + line([44, 180], [76, 180], `stroke="${COL.logS}" stroke-width="0.2"`) + bld([86, 168, 152, 190], COL.logB, COL.logS, 0.3) + line([86, 179], [152, 179], `stroke="${COL.logS}" stroke-width="0.2"`);
  for (let i = 0; i < 3; i++) s += circ(50 + i * 10, 209, 3.6, `fill="#ece8dc" stroke="#9c968a" stroke-width="0.3"`) + circ(50 + i * 10, 209, 1.2, `fill="none" stroke="#bdb6a6" stroke-width="0.2"`);
  s += bld([166, 168, 198, 190], '#d9d5ce', '#9a948a', 0.3) + bld([86, 200, 152, 212], COL.logB, COL.logS, 0.3);
  return s;
}

function plaza() {   // the circus: paved ring, a landscaped tree ring, two towers on the free corners (city hall and cathedral hold the other two)
  let s = circ(0, 0, 25, `fill="url(#pave)" stroke="${COL.cbdS}" stroke-width="0.35"`);
  s += circ(0, 0, 19.2, `fill="${COL.park}" stroke="#b9cf9f" stroke-width="0.3"`) + circ(0, 0, 16.2, 'fill="url(#pave)"');
  for (let k = 0; k < 16; k++) { const a = (k + 0.5) * Math.PI / 8; s += tree(Math.cos(a) * 17.7, Math.sin(a) * 17.7, 0.95, COL.treeDark); }
  for (const [x, z] of [[27, -27], [-27, 27]]) s += bld([x - 5, z - 5, x + 5, z + 5], '#9f9585', '#6f6658', 0.3) + bld([x - 2.6, z - 2.6, x + 2.6, z + 2.6], '#887d6d', '#6f6658', 0.2);
  return s;
}

// rail ------------------------------------------------------------------------------------------------
const RZ = P.rail.pts[0][1];
const riverX = (z) => P.water.river.pts.reduce((b, p) => Math.abs(p[1] - z) < Math.abs(b[1] - z) ? p : b)[0];
const underX = P.grade.filter((g) => g.kind === 'underpass').map((g) => [g.at[0], halfW(g.cls) + CLS[g.cls].sidewalk + 0.4]);
function railEmbankment() {
  let s = '';
  const xs = [[-330, 330]];
  const gaps = [...underX, [riverX(RZ), P.water.river.w / 2 + 0.5]].sort((a, b) => a[0] - b[0]);
  let cur = -330;
  const st = P.rail.stations[0];
  for (const [x, hw] of gaps) { s += rect(cur, RZ - 6, x - hw - cur, 12, `fill="${COL.ballast}"`); cur = x + hw; }
  s += rect(cur, RZ - 6, 330 - cur, 12, `fill="${COL.ballast}"`);
  s += rect(st.x0 - 6, RZ - 9.5, st.x1 - st.x0 + 12, 19, `fill="${COL.ballast}"`);
  // yard
  const y = P.rail.yard; s += rect(y.x0 + 2, y.z0 + 12, y.x1 - y.x0 - 4, y.z1 - y.z0 - 12, `fill="${COL.ballast}"`);
  return s;
}
function railTracks(detail) {
  let s = '';
  const tr = (pts, w = 0.5) => pl(pts, `stroke="${COL.rail}" stroke-width="${w}"`) + (detail ? '' : '');
  const st = P.rail.stations[0];
  const trackSet = (z) => s += pl([[-330, z], [330, z]], `stroke="${COL.rail}" stroke-width="0.55"`) + pl([[-330, z], [330, z]], `stroke="#ffffff" stroke-width="0.32" stroke-dasharray="1.2 1.2"`);
  trackSet(RZ - 1.6); trackSet(RZ + 1.6);
  // station tracks + platforms
  for (const z of [RZ - 6.4, RZ + 6.4]) s += pl([[st.x0 - 11, z > RZ ? RZ + 1.6 : RZ - 1.6], [st.x0, z], [st.x1, z], [st.x1 + 11, z > RZ ? RZ + 1.6 : RZ - 1.6]], `stroke="${COL.rail}" stroke-width="0.5"`);
  for (const z of [RZ - 4, RZ + 4]) s += rect(st.x0, z - 1.2, st.x1 - st.x0, 2.4, `fill="#f1ece0" stroke="#9b9384" stroke-width="0.2"`);
  s += rect(st.x0, RZ + 8, st.x1 - st.x0, 1.6, `fill="#f1ece0" stroke="#9b9384" stroke-width="0.2"`);
  // yard fan
  const y = P.rail.yard;
  for (let k = 0; k < 5; k++) { const z = y.z1 - 2 - k * 3; s += pl([[y.joinX, RZ - 1.6], [y.x0 + 4 + k * 2, z], [y.x1 - 2, z]], `stroke="${COL.rail}" stroke-width="0.4"`); }
  s += bld([y.x1 - 22, y.z0 + 1, y.x1 - 1, y.z0 + 9], COL.logB, COL.logS, 0.25);
  // industrial spur + level crossing
  s += pl(P.rail.spur.pts, `stroke="${COL.ballast}" stroke-width="3.2"`) + pl(P.rail.spur.pts, `stroke="${COL.rail}" stroke-width="0.5"`) + pl(P.rail.spur.pts, 'stroke="#fff" stroke-width="0.3" stroke-dasharray="1.2 1.2"');
  for (const [x, z] of P.rail.spur.levelCrossings) s += rect(x - 2, z - 4.2, 4, 8.4, `fill="none" stroke="${COL.sig}" stroke-width="0.35" stroke-dasharray="0.8 0.6"`);
  // bridges over underpasses: deck edges
  for (const [x, hw] of underX) for (const o of [-3.2, 3.2]) s += line([x - hw - 0.6, RZ + o], [x + hw + 0.6, RZ + o], `stroke="${COL.deckEdge}" stroke-width="0.4"`);
  const rv = P.water.river, rxx = riverX(RZ); for (const o of [-3.2, 3.2]) s += line([rxx - rv.w / 2 - 1.5, RZ + o], [rxx + rv.w / 2 + 1.5, RZ + o], `stroke="${COL.deckEdge}" stroke-width="0.5"`);
  return s;
}

// roads ------------------------------------------------------------------------------------------------
const ORDER = ['service', 'local', 'collector', 'arterial', 'motorway'];
function groundRoads(detail) {
  let cas = '', fil = '', mk = '';
  const E = P.edges;
  // casings (all classes) then fills by rank: overlaps fuse into clean junctions
  for (const r of ramps) cas += pl(r.pts, `stroke="${COL.rampC}" stroke-width="${f(CLS.ramp.w + 2 * ROAD.ramp[2])}" stroke-linecap="round" stroke-linejoin="round"`);
  for (const cls of ORDER) for (const e of E.filter((x) => x.cls === cls)) cas += pl(edgePts(e), `stroke="${ROAD[cls][1]}" stroke-width="${f(CLS[cls].w + 2 * ROAD[cls][2])}" stroke-linecap="${cls === 'motorway' ? 'butt' : 'round'}"`);
  for (const r of ramps) fil += pl(r.pts, `stroke="${COL.ramp}" stroke-width="${CLS.ramp.w}" stroke-linecap="round" stroke-linejoin="round"`);
  for (const cls of ORDER) for (const e of E.filter((x) => x.cls === cls)) fil += pl(edgePts(e), `stroke="${ROAD[cls][0]}" stroke-width="${CLS[cls].w}" stroke-linecap="${cls === 'motorway' ? 'butt' : 'round'}"`);
  // markings
  for (const e of E) {
    const t = e.cls === 'motorway' ? edgePts(e) : trimmedEdge(e); if (!t) continue;
    const d = norm([t[1][0] - t[0][0], t[1][1] - t[0][1]]), r = rightOf(d), off = (o) => t.map((p) => [p[0] + r[0] * o, p[1] + r[1] * o]);
    if (e.cls === 'arterial') {
      mk += pl(t, `stroke="${e.bridge ? '#c9c4b8' : COL.median}" stroke-width="${CLS.arterial.median}" stroke-linecap="butt"`);
      if (detail) for (const o of [-1.85, 1.85]) mk += pl(off(o), `stroke="#ffffff" stroke-width="0.12" stroke-dasharray="1.0 1.4"`);
    } else if (e.cls === 'motorway') {
      mk += pl(t, `stroke="${COL.medianM}" stroke-width="${CLS.motorway.median}" stroke-linecap="butt"`) + pl(t, `stroke="#8a8f94" stroke-width="0.2"`);
      for (const o of [-3.175, 3.175]) mk += pl(off(o), `stroke="#ffffff" stroke-width="${detail ? 0.14 : 0.18}" stroke-dasharray="1.6 1.8"`);
      if (detail) for (const o of [-(MW - 0.35), MW - 0.35, -1.4, 1.4]) mk += pl(off(o), `stroke="#ffffff" stroke-width="0.12"`);
    } else if (e.cls === 'collector' && detail) mk += pl(t, `stroke="#c7bea8" stroke-width="0.12" stroke-dasharray="1.0 1.2"`);
  }
  if (detail) for (const r of ramps) mk += arrowsAlong(r.pts, 16, '#9b6229');
  if (detail) for (const e of E.filter((x) => x.cls === 'motorway')) { const [a, b] = edgePts(e), d = norm([b[0] - a[0], b[1] - a[1]]), rr = rightOf(d); for (const side of [1, -1]) { const pts = side > 0 ? [a, b] : [b, a], o = 3.175; mk += arrowsAlong(pts.map((p) => [p[0] + rr[0] * o * side, p[1] + rr[1] * o * side]), 34, '#ffffff'); } }
  return cas + fil + mk;
}
const MW = CLS.motorway.w / 2;
function arrowsAlong(pts, step, col) {
  let s = ''; const L = plLen(pts);
  for (let d = step * 0.6; d < L - 4; d += step) { const { p, h } = pointAt(pts, d), r = rightOf(h), a = [p[0] + h[0] * 0.9, p[1] + h[1] * 0.9], b = [p[0] - h[0] * 0.5 + r[0] * 0.6, p[1] - h[1] * 0.5 + r[1] * 0.6], c = [p[0] - h[0] * 0.5 - r[0] * 0.6, p[1] - h[1] * 0.5 - r[1] * 0.6]; s += poly([a, b, c], `fill="${col}" opacity="0.85"`); }
  return s;
}

function junctionFurniture(detail, ppm) {
  let s = '';
  const zebra = (c, d, half, at, len = 2.0) => { const p = [c[0] + d[0] * at, c[1] + d[1] * at], r = rightOf(d); return line([p[0] - r[0] * half, p[1] - r[1] * half], [p[0] + r[0] * half, p[1] + r[1] * half], `stroke="#ffffff" stroke-width="${len}" stroke-dasharray="0.5 0.5"`); };
  for (const j of P.junctions) {
    const c = j.at;
    if (j.type === 'roundabout') {
      const R = j.R, ring = j.lanes === 2 ? 6.2 : 3.6, top = j.arms.map((a) => a.cls).includes('arterial') ? 'arterial' : 'collector';
      s += circ(c[0], c[1], R + ROAD[top][2], `fill="${ROAD[top][1]}"`) + circ(c[0], c[1], R, `fill="${ROAD[top][0]}"`);
      for (const a of j.arms) { const w = halfW(a.cls); s += line([c[0] + a.dir[0] * (R - 1), c[1] + a.dir[1] * (R - 1)], [c[0] + a.dir[0] * (R + 3), c[1] + a.dir[1] * (R + 3)], `stroke="${ROAD[a.cls][0]}" stroke-width="${f(w * 2)}"`); }
      if (j.lanes === 2) s += circ(c[0], c[1], R - ring / 2, `fill="none" stroke="#ffffff" stroke-width="0.14" stroke-dasharray="1.2 1.2"`);
      s += circ(c[0], c[1], R - ring, `fill="#efe8d6" stroke="#c9bfa7" stroke-width="0.2"`) + circ(c[0], c[1], R - ring - 0.8, `fill="${COL.park}" stroke="#93b97b" stroke-width="0.25"`);
      if (R >= 12) s += circ(c[0], c[1], 2.0, `fill="#c9a96b" stroke="#8d7550" stroke-width="0.25"`); else s += tree(c[0], c[1], 1.6, COL.treeDark);
      for (const a of j.arms) {   // splitter island + zebra with refuge + give-way teeth
        const d = a.dir, r = rightOf(d), w = halfW(a.cls), base = R + 0.6, tip = R + 7.5, iw = Math.min(1.1, w * 0.45);
        s += poly([[c[0] + d[0] * base + r[0] * iw, c[1] + d[1] * base + r[1] * iw], [c[0] + d[0] * tip, c[1] + d[1] * tip], [c[0] + d[0] * base - r[0] * iw, c[1] + d[1] * base - r[1] * iw]], `fill="#dfe9cf" stroke="#ffffff" stroke-width="0.22"`);
        s += zebra(c, d, w, R + 3.4, 1.6);
        if (detail) { const p = [c[0] + d[0] * (R + 0.4), c[1] + d[1] * (R + 0.4)]; s += line([p[0] - r[0] * iw, p[1] - r[1] * iw], [p[0] - r[0] * w, p[1] - r[1] * w], 'stroke="#ffffff" stroke-width="0.35" stroke-dasharray="0.35 0.35"'); }
      }
    } else if (j.type === 'mini') {
      s += circ(c[0], c[1], 4.6, `fill="${COL.coll}"`) + circ(c[0], c[1], 1.7, `fill="#e4ddcb" stroke="#ffffff" stroke-width="0.4"`);
      for (const a of j.arms) s += zebra(c, a.dir, halfW(a.cls), 6.4, 1.4);
    } else if (j.type === 'signal') {
      const hx = Math.max(...j.arms.filter((a) => a.dir[0] === 0).map((a) => halfW(a.cls)), j.terminal ? 1.0 : 0), hz = Math.max(...j.arms.filter((a) => a.dir[1] === 0).map((a) => halfW(a.cls)), j.terminal ? 1.0 : 0);
      for (const a of j.arms) {
        const along = a.dir[0] !== 0 ? hx : hz, w = halfW(a.cls), at = along + 2.2;
        s += zebra(c, a.dir, w, at, 1.9);
        if (detail) { const d = a.dir, r = rightOf([-d[0], -d[1]]), p = [c[0] + d[0] * (at + 1.6), c[1] + d[1] * (at + 1.6)], m = a.cls === 'arterial' ? CLS.arterial.median / 2 : 0; s += line([p[0] + r[0] * m, p[1] + r[1] * m], [p[0] + r[0] * w, p[1] + r[1] * w], 'stroke="#ffffff" stroke-width="0.32"'); }
      }
      const sr = Math.max(0.7, 2.6 / ppm);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) s += circ(c[0] + sx * (hx + 1.1), c[1] + sz * (hz + 1.1), sr, `fill="#2d3136" stroke="#ffffff" stroke-width="${f(sr * 0.3)}"`) + circ(c[0] + sx * (hx + 1.1), c[1] + sz * (hz + 1.1), sr * 0.5, `fill="${COL.sig}"`);
    } else if (j.type === 'priority' && j.major && detail) {
      for (const a of j.arms.filter((x) => x.cls !== j.major)) { const d = a.dir, r = rightOf([-d[0], -d[1]]), at = 2.6, p = [c[0] + d[0] * at, c[1] + d[1] * at]; s += line(p, [p[0] + r[0] * halfW(a.cls), p[1] + r[1] * halfW(a.cls)], 'stroke="#ffffff" stroke-width="0.3" stroke-dasharray="0.4 0.35"'); }
    }
  }
  for (const cr of P.crossings.filter((x) => x.kind === 'ped-signal-midblock' || (x.kind === 'zebra' && x.axis))) {
    const w = halfW(cr.cls), c = cr.at;
    s += line([c[0], c[1] - w], [c[0], c[1] + w], 'stroke="#ffffff" stroke-width="1.9" stroke-dasharray="0.5 0.5"');
    if (cr.kind === 'ped-signal-midblock') { const sr = Math.max(0.7, 2.6 / ppm); for (const sz of [-1, 1]) s += circ(c[0] + 1.8, c[1] + sz * (w + 1.0), sr, `fill="#2d3136" stroke="#fff" stroke-width="${f(sr * 0.3)}"`) + circ(c[0] + 1.8, c[1] + sz * (w + 1.0), sr * 0.5, `fill="${COL.sig}"`); }
  }
  return s;
}

function bridgesAndDecks(detail) {
  let s = '';
  const deck = (pts, w, fill, cas, parapet = true) => {
    s += pl(pts, `stroke="${COL.shadow}" stroke-width="${f(w + 2.6)}" opacity="0.12" stroke-linecap="butt"`);
    s += pl(pts, `stroke="${COL.deckEdge}" stroke-width="${f(w + 1.4)}" stroke-linecap="butt"`) + pl(pts, `stroke="${fill}" stroke-width="${f(w)}" stroke-linecap="butt"`);
    if (parapet) for (const o of [-(w / 2 + 0.35), w / 2 + 0.35]) s += pl(offsetPl(pts, o), `stroke="#f4f1ea" stroke-width="0.22"`);
  };
  const motorDeck = (a, b) => {
    deck([a, b], CLS.motorway.w, COL.motor);
    const d = norm([b[0] - a[0], b[1] - a[1]]), r = rightOf(d), off = (o) => [[a[0] + r[0] * o, a[1] + r[1] * o], [b[0] + r[0] * o, b[1] + r[1] * o]];
    s += pl([a, b], `stroke="#c9c4b8" stroke-width="${CLS.motorway.median}"`) + pl([a, b], 'stroke="#8a8f94" stroke-width="0.25"');
    for (const o of [-3.175, 3.175]) s += pl(off(o), `stroke="#ffffff" stroke-width="0.16" stroke-dasharray="1.6 1.8"`);
  };
  for (const ic of P.interchanges) if (ic.deck) motorDeck(ic.deck[0], ic.deck[1]);
  motorDeck([250, RZ - 9], [250, RZ + 9]);   // M2 over the rail
  for (const [x, z] of P.rail.spur.roadBridges || []) deck([[x - 6, z], [x + 6, z]], CLS.arterial.w, COL.art);   // Северный пр. over the industrial spur (no level crossings)
  // trumpet: the trunk ramps cross the through road on a bridge
  for (const r of ramps) for (const [a, b] of r.bridges || []) { deck([a, b], CLS.ramp.w, COL.ramp); if (detail) s += arrowsAlong([a, b], 6, '#9b6229'); }
  // road bridges over the river: parapets + piers
  for (const g of P.grade.filter((x) => x.kind === 'road-bridge')) {
    const w = CLS[g.cls].w, rv = P.water.river, z = g.at[1], x0 = riverX(z) - rv.w / 2 - 2.5, x1 = riverX(z) + rv.w / 2 + 2.5;
    for (const o of [-(w / 2 + 0.5), w / 2 + 0.5]) s += line([x0, z + o], [x1, z + o], `stroke="${COL.deckEdge}" stroke-width="0.55"`);
  }
  // M1 over the river
  { const x = riverX(-240); for (const o of [-(MW + 0.5), MW + 0.5]) s += line([x - 14, -240 + o], [x + 14, -240 + o], `stroke="${COL.deckEdge}" stroke-width="0.6"`); }
  return s;
}

function pedestrians(detail, ppm) {
  let s = '';
  for (const fb of P.footbridges) {
    const [x, z] = fb.at, h = fb.len / 2, a = fb.axis === 'x' ? [x - h, z] : [x, z - h], b = fb.axis === 'x' ? [x + h, z] : [x, z + h];
    s += pl([a, b], `stroke="#000" stroke-width="2.6" opacity="0.12"`) + pl([a, b], `stroke="${COL.ped}" stroke-width="1.8" stroke-linecap="butt"`) + pl([a, b], 'stroke="#ffffff" stroke-width="0.35" stroke-dasharray="0.7 0.7"');
    for (const p of [a, b]) s += rect(p[0] - 1.3, p[1] - 1.3, 2.6, 2.6, `fill="${COL.ped}" stroke="#ffffff" stroke-width="0.3"`);
  }
  for (const t of P.tunnels) {
    const [x, z] = t.at;
    if (t.axis === 'ring') { s += circ(x, z, 17.5, `fill="none" stroke="${COL.tun}" stroke-width="0.6" stroke-dasharray="1.4 0.9"`); for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) s += rect(x + dx * 12.4 - 1.2, z + dz * 12.4 - 1.2, 2.4, 2.4, `fill="${COL.tun}" stroke="#fff" stroke-width="0.3"`); continue; }
    const h = t.len / 2;
    s += rect(x - 1.4, z - h, 2.8, 2 * h, `fill="none" stroke="${COL.tun}" stroke-width="0.6" stroke-dasharray="1.2 0.8"`);
    for (const e of [-1, 1]) s += rect(x - 1.4, z + e * h - 1.2, 2.8, 2.4, `fill="${COL.tun}" stroke="#fff" stroke-width="0.3"`);
  }
  return s;
}

function transit(detail, ppm) {
  let s = '';
  for (const l of P.transit.lines) {
    const w = Math.max(0.8, 3.2 / ppm);
    s += pl(l.pts, `stroke="#ffffff" stroke-width="${f(w + 0.6)}" stroke-linejoin="round" opacity="0.9"`) + pl(l.pts, `stroke="${l.color}" stroke-width="${f(w)}" stroke-linejoin="round" stroke-dasharray="${l.id === 'B3' ? `${f(w * 4)} ${f(w * 1.2)}` : 'none'}"`);
    for (const st of l.stops) {
      const seg = l.pts.findIndex((p, k) => { const q = l.pts[k + 1]; return q && Math.min(p[0], q[0]) - 0.5 <= st[0] && st[0] <= Math.max(p[0], q[0]) + 0.5 && Math.min(p[1], q[1]) - 0.5 <= st[1] && st[1] <= Math.max(p[1], q[1]) + 0.5; });
      const p = l.pts[Math.max(0, seg)], q = l.pts[Math.max(0, seg) + 1] || p, d = norm([q[0] - p[0], q[1] - p[1]]), r = rightOf(d);
      const e = P.edges.find((g) => { const [a, b] = edgePts(g); return g.cls !== 'motorway' && Math.abs((b[0] - a[0]) * (st[1] - a[1]) - (b[1] - a[1]) * (st[0] - a[0])) < 1e-3 && st[0] >= Math.min(a[0], b[0]) - 0.1 && st[0] <= Math.max(a[0], b[0]) + 0.1 && st[1] >= Math.min(a[1], b[1]) - 0.1 && st[1] <= Math.max(a[1], b[1]) + 0.1; });
      const off = (e ? halfW(e.cls) : 3.2) + 1.0, sr = Math.max(0.9, 3.4 / ppm);
      for (const sd of [1, -1]) s += rect(st[0] + r[0] * off * sd - sr, st[1] + r[1] * off * sd - sr, 2 * sr, 2 * sr, `rx="${f(sr * 0.35)}" fill="#ffffff" stroke="${l.color}" stroke-width="${f(sr * 0.4)}"`);
    }
  }
  return s;
}

// labels ------------------------------------------------------------------------------------------------
const KEY_OBJECTS = ['L1', 'L7', 'L8', 'L5', 'L6', 'L3', 'L4', 'L13', 'L14', 'L2', 'L15', 'L10', 'L9', 'L12', 'L11', 'L16', 'L18', 'L19', 'L17'];
function labels(ppm, vb, detail) {
  const L = Labels(ppm); let s = '';
  const inView = (x, z, m = 4) => x > vb.x0 + m && x < vb.x1 - m && z > vb.z0 + m && z < vb.z1 - m;
  // keep symbols readable: junction furniture, motorways, ramps, the rail corridor and decks are no place for text
  for (const j of P.junctions) {
    if (j.type === 'roundabout') { const r = j.R + 8; L.reserve([j.at[0] - r, j.at[1] - r, j.at[0] + r, j.at[1] + r]); }
    else if (j.type === 'signal' || j.type === 'mini') L.reserve([j.at[0] - 9, j.at[1] - 9, j.at[0] + 9, j.at[1] + 9]);
  }
  for (const e of P.edges.filter((x) => x.cls === 'motorway')) { const [a, b] = edgePts(e); L.reserve([Math.min(a[0], b[0]) - 7, Math.min(a[1], b[1]) - 7, Math.max(a[0], b[0]) + 7, Math.max(a[1], b[1]) + 7]); }
  for (const r of ramps) for (let i = 0; i < r.pts.length; i += 2) { const p = r.pts[i]; L.reserve([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2]); }
  L.reserve([vb.x0 - 50, RZ - 8, vb.x1 + 50, RZ + 8]);
  const fb = [...P.footbridges, ...P.tunnels]; for (const o of fb) L.reserve([o.at[0] - 4, o.at[1] - 4, o.at[0] + 4, o.at[1] + 4]);
  // motorway shields (on the median, away from ramps)
  const shield = (x, z, ref) => { if (!inView(x, z)) return ''; const fs = (detail ? 20 : 18) / ppm, w = fs * 2.3, h = fs * 1.45; return rect(x - w / 2, z - h / 2, w, h, `rx="${f(h * 0.25)}" fill="#1f6f43" stroke="#ffffff" stroke-width="${f(fs * 0.13)}"`) + `<text x="${f(x)}" y="${f(z + fs * 0.36)}" font-size="${f(fs)}" text-anchor="middle" fill="#ffffff" font-weight="800">${ref}</text>`; };
  for (const [x, z, ref] of [[-80, -240, 'М1'], [120, -240, 'М1'], [-262, -240, 'М1'], [250, -175, 'М2'], [250, 60, 'М2'], [250, -320, 'М2']]) s += shield(x, z, ref);
  // street names ON their own line: candidates every 10 m along the line, first free spot nearest to the preferred point
  const pxOf = { arterial: detail ? 24 : 19, collector: detail ? 20 : 15.5, service: detail ? 17 : 13, local: detail ? 17 : 13 };
  const lines = [...P.lines.V.map((l) => ({ ...l, vert: true, c: l.x })), ...P.lines.H.map((l) => ({ ...l, vert: false, c: l.z }))].filter((l) => l.name && !l.lot);
  for (const l of lines) {
    if (!detail && l.cls === 'service' && l.name !== 'Портовая ул.') continue;
    const px = pxOf[l.cls], fsm = px / ppm, want = detail ? 2 : (l.cls === 'arterial' ? 2 : 1), done = [];
    for (const [a, b] of l.spans) {
      const names = l.name.split(' / '), txtOf = (t) => (names.length > 1 && t > 170 ? names[1] : names[0]);
      const cands = []; for (let t = a + 12; t <= b - 12; t += 10) cands.push(t);
      const pref = l.vert ? (a + b) / 2 + (l.c > 0 ? 30 : -30) : (a + b) / 2 + (l.c > 0 ? -50 : 50);
      cands.sort((p, q) => Math.abs(p - pref) - Math.abs(q - pref));
      for (const t of cands) {
        if (done.length >= want) break;
        const x = l.vert ? l.c : t, z = l.vert ? t : l.c; if (!inView(x, z, 14)) continue;
        if (done.some((d) => Math.abs(d - t) < (detail ? 110 : 190))) continue;
        const txt = txtOf(t), len = 0.56 * fsm * txt.length + fsm * 0.4;
        if (t - len / 2 < a + 4 || t + len / 2 > b - 4) continue;
        const out = L.text(x, z, txt, px, { rot: l.vert ? -90 : 0, weight: l.cls === 'arterial' ? 700 : 600, haloW: 0.3, fill: l.cls === 'arterial' ? '#4a3a12' : '#4b4f56' });
        if (out) { s += out; done.push(t); }
      }
    }
  }
  // water
  s += L.text(-205, 120, 'р. Светлая', detail ? 24 : 21, { rot: -90, italic: true, fill: COL.waterInk, weight: 600, halo: false });
  s += L.text(-150, 248, 'СВЕТЛЫЙ ЗАЛИВ', detail ? 26 : 30, { italic: true, fill: COL.waterInk, weight: 600, halo: false, ls: 0.45, wf: 1.0 });
  // districts
  if (!detail) for (const [x, z, t, rot] of [[-120, -61, 'ЦЕНТР', 0], [-118, -145, 'ВОКЗАЛЬНЫЙ', 0], [-257, 20, 'ЗАРЕЧЬЕ', -90], [180, 100, 'ВОСТОЧНЫЙ', -90], [100, -226, 'ПРОМЗОНА', 0], [222, 196, 'ПОРТ', 0], [-140, -300, 'ПОЛЯ', 0], [-135, 174, 'НАБЕРЕЖНАЯ', 0]]) s += L.text(x, z, t, 30, { rot, fill: '#7d7262', op: 0.7, weight: 800, ls: 0.3, haloW: 0.18, wf: 0.75 });
  // key objects: numbered badge + name
  const badgeR = (detail ? 13 : 12) / ppm;
  for (const lm of P.landmarks) {
    if (!inView(lm.at[0], lm.at[1])) continue;
    const num = KEY_OBJECTS.indexOf(lm.id) + 1, px = detail ? 21 : 16, z = lm.at[1] + (lm.kind === 'plaza' ? 31 : 0);
    const t = L.text(lm.at[0] + (num ? badgeR * 1.2 : 0), z, lm.name, px, { weight: 700, fill: lm.kind === 'park' || lm.kind === 'forest' ? '#2f5d1f' : '#30353c', haloW: 0.36 });
    if (!t) continue;
    s += t;
    if (num) { const w = 0.56 * px / ppm * lm.name.length + 0.4 * px / ppm, bx = lm.at[0] + badgeR * 1.2 - w / 2 - badgeR * 1.1; s += circ(bx, z, badgeR, `fill="#1f242b" stroke="#ffffff" stroke-width="${f(badgeR * 0.18)}"`) + `<text x="${f(bx)}" y="${f(z + badgeR * 0.42)}" font-size="${f(badgeR * 1.15)}" text-anchor="middle" fill="#ffffff" font-weight="800">${num}</text>`; }
  }
  // interchange tags
  for (const ic of P.interchanges) {
    const pos = { I1: [-60, -268], I2: [286, -52], I3: [196, -300], I4: [212, 128] }[ic.id], txt = { I1: 'I1 · ромб', I2: 'I2 · ромб', I3: 'I3 · клеверный лист', I4: 'I4 · трубка' }[ic.id];
    if (inView(pos[0], pos[1])) s += L.text(pos[0], pos[1], txt, detail ? 22 : 19, { weight: 800, fill: '#7a4a12', haloW: 0.34, force: true });
  }
  return s;
}

// frame: header, legend, scale bar, north arrow -----------------------------------------------------------
function header(vb, ppm, title, sub) {
  const fs = 30 / ppm, h = 92 / ppm;
  return rect(vb.x0, vb.z0 - h, vb.x1 - vb.x0, h, `fill="#1f242b"`) +
    `<text x="${f(vb.x0 + 24 / ppm)}" y="${f(vb.z0 - h + fs * 1.5)}" font-size="${f(fs)}" fill="#ffffff" font-weight="800">${esc(title)}</text>` +
    `<text x="${f(vb.x0 + 24 / ppm)}" y="${f(vb.z0 - h + fs * 1.5 + 26 / ppm)}" font-size="${f(15 / ppm)}" fill="#c3c9d2" font-weight="500">${esc(sub)}</text>`;
}
function scaleBar(vb, ppm, onDark) {
  const len = [20, 25, 50, 100][[20, 25, 50, 100].findIndex((v) => v * ppm >= 160)] || 100, x1 = vb.x1 - 24 / ppm, x0 = x1 - len, z = vb.z1 - 26 / ppm, fs = 13 / ppm, c = COL.ink;
  return rect(x0 - 10 / ppm, z - 30 / ppm, len + 20 / ppm, 44 / ppm, `rx="${f(6 / ppm)}" fill="#ffffff" opacity="0.88"`) +
    rect(x0, z - 3 / ppm, len / 2, 6 / ppm, `fill="${c}"`) + rect(x0 + len / 2, z - 3 / ppm, len / 2, 6 / ppm, `fill="#ffffff" stroke="${c}" stroke-width="${f(1 / ppm)}"`) +
    `<text x="${f(x0 + len / 2)}" y="${f(z - 9 / ppm)}" font-size="${f(fs)}" text-anchor="middle" fill="${c}" font-weight="600">${len} м игровых = ${len * 2.5} м</text>`;
}
function northArrow(x, z, ppm) { const r = 22 / ppm; return `<g transform="translate(${f(x)} ${f(z)})"><circle r="${f(r)}" fill="#ffffff" stroke="#bdb6a6" stroke-width="${f(1 / ppm)}"/><path d="M0 ${f(-r * 0.78)} L${f(r * 0.34)} ${f(r * 0.45)} L0 ${f(r * 0.22)} L${f(-r * 0.34)} ${f(r * 0.45)}Z" fill="${COL.ink}"/><text y="${f(-r * 1.15)}" font-size="${f(13 / ppm)}" text-anchor="middle" font-weight="800" fill="${COL.ink}">С</text></g>`; }

const LEGEND_PX = 470;
function legend(vb, ppm) {
  const px = (v) => v / ppm, top = vb.z1, H = px(LEGEND_PX), x0 = vb.x0, W = vb.x1 - vb.x0, fs = px(19), row = px(37);
  let s = rect(x0, top, W, H, `fill="#fbfaf7"`) + line([x0, top], [vb.x1, top], `stroke="#cfc8b8" stroke-width="${f(px(3))}"`);
  const cols = [0, 610, 1190, 1760, 2330].map(px), head = (i, t) => `<text x="${f(x0 + cols[i] + px(26))}" y="${f(top + px(46))}" font-size="${f(px(22))}" font-weight="800" fill="${COL.ink}">${esc(t)}</text>`;
  const item = (i, k, sym, t) => { const x = x0 + cols[i] + px(26), z = top + px(86) + k * row; return sym(x, z) + `<text x="${f(x + px(66))}" y="${f(z + fs * 0.36)}" font-size="${f(fs)}" fill="${COL.ink}" font-weight="500">${esc(t)}</text>`; };
  const roadSym = (cls, wpx) => (x, z) => line([x, z], [x + px(52), z], `stroke="${ROAD[cls][1]}" stroke-width="${f(px(wpx + 3))}"`) + line([x, z], [x + px(52), z], `stroke="${ROAD[cls][0]}" stroke-width="${f(px(wpx))}"`) + (cls === 'arterial' ? line([x, z], [x + px(52), z], `stroke="${COL.median}" stroke-width="${f(px(3))}"`) : cls === 'motorway' ? line([x, z], [x + px(52), z], `stroke="${COL.medianM}" stroke-width="${f(px(4))}"`) : '');
  const box = (fill, stroke) => (x, z) => rect(x + px(8), z - px(10), px(36), px(20), `fill="${fill}" stroke="${stroke || '#b9b2a2'}" stroke-width="${f(px(1.2))}"`);
  s += head(0, 'Улицы и дороги');
  [['motorway', 16, 'Автомагистраль М1, М2 (2+2)'], ['ramp', 8, 'Съезд развязки (стрелки: направление)'], ['arterial', 13, 'Проспект 2+2 с разделительной полосой'], ['collector', 9, 'Районная улица 1+1'], ['local', 7, 'Местная улица'], ['service', 7, 'Проезд (порт, P+R)']].forEach(([c, w, t], k) => { s += item(0, k, roadSym(c, w), t); });
  s += item(0, 6, (x, z) => line([x, z], [x + px(52), z], `stroke="${COL.deckEdge}" stroke-width="${f(px(16))}"`) + line([x, z], [x + px(52), z], `stroke="${COL.motor}" stroke-width="${f(px(11))}"`), 'Мост, эстакада (верхний уровень)');
  s += item(0, 7, (x, z) => line([x, z], [x + px(52), z], `stroke="${COL.ballast}" stroke-width="${f(px(14))}"`) + line([x, z - px(3.5)], [x + px(52), z - px(3.5)], `stroke="${COL.rail}" stroke-width="${f(px(2.5))}"`) + line([x, z + px(3.5)], [x + px(52), z + px(3.5)], `stroke="${COL.rail}" stroke-width="${f(px(2.5))}"`), 'Железная дорога, вокзал, депо');
  s += head(1, 'Перекрёстки и переходы');
  s += item(1, 0, (x, z) => circ(x + px(26), z, px(8), `fill="#2d3136" stroke="#fff" stroke-width="${f(px(2))}"`) + circ(x + px(26), z, px(4), `fill="${COL.sig}"`), 'Светофор (в центре через 80 м)');
  s += item(1, 1, (x, z) => circ(x + px(26), z, px(14), `fill="${COL.art}" stroke="${COL.artC}" stroke-width="${f(px(2))}"`) + circ(x + px(26), z, px(7), `fill="${COL.park}"`), 'Кольцо (центр 2 полосы)');
  s += item(1, 2, (x, z) => circ(x + px(26), z, px(11), `fill="#ffffff" stroke="${COL.collC}" stroke-width="${f(px(2))}"`) + circ(x + px(26), z, px(4.5), `fill="#e4ddcb"`), 'Мини-кольцо');
  s += item(1, 3, (x, z) => line([x, z], [x + px(52), z], `stroke="${COL.art}" stroke-width="${f(px(13))}"`) + line([x, z], [x + px(52), z], `stroke="${COL.median}" stroke-width="${f(px(3))}"`) + line([x + px(26), z - px(16)], [x + px(26), z - px(7)], `stroke="${COL.locC}" stroke-width="${f(px(8))}"`), '«Право-право» (разделитель не прерван)');
  s += item(1, 4, (x, z) => line([x + px(8), z], [x + px(44), z], `stroke="#9a9384" stroke-width="${f(px(13))}"`) + line([x + px(8), z], [x + px(44), z], `stroke="#ffffff" stroke-width="${f(px(13))}" stroke-dasharray="${f(px(3))} ${f(px(3))}"`), 'Пешеходный переход «зебра»');
  s += item(1, 5, (x, z) => line([x, z], [x + px(52), z], `stroke="${COL.ped}" stroke-width="${f(px(8))}"`) + rect(x - px(2), z - px(7), px(14), px(14), `fill="${COL.ped}"`) + rect(x + px(40), z - px(7), px(14), px(14), `fill="${COL.ped}"`), 'Надземный пешеходный мост');
  s += item(1, 6, (x, z) => rect(x + px(4), z - px(7), px(44), px(14), `fill="none" stroke="${COL.tun}" stroke-width="${f(px(3))}" stroke-dasharray="${f(px(6))} ${f(px(3))}"`), 'Подземный пешеходный переход');
  s += item(1, 7, (x, z) => line([x + px(26), z - px(14)], [x + px(26), z + px(14)], `stroke="${COL.rail}" stroke-width="${f(px(3))}"`) + rect(x + px(4), z - px(6), px(44), px(12), `fill="${COL.art}" stroke="${COL.deckEdge}" stroke-width="${f(px(2.5))}"`), 'Дорога над ж/д (переездов нет)');
  s += head(2, 'Транспорт');
  P.transit.lines.forEach((l, k) => { s += item(2, k, (x, z) => line([x, z], [x + px(52), z], `stroke="${l.color}" stroke-width="${f(px(6))}"${l.id === 'B3' ? ` stroke-dasharray="${f(px(16))} ${f(px(5))}"` : ''}`) + rect(x + px(19), z - px(8), px(16), px(16), `rx="${f(px(4))}" fill="#fff" stroke="${l.color}" stroke-width="${f(px(3))}"`), `№${l.id.slice(1)} ` + l.name.split(': ')[1]); });
  s += item(2, 3, box('url(#stalls)'), 'P+R, перехватывающая стоянка');
  const c = P.counts;
  [`Узлов ${c.junctions}: светофоров ${c.signals}, колец ${c.roundabouts}`, `Развязок ${c.interchanges}, съездов ${c.ramps}`, `Переходов ${c.crossings}; мостов ${c.footbridges}; тоннелей ${c.tunnels}`, `Кварталов ${c.blocks}; остановок ${c.busStops}`].forEach((t, k) => { s += `<text x="${f(x0 + cols[2] + px(26))}" y="${f(top + px(86) + (4.3 + k * 0.9) * row)}" font-size="${f(px(17))}" fill="${COL.inkSoft}">${esc(t)}</text>`; });
  s += head(3, 'Застройка и природа');
  [[COL.cbdB, COL.cbdS, 'Центр: кварталы с дворами'], [COL.resB, COL.resS, 'Жилые кварталы'], [COL.villa, '#b9c59a', 'Виллы (Заречье)'], [COL.eastB, COL.eastS, 'Микрорайон Восточный'], [COL.civicB, COL.civicS, 'Общественные здания'], [COL.indB, COL.indS, 'Промзона, склады, порт'], [COL.park, '#93b97b', 'Парки, лес, газоны'], [COL.water, COL.waterEdge, 'Река, залив, гавани']].forEach(([fl, st, t], k) => { s += item(3, k, box(fl, st), t); });
  s += head(4, 'Основные объекты');
  KEY_OBJECTS.forEach((id, k) => {
    const lm = P.landmarks.find((l) => l.id === id), col = k < 10 ? 0 : 1, kk = k % 10, x = x0 + cols[4] + px(26) + col * px(330), z = top + px(80) + kk * px(36.5), r = px(13);
    s += circ(x + r, z, r, `fill="#1f242b"`) + `<text x="${f(x + r)}" y="${f(z + r * 0.42)}" font-size="${f(r * 1.15)}" text-anchor="middle" fill="#fff" font-weight="800">${k + 1}</text><text x="${f(x + r * 2.6)}" y="${f(z + fs * 0.36)}" font-size="${f(fs)}" fill="${COL.ink}" font-weight="500">${esc(lm.name)}</text>`;
  });
  return s;
}

// ---------------------------------------------------------------- document
function body(vb, ppm, detail) {
  let s = defs(ppm) + landuse() + water();
  for (const b of P.blocks) s += blockContent(b, detail);
  s += port() + plaza() + railEmbankment() + groundRoads(detail) + streetTrees() + junctionFurniture(detail, ppm) + railTracks(detail) + bridgesAndDecks(detail) + pedestrians(detail, ppm) + transit(detail, ppm) + labels(ppm, vb, detail);
  return s;
}
function svgDoc(full, pxW, inner) {
  const w = full.x1 - full.x0, h = full.z1 - full.z0, pxH = Math.round(pxW * h / w);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(full.x0)} ${f(full.z0)} ${f(w)} ${f(h)}" width="${pxW}" height="${pxH}" font-family="Inter, 'DejaVu Sans', sans-serif" text-rendering="geometricPrecision">${inner}</svg>`, pxH };
}
const views = [];
{
  const vb = { x0: -305, z0: -372, x1: 305, z1: 262 }, px = 3000, ppm = px / (vb.x1 - vb.x0);
  const full = { x0: vb.x0, z0: vb.z0 - 92 / ppm, x1: vb.x1, z1: vb.z1 + LEGEND_PX / ppm };
  const inner = `<clipPath id="mapclip"><rect x="${vb.x0}" y="${vb.z0}" width="${vb.x1 - vb.x0}" height="${vb.z1 - vb.z0}"/></clipPath><g clip-path="url(#mapclip)">${body(vb, ppm, false)}${scaleBar(vb, ppm)}${northArrow(vb.x1 - 40 / ppm, vb.z0 + 40 / ppm, ppm)}</g>` +
    header(vb, ppm, 'Генплан C · схема города (этап C0)', 'Магистрали, развязки, светофоры, переходы, мосты и тоннели, автобусы. Игровые метры (1 игровой = 2,5 настоящих), правостороннее движение. Данные: tools/masterplan/plan-C.json') + legend(vb, ppm);
  views.push({ name: 'plan-C-overview', px, ...svgDoc(full, px, inner) });
}
const crops = [
  ['detail-hub', { x0: -72, z0: -62, x1: 72, z1: 62 }, 'Центральная площадь: двухполосное кольцо R 12, подземный переход, светофоры через 80 м'],
  ['detail-downtown', { x0: -176, z0: -132, x1: 176, z1: 176 }, 'Центр: сетка 40 м, проспекты через 160 м, светофоры через 80 м, «право-право» на местных'],
  ['detail-interchange-I1-diamond', { x0: -108, z0: -292, x1: 108, z1: -188 }, 'I1 ромб: Главный пр. под М1, светофоры на концах съездов через 44 м'],
  ['detail-interchange-I2-diamond', { x0: 186, z0: -106, x1: 306, z1: 106 }, 'I2 ромб: Центральная магистраль под М2, выход к P+R'],
  ['detail-interchange-I3-cloverleaf', { x0: 128, z0: -366, x1: 304, z1: -112 }, 'I3 клеверный лист: М2 над М1, четыре петли R 18 (левые повороты) и четыре внешних съезда'],
  ['detail-station', { x0: -112, z0: -168, x1: 132, z1: -72 }, 'Вокзал: проезды под насыпью, подземные переходы к платформам, автовокзал, депо'],
  ['detail-port-trumpet', { x0: 146, z0: 96, x1: 304, z1: 242 }, 'I4 трубка: М2 заканчивается у порта, петля R 17 и раструб, эстакада над Портовым ш.'],
];
for (const [name, vb, title] of crops) {
  const px = 1800, ppm = px / (vb.x1 - vb.x0), full = { x0: vb.x0, z0: vb.z0 - 92 / ppm, x1: vb.x1, z1: vb.z1 };
  const inner = `<clipPath id="mapclip"><rect x="${vb.x0}" y="${vb.z0}" width="${vb.x1 - vb.x0}" height="${vb.z1 - vb.z0}"/></clipPath><g clip-path="url(#mapclip)">${body(vb, ppm, true)}${scaleBar(vb, ppm)}${northArrow(vb.x1 - 40 / ppm, vb.z0 + 40 / ppm, ppm)}</g>` + header(vb, ppm, title.split(':')[0], title.split(':').slice(1).join(':').trim());
  views.push({ name, px, ...svgDoc(full, px, inner) });
}
for (const v of views) fs.writeFileSync(path.join(OUT, v.name + '.svg'), v.svg);
if (!args.includes('--svg-only')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const v of views) {
      await page.setViewportSize({ width: v.px, height: v.pxH });
      await page.setContent(`<html><body style="margin:0;background:#fff">${v.svg}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, v.name + '.png') });
    }
  } finally { await browser.close(); }
  // palette PNG (256 colours, no dither): 3-5x smaller, visually identical for a flat map
  try { execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]:\n  im=Image.open(p).convert("RGB")\n  im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(p, optimize=True)', ...views.map((v) => path.join(OUT, v.name + '.png'))]); } catch (e) { console.warn('palette pass skipped:', e.message); }
  if (!args.includes('--keep-svg')) for (const v of views) fs.rmSync(path.join(OUT, v.name + '.svg'), { force: true });
  for (const v of views) console.log(v.name + '.png', v.px + 'x' + v.pxH, (fs.statSync(path.join(OUT, v.name + '.png')).size / 1e6).toFixed(2) + ' MB');
}
console.log('written to', OUT);
