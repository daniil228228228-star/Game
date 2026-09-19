# Changelog

All notable changes to Tycoon 3D. Each session appends an entry here — see
`VISION.md` for the roadmap this log tracks progress against.

## Session log

### 2026-09-19 — Foundation
- Initial 3D grid-builder MVP (Three.js, free camera, click-to-place buildings,
  sell mode, save/load).
- Added building upgrades (grid version), roads, achievements, sound, mute,
  camera reset, onboarding hint.
- Vendored Three.js + OrbitControls locally instead of a CDN — no external
  runtime dependency.

### 2026-09-19 — Reworked into a run-around tycoon
- Replaced the free-grid builder with a walkable third-person tycoon: a
  controllable character (WASD/joystick), a single pad per stage that
  auto-builds on proximity, 10 stages laid out along an outward spiral.
- Fixed a camera bug where naively re-teleporting `controls.target` to a moving
  player each frame made OrbitControls' internal offset balloon to
  `maxDistance`, stranding the camera; fixed by translating the camera by the
  same per-frame delta as the player before calling `controls.update()`.

### 2026-09-19 — Scenery, juice, sprint, compass, prestige
- Gradient sky dome + drifting clouds, scattered trees/rocks.
- Particle burst + camera shake + animated money counter on purchase.
- Compass arrow for the off-screen next pad.
- Sprint (Shift / joystick-edge) gated by a stamina bar; footstep sound.
- Prestige system: reset for a permanent +50%-per-prestige income multiplier.
- Large-number formatting (12.4K / 1.04M).

### 2026-09-19 — Collision, offset construction, real per-building upgrades
- Added building collision (player previously walked straight through them).
- Buildings now construct a bit further out from their pad instead of exactly
  on top of it, so the finished building never overlaps the player standing
  on the pad that triggered it (this also would have trapped the player once
  collision was added).
- Real upgrade system: each built building gets its own upgrade pad (up to
  level 3), separate from progressing to the next stage; income is now
  computed per-building-per-level.

### 2026-09-19 — Vision & roadmap
- Added `VISION.md` (standing brief + phased roadmap) and this changelog so
  future sessions (autonomous loop or human-directed) have a shared target
  and a legible history instead of ad hoc improvements.

### 2026-09-19 — Balance pass (VISION.md Phase 1, item 1)
- Simulated the base (level-1, no-upgrade) time-to-build curve from the live
  `STAGES` data: first two buildings are instantly affordable with starting
  cash (intentional fast hook), then a smooth ~1.7 → ~6.8 min/stage ramp,
  ~28 minutes for a full no-upgrade playthrough — already inside the
  15–30 min late-game target, so no cost/income numbers needed changing.
- Added `tests/balance.test.mjs` (Node's built-in `node:test`, run via
  `node --test`) that re-derives this curve from `tycoon.html` and asserts
  it stays within the decided bounds, so a future balance change can't
  silently break pacing.
- This is also the first file under `tests/` — a first step toward the
  Phase 4 "promote ad hoc scripts into a permanent tests/ folder" item,
  though that item itself is still open (this only adds one test, not the
  full harness/runner).

### 2026-09-19 — Prestige pacing verification (VISION.md Phase 1, item 2)
- Extended the balance simulation to model the prestige income multiplier
  (`1 + prestige * 0.5`) and verified every additional prestige strictly
  shortens a full playthrough: x1.5 (prestige 1) already cuts the run from
  28.0 to 18.7 minutes (-33%), and returns stay non-trivial even at
  prestige 10 (still >3% faster than prestige 9) rather than flattening to
  zero. No tuning needed — see the table in `VISION.md`.
- Refactored the STAGES-extraction + curve simulation out of
  `tests/balance.test.mjs` into `tests/lib/stages.mjs` so this test and the
  new `tests/prestige.test.mjs` share one model instead of duplicating it.

### 2026-09-19 — Minimal ru/en i18n layer (VISION.md Phase 1, item 3)
- Added a data-driven `STRINGS.{ru,en}` table + `t(key, vars)` helper and
  wired it through every DOM string: HUD, buttons, toasts, the onboarding
  hint, and the achievements panel. `STAGES` and `ACHIEVEMENTS` entries
  now carry `nameEn`/`descEn` alongside the originals.
- Language auto-detects from `navigator.language` on first visit, is
  togglable via a new button in the top-right cluster (shows the language
  you'd switch *to*, e.g. shows "EN" while in Russian), and persists in
  localStorage.
- In-world canvas sprite labels (the price-tag sprites on pads and
  upgrade pads) now regenerate in place when the language changes, not
  just the static DOM text — the previous approach would have left
  already-built pads showing stale-language labels.
- Verified manually with a headless-browser pass: toggling language
  updates the hint overlay, achievements panel, HUD, and a freshly-built
  pad + its upgrade pad, in both directions, with the choice surviving a
  reload — no console errors.
- Added `tests/i18n.test.mjs`: matching key sets between `STRINGS.ru`/`en`,
  no empty strings, matching `{token}` placeholders per key, and every
  `STAGES`/`ACHIEVEMENTS` entry carrying both languages — a future session
  adding a string in only one language now fails the suite instead of
  shipping silently broken.

### 2026-09-19 — Sawmill: a conveyor-belt secondary resource (VISION.md Phase 2, item 2, slice 1)
- User-directed session, pulled forward ahead of the default Phase 1 order
  at explicit request (see the note added atop Phase 2 in `VISION.md`).
- Added a standalone sawmill complex (generator shed + conveyor belt +
  mill, with a spinning saw blade for flavor) placed off to the side of
  the main spiral path, verified programmatically to sit >9 units clear
  of every stage at any prestige. A log spawns every 4s, rides the belt
  for 3.5s, and becomes 1 plank on arrival — with its own particle burst
  and sound, a new HUD counter, and two achievements (`first_plank`,
  `plank_baron`). Planks persist across saves and survive a prestige
  reset (the sawmill itself isn't part of the resettable spiral).
- Extended the existing player-building collision system to also treat
  the generator and mill as solid, matching every other building.
- Verified with a headless-browser pass: a precise wall-clock trace
  confirmed the production timing is exactly on schedule (an earlier,
  screenshot-heavy test run had appeared to produce planks much faster
  than expected — turned out to be `page.screenshot()`'s slow
  software-rendering capture letting the page's animation loop keep
  running in the background for many extra seconds, not a game bug);
  collision was confirmed by spawning the player inside the mill's
  collider and checking it's pushed out on the very next frame.
- This is the first of several planned slices (see `VISION.md`) — planks
  don't have a spend yet, and the sawmill is always-on rather than
  unlocked at a milestone. Both are noted as explicit follow-ups.

### 2026-09-19 — Distinct buildings, choppable trees, smoke (user feedback)
- User feedback: buildings all looked like the same tinted box, it wasn't
  clear where the sawmill's wood actually came from, and asked for both
  fixed and general graphics improved.
- **Buildings**: replaced the one-size-fits-all box+cone mesh with 6
  archetypes (`house`, `shop`, `warehouse`, `factory`, `office`, `tower`)
  selected per stage via a new `STAGES[i].archetype` field. Houses get a
  door and windows; shops a storefront awning, glass, and an emoji sign
  sprite; warehouses a garage door and roof vents; factories 1-2
  smokestacks; offices/towers a shared canvas-generated window-grid
  texture; the final tower ("Империя") a gold crown instead of a plain
  spire. `createBuildingMesh()` now dispatches to a `BUILDERS` table
  instead of one function, keeping the per-level pip indicator and
  height scaling shared across all archetypes.
- **Smoke**: factory buildings register their smokestack top position(s)
  (in world space, converted from the mesh's local `userData.stackTops`)
  and periodically emit a soft, fading, upward-drifting sprite puff —
  reusing a canvas-generated radial-gradient texture so it doesn't render
  as a flat square.
- **Where the wood comes from**: 4 of the trees in the grove around the
  sawmill's generator shed are now interactive source trees instead of
  decoration. Producing a log actually fells one (rotates over, shrinks
  away) and starts it regrowing (scales back up over 6s); the log now
  rides the belt from *that tree's own position* rather than a fixed
  point, and production is gently gated by having an actually-grown tree
  available rather than the timer alone.
- **Collision**: unaffected — `BUILDING_RADIUS` stays a flat constant, so
  the new archetypes' varying footprints (the warehouse in particular is
  noticeably wider) aren't pixel-perfect against their collider, but the
  mismatch is minor and not visually jarring.
- Verified with a headless-browser pass: a flythrough of all 10 stage
  buildings (mixed upgrade levels) with no console errors; confirmed via
  the HUD's planks counter and the "First Planks" achievement firing on
  schedule that a tree is visibly shorter (mid-regrow) with a log freshly
  on the ground beside it after the first production cycle. Note for
  future sessions: a camera-only debug override doesn't work for this
  kind of shot — the follow-cam resets `controls.target` to the player
  every frame, snapping the camera back — so anchor the *player's saved
  position* to the spot you want to screenshot instead.

---

## Format for new entries

```
### YYYY-MM-DD — Short summary
- What changed and why, one bullet per notable change.
- Note any VISION.md items checked off.
```
