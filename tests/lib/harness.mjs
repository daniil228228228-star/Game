// Shared Playwright harness for the tycoon-v161.html regression suite: static server for the repo
// root, Chromium (software WebGL) with iPhone 13 emulation, optional save injection, and
// console/page error collection.
//
// Traps carried over from the v116 suite (see archive/tycoon-v116/tests/lib/harness.mjs):
//   - A brand-new save is an ABSENT localStorage key (use save:'clear'), not `{}`.
//   - Software rendering runs the game at only a few fps: wait on state, not wall-clock timers.
//   - Assert on real scene/DOM state, not on the file's own `window.__TYCOON_*__` audit objects.
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTRY = 'tycoon-v161.html';
export const SAVE_KEY = 'tycoon3d_save_v3';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export function startServer(root = REPO_ROOT) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = `/${ENTRY}`;
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

// `save`: undefined (untouched) | 'clear' (empty localStorage = fresh game) | object (written under SAVE_KEY).
export async function openGame({ save, url, waitMs = 4000 } = {}) {
  const server = url ? null : await startServer();
  const gameUrl = url || `${server.url}/${ENTRY}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('navigator.vibrate')) return; // headless taps never count as a user gesture
    errors.push('console.error: ' + text);
  });
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
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
  return { browser, context, page, errors, badResponses, close, url: gameUrl };
}

export function check(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('ok: ' + msg);
}
