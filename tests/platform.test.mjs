// assets/yandex-platform.js with a FAKE Yandex SDK (the real one is only served on the platform).
// Launch 1: ?yandex=1 + fake window.YaGames -> LoadingAPI.ready once, rewarded grants only in
// onRewarded, onError grants nothing, game audio muted + loop paused during an ad and restored after,
// pause/resume events, cloud/leaderboard shapes, restore decision rules.
// Launch 2: same fake SDK but WITHOUT ?yandex=1 -> TycoonPlatform inert, SDK never touched.
// Launch 3 (2026-10-05, ROADMAP task 6): ?yandex=1 and NO SDK at all (/sdk.js answers 404, as off the platform) -> game boots, adapter passive.
// Launch 1 also covers: LoadingAPI.ready only after the first frame + hidden splash, GameplayAPI start/stop (hidden tab, blur, open menu, ads),
// interstitial frequency cap, guest (lite) player, leaderboard throttle, language from ysdk.environment.i18n.lang, two-tap confirm().
// (tests/platform-unit.test.mjs checks the same adapter timing rules without a browser, in fake time.)
import { chromium, devices } from 'playwright';
import { startServer, ENTRY, check, OLD_SAVE, SAVE_KEY } from './lib/harness.mjs';

const fakeSdk = () => {
  const w = window;
  w.__f = { ready: 0, init: 0, ads: [], ev: {}, cloud: null, lb: [], mode: 'lite', gp: [] };
  const ysdk = {
    features: { LoadingAPI: { ready() {
      w.__f.ready++;
      const g = (fn) => { try { return fn(); } catch (_) { return 'tdz'; } };
      w.__f.readyAt = { boot: g(() => bootCompleted), frame: g(() => V54_STABILITY.frame), splashHidden: document.getElementById('bootSplash').classList.contains('hide') };
    } }, GameplayAPI: { start() { w.__f.gp.push('start'); }, stop() { w.__f.gp.push('stop'); } } },
    adv: {
      showRewardedVideo(o) { w.__f.ads.push({ kind: 'rewarded', cb: o.callbacks }); },
      showFullscreenAdv(o) { w.__f.ads.push({ kind: 'fullscreen', cb: o.callbacks }); },
    },
    getPlayer: async () => ({
      getMode: () => w.__f.mode,
      setData: async (d) => { w.__f.cloud = d; },
      getData: async () => w.__f.cloud || {},
    }),
    getLeaderboards: async () => ({ setLeaderboardScore: async (n, s) => { w.__f.lb.push([n, s]); } }),
    environment: { i18n: { lang: 'ru' } },
    on(name, cb) { w.__f.ev[name] = cb; },
  };
  w.YaGames = { init: async () => { w.__f.init++; return ysdk; } };
};

async function launch(server, query, save, { fake = true } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors = [], bad = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('navigator.vibrate') && !/\/sdk\.js$/.test((m.location() || {}).url || '')) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !(fake === false && /\/sdk\.js$/.test(r.url()))) bad.push(`${r.status()} ${r.url()}`); });
  if (fake) await page.addInitScript(fakeSdk);
  if (save) await page.addInitScript(({ k, v }) => { try { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem(k, JSON.stringify(v)); } } catch (_) {} }, { k: SAVE_KEY, v: save });
  await page.goto(`${server.url}/${ENTRY}${query}`, { waitUntil: 'load' });
  return { browser, page, errors, bad };
}
const sleep = (page, ms) => page.waitForTimeout(ms);

const server = await startServer();
try {
  // ---------------- launch 1: ?yandex=1 ----------------
  const g = await launch(server, '?yandex=1', OLD_SAVE);
  const { page } = g;
  await page.waitForFunction(() => window.__f.ready >= 1, null, { timeout: 60000 }).catch(() => {});
  await sleep(page, 1500);
  const boot = await page.evaluate(() => ({ ready: __f.ready, init: __f.init, hasRewarded: typeof TycoonPlatform.showRewardedAd, stage: stageIndex, frames: V54_STABILITY.frame }));
  check(boot.init === 1 && boot.ready === 1, `LoadingAPI.ready called exactly once after init (init ${boot.init}, ready ${boot.ready})`);
  check(boot.hasRewarded === 'function' && boot.stage === 1, 'platform attached after SDK init; old save still loads');
  const ra = await page.evaluate(() => __f.readyAt);
  check(ra.boot === true && ra.splashHidden === true && ra.frame >= 2, `LoadingAPI.ready came after the first frame and the hidden boot splash (${JSON.stringify(ra)})`);
  const lg = await page.evaluate(() => ({ lang, html: document.documentElement.lang }));
  check(lg.lang === 'ru' && lg.html === 'ru', `language taken from ysdk.environment.i18n.lang (phone locale en-US -> game ru) ${JSON.stringify(lg)}`);

  // GameplayAPI: start after ready (welcome card closed), stop for hidden tab / blur / open menu, start again
  await page.evaluate(() => { document.getElementById('hintCloseBtn')?.click(); });
  const lastGp = () => page.evaluate(() => __f.gp[__f.gp.length - 1]);
  const gpIs = (v) => page.waitForFunction((x) => __f.gp[__f.gp.length - 1] === x, v, { timeout: 8000 }).then(() => true, () => false);
  check(await gpIs('start'), `GameplayAPI.start while playing (calls ${JSON.stringify(await page.evaluate(() => __f.gp))})`);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await gpIs('stop') && await page.evaluate(() => TycoonPlatform.paused && muted), 'tab hidden: GameplayAPI.stop, loop paused, sound muted');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check(await gpIs('start') && await page.evaluate(() => !TycoonPlatform.paused && !muted), 'tab visible: GameplayAPI.start, resumed');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check(await gpIs('stop') && await page.evaluate(() => TycoonPlatform.paused), 'window blur: stop + pause');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(await gpIs('start'), 'focus back: start');
  await page.evaluate(() => document.getElementById('systemsBtn').click());
  check(await gpIs('stop') && await page.evaluate(() => !TycoonPlatform.paused), 'menu opened through the real button: GameplayAPI.stop (world not muted)');
  await page.evaluate(() => document.getElementById('systemsClose').click());
  check(await gpIs('start'), 'menu closed: GameplayAPI.start');
  check(g.errors.length === 0 && g.bad.length === 0, `no console errors / 4xx with ?yandex=1 (fake SDK injected) ${JSON.stringify([...g.errors, ...g.bad].slice(0, 3))}`);

  const frames = () => page.evaluate(() => V54_STABILITY.frame);
  const f0 = await frames(); await sleep(page, 2500); const f1 = await frames();
  check(f1 > f0, `game loop runs normally (${f0} -> ${f1})`);

  // rewarded ad: onError grants nothing
  const state = () => page.evaluate(() => ({ muted, paused: !!TycoonPlatform.paused, income: rewardBoostState.incomeUntil > Date.now(), n: __f.ads.length }));
  await page.evaluate(() => { window.__r = null; claimRewardedBonus('income').then((v) => { window.__r = v; }); });
  await page.waitForFunction(() => __f.ads.length === 1);
  let s = await state();
  check(s.muted === true && s.paused === true, 'during the ad: game audio muted and TycoonPlatform.paused');
  const fa = await frames(); await sleep(page, 1500); const fb = await frames();
  check(fb === fa, `during the ad: render loop frozen (${fa} -> ${fb})`);
  await page.evaluate(() => { __f.ads[0].cb.onOpen(); __f.ads[0].cb.onError(new Error('no fill')); });
  await page.waitForFunction(() => window.__r !== null);
  s = await state();
  check(await page.evaluate(() => window.__r) === false && !s.income, 'onError: no reward granted');
  check(s.muted === false && s.paused === false, 'after the failed ad: audio and loop restored');

  // closed without onRewarded: nothing
  await page.evaluate(() => { window.__r = null; claimRewardedBonus('income').then((v) => { window.__r = v; }); });
  await page.waitForFunction(() => __f.ads.length === 2);
  await page.evaluate(() => { __f.ads[1].cb.onOpen(); __f.ads[1].cb.onClose(false); });
  await page.waitForFunction(() => window.__r !== null);
  s = await state();
  check(await page.evaluate(() => window.__r) === false && !s.income, 'onClose without onRewarded: no reward');

  // rewarded: reward only after onRewarded, user had sound OFF before -> stays OFF afterwards
  await page.evaluate(() => { muted = true; window.__r = null; claimRewardedBonus('income').then((v) => { window.__r = v; }); });
  await page.waitForFunction(() => __f.ads.length === 3);
  await page.evaluate(() => { __f.ads[2].cb.onOpen(); });
  s = await state();
  check(!s.income, 'before onRewarded: nothing granted yet');
  await page.evaluate(() => { __f.ads[2].cb.onRewarded(); __f.ads[2].cb.onClose(true); });
  await page.waitForFunction(() => window.__r !== null);
  s = await state();
  check(await page.evaluate(() => window.__r) === true && s.income, 'onRewarded + onClose: reward granted');
  check(s.muted === true && s.paused === false, 'previous mute state (muted) preserved after the ad');
  await page.evaluate(() => { muted = false; });
  const f2 = await frames(); await sleep(page, 2500);
  check((await frames()) > f2, 'render loop resumed after the ad');

  // platform pause / resume events
  await page.evaluate(() => __f.ev.game_api_pause());
  s = await state(); check(s.paused && s.muted, 'game_api_pause pauses and mutes');
  await page.evaluate(() => __f.ev.game_api_resume());
  s = await state(); check(!s.paused && !s.muted, 'game_api_resume restores');

  // interstitial: frequency cap (the game never calls it by itself; the adapter refuses early/too frequent/busy calls without touching the SDK)
  const adsN = () => page.evaluate(() => __f.ads.length);
  const nAds0 = await adsN();
  check(await page.evaluate(() => showInterstitialAd()) === false && await adsN() === nAds0, 'interstitial in the first minute after ready: refused, SDK not called');
  await page.evaluate(() => { TycoonPlatform._cfg.firstInterstitialMs = 0; });
  check(await page.evaluate(() => showInterstitialAd()) === false && await adsN() === nAds0, 'interstitial right after the rewarded ads above (< 90 s since the last ad): refused');
  await page.evaluate(() => { TycoonPlatform._cfg.interstitialGapMs = 0; sourceTrees[0].state = 'chopping'; });
  check(await page.evaluate(() => showInterstitialAd()) === false && await adsN() === nAds0, 'interstitial while a tree is being chopped: refused');
  await page.evaluate(() => { sourceTrees[0].state = 'grown'; carriedLogs = 2; });
  check(await page.evaluate(() => showInterstitialAd()) === false && await adsN() === nAds0, 'interstitial while carrying logs: refused');
  await page.evaluate(() => { carriedLogs = 0; window.__i = null; showInterstitialAd().then((v) => { window.__i = v; }); });
  await page.waitForFunction((n) => __f.ads.length === n + 1, nAds0);
  await page.evaluate(() => { __f.ads[__f.ads.length - 1].cb.onOpen(); __f.ads[__f.ads.length - 1].cb.onClose(true); });
  await page.waitForFunction(() => window.__i !== null);
  check(await page.evaluate(() => window.__i) === true, 'caps satisfied, idle player: interstitial shown, resolves true');
  await page.evaluate(() => { TycoonPlatform._cfg.interstitialGapMs = 90000; });
  check(await page.evaluate(() => showInterstitialAd()) === false && await adsN() === nAds0 + 1, 'second interstitial right after: refused (>= 90 s between ads)');

  // native confirm() is replaced by a two-tap confirmation on the platform
  const cf = await page.evaluate(() => [confirm('Reset?'), confirm('Reset?'), confirm('Reset?')]);
  check(cf[0] === false && cf[1] === true && cf[2] === false, `confirm(): first call false (toast), second true ${JSON.stringify(cf)}`);

  // cloud save / load / leaderboard
  const cloud = await page.evaluate(async () => {
    const raw = JSON.stringify({ saveVersion: 64, savedAt: 123456, stageIndex: 3, buildings: [{ index: 0 }] });
    const ok = await cloudSave(raw);
    return { ok, stored: __f.cloud && __f.cloud.save === raw && __f.cloud.savedAt === 123456, back: (await cloudLoad()) === raw, tooBig: await cloudSave('x'.repeat(200000)) };
  });
  check(cloud.ok === true && cloud.stored && cloud.back && cloud.tooBig === false, `cloud save/load round-trip, oversize refused ${JSON.stringify(cloud)}`);
  const lb = await page.evaluate(async () => {
    const lite = await submitLeaderboardScore(1234.9); const callsLite = __f.lb.length;
    __f.mode = 'logged'; const ok = await submitLeaderboardScore(1234.9);
    const again = await submitLeaderboardScore(5000);
    return { lite, callsLite, ok, again, calls: __f.lb.length, call: __f.lb[0] };
  });
  check(lb.lite === false && lb.callsLite === 0 && lb.ok === true && lb.call[1] === 1234, `leaderboard skipped for unauthorised (guest), submitted (floored) for authorised ${JSON.stringify(lb)}`);
  check(lb.again === false && lb.calls === 1, 'leaderboard submissions are throttled (second one within 10 s not sent)');

  // cloud restore decision (localStorage is the source of truth)
  const d = await page.evaluate(() => {
    const r = TycoonPlatform._shouldRestore, S = (o) => JSON.stringify(o);
    const played = { savedAt: 1000000, stageIndex: 2, buildings: [{}] };
    return {
      absent: r(null, S({ savedAt: 5, stageIndex: 1 })),
      cloudNewer: r(S(played), S({ ...played, savedAt: 1010000 })),
      cloudOlder: r(S(played), S({ ...played, savedAt: 900000 })),
      localNoStamp: r(S({ stageIndex: 2, buildings: [{}] }), S({ ...played, savedAt: 9e12 })),
      cloudNoStamp: r(null, S({ stageIndex: 2 })),
      pristineLocal: r(S({ savedAt: 9e12, stageIndex: 0, buildings: [] }), S(played)),
      garbage: r('{bad', 'nope'),
    };
  });
  check(d.absent && d.cloudNewer && d.pristineLocal && !d.cloudOlder && !d.localNoStamp && !d.cloudNoStamp && !d.garbage, `restore decision rules ${JSON.stringify(d)}`);
  check(g.errors.length === 0 && g.bad.length === 0, `still no console errors / 4xx at the end of launch 1 ${JSON.stringify([...g.errors, ...g.bad].slice(0, 3))}`);
  await g.browser.close();

  // ---------------- launch 2: no ?yandex=1 ----------------
  const h = await launch(server, '', OLD_SAVE);
  await sleep(h.page, 4000);
  const inert = await h.page.evaluate(() => ({
    keys: Object.keys(window.TycoonPlatform || {}), init: __f.init, ready: __f.ready, rewarded: rewardedAvailable(),
    stage: stageIndex, b: buildings.length, paused: !!(window.TycoonPlatform && window.TycoonPlatform.paused), frames: V54_STABILITY.frame,
  }));
  check(inert.keys.length === 0 && inert.init === 0 && inert.ready === 0 && inert.rewarded === false, `without ?yandex=1 TycoonPlatform is inert and the SDK is never touched ${JSON.stringify(inert)}`);
  check(inert.stage === 1 && inert.b === 1 && !inert.paused && inert.frames > 0, 'old save boots and the loop runs as before');
  check(h.errors.length === 0 && h.bad.length === 0, 'no errors / 4xx without ?yandex=1');
  await h.browser.close();

  // ---------------- launch 3: ?yandex=1, the SDK file is missing (404 off the platform) ----------------
  const n = await launch(server, '?yandex=1', OLD_SAVE, { fake: false });
  await n.page.waitForFunction(() => typeof bootCompleted !== 'undefined' && bootCompleted === true, null, { timeout: 60000 }).catch(() => {});
  await sleep(n.page, 2500);
  const miss = await n.page.evaluate(() => ({
    active: !!(window.TycoonPlatform && window.TycoonPlatform.active), methods: Object.keys(window.TycoonPlatform || {}).filter((k) => typeof window.TycoonPlatform[k] === 'function' && !k.startsWith('_')),
    rewarded: rewardedAvailable(), paused: !!window.TycoonPlatform.paused, stage: stageIndex, frames: V54_STABILITY.frame, yagames: typeof window.YaGames,
  }));
  check(miss.active && miss.methods.length === 0 && miss.rewarded === false && !miss.paused && miss.yagames === 'undefined', `SDK file missing: adapter passive, no ad/cloud methods, rewarded unavailable ${JSON.stringify(miss)}`);
  check(miss.stage === 1 && miss.frames > 1, 'SDK file missing: old save loads, loop runs');
  const g0 = await n.page.evaluate(() => V54_STABILITY.frame); await sleep(n.page, 2000);
  check((await n.page.evaluate(() => V54_STABILITY.frame)) > g0, 'SDK file missing: render loop keeps running');
  await n.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check(await n.page.evaluate(() => TycoonPlatform.paused && muted), 'SDK file missing: blur still pauses and mutes');
  await n.page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  check(await n.page.evaluate(() => !TycoonPlatform.paused && !muted), 'SDK file missing: interaction resumes');
  check(n.errors.length === 0 && n.bad.length === 0, `SDK file missing: no console errors/4xx except the /sdk.js 404 ${JSON.stringify([...n.errors, ...n.bad].slice(0, 3))}`);
  await n.browser.close();
} finally { await server.close(); }
