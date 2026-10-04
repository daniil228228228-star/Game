/* Yandex Games platform adapter (2026-10-03).
 *
 * Defines window.TycoonPlatform for the safe wrappers in tycoon-v161.html (showInterstitialAd,
 * showRewardedAd, cloudSave, cloudLoad, submitLeaderboardScore) -- same names/arguments, no
 * parallel API. It does NOTHING unless the page is hosted on a Yandex domain (hostname contains
 * "yandex") or the URL has ?yandex=1; elsewhere window.TycoonPlatform is left untouched, so local
 * dev, tests and the standalone file behave exactly as before (missing platform = no ads/no cloud).
 *
 * Contract with the wrappers: they treat any truthy value as success, so every method resolves
 * a plain boolean (cloudLoad: the raw save string or null) and never rejects.
 * The only game-side hook is one line in animate() that returns early while TycoonPlatform.paused.
 * Game audio is muted through the game's own `muted` flag (restored afterwards, localStorage is
 * not touched). localStorage stays the source of truth for saves.
 */
(function () {
  'use strict';
  var SAVE_KEY = 'tycoon3d_save_v3'; // same value as SAVE_KEY in tycoon-v161.html
  var CLOUD_LIMIT = 190000;          // Yandex player data limit is 200 KB in total
  var UPLOAD_EVERY_MS = 60000;
  var AD_WATCHDOG_MS = 180000;
  var LEADERBOARD = (typeof window.TYCOON_YANDEX_LEADERBOARD === 'string' && window.TYCOON_YANDEX_LEADERBOARD) || 'tycoon';

  function onYandex() {
    try {
      return /yandex/i.test(location.hostname) || /[?&]yandex=1(&|$)/.test(location.search);
    } catch (_) { return false; }
  }
  if (!onYandex()) return;

  var P = window.TycoonPlatform = window.TycoonPlatform || {};
  P.active = true;
  P.paused = false;
  var ysdk = null, player = null, lbPromise = null;
  var reasons = {}, prevMuted = null, adBusy = false, readyDone = false;

  function safe(fn) { try { return fn(); } catch (_) { return undefined; } }
  function settle(promise, fallback) { return Promise.resolve(promise).then(function (v) { return v; }, function () { return fallback; }); }

  /* ---- pause / mute (reason-counted: ads and game_api_pause may overlap) ---- */
  function anyReason() { for (var k in reasons) if (reasons[k]) return true; return false; }
  function applyPause() {
    var want = anyReason();
    if (want === P.paused) return;
    P.paused = want;
    if (want) {
      safe(function () { if (typeof muted !== 'undefined') { prevMuted = muted; muted = true; } });
      safe(function () { if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running') audioCtx.suspend(); });
      safe(function () { ysdk && ysdk.features && ysdk.features.GameplayAPI && ysdk.features.GameplayAPI.stop(); });
    } else {
      safe(function () { if (typeof muted !== 'undefined' && prevMuted !== null) muted = prevMuted; prevMuted = null; });
      safe(function () { if (typeof muted !== 'undefined' && !muted && typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });
      safe(function () { if (typeof clock !== 'undefined') clock.getDelta(); }); // drop the pause-long frame delta
      safe(function () { ysdk && ysdk.features && ysdk.features.GameplayAPI && ysdk.features.GameplayAPI.start(); });
    }
  }
  function setReason(name, on) { reasons[name] = !!on; applyPause(); }

  /* ---- ads ---- */
  function runAd(kind, reason) {
    return new Promise(function (resolve) {
      if (!ysdk || adBusy) return resolve(false);
      var rewarded = false, done = false, timer = null;
      adBusy = true;
      function finish(result) {
        if (done) return; done = true;
        clearTimeout(timer);
        adBusy = false; setReason('ad', false);
        resolve(result);
      }
      timer = setTimeout(function () { finish(kind === 'rewarded' ? rewarded : false); }, AD_WATCHDOG_MS);
      try {
        if (kind === 'rewarded') {
          ysdk.adv.showRewardedVideo({ callbacks: {
            onOpen: function () { setReason('ad', true); },
            onRewarded: function () { rewarded = true; },
            onClose: function () { finish(rewarded); },
            onError: function () { finish(false); } // no reward on error, even if onRewarded was somehow seen
          } });
        } else {
          ysdk.adv.showFullscreenAdv({ callbacks: {
            onOpen: function () { setReason('ad', true); },
            onClose: function (wasShown) { finish(!!wasShown); },
            onError: function () { finish(false); }
          } });
        }
        // Mute/pause as soon as the ad is requested, not only on onOpen (some ads open late).
        setReason('ad', true);
      } catch (_) { finish(false); }
    });
  }

  /* ---- cloud save ---- */
  function parse(raw) { try { var o = JSON.parse(raw); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } }
  function pristine(s) { return !s.stageIndex && !(s.buildings && s.buildings.length) && !(s.activeBuilds && s.activeBuilds.length); }
  // Cloud fills in only when local is absent/unreadable/pristine or provably older (savedAt).
  // A local save without a timestamp (old format) is never overwritten.
  function shouldRestore(localRaw, cloudRaw) {
    var c = parse(cloudRaw); if (!c) return false;
    var cT = Number(c.savedAt) || 0; if (!cT) return false;
    if (!localRaw) return true;
    var l = parse(localRaw); if (!l) return true;
    if (pristine(l)) return !pristine(c);
    var lT = Number(l.savedAt) || 0; if (!lT) return false;
    return cT > lT + 2000;
  }
  P._shouldRestore = shouldRestore;

  var lastUploadedRaw = null, lastUploadAt = 0;
  function cloudSave(data) {
    if (!player || typeof data !== 'string' || !data || data.length > CLOUD_LIMIT) return Promise.resolve(false);
    var o = parse(data);
    return settle(player.setData({ save: data, savedAt: (o && Number(o.savedAt)) || Date.now() }).then(function () {
      lastUploadedRaw = data; lastUploadAt = Date.now(); return true;
    }), false);
  }
  function cloudLoad() {
    if (!player) return Promise.resolve(null);
    return settle(player.getData(['save']).then(function (d) { return d && typeof d.save === 'string' ? d.save : null; }), null);
  }
  function syncTick(force) {
    if (!player) return;
    var raw = safe(function () { return localStorage.getItem(SAVE_KEY); });
    if (!raw || raw === lastUploadedRaw) return;
    if (!force && Date.now() - lastUploadAt < UPLOAD_EVERY_MS) return;
    cloudSave(raw);
  }
  function restoreFromCloud(cloudRaw) {
    var stamp = String((parse(cloudRaw) || {}).savedAt || '');
    if (safe(function () { return sessionStorage.getItem('tycoonYandexRestored'); }) === stamp) return; // never loop
    safe(function () { sessionStorage.setItem('tycoonYandexRestored', stamp); });
    safe(function () { if (typeof suppressAutoSaveV36 !== 'undefined') suppressAutoSaveV36 = true; }); // reload must not re-save the old state
    try {
      localStorage.setItem(SAVE_KEY, cloudRaw);
      ['tycoon3d_save_v3_backup', 'tycoon3d_save_v52_recovery'].forEach(function (k) { safe(function () { localStorage.removeItem(k); }); });
      lastUploadedRaw = cloudRaw;
      location.reload();
    } catch (_) { safe(function () { if (typeof suppressAutoSaveV36 !== 'undefined') suppressAutoSaveV36 = false; }); }
  }

  /* ---- leaderboard (authorised players only) ---- */
  var lastScore = 0;
  function submitLeaderboardScore(score) {
    score = Math.max(0, Math.floor(Number(score) || 0));
    if (!ysdk || !player) return Promise.resolve(false);
    if (safe(function () { return player.getMode && player.getMode() === 'lite'; })) return Promise.resolve(false); // not authorised
    if (!lbPromise) lbPromise = Promise.resolve().then(function () { return ysdk.getLeaderboards(); });
    return settle(lbPromise.then(function (lb) { return lb.setLeaderboardScore(LEADERBOARD, score); }).then(function () { lastScore = score; return true; }), false);
  }

  /* ---- LoadingAPI.ready: once, after the game rendered its first frames ---- */
  function maybeReady(started) {
    if (readyDone || !ysdk) return;
    var frames = safe(function () { return typeof V54_STABILITY !== 'undefined' ? V54_STABILITY.frame : 0; }) || 0;
    if (frames > 1 || Date.now() - started > 20000) {
      readyDone = true;
      safe(function () { ysdk.features.LoadingAPI.ready(); });
    } else setTimeout(function () { maybeReady(started); }, 250);
  }

  function attach() {
    P.showInterstitialAd = function () { return runAd('interstitial'); };
    P.showRewardedAd = function (reason) { return runAd('rewarded', reason); };
    P.cloudSave = cloudSave;
    P.cloudLoad = cloudLoad;
    P.submitLeaderboardScore = submitLeaderboardScore;
  }

  function start() {
    var started = Date.now();
    Promise.resolve().then(function () { return window.YaGames.init(); }).then(function (sdk) {
      ysdk = sdk; P.sdk = sdk;
      attach();
      safe(function () { sdk.on('game_api_pause', function () { setReason('api', true); }); });
      safe(function () { sdk.on('game_api_resume', function () { setReason('api', false); }); });
      maybeReady(started);
      return settle(sdk.getPlayer({ scopes: false }), null);
    }).then(function (pl) {
      if (!pl) return;
      player = pl;
      return cloudLoad().then(function (cloudRaw) {
        if (cloudRaw && shouldRestore(safe(function () { return localStorage.getItem(SAVE_KEY); }), cloudRaw)) { restoreFromCloud(cloudRaw); return; }
        syncTick(true);
        setInterval(function () {
          syncTick(false);
          var earned = safe(function () { return Math.floor(stats.totalEarned); }) || 0;
          if (earned > lastScore) submitLeaderboardScore(earned);
        }, UPLOAD_EVERY_MS);
        document.addEventListener('visibilitychange', function () { if (document.hidden) syncTick(true); });
        addEventListener('pagehide', function () { syncTick(true); });
      });
    }).catch(function () { /* SDK failed: game keeps working without ads/cloud */ });
  }

  if (window.YaGames && typeof window.YaGames.init === 'function') start();
  else {
    var s = document.createElement('script');
    s.src = '/sdk.js'; // served by the Yandex Games platform itself
    s.async = true;
    s.onload = function () { if (window.YaGames) start(); };
    s.onerror = function () { /* not on the platform: stay without SDK */ };
    (document.head || document.documentElement).appendChild(s);
  }
})();
