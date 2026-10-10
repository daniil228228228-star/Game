// Texture metrics shared by tools/gen-textures-v161.mjs (prints them while generating) and tests/textures.test.mjs.
//   seam     = tileability of the opposite edges: second difference ACROSS the wrap-around line (does the gradient continue through the seam?)
//              divided by the mean second difference of the interior (floor 0.15 levels), x and y, on luma. ~1 = the seam looks like any
//              interior line (seamless); an unmatched edge is a step the interior never has (old grass/asphalt ~2-4, old brick/roof/siding 10-60).
//              Hard 1 px edges (not used in the new files: all steps are 2-3 px ramps) would hide a mismatch, so keep them soft.
//              seamMax = the same against the STRONGEST interior line (for structured textures whose seam coincides with a course/board
//              edge: <= ~1 when the edge is just another edge of the pattern). seamAbs = mean |L[wrap] - L[last]| in levels (reported).
//   lap      = mean |4-neighbour Laplacian| (wrapping) of luma, 0-255 levels: pixel-scale ("grain") energy. 0.3 = glass smooth, 2+ = visibly grainy.
//   hfShare  = share of the luma variance that lives above 1/4 of the sampling rate (cheap 2D DFT over a 128x128 box-downscaled copy is NOT used:
//              this is the variance of (L - 3x3 box blur) over the variance of L, so it is resolution independent and ~0 for calm macro variation).
//   mean/std = colour mean (RGB) and luma standard deviation.
import { decodeJpeg, decodePng } from './image-codec-v161.mjs';
import fs from 'node:fs';

export function loadImage(file) {
  const buf = fs.readFileSync(file);
  return file.endsWith('.png') ? decodePng(buf) : decodeJpeg(buf);
}
export function lumaOf(img) {
  const n = img.width * img.height, L = new Float32Array(n), c = img.channels, d = img.data;
  for (let i = 0; i < n; i++) L[i] = c >= 3 ? 0.299 * d[i * c] + 0.587 * d[i * c + 1] + 0.114 * d[i * c + 2] : d[i * c];
  return L;
}
export function metricsOf(img) {
  const w = img.width, h = img.height, L = lumaOf(img), n = w * h;
  let sum = 0; for (let i = 0; i < n; i++) sum += L[i];
  const mean = sum / n; let v = 0; for (let i = 0; i < n; i++) v += (L[i] - mean) ** 2;
  const std = Math.sqrt(v / n);
  let lap = 0, boxVar = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xm = (x + w - 1) % w, xp = (x + 1) % w, ym = (y + h - 1) % h, yp = (y + 1) % h, c = L[y * w + x];
    lap += Math.abs(4 * c - L[y * w + xm] - L[y * w + xp] - L[ym * w + x] - L[yp * w + x]);
    let b = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) b += L[((y + dy + h) % h) * w + (x + dx + w) % w];
    boxVar += (c - b / 9) ** 2;
  }
  lap /= n; boxVar /= n;
  const seam = (len, across, at) => { // len = lines along the seam, across = size perpendicular to it, at(i, k) = luma at line i, position k
    const R = new Float64Array(across);
    let abs = 0;
    for (let i = 0; i < len; i++) {
      abs += Math.abs(at(i, 0) - at(i, across - 1));
      for (let k = 0; k < across; k++) {
        const g = (q) => at(i, (q + 1) % across) - at(i, q), q = (k + across) % across, qm = (k + across - 1) % across, qp = (k + 1) % across;
        R[k] += Math.abs(g(q) - (g(qm) + g(qp)) / 2);
      }
    }
    let inner = 0, cnt = 0; for (let k = 2; k < across - 3; k++) { inner += R[k] / len; cnt++; }
    let max = 0; for (let k = 2; k < across - 3; k++) max = Math.max(max, R[k] / len);
    return { ratio: (R[across - 1] / len) / Math.max(inner / cnt, 0.15), ratioMax: (R[across - 1] / len) / Math.max(max, 0.15), abs: abs / len };
  };
  const sx = seam(h, w, (i, k) => L[i * w + k]), sy = seam(w, h, (i, k) => L[k * w + i]);
  const rgb = [0, 0, 0], c = img.channels;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[k] += img.data[i * c + (c >= 3 ? k : 0)];
  return {
    width: w, height: h, mean: rgb.map((s) => +(s / n).toFixed(1)), lumaMean: +mean.toFixed(1), std: +std.toFixed(2), lap: +lap.toFixed(3),
    hfShare: +(std > 0.01 ? boxVar / (std * std) : 0).toFixed(4),
    seamX: +sx.ratio.toFixed(2), seamY: +sy.ratio.toFixed(2), seamMaxX: +sx.ratioMax.toFixed(2), seamMaxY: +sy.ratioMax.toFixed(2), seamAbsX: +sx.abs.toFixed(2), seamAbsY: +sy.abs.toFixed(2),
  };
}
