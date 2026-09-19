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

---

## Format for new entries

```
### YYYY-MM-DD — Short summary
- What changed and why, one bullet per notable change.
- Note any VISION.md items checked off.
```
