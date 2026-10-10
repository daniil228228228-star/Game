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
 *
 * 2026-10-05 (ROADMAP task 6): LoadingAPI.ready only once the game is really playable (first frame rendered,
 * boot splash hidden, cloud save decision made); GameplayAPI.start/stop follow "playing" (not hidden / blurred /
 * in an ad / in a menu); pause reasons hidden + blur; interstitial frequency cap (never in the first minute after
 * ready, >= 90 s after any ad, never while chopping/carrying); leaderboard throttle; native confirm() replaced by a
 * two-tap confirmation (the platform iframe may forbid modal dialogs); language taken from
 * ysdk.environment.i18n.lang when the player has not picked one. Tunables live in TycoonPlatform._cfg (tests).
 */
(function () {
  'use strict';
  var SAVE_KEY = 'tycoon3d_save_v3'; // same value as SAVE_KEY in tycoon-v161.html
  var LANG_KEY = 'tycoon3d_lang';    // same value as LANG_KEY in tycoon-v161.html
  var CLOUD_LIMIT = 190000;          // Yandex player data limit is 200 KB in total
  // Gameplay state created by later systems lives outside SAVE_KEY. It is packed into the cloud
  // copy so another device restores one coherent run. Device preferences intentionally stay local.
  var CLOUD_AUX_KEYS_V161 = [
    'tycoon3d_v351_guide_rewards','tycoon3d_v351_guide_rewards_initialized','tycoon3d_v352_guide_state',
    'tycoon3d_v40_city_systems','tycoon_v41_utilities_density','tycoon_v42_municipal_operations',
    'tycoon3d_v119_manual_market_fleet','tycoon3d_v125_activity','tycoon3d_v127_shift_goals',
    'tycoon3d_v128_engagement','tycoon3d_v135_contract_board','tycoon3d_v144_start_flow',
    'tycoon3d_v145_fleet_economy','tycoon3d_v146_site_assist'
  ];
  // Modal screens of the game (same list as currentOverlayV46): the player is not "in gameplay" while one is open.
  var MODAL_SEL = '#systemsOverlay.show,#metaOverlay.show,#staffOverlay.show,#projectsOverlay.show,#bonusOverlay.show,#fleetOverlay.show,#baseOverlay.show,#tendersOverlay.show,#operationsOverlay.show,#cityOverlay.show,#achOverlay.show,#hintOverlay.show';
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
  var CFG = P._cfg = {
    uploadEveryMs: 60000,        // cloud save / auto leaderboard tick
    forcedUploadGapMs: 5000,     // forced uploads (tab hidden, pagehide) never closer than this
    adWatchdogMs: 180000,
    firstInterstitialMs: 60000,  // no interstitial in the first minute after LoadingAPI.ready
    interstitialGapMs: 90000,    // ... and none sooner than this after any ad ended
    scoreGapMs: 10000,           // leaderboard submissions at least this far apart (platform limit is ~1/s)
    readyFallbackMs: 30000,      // LoadingAPI.ready even if the boot flag never came (game is broken then anyway)
    cloudWaitMs: 8000,           // ready waits for the cloud-save decision at most this long
  };
  var ysdk = null, player = null, lbPromise = null, sdkLang = null, started = false;
  var reasons = {}, prevMuted = null, adBusy = false, readyDone = false, readyAt = 0, cloudSettled = false, restoring = false;
  var gpOn = false, lastAdEndAt = 0, lastScoreAt = 0, langDone = false;

  function safe(fn) { try { return fn(); } catch (_) { return undefined; } }
  function settle(promise, fallback) { return Promise.resolve(promise).then(function (v) { return v; }, function () { return fallback; }); }

  /* ---- pause / mute (reason-counted: ads, game_api_pause, hidden tab and lost focus may overlap) ---- */
  function anyReason() { for (var k in reasons) if (reasons[k]) return true; return false; }
  function modalOpen() {
    return !!safe(function () { return document.querySelector(MODAL_SEL) || (document.body && document.body.classList.contains('v46-modal-open')); });
  }
  // GameplayAPI.start/stop: "playing" = playable (ready), not paused for any reason, no menu/panel open.
  function syncGameplay() {
    var want = readyDone && !anyReason() && !modalOpen();
    if (want === gpOn) return;
    gpOn = want;
    safe(function () { var g = ysdk.features.GameplayAPI; if (want) g.start(); else g.stop(); });
  }
  function applyPause() {
    var want = anyReason();
    if (want !== P.paused) {
      P.paused = want;
      if (want) {
        safe(function () { if (typeof muted !== 'undefined') { prevMuted = muted; muted = true; } });
        safe(function () { if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running') audioCtx.suspend(); });
      } else {
        safe(function () { if (typeof muted !== 'undefined' && prevMuted !== null) muted = prevMuted; prevMuted = null; });
        safe(function () { if (typeof muted !== 'undefined' && !muted && typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });
        safe(function () { if (typeof clock !== 'undefined') clock.getDelta(); }); // drop the pause-long frame delta
      }
    }
    syncGameplay();
  }
  function setReason(name, on) { reasons[name] = !!on; applyPause(); }

  /* ---- ads ---- */
  // Never interrupt hands-on work: a tree being chopped, logs or materials in the player's hands.
  function playerBusy() {
    return !!safe(function () {
      if (typeof sourceTrees !== 'undefined' && sourceTrees.some(function (t) { return t && t.state === 'chopping'; })) return true;
      if (typeof carriedLogs !== 'undefined' && carriedLogs > 0) return true;
      var c = window.__TYCOON_V123__ && window.__TYCOON_V123__.state && window.__TYCOON_V123__.state.carry;
      return !!(c && Number(c.amount) > 0);
    });
  }
  function interstitialAllowed() {
    var now = Date.now();
    if (!readyDone || now - readyAt < CFG.firstInterstitialMs) return false;
    if (lastAdEndAt && now - lastAdEndAt < CFG.interstitialGapMs) return false;
    if (document.hidden || reasons.api || reasons.blur) return false;
    return !playerBusy();
  }
  function runAd(kind, reason) {
    return new Promise(function (resolve) {
      if (!ysdk || adBusy) return resolve(false);
      if (kind !== 'rewarded' && !interstitialAllowed()) return resolve(false);
      var rewarded = false, done = false, timer = null;
      adBusy = true;
      function finish(result) {
        if (done) return; done = true;
        clearTimeout(timer);
        adBusy = false; lastAdEndAt = Date.now(); setReason('ad', false);
        resolve(result);
      }
      timer = setTimeout(function () { finish(kind === 'rewarded' ? rewarded : false); }, CFG.adWatchdogMs);
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
  function cloudPayloadV161(data) {
    var core = parse(data); if (!core) return data;
    var aux = {}, packed = data;
    // Add keys in priority order and stop each addition at the platform payload ceiling.
    for (var i = 0; i < CLOUD_AUX_KEYS_V161.length; i++) {
      var key = CLOUD_AUX_KEYS_V161[i];
      var raw = safe(function () { return localStorage.getItem(key); });
      if (!raw || typeof raw !== 'string' || raw.length > 650000) continue;
      var value = parse(raw); if (!value) continue;
      aux[key] = value; core.cloudAuxV161 = aux;
      var candidate = safe(function () { return JSON.stringify(core); });
      if (!candidate || candidate.length > CLOUD_LIMIT) delete aux[key]; else packed = candidate;
    }
    return packed;
  }
  function restoreCloudAuxV161(parsed) {
    var aux = parsed && parsed.cloudAuxV161;
    if (!aux || typeof aux !== 'object') return 0;
    var restored = 0;
    for (var i = 0; i < CLOUD_AUX_KEYS_V161.length; i++) {
      var key = CLOUD_AUX_KEYS_V161[i];
      if (!Object.prototype.hasOwnProperty.call(aux, key)) continue;
      var raw = safe(function () { return JSON.stringify(aux[key]); });
      if (!raw || raw.length > 650000) continue;
      safe(function () { localStorage.setItem(key, raw); restored++; });
    }
    return restored;
  }
  function cloudSave(data, flush) {
    if (!player || typeof data !== 'string' || !data) return Promise.resolve(false);
    var uploadData = cloudPayloadV161(data);
    if (!uploadData || uploadData.length > CLOUD_LIMIT) return Promise.resolve(false);
    var o = parse(uploadData);
    // flush=true (tab hidden / pagehide) asks the SDK to send now instead of batching; ignored by SDKs that do not know it.
    return settle(Promise.resolve(player.setData({ save: uploadData, savedAt: (o && Number(o.savedAt)) || Date.now() }, !!flush)).then(function () {
      lastUploadedRaw = data; return true;
    }), false);
  }
  function cloudLoad() {
    if (safe(function () { return sessionStorage.getItem('tycoonSkipCloudRestoreOnceV161'); }) === '1') {
      safe(function () { sessionStorage.removeItem('tycoonSkipCloudRestoreOnceV161'); });
      return Promise.resolve(null);
    }
    if (!player) return Promise.resolve(null);
    return settle(Promise.resolve(player.getData(['save'])).then(function (d) {
      var raw = d && typeof d.save === 'string' ? d.save : null;
      var parsed = parse(raw);
      return parsed && parsed.resetV161 === true ? null : raw;
    }), null);
  }
  function syncTick(force) {
    if (!player) return;
    var raw = safe(function () { return localStorage.getItem(SAVE_KEY); });
    if (!raw || raw === lastUploadedRaw) return;
    var gap = Date.now() - lastUploadAt;
    if (gap < (force ? CFG.forcedUploadGapMs : CFG.uploadEveryMs)) return;
    lastUploadAt = Date.now(); // stamp on request: a slow/failed upload must not be retried in a burst
    cloudSave(raw, force);
  }
  // Returns true only when it really starts the reload.
  function restoreFromCloud(cloudRaw) {
    var parsedCloud = parse(cloudRaw) || {};
    var stamp = String(parsedCloud.savedAt || '');
    if (safe(function () { return sessionStorage.getItem('tycoonYandexRestored'); }) === stamp) return false; // never loop
    safe(function () { sessionStorage.setItem('tycoonYandexRestored', stamp); });
    safe(function () { if (typeof suppressAutoSaveV36 !== 'undefined') suppressAutoSaveV36 = true; }); // reload must not re-save the old state
    try {
      restoreCloudAuxV161(parsedCloud);
      delete parsedCloud.cloudAuxV161;
      var coreRaw = JSON.stringify(parsedCloud);
      localStorage.setItem(SAVE_KEY, coreRaw);
      ['tycoon3d_save_v3_backup', 'tycoon3d_save_v52_recovery'].forEach(function (k) { safe(function () { localStorage.removeItem(k); }); });
      lastUploadedRaw = coreRaw;
      location.reload();
      return true;
    } catch (_) { safe(function () { if (typeof suppressAutoSaveV36 !== 'undefined') suppressAutoSaveV36 = false; }); return false; }
  }

  /* ---- leaderboard (authorised players only, throttled) ---- */
  var lastScore = 0;
  function submitLeaderboardScore(score) {
    score = Math.max(0, Math.floor(Number(score) || 0));
    if (!ysdk || !player) return Promise.resolve(false);
    if (safe(function () { return player.getMode && player.getMode() === 'lite'; })) return Promise.resolve(false); // guest: not authorised
    if (lastScoreAt && Date.now() - lastScoreAt < CFG.scoreGapMs) return Promise.resolve(false); // the 60 s tick sends the newest value later
    lastScoreAt = Date.now();
    if (!lbPromise) lbPromise = Promise.resolve().then(function () { return ysdk.getLeaderboards(); });
    return settle(lbPromise.then(function (lb) { return lb.setLeaderboardScore(LEADERBOARD, score); }).then(function () { lastScore = score; return true; }), false);
  }

  /* ---- boot: loading screen text, language, LoadingAPI.ready ---- */
  var SPLASH_EN = 'Build your company. Grow districts. Bring the city to life.';
  function guessLang() {
    var saved = safe(function () { return localStorage.getItem(LANG_KEY); });
    if (saved) return saved;
    return /^ru/i.test(safe(function () { return navigator.language; }) || '') ? 'ru' : 'en';
  }
  // The boot splash subtitle is plain Russian in the page; show the English one when the game will start in English.
  function localizeSplash(l) {
    safe(function () {
      var el = document.querySelector('#bootSplash .bootSub');
      if (el && l && l !== 'ru') el.textContent = SPLASH_EN;
    });
  }
  // Yandex language -> game language (the game has ru/en). CIS languages fall back to Russian, everything else to English.
  function mapLang(l) { return /^(ru|be|kk|uk|uz)/i.test(String(l || '')) ? 'ru' : 'en'; }
  function applySdkLang() {
    if (langDone || !sdkLang) return;
    langDone = true;
    if (safe(function () { return localStorage.getItem(LANG_KEY); })) return; // the player chose a language: keep it
    safe(function () {
      if (typeof lang === 'undefined' || lang === sdkLang) return;
      lang = sdkLang;
      if (typeof applyLanguage === 'function') applyLanguage();
    });
  }
  function bootDone() {
    if (safe(function () { return bootCompleted === true; }) !== true) return false; // first frame rendered
    if (!((safe(function () { return V54_STABILITY.frame; }) || 0) >= 2)) return false;
    return safe(function () { var s = document.getElementById('bootSplash'); return !s || s.classList.contains('hide'); }) !== false;
  }
  // LoadingAPI.ready exactly once: the game is playable (booted, splash gone) and the cloud decision is made
  // (a cloud restore reloads the page, which would make an earlier ready() premature).
  function maybeReady(t0) {
    if (readyDone || !ysdk || restoring) return;
    var elapsed = Date.now() - t0, booted = bootDone();
    if (booted) applySdkLang();
    if ((booted && (cloudSettled || elapsed > CFG.cloudWaitMs)) || elapsed > CFG.readyFallbackMs) {
      readyDone = true; readyAt = Date.now();
      applySdkLang();
      safe(function () { ysdk.features.LoadingAPI.ready(); });
      syncGameplay();
    } else setTimeout(function () { maybeReady(t0); }, 250);
  }

  function attach() {
    P.showInterstitialAd = function () { return runAd('interstitial'); };
    P.showRewardedAd = function (reason) { return runAd('rewarded', reason); };
    P.cloudSave = cloudSave;
    P.cloudLoad = cloudLoad;
    P.submitLeaderboardScore = submitLeaderboardScore;
  }

  function start() {
    if (started) return;
    started = true;
    var t0 = Date.now();
    Promise.resolve().then(function () { return window.YaGames.init(); }).then(function (sdk) {
      ysdk = sdk; P.sdk = sdk;
      var rawLang = safe(function () { return sdk.environment.i18n.lang; });
      sdkLang = rawLang ? mapLang(rawLang) : null; // unknown language: keep the game's own guess
      if (sdkLang) localizeSplash(sdkLang);
      attach();
      safe(function () { sdk.on('game_api_pause', function () { setReason('api', true); }); });
      safe(function () { sdk.on('game_api_resume', function () { setReason('api', false); }); });
      maybeReady(t0);
      return settle(sdk.getPlayer({ scopes: false }), null); // guest (lite) players are fine: no auth prompt
    }).then(function (pl) {
      if (!pl) { cloudSettled = true; return; }
      player = pl;
      return cloudLoad().then(function (cloudRaw) {
        if (cloudRaw && shouldRestore(safe(function () { return localStorage.getItem(SAVE_KEY); }), cloudRaw) && restoreFromCloud(cloudRaw)) { restoring = true; return; }
        cloudSettled = true;
        syncTick(true);
        setInterval(function () {
          syncTick(false);
          var earned = safe(function () { return Math.floor(stats.totalEarned); }) || 0;
          if (earned > lastScore) submitLeaderboardScore(earned);
        }, CFG.uploadEveryMs);
        document.addEventListener('visibilitychange', function () { if (document.hidden) syncTick(true); });
        addEventListener('pagehide', function () { syncTick(true); });
      });
    }).catch(function () { cloudSettled = true; /* SDK failed: game keeps working without ads/cloud */ });
  }

  /* ---- page-level hooks (active on the platform even before / without the SDK) ---- */
  // Hidden tab, lost focus: mute + freeze the loop. Any later interaction proves the focus is back.
  if (document.hidden) setReason('hidden', true);
  document.addEventListener('visibilitychange', function () { setReason('hidden', document.hidden); });
  addEventListener('blur', function () { setReason('blur', true); });
  ['focus', 'pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    addEventListener(ev, function () { if (reasons.blur) setReason('blur', false); }, { capture: true, passive: true });
  });
  // The page's 12 s boot watchdog paints a full-screen, never-removed "Игра не завершила запуск за 12 секунд" over the game. On a slow
  // phone the game may still finish booting afterwards, so on the platform this one notice is removed once the first frame is out.
  function dismissSlowBootNotice() {
    safe(function () {
      var el = document.getElementById('bootError');
      if (el && /^Игра не завершила запуск/.test(el.textContent || '') && bootDone()) { if (el.remove) el.remove(); else el.parentNode.removeChild(el); }
    });
  }
  setInterval(function () { syncGameplay(); dismissSlowBootNotice(); }, 500); // menu/panel open or closed; late boot
  localizeSplash(guessLang());

  // Native confirm() can be blocked in the platform iframe (no allow-modals) and then silently answers false, which
  // would make "reset" / "prestige" dead buttons. Same flow without a dialog: first call shows a toast, a second call
  // with the same text within 5 s confirms. (The v52 prestige arming sets confirm=()=>true for its second click itself.)
  (function () {
    var armed = {};
    window.confirm = function (msg) {
      var k = String(msg), now = Date.now();
      if (armed[k] && now - armed[k] < 5000) { delete armed[k]; return true; }
      armed[k] = now;
      safe(function () {
        var ru = typeof lang !== 'undefined' ? lang === 'ru' : /^ru/i.test(navigator.language || '');
        toast(k + ' ' + (ru ? '— нажми ещё раз, чтобы подтвердить' : '— tap again to confirm'));
      });
      return false;
    };
  })();

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
