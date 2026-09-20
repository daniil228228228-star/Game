# Tycoon 3D — Vision & Roadmap

This document is the standing brief for every future work session on this project
(autonomous loop or human-directed). Read it before picking the next task. Update
its checkboxes and `CHANGELOG.md` at the end of every session so state stays legible
to whoever (or whatever) works on this next.

## What this project is

A polished, replayable, fully client-side 3D tycoon game in the Roblox-tycoon
tradition: run around your plot, step on pads to build and upgrade, watch your
income grow, prestige for permanent bonuses, repeat. Single game, no backend,
no login, no build step — it must keep working as a file you can open in a
browser or publish as a static page.

**Non-negotiables (never trade these away for a feature):**
- Zero friction: opens instantly, no loading screen beyond first paint, no accounts.
- Runs well on a mid-range phone at 60fps, touch-first but mouse/keyboard-perfect too.
- No external runtime dependency — Three.js stays vendored in `vendor/`, no CDN calls.
- Every save-format change ships with a migration; a returning player's progress
  is never silently wiped.
- Every new mechanic ships with a Playwright regression test before it's considered done.
- Player actions get immediate feedback (sound, particles, camera shake, animated
  counters) — extend this "juice" standard to new systems, don't let new features
  feel flatter than the old ones.

## How to work a session

1. Read this file and `CHANGELOG.md`.
2. Pick the **first unchecked item**, in order, from the earliest incomplete phase
   below. Don't skip ahead to something more fun unless the earlier item is blocked
   (note why, in the changelog, if so).
3. Scope the change to one focused, testable increment. Big items (marked 🔷 below)
   are expected to take several sessions — do one slice of them per session, not
   the whole thing at once.
4. Implement it, then add or extend a test in `tests/` covering the new behavior.
5. Run the **full** existing test suite, not just the new test — regressions are
   cheaper to catch here than after ten more sessions build on top of a broken one.
6. Update `CHANGELOG.md` with what changed and check off the item below (or convert
   it into sub-bullets if it turned out to need more than one session).
7. Commit with a descriptive message and push to the branch.

---

## Phase 1 — Core loop polish

- [x] Balance pass: simulated the base (level-1, no-upgrade, no-achievement-bonus)
      time-to-build curve from the live `STAGES` data (see `tests/balance.test.mjs`,
      which re-derives and locks this curve in as a regression check). **Decided
      target curve** (starting cash 300, no upgrades purchased):

      | Stage | Cost | Wait | Cumulative |
      |---|---|---|---|
      | Дом | 50 | instant | 0.0 min |
      | Второй дом | 150 | instant | 0.0 min |
      | Магазин | 400 | ~1.7 min | 1.7 min |
      | Склад | 900 | ~1.9 min | 3.5 min |
      | Мини-завод | 2 000 | ~2.1 min | 5.6 min |
      | Завод | 5 000 | ~2.7 min | 8.3 min |
      | Офис | 12 000 | ~3.3 min | 11.6 min |
      | Бизнес-центр | 30 000 | ~4.1 min | 15.7 min |
      | Небоскрёб | 80 000 | ~5.5 min | 21.3 min |
      | Империя | 200 000 | ~6.8 min | 28.1 min |

      The first two buildings are instant **by design** — starting cash is meant to
      cover them so a new player's very first minute has zero wait (fast hook,
      immediately teaches the pad mechanic). From stage 2 the ramp is smooth
      (~1.7 → ~6.8 min/stage), and a full base playthrough lands at ~28 minutes,
      inside the 15–30 min late-game target. Per-building upgrades (levels 2–3)
      and achievement-reward cash both shorten this in practice, which is fine —
      they're the reward for engaging with those systems, not pacing bugs. No
      cost/income numbers needed to change; the existing curve already hits the
      target, so this pass's deliverable is the verified table above plus the
      regression test that keeps it true.
- [x] Verify each prestige tier meaningfully shortens the return-to-completion time;
      tune the +50%/prestige multiplier if it doesn't. **Verified, no tuning needed**
      (see `tests/prestige.test.mjs`, which locks this in as a regression check):

      | Prestige | Multiplier | Full playthrough |
      |---|---|---|
      | 0 | x1.0 | 28.0 min |
      | 1 | x1.5 | 18.7 min |
      | 2 | x2.0 | 14.0 min |
      | 3 | x2.5 | 11.2 min |
      | 4 | x3.0 | 9.3 min |
      | 5 | x3.5 | 8.0 min |
      | 6 | x4.0 | 7.0 min |

      Every additional prestige is strictly faster; the first one alone cuts the
      run by a third. Returns diminish with each further prestige (as they should
      — it's `1/multiplier` scaling), but stay non-trivial even at prestige 10
      (still >3% faster than prestige 9). If deeper-late-game reward is wanted
      later, that's the "proper permanent skill tree" in Phase 3, item 13 — not a
      fix needed here.
- [x] Minimal i18n layer (ru/en at least) — the game is shared as a public link and
      may reach non-Russian players. Keep it data-driven (a strings table), not a
      rewrite. **Done**: a `STRINGS.{ru,en}` table + `t(key, vars)` helper drive every
      DOM string (HUD, buttons, toasts, hint, achievements panel); `STAGES`/`ACHIEVEMENTS`
      entries carry `nameEn`/`descEn` alongside the Russian originals. Language
      auto-detects from `navigator.language` on first visit, is togglable via a new
      🌐-style button (shows the language you'd switch *to*), and persists in
      localStorage. In-world canvas sprite labels (pad/upgrade-pad price tags)
      regenerate in place on toggle, not just static DOM text. Verified manually with
      a headless-browser pass (toggle, achievements panel, hint overlay, building a
      pad and its upgrade pad in each language, reload persistence — no errors);
      `tests/i18n.test.mjs` locks in the data integrity (matching key sets between
      languages, no empty strings, matching `{token}` placeholders, every stage/
      achievement has both languages) as an automated regression check.
- [ ] Real-device mobile control pass (or Chrome device emulation at minimum):
      one-handed play, joystick/camera-drag zones never fight each other.
- [ ] Accessibility pass: colorblind-safe pad colors (current gold vs blue may not
      read for all players), larger tap targets, a "reduced motion" toggle that
      kills camera shake/particle bursts.
- [x] Distinct building silhouettes — user feedback: "all the houses look the
      same, unclear what they're for." Replaced the single tinted-box-and-cone
      mesh with 6 archetypes keyed off a new `STAGES[i].archetype` field
      (`house`, `shop`, `warehouse`, `factory`, `office`, `tower`), each with
      real signature details: houses get a door/windows, shops a storefront
      awning + glass + an emoji sign, warehouses a garage door + roof vents,
      factories 1-2 smokestacks that actually emit drifting smoke puffs,
      offices/towers a shared canvas-generated window-grid texture, and the
      final "Империя" tower a gold crown instead of a plain spire. Verified
      visually with a headless-browser flythrough of all 10 buildings at
      once (upgrade levels included) plus the factories' smoke — no console
      errors, no test regressions (`STAGES`'s new fields don't affect the
      cost/income/name checks in `tests/`).
- [ ] **Enterable buildings + a real player animation state machine**
      (user feedback on a follow-up variant of this game: archetype models
      still read as closed boxes with a decorative flat "door," and the
      player's run cycle is a single `Math.sin` swing with no idle/interact
      state). Two related but separable pieces:
      1. Pick 2-3 archetypes as a pilot (house, shop, factory) and give their
         door a real trigger: either a lightweight "pocket" interior scene
         swapped in on approach (own floor/walls/light + a couple of
         archetype-appropriate props), or — simpler first cut — remove the
         door's collision and extend the building's footprint with an actual
         walk-in interior volume. Don't attempt all 10 archetypes in one
         session.
      2. Replace the player's one-sine-wave animation with a small named
         state machine (`idle`, `walk`/`run` — already mostly there via
         sprint, `interact`/`build` on purchase/upgrade) driven off the
         existing `legL/legR/armL/armR` limb groups — no GLTF/AnimationMixer
         needed, they're already a cheap procedural rig.
      The sawmill workers added alongside this note (Phase 2 item 2) reuse
      the same limb-group rig with a walk/chop state machine — a working
      reference for what player state-machine animation should look like.

## Phase 2 — Content depth 🔷 (multi-session)

> Note: item 2 (sawmill/planks) was pulled forward and started ahead of Phase 1
> items 4–5 (mobile pass, accessibility pass) at the user's explicit request in
> session "2026-09-19 — Sawmill". The default process (earliest incomplete
> phase, in order) resumes at Phase 1 item 4 once this item's current slice is
> done, unless the user directs otherwise again.

- [ ] Branching tycoon tree: after stage 5, offer a choice of 2–3 specializations
      (Residential / Commercial / Industrial), each with its own remaining stages
      and distinct building visuals. Design the data structure first, land it in
      one session; add the actual branch content over following sessions.
- [ ] Secondary resource: a sawmill/conveyor system producing "planks" 🪵
      (user-suggested concrete design for this item). Slices:
      - [x] **Resource generation + tracking.** A standalone generator shed +
            conveyor belt + sawmill, always present off to the side of the main
            spiral path (not gated behind any stage). A log spawns every
            `WOOD_SPAWN_INTERVAL` (4s), rides the belt for `WOOD_TRAVEL_TIME`
            (3.5s), and becomes `PLANKS_PER_LOG` (1) plank on arrival, with a
            particle burst + sound. Planks show in the HUD, persist across
            saves and prestige (the sawmill itself is untouched by a prestige
            reset), and two achievements (`first_plank`, `plank_baron`) track
            them. The sawmill and generator buildings are solid, using the same
            collision system as the spiral's buildings. Verified with a
            headless-browser pass: production timing traced precisely against
            wall-clock time (see session notes — an earlier screenshot-based
            test run appeared to produce planks "too fast," which turned out to
            be `page.screenshot()`'s slow software-rendering capture letting
            the page's own animation loop keep running in the background, not
            a game bug), and collision confirmed by spawning the player inside
            the sawmill's collider and checking it's pushed out on the very
            next frame.
      - [x] **Give planks a purpose** — first sink: hireable lumberjack workers
            (user-requested design constraint: no idle/decorative NPCs — a
            hired worker must visibly do something). Up to `WORKER_MAX` (3)
            workers, hired one at a time from a pad next to the sawmill for
            money + planks (`workerHireCost(n)`, steep per-worker growth).
            Each worker runs a real state machine (`seekTree → toTree →
            chopping → toMill → seekTree`): it claims a free source tree
            (`tree.claimedBy`, also respected by the automatic timer so the
            two producers can't double-fell the same tree), walks to it,
            chops it (feeding the *same* fall/shrink/regrow animation and
            belt pipeline the automatic timer uses), hauls to the mill, and
            repeats. With no tree free it walks back toward the shed and
            keeps animating there — never freezes in place. Two new
            achievements (`first_worker`, `full_crew`); worker count persists
            across saves (`workerCount`, free-rehydrated on load). Still open:
            a second plank sink (a build/upgrade discount) would make the
            resource matter even before/without hiring workers — left as a
            follow-up since this slice alone already gives planks a real use.
      - [x] **Make the generator feel legible** — user asked directly "where
            does the wood come from?" The grove around the shed IS the
            source now: 4 of its trees are interactive (chop → fall → shrink
            → regrow over `REGROW_TIME` 6s), and a log only spawns when a
            tree is actually felled, riding the belt from *that tree's own
            position*, not a fixed point. Production is now gently gated by
            tree availability rather than purely by the timer. Verified with
            a headless-browser pass anchored at the player's own position
            near the grove (camera-only debug overrides don't work here —
            the follow-cam resets `controls.target` to the player every
            frame, so the camera snaps back; moving the player via a save
            injection is the reliable way to screenshot a specific spot).
      - [ ] **Make the generator feel discovered**, not just legible: still
            always-on and visible from the very first second. Consider
            unlocking it at a stage milestone (e.g. after Склад/Warehouse)
            instead.
      - [ ] **Second material** (stretch): once planks have a real sink, a
            second raw resource (e.g. ore/stone) from a different generator
            elsewhere on the map, so the "which resource do I need" decision
            has more than one axis.
- [ ] Random world events: a timed "double income" pad, a short delivery-run
      mini-objective — rewards continued exploring, not just standing still.
- [ ] Cosmetic unlocks: character outfits / building color themes, purchasable
      with money or earned via achievements, persisted per save.
- [ ] Day/night cycle with lighting changes; glowing windows at night.

## Phase 3 — Systems depth

- [ ] Daily/session quest system: 3 rotating mini-goals ("run 500m," "earn 2,000,"
      "upgrade a building"), localStorage date-stamped rotation, small bonus reward.
- [ ] Exportable/importable save code (base64 JSON) so players can back up or
      compare progress without a backend. Document it in the hint/settings UI.
- [ ] Prestige currency + small permanent skill tree (run speed, stamina, cheaper
      upgrades, starting cash) — deeper than the current flat income multiplier.
- [ ] Expand achievements to 25–30 total, covering every system above, with
      bronze/silver/gold tiers for the grindier ones.
- [ ] Settings panel: shadow quality, particle density, fog/draw-distance toggle,
      for low-end devices.

## Phase 4 — Technical & production polish 🔷 (multi-session)

- [ ] Split the single HTML file into ES modules (`economy.js`, `player.js`,
      `world.js`, `ui.js`, `save.js`) served from this repo — still zero build
      step, just `<script type="module">` importing local files. Do this only
      once Phase 1–3 churn has settled, to avoid constant merge pain.
- [ ] Promote the ad hoc Playwright scripts used during development into a
      permanent `tests/` folder with a simple `npm test` runner, so every future
      session runs the same suite instead of hand-rolling scripts each time.
- [ ] Performance pass: particle object pooling, hide/LOD off-screen decorative
      meshes, instance the repeated trees/rocks instead of one draw call each.
- [ ] PWA polish: `manifest.json` + service worker for offline play and
      "Add to Home Screen."
- [ ] Social preview: proper favicon sizes + OpenGraph meta tags so shared links
      look good.

## Phase 5 — Deployment & distribution

- [ ] Enable GitHub Pages for this repo (or a dedicated branch) so the game has a
      permanent public URL, not only a private Artifact link.
- [ ] Proper `README.md`: screenshots/GIF, controls, "how to run locally."
- [ ] `CHANGELOG.md`, updated every session (create it now if it doesn't exist).
- [ ] Local, non-tracking stats screen (session length, stages reached, total
      distance run) for the player's own curiosity.

## Phase 6 — Stretch (only after 1–5 are done)

- [ ] Visit-only "friend's tycoon" via a shared save-code URL param (read-only,
      no live multiplayer, no backend).
- [ ] Seasonal/limited-time decoration or palette swap on a schedule.
- [ ] Simple JSON-exportable custom path/layout editor for community layouts.

---

## Definition of done for "the finished project"

- [ ] Phases 1–5 complete; Phase 6 explicitly deferred or descoped with a note why.
- [ ] Every mechanic has a passing test in `tests/`.
- [ ] 60fps on a mid-range phone (Chrome device emulation is an acceptable proxy).
- [ ] Zero console errors/warnings during a full playthrough.
- [ ] Save format is versioned with migrations back to v1.
- [ ] Deployed to a public URL in addition to any Artifact link.
- [ ] README complete with screenshots and controls.
- [ ] 25+ achievements, all reachable and verified reachable.

## Explicitly out of scope (don't add without the user asking)

- Real-money payments or ads.
- A live backend, accounts, or real-time multiplayer.
- Analytics/tracking of any kind beyond the player's own local stats screen.
