// Two builds of the same game for looking at the design:
//   dist/tycoon-v161-zero.html   a new game from nothing (every localStorage key renamed tycoon3d* -> tycoon3dzero*, so it never reads or overwrites the real save)
//   dist/tycoon-v161-full.html   the fully built city (tools/showcase-save-v161.json, made by tools/make-showcase-save-v161.mjs) seeded on the first open
//                                 (keys renamed tycoon3d* -> tycoon3dfull*; open it with ?reset=1 to put the showcase city back)
// The seeded save also gets every masterplan pad B01-B18 (the pads do not touch any other save field).
// Both are the normal standalone build with a different key prefix, so nothing else differs from the game.
//   node tools/build-variants-v161.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : 'dist');
fs.mkdirSync(OUT, { recursive: true });
const base = path.join(OUT, '.standalone-tmp.html');
execFileSync('node', [path.join(ROOT, 'tools/standalone.mjs'), 'build', path.join(ROOT, 'tycoon-v161.html'), base], { stdio: 'inherit' });
const html = fs.readFileSync(base, 'utf8');
fs.rmSync(base);
const titleRe = /<title>([^<]*)<\/title>/;
if (!titleRe.test(html)) throw new Error('no <title> in the build');
const rename = (src, prefix) => src.split('tycoon3d').join(prefix);
const retitle = (src, suffix) => src.replace(titleRe, (_, t) => `<title>${t} · ${suffix}</title>`);

// ---- from zero
fs.writeFileSync(path.join(OUT, 'tycoon-v161-zero.html'), retitle(rename(html, 'tycoon3dzero'), 'с нуля'));

// ---- fully built
const seedFile = path.join(ROOT, 'tools/showcase-save-v161.json');
if (!fs.existsSync(seedFile)) throw new Error('run tools/make-showcase-save-v161.mjs first');
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
const P = 'tycoon3dfull';
const seeder = `<script>(function(){try{var P=${JSON.stringify(P)},seed=${JSON.stringify(seed)},reset=/[?&]reset=1/.test(location.search);
if(reset||!localStorage.getItem(P+'_save_v3')){for(var k in seed){var v=seed[k];if(k==='tycoon3d_save_v3'){try{var o=JSON.parse(v);o.savedAt=Date.now();var m={};for(var n=1;n<=18;n++)m['B'+(n<10?'0':'')+n]=true;o.masterplanV161=m;v=JSON.stringify(o);}catch(e){}}localStorage.setItem(k.replace('tycoon3d',P),v);}}
}catch(e){}})();</script>`;
let full = rename(html, P);
const headAt = full.indexOf('<head>');
if (headAt < 0) throw new Error('no <head> in the build');
full = full.slice(0, headAt + 6) + seeder + full.slice(headAt + 6);
fs.writeFileSync(path.join(OUT, 'tycoon-v161-full.html'), retitle(full, 'всё построено'));
for (const f of ['tycoon-v161-zero.html', 'tycoon-v161-full.html']) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes');
