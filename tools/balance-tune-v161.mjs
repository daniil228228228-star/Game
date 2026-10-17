// Offline helper for assets/late-game-v161.js: random local search over stageResMul (per-stage resource-cost multiplier) on the model of
// tools/balance-v161.mjs so that every step stays inside the CONTRACT band and the total of 3 runs lands in 15-25 h.
//   node tools/balance-tune-v161.mjs [seconds]     continues the search stored in the OS temp dir (delete balance-tune-v161.json to restart)
// It prints the best table found; paste it into TABLE.stageResMul by hand, then run `node tools/balance-v161.mjs --check`.
// The objective is a hand-tuned penalty (first hour <= 115 s, later <= 345 s, major steps >= 65 s, total >= 17 h); the 2.5-hour search that
// produced the committed table started from [1,..,1,.9,.8,.7,.6,.5,.45,.4] and was then rounded by hand (see CHANGELOG_V161.md).
import fs from 'node:fs';
import * as B from './balance-v161.mjs';
import os from 'node:os';
import path from 'node:path';
const {simulate} = B;
const N = 16;
const stateFile = path.join(os.tmpdir(), 'balance-tune-v161.json');
let st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { mul: Array(N).fill(1), rm: Array(N).fill(1), best: Infinity, it: 0, seed: 1 };
const GMIN = 65, GMAX = 345, EARLY = 110;
function bi(id) { const m = id.match(/^stage (\d+)/), u = id.match(/^upg (.*) -> L/); return m ? Number(m[1]) : (u ? B.BASE_STAGES.findIndex(s => s.nameEn === u[1]) : -1); }
function major(e) { const i = bi(e.id); if (i < 6) return false; const u = e.id.match(/-> L(\d+)/); return !u || Number(u[1]) >= 3; }
function score(mul, rm, detail) {
  const runs = simulate({ stageCostMul: mul, stageResMul: rm, prestigeCostStep: 0 }, { runs: 3, maxLevel: B.MAX_LEVEL_GAME, dt: 3 });
  let p = 0;
  const r1 = runs[0];
  for (const e of r1.log) {
    if (e.t <= 3600) { if (e.gap > 115) p += ((e.gap - 115) / 30) ** 2 * 3; }
    else { if (major(e) && e.gap < GMIN) p += ((GMIN - e.gap) / 60) ** 2; if (e.gap > GMAX) p += ((e.gap - GMAX) / 30) ** 2 * 3; }
  }
  for (const r of runs.slice(1)) for (const e of r.log) if (e.gap > GMAX) p += ((e.gap - GMAX) / 60) ** 2;
  const total = runs.reduce((a, r) => a + r.endT, 0) / 3600;
  if (total < 17) p += (17 - total) ** 2 * 6;
  if (total > 23) p += (total - 23) ** 2 * 4;
  if (runs.some(r => r.stuck)) p += 1000;
  let reg = 0; for (let i = 0; i < N; i++) reg += 0.02 * (Math.log(mul[i]) ** 2) + 0.2 * (Math.log(rm[i]) ** 2);
  if (detail) return { p, reg, total, runs };
  return p + reg;
}
let rnd = (() => { let s = st.seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
const t0 = Date.now(), limitMs = Number(process.argv[2] || 500) * 1000;
if (st.best === Infinity) st.best = score(st.mul, st.rm);
while (Date.now() - t0 < limitMs) {
  st.it++;
  const mul = st.mul.slice(), rm = st.rm.slice();
  const k = 1 + Math.floor(rnd() * 3), d = 0.35 * Math.exp(-st.it / 2500) + 0.03;
  for (let j = 0; j < k; j++) {
    const i = 2 + Math.floor(rnd() * (N - 2));
    if (rnd() < 0.5) mul[i] = Math.min(14, Math.max(1, mul[i] * Math.exp((rnd() * 2 - 1) * d)));
    else rm[i] = Math.min(1.8, Math.max(0.3, rm[i] * Math.exp((rnd() * 2 - 1) * d)));
  }
  const s = score(mul, rm);
  if (s < st.best) { st.best = s; st.mul = mul; st.rm = rm; }
}
st.seed = Math.floor(rnd() * 1e9);
fs.writeFileSync(stateFile, JSON.stringify(st));
const d = score(st.mul, st.rm, true);
console.log('it', st.it, 'best', st.best.toFixed(2), 'penalty', d.p.toFixed(2), 'total', d.total.toFixed(2));
console.log('mul', JSON.stringify(st.mul.map(x => +x.toFixed(2))));
console.log('rm ', JSON.stringify(st.rm.map(x => +x.toFixed(2))));
