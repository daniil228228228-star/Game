#!/usr/bin/env node
// Yandex Games upload package (ROADMAP task 6, 2026-10-05). Reproducible, offline, pure node.
//
//   node tools/pack-yandex-v161.mjs [--out <dir>] [--entry tycoon-v161.html] [--no-candidate]
//
// 1. builds the single-file standalone from the dev layout (tools/standalone.mjs build) -> <out>/index.html
// 2. drops the second copy of splash.png the standalone carries (the `assets` URL map of the texture loader never loads it,
//    the boot splash reads EMBEDDED_ASSETS.splash): -4 MB, art untouched. Only done when exactly two identical copies exist.
// 3. writes <out>/<entry>-yandex.zip with index.html at the archive root (deflate 9, fixed timestamps => same bytes every run),
//    re-reads it and verifies entries/CRC/bytes
// 4. size report (<out>/pack-report.json + stdout): biggest items, external URLs found in the page, forbidden-API grep
// 5. <out>/splash.candidate.jpg: a recompressed splash for the user to approve (NOT wired into the game)
// Default <out> is dist/yandex in the repo root (git-ignored). Upload only the .zip (or the folder's index.html) to the console.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from './standalone.mjs';
import { writeZip, readZip } from './lib/zip-v161.mjs';
import { decodePng, encodeJpeg, decodeJpeg } from './lib/image-codec-v161.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
export const ARCHIVE_LIMIT = 100 * 1048576; // Yandex Games: archive up to 100 MB (check the console, limits move)

// Constructs a moderator (or the platform iframe sandbox) may reject in the game's own code. `confirm` is handled by the adapter.
export const FORBIDDEN = [
  ['alert(', /(^|[^\w.$])alert\s*\(/], ['prompt(', /(^|[^\w.$])prompt\s*\(/], ['window.open', /window\.open\s*\(/], ['target="_blank"', /target\s*=\s*["']?_blank/],
  ['document.cookie', /document\.cookie/], ['eval(', /(^|[^\w.$])eval\s*\(/], ['new Function', /new\s+Function\s*\(/],
  ['requestFullscreen', /requestFullscreen|webkitRequestFullscreen/], ['requestPointerLock', /requestPointerLock/],
  ['fetch/XHR/WebSocket/beacon', /(^|[^\w.$])fetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon/], ['importScripts/Worker', /importScripts|new\s+Worker\s*\(/],
];
export const ALLOWED_URLS = [/^http:\/\/www\.w3\.org\//];

export function findEntry(root = ROOT) {
  const f = fs.readdirSync(root).filter((n) => /^tycoon-v\d+\.html$/.test(n)).sort();
  if (!f.length) throw new Error('no tycoon-vNNN.html in ' + root);
  return f[f.length - 1];
}

// ---- standalone -> Yandex index.html
export function dedupeSplash(html) {
  const m = html.match(/"assets\/splash\.png":"(data:image\/png;base64,[A-Za-z0-9+/=]+)"/);
  if (!m) return { html, removed: 0 };
  const uri = m[1];
  const copies = html.split(uri).length - 1;
  if (copies !== 2) return { html, removed: 0 }; // unknown layout: leave the build as it is
  return { html: html.replace(`"assets/splash.png":"${uri}"`, '"assets/splash.png":""'), removed: uri.length };
}

export function sizeBreakdown(html) {
  const items = []; let rest = Buffer.byteLength(html);
  const take = (name, bytes) => { items.push({ name, bytes }); rest -= bytes; };
  for (const m of html.matchAll(/(?:"([^"]{1,60})":")?(data:[a-z/+.-]+;base64,)([A-Za-z0-9+/=]{20000,})/g)) take(`${m[1] || 'data URI'} (base64)`, Buffer.byteLength(m[0]) - (m[1] ? 0 : 0));
  for (const m of html.matchAll(/<(script|style) data-bundled-source="([^"]+)">\n([\s\S]*?)\n<\/\1>/g)) take(m[2], Buffer.byteLength(m[3]));
  const three = html.match(/<script>\n(!function\(t,e\)\{"object"==typeof exports[\s\S]*?)\n<\/script>/);
  if (three) take('vendor/three.min.js', Buffer.byteLength(three[1]));
  const small = items.filter((i) => /base64\)$/.test(i.name) && i.bytes < 100000);
  const bigs = items.filter((i) => !small.includes(i));
  if (small.length) bigs.push({ name: `${small.length} texture data URIs (base64, all < 100 KB)`, bytes: small.reduce((a, i) => a + i.bytes, 0) });
  bigs.sort((a, b) => b.bytes - a.bytes);
  const assetsJs = bigs.filter((i) => /^assets\/.*\.(js|css)$/.test(i.name));
  const top = bigs.filter((i) => !assetsJs.includes(i));
  top.push({ name: `${assetsJs.length} bundled assets/*.js|css`, bytes: assetsJs.reduce((a, i) => a + i.bytes, 0) });
  top.push({ name: 'inline game code + small textures + markup (rest)', bytes: rest });
  return top.sort((a, b) => b.bytes - a.bytes);
}

export function externalUrls(html) {
  const found = new Map();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)\\`]+/g)) {
    if (ALLOWED_URLS.some((r) => r.test(m[0]))) continue;
    found.set(m[0], (found.get(m[0]) || 0) + 1);
  }
  return [...found].map(([url, count]) => ({ url, count }));
}

export function forbiddenHits(files) { // files: { name: text }
  const hits = [];
  for (const [name, text] of Object.entries(files)) {
    let inBlock = false;
    text.split('\n').forEach((raw, i) => {
      // drop comments (block comments that span lines, /* ... */ on one line, trailing // notes) so prose like "prompt" is not a hit
      let line = raw;
      if (inBlock) { const e = line.indexOf('*/'); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
      line = line.replace(/\/\*.*?\*\//g, ' ');
      const o = line.indexOf('/*'); if (o >= 0) { inBlock = true; line = line.slice(0, o); }
      line = line.replace(/(^|\s)\/\/.*$/, '$1');
      for (const [label, re] of FORBIDDEN) if (re.test(line)) hits.push({ file: name, line: i + 1, api: label, text: raw.trim().slice(0, 140) });
    });
  }
  return hits;
}

export function pack({ root = ROOT, out = path.join(ROOT, 'dist/yandex'), entry = findEntry(root), candidate = true, log = console.log } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const indexPath = path.join(out, 'index.html');
  build(path.join(root, entry), indexPath);
  const standaloneBytes = fs.statSync(indexPath).size;
  let html = fs.readFileSync(indexPath, 'utf8');
  const ded = dedupeSplash(html);
  html = ded.html;
  fs.writeFileSync(indexPath, html);
  const indexBytes = fs.statSync(indexPath).size;
  const base = entry.replace(/\.html$/, '');
  const zipPath = path.join(out, `${base}-yandex.zip`);
  const zip = writeZip([{ name: 'index.html', data: fs.readFileSync(indexPath) }]);
  fs.writeFileSync(zipPath, zip);
  // verify: re-read the file from disk through the central directory
  const entries = readZip(fs.readFileSync(zipPath));
  if (entries.length !== 1 || entries[0].name !== 'index.html' || !entries[0].data.equals(fs.readFileSync(indexPath))) throw new Error('zip verification failed');
  const hasFiles = (dir) => fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.js'));
  const gameFiles = { [entry]: fs.readFileSync(path.join(root, entry), 'utf8') };
  for (const f of hasFiles('assets')) gameFiles['assets/' + f] = fs.readFileSync(path.join(root, 'assets', f), 'utf8');
  const report = {
    entry, index: { path: indexPath, bytes: indexBytes }, standaloneBytes, splashCopyRemoved: ded.removed > 0, splashCopyBytes: ded.removed,
    zip: { path: zipPath, bytes: zip.length, entries: entries.map((e) => ({ name: e.name, size: e.size, csize: e.csize, method: e.method })) },
    archiveLimitBytes: ARCHIVE_LIMIT, files: entries.length,
    biggest: sizeBreakdown(html).slice(0, 8), externalUrls: externalUrls(html), forbidden: forbiddenHits(gameFiles),
  };
  if (candidate) {
    const t0 = Date.now();
    const src = fs.readFileSync(path.join(root, 'assets/splash.png')), img = decodePng(src);
    const jpg = encodeJpeg(img.width, img.height, img.channels, img.data, 82);
    fs.writeFileSync(path.join(out, 'splash.candidate.jpg'), jpg);
    const back = decodeJpeg(jpg); let se = 0; const n = img.width * img.height * img.channels;
    for (let i = 0; i < n; i++) { const d = img.data[i] - back.data[i]; se += d * d; }
    report.splashCandidate = { path: path.join(out, 'splash.candidate.jpg'), pngBytes: src.length, jpgBytes: jpg.length, quality: 82, width: img.width, height: img.height, psnrDb: +(10 * Math.log10(255 * 255 / (se / n))).toFixed(1), encodeMs: Date.now() - t0 };
  }
  fs.writeFileSync(path.join(out, 'pack-report.json'), JSON.stringify(report, null, 1));
  log(`index.html            ${MB(indexBytes)}  (standalone build ${MB(standaloneBytes)}${ded.removed ? `, duplicate splash copy removed: -${MB(ded.removed)}` : ''})`);
  log(`${path.basename(zipPath).padEnd(21)} ${MB(zip.length)}  entries: ${entries.map((e) => `${e.name} ${MB(e.size)}`).join(', ')}  (limit ${MB(ARCHIVE_LIMIT)}, ${(100 * zip.length / ARCHIVE_LIMIT).toFixed(1)} %)`);
  log('biggest items:'); for (const b of report.biggest) log(`  ${MB(b.bytes).padStart(9)}  ${(100 * b.bytes / indexBytes).toFixed(1).padStart(5)} %  ${b.name}`);
  log(`external URLs in the page: ${report.externalUrls.length}${report.externalUrls.length ? ' -> ' + report.externalUrls.map((u) => `${u.url} x${u.count}`).join(', ') : ''} (+ /sdk.js appended at run time, only on a Yandex host or ?yandex=1)`);
  log(`forbidden-API hits in the game's own code: ${report.forbidden.length}${report.forbidden.length ? '\n' + report.forbidden.map((h) => `  ${h.file}:${h.line} ${h.api}  ${h.text}`).join('\n') : ''}`);
  if (report.splashCandidate) { const c = report.splashCandidate; log(`splash.candidate.jpg   ${MB(c.jpgBytes)} (png ${MB(c.pngBytes)}, ${c.width}x${c.height}, q${c.quality}, PSNR ${c.psnrDb} dB) -> ${c.path}  [not wired into the game]`); }
  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const rep = pack({ out: path.resolve(opt('--out') || path.join(ROOT, 'dist/yandex')), entry: opt('--entry'), candidate: !a.includes('--no-candidate') });
  if (rep.zip.bytes > ARCHIVE_LIMIT || rep.forbidden.length) process.exitCode = 1;
}
