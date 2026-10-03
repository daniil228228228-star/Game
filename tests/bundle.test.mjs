// tools/standalone.mjs must stay lossless: building a standalone from the dev layout and
// unbundling it again has to reproduce the entry html and every extracted file byte for byte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, unbundle } from '../tools/standalone.mjs';
import { check, REPO_ROOT, ENTRY } from './lib/harness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
const standalone = path.join(tmp, 'standalone.html');
build(path.join(REPO_ROOT, ENTRY), standalone);
const entry2 = path.join(tmp, 'again', ENTRY);
unbundle(standalone, entry2);
check(fs.readFileSync(entry2).equals(fs.readFileSync(path.join(REPO_ROOT, ENTRY))), 'entry html survives build -> unbundle');
let diffs = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (!fs.readFileSync(path.join(REPO_ROOT, rel)).equals(fs.readFileSync(path.join(tmp, 'again', rel)))) { diffs++; console.error('differs: ' + rel); }
  }
};
walk('assets'); walk('vendor');
check(diffs === 0, 'assets/ and vendor/ survive build -> unbundle');
fs.rmSync(tmp, { recursive: true });
