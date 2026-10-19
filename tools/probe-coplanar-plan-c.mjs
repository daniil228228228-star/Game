// Coplanar-surface probe for plan C (no browser): z-fighting happens where two up-facing surfaces of the drawn world overlap in plan view and are closer than the depth buffer can
// resolve.  Reads assets/plan-c-data-v161.js, turns every up-facing triangle / quad of the ground (g), road (r), paint (p) and deck (d) layers into 3D triangles, and for sample points
// inside two DIFFERENT triangles measures |dy|.  Prints a histogram of the separation and the worst places.   node tools/probe-coplanar-plan-c.mjs [--tol=0.02] [--list=30] [--json]
// Rule used by tests/plan-c-roads.test.mjs: no overlap with |dy| < MIN_SEP (default 0.02 m) except the 'allowed' pairs listed below (identical surfaces drawn once).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadData() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/plan-c-data-v161.js'), 'utf8');
  const w = {}; new Function('window', src.replace(/^[^]*?(?=window\.)/, ''))(w); return w.PlanCDataV161;
}
export function surfaces(D) {   // -> [{L, ax..cz (a,b,c = x,y,z), id}]
  const T = []; let id = 0;
  for (const c of Object.values(D.cells)) for (const L of ['g', 'r', 'p', 'd']) {
    const l = c[L]; if (!l) continue;
    if (l.q) for (let i = 0; i < l.q.length; i += 6) { const q = l.q.slice(i, i + 6); const [x0, z0, x1, z1, y] = q; const ci = q[5]; T.push({ L, ci, id: id++, p: [[x0, y, z0], [x0, y, z1], [x1, y, z1]] }, { L, ci, id: id++, p: [[x0, y, z0], [x1, y, z1], [x1, y, z0]] }); }
    if (l.t) for (let i = 0; i < l.t.length; i += 8) T.push({ L, ci: l.t[i + 7], id: id++, p: [[l.t[i], l.t[i + 6], l.t[i + 1]], [l.t[i + 2], l.t[i + 6], l.t[i + 3]], [l.t[i + 4], l.t[i + 6], l.t[i + 5]]] });
    if (l.v) for (let i = 0; i < l.v.length; i += 10) {
      const p = [[l.v[i], l.v[i + 1], l.v[i + 2]], [l.v[i + 3], l.v[i + 4], l.v[i + 5]], [l.v[i + 6], l.v[i + 7], l.v[i + 8]]];
      const ny = (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]);   // |ny| ~ area; steep faces (walls) are skipped below
      const ax = (p[1][1] - p[0][1]) * (p[2][2] - p[0][2]) - (p[1][2] - p[0][2]) * (p[2][1] - p[0][1]), az = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      const nl = Math.hypot(ax, ny, az); if (nl < 1e-9 || Math.abs(ny) / nl < 0.5) continue;
      T.push({ L, ci: l.v[i + 9], id: id++, p });
    }
  }
  return T;
}
export function scan(T, { tol = 0.02, grid = 4, sameColourToo = false, colours = null, hex = null } = {}) {
  const B = new Map(), key = (i, j) => i * 100003 + j;
  const bb = T.map((t) => { const xs = t.p.map((q) => q[0]), zs = t.p.map((q) => q[2]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; });
  T.forEach((t, n) => { const b = bb[n]; const i0 = Math.floor(b[0] / grid), i1 = Math.floor(b[2] / grid), j0 = Math.floor(b[1] / grid), j1 = Math.floor(b[3] / grid); if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) return; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let a = B.get(k); if (!a) B.set(k, a = []); a.push(n); } });
  const bary = (t, x, z) => { const [a, b, c] = t.p; const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(den) < 1e-12) return null; const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den, w = 1 - u - v; const e = 1e-4; if (u < e || v < e || w < e) return null; return u * a[1] + v * b[1] + w * c[1]; };
  const hist = {}, worst = new Map();
  for (let n = 0; n < T.length; n++) {
    const t = T[n], [a, b, c] = t.p, area = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2; if (area < 1e-3) continue;
    const m = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(area / 0.3))));
    for (let i = 0; i < m; i++) for (let j = 0; j + i < m; j++) {
      const u = (i + 0.33) / m, v = (j + 0.33) / m, w = 1 - u - v, x = a[0] * u + b[0] * v + c[0] * w, z = a[2] * u + b[2] * v + c[2] * w, y = a[1] * u + b[1] * v + c[1] * w;
      const L = B.get(key(Math.floor(x / grid), Math.floor(z / grid))); if (!L) continue;
      for (const o of L) { if (o <= n) continue; const yo = bary(T[o], x, z); if (yo === null) continue;
        if (!sameColourToo && (T[o].ci === t.ci || (hex && Math.abs(hex[T[o].ci] - hex[t.ci]) < 1))) continue;   // same colour = invisible
        const d = Math.abs(yo - y); if (d >= tol) continue;
        const nm = (q) => colours ? colours[q.ci] : q.ci; const k = [t.L + ':' + nm(t), T[o].L + ':' + nm(T[o])].sort().join(' / ') + ' dy<' + (d < 0.001 ? '1mm' : d < 0.005 ? '5mm' : d < 0.01 ? '10mm' : '20mm'); hist[k] = (hist[k] || 0) + 1;
        const wk = Math.round(x / 6) + ',' + Math.round(z / 6) + ' ' + k; const e = worst.get(wk); if (!e) worst.set(wk, { x, z, y, d, k, n: 1 }); else { e.n++; if (d < e.d) e.d = d; }
      }
    }
  }
  return { hist, places: [...worst.values()].sort((p, q) => q.n - p.n) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith('--' + n + '=')); return a ? Number(a.split('=')[1]) : d; };
  const D = loadData(), T = surfaces(D), r = scan(T, { tol: arg('tol', 0.02), colours: Object.keys(D.palette), hex: D.colors.map((h) => typeof h === 'string' ? parseInt(h.replace('#', ''), 16) : h) });
  console.log('up-facing triangles', T.length); console.log(JSON.stringify(r.hist, null, 1)); console.log('places', r.places.length);
  for (const p of r.places.slice(0, arg('list', 30))) console.log(`  (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) y=${p.y.toFixed(3)} samples=${p.n} ${p.k} minDy=${(p.d * 1000).toFixed(1)}mm`);
}
