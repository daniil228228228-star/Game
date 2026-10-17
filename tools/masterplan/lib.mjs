// Геометрические помощники генплана v161. Координаты - метры мира игры: x на восток, z на юг (на карте север сверху: север = -z).
// Полярные углы: 0 = восток, 90 = юг, 180 = запад, 270 = север (по часовой стрелке на экране).
export const D2R = Math.PI / 180;
export const r1 = (v) => Math.round(v * 10) / 10;
export const P = (th, r) => [r * Math.cos(th * D2R), r * Math.sin(th * D2R)];
export const polarOf = ([x, z]) => ({ th: ((Math.atan2(z, x) / D2R) + 360) % 360, r: Math.hypot(x, z) });
export function arc(th0, th1, r, step = 3, c = [0, 0]) {
  const n = Math.max(2, Math.ceil(Math.abs(th1 - th0) / step) + 1), out = [];
  for (let i = 0; i < n; i++) { const t = th0 + (th1 - th0) * i / (n - 1); const p = P(t, r); out.push([p[0] + c[0], p[1] + c[1]]); }
  return out;
}
export function catmull(pts, seg = 8, closed = false) {
  const out = [], n = pts.length, g = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
export function bez(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([0, 1].map((a) => u * u * u * p0[a] + 3 * u * u * t * p1[a] + 3 * u * t * t * p2[a] + t * t * t * p3[a])); }
  return out;
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
export function segDist(p, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vz * t));
}
export function polyDist(p, pts) { let b = Infinity; for (let i = 1; i < pts.length; i++) b = Math.min(b, segDist(p, pts[i - 1], pts[i])); return b; }
export function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function rot(p, yawDeg, o = [0, 0]) { const c = Math.cos(yawDeg * D2R), s = Math.sin(yawDeg * D2R); return [o[0] + p[0] * c - p[1] * s, o[1] + p[0] * s + p[1] * c]; }
export const xf = (pts, yawDeg, o) => pts.map((p) => rot(p, yawDeg, o));
export const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// сегмент-сегмент пересечение (для проверок)
export function segInter(a, b, c, d) {
  const s1x = b[0] - a[0], s1y = b[1] - a[1], s2x = d[0] - c[0], s2y = d[1] - c[1];
  const den = -s2x * s1y + s1x * s2y; if (Math.abs(den) < 1e-9) return null;
  const s = (-s1y * (a[0] - c[0]) + s1x * (a[1] - c[1])) / den, t = (s2x * (a[1] - c[1]) - s2y * (a[0] - c[0])) / den;
  return (s >= 0 && s <= 1 && t >= 0 && t <= 1) ? [a[0] + t * s1x, a[1] + t * s1y] : null;
}
// выпуклый четырёхугольник: пересечение с кругом/сегментом грубо - через точки
export function quadCenter(q) { return [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length]; }
export function rectPoly(cx, cz, w, d, yawDeg) { return xf([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], yawDeg, [cx, cz]); }
// фасадная полоса лотов вдоль отрезка a->b, внутрь на глубину d (нормаль n - единичная, внутрь)
export function frontageLots(a, b, n, d, front, gap = 0.5) {
  const L = dist(a, b), cnt = Math.floor(L / front); if (cnt < 1) return [];
  const f = L / cnt, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, out = [];
  for (let i = 0; i < cnt; i++) {
    const s0 = i * f + gap / 2, s1 = (i + 1) * f - gap / 2;
    const A = [a[0] + ux * s0, a[1] + uz * s0], B = [a[0] + ux * s1, a[1] + uz * s1];
    out.push({ poly: [A, B, [B[0] + n[0] * d, B[1] + n[1] * d], [A[0] + n[0] * d, A[1] + n[1] * d]], door: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], normal: [-n[0], -n[1]], w: s1 - s0, d });
  }
  return out;
}
