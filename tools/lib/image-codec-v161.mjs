// Minimal pure-JS image codecs for the texture pipeline (no dependencies besides node:zlib):
//   encodePng8(width, height, gray)            8-bit greyscale PNG, per-row filter chosen by min sum |x|, zlib level 9
//   decodePng(buffer)                          -> { width, height, channels, data }   (8-bit, non interlaced, colour types 0/2/4/6)
//   encodeJpeg(width, height, channels, data, quality)   baseline JPEG, 1 (grey) or 3 (RGB -> YCbCr 4:4:4) components,
//                                              image-specific optimal Huffman tables (Annex K.2), standard JFIF quantisation tables
//   decodeJpeg(buffer)                         -> { width, height, channels, data }   (baseline, 1x1 sampling, DRI supported)
// Used by tools/gen-textures-v161.mjs (writes assets/*.jpg|png) and tests/textures.test.mjs (reads them back).
import zlib from 'node:zlib';

// ----------------------------------------------------------------------------------------------- PNG
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng8(width, height, gray) {
  const raw = Buffer.alloc((width + 1) * height), row = new Int16Array(width);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(width));
  for (let y = 0; y < height; y++) {
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f]; let score = 0;
      for (let x = 0; x < width; x++) {
        const v = gray[y * width + x], a = x ? gray[y * width + x - 1] : 0, b = y ? gray[(y - 1) * width + x] : 0, c = x && y ? gray[(y - 1) * width + x - 1] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const d = (v - p) & 255; out[x] = d; score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (width + 1)] = best; raw.set(cand[best], y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('only 8-bit non-interlaced PNG is supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]; if (!channels) throw new Error('unsupported PNG colour type ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels] : 0, b = y ? data[dst - stride + x] : 0, c = x >= channels && y ? data[dst - stride + x - channels] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      data[dst + x] = (raw[src + x] + p) & 255;
    }
  }
  return { width, height, channels, data };
}

// ---------------------------------------------------------------------------------------------- JPEG
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
const COS = (() => { const c = new Float64Array(64); for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u * 8 + x] = (u ? 1 : Math.SQRT1_2) * 0.5 * Math.cos((2 * x + 1) * u * Math.PI / 16); return c; })();

function scaleQ(base, q) { const s = q < 50 ? 5000 / q : 200 - q * 2; return base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100)))); }
const cat = (v) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };

function fdct(block, out) { // block: Float64Array(64) level-shifted, out: coefficients row-major (v*8+u)
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[u * 8 + x]; tmp[y * 8 + u] = s; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y]; out[v * 8 + u] = s; }
}

// Annex K.2: optimal length-limited (16) Huffman table from symbol frequencies -> { bits[1..16], vals[] }
function buildHuffTable(freqIn) {
  const freq = Int32Array.from(freqIn); freq[256] = 1;
  const size = new Int32Array(257), others = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1, v = 1e9; for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v) { v = freq[i]; c1 = i; }
    let c2 = -1; v = 1e9; for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v && i !== c1) { v = freq[i]; c2 = i; }
    if (c2 < 0) break;
    freq[c1] += freq[c2]; freq[c2] = 0;
    size[c1]++; while (others[c1] >= 0) { c1 = others[c1]; size[c1]++; }
    others[c1] = c2;
    size[c2]++; while (others[c2] >= 0) { c2 = others[c2]; size[c2]++; }
  }
  const bits = new Int32Array(33);
  for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
  for (let i = 32; i > 16; i--) while (bits[i] > 0) { let j = i - 2; while (!bits[j]) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
  let i = 16; while (!bits[i]) i--; bits[i]--; // drop the reserved all-ones code
  const vals = []; for (let l = 1; l <= 32; l++) for (let s = 0; s < 256; s++) if (size[s] === l) vals.push(s);
  return { bits: Array.from(bits.slice(1, 17)), vals };
}
function huffCodes(t) {
  const code = new Int32Array(256), len = new Int32Array(256); let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) { for (let i = 0; i < t.bits[l - 1]; i++) { code[t.vals[k]] = c++; len[t.vals[k]] = l; k++; } c <<= 1; }
  return { code, len };
}

export function encodeJpeg(width, height, channels, data, quality = 80) {
  const comps = channels === 1 ? 1 : 3, bw = Math.ceil(width / 8), bh = Math.ceil(height / 8);
  const qt = [scaleQ(QL, quality), scaleQ(QC, quality)];
  // planes (level shifted), edge-replicated to the block grid
  const planes = [];
  for (let c = 0; c < comps; c++) planes.push(new Float64Array(bw * 8 * bh * 8));
  for (let y = 0; y < bh * 8; y++) for (let x = 0; x < bw * 8; x++) {
    const sx = Math.min(x, width - 1), sy = Math.min(y, height - 1), i = (sy * width + sx) * channels, o = y * bw * 8 + x;
    if (comps === 1) planes[0][o] = data[i] - 128;
    else { const r = data[i], g = data[i + 1], b = data[i + 2]; planes[0][o] = 0.299 * r + 0.587 * g + 0.114 * b - 128; planes[1][o] = -0.168736 * r - 0.331264 * g + 0.5 * b; planes[2][o] = 0.5 * r - 0.418688 * g - 0.081312 * b; }
  }
  // quantised coefficient blocks in zigzag order, MCU order = raster over blocks (4:4:4 interleaved)
  const blocks = []; // [mcu][comp] -> Int16Array(64)
  const blk = new Float64Array(64), co = new Float64Array(64);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const mcu = [];
    for (let c = 0; c < comps; c++) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = planes[c][(by * 8 + y) * bw * 8 + bx * 8 + x];
      fdct(blk, co);
      const q = qt[c ? 1 : 0], z = new Int16Array(64);
      for (let k = 0; k < 64; k++) z[k] = Math.round(co[ZIGZAG[k]] / q[ZIGZAG[k]]);
      mcu.push(z);
    }
    blocks.push(mcu);
  }
  // symbol statistics for optimal tables (table 0 = luma, 1 = chroma)
  const dcF = [new Int32Array(257), new Int32Array(257)], acF = [new Int32Array(257), new Int32Array(257)];
  const run = (fn) => { const pred = [0, 0, 0]; for (const mcu of blocks) for (let c = 0; c < comps; c++) { const z = mcu[c], t = c ? 1 : 0, diff = z[0] - pred[c]; pred[c] = z[0]; fn.dc(t, cat(diff), diff); let r = 0; for (let k = 1; k < 64; k++) { if (!z[k]) { r++; continue; } while (r > 15) { fn.ac(t, 0xf0, 0, 0); r -= 16; } fn.ac(t, (r << 4) | cat(z[k]), cat(z[k]), z[k]); r = 0; } if (r) fn.ac(t, 0, 0, 0); } };
  run({ dc: (t, s) => dcF[t][s]++, ac: (t, s) => acF[t][s]++ });
  const nt = comps === 1 ? 1 : 2;
  const dcT = [], acT = [], dcC = [], acC = [];
  for (let t = 0; t < nt; t++) { dcT.push(buildHuffTable(dcF[t])); acT.push(buildHuffTable(acF[t])); dcC.push(huffCodes(dcT[t])); acC.push(huffCodes(acT[t])); }
  // entropy coding
  const out = []; let acc = 0, nacc = 0;
  const put = (code, len) => { for (let i = len - 1; i >= 0; i--) { acc = (acc << 1) | ((code >> i) & 1); if (++nacc === 8) { out.push(acc); if (acc === 0xff) out.push(0); acc = 0; nacc = 0; } } };
  run({
    dc: (t, s, v) => { put(dcC[t].code[s], dcC[t].len[s]); if (s) put(v < 0 ? v - 1 : v, s); },
    ac: (t, sym, s, v) => { put(acC[t].code[sym], acC[t].len[sym]); if (s) put(v < 0 ? v - 1 : v, s); },
  });
  if (nacc) put((1 << (8 - nacc)) - 1, 8 - nacc);
  // headers
  const seg = (marker, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(b, 4); return b; };
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])];
  for (let t = 0; t < nt; t++) parts.push(seg(0xdb, [t, ...ZIGZAG.map((i) => qt[t][i])]));
  const sof = [8, height >> 8, height & 255, width >> 8, width & 255, comps]; for (let c = 0; c < comps; c++) sof.push(c + 1, 0x11, c ? 1 : 0);
  parts.push(seg(0xc0, sof));
  for (let t = 0; t < nt; t++) { parts.push(seg(0xc4, [t, ...dcT[t].bits, ...dcT[t].vals])); parts.push(seg(0xc4, [0x10 | t, ...acT[t].bits, ...acT[t].vals])); }
  const sos = [comps]; for (let c = 0; c < comps; c++) sos.push(c + 1, c ? 0x11 : 0x00); sos.push(0, 63, 0);
  parts.push(seg(0xda, sos), Buffer.from(out), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

export function decodeJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let pos = 2, width = 0, height = 0, comps = [], restart = 0; const qts = {}, dcT = {}, acT = {};
  const mk = (bits, vals) => { const maxcode = new Int32Array(18).fill(-1), mincode = new Int32Array(17), valptr = new Int32Array(17); let c = 0, k = 0; for (let l = 1; l <= 16; l++) { valptr[l] = k; mincode[l] = c; c += bits[l - 1]; k += bits[l - 1]; maxcode[l] = bits[l - 1] ? c - 1 : -1; c <<= 1; } return { maxcode, mincode, valptr, vals }; };
  let scanStart = -1;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const m = buf[pos + 1]; pos += 2;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) continue;
    if (m === 0xd9) break;
    const len = buf.readUInt16BE(pos), body = buf.subarray(pos + 2, pos + len);
    if (m === 0xdb) { let p = 0; while (p < body.length) { const pq = body[p] >> 4, id = body[p] & 15; p++; const t = new Int32Array(64); for (let i = 0; i < 64; i++) { t[ZIGZAG[i]] = pq ? body.readUInt16BE(p) : body[p]; p += pq ? 2 : 1; } qts[id] = t; } }
    else if (m === 0xc0 || m === 0xc1) { height = body.readUInt16BE(1); width = body.readUInt16BE(3); comps = []; for (let i = 0; i < body[5]; i++) comps.push({ id: body[6 + i * 3], hs: body[7 + i * 3] >> 4, vs: body[7 + i * 3] & 15, tq: body[8 + i * 3] }); }
    else if (m === 0xc2) throw new Error('progressive JPEG is not supported');
    else if (m === 0xc4) { let p = 0; while (p < body.length) { const tc = body[p] >> 4, id = body[p] & 15; p++; const bits = Array.from(body.subarray(p, p + 16)); p += 16; const n = bits.reduce((a, b) => a + b, 0); const t = mk(bits, Array.from(body.subarray(p, p + n))); p += n; (tc ? acT : dcT)[id] = t; } }
    else if (m === 0xdd) restart = body.readUInt16BE(0);
    else if (m === 0xda) { for (let i = 0; i < body[0]; i++) { const c = comps.find((q) => q.id === body[1 + i * 2]); c.td = body[2 + i * 2] >> 4; c.ta = body[2 + i * 2] & 15; } scanStart = pos + len; break; }
    pos += len;
  }
  if (scanStart < 0) throw new Error('no scan');
  if (comps.some((c) => c.hs !== 1 || c.vs !== 1)) throw new Error('only 1x1 sampling is supported');
  // entropy decode
  let p = scanStart, bitBuf = 0, bitCnt = 0;
  const readBit = () => { if (!bitCnt) { let b = buf[p++]; if (b === 0xff) { const n = buf[p]; if (n === 0) p++; else if (n >= 0xd0 && n <= 0xd7) { /* restart handled by caller */ p--; b = 0; } } bitBuf = b; bitCnt = 8; } bitCnt--; return (bitBuf >> bitCnt) & 1; };
  const receive = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v; };
  const extend = (v, n) => (n && v < (1 << (n - 1)) ? v - (1 << n) + 1 : v);
  const decodeSym = (t) => { let code = 0; for (let l = 1; l <= 16; l++) { code = (code << 1) | readBit(); if (t.maxcode[l] >= 0 && code <= t.maxcode[l] && code >= t.mincode[l]) return t.vals[t.valptr[l] + code - t.mincode[l]]; } throw new Error('bad huffman code'); };
  const bw = Math.ceil(width / 8), bh = Math.ceil(height / 8), planes = comps.map(() => new Float64Array(bw * 8 * bh * 8));
  const pred = comps.map(() => 0), blk = new Float64Array(64), tmp = new Float64Array(64); let mcuCount = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    if (restart && mcuCount && mcuCount % restart === 0) { bitCnt = 0; while (buf[p] !== 0xff || buf[p + 1] < 0xd0 || buf[p + 1] > 0xd7) p++; p += 2; pred.fill(0); }
    mcuCount++;
    for (let ci = 0; ci < comps.length; ci++) {
      const c = comps[ci], q = qts[c.tq]; blk.fill(0);
      const s = decodeSym(dcT[c.td]); pred[ci] += extend(receive(s), s); blk[0] = pred[ci] * q[0];
      for (let k = 1; k < 64;) { const rs = decodeSym(acT[c.ta]), r = rs >> 4, sz = rs & 15; if (!sz) { if (r === 15) { k += 16; continue; } break; } k += r; if (k > 63) break; blk[ZIGZAG[k]] = extend(receive(sz), sz) * q[ZIGZAG[k]]; k++; }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let acc = 0; for (let u = 0; u < 8; u++) acc += blk[y * 8 + u] * COS[u * 8 + x]; tmp[y * 8 + x] = acc; }
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let acc = 0; for (let v = 0; v < 8; v++) acc += tmp[v * 8 + x] * COS[v * 8 + y]; planes[ci][(by * 8 + y) * bw * 8 + bx * 8 + x] = acc; }
    }
  }
  const n = comps.length, data = new Uint8Array(width * height * n), clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = y * bw * 8 + x, i = (y * width + x) * n;
    if (n === 1) data[i] = clamp(planes[0][o] + 128);
    else { const Y = planes[0][o] + 128, cb = planes[1][o], cr = planes[2][o]; data[i] = clamp(Y + 1.402 * cr); data[i + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr); data[i + 2] = clamp(Y + 1.772 * cb); }
  }
  return { width, height, channels: n, data };
}
