// Tiny sequential runner for tests/*.test.mjs -- no test-framework dependency (none is installed
// in this repo, and the session's established convention is plain assert-based scratchpad
// scripts; this just gives that convention one permanent, discoverable entry point). Each test
// file is a standalone Node script that exits 0 on pass / 1 on fail and prints its own report;
// this runner just invokes them in sequence and summarizes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (!files.length) {
  console.error('no tests/*.test.mjs files found');
  process.exit(1);
}

console.log(`running ${files.length} test file(s): ${files.join(', ')}\n`);

const results = [];
for (const f of files) {
  const full = path.join(here, f);
  console.log(`\n=== ${f} ===`);
  let ok = true;
  try {
    execFileSync('node', [full], { stdio: 'inherit' });
  } catch (e) {
    ok = false;
  }
  results.push({ file: f, ok });
}

console.log('\n===== summary =====');
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
