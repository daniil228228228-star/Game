// Sequential runner for tests/*.test.mjs (plain node scripts, exit 0 = pass). Run one at a time:
// concurrent headless browsers make timing-based checks flaky.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
const results = [];
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  let ok = true;
  try { execFileSync('node', [path.join(here, f)], { stdio: 'inherit' }); } catch { ok = false; }
  results.push({ f, ok });
}
console.log('\n===== summary =====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.f}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
