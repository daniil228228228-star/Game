// Height-continuity probe for plan C roads (no browser): walks along the axis of every ribbon of PlanCDataV161.struct (motorway decks, ramps, footbridges) in 0.5 m steps and, across it,
// at several lateral offsets, reading the TOP asphalt-coloured surface of the compiled mesh data (g/r/p/d layers, asph / white / yellow colours).  A jump between consecutive samples
// bigger than slope*step + 3 cm is a step in the road ("the level differs on the same road").  node tools/probe-profile-plan-c.mjs [--jump=0.03] [--list=40]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, surfaces } from './probe-coplanar-plan-c.mjs';
export function buildTop(D, wantColours) {
  const T = surfaces(D).filter((t) => wantColours.has(t.ci)), G = 2, B = new Map(), key = (i, j) => i * 100003 + j;
  T.forEach((t, n) => { const xs = t.p.map((q) => q[0]), zs = t.p.map((q) => q[2]); const i0 = Math.floor(Math.min(...xs) / G), i1 = Math.floor(Math.max(...xs) / G), j0 = Math.floor(Math.min(...zs) / G), j1 = Math.floor(Math.max(...zs) / G); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let a = B.get(k); if (!a) B.set(k, a = []); a.push(n); } });
  const hit = (t, x, z) => { const [a, b, c] = t.p; const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(den) < 1e-12) return null; const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den, w = 1 - u - v, e = -1e-6; if (u < e || v < e || w < e) return null; return u * a[1] + v * b[1] + w * c[1]; };
  return (x, z, maxY = 99) => { const L = B.get(key(Math.floor(x / G), Math.floor(z / G))); if (!L) return null; let best = null; for (const n of L) { const y = hit(T[n], x, z); if (y !== null && y <= maxY && (best === null || y > best)) best = y; } return best; };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith('--' + n + '=')); return a ? Number(a.split('=')[1]) : d; };
  const D = loadData(), P = D.palette, want = new Set([P.asph, P.ramp, P.white, P.yellow].filter((v) => v !== undefined)), top = buildTop(D, want), jump = arg('jump', 0.03);
  // paint (white, +1.2 cm) sits above asphalt: use asphalt only for the profile
  const asph = new Set([P.asph, P.ramp]); const topA = buildTop(D, asph);
  const bad = [];
  let nSamples = 0;
  for (const rb of D.struct.ribbons) {
    const pts = rb.p; let prev = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 0.5)), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      for (let k = 0; k < n; k++) for (const off of [0, -rb.w * 0.3, rb.w * 0.3]) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t - dz * off, z = a[1] + (b[1] - a[1]) * t + dx * off, hy = a[2] + (b[2] - a[2]) * t + 0.05;
        const y = topA(x, z, hy + 1.5); nSamples++;
        if (y === null) { bad.push({ rb: rb.id, x, z, off, kind: 'no asphalt under the axis', y: null, hy }); continue; }
        if (Math.abs(y - hy) > jump) bad.push({ rb: rb.id, x, z, off, kind: 'surface differs from the ribbon profile', y, hy });
      }
    }
  }
  console.log('samples', nSamples, 'bad', bad.length);
  const by = {}; for (const b of bad) { const k = b.rb + ' ' + b.kind; (by[k] = by[k] || []).push(b); }
  for (const [k, l] of Object.entries(by)) console.log(k, l.length, 'e.g.', l.slice(0, 3).map((b) => `(${b.x.toFixed(1)},${b.z.toFixed(1)} off ${b.off.toFixed(1)} y=${b.y?.toFixed?.(3)} want ${(b.hy ?? b.y ?? 0).toFixed(3)})`).join(' '));
}
