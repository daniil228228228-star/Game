// Shared Playwright harness for the tycoon-v116.html regression suite.
//
// Factors out the boilerplate every one-off scratchpad script this session re-derived by hand:
// chromium launch flags, iPhone 13 emulation, a static file server for the repo root, save
// injection under the correct SAVE_KEY, and console/page error collection. See
// tests/README (CHANGELOG_V116.md "тестирование" sections) for the session history this
// generalizes.
//
// IMPORTANT traps every prior agent rediscovered by hand (do not "fix" these away):
//   - Setting `stageIndex` alone does NOT spawn buildings. `spawnBuilding(index, level, {grow})`
//     must be called directly to actually create a building entry + mesh. See spawnBuilding().
//   - The canonical "normal path" for a house is `purchaseCurrentPad()` (pays cost, spawns the
//     currently-targeted stage) -- this is what real play does, and it's the path commit 4bc7c60
//     fixed (corner rebuild). spawnBuilding() bypasses cost/queueing and is fine for state setup
//     that isn't testing the road system itself.
//   - The exact old-format save this session standardized on:
//     { saveVersion:20, stageIndex:1, money:500, planks:10, concrete:0, metal:0,
//       buildings:[{index:0}] }
//     This has no v116 boot-gate fields at all, so it exercises the "existing save" boot path
//     (industrialZoneBuiltV116 defaults true, manualRoadModeV116 defaults false -- see
//     tycoon-v116.html's boot block, ~line 974).
//   - A brand new save is an ABSENT localStorage key, not `{}` -- clearing localStorage is the
//     only correct way to hit the tenth-pass empty-world boot path.
//   - Always measure against real scene/DOM state (scene.traverse, getObjectByName, computed
//     style, userData flags) -- never trust the file's own self-audit objects
//     (window.__TYCOON_V11x_...__ etc.), which check their own bookkeeping, not the real world.

import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAVE_KEY = 'tycoon3d_save_v3';

// The exact old-format save this session standardized on for "does an existing save still work"
// regression checks.
export const OLD_SAVE = Object.freeze({
  saveVersion: 20, stageIndex: 1, money: 500, planks: 10, concrete: 0, metal: 0,
  buildings: [{ index: 0 }],
});

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

// A tiny static file server for the repo root (no framework dependency) -- serves
// tycoon-v116.html plus assets_v31/ and vendor_v31/ that it loads relatively.
export function startServer(root = REPO_ROOT) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/tycoon-v116.html';
      const full = path.join(root, p);
      if (!full.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// Launches a fresh browser + iPhone-13 context + page, wired with console/pageerror collection.
// `save` is either:
//   - undefined/null  -> localStorage untouched (whatever addInitScript callers add themselves)
//   - 'clear'         -> completely empty localStorage (fresh-boot / empty-world path)
//   - an object       -> JSON-stringified and written under SAVE_KEY before any page script runs
export async function openGame({ save, url, waitMs = 2500 } = {}) {
  const server = url ? null : await startServer();
  const gameUrl = url || `${server.url}/tycoon-v116.html`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Benign Playwright/headless-Chromium noise every scratchpad script this session filtered:
    // vibration requires a real user gesture, which a headless automated tap never counts as.
    // Not a game bug.
    if (text.includes('navigator.vibrate')) return;
    errors.push('console.error: ' + text);
  });

  if (save === 'clear') {
    await page.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
  } else if (save && typeof save === 'object') {
    await page.addInitScript(({ key, value }) => {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }, { key: SAVE_KEY, value: save });
  }

  await page.goto(gameUrl, { waitUntil: 'load' });
  if (waitMs) await page.waitForTimeout(waitMs);

  async function close() {
    await browser.close();
    if (server) await server.close();
  }

  return { browser, context, page, errors, close, url: gameUrl };
}

// The "[road union] Error: Open road union contour" console error was a real, root-caused bug
// (a boot-time hoisting race could bind refreshTransportAccessRoads() to an intermediate,
// superseded definition whose addIntersection59()-based junction fill degenerates at
// serviceAccessGraph()'s metalBypass T-junction) -- see CHANGELOG_V116.md's investigation and
// tests/road-union.test.mjs for the dedicated regression test. Fixed by deleting that
// intermediate definition. This filter is kept as a defensive net (so a future regression of it
// doesn't also fail every OTHER test that asserts "0 console errors") but should read 0 in
// practice now; a filtered hit here is worth investigating, not ignoring.
export const ROAD_UNION_KNOWN_ISSUE_RE = /\[road union\] Error: Open road union contour/;

export function partitionKnownErrors(errors) {
  const known = errors.filter((e) => ROAD_UNION_KNOWN_ISSUE_RE.test(e));
  const unknown = errors.filter((e) => !ROAD_UNION_KNOWN_ISSUE_RE.test(e));
  return { known, unknown };
}

// spawnBuilding(index, level, {grow}) trap: this is the ONLY way to actually create a building
// entry (mesh + `buildings` array entry). Setting `stageIndex` by itself changes nothing visible.
// Exposed here just as documentation -- call `page.evaluate(idx => spawnBuilding(idx, 1, {grow:
// false}), i)` directly; there's nothing to wrap since it's a plain page-global function.
export async function spawnBuildingsUpTo(page, count) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) {
      if (i < STAGES.length) spawnBuilding(i, 1, { grow: false });
    }
    if (typeof stageIndex !== 'undefined') stageIndex = n;
  }, count);
}

// Builds `count` houses via the REAL play path (purchaseCurrentPad -> pays cost, spawns the
// current stage, queues/finishes construction) instead of the spawnBuilding() cheat. This is the
// path that exercises the road-corner-rebuild code (commit 4bc7c60) -- spawnBuilding() alone does
// not. Assumes money/resources are already set high enough by the caller.
export async function buildHousesViaNormalPath(page, count) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => { purchaseCurrentPad(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const b = buildings[buildings.length - 1];
      if (b && b.underConstruction) { b.underConstruction = false; b.progress = 1; }
    });
    await page.waitForTimeout(200);
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assert(cond, message) {
  if (!cond) throw new Error('assertion failed: ' + message);
}

// Runs `node --check` on every non-empty inline <script> block in tycoon-v116.html. Returns
// {blockCount, errors: [{index, stderr}]}. No dependency beyond node itself.
export async function checkAllScriptBlocks(htmlPath = path.join(REPO_ROOT, 'tycoon-v116.html')) {
  const { execFileSync } = await import('node:child_process');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const errors = [];
  let checked = 0;
  blocks.forEach((b, i) => {
    if (/^\s*src=/.test(b.slice(0, 10)) || !b.trim()) return;
    checked++;
    try {
      execFileSync('node', ['--check'], { input: b, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      errors.push({ index: i, stderr: String(e.stderr || e.message).slice(0, 2000) });
    }
  });
  return { blockCount: checked, errors };
}
