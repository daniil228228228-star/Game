// Fresh-game boot of tycoon-v161.html from the unbundled dev layout: engine loads, no errors,
// every referenced asset resolves, and every inline script / assets/*.js parses.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check, REPO_ROOT, ENTRY } from './lib/harness.mjs';

const html = fs.readFileSync(path.join(REPO_ROOT, ENTRY), 'utf8');
let blocks = 0, bad = 0;
for (const m of html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) {
  blocks++;
  try { new Function(m[1]); } catch (e) { bad++; console.error(`script block ${blocks}: ${e.message}`); }
}
check(bad === 0, `${blocks} inline script blocks parse`);
const external = [...html.matchAll(/<script src="(assets\/[^"]+)"/g)].map((m) => m[1]);
let badExt = 0;
for (const rel of external) {
  try { new Function(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')); } catch (e) { badExt++; console.error(`${rel}: ${e.message}`); }
}
check(badExt === 0, `${external.length} assets/*.js modules parse`);

const g = await openGame({ save: 'clear', waitMs: 9000 });
const st = await g.page.evaluate(() => ({
  three: typeof THREE !== 'undefined' && THREE.REVISION,
  scene: typeof scene !== 'undefined' ? scene.children.length : 0,
  bootError: !!document.getElementById('bootError'),
  canvases: document.querySelectorAll('canvas').length,
}));
check(st.three === '128', 'Three.js r128 loaded');
check(st.canvases >= 1 && st.scene > 100, `scene populated (${st.scene} children)`);
check(!st.bootError, 'no boot error overlay');
check(g.errors.length === 0, `no console/page errors ${JSON.stringify(g.errors.slice(0, 3))}`);
check(g.badResponses.length === 0, `no 4xx/5xx asset responses ${JSON.stringify(g.badResponses.slice(0, 3))}`);
await g.close();
