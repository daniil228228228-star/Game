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

- [ ] Balance pass: log/estimate real playtime per stage across all 10 buildings x
      3 upgrade levels; tune costs/income so early game is ~2–5 min per building
      and late game ~15–30 min. Write the target curve down once decided.
- [ ] Verify each prestige tier meaningfully shortens the return-to-completion time;
      tune the +50%/prestige multiplier if it doesn't.
- [ ] Minimal i18n layer (ru/en at least) — the game is shared as a public link and
      may reach non-Russian players. Keep it data-driven (a strings table), not a
      rewrite.
- [ ] Real-device mobile control pass (or Chrome device emulation at minimum):
      one-handed play, joystick/camera-drag zones never fight each other.
- [ ] Accessibility pass: colorblind-safe pad colors (current gold vs blue may not
      read for all players), larger tap targets, a "reduced motion" toggle that
      kills camera shake/particle bursts.

## Phase 2 — Content depth 🔷 (multi-session)

- [ ] Branching tycoon tree: after stage 5, offer a choice of 2–3 specializations
      (Residential / Commercial / Industrial), each with its own remaining stages
      and distinct building visuals. Design the data structure first, land it in
      one session; add the actual branch content over following sessions.
- [ ] Secondary resource ("materials") collected by proximity to specific
      buildings, gating a subset of upgrades — adds resource management beyond
      pure money.
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
