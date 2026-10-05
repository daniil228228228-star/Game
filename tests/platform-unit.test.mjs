// assets/yandex-platform.js without a browser: the script runs in a node `vm` context with a fake DOM, a fake clock and a fake
// Yandex SDK, so timing rules can be checked in milliseconds of fake time (the browser run of the same adapter is
// tests/platform.test.mjs). ROADMAP task 6 (2026-10-05): LoadingAPI.ready timing, GameplayAPI start/stop, interstitial frequency
// cap, rewarded reward only in onRewarded, guest player, missing SDK fallback, cloud/leaderboard throttles, language, confirm().
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/harness.mjs';

const SRC = fs.readFileSync(path.join(REPO_ROOT, 'assets/yandex-platform.js'), 'utf8');
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('FAIL: ' + msg); } else console.log('ok: ' + msg); };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// opts: host, search, sdk (false = none), player ('lite'|'logged'|'reject'|'hang'), lang, local, session, cloud, game (false = no game globals)
function makeEnv(opts = {}) {
  const o = { host: 'app-1.games.s3.yandex.net', search: '', sdk: true, player: 'lite', lang: 'ru', game: true, ...opts };
  let now = 1_700_000_000_000;
  const timers = []; let tid = 0;
  const listeners = { window: {}, document: {} };
  const env = { o, G: { gp: [], ads: [], calls: [], lb: [], cloud: o.cloud || null, setData: [], reload: 0, toasts: [], applyLang: 0, init: 0, scripts: [], modal: false, hidden: false, splashHidden: false, sub: { textContent: 'RU' } } };
  const { G } = env;
  const sb = {};
  sb.window = sb; sb.self = sb;
  sb.Date = { now: () => now };
  sb.setTimeout = (fn, ms = 0) => { timers.push({ id: ++tid, at: now + ms, fn, every: 0 }); return tid; };
  sb.setInterval = (fn, ms = 0) => { timers.push({ id: ++tid, at: now + ms, fn, every: Math.max(1, ms) }); return tid; };
  sb.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  sb.clearInterval = sb.clearTimeout;
  const add = (who) => (type, fn) => { (listeners[who][type] = listeners[who][type] || []).push(fn); };
  sb.addEventListener = add('window');
  sb.localStorage = mkStorage(o.local);
  sb.sessionStorage = o.session || mkStorage();
  sb.navigator = { language: o.navLang || 'en-US' };
  sb.location = { hostname: o.host, search: o.search, reload() { G.reload++; } };
  const body = { classList: { contains: () => false } };
  sb.document = {
    get hidden() { return G.hidden; },
    body,
    head: { appendChild(el) { G.scripts.push(el); } },
    documentElement: { appendChild(el) { G.scripts.push(el); } },
    createElement: () => ({}),
    addEventListener: add('document'),
    getElementById: (id) => (id === 'bootSplash' ? { classList: { contains: (c) => c === 'hide' && G.splashHidden } } : id === 'bootError' ? G.bootError || null : null),
    querySelector: (sel) => (sel === '#bootSplash .bootSub' ? G.sub : (/\.show/.test(sel) && G.modal ? {} : null)),
  };
  if (o.sdk) {
    const sdk = {
      features: { LoadingAPI: { ready() { G.calls.push('ready'); } }, GameplayAPI: { start() { G.gp.push('start'); }, stop() { G.gp.push('stop'); } } },
      adv: { showRewardedVideo(x) { G.ads.push({ kind: 'rewarded', cb: x.callbacks }); }, showFullscreenAdv(x) { G.ads.push({ kind: 'fullscreen', cb: x.callbacks }); } },
      getPlayer: () => {
        if (o.player === 'reject') return Promise.reject(new Error('no auth'));
        if (o.player === 'hang') return new Promise(() => {});
        return Promise.resolve({
          getMode: () => o.player,
          setData: async (d, flush) => { G.setData.push({ d, flush, at: now }); G.cloud = d; },
          getData: async () => G.cloud || {},
        });
      },
      getLeaderboards: async () => ({ setLeaderboardScore: async (n, s) => { G.lb.push([n, s, now]); } }),
      environment: o.lang ? { i18n: { lang: o.lang } } : {},
      on(n, cb) { G.ev = G.ev || {}; G.ev[n] = cb; },
    };
    sb.YaGames = { init: async () => { G.init++; return sdk; } };
  }
  const ctx = vm.createContext(sb);
  if (o.game) {
    vm.runInContext(`
      let muted = false; let audioCtx = { state: 'running', suspend() { this.state = 'suspended'; }, resume() { this.state = 'running'; } };
      let clock = { getDelta() {} }; let lang = ${JSON.stringify(o.gameLang || 'en')}; let sourceTrees = []; let carriedLogs = 0;
      let suppressAutoSaveV36 = false; let stats = { totalEarned: 0 };
      function applyLanguage() { window.__applyLang = (window.__applyLang || 0) + 1; }
      function toast(m) { (window.__toasts = window.__toasts || []).push(m); }
      let bootCompleted = false; let V54_STABILITY = { frame: 0 };
    `, ctx);
  }
  env.ctx = ctx;
  env.run = () => vm.runInContext(SRC, ctx);
  env.get = (expr) => vm.runInContext(expr, ctx);
  env.set = (stmt) => vm.runInContext(stmt, ctx);
  env.now = () => now;
  env.emit = (who, type) => (listeners[who][type] || []).forEach((fn) => fn({ type }));
  env.advance = async (ms) => {
    const target = now + ms;
    for (;;) {
      await flush();
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at = now + due.every; else timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
    now = target; await flush();
  };
  env.boot = (frames = 3) => { env.set(`bootCompleted = true; V54_STABILITY.frame = ${frames};`); G.splashHidden = true; };
  env.lastGp = () => G.gp[G.gp.length - 1];
  return env;
}
const strictlyAlternating = (gp) => gp.every((v, i) => (i === 0 ? v === 'start' : v !== gp[i - 1]));

// ---------------------------------------------------------------- 1. not on Yandex: inert
{
  const e = makeEnv({ host: 'localhost', sdk: true });
  e.run(); await e.advance(2000);
  check(e.get('typeof window.TycoonPlatform') === 'undefined' && e.G.init === 0 && e.G.scripts.length === 0, 'off Yandex (localhost, no ?yandex=1): TycoonPlatform is not created, SDK untouched, no <script> appended');
  check(e.get('window.confirm') === undefined, 'off Yandex: confirm() left alone');
  const e2 = makeEnv({ host: 'localhost', search: '?yandex=1' });
  e2.run(); await e2.advance(50);
  check(e2.get('window.TycoonPlatform.active') === true, '?yandex=1 activates the adapter');
}

// ---------------------------------------------------------------- 2. SDK file missing (/sdk.js 404 off the platform)
{
  const e = makeEnv({ search: '?yandex=1', sdk: false });
  e.run(); await e.advance(100);
  const sc = e.G.scripts;
  check(sc.length === 1 && sc[0].src === '/sdk.js', `no YaGames -> exactly one <script src="/sdk.js"> appended (${JSON.stringify(sc.map((s) => s.src))})`);
  let threw = false; try { sc[0].onerror && sc[0].onerror(new Error('404')); } catch (_) { threw = true; }
  e.boot(); await e.advance(40000);
  const P = e.get('window.TycoonPlatform');
  check(!threw && P.active === true && P.paused === false && P.showRewardedAd === undefined && P.showInterstitialAd === undefined, 'SDK file missing: adapter stays passive, no ad/cloud methods, no throw');
  e.G.hidden = true; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.get('window.TycoonPlatform.paused') === true && e.get('muted') === true, 'without SDK the hidden-tab pause/mute still works');
  e.G.hidden = false; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.get('window.TycoonPlatform.paused') === false && e.get('muted') === false, '... and resumes');
  // sdk.js loads but YaGames.init rejects
  const e3 = makeEnv({ search: '?yandex=1', sdk: false });
  e3.run(); e3.set('window.YaGames = { init() { return Promise.reject(new Error("boom")); } };'); e3.G.scripts[0].onload(); e3.boot(); await e3.advance(40000);
  check(e3.get('window.TycoonPlatform.paused') === false && e3.get('window.TycoonPlatform.showRewardedAd') === undefined, 'YaGames.init() rejecting: no crash, no methods');
}

// ---------------------------------------------------------------- 3. LoadingAPI.ready timing
{
  const e = makeEnv({ player: 'lite' });
  e.run(); await e.advance(3000);
  check(e.G.init === 1 && e.G.calls.length === 0, 'YaGames.init once; ready NOT called while the game has not rendered (bootCompleted false)');
  e.set('bootCompleted = true; V54_STABILITY.frame = 1;'); await e.advance(1000);
  check(e.G.calls.length === 0, 'first frame rendered but < 2 frames: still not ready');
  e.set('V54_STABILITY.frame = 5;'); await e.advance(1000);
  check(e.G.calls.length === 0, 'frames running but boot splash still visible: not ready');
  e.G.splashHidden = true; await e.advance(500);
  check(e.G.calls.length === 1, 'splash hidden + frames: LoadingAPI.ready called');
  await e.advance(60000);
  check(e.G.calls.length === 1 && e.G.init === 1, 'ready exactly once, init exactly once over 60 s more');
  check(e.lastGp() === 'start' && e.G.gp.length === 1, `GameplayAPI.start follows ready (${JSON.stringify(e.G.gp)})`);
}
{
  const e = makeEnv({ player: 'hang' });
  e.run(); e.boot(); await e.advance(7000);
  check(e.G.calls.length === 0, 'ready waits for the cloud decision (getPlayer pending)');
  await e.advance(2000);
  check(e.G.calls.length === 1, 'ready after the 8 s cloud wait if the player never resolves');
}
{
  const e = makeEnv({ player: 'lite' });
  e.run(); await e.advance(29000);
  check(e.G.calls.length === 0, 'game never booted: no ready before 30 s');
  await e.advance(2000);
  check(e.G.calls.length === 1, 'fallback ready at 30 s so the platform is not left waiting forever');
}
{ // cloud restore: ready must not be sent for a page that is about to reload
  const newer = JSON.stringify({ savedAt: 9_999_999_999_999, stageIndex: 4, buildings: [{}] });
  const sess = mkStorage();
  const e = makeEnv({ cloud: { save: newer, savedAt: 9_999_999_999_999 }, local: { tycoon3d_save_v3: JSON.stringify({ savedAt: 1000, stageIndex: 1, buildings: [{}] }) }, session: sess });
  e.run(); e.boot(); await e.advance(5000);
  check(e.G.reload === 1 && e.G.calls.length === 0, `cloud save is newer: one reload, no LoadingAPI.ready before it (reload ${e.G.reload}, ready ${e.G.calls.length})`);
  check(e.get('localStorage.getItem("tycoon3d_save_v3")') === newer && e.get('suppressAutoSaveV36') === true, 'restored raw save written, autosave suppressed for the reload');
  const e2 = makeEnv({ cloud: { save: newer, savedAt: 9_999_999_999_999 }, local: { tycoon3d_save_v3: JSON.stringify({ savedAt: 1000, stageIndex: 1, buildings: [{}] }) }, session: sess });
  e2.run(); e2.boot(); await e2.advance(5000);
  check(e2.G.reload === 0 && e2.G.calls.length === 1, 'second boot with the same cloud stamp: no reload loop, ready sent');
}

// ---------------------------------------------------------------- 4. GameplayAPI start/stop, pause reasons
{
  const e = makeEnv({ player: 'lite' });
  e.run(); e.boot(); await e.advance(1000);
  const P = () => e.get('window.TycoonPlatform');
  check(e.lastGp() === 'start', 'playing after ready');
  e.G.hidden = true; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.lastGp() === 'stop' && P().paused && e.get('muted') === true && e.get('audioCtx.state') === 'suspended', 'tab hidden: GameplayAPI.stop, paused, muted, audio suspended');
  e.G.hidden = false; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.lastGp() === 'start' && !P().paused && e.get('muted') === false && e.get('audioCtx.state') === 'running', 'tab visible again: start, resumed, sound back');
  e.emit('window', 'blur'); await e.advance(10);
  check(e.lastGp() === 'stop' && P().paused && e.get('muted') === true, 'window blur: stop + pause + mute');
  e.emit('window', 'pointerdown'); await e.advance(10);
  check(e.lastGp() === 'start' && !P().paused, 'any pointer/focus event after blur resumes (focus can be lost for good on mobile)');
  e.G.modal = true; await e.advance(600);
  check(e.lastGp() === 'stop' && !P().paused, 'menu/panel open: GameplayAPI.stop but the world keeps its normal state (not muted/paused)');
  e.G.modal = false; await e.advance(600);
  check(e.lastGp() === 'start', 'menu closed: start');
  e.G.hidden = true; e.emit('document', 'visibilitychange'); e.G.modal = true; await e.advance(600);
  e.G.hidden = false; e.emit('document', 'visibilitychange'); await e.advance(600);
  check(e.lastGp() === 'stop', 'hidden + menu open, then visible: still stopped while the menu is open');
  e.G.modal = false; await e.advance(600);
  // platform events
  e.G.ev.game_api_pause(); await e.advance(10);
  check(e.lastGp() === 'stop' && P().paused, 'game_api_pause');
  e.G.ev.game_api_resume(); await e.advance(10);
  check(e.lastGp() === 'start' && !P().paused, 'game_api_resume');
  check(strictlyAlternating(e.G.gp), `GameplayAPI calls strictly alternate start/stop, no duplicates (${e.G.gp.join(',')})`);
}

// ---------------------------------------------------------------- 5. rewarded: reward only in onRewarded; pause during any ad
{
  const e = makeEnv({ player: 'lite' });
  e.run(); e.boot(); await e.advance(1000);
  const P = () => e.get('window.TycoonPlatform');
  const rewarded = (seq) => { // returns the promise result after the callbacks run
    const p = P().showRewardedAd('income'); return flush().then(() => { const ad = e.G.ads[e.G.ads.length - 1]; seq(ad.cb); return p; });
  };
  check(await rewarded((cb) => { cb.onOpen(); cb.onClose(); }) === false, 'rewarded closed without onRewarded: false');
  check(await rewarded((cb) => { cb.onOpen(); cb.onError(new Error('x')); }) === false, 'rewarded onError: false');
  check(await rewarded((cb) => { cb.onOpen(); cb.onRewarded(); cb.onError(new Error('x')); }) === false, 'rewarded onRewarded then onError: still false (no reward on error)');
  let r = null; const p = P().showRewardedAd('income').then((v) => { r = v; }); await flush();
  const ad = e.G.ads[e.G.ads.length - 1];
  check(e.get('muted') === true && P().paused && e.lastGp() === 'stop', 'ad requested: muted, paused, GameplayAPI.stop');
  ad.cb.onOpen(); await flush(); check(r === null, 'before onRewarded/onClose nothing is resolved');
  ad.cb.onRewarded(); await flush(); check(r === null, 'onRewarded alone does not resolve; the game gets the reward on close');
  ad.cb.onClose(); await p;
  check(r === true && !P().paused && e.lastGp() === 'start' && e.get('muted') === false, 'onRewarded + onClose: true, game resumed, GameplayAPI.start');
  // second ad while one is open
  const a1 = P().showRewardedAd('x'); await flush();
  check(await P().showRewardedAd('x') === false && e.G.ads.length === 5, 'second ad while one is open is refused without touching the SDK');
  e.G.ads[e.G.ads.length - 1].cb.onClose(); await a1;
  // watchdog
  const w = P().showRewardedAd('x'); await flush();
  await e.advance(180500);
  check(await w === false && !P().paused, 'ad that never calls back: 180 s watchdog resolves false and resumes the game');
}

// ---------------------------------------------------------------- 6. interstitial frequency cap
{
  const e = makeEnv({ player: 'lite' });
  e.run(); await e.advance(500);
  const P = () => e.get('window.TycoonPlatform');
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'interstitial before the game is playable: refused, SDK not called');
  e.boot(); await e.advance(1000);
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'interstitial in the first minute after ready: refused');
  await e.advance(58000);
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'still refused at 59 s');
  await e.advance(2000);
  e.set('carriedLogs = 2;');
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'never while the player carries logs');
  e.set('carriedLogs = 0; sourceTrees.push({ state: "chopping" });');
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'never while a tree is being chopped');
  e.set('sourceTrees.length = 0; window.__TYCOON_V123__ = { state: { carry: { amount: 3 } } };');
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'never while carrying materials (v123 carry)');
  e.set('delete window.__TYCOON_V123__;');
  e.G.hidden = true; e.emit('document', 'visibilitychange');
  check(await P().showInterstitialAd() === false && e.G.ads.length === 0, 'never in a hidden tab');
  e.G.hidden = false; e.emit('document', 'visibilitychange'); await e.advance(10);
  let r = null; const p = P().showInterstitialAd().then((v) => { r = v; }); await flush();
  check(e.G.ads.length === 1 && e.G.ads[0].kind === 'fullscreen', 'after 60 s, idle player: interstitial requested');
  e.G.ads[0].cb.onOpen(); e.G.ads[0].cb.onClose(true); await p;
  check(r === true, 'interstitial shown -> true');
  await e.advance(30000);
  check(await P().showInterstitialAd() === false && e.G.ads.length === 1, 'second interstitial 30 s later: refused (cap 90 s)');
  await e.advance(61000);
  const p2 = P().showInterstitialAd(); await flush();
  check(e.G.ads.length === 2, '91 s after the previous ad: allowed again');
  e.G.ads[1].cb.onError(new Error('no fill')); check(await p2 === false && !P().paused, 'interstitial onError: false and the game is not left paused');
  // a rewarded ad also resets the interstitial clock, and itself is not capped
  await e.advance(100000);
  const rw = P().showRewardedAd('x'); await flush(); e.G.ads[2].cb.onRewarded(); e.G.ads[2].cb.onClose(); await rw;
  check(await P().showInterstitialAd() === false, 'right after a rewarded ad no interstitial');
  check(strictlyAlternating(e.G.gp), 'GameplayAPI alternation holds through the ads');
}

// ---------------------------------------------------------------- 7. guest player (lite): no leaderboard, cloud still works
{
  const e = makeEnv({ player: 'lite', local: { tycoon3d_save_v3: JSON.stringify({ savedAt: 5, stageIndex: 1, buildings: [{}] }) } });
  e.run(); e.boot(); await e.advance(1000);
  const P = () => e.get('window.TycoonPlatform');
  check(e.G.calls.length === 1 && e.G.setData.length === 1, `guest: game ready and the local save is mirrored to the cloud (setData ${e.G.setData.length})`);
  e.set('stats.totalEarned = 5000;'); await e.advance(61000);
  check(e.G.lb.length === 0 && await P().submitLeaderboardScore(10) === false, 'guest: leaderboard is never called (auto tick and manual)');
}
{
  const e = makeEnv({ player: 'reject' });
  e.run(); e.boot(); await e.advance(1000);
  const P = () => e.get('window.TycoonPlatform');
  check(e.G.calls.length === 1, 'getPlayer rejects: LoadingAPI.ready still sent');
  check(await P().cloudLoad() === null && await P().cloudSave('{"a":1}') === false && await P().submitLeaderboardScore(5) === false, 'getPlayer rejects: cloud/leaderboard calls resolve null/false, never throw');
  check(typeof P().showRewardedAd === 'function', 'getPlayer rejects: ads still available');
}

// ---------------------------------------------------------------- 8. leaderboard + cloud throttles (authorised player)
{
  const save = (t) => JSON.stringify({ savedAt: t, stageIndex: 2, buildings: [{}] });
  const e = makeEnv({ player: 'logged', local: { tycoon3d_save_v3: save(10) } });
  e.run(); e.boot(); await e.advance(1000);
  const P = () => e.get('window.TycoonPlatform');
  check(await P().submitLeaderboardScore(1234.9) === true && e.G.lb.length === 1 && e.G.lb[0][0] === 'tycoon' && e.G.lb[0][1] === 1234, 'authorised: score floored, board "tycoon"');
  check(await P().submitLeaderboardScore(2000) === false && e.G.lb.length === 1, 'second submit within 10 s: throttled, SDK not called');
  await e.advance(10500);
  check(await P().submitLeaderboardScore(2000) === true && e.G.lb.length === 2, 'after 10 s: allowed');
  // auto tick: only when the total grew
  const n0 = e.G.lb.length; await e.advance(61000); check(e.G.lb.length === n0, 'auto tick without growth sends nothing');
  e.set('stats.totalEarned = 9000;'); await e.advance(61000);
  check(e.G.lb.length === n0 + 1 && e.G.lb[n0][1] === 9000, 'auto tick sends the grown total once');
  // cloud throttle
  const n1 = e.G.setData.length;
  for (let i = 0; i < 6; i++) { e.set(`localStorage.setItem("tycoon3d_save_v3", ${JSON.stringify(save(100 + i))});`); await e.advance(9000); }
  check(e.G.setData.length - n1 <= 1, `cloud upload at most once per 60 s while the save changes every 9 s (${e.G.setData.length - n1} uploads in 54 s)`);
  await e.advance(10000);
  check(e.G.setData.length - n1 === 1, 'the next tick after 60 s uploads the newest save');
  const n2 = e.G.setData.length;
  e.set(`localStorage.setItem("tycoon3d_save_v3", ${JSON.stringify(save(999))});`);
  e.G.hidden = true; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.G.setData.length === n2 + 1 && e.G.setData[n2].flush === true, 'tab hidden: forced upload with flush=true');
  e.set(`localStorage.setItem("tycoon3d_save_v3", ${JSON.stringify(save(1000))});`);
  e.G.hidden = false; e.emit('document', 'visibilitychange'); e.G.hidden = true; e.emit('document', 'visibilitychange'); await e.advance(10);
  check(e.G.setData.length === n2 + 1, 'rapid hide/show/hide: forced uploads are rate limited (5 s)');
  check(await P().cloudSave('x'.repeat(200000)) === false, 'oversize save (> 190 KB) is refused');
}

// ---------------------------------------------------------------- 9. language
{
  const run = async (o) => { const e = makeEnv(o); e.run(); e.boot(); await e.advance(1000); return e; };
  let e = await run({ lang: 'ru', gameLang: 'en' });
  check(e.get('lang') === 'ru' && e.get('window.__applyLang') === 1, 'SDK lang ru, game guessed en: switched to ru through applyLanguage()');
  e = await run({ lang: 'tr', gameLang: 'ru' });
  check(e.get('lang') === 'en', 'SDK lang tr -> en (no Turkish strings in the game)');
  e = await run({ lang: 'kk', gameLang: 'en' });
  check(e.get('lang') === 'ru', 'SDK lang kk -> ru');
  e = await run({ lang: 'ru', gameLang: 'en', local: { tycoon3d_lang: 'en' } });
  check(e.get('lang') === 'en' && e.get('window.__applyLang') === undefined, 'the player chose a language before: kept');
  e = await run({ lang: '', gameLang: 'en' });
  check(e.get('lang') === 'en' && e.get('window.__applyLang') === undefined, 'SDK without environment.i18n: game language untouched');
  e = makeEnv({ lang: 'ru', navLang: 'en-GB' }); e.run();
  check(e.G.sub.textContent.startsWith('Build your company'), 'English first screen: boot splash subtitle is translated when the game starts in English');
  e = makeEnv({ lang: 'ru', navLang: 'ru-RU' }); e.run();
  check(e.G.sub.textContent === 'RU', 'Russian: splash subtitle left as in the page');
}

// ---------------------------------------------------------------- 9b. slow-boot notice
{
  const e = makeEnv({ player: 'lite' });
  let removed = 0; e.G.bootError = { textContent: 'Игра не завершила запуск за 12 секунд.\nЕсли ниже ...', remove() { removed++; e.G.bootError = null; } };
  e.run(); await e.advance(3000);
  check(removed === 0, 'slow-boot notice stays while the game has not booted');
  e.boot(); await e.advance(1000);
  check(removed === 1, 'slow-boot notice ("не завершила запуск за 12 секунд") removed once the first frame is out');
  const e2 = makeEnv({ player: 'lite' }); e2.G.bootError = { textContent: 'Ошибка запуска игры:\nboom', remove() { e2.G.removed = true; } };
  e2.run(); e2.boot(); await e2.advance(2000);
  check(!e2.G.removed, 'a real boot error is never dismissed');
}

// ---------------------------------------------------------------- 10. confirm() without a native dialog
{
  const e = makeEnv({ player: 'lite' });
  e.run(); await e.advance(10);
  check(e.get('confirm("Reset?")') === false && /Reset\?/.test(e.get('window.__toasts[0]')), 'first confirm(): false + toast');
  check(e.get('confirm("Reset?")') === true, 'second confirm() with the same text: true');
  check(e.get('confirm("Reset?")') === false, 'armed state is consumed');
  e.get('confirm("A")'); await e.advance(5500);
  check(e.get('confirm("A")') === false, 'confirmation expires after 5 s');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall platform-unit checks passed');
process.exit(failed ? 1 : 0);
