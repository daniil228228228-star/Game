#!/usr/bin/env node
// Converts between the user's single-file "standalone" builds (vendor JS, textures and
// bundled assets/*.js|css inlined) and the dev layout used in this repo:
//
//   node tools/standalone.mjs unbundle <standalone.html> <entry.html>   # import a new upload
//   node tools/standalone.mjs build    <entry.html> <standalone.html>   # rebuild a standalone
//   node tools/standalone.mjs roundtrip <standalone.html>               # unbundle+build, require byte identity
//
// The dev layout writes vendor/three_r128/{three.min.js,OrbitControls.js} and assets/** next to
// the entry html, which references them by relative path. Build is the exact inverse of unbundle,
// so a user-uploaded standalone can be imported, edited as separate files, and rebuilt.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VENDOR_DIR = 'vendor/three_r128';
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
const URL_MODIFIER = 'THREE.DefaultLoadingManager.setURLModifier(function(url){return assets[url]||url;});';
const SPLASH_KEY = 'assets/splash.png';

const write = (root, rel, data) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
};

// Find the line index of the closing </script>/</style> that follows `open`.
const closeIdx = (lines, open, tag) => {
  for (let i = open + 1; i < lines.length; i++) if (lines[i] === `</${tag}>`) return i;
  throw new Error(`no </${tag}> after line ${open + 1}`);
};

export function unbundle(standalonePath, entryPath) {
  const root = path.dirname(entryPath);
  const lines = fs.readFileSync(standalonePath, 'utf8').split('\n');
  const out = [];
  let assetsMap = null;
  let globalAssets = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bundled = line.match(/^<(script|style) data-bundled-source="([^"]+)">$/);
    if (bundled) {
      const [, tag, src] = bundled;
      const end = closeIdx(lines, i, tag);
      write(root, src, lines.slice(i + 1, end).join('\n'));
      out.push(tag === 'script' ? `<script src="${src}"></script>` : `<link rel="stylesheet" href="${src}">`);
      i = end;
      continue;
    }
    if (line === '<script>' && (lines[i + 1] || '').length > 100000 && /^!function\(t,e\)\{"object"==typeof exports/.test(lines[i + 1])) {
      const end = closeIdx(lines, i, 'script');
      write(root, `${VENDOR_DIR}/three.min.js`, lines.slice(i + 1, end).join('\n'));
      out.push(`<script src="${VENDOR_DIR}/three.min.js"></script>`);
      i = end;
      continue;
    }
    if (line === '<script>' && /class OrbitControls/.test(lines.slice(i + 1, i + 40).join('\n')) && !/^<script/.test(lines[i + 1] || '<script')) {
      const end = closeIdx(lines, i, 'script');
      if (end - i > 100 && end - i < 5000) {
        write(root, `${VENDOR_DIR}/OrbitControls.js`, lines.slice(i + 1, end).join('\n'));
        out.push(`<script src="${VENDOR_DIR}/OrbitControls.js"></script>`);
        i = end;
        continue;
      }
    }
    const assetsBlock = line.match(/^<script id="(standaloneAssets[^"]*)">$/);
    if (assetsBlock) {
      const end = closeIdx(lines, i, 'script');
      const body = lines.slice(i + 1, end).join('\n');
      const m = body.match(/^\(function\(\)\{const assets=(?:window\.__TYCOON_STANDALONE_ASSETS__=)?(\{.*\});THREE\.DefaultLoadingManager\.setURLModifier\(function\(url\)\{return assets\[url\]\|\|url;\}\);\}\)\(\);$/s);
      if (!m) throw new Error('unrecognised standalone assets block');
      assetsMap = JSON.parse(m[1]);
      globalAssets = /const assets=window\.__TYCOON_STANDALONE_ASSETS__=/.test(body);
      for (const [rel, uri] of Object.entries(assetsMap)) {
        const mm = uri.match(/^data:([^;]+);base64,(.*)$/s);
        if (!mm) throw new Error(`asset ${rel} is not a base64 data URI`);
        write(root, rel, Buffer.from(mm[2], 'base64'));
      }
      out.push(`<!-- ${assetsBlock[1]}${globalAssets ? ' [global]' : ''}: textures/height/roughness maps live in assets/ (inlined by tools/standalone.mjs build) -->`);
      i = end;
      continue;
    }
    out.push(line);
  }
  if (!assetsMap) throw new Error('no standaloneAssets block found');
  let html = out.join('\n');
  // The splash is inlined a second time for CSS use; point the dev html at the extracted file.
  const sp = assetsMap[SPLASH_KEY];
  if (sp && html.includes(`"splash":"${sp}"`)) html = html.replace(`"splash":"${sp}"`, `"splash":"${SPLASH_KEY}"`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(entryPath, html);
  return { assets: Object.keys(assetsMap).length };
}

export function build(entryPath, standalonePath) {
  const root = path.dirname(entryPath);
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = fs.readFileSync(entryPath, 'utf8').split('\n');
  const out = [];
  const assetsMap = {};
  const commentIdx = lines.findIndex((l) => /^<!-- standaloneAssets/.test(l));
  const assetFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (MIME[e.name.split('.').pop().toLowerCase()]) assetFiles.push(rel);
    }
  };
  walk('assets');
  assetFiles.sort();
  for (const rel of assetFiles) {
    assetsMap[rel] = `data:${MIME[rel.split('.').pop().toLowerCase()]};base64,${fs.readFileSync(path.join(root, rel)).toString('base64')}`;
  }
  const assetsId = commentIdx >= 0 ? lines[commentIdx].match(/^<!-- (standaloneAssets[^: ]*)/)[1] : 'standaloneAssets';
  const globalAssets = commentIdx >= 0 && / \[global\]:/.test(lines[commentIdx]);
  for (const line of lines) {
    let m;
    if ((m = line.match(/^<script src="(vendor\/three_r128\/[^"]+)"><\/script>$/))) {
      out.push('<script>', read(m[1]), '</script>');
    } else if ((m = line.match(/^<script src="(assets\/[^"]+)"><\/script>$/))) {
      out.push(`<script data-bundled-source="${m[1]}">`, read(m[1]), '</script>');
    } else if ((m = line.match(/^<link rel="stylesheet" href="(assets\/[^"]+)">$/))) {
      out.push(`<style data-bundled-source="${m[1]}">`, read(m[1]), '</style>');
    } else if (/^<!-- standaloneAssets/.test(line)) {
      out.push(`<script id="${assetsId}">`, `(function(){const assets=${globalAssets ? 'window.__TYCOON_STANDALONE_ASSETS__=' : ''}${JSON.stringify(assetsMap)};${URL_MODIFIER}})();`, '</script>');
    } else {
      out.push(line);
    }
  }
  let html = out.join('\n');
  const sp = assetsMap[SPLASH_KEY];
  if (sp && html.includes(`"splash":"${SPLASH_KEY}"`)) html = html.replace(`"splash":"${SPLASH_KEY}"`, `"splash":"${sp}"`);
  fs.mkdirSync(path.dirname(standalonePath), { recursive: true });
  fs.writeFileSync(standalonePath, html);
  return { bytes: Buffer.byteLength(html) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const [cmd, a, b] = isMain ? process.argv.slice(2) : [];
if (!isMain) { /* imported as a module */ }
else if (cmd === 'unbundle') console.log(unbundle(a, b));
else if (cmd === 'build') console.log(build(a, b));
else if (cmd === 'roundtrip') {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'sa-rt-'));
  const entry = path.join(tmp, 'entry.html');
  unbundle(a, entry);
  const rebuilt = path.join(tmp, 'rebuilt.html');
  build(entry, rebuilt);
  const same = fs.readFileSync(a).equals(fs.readFileSync(rebuilt));
  console.log(same ? 'ROUNDTRIP OK (byte-identical)' : 'ROUNDTRIP MISMATCH');
  if (!same) console.log('inspect', tmp);
  else fs.rmSync(tmp, { recursive: true });
  process.exit(same ? 0 : 1);
} else {
  console.error('usage: standalone.mjs unbundle|build|roundtrip ...');
  process.exit(2);
}
