// Draws tools/masterplan/plan-C.json as a map (SVG, then PNG through Chromium).
//   node tools/masterplan/render-plan-c.mjs [outDir=docs/masterplan-c] [--svg-only]
// Output: plan-C-overview.png (whole city) + detail crops (hub, diamond, cloverleaf, station, port trumpet, downtown).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, CLS } from './plan-c.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), OUT = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'docs/masterplan-c');
const P = buildPlan();
fs.mkdirSync(OUT, { recursive: true });
const f = (n) => Math.round(n * 100) / 100;
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rnd = mulberry(77);
const N = new Map(P.nodes.map((n) => [n.id, n]));

const COL = {
  land: '#ece8da', water: '#9cc8e6', waterEdge: '#7fb0d2', park: '#bfd9a0', parkDark: '#a8c98a', tree: '#7fae6b',
  cbd: '#d9d3c5', residential: '#e6dfcc', mixed: '#e0d6c0', east: '#e9e2cd', villas: '#dfe6c7', station: '#d8d4cc', warehouse: '#d3d1cd', industrial: '#cfcbd4', port: '#d0d6dc', waterfront: '#e4e0cf', campus: '#d7dfc8', stadium: '#c6dcb1', wood: '#b9d3a0',
  bldgCbd: '#a7a39a', bldgRes: '#cbbf9f', bldgInd: '#aaa7b3', bldgPort: '#a5aeb7', roof: '#b9503b',
  motor: '#f2a94e', motorCase: '#8a5a1e', art: '#f9df8a', artCase: '#9a8a45', coll: '#ffffff', collCase: '#a6a08c', loc: '#ffffff', locCase: '#bdb6a1', ramp: '#f2a94e',
  rail: '#5b6068', railTie: '#e8e4d8', bridge: '#d8d3c4', bus1: '#e4572e', bus2: '#2e86e4', bus3: '#3aa655', sig: '#d9382c', ink: '#2b2f36',
};
const VB = { x0: -330, z0: -338, x1: 330, z1: 346 };
const GRASS = ['park', 'stadium', 'campus', 'wood', 'villas', 'waterfront'];

function svgDoc(vb, body) {
  const w = vb.x1 - vb.x0, h = vb.z1 - vb.z0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x0} ${vb.z0} ${w} ${h}" width="${w * 5}" height="${h * 5}" font-family="Inter, Arial, sans-serif">${body}</svg>`;
}
const line = (x0, z0, x1, z1, st) => `<line x1="${f(x0)}" y1="${f(z0)}" x2="${f(x1)}" y2="${f(z1)}" ${st}/>`;
const rect = (x, z, w, h, st) => `<rect x="${f(x)}" y="${f(z)}" width="${f(w)}" height="${f(h)}" ${st}/>`;
const circ = (x, z, r, st) => `<circle cx="${f(x)}" cy="${f(z)}" r="${f(r)}" ${st}/>`;

function water() {
  let s = '';
  const sea = P.water.sea.z;
  s += rect(-330, sea, 660, 150, `fill="${COL.water}"`);
  // port basins: three piers into the sea at x 60..220 and a marina in the west
  for (const x of [70, 130, 190]) s += rect(x, sea - 0.5, 34, 30, `fill="${COL.port}" stroke="${COL.waterEdge}" stroke-width="0.6"`);
  s += rect(-110, sea - 0.5, 90, 10, `fill="${COL.waterfront}" stroke="${COL.waterEdge}" stroke-width="0.6"`);
  for (let i = 0; i < 8; i++) s += rect(-104 + i * 11, sea + 9, 1.4, 11, `fill="#fff" opacity="0.9"`);   // marina pontoons
  const rv = P.water.river;
  s += `<path d="M ${rv.x - 6} ${-338} C ${rv.x + 8} -250 ${rv.x - 10} -150 ${rv.x + 4} -60 S ${rv.x - 6} 100 ${rv.x} ${sea}" stroke="${COL.water}" stroke-width="${rv.w}" fill="none" stroke-linecap="butt"/>`;
  return s;
}
function riverClip() { return ''; }

function blocks() {
  let s = '';
  for (const b of P.blocks) {
    const [x0, z0, x1, z1] = b.rect, zone = b.zone;
    s += rect(x0, z0, x1 - x0, z1 - z0, `fill="${COL[zone] || COL.land}"`);
  }
  // buildings and landscape
  for (const b of P.blocks) {
    const [x0, z0, x1, z1] = b.rect, zone = b.zone, m = 4.2, ix0 = x0 + m, ix1 = x1 - m, iz0 = z0 + m, iz1 = z1 - m, w = ix1 - ix0, h = iz1 - iz0;
    if (w < 6 || h < 6) continue;
    if (zone === 'cbd') {
      const nx = Math.max(1, Math.round(w / 17)), nz = Math.max(1, Math.round(h / 17));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const cw = w / nx - 2.2, ch = h / nz - 2.2, ox = ix0 + i * w / nx + 1.1, oz = iz0 + j * h / nz + 1.1, tall = rnd() < 0.3;
        s += rect(ox, oz, cw, ch, `fill="${tall ? '#8f8b82' : COL.bldgCbd}" stroke="#7c786f" stroke-width="0.25"/>`.replace('/>', ''));
        if (tall) s += rect(ox + cw * 0.22, oz + ch * 0.22, cw * 0.56, ch * 0.56, `fill="#b4b0a5" stroke="#7c786f" stroke-width="0.2"`);
      }
    } else if (zone === 'residential' || zone === 'mixed' || zone === 'east' || zone === 'villas') {
      const lot = zone === 'villas' ? 14 : 8;
      for (let x = ix0; x + lot <= ix1 + 0.1; x += lot) for (const z of [iz0, iz1 - 6.5]) {
        if (rnd() < (zone === 'villas' ? 0.35 : 0.08)) continue;
        s += rect(x + 1, z + (z === iz0 ? 0.5 : 0), lot - 2, 6, `fill="${zone === 'villas' ? '#d9cfb4' : COL.bldgRes}" stroke="#9b8f72" stroke-width="0.2"`);
        s += rect(x + 1, z + (z === iz0 ? 0.5 : 0), lot - 2, 1.6, `fill="${COL.roof}" opacity="0.55"`);
      }
      for (let z = iz0 + 8; z + 8 <= iz1 - 8; z += 8) for (let x = ix0 + 2; x + 7 <= ix1 - 2; x += 8) if (rnd() < (zone === 'villas' ? 0.25 : 0.5)) s += rect(x + 1, z, 6, 5.2, `fill="${COL.bldgRes}" stroke="#9b8f72" stroke-width="0.2"`);
      if (zone !== 'villas' && rnd() < 0.45) for (let i = 0; i < 4; i++) s += circ(ix0 + 2 + rnd() * (w - 4), iz0 + 8 + rnd() * Math.max(1, h - 16), 1.4, `fill="${COL.tree}" opacity="0.8"`);
    } else if (zone === 'industrial' || zone === 'warehouse') {
      const nx = Math.max(1, Math.round(w / 28)), nz = Math.max(1, Math.round(h / 22));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) s += rect(ix0 + i * w / nx + 1.5, iz0 + j * h / nz + 2, w / nx - 3, h / nz * 0.62, `fill="${COL.bldgInd}" stroke="#8d8a97" stroke-width="0.25"`);
      if (zone === 'industrial') s += circ(ix0 + w * 0.8, iz0 + h * 0.75, 2.6, `fill="#c3bfcb" stroke="#8d8a97" stroke-width="0.3"`);
    } else if (zone === 'port') {
      for (let i = 0; i < 5; i++) s += rect(ix0 + 1, iz0 + 2 + i * (h / 5), w - 2, h / 5 - 3, `fill="${i % 2 ? '#c97b5b' : '#6a8fb0'}" opacity="0.65"`);
    } else if (zone === 'park' || zone === 'wood') {
      for (let i = 0; i < Math.floor(w * h / 38); i++) s += circ(ix0 + rnd() * w, iz0 + rnd() * h, 1.2 + rnd() * 1.2, `fill="${rnd() < 0.5 ? COL.tree : COL.parkDark}" opacity="0.8"`);
      s += `<path d="M ${f(ix0)} ${f(iz0 + h * 0.7)} Q ${f(ix0 + w * 0.5)} ${f(iz0 + h * 0.3)} ${f(ix1)} ${f(iz0 + h * 0.55)}" stroke="#f1ead1" stroke-width="1.1" fill="none"/>`;
    } else if (zone === 'stadium') {
      s += `<ellipse cx="${f((ix0 + ix1) / 2)}" cy="${f((iz0 + iz1) / 2)}" rx="${f(w * 0.46)}" ry="${f(h * 0.4)}" fill="#c9c6bb" stroke="#8d897d" stroke-width="0.4"/>` + `<ellipse cx="${f((ix0 + ix1) / 2)}" cy="${f((iz0 + iz1) / 2)}" rx="${f(w * 0.34)}" ry="${f(h * 0.28)}" fill="#7fb36b" stroke="#fff" stroke-width="0.3"/>`;
    } else if (zone === 'campus') {
      for (let i = 0; i < 3; i++) s += rect(ix0 + 3 + i * (w / 3), iz0 + 4 + (i % 2) * 14, w / 3 - 5, 9, `fill="${COL.bldgCbd}" stroke="#7c786f" stroke-width="0.25"`);
      for (let i = 0; i < 6; i++) s += circ(ix0 + 4 + rnd() * (w - 8), iz1 - 6 - rnd() * 8, 1.3, `fill="${COL.tree}" opacity="0.85"`);
    } else if (zone === 'station') {
      s += rect(ix0 + 2, iz0 + h * 0.55, w - 4, 7, `fill="#bdb8ad" stroke="#8d897d" stroke-width="0.3"`);
    } else if (zone === 'waterfront') {
      s += `<path d="M ${f(x0 + 3)} ${f(z1 - 5)} L ${f(x1 - 3)} ${f(z1 - 5)}" stroke="#f1ead1" stroke-width="1.6"/>`;
      for (let i = 0; i < Math.floor(w / 9); i++) s += circ(ix0 + 3 + i * 9, z1 - 8.5, 1.1, `fill="${COL.tree}"`);
    }
  }
  return s;
}

const edgeXY = (e) => { const a = N.get(e.a), b = N.get(e.b); return [a.x, a.z, b.x, b.z]; };
function roads() {
  let s = '';
  const order = ['local', 'collector', 'arterial', 'motorway'];
  const sty = {
    local: [COL.locCase, COL.loc, 1.0], collector: [COL.collCase, COL.coll, 1.0], arterial: [COL.artCase, COL.art, 1.1], motorway: [COL.motorCase, COL.motor, 1.4],
  };
  for (const cls of order) {
    const es = P.edges.filter((e) => e.cls === cls && !e.bridge);
    for (const e of es) { const [x0, z0, x1, z1] = edgeXY(e), w = CLS[cls].w + 1.6; s += line(x0, z0, x1, z1, `stroke="${sty[cls][0]}" stroke-width="${f(w)}" stroke-linecap="butt"`); }
    for (const e of es) {
      const [x0, z0, x1, z1] = edgeXY(e), w = CLS[cls].w;
      s += line(x0, z0, x1, z1, `stroke="${sty[cls][1]}" stroke-width="${f(w)}" stroke-linecap="butt"`);
      if (cls === 'arterial') {
        s += line(x0, z0, x1, z1, `stroke="#5f9a56" stroke-width="${CLS.arterial.median}" stroke-linecap="butt"`);
        for (const o of [-1.6, 1.6]) s += offsetLine(x0, z0, x1, z1, o, `stroke="#c9b25a" stroke-width="0.12" stroke-dasharray="1.2 1.6"`);
      }
      if (cls === 'motorway') {
        s += line(x0, z0, x1, z1, `stroke="#6aa05c" stroke-width="${CLS.motorway.median}" stroke-linecap="butt"`);
        for (const o of [-2.0, 2.0, -4.6, 4.6]) s += offsetLine(x0, z0, x1, z1, o, `stroke="#fff" stroke-width="0.16" ${Math.abs(o) > 4 ? '' : 'stroke-dasharray="1.6 1.8"'}`);
      }
      if (cls === 'collector' || cls === 'local') s += line(x0, z0, x1, z1, `stroke="#d9d2bb" stroke-width="0.1" stroke-dasharray="1.2 1.6"`);
    }
  }
  // bridges over the river
  for (const e of P.edges.filter((e) => e.bridge)) {
    const [x0, z0, x1, z1] = edgeXY(e), w = CLS[e.cls].w;
    s += line(x0, z0, x1, z1, `stroke="${COL.bridge}" stroke-width="${f(w + 3)}" stroke-linecap="butt"`);
    s += line(x0, z0, x1, z1, `stroke="#8d897d" stroke-width="${f(w + 3)}" stroke-dasharray="0.5 0" opacity="0.001"`);
    for (const o of [-(w / 2 + 1.2), w / 2 + 1.2]) s += offsetLine(x0, z0, x1, z1, o, `stroke="#7a766b" stroke-width="0.35"`);
    s += line(x0, z0, x1, z1, `stroke="${CLS[e.cls] && e.cls === 'arterial' ? COL.art : COL.coll}" stroke-width="${f(w)}" stroke-linecap="butt"`);
  }
  return s;
}
function offsetLine(x0, z0, x1, z1, o, st) { const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * o, nz = dx / l * o; return line(x0 + nx, z0 + nz, x1 + nx, z1 + nz, st); }

function rail() {
  let s = '';
  const r = P.rail, [a, b] = r.pts, z = a[1];
  s += line(a[0], z, b[0], z, `stroke="#8b8a82" stroke-width="9.5"`);   // embankment
  s += line(a[0], z, b[0], z, `stroke="#a39f93" stroke-width="7"`);
  for (const o of [-2.1, -0.7, 0.7, 2.1]) s += line(a[0], z + o, b[0], z + o, `stroke="${COL.rail}" stroke-width="0.32"`);
  s += line(a[0], z, b[0], z, `stroke="${COL.railTie}" stroke-width="5.2" stroke-dasharray="0.35 1.0" opacity="0.8"`);
  const sp = r.spur.pts; let d = `M ${sp[0][0]} ${sp[0][1]}`; for (const p of sp.slice(1)) d += ` L ${p[0]} ${p[1]}`;
  s += `<path d="${d}" stroke="#8b8a82" stroke-width="3.6" fill="none"/><path d="${d}" stroke="${COL.rail}" stroke-width="0.4" fill="none" stroke-dasharray="1.2 0.8"/>`;
  const st = r.stations[0];
  s += rect(st.at[0] - st.len / 2, z - 6.6, st.len, 2.2, `fill="#e8e1cf" stroke="${COL.rail}" stroke-width="0.3"`) + rect(st.at[0] - st.len / 2, z + 4.4, st.len, 2.2, `fill="#e8e1cf" stroke="${COL.rail}" stroke-width="0.3"`);
  s += rect(st.at[0] - 18, z - 22, 36, 11, `fill="#cfc8b4" stroke="#7c786f" stroke-width="0.4"`) + rect(st.at[0] - 8, z - 19.5, 16, 6, `fill="${COL.roof}" opacity="0.7"`);
  // rail bridge over the river
  s += rect(P.water.river.x - 13, z - 5.4, 26, 10.8, `fill="#b9b5a7" stroke="#6b685f" stroke-width="0.4"`);
  s += line(P.water.river.x - 13, z, P.water.river.x + 13, z, `stroke="${COL.rail}" stroke-width="0.32"`);
  // underpasses: a short portal mark at each road passing under the embankment
  for (const g of P.grade.filter((g) => g.kind === 'underpass')) s += rect(g.at[0] - 3.6, z - 5.2, 7.2, 10.4, `fill="none" stroke="#4a4e55" stroke-width="0.35" stroke-dasharray="1 0.8"`);
  return s;
}

function arcPath(c, r, a0, sweep) {
  const p = (a) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r], s0 = p(a0), s1 = p(a0 + sweep);
  return `M ${f(s0[0])} ${f(s0[1])} A ${r} ${r} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${f(s1[0])} ${f(s1[1])}`;
}
function interchanges() {
  let s = '';
  for (const ic of P.interchanges) {
    const paths = [];
    for (const r of ic.ramps) { const [a, b, c] = r.pts; paths.push(`M ${a[0]} ${a[1]} Q ${b[0]} ${b[1]} ${c[0]} ${c[1]}`); }
    for (const l of ic.loops || []) { const toCentre = Math.atan2(ic.at[1] - l.c[1], ic.at[0] - l.c[0]); paths.push(arcPath(l.c, l.r, toCentre + Math.PI / 4, Math.PI * 1.5)); }
    for (const d of paths) s += `<path d="${d}" fill="none" stroke="${COL.motorCase}" stroke-width="3.6" stroke-linecap="round"/>`;
    for (const d of paths) s += `<path d="${d}" fill="none" stroke="${COL.ramp}" stroke-width="2.0" stroke-linecap="round"/>`;
    for (const d of paths) s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.14" stroke-dasharray="1 1"/>`;
    if (ic.kind === 'diamond') for (const t of ic.terminals) s += circ(t[0], t[1], 1.5, `fill="${COL.sig}" stroke="#fff" stroke-width="0.4"`);
    // grade-separated main road: the crossing road passes UNDER the motorway deck
    s += circ(ic.at[0], ic.at[1], 0.01, 'fill="none"');
  }
  return s;
}

function junctionMarks() {
  let s = '';
  for (const j of P.junctions) {
    const [x, z] = j.at;
    if (j.type === 'signal') {
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) s += circ(x + dx * 4.6, z + dz * 4.6, 0.8, `fill="${COL.sig}" stroke="#222" stroke-width="0.2"`);
      // zebra bars on the four arms
      const aw = j.classes.includes('arterial') ? 3.2 : 1.8;
      for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = -2; k <= 2; k++) {
        const px = x + ux * (aw + 2.4), pz = z + uz * (aw + 2.4);
        s += line(px + (uz ? k * 1.1 : 0), pz + (ux ? k * 1.1 : 0), px + (uz ? k * 1.1 : 0) + (ux ? 0 : 0), pz + (ux ? k * 1.1 : 0), `stroke="#fff" stroke-width="0.4"`).replace('/>', ' opacity="0.9"/>');
      }
    } else if (j.type === 'roundabout-mini') {
      s += circ(x, z, 4.2, `fill="#fff" stroke="${COL.collCase}" stroke-width="0.5"`) + circ(x, z, 1.8, `fill="#9bc07e" stroke="#7f9a68" stroke-width="0.3"`);
    } else if (j.type === 'roundabout-2lane') {
      s += circ(x, z, 10.4, `fill="${COL.art}" stroke="${COL.artCase}" stroke-width="0.7"`) + circ(x, z, 7.4, `fill="none" stroke="#c9b25a" stroke-width="0.2" stroke-dasharray="1.4 1.4"`) + circ(x, z, 5.2, `fill="#bcd99f" stroke="#7f9a68" stroke-width="0.5"`) + circ(x, z, 2.2, `fill="#8fbf74" stroke="#6b8a55" stroke-width="0.3"`);
    } else if (j.type === 'riro') {
      s += circ(x, z, 1.0, `fill="#e8913a" stroke="#fff" stroke-width="0.25"`);
    }
  }
  return s;
}

function transit() {
  let s = '';
  for (const l of P.transit.lines) {
    const col = COL[l.id.toLowerCase().replace('b', 'bus')];
    const off = l.id === 'B1' ? 2.0 : l.id === 'B2' ? 2.0 : 2.8;
    let d = '';
    l.pts.forEach((p, i) => { const q = l.pts[i + 1] || p, pr = l.pts[i - 1] || p, dx = (q[0] - pr[0]), dz = (q[1] - pr[1]), L = Math.hypot(dx, dz) || 1; d += (i ? ' L ' : 'M ') + f(p[0] + (-dz / L) * off) + ' ' + f(p[1] + (dx / L) * off); });
    s += `<path d="${d}" stroke="#fff" stroke-width="1.7" fill="none" opacity="0.85"/><path d="${d}" stroke="${col}" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`;
    for (const st of l.stops) {
      const i = l.pts.findIndex((p, k) => { const q = l.pts[k + 1]; return q && Math.min(p[0], q[0]) - 1 <= st[0] && st[0] <= Math.max(p[0], q[0]) + 1 && Math.min(p[1], q[1]) - 1 <= st[1] && st[1] <= Math.max(p[1], q[1]) + 1; });
      const p = l.pts[Math.max(0, i)], q = l.pts[Math.max(0, i) + 1] || p, dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      s += circ(st[0] + (-dz / L) * off, st[1] + (dx / L) * off, 1.25, `fill="#fff" stroke="${col}" stroke-width="0.55"`);
    }
  }
  return s;
}

function pedestrian() {
  let s = '';
  for (const fb of P.footbridges) {
    const [x, z] = fb.at, vertical = /М2|Западн|Восточн|Главн/.test(fb.over) && !/Центральная магистраль/.test(fb.over), len = fb.len;
    s += vertical ? line(x, z - len / 2, x, z + len / 2, `stroke="#7a4fa6" stroke-width="1.5"`) : line(x - len / 2, z, x + len / 2, z, `stroke="#7a4fa6" stroke-width="1.5"`);
    s += vertical ? line(x, z - len / 2, x, z + len / 2, `stroke="#fff" stroke-width="0.4" stroke-dasharray="0.6 0.6"`) : line(x - len / 2, z, x + len / 2, z, `stroke="#fff" stroke-width="0.4" stroke-dasharray="0.6 0.6"`);
    s += circ(x, z, 2.6, `fill="#7a4fa6" stroke="#fff" stroke-width="0.5"`) + `<text x="${x}" y="${z + 1.1}" font-size="3.2" fill="#fff" text-anchor="middle" font-weight="700">М</text>`;
  }
  for (const t of P.tunnels) { s += circ(t.at[0], t.at[1], 2.3, `fill="#3b6ea5" stroke="#fff" stroke-width="0.5"`) + `<text x="${t.at[0]}" y="${t.at[1] + 1.1}" font-size="3.0" fill="#fff" text-anchor="middle" font-weight="700">Т</text>`; }
  return s;
}

function labels() {
  let s = '';
  const t = (x, z, txt, size, st = '') => `<text x="${f(x)}" y="${f(z)}" font-size="${size}" text-anchor="middle" fill="${COL.ink}" ${st}>${txt}</text>`;
  const rot = (x, z, txt, size, a, st = '') => `<text transform="translate(${f(x)} ${f(z)}) rotate(${a})" font-size="${size}" text-anchor="middle" fill="${COL.ink}" ${st}>${txt}</text>`;
  s += rot(0, -190, 'Главный проспект', 4.2, -90, 'font-weight="700" opacity="0.8"') + rot(-160, -60, 'Западный проспект', 4.2, -90, 'font-weight="700" opacity="0.8"') + rot(160, 60, 'Восточный проспект', 4.2, -90, 'font-weight="700" opacity="0.8"');
  s += t(120, -3, 'Центральная магистраль', 4.2, 'font-weight="700" opacity="0.8"') + t(-60, -163, 'Северный проспект', 4.2, 'font-weight="700" opacity="0.8"') + t(-60, 163, 'Южный проспект', 4.2, 'font-weight="700" opacity="0.8"');
  s += t(-120, -253, 'М1 Северная хорда', 4.6, 'font-weight="800" fill="#7a4a12"') + rot(253, -190, 'М2 Восточная хорда', 4.6, -90, 'font-weight="800" fill="#7a4a12"');
  for (const l of P.landmarks) s += t(l.at[0], l.at[1] + (l.kind === 'plaza' ? 17 : 0), l.name, l.kind === 'port' || l.kind === 'station' || l.kind === 'plaza' ? 4.2 : 3.4, 'font-weight="600" opacity="0.85" paint-order="stroke" stroke="#fff" stroke-width="0.9"');
  s += t(P.water.river.x, 60, 'Река', 4.2, 'font-style="italic" fill="#2a5d85"') + t(0, 232, 'Море', 5.2, 'font-style="italic" fill="#2a5d85"');
  for (const j of P.interchanges) s += t(j.at[0] + (j.id === 'I3' ? -22 : -26), j.at[1] + (j.id === 'I1' ? -22 : 34), j.id, 3.6, 'font-weight="800" fill="#7a4a12" paint-order="stroke" stroke="#fff" stroke-width="0.8"');
  return s;
}

function frame() {
  let s = '';
  const L = VB.x0 + 8, T = VB.z0 + 6;
  s += rect(VB.x0, VB.z0, VB.x1 - VB.x0, 30, `fill="#20242b"`) + `<text x="${L}" y="${T + 14}" font-size="12" fill="#fff" font-weight="800">ГЕНПЛАН C · схема города (этап C0)</text><text x="${L}" y="${T + 24}" font-size="5.2" fill="#c8ccd4">Планировка для Tycoon City 3D: магистрали, развязки, светофоры, переходы, транспорт. Игровые метры (1 игровой = 2,5 настоящих). Данные: tools/masterplan/plan-C.json</text>`;
  // legend
  const lx = VB.x0 + 6, lz = VB.z1 - 76, items = [
    ['motor', 'Автомагистраль (2+2, развязки)'], ['art', 'Проспект (2+2, светофоры, клумба)'], ['coll', 'Коллектор (1+1, мини-кольца)'], ['loc', 'Местная улица'],
  ];
  s += rect(lx, lz, 186, 70, `fill="#fff" stroke="#c9c4b4" stroke-width="0.4" opacity="0.96"`);
  items.forEach(([k, txt], i) => { s += line(lx + 6, lz + 8 + i * 8, lx + 20, lz + 8 + i * 8, `stroke="${COL[k === 'motor' ? 'motor' : k === 'art' ? 'art' : k === 'coll' ? 'collCase' : 'locCase']}" stroke-width="${k === 'motor' ? 4 : k === 'art' ? 3.2 : k === 'coll' ? 2.2 : 1.4}"`) + `<text x="${lx + 25}" y="${lz + 9.6 + i * 8}" font-size="4.2" fill="${COL.ink}">${txt}</text>`; });
  const sym = [
    [() => circ(lx + 8, lz + 42, 1.3, `fill="${COL.sig}" stroke="#222" stroke-width="0.25"`), 'Светофор (перекрёсток проспектов, центр)'],
    [() => circ(lx + 8, lz + 50, 3, `fill="#fff" stroke="${COL.collCase}" stroke-width="0.5"`) + circ(lx + 8, lz + 50, 1.3, 'fill="#9bc07e"'), 'Кольцо (центр 2 полосы, мини на коллекторах)'],
    [() => circ(lx + 8, lz + 58, 1.3, `fill="#e8913a" stroke="#fff" stroke-width="0.25"`), 'Право-право на проспекте вне центра'],
  ];
  sym.forEach(([fn, txt], i) => { s += fn() + `<text x="${lx + 25}" y="${lz + 43.6 + i * 8}" font-size="4.2" fill="${COL.ink}">${txt}</text>`; });
  const rx = lx + 190;
  s += rect(rx, lz, 186, 70, `fill="#fff" stroke="#c9c4b4" stroke-width="0.4" opacity="0.96"`);
  const items2 = [['#7a4fa6', 'М · пешеходный мост (пандус / лифт)'], ['#3b6ea5', 'Т · подземный переход'], [COL.bus1, 'Автобус 1 (P+R · центр · набережная)'], [COL.bus2, 'Автобус 2 (вокзал · центр · порт)'], [COL.bus3, 'Автобус 3 (кольцо по проспектам)'], ['#5b6068', 'Железная дорога; подземные проезды под насыпью']];
  items2.forEach(([c, txt], i) => { s += circ(rx + 8, lz + 8 + i * 9.4, 2.2, `fill="${c}" stroke="#fff" stroke-width="0.4"`) + `<text x="${rx + 15}" y="${lz + 9.6 + i * 9.4}" font-size="4.2" fill="${COL.ink}">${txt}</text>`; });
  // scale bar: 100 game m = 250 real m
  s += line(VB.x1 - 130, VB.z1 - 12, VB.x1 - 30, VB.z1 - 12, `stroke="${COL.ink}" stroke-width="1.2"`) + line(VB.x1 - 130, VB.z1 - 15, VB.x1 - 130, VB.z1 - 9, `stroke="${COL.ink}" stroke-width="0.8"`) + line(VB.x1 - 30, VB.z1 - 15, VB.x1 - 30, VB.z1 - 9, `stroke="${COL.ink}" stroke-width="0.8"`) + `<text x="${VB.x1 - 80}" y="${VB.z1 - 17}" font-size="4.4" text-anchor="middle" fill="${COL.ink}">100 м игровых = 250 м настоящих</text>`;
  s += `<g transform="translate(${VB.x1 - 18} ${VB.z0 + 52})"><circle r="9" fill="#fff" stroke="#c9c4b4" stroke-width="0.4"/><path d="M0 -7 L3 4 L0 2 L-3 4 Z" fill="${COL.ink}"/><text y="-9.6" font-size="5" text-anchor="middle" font-weight="800">С</text></g>`;
  return s;
}

function body(withFrame) {
  return `<rect x="-400" y="-400" width="900" height="900" fill="${COL.land}"/>` + water() + blocks() + roads() + rail() + interchanges() + junctionMarks() + transit() + pedestrian() + labels() + (withFrame ? frame() : '');
}
fs.writeFileSync(path.join(OUT, 'plan-C-overview.svg'), svgDoc(VB, body(true)));
const crops = [
  ['detail-hub', { x0: -70, z0: -70, x1: 70, z1: 70 }], ['detail-downtown', { x0: -170, z0: -170, x1: 170, z1: 170 }],
  ['detail-interchange-I1-diamond', { x0: -90, z0: -300, x1: 90, z1: -200 }], ['detail-interchange-I3-cloverleaf', { x0: 160, z0: -300, x1: 300, z1: -190 }],
  ['detail-station', { x0: -110, z0: -175, x1: 110, z1: -85 }], ['detail-port-trumpet', { x0: 40, z0: 120, x1: 300, z1: 235 }],
];
for (const [name, vb] of crops) fs.writeFileSync(path.join(OUT, name + '.svg'), svgDoc(vb, body(false)));
if (!args.includes('--svg-only')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const shot = async (name, wpx) => {
      const svg = fs.readFileSync(path.join(OUT, name + '.svg'), 'utf8'), m = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number), h = Math.round(wpx * m[3] / m[2]);
      await page.setViewportSize({ width: wpx, height: h });
      await page.setContent(`<html><body style="margin:0">${svg.replace(/width="[^"]*" height="[^"]*"/, `width="${wpx}" height="${h}"`)}</body></html>`);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
    };
    await shot('plan-C-overview', 3000);
    for (const [name] of crops) await shot(name, 1800);
  } finally { await browser.close(); }
  for (const n of ['plan-C-overview', ...crops.map((c) => c[0])]) fs.rmSync(path.join(OUT, n + '.svg'), { force: true });
}
console.log('written to', OUT);
