// ROADMAP task 6 (2026-10-05): the Yandex Games upload package. Part A has no browser: tools/pack-yandex-v161.mjs builds
// index.html + ZIP into a temp dir (index.html at the archive root, readable through the central directory and `unzip -t`,
// byte-reproducible, <= 100 MB, one copy of splash.png), the page has no external URLs, the game's own code has none of the
// APIs a moderator or the platform iframe may reject (alert/prompt/window.open/target=_blank/cookie/eval/new Function/fullscreen
// /pointer lock/fetch...), confirm() is covered by the adapter. Part B is ONE browser launch with three page loads of the
// packaged index.html served from a static root (404 for everything else, as on the platform):
//   1. desktop 1280x720 (no touch), plain URL        -> 1 request in total (index.html), 0 external, 0 errors/4xx, cold boot time,
//      no scroll overflow, no touch joystick, WASD and arrow keys move the player
//   2. phone 390x664, ?yandex=1 with /sdk.js missing -> the only extra request is /sdk.js (404, expected off the platform), game still
//      runs, adapter passive, no overflow, joystick visible inside the viewport
//   3. phone 360x640, English, ?yandex=1             -> same, English boot splash, Cyrillic left in the HUD is listed (report, not a failure)
// PACKAGE_NO_BROWSER=1 runs part A only.
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pack, ARCHIVE_LIMIT, forbiddenHits } from '../tools/pack-yandex-v161.mjs';
import { readZip } from '../tools/lib/zip-v161.mjs';
import { REPO_ROOT, check } from './lib/harness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yandex-pack-'));
const out = path.join(tmp, 'yandex');
try {
  // ---------------------------------------------------------------- A. package
  const rep = pack({ out, candidate: false, log: () => {} });
  const zipBuf = fs.readFileSync(rep.zip.path);
  const entries = readZip(zipBuf);
  check(fs.existsSync(path.join(out, 'index.html')), 'dist: index.html exists');
  check(entries.length === 1 && entries[0].name === 'index.html', `ZIP has index.html at its root, nothing else (entries: ${entries.map((e) => e.name).join(',')})`);
  check(entries[0].data.equals(fs.readFileSync(path.join(out, 'index.html'))), 'ZIP entry is byte-identical to dist/yandex/index.html');
  let unzipOk = null;
  try { execFileSync('unzip', ['-tq', rep.zip.path], { stdio: 'pipe' }); unzipOk = true; } catch (e) { unzipOk = e.code === 'ENOENT' ? null : false; }
  check(unzipOk !== false, `system unzip -t accepts the archive${unzipOk === null ? ' (unzip not installed, skipped)' : ''}`);
  const rep2 = pack({ out: path.join(tmp, 'again'), candidate: false, log: () => {} });
  check(fs.readFileSync(rep2.zip.path).equals(zipBuf), 'packing twice gives the identical ZIP bytes (reproducible)');
  check(zipBuf.length <= ARCHIVE_LIMIT && entries.length <= 100, `archive ${(zipBuf.length / 1048576).toFixed(2)} MB <= 100 MB, ${entries.length} file(s)`);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  check(html.length < 12 * 1048576, `index.html ${(html.length / 1048576).toFixed(2)} MB < 12 MB`);
  // the user's build (2026-10-06, factories_2) reads the boot splash from the standalone asset map itself (EMBEDDED_ASSETS.splash = window.__TYCOON_STANDALONE_ASSETS__["assets/splash.png"]):
  // the map holds the ONLY copy, so dedupeSplash (which acts only when exactly two copies exist) correctly leaves it alone
  const splashUri = html.match(/"assets\/splash\.png":"(data:image\/png;base64,[A-Za-z0-9+/=]+)"/);
  check(!!splashUri && html.split(splashUri[1]).length - 1 === 1 && /EMBEDDED_ASSETS = \{[^\n]*"splash":window\.__TYCOON_STANDALONE_ASSETS__/.test(html), 'splash.png is embedded exactly once (the asset map holds it, the boot splash reads it from there)');
  check(rep.externalUrls.length === 0, `no external URL in the page (${JSON.stringify(rep.externalUrls)})`);
  check(!/<script[^>]+src=["']?https?:/i.test(html) && !/<link[^>]+href=["']?https?:/i.test(html) && !/@import|url\(\s*["']?https?:/i.test(html), 'no remote <script src>, <link href>, @import, url(http...)');
  check(!/<script[^>]+src=["']?\/sdk\.js/i.test(html), 'the SDK is not hard-wired into the page: the adapter adds /sdk.js itself and only on a Yandex host / ?yandex=1');
  const game = { 'tycoon-v161.html': fs.readFileSync(path.join(REPO_ROOT, 'tycoon-v161.html'), 'utf8') };
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'assets'))) if (f.endsWith('.js')) game['assets/' + f] = fs.readFileSync(path.join(REPO_ROOT, 'assets', f), 'utf8');
  const hits = forbiddenHits(game);
  check(hits.length === 0, `no forbidden API in the game's own code (${hits.slice(0, 4).map((h) => `${h.file}:${h.line} ${h.api}`).join('; ')})`);
  const nativeConfirm = Object.entries(game).flatMap(([f, t]) => t.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /(^|[^\w.$])confirm\s*\(/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l) && !/window\.confirm\s*=/.test(l)));
  const adapter = game['assets/yandex-platform.js'];
  check(nativeConfirm.every(([f]) => f !== 'assets/yandex-platform.js') && /window\.confirm\s*=\s*function/.test(adapter), `native confirm() (${nativeConfirm.map(([f, n]) => f + ':' + n).join(', ')}) is replaced by the adapter's two-tap confirmation on the platform`);
  check((adapter.match(/YaGames\.init\(/g) || []).length === 1 && (adapter.match(/LoadingAPI\.ready\(/g) || []).length === 1, 'adapter: exactly one YaGames.init() and one LoadingAPI.ready() call site');
  check(!/localStorage\.clear|document\.cookie/.test(adapter), 'adapter never clears storage');
  console.log(`package: index.html ${(html.length / 1048576).toFixed(2)} MB (standalone before dedupe ${(rep.standaloneBytes / 1048576).toFixed(2)} MB), zip ${(zipBuf.length / 1048576).toFixed(2)} MB; biggest: ${rep.biggest.slice(0, 3).map((b) => `${b.name} ${(b.bytes / 1048576).toFixed(2)} MB`).join(' | ')}`);

  if (process.env.PACKAGE_NO_BROWSER) { console.log('PACKAGE_NO_BROWSER: browser part skipped'); }
  else {
    // ------------------------------------------------------------ B. one browser, three page loads
    const requests = [];
    const server = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      requests.push(p);
      if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(out, 'index.html'))); }
      else { res.writeHead(404); res.end('not found'); } // /sdk.js exists only on the platform
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const HUD_SELECTORS = ['#hud', '#topRightBtns', '#joyBase', '#jumpBtn', '#actionBtn', '#nextCard', '#toast', '#compass', '#staminaWrap'];

    async function load({ name, ctxOpts, query, pre }) {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      const errors = [], bad = [], reqs = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text(), u = (m.location() || {}).url || '';
        if (t.includes('navigator.vibrate')) return;
        if (/\/sdk\.js$/.test(u)) return; // the expected 404 off the platform
        errors.push('console.error: ' + t + ' ' + u);
      });
      page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url())) reqs.push(r.url()); });
      if (pre) await page.addInitScript(pre);
      const before = requests.length, t0 = Date.now();
      await page.goto(origin + '/' + (query || ''), { waitUntil: 'load' });
      const loadMs = Date.now() - t0;
      let booted = true;
      try { await page.waitForFunction(() => typeof bootCompleted !== 'undefined' && bootCompleted === true && document.getElementById('bootSplash').classList.contains('hide'), null, { timeout: 120000, polling: 250 }); }
      catch (_) { booted = false; }
      const bootMs = Date.now() - t0;
      await sleep(1500);
      const served = requests.slice(before);
      const external = reqs.filter((u) => new URL(u).origin !== origin);
      const m = await page.evaluate((sels) => {
        const de = document.documentElement, w = innerWidth, h = innerHeight;
        const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { s, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const hint = document.getElementById('hintOverlay');
        const hudText = ['#hud', '#topRightBtns', '#nextCard', '#coachChip', '#toast', '#actionPrompt', '#companyChip', '#hintCard'].map((s) => { const e = document.querySelector(s); return e ? { s, text: (e.innerText || '').trim() } : null; }).filter(Boolean);
        return {
          w, h, sw: de.scrollWidth, sh: de.scrollHeight, bw: document.body.scrollWidth, coarse: matchMedia('(pointer: coarse)').matches, touch: 'ontouchstart' in window,
          rects: sels.map(rect).filter(Boolean), frame: typeof V54_STABILITY !== 'undefined' ? V54_STABILITY.frame : -1, lang: typeof lang !== 'undefined' ? lang : null, htmlLang: de.lang,
          platform: window.TycoonPlatform ? { active: !!window.TycoonPlatform.active, paused: !!window.TycoonPlatform.paused, rewarded: typeof window.TycoonPlatform.showRewardedAd } : null,
          rewardedAvailable: typeof rewardedAvailable === 'function' ? rewardedAvailable() : null, hintOpen: !!(hint && hint.classList.contains('show')),
          heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, domMs: Math.round(nav.domContentLoadedEventEnd || 0), loadEventMs: Math.round(nav.loadEventEnd || 0),
          splashSub: (document.querySelector('#bootSplash .bootSub') || {}).textContent, splashHidden: document.getElementById('bootSplash').classList.contains('hide'),
          render: typeof renderer !== 'undefined' ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures } : null, hudText,
        };
      }, HUD_SELECTORS);
      return { name, ctx, page, errors, bad, served, external, loadMs, bootMs, booted, m };
    }
    const noOverflow = (g) => g.m.sw <= g.m.w && g.m.bw <= g.m.w && g.m.sh <= g.m.h;
    const inside = (g, s) => { const r = g.m.rects.find((x) => x.s === s); return !r || !r.shown || (r.l >= -1 && r.t >= -1 && r.r <= g.m.w + 1 && r.b <= g.m.h + 1); };
    const report = (g) => console.log(`${g.name}: load ${g.loadMs} ms, boot done (first frame + splash hidden) ${g.bootMs} ms, dom ${g.m.domMs} ms, JS heap ${g.m.heapMB} MB, draw calls ${g.m.render && g.m.render.calls}, tris ${g.m.render && g.m.render.tris}, geometries ${g.m.render && g.m.render.geos}, textures ${g.m.render && g.m.render.tex}, requests ${JSON.stringify(g.served)}\n   viewport ${g.m.w}x${g.m.h} scroll ${g.m.sw}x${g.m.sh} coarse=${g.m.coarse} rects ${g.m.rects.filter((r) => r.shown).map((r) => `${r.s}[${r.l},${r.t},${r.r},${r.b}]`).join(' ')}`);

    try {
      // ---- 1. desktop
      const d = await load({ name: 'desktop 1280x720 plain', ctxOpts: { viewport: { width: 1280, height: 720 }, locale: 'ru-RU', hasTouch: false, isMobile: false }, query: '' });
      report(d);
      check(d.booted && d.m.frame > 1, `desktop: game booted from /index.html at the server root (${d.bootMs} ms cold, software GL)`);
      check(d.errors.length === 0 && d.bad.length === 0, `desktop: 0 console errors, 0 responses >= 400 ${JSON.stringify([...d.errors, ...d.bad].slice(0, 3))}`);
      check(d.external.length === 0 && d.served.length === 1 && d.served[0] === '/', `desktop: ${d.served.length} request(s) total (${JSON.stringify(d.served)}), ${d.external.length} to external hosts`);
      check(!(d.m.platform && d.m.platform.active) && d.m.rewardedAvailable === false && d.m.platform.rewarded === 'undefined', `desktop plain URL: adapter inert (TycoonPlatform ${JSON.stringify(d.m.platform)}, no SDK request), rewarded ads unavailable`);
      check(noOverflow(d), `desktop: no scroll overflow (${d.m.sw}x${d.m.sh} in ${d.m.w}x${d.m.h})`);
      check(['#hud', '#topRightBtns', '#nextCard', '#toast'].every((s) => inside(d, s)), 'desktop: HUD and top buttons inside the viewport');
      const joy = d.m.rects.find((r) => r.s === '#joyBase');
      check(!d.m.coarse && !(joy && joy.shown), 'desktop: no touch joystick on a mouse/keyboard device');
      if (d.m.hintOpen) await d.page.click('#hintCloseBtn');
      await d.page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      await sleep(500);
      const pos = () => d.page.evaluate(() => ({ x: player.position.x, z: player.position.z }));
      for (const [label, key] of [['WASD (KeyW)', 'KeyW'], ['WASD (KeyD)', 'KeyD'], ['arrows (ArrowLeft)', 'ArrowLeft'], ['arrows (ArrowDown)', 'ArrowDown']]) {
        const p0 = await pos();
        await d.page.keyboard.down(key);
        const moved = await d.page.waitForFunction(([x, z]) => Math.hypot(player.position.x - x, player.position.z - z) > 0.4, [p0.x, p0.z], { timeout: 25000, polling: 'raf' }).then(() => true, () => false);
        await d.page.keyboard.up(key);
        const p1 = await pos();
        check(moved, `desktop keyboard ${label}: player moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
      }
      await d.ctx.close();

      // ---- 2. phone portrait, ?yandex=1, no /sdk.js
      const p = await load({ name: 'phone 390x664 ?yandex=1 (no SDK file)', ctxOpts: { ...devices['iPhone 13'], viewport: { width: 390, height: 664 }, screen: { width: 390, height: 664 }, locale: 'ru-RU' }, query: '?yandex=1' });
      report(p);
      check(p.booted && p.m.frame > 1, `phone: game boots with ?yandex=1 although /sdk.js is missing (${p.bootMs} ms)`);
      check(p.errors.length === 0 && p.bad.every((b) => b === '404 /sdk.js'), `phone: 0 console errors; only 4xx is /sdk.js (${JSON.stringify([...p.errors, ...p.bad].slice(0, 3))})`);
      check(p.external.length === 0 && p.served.length === 2 && p.served[0] === '/' && p.served[1] === '/sdk.js', `phone: requests ${JSON.stringify(p.served)} = index.html + /sdk.js, ${p.external.length} external`);
      check(p.m.platform && p.m.platform.active && !p.m.platform.paused && p.m.platform.rewarded === 'undefined' && p.m.rewardedAvailable === false, `phone: adapter passive without SDK (${JSON.stringify(p.m.platform)}), rewarded unavailable`);
      check(noOverflow(p), `phone 390x664: no scroll overflow (${p.m.sw}x${p.m.sh})`);
      check(['#hud', '#topRightBtns', '#joyBase', '#nextCard', '#toast'].every((s) => inside(p, s)), 'phone 390x664: HUD, top buttons and joystick inside the viewport');
      const pj = p.m.rects.find((r) => r.s === '#joyBase');
      check(p.m.coarse && pj && pj.shown, 'phone: touch joystick visible');
      await p.ctx.close();

      // ---- 3. small phone, English
      const s = await load({ name: 'phone 360x640 en ?yandex=1', ctxOpts: { ...devices['iPhone 13'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 }, locale: 'en-US' }, query: '?yandex=1' });
      report(s);
      check(s.booted && s.m.frame > 1 && s.errors.length === 0 && s.bad.every((b) => b === '404 /sdk.js'), `small phone: boots, 0 console errors (${JSON.stringify([...s.errors, ...s.bad].slice(0, 3))})`);
      check(noOverflow(s), `phone 360x640: no scroll overflow (${s.m.sw}x${s.m.sh})`);
      check(['#hud', '#topRightBtns', '#joyBase', '#nextCard', '#toast'].every((x) => inside(s, x)), 'phone 360x640: HUD, top buttons and joystick inside the viewport');
      check(s.m.lang === 'en' && s.m.htmlLang === 'en' && /^Build your company/.test(s.m.splashSub || ''), `English: game lang ${s.m.lang}, <html lang> ${s.m.htmlLang}, boot splash subtitle "${s.m.splashSub}"`);
      const cyr = s.m.hudText.filter((x) => /[А-Яа-яЁё]/.test(x.text));
      console.log(`English UI gap report (visible Cyrillic after boot): ${cyr.length ? cyr.map((x) => `${x.s}: ${JSON.stringify(x.text.slice(0, 120))}`).join(' | ') : 'none in the sampled HUD blocks'}`);
      await s.ctx.close();
    } finally { await browser.close(); await new Promise((r) => server.close(r)); }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
