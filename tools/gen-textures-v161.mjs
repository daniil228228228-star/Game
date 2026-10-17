// Procedural, deterministic texture generator for the 11 tiled surface families of assets/ (ROADMAP v161 task 7).
//   node tools/gen-textures-v161.mjs                 writes assets/<name>.jpg, <name>-roughness.jpg, <name>-height.png and prints the metrics
//   node tools/gen-textures-v161.mjs --out <dir>     same, into another directory (preview / tests)
//   node tools/gen-textures-v161.mjs --only grass,wood
// This file is the source of truth for those 33 images: the output is a pure function of the code below (seeded PRNG, no
// Math.random, no input images, no network, only node + tools/lib/image-codec-v161.mjs). Edit the recipe, run it, commit the images.
// Every field is built on an integer lattice that wraps at the image size, so each image tiles seamlessly by construction
// (tests/textures.test.mjs re-checks the opposite-edge difference on the decoded files).
// Style: soft clean cartoon low-poly. Calm macro variation + only gentle micro detail (no per-pixel noise, no diagonal weave)
// because the game samples these through anisotropic mip chains and bump maps: pixel-scale energy turns into shimmer.
// Mean colours stay close to the previous files on purpose (the generic "concrete" family tints every building, `createMaterial`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeJpeg, encodePng8 } from './lib/image-codec-v161.mjs';
import { loadImage, metricsOf } from './lib/texture-metrics-v161.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'assets'));
const ONLY = (argOf('--only') || '').split(',').filter(Boolean);
const N = 512; // working resolution of every field; maps are box-downscaled to their file size

// ------------------------------------------------------------------------------------------ noise toolbox
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const smooth5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function lattice(seed, cx, cy) { const r = rng(seed), a = new Float32Array(cx * cy); for (let i = 0; i < a.length; i++) a[i] = r() * 2 - 1; return a; }
function sampleLattice(a, cx, cy, x, y) { // value noise with quintic fade; (x, y) in lattice units, wraps => periodic
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth5(x - xi), fy = smooth5(y - yi);
  const x0 = ((xi % cx) + cx) % cx, x1 = (x0 + 1) % cx, y0 = ((yi % cy) + cy) % cy, y1 = (y0 + 1) % cy;
  const top = a[y0 * cx + x0] + (a[y0 * cx + x1] - a[y0 * cx + x0]) * fx, bot = a[y1 * cx + x0] + (a[y1 * cx + x1] - a[y1 * cx + x0]) * fx;
  return top + (bot - top) * fy;
}
function stats(f) { let s = 0; for (let i = 0; i < f.length; i++) s += f[i]; const m = s / f.length; let v = 0; for (let i = 0; i < f.length; i++) v += (f[i] - m) ** 2; return { mean: m, std: Math.sqrt(v / f.length) }; }
function normalize(f, std = 1, mean = 0) { const s = stats(f), k = s.std > 1e-9 ? std / s.std : 0; for (let i = 0; i < f.length; i++) f[i] = (f[i] - s.mean) * k + mean; return f; }
// fractal value noise, zero mean / unit std. cx,cy = lattice cells of the first octave across the whole image (anisotropic => stretched grain)
function fbm({ cx, cy = cx, oct = 3, gain = 0.5, seed = 1, warp = 0, warpCells = 3 }) {
  const f = new Float32Array(N * N), lats = [];
  for (let o = 0; o < oct; o++) lats.push({ a: lattice(seed * 101 + o * 7919, cx << o, cy << o), cx: cx << o, cy: cy << o, amp: gain ** o });
  const w1 = warp ? lattice(seed * 31 + 5, warpCells, warpCells) : null, w2 = warp ? lattice(seed * 31 + 9, warpCells, warpCells) : null;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let px = x, py = y;
    if (warp) { px = x + warp * N * sampleLattice(w1, warpCells, warpCells, x / N * warpCells, y / N * warpCells); py = y + warp * N * sampleLattice(w2, warpCells, warpCells, x / N * warpCells, y / N * warpCells); }
    let s = 0; for (const l of lats) s += l.amp * sampleLattice(l.a, l.cx, l.cy, px / N * l.cx, py / N * l.cy);
    f[y * N + x] = s;
  }
  return normalize(f);
}
function blur(f, sx, sy = sx) { // periodic separable gaussian (sigma in pixels)
  const pass = (src, sigma, horiz) => {
    if (sigma < 0.3) return src;
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); let ks = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); ks += k[i + r]; }
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * (horiz ? src[y * N + ((x + i + N) % N)] : src[((y + i + N) % N) * N + x]);
      out[y * N + x] = s / ks;
    }
    return out;
  };
  return pass(pass(f, sx, true), sy, false);
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const field = (fn) => { const f = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[y * N + x] = fn(x, y, y * N + x); return f; };
// soft round dots (pebbles, pores, stains): cosine falloff, wrapping positions, amplitude in [-1,1] * a
function dots(count, rMin, rMax, seed, aMin = -1, aMax = 1) {
  const f = new Float32Array(N * N), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const cx = r() * N, cy = r() * N, rad = mix(rMin, rMax, r()), amp = mix(aMin, aMax, r()), R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / rad; if (d >= 1) continue;
      const x = (Math.floor(cx) + dx + N * 4) % N, y = (Math.floor(cy) + dy + N * 4) % N;
      f[y * N + x] += amp * 0.5 * (1 + Math.cos(Math.PI * d));
    }
  }
  return f;
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function toRGB(r, g, b) { const out = new Uint8Array(N * N * 3); for (let i = 0; i < N * N; i++) { out[i * 3] = clamp8(r[i]); out[i * 3 + 1] = clamp8(g[i]); out[i * 3 + 2] = clamp8(b[i]); } return out; }
function gainToMean(rgb, target) { // per-channel gain so the final mean colour equals `target` (keeps the scene palette predictable)
  for (let k = 0; k < 3; k++) {
    for (let it = 0; it < 3; it++) { let s = 0; for (let i = 0; i < N * N; i++) s += rgb[i * 3 + k]; const g = target[k] / (s / (N * N)); for (let i = 0; i < N * N; i++) rgb[i * 3 + k] = clamp8(rgb[i * 3 + k] * g); }
  }
  return rgb;
}
function down(f, size, isByte = true) { // N -> size box filter
  if (size === N) return isByte ? Uint8Array.from(f, clamp8) : f;
  const k = N / size, out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let s = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += f[(y * k + dy) * N + x * k + dx]; out[y * size + x] = clamp8(s / (k * k)); }
  return out;
}
function downRGB(rgb, size) {
  if (size === N) return rgb;
  const k = N / size, out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += rgb[((y * k + dy) * N + x * k + dx) * 3 + c]; out[(y * size + x) * 3 + c] = clamp8(s / (k * k)); }
  return out;
}
// heights are stored as 128 +/- amplitude; `lvl` = amplitude of the field's unit std in 8-bit levels
const heightOf = (f, lvl, mean = 128) => { const o = new Float32Array(f.length); for (let i = 0; i < f.length; i++) o[i] = mean + f[i] * lvl; return o; };
// roughness byte from a mean value (0-255 = 0..1) plus a slow variation
const roughOf = (mean, vary, seed, cells = 4) => { const n = fbm({ cx: cells, oct: 2, seed }); return field((x, y, i) => mean + n[i] * vary); };

// ------------------------------------------------------------------------------------------ recipes
// each recipe returns { rgb (N*N*3 bytes), rough (N*N floats 0-255), height (N*N floats 0-255), target mean colour }
const RECIPES = {};

RECIPES.grass = () => {
  // calm lawn: broad lighter/darker patches, a yellower dry tint in some of them, a very soft clumpy texture (>= 11 px wavelength).
  const macro = fbm({ cx: 3, oct: 3, gain: 0.55, seed: 11, warp: 0.05 }), patch = fbm({ cx: 6, oct: 2, seed: 12, warp: 0.04 }), clump = fbm({ cx: 24, oct: 2, gain: 0.45, seed: 13 });
  const dry = field((x, y, i) => smoothstep(-0.6, 1.6, patch[i] + 0.4 * macro[i])); // wide soft ramp: a tint drift, not visible patches
  const R = field((x, y, i) => 86 + macro[i] * 3.2 + dry[i] * 6 + clump[i] * 1.0);
  const G = field((x, y, i) => 122 + macro[i] * 4.2 + dry[i] * 3 + clump[i] * 1.4);
  const B = field((x, y, i) => 67 + macro[i] * 2.2 - dry[i] * 3 + clump[i] * 0.7);
  return { rgb: gainToMean(toRGB(R, G, B), [88, 123, 66]), rough: roughOf(246, 1.2, 14, 3), height: heightOf(blur(fbm({ cx: 5, oct: 3, seed: 15 }), 3), 7) };
};

RECIPES.dirt = () => {
  const macro = fbm({ cx: 3, oct: 3, gain: 0.55, seed: 21, warp: 0.05 }), mid = fbm({ cx: 9, oct: 2, seed: 22 });
  const pebbles = blur(dots(70, 7, 16, 23, -1, 0.7), 1.2);
  const R = field((x, y, i) => 154 + macro[i] * 5 + mid[i] * 2.2 + pebbles[i] * 7);
  const G = field((x, y, i) => 124 + macro[i] * 4.4 + mid[i] * 2 + pebbles[i] * 6.2);
  const B = field((x, y, i) => 91 + macro[i] * 3.6 + mid[i] * 1.6 + pebbles[i] * 5);
  const h = field((x, y, i) => macro[i] * 5 + mid[i] * 3 + pebbles[i] * 9);
  return { rgb: gainToMean(toRGB(R, G, B), [153, 125, 91]), rough: roughOf(243, 2.2, 24, 4), height: heightOf(blur(h, 2), 1, 128) };
};

RECIPES.asphalt = () => {
  // dark smooth tarmac: nearly flat, a few very soft lighter/darker patches, aggregate only as ~8 px soft specks at ~1 level.
  const macro = fbm({ cx: 4, oct: 3, gain: 0.5, seed: 31, warp: 0.04 }), grit = blur(fbm({ cx: 64, oct: 1, seed: 32 }), 1.1);
  const patches = blur(dots(26, 14, 30, 33, -1, 1), 2);
  const L = field((x, y, i) => macro[i] * 0.9 + grit[i] * 0.7 + patches[i] * 1.3);
  const R = field((x, y, i) => 44 + L[i]), G = field((x, y, i) => 47 + L[i]), B = field((x, y, i) => 52 + L[i] * 1.05);
  return { rgb: gainToMean(toRGB(R, G, B), [44, 47, 52]), rough: roughOf(244, 1.5, 34, 3), height: heightOf(blur(fbm({ cx: 6, oct: 3, seed: 35 }), 3), 5) };
};

RECIPES.concrete = () => {
  // the default building material: warm light grey, very quiet mottling, no joints (they would tile on every wall)
  const macro = fbm({ cx: 4, oct: 3, gain: 0.5, seed: 41, warp: 0.05 }), pores = blur(dots(90, 2.5, 5, 42, -1, 0.15), 0.6);
  const L = field((x, y, i) => macro[i] * 2.3 + pores[i] * 5);
  const R = field((x, y, i) => 211 + L[i]), G = field((x, y, i) => 207 + L[i]), B = field((x, y, i) => 196 + L[i] * 1.05);
  return { rgb: gainToMean(toRGB(R, G, B), [211, 207, 196]), rough: roughOf(232, 3, 43, 4), height: heightOf(blur(field((x, y, i) => macro[i] * 0.6 + pores[i] * 1.5), 1.2), 3.2) };
};

RECIPES.metal = () => {
  // brushed sheet metal: long horizontal streaks, almost flat
  const streak = blur(fbm({ cx: 2, cy: 70, oct: 2, gain: 0.5, seed: 51 }), 6, 1.2), macro = fbm({ cx: 3, oct: 2, seed: 52, warp: 0.04 });
  const L = field((x, y, i) => streak[i] * 1.5 + macro[i] * 1.1);
  const R = field((x, y, i) => 205 + L[i]), G = field((x, y, i) => 209 + L[i]), B = field((x, y, i) => 208 + L[i]);
  return { rgb: gainToMean(toRGB(R, G, B), [205, 209, 208]), rough: roughOf(164, 4, 53, 3), height: heightOf(blur(streak, 1), 1.4) };
};

RECIPES.corrugated = () => {
  // galvanised sheet: 16 soft vertical ribs per tile (sine profile), faint rain streaks
  const ribs = 16, streaks = blur(fbm({ cx: 36, cy: 2, oct: 2, gain: 0.5, seed: 61 }), 1.2, 8), macro = fbm({ cx: 3, oct: 2, seed: 62, warp: 0.04 });
  const prof = field((x) => Math.sin((x / N) * ribs * Math.PI * 2));
  const L = field((x, y, i) => prof[i] * 2.2 + streaks[i] * 1.4 + macro[i] * 1.2);
  const R = field((x, y, i) => 207 + L[i]), G = field((x, y, i) => 211 + L[i]), B = field((x, y, i) => 210 + L[i]);
  return { rgb: gainToMean(toRGB(R, G, B), [207, 211, 210]), rough: field((x, y, i) => 196 + prof[i] * 4 + streaks[i] * 3), height: heightOf(prof, 28, 118) };
};

RECIPES.wood = () => {
  // 4 warm planks (horizontal, 128 px each), soft wavy grain along x, shallow dark joints, one butt joint per plank at its own x
  const planks = 4, ph = N / planks, grain = blur(fbm({ cx: 3, cy: 40, oct: 2, gain: 0.5, seed: 71, warp: 0.03 }), 4, 1.3), fine = blur(fbm({ cx: 6, cy: 90, oct: 1, seed: 72 }), 3, 1.1);
  const tone = [0.0, 0.035, -0.03, 0.02], butt = [0.17, 0.62, 0.38, 0.86];
  const groove = field((x, y) => { // 0..1 depth: horizontal plank joints + one short vertical butt joint per plank
    const row = Math.floor(y / ph), t = (y - row * ph) / ph, dEdge = Math.min(t, 1 - t) * ph;
    let g = 0.75 * Math.exp(-(dEdge * dEdge) / (2 * 2.4 * 2.4));
    const dx = Math.min(Math.abs(x / N - butt[row]), 1 - Math.abs(x / N - butt[row])) * N; g = Math.max(g, 0.5 * Math.exp(-(dx * dx) / (2 * 2.0 * 2.0)));
    return g;
  });
  const lum = field((x, y, i) => { const row = Math.floor(y / ph); return 1 + tone[row] + grain[i] * 0.028 + fine[i] * 0.011 - groove[i] * 0.28; });
  const R = field((x, y, i) => 184 * lum[i]), G = field((x, y, i) => 146 * lum[i]), B = field((x, y, i) => 97 * lum[i]);
  return { rgb: gainToMean(toRGB(R, G, B), [183, 145, 96]), rough: field((x, y, i) => 224 + grain[i] * 3 + groove[i] * 10), height: heightOf(field((x, y, i) => grain[i] * 0.22 + fine[i] * 0.1 - groove[i] * 1.0), 22, 134) };
};

RECIPES['wood-end'] = () => {
  // log cross-section: soft concentric rings round the centre (the UVs put the cap at the middle of the tile), flat bark-ish tone at the
  // tile edges so the tile stays seamless
  const wob = fbm({ cx: 4, oct: 2, seed: 81 }), tint = fbm({ cx: 3, oct: 2, seed: 82 });
  const ring = field((x, y, i) => {
    const dx = x - N / 2, dy = y - N / 2, r = Math.hypot(dx, dy) + wob[i] * 10, env = 1 - smoothstep(0.38 * N, 0.5 * N, Math.hypot(dx, dy));
    return Math.sin((r / 19) * Math.PI * 2) * env; // ~19 px wavelength: calm enough for the 0.45 m tile
  });
  const L = field((x, y, i) => ring[i] * 5 + tint[i] * 1.6);
  const R = field((x, y, i) => 190 + L[i]), G = field((x, y, i) => 152 + L[i] * 0.95), B = field((x, y, i) => 105 + L[i] * 0.85);
  return { rgb: gainToMean(toRGB(R, G, B), [189, 151, 104]), rough: roughOf(230, 2.5, 83, 3), height: heightOf(blur(ring, 1.2), 4, 128) };
};

RECIPES.brick = () => {
  // 8 courses x 4 bricks per tile (course 64 px, brick 128 px, odd courses shifted half a brick), cream mortar, per-brick tone
  const rows = 8, per = 4, bh = N / rows, bw = N / per, mortar = 3.2;
  const cell = rng(91), tone = []; for (let r = 0; r < rows; r++) { tone.push([]); for (let c = 0; c < per; c++) tone[r].push([cell() * 2 - 1, cell() * 2 - 1]); }
  const tex = blur(fbm({ cx: 14, oct: 2, seed: 92 }), 1.5);
  const info = field((x, y) => { // signed distance to the brick body (px, + inside), packed with brick id
    const r = Math.floor(y / bh), off = r % 2 ? bw / 2 : 0, xx = (x + N - off) % N, c = Math.floor(xx / bw);
    const lx = xx - c * bw, ly = y - r * bh, d = Math.min(lx, bw - lx, ly, bh - ly);
    return d;
  });
  const idx = field((x, y) => { const r = Math.floor(y / bh), off = r % 2 ? bw / 2 : 0, c = Math.floor(((x + N - off) % N) / bw); return r * per + c; });
  const body = field((x, y, i) => smoothstep(mortar * 0.5 - 0.5, mortar * 0.5 + 2.2, info[i])); // 0 mortar .. 1 brick, ~3 px ramp
  const edgeShade = field((x, y, i) => 1 - 0.07 * (1 - smoothstep(0, 9, info[i])));
  const R = field((x, y, i) => { const t = tone[Math.floor(idx[i] / per)][idx[i] % per]; return mix(208, (176 + t[0] * 9) * edgeShade[i] + tex[i] * 2, body[i]); });
  const G = field((x, y, i) => { const t = tone[Math.floor(idx[i] / per)][idx[i] % per]; return mix(194, (122 + t[0] * 7 + t[1] * 3) * edgeShade[i] + tex[i] * 1.6, body[i]); });
  const B = field((x, y, i) => { const t = tone[Math.floor(idx[i] / per)][idx[i] % per]; return mix(174, (92 + t[0] * 6 + t[1] * 4) * edgeShade[i] + tex[i] * 1.3, body[i]); });
  return { rgb: gainToMean(toRGB(R, G, B), [179, 141, 112]), rough: field((x, y, i) => mix(238, 230, body[i]) + tex[i] * 1.5), height: heightOf(blur(field((x, y, i) => body[i] * 1 + tex[i] * 0.03), 1.3), 46, 96) };
};

RECIPES.roof = () => {
  // pale neutral shingles (the game tints them red/terracotta): 8 rows x 8 shingles, odd rows shifted half a shingle, soft shadow where a
  // row is overlapped, thin gaps between shingles, per-shingle tone
  const rows = 8, per = 8, rh = N / rows, sw = N / per;
  const cell = rng(101), tone = []; for (let r = 0; r < rows; r++) { tone.push([]); for (let c = 0; c < per; c++) tone[r].push(cell() * 2 - 1); }
  const tex = blur(fbm({ cx: 10, oct: 2, seed: 102 }), 1.5);
  const V = field((x, y) => (y % rh) / rh), Ux = field((x, y) => { const r = Math.floor(y / rh), off = r % 2 ? sw / 2 : 0; return ((x + N - off) % N) % sw; });
  const gap = field((x, y, i) => Math.exp(-(Math.min(Ux[i], sw - Ux[i]) ** 2) / (2 * 1.6 * 1.6)));
  const shade = blur(field((x, y, i) => 1 - 0.11 * (1 - smoothstep(0, 0.2, V[i])) + 0.03 * smoothstep(0.82, 0.97, V[i]) - 0.07 * gap[i]), 1.3); // blurred: the row edge is a ~4 px ramp, not a 1 px step
  const tn = field((x, y, i) => { const r = Math.floor(y / rh), off = r % 2 ? sw / 2 : 0, c = Math.floor(((x + N - off) % N) / sw); return tone[r][c]; });
  const R = field((x, y, i) => (194 + tn[i] * 7 + tex[i] * 1.6) * shade[i]), G = field((x, y, i) => (185 + tn[i] * 6.5 + tex[i] * 1.5) * shade[i]), B = field((x, y, i) => (170 + tn[i] * 6 + tex[i] * 1.4) * shade[i]);
  const h = field((x, y, i) => mix(0.2, 1, smoothstep(0, 0.85, V[i])) - gap[i] * 0.45);
  return { rgb: gainToMean(toRGB(R, G, B), [194, 184, 170]), rough: field((x, y, i) => 212 + tn[i] * 3 + gap[i] * 10 + tex[i] * 1.2), height: heightOf(blur(h, 1.4), 30, 112) };
};

RECIPES.siding = () => {
  // cream clapboard: 12 boards per tile, lit upper edge, soft shadow groove under each board, per-board tone, faint grain
  const boards = 12, grain = blur(fbm({ cx: 2, cy: 56, oct: 2, seed: 111 }), 4, 1.3);
  const cell = rng(112), tone = []; for (let b = 0; b < boards; b++) tone.push(cell() * 2 - 1);
  const T = field((x, y) => { const t = (y / N) * boards; return t - Math.floor(t); }), B_ = field((x, y) => Math.floor((y / N) * boards));
  const groove = field((x, y, i) => { const t = T[i]; return smoothstep(0.72, 0.88, t) * (1 - smoothstep(0.9, 1.0, t)); }); // continuous at the board edge (no 1 px step)
  const lit = field((x, y, i) => smoothstep(0.0, 0.07, T[i]) * (1 - smoothstep(0.07, 0.2, T[i])));
  const lum = field((x, y, i) => 1 + tone[B_[i]] * 0.012 + grain[i] * 0.007 - groove[i] * 0.15 + lit[i] * 0.03);
  const R = field((x, y, i) => 229 * lum[i]), G = field((x, y, i) => 225 * lum[i]), Bc = field((x, y, i) => 214 * lum[i]);
  const h = field((x, y, i) => mix(0.35, 1, smoothstep(0, 0.8, T[i])) - groove[i] * 0.9);
  return { rgb: gainToMean(toRGB(R, G, Bc), [229, 225, 214]), rough: field((x, y, i) => 218 + groove[i] * 6 + grain[i] * 1.5), height: heightOf(blur(h, 1.3), 40, 100) };
};

const ORDER = ['grass', 'dirt', 'asphalt', 'concrete', 'brick', 'corrugated', 'metal', 'roof', 'siding', 'wood', 'wood-end'];
// file sizes (px) and JPEG qualities. Calm textures get a high quality because a flat gradient quantised at a coarse DC step shows 8x8 blocks.
const FILES = {
  grass: { albedo: 512, rough: 128, height: 256, q: 90 }, dirt: { albedo: 512, rough: 128, height: 256, q: 90 },
  asphalt: { albedo: 512, rough: 128, height: 256, q: 92 }, concrete: { albedo: 512, rough: 128, height: 256, q: 90 },
  brick: { albedo: 512, rough: 256, height: 512, q: 85 }, corrugated: { albedo: 512, rough: 128, height: 512, q: 88 },
  metal: { albedo: 512, rough: 128, height: 256, q: 90 }, roof: { albedo: 512, rough: 256, height: 512, q: 85 },
  siding: { albedo: 512, rough: 256, height: 512, q: 88 }, wood: { albedo: 512, rough: 256, height: 512, q: 85 },
  'wood-end': { albedo: 512, rough: 128, height: 256, q: 88 },
};

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const name of ORDER) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const t0 = Date.now(), cfg = FILES[name], r = RECIPES[name]();
  const files = {
    [`${name}.jpg`]: encodeJpeg(cfg.albedo, cfg.albedo, 3, downRGB(r.rgb, cfg.albedo), cfg.q),
    [`${name}-roughness.jpg`]: encodeJpeg(cfg.rough, cfg.rough, 1, down(r.rough, cfg.rough), 90),
    [`${name}-height.png`]: encodePng8(cfg.height, cfg.height, down(r.height, cfg.height)),
  };
  for (const [file, buf] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, file), buf); total += buf.length;
    const m = metricsOf(loadImage(path.join(OUT, file)));
    console.log(`${file.padEnd(24)} ${String(buf.length).padStart(6)} B ${m.width}px mean ${m.mean.join(',')} std ${m.std} lap ${m.lap} hf ${m.hfShare} seam ${m.seamX}/${m.seamY} max ${m.seamMaxX}/${m.seamMaxY}`);
  }
  console.log(`  ${name}: ${Date.now() - t0} ms`);
}
console.log('textures written to', OUT, '| total', total, 'bytes');
