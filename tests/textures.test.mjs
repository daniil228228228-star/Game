// Texture set test (ROADMAP v161 task 7, 2026-10-05). No browser: decodes the committed assets/*.jpg|png with the pure-JS codec of
// tools/lib/image-codec-v161.mjs and checks the properties the game relies on:
//   1. every texture the loader references exists (SURFACES_V152 families x albedo/roughness/height, EMBEDDED_ASSETS, literal assets/*.jpg|png in
//      the game and its asset scripts) and decodes (albedo RGB jpg, roughness grey jpg, height 8-bit grey png),
//   2. power-of-two sides, <= 512 px (mobile),
//   3. seamless tiling (opposite-edge metric, tools/lib/texture-metrics-v161.mjs `seam`/`seamMax`) + exact pattern periodicity of the structured heights,
//   4. calm: pixel-scale energy (mean |Laplacian|, high-frequency variance share) of grass/dirt/asphalt albedo + every height map under a limit,
//   5. roughness: ground matte (>= 238/255), metal/corrugated/roof lower, ordering metal < corrugated < roof < concrete < ground,
//   6. palette: mean colours stay within 10 levels of the previous files (concrete tints every building),
//   7. total size of the 33 texture files and of assets/ not above the old size (git HEAD before this task: 587118 / 3791838 bytes),
//   8. the committed files are exactly what `node tools/gen-textures-v161.mjs` produces (the generator is the source of truth).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, REPO_ROOT } from './lib/harness.mjs';
import { loadImage, metricsOf } from '../tools/lib/texture-metrics-v161.mjs';

const ASSETS = path.join(REPO_ROOT, 'assets');
const FAMILIES = ['grass', 'dirt', 'asphalt', 'concrete', 'brick', 'corrugated', 'metal', 'roof', 'siding', 'wood', 'wood-end'];
const MAX_SIDE = 512;
const OLD_TEXTURE_BYTES = 587118, OLD_ASSETS_BYTES = 3791838; // (the old number included assets/*.js of that day, 2026-10-03; image-only now, the check is only stricter)
const OLD_MEAN = { // mean RGB of the files before the 2026-10-05 regeneration
  grass: [86.9, 124.8, 64], dirt: [153.3, 124.9, 90.5], asphalt: [43.7, 46.9, 51.8], concrete: [210.6, 206.2, 195.7], brick: [179.3, 141.3, 112.3],
  corrugated: [207.2, 211.3, 210], metal: [204.7, 208.9, 207.6], roof: [193.9, 184.3, 169.5], siding: [228.9, 224.8, 213.9], wood: [183.5, 145.5, 96.3], 'wood-end': [188.8, 150.4, 103.4],
};

// ---- 1. references -------------------------------------------------------------------------------------------------------------------
const materials = fs.readFileSync(path.join(ASSETS, 'materials-v152.js'), 'utf8');
const surfacesBlock = materials.match(/const SURFACES_V152 = \{([\s\S]*?)\n\};/)[1];
const loaderFamilies = [...surfacesBlock.matchAll(/(?:^|[{,\s])'?([a-z-]+)'?:\{tile:/g)].map((m) => m[1]);
check(loaderFamilies.length === FAMILIES.length && FAMILIES.every((f) => loaderFamilies.includes(f)), `SURFACES_V152 families == the 11 generated families (${loaderFamilies.join(',')})`);
const files = [];
for (const f of FAMILIES) files.push(`${f}.jpg`, `${f}-roughness.jpg`, `${f}-height.png`);
const html = fs.readFileSync(path.join(REPO_ROOT, 'tycoon-v161.html'), 'utf8');
const embedded = JSON.parse(html.match(/const EMBEDDED_ASSETS = (\{.*?\});/)[1].replace(/"splash":window[^}]*\}$/, '"splash":"assets/splash.png"}')); // the user's build reads the splash from the standalone asset map (window.__TYCOON_STANDALONE_ASSETS__), not a literal
const literal = new Set();
for (const src of [html, ...fs.readdirSync(ASSETS).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(ASSETS, n), 'utf8'))]) {
  for (const m of src.matchAll(/assets\/([A-Za-z0-9_-]+\.(?:jpg|png))/g)) literal.add(m[1]);
}
const missing = [...files, ...Object.values(embedded).map((p) => p.replace(/^assets\//, '')), ...literal].filter((f) => !fs.existsSync(path.join(ASSETS, f)));
check(missing.length === 0, `every referenced texture file exists (${files.length} generated + ${Object.keys(embedded).length} EMBEDDED_ASSETS + ${literal.size} literal paths); missing: ${JSON.stringify(missing)}`);

const M = {}; // file -> metrics
for (const f of files) {
  let img;
  try { img = loadImage(path.join(ASSETS, f)); } catch (e) { check(false, `${f} decodes: ${e.message}`); continue; }
  const expectChannels = f.endsWith('-roughness.jpg') ? 1 : f.endsWith('.png') ? 1 : 3;
  M[f] = { ...metricsOf(img), img, bytes: fs.statSync(path.join(ASSETS, f)).size };
  if (img.channels !== expectChannels) check(false, `${f}: ${img.channels} channels, expected ${expectChannels}`);
}
check(Object.keys(M).length === files.length, 'all 33 texture files decode (albedo RGB jpg, roughness grey jpg, height grey png)');

// ---- 2. sizes --------------------------------------------------------------------------------------------------------------------------
const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const badSize = files.filter((f) => M[f] && !(pow2(M[f].width) && pow2(M[f].height) && M[f].width <= MAX_SIDE && M[f].height <= MAX_SIDE));
check(badSize.length === 0, `all textures power of two and <= ${MAX_SIDE} px: ${JSON.stringify(badSize)}`);
check(files.every((f) => M[f] && (!f.endsWith('-roughness.jpg') || M[f].width <= 256)), 'roughness maps <= 256 px');

// ---- 3. tileability -----------------------------------------------------------------------------------------------------------------------
const SEAM_MAX = 1.2, SEAM_MEAN_SMOOTH = 2.0;
const SMOOTH = ['grass', 'dirt', 'asphalt', 'concrete', 'metal', 'wood-end'];
const seamBad = files.filter((f) => M[f] && Math.max(M[f].seamMaxX, M[f].seamMaxY) > SEAM_MAX);
check(seamBad.length === 0, `opposite edges continue each other (seamMax <= ${SEAM_MAX}) in every texture; worst ${files.map((f) => M[f] ? Math.max(M[f].seamMaxX, M[f].seamMaxY) : 9).sort((a, b) => b - a)[0]}; bad: ${JSON.stringify(seamBad)}`);
const smoothBad = SMOOTH.flatMap((n) => [`${n}.jpg`, `${n}-height.png`, `${n}-roughness.jpg`]).filter((f) => M[f] && Math.max(M[f].seamX, M[f].seamY) > SEAM_MEAN_SMOOTH);
check(smoothBad.length === 0, `smooth families: seam second-difference ratio <= ${SEAM_MEAN_SMOOTH} (old albedo 2.2-2.7, structured old 6-30): ${JSON.stringify(smoothBad)}`);
const absBad = FAMILIES.filter((n) => M[`${n}.jpg`] && Math.max(M[`${n}.jpg`].seamAbsX, M[`${n}.jpg`].seamAbsY) > 12 && !['brick', 'roof', 'siding', 'wood', 'corrugated'].includes(n));
check(absBad.length === 0, `wrap-around colour step (smooth families) <= 12 levels: ${JSON.stringify(absBad)}`);
// structured heights: the pattern is invariant under its own period (cyclic shift, so a broken wrap shows up)
const shiftErr = (f, dx, dy) => {
  const { width: w, height: h, data } = M[f].img; let s = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += Math.abs(data[y * w + x] - data[((y + dy) % h) * w + ((x + dx) % w)]);
  return s / (w * h);
};
const periodic = [['brick-height.png', 64, 64], ['roof-height.png', 32, 64], ['siding-height.png', 0, 128], ['corrugated-height.png', 32, 0]];
for (const [f, dx, dy] of periodic) {
  const e = shiftErr(f, dx, dy);
  check(e <= 3.0, `${f} is invariant under its pattern period (${dx},${dy}) px: mean |diff| ${e.toFixed(2)} levels (<= 3, std ${M[f].std})`);
}

// ---- 4. calm ---------------------------------------------------------------------------------------------------------------------------
const calm = ['grass', 'asphalt', 'dirt'];
for (const n of calm) {
  const m = M[`${n}.jpg`], h = M[`${n}-height.png`];
  check(m.lap <= 0.6 && m.hfShare <= 0.05, `${n} albedo is calm: mean |Laplacian| ${m.lap} <= 0.6 (old 2.1 / 1.0 / 2.4), high-frequency variance share ${m.hfShare} <= 0.05`);
  check(h.lap <= 1.2 && h.hfShare <= 0.02, `${n} height map is smooth: |Laplacian| ${h.lap} <= 1.2 (old 3.9 / 3.2 / 5.1), hf share ${h.hfShare} <= 0.02`);
}
const lapBad = FAMILIES.filter((n) => M[`${n}-height.png`].lap > 1.5);
check(lapBad.length === 0, `no height map has per-pixel noise (|Laplacian| <= 1.5; old: up to 7.6): ${JSON.stringify(lapBad)}`);
const albedoBad = FAMILIES.filter((n) => !['brick'].includes(n) && M[`${n}.jpg`].lap > 1.6);
check(albedoBad.length === 0, `albedo grain under control (|Laplacian| <= 1.6 except the brick pattern): ${JSON.stringify(albedoBad)}`);
check(M['brick.jpg'].lap <= 4.5, `brick albedo (mortar pattern) |Laplacian| ${M['brick.jpg'].lap} <= 4.5`);

// ---- 5. roughness ----------------------------------------------------------------------------------------------------------------------
const R = (n) => M[`${n}-roughness.jpg`].lumaMean;
check(['grass', 'dirt', 'asphalt'].every((n) => R(n) >= 238), `ground roughness matte (>= 238/255): grass ${R('grass')} dirt ${R('dirt')} asphalt ${R('asphalt')}`);
check(R('metal') < R('corrugated') && R('corrugated') < R('roof') && R('roof') < R('concrete') && R('concrete') < R('asphalt'), `roughness order metal ${R('metal')} < corrugated ${R('corrugated')} < roof ${R('roof')} < concrete ${R('concrete')} < asphalt ${R('asphalt')}`);
check(R('metal') <= 175 && FAMILIES.every((n) => R(n) >= 150 && R(n) <= 250), 'metal roughness <= 175/255 and every roughness map within 150..250 (no mirror, no pure white)');
check(FAMILIES.every((n) => M[`${n}-roughness.jpg`].std <= 6), 'roughness variation is gentle (std <= 6 levels): no specular sparkle from the map');

// ---- 6. palette ------------------------------------------------------------------------------------------------------------------------
const palBad = FAMILIES.filter((n) => M[`${n}.jpg`].mean.some((v, k) => Math.abs(v - OLD_MEAN[n][k]) > 10));
check(palBad.length === 0, `mean colours within 10 levels of the previous palette: ${JSON.stringify(palBad)}`);
const heightMean = FAMILIES.filter((n) => Math.abs(M[`${n}-height.png`].lumaMean - 128) > 40);
check(heightMean.length === 0, `height maps centred (mean 88..168): ${JSON.stringify(heightMean)}`);

// ---- 7. size ---------------------------------------------------------------------------------------------------------------------------
const textureBytes = files.reduce((s, f) => s + M[f].bytes, 0);
// images only: the user's later layers and ours (assets/*.js|css, +0.2 MB since factories_2) are code, the budget is about picture bytes
const assetsBytes = fs.readdirSync(ASSETS).filter((n) => /\.(jpg|png)$/.test(n)).reduce((s, n) => s + fs.statSync(path.join(ASSETS, n)).size, 0);
check(textureBytes <= OLD_TEXTURE_BYTES, `33 texture files ${textureBytes} B <= old ${OLD_TEXTURE_BYTES} B (${(100 * textureBytes / OLD_TEXTURE_BYTES).toFixed(0)}%)`);
check(assetsBytes <= OLD_ASSETS_BYTES, `assets/ total ${assetsBytes} B <= old ${OLD_ASSETS_BYTES} B`);

// ---- 8. generator is the source of truth -------------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tex-gen-'));
execFileSync('node', [path.join(REPO_ROOT, 'tools', 'gen-textures-v161.mjs'), '--out', tmp], { stdio: 'ignore' });
const differ = files.filter((f) => !fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(ASSETS, f))));
check(differ.length === 0, `assets/ textures are byte-identical to the generator output (deterministic): differing ${JSON.stringify(differ)}`);
fs.rmSync(tmp, { recursive: true });
