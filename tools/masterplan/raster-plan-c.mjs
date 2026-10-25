// Plan-view raster of the COMPILED plan C layers (assets/plan-c-data-v161.js) for the marking / kerb / lighting audit (docs/PLAN_C_REAL_WORLD_AUDIT.md parts 3).
// One Uint8 grid per class at RES metres: bit 1 = ground surface, bit 2 = deck (elevated) surface.  x -300..300, z -370..262.
export const X0 = -300, Z0 = -372, W = 600, H = 636;
export function makeRaster(D, RES = 0.2) {
  const nx = Math.ceil(W / RES), nz = Math.ceil(H / RES), P = D.palette, mk = () => new Uint8Array(nx * nz);
  const G = { asph: mk(), walk: mk(), kerb: mk(), paint: mk(), yellow: mk(), island: mk(), median: mk(), lawn: mk(), conc: mk() };
  const cls = (ci) => ci === P.asph || ci === P.ramp ? 'asph' : ci === P.walk || ci === P.promenade || ci === P.plaza ? 'walk' : ci === P.kerb ? 'kerb' : ci === P.white ? 'paint' : ci === P.yellow ? 'yellow' : ci === P.islandL || ci === P.islandC ? 'island' : ci === P.median || ci === P.medM || ci === P.medLawn ? 'median' : ci === P.lawnG || ci === P.lawn || ci === P.grass || ci === P.verge || ci === P.slope || ci === P.grassB ? 'lawn' : ci === P.conc || ci === P.concD || ci === P.wall ? 'conc' : null;
  const ix = (x) => (x - X0) / RES, iz = (z) => (z - Z0) / RES;
  const tri = (grid, bit, ax, az, bx, bz, cx, cz, grow = 0) => {
    const minx = Math.max(0, Math.floor(ix(Math.min(ax, bx, cx)) - grow)), maxx = Math.min(nx - 1, Math.ceil(ix(Math.max(ax, bx, cx)) + grow)), minz = Math.max(0, Math.floor(iz(Math.min(az, bz, cz)) - grow)), maxz = Math.min(nz - 1, Math.ceil(iz(Math.max(az, bz, cz)) + grow));
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-12) return;
    for (let j = minz; j <= maxz; j++) for (let i = minx; i <= maxx; i++) {
      const x = X0 + (i + 0.5) * RES, z = Z0 + (j + 0.5) * RES, u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v, e = grow ? -0.5 * RES / Math.sqrt(Math.abs(den)) : 0;
      if (u >= e && v >= e && w >= e) grid[j * nx + i] |= bit;
    }
  };
  const quad = (grid, bit, x0, z0, x1, z1) => { const a = Math.max(0, Math.floor(ix(Math.min(x0, x1)) + 0.0)), b = Math.min(nx - 1, Math.ceil(ix(Math.max(x0, x1)) - 1)), c = Math.max(0, Math.floor(iz(Math.min(z0, z1)))), d = Math.min(nz - 1, Math.ceil(iz(Math.max(z0, z1)) - 1)); for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) grid[j * nx + i] |= bit; };
  for (const c of Object.values(D.cells)) {
    for (const L of ['g', 'r', 'p']) {
      const o = c[L]; if (!o) continue;
      if (o.q) for (let i = 0; i + 5 < o.q.length; i += 6) { const k = cls(o.q[i + 5]); if (k) quad(G[k], 1, o.q[i], o.q[i + 1], o.q[i + 2], o.q[i + 3]); }
      if (o.t) for (let i = 0; i + 7 < o.t.length; i += 8) { const k = cls(o.t[i + 7]); if (k) tri(G[k], 1, o.t[i], o.t[i + 1], o.t[i + 2], o.t[i + 3], o.t[i + 4], o.t[i + 5], k === 'paint' || k === 'yellow' ? 1 : 0); }
      if (o.w) for (let i = 0; i + 6 < o.w.length; i += 7) { const k = cls(o.w[i + 6]); if (k === 'kerb') { const x0 = o.w[i], z0 = o.w[i + 1], x1 = o.w[i + 2], z1 = o.w[i + 3], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (RES * 0.5))); for (let s = 0; s <= n; s++) { const x = x0 + (x1 - x0) * s / n, z = z0 + (z1 - z0) * s / n, a = Math.floor(ix(x)), b = Math.floor(iz(z)); if (a >= 0 && a < nx && b >= 0 && b < nz) G.kerb[b * nx + a] |= 1; } } }
    }
    const d = c.d; if (d && d.v) for (let i = 0; i + 9 < d.v.length; i += 10) { const k = cls(d.v[i + 9]); if (k) tri(G[k], 2, d.v[i], d.v[i + 2], d.v[i + 3], d.v[i + 5], d.v[i + 6], d.v[i + 8], k === 'paint' || k === 'yellow' ? 1 : 0); }
    if (d && d.s) for (let i = 0; i + 8 < d.s.length; i += 9) { const k = cls(d.s[i + 8]); if (k === 'kerb' || k === 'conc') { const x0 = d.s[i], z0 = d.s[i + 1], x1 = d.s[i + 2], z1 = d.s[i + 3], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (RES * 0.5))); for (let s = 0; s <= n; s++) { const x = x0 + (x1 - x0) * s / n, z = z0 + (z1 - z0) * s / n, a = Math.floor(ix(x)), b = Math.floor(iz(z)); if (a >= 0 && a < nx && b >= 0 && b < nz) G[k][b * nx + a] |= 2; } } }
  }
  const at = (g, x, z, mask = 3) => { const i = Math.floor(ix(x)), j = Math.floor(iz(z)); return i >= 0 && i < nx && j >= 0 && j < nz && (G[g][j * nx + i] & mask) !== 0; };
  // any cell of a class within radius r of (x, z)
  const near = (g, x, z, r, mask = 3) => { const a = Math.floor(ix(x - r)), b = Math.floor(ix(x + r)), c = Math.floor(iz(z - r)), d = Math.floor(iz(z + r)); for (let j = Math.max(0, c); j <= Math.min(nz - 1, d); j++) for (let i = Math.max(0, a); i <= Math.min(nx - 1, b); i++) if (G[g][j * nx + i] & mask) return true; return false; };
  return { G, nx, nz, RES, at, near };
}
