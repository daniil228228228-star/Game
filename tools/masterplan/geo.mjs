// Геометрия плана B (v2): трассировка дорог дугами и прямыми с гарантированной касательностью, тесселяция, расстояния.
// Мировые метры: x на восток, z на юг (север сверху). Курс (heading) в градусах: 0 = восток, 90 = юг, 180 = запад, 270 = север (по часовой на экране).
export const D2R = Math.PI / 180;
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const dir = (deg) => [Math.cos(deg * D2R), Math.sin(deg * D2R)];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (d) => ((d % 360) + 360) % 360;
export const angDiff = (a, b) => { let d = Math.abs(norm(a) - norm(b)); return d > 180 ? 360 - d : d; };
export const P = (th, r, c = [0, 0]) => [c[0] + r * Math.cos(th * D2R), c[1] + r * Math.sin(th * D2R)];
// Сегменты: {k:'L', a, b} | {k:'A', c, r, a0, a1} (углы положения на окружности, a1>a0 = по часовой на экране).
export function trace(start, heading, ops) {
  let pos = start.slice(), h = heading; const segs = [];
  for (const op of ops) {
    if (op[0] === 'L') { const d = dir(h), b = [pos[0] + d[0] * op[1], pos[1] + d[1] * op[1]]; segs.push({ k: 'L', a: pos, b }); pos = b; }
    else if (op[0] === 'A') {
      const r = op[1], dl = op[2], sg = Math.sign(dl), cd = dir(h + 90 * sg), c = [pos[0] + cd[0] * r, pos[1] + cd[1] * r];
      const a0 = h - 90 * sg, a1 = a0 + dl; segs.push({ k: 'A', c, r, a0, a1 });
      pos = [c[0] + r * Math.cos(a1 * D2R), c[1] + r * Math.sin(a1 * D2R)]; h += dl;
    }
  }
  return { segs, end: pos, heading: norm(h) };
}
export const lineSegs = (pts) => pts.slice(1).map((b, i) => ({ k: 'L', a: pts[i], b }));
export const arcSeg = (c, r, a0, a1) => ({ k: 'A', c, r, a0, a1 });
export function segPts(s, step = 2) {
  if (s.k === 'L') return [s.a, s.b];
  const n = Math.max(2, Math.ceil(Math.abs(s.a1 - s.a0) / step) + 1), out = [];
  for (let i = 0; i < n; i++) { const t = (s.a0 + (s.a1 - s.a0) * i / (n - 1)) * D2R; out.push([s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]); }
  return out;
}
export function tess(segs, step = 2) { const out = []; segs.forEach((s) => { const p = segPts(s, step); out.push(...(out.length ? p.slice(1) : p)); }); return out; }
export const segLen = (s) => s.k === 'L' ? dist(s.a, s.b) : Math.abs(s.a1 - s.a0) * D2R * s.r;
export const segsLen = (segs) => segs.reduce((q, s) => q + segLen(s), 0);
export const minRadius = (segs) => segs.filter((s) => s.k === 'A').reduce((m, s) => Math.min(m, s.r), Infinity);
export const polyLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; };
export function segsStartDir(segs) { const s = segs[0]; if (s.k === 'L') return norm(Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) / D2R); const sg = Math.sign(s.a1 - s.a0); return norm(s.a0 + 90 * sg); }
export function segsEndDir(segs) { const s = segs[segs.length - 1]; if (s.k === 'L') return norm(Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) / D2R); const sg = Math.sign(s.a1 - s.a0); return norm(s.a1 + 90 * sg); }
export const segsStart = (segs) => segPts(segs[0])[0];
export const segsEnd = (segs) => { const p = segPts(segs[segs.length - 1]); return p[p.length - 1]; };
export function segDist(p, a, b) { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2)) : 0; return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vz * t)); }
export function polyDist(p, pts) { let b = Infinity; for (let i = 1; i < pts.length; i++) b = Math.min(b, segDist(p, pts[i - 1], pts[i])); return b; }
export function segInter(a, b, c, d) {
  const s1x = b[0] - a[0], s1y = b[1] - a[1], s2x = d[0] - c[0], s2y = d[1] - c[1], den = -s2x * s1y + s1x * s2y; if (Math.abs(den) < 1e-9) return null;
  const s = (-s1y * (a[0] - c[0]) + s1x * (a[1] - c[1])) / den, t = (s2x * (a[1] - c[1]) - s2y * (a[0] - c[0])) / den;
  return (s >= 0 && s <= 1 && t >= 0 && t <= 1) ? [a[0] + t * s1x, a[1] + t * s1y] : null;
}
export function segSegDist(a, b, c, d) { if (segInter(a, b, c, d)) return 0; return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b)); }
export function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) c = !c; } return c; }
export function polyPolylineDist(poly, pts) { // 0 если пересекаются
  if (pts.some((p) => inPoly(p, poly))) return 0; let b = Infinity;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length]; for (let j = 1; j < pts.length; j++) { b = Math.min(b, segSegDist(a, c, pts[j - 1], pts[j])); if (b === 0) return 0; } }
  return b;
}
export function polyPolyDist(p, q) {
  if (p.some((x) => inPoly(x, q)) || q.some((x) => inPoly(x, p))) return 0; let b = Infinity;
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) { b = Math.min(b, segSegDist(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])); if (b === 0) return 0; }
  return b;
}
export const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
export const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
export const centroid = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
export function pointAt(pts, s) { let acc = 0; for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); if (acc + l >= s) { const t = (s - acc) / l; return { p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t], ang: norm(Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) / D2R) }; } acc += l; } const n = pts.length; return { p: pts[n - 1], ang: norm(Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0]) / D2R) }; }
// Радиальные 4-угольные лоты вдоль дуги (для набережной): внутренний радиус rin, глубина d, угловая доля front метров по дуге на радиусе rin
export function arcLots(c, rin, d, th0, th1, front, gap = 1) {
  const L = Math.abs(th1 - th0) * D2R * rin, n = Math.floor(L / front), out = []; if (n < 1) return out;
  for (let i = 0; i < n; i++) {
    const t0 = th0 + (th1 - th0) * (i + gap / (2 * front)) / n, t1 = th0 + (th1 - th0) * (i + 1 - gap / (2 * front)) / n, tm = (t0 + t1) / 2;
    out.push({ poly: [P(t0, rin, c), P(t1, rin, c), P(t1, rin + d, c), P(t0, rin + d, c)], door: P(tm, rin, c), normal: dir(tm + 180) });
  }
  return out;
}
