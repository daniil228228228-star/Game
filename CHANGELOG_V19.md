# Changelog — Tycoon 3D v19+ (tycoon-v19.html)

Separate from the root `CHANGELOG.md`, which tracks the earlier
`tycoon.html` prototype. See `TYCOON_V19_PLAN.md` for the roadmap this log
tracks progress against.

## Session log

### 2026-09-20 — NPC worker roles + stay-near-base idle behavior (autonomous loop)
- Audited `createWorkerNPC()`/`spawnAmbientLife()`/`chooseWorkerTarget()`
  against spec section 17 and found two real gaps: all 7 ambient workers
  were the identical model with only a random shirt color (no role
  distinction at all), and when idle they'd wander toward a random point
  among *every* building position on the entire map
  (`ambientTargetPoints()`), not just near wherever they'd actually
  started.
- Added a `WORKER_ROLES` table (builder/rigger/foreman/loader) with a
  distinct helmet+brim color per role plus a role-appropriate hand tool
  (brick/wrench/clipboard/crate, via a new `addWorkerTool()` helper)
  parented directly onto the existing `armR` limb so it automatically
  follows the worker's existing arm-swing animation. `createWorkerNPC()`
  now takes a role key (old bare-color calls still work via a back-compat
  branch). Each of the 7 spawned workers now stores its spawn point as
  `worker.homeBase`, and `chooseWorkerTarget()`'s idle branch picks a
  point near that instead of anywhere on the map -- deleted
  `ambientTargetPoints()` as dead code once nothing called it anymore.
- Verified with a headless-browser pass: confirmed the expected role
  distribution and stored home bases on spawn; sampled distance-from-home
  every 1.5s over 12s with no active construction and confirmed every
  worker stayed within ~1.9 units (previously unbounded); confirmed the
  "help an active build" behavior is unchanged (6/7 workers picked up a
  fresh house's construction within 6s); confirmed each role's helmet
  color programmatically (screenshots of this scene's bright tone-mapping
  can wash out subtle color differences, so didn't rely on that alone);
  confirmed every tool prop is a direct child of the arm at the hand
  position and its world position genuinely moves when the arm rotates
  (not a disconnected floating prop -- the same bug class fixed on the
  lift last session). Re-ran the full regression suite with zero new
  failures.
- Checked off spec item 17 in `TYCOON_V19_PLAN.md`.

### 2026-09-20 — Fix the lift's disconnected platform, give it real deploy/retract behavior (autonomous loop)
- Audited `createWorkLift()` (the "подъёмник" telehandler/scissor lift)
  against spec section 6's checklist (base, wheels, outriggers,
  telescoping arm, basket, worker inside) and found a real bug: the
  platform -- the basket the whole vehicle exists to raise -- was a
  separate mesh sitting at a fixed absolute height, not a child of the
  scissor-arm pivot the animation actually moves. The lift never visibly
  lifted its own basket; confirmed structurally
  (`platformIsChildOfArms: false`) before touching any code.
- Fixed by reparenting the platform (+ rail/posts) onto the arm pivot so
  it now genuinely rides the mechanism, and widened the raise/lower range
  `moveWorkVehicle()` drives it across (0.34 retracted → 1.35, or 1.95
  during the finishing phase) so the raise is actually visible instead of
  a few-centimeter token shift. Added 8 outrigger leg/pad meshes and a
  small rider (reusing `createWorkerNPC()` as-is), both hidden while
  driving/idle and shown only while the lift is in its `'working'` state
  -- via a new block at the top of `moveWorkVehicle()` that retracts and
  hides everything whenever the vehicle isn't actively working, so
  idle/outbound/returning all correctly fold the lift away.
- Verified with a headless-browser pass: confirmed the platform is now a
  real child of the arm pivot; forced the lift into a genuine `'working'`
  state next to an active site and sampled arm height/rider/outrigger
  visibility every 0.5s -- height climbed steadily toward its target with
  rider and outriggers visible throughout; ended the work cycle and
  confirmed the arms were already retracting and the rider hidden again
  within 3.5s. Screenshot shows the scissor arms genuinely raised with
  platform, rail, and rider sitting correctly on top. Re-ran the full
  regression suite (boot, construction, contracts, road-node routing, a
  25s multi-vehicle soak) with zero new failures.
- Checked off spec item 6 in `TYCOON_V19_PLAN.md` (previously `[~]`).

### 2026-09-20 — Fix a duplicate-sawmill bug, add tree species variety (autonomous loop)
- **Found and fixed a real bug**: `buildSawmillScenery()` was called twice
  at init with no guard, silently doubling the entire sawmill complex on
  top of itself (2 identical sheds z-fighting, 12 grove trees instead of
  6, a duplicated-but-frozen saw blade, doubled conveyor slats). Found by
  reading the sawmill code while planning the tree-variety work below, not
  by looking for it specifically — a reminder that this file likely has
  more init-time duplicates worth a dedicated grep pass (see
  `TYCOON_V19_PLAN.md`'s suggested-next-slice list; a scan for other
  top-level duplicate calls turned up none this time, but wasn't
  exhaustive). One-line fix (removed the duplicate call); verified via
  scene traversal counts before/after (2→1 shed meshes, 12→6 grove trees)
  and a screenshot showing a single, correct sawmill camp.
- **Added tree species variety** (spec section 7). `makeTree()` used to
  always build the same stacked-cone shape. Added a genuinely different
  second silhouette (`makeDeciduousTree`: short trunk, forked limbs, round
  leafy canopy from overlapping spheres) alongside the original
  (`makeConiferTree`), plus a `TREE_SIZES` young/normal/large tier that
  scales trunk and canopy independently instead of uniformly, so a young
  tree reads as spindly rather than just smaller. `makeTree()` now rolls
  species (~62/38 conifer/deciduous) and size randomly; both still return
  a plain group with `userData.harvestableTree = true`, so the existing
  chop/carry/regrow system needed no changes.
- Verified with a headless-browser pass: species/grounding counted across
  the whole scene (61 trees, ~2:1 ratio, 100% at group-Y 0); screenshots
  confirm visually distinct silhouettes side by side; ran the actual chop
  → shrink → regrow cycle on a real grove tree via the genuine
  `tryHarvestTree()` function (not a faked state change) and traced
  state/scale/Y across all phases — smooth, grounded throughout. Re-ran
  the full existing regression suite (boot, construction, contracts,
  road-node routing) with zero new failures.
- Checked off spec item 7 in `TYCOON_V19_PLAN.md`.

### 2026-09-20 — Road-node vehicle navigation (autonomous loop)
- Re-checked the previous session's two "known mobile HUD bugs" before
  spending a slice fixing them — closer inspection (actual DOM bounding
  boxes + 390px screenshots) showed neither was really broken: the 5-chip
  HUD stat row's 2-line wrap reads cleanly, and the field-upgrade label
  near the screen edge is just a world-space 3D sprite near the current
  camera framing's edge (expected, not a CSS bug). Downgraded both in
  `TYCOON_V19_PLAN.md` instead of "fixing" non-issues.
- **Implemented road-node vehicle navigation** (spec section 16, confirmed
  open gap). Service vehicles previously routed as a straight 3-point path
  through the literal map center regardless of where the actual road ran.
  The visible road is already one simple chain (plaza center → each of the
  10 stage positions in order), so added `ROAD_NODES` (that chain),
  `nearestRoadNodeIndex()`, and `buildRoadRoute(from, to)` — finds the
  nearest road node to each end and walks the chain between them — and
  swapped it in at all 3 call sites that used to build `makeVehiclePath()`
  (now removed). No changes needed to the per-frame movement/rotation
  logic, which already walked an arbitrary-length path array.
- Verified with a headless-browser pass: `ROAD_NODES` has the expected 11
  entries at the right world positions; a force-assigned delivery job
  produced a real multi-waypoint route along the spiral (6 points) instead
  of the old fixed 3; watched the truck drive with per-frame position/
  rotation telemetry (`y` stayed exactly 0 — grounded, no floating) plus
  screenshots; ran a 25s soak with both the delivery truck and the lift
  vehicle actively cycling outbound/working/returning/idle with zero
  console errors, both still valid and grounded at the end; re-ran the
  full existing regression pass (boot, construction, contracts) with no
  new failures.
- Checked off spec items 16 and 22 in `TYCOON_V19_PLAN.md`.

### 2026-09-20 — Adopt v19, add contracts, fix a mobile HUD collision
- Imported the user-provided `tycoon_v19_construction_system.html` (28.5MB,
  base64-embedded textures) into this repo as `tycoon-v19.html`, using the
  same extraction technique as earlier sessions: 10 images pulled out to
  `assets_v19/*.jpg|png` (~213KB source left), and Three.js r128 + classic
  `OrbitControls` vendored locally under `vendor_v19/three_r128/` instead
  of the original CDN `<script>` tags (matches this repo's no-CDN policy;
  this sandbox blocks `cdnjs.cloudflare.com`/`cdn.jsdelivr.net` for local
  testing). Verified booting cleanly, zero console errors, real textures
  visible.
- Audited the existing construction system against the user's detailed
  spec via headless-browser playtesting (not just reading code): the
  6-phase construction pipeline, tower crane / cement mixer / excavator
  models and their phase-gated animation, and delivery-vehicle
  construction-time-acceleration all already work correctly and are
  visually grounded (no floating parts). Wrote up the full audit in
  `TYCOON_V19_PLAN.md` so future sessions don't re-build working systems.
- **Added a contracts system** (spec item 19, previously entirely absent).
  Up to 2 simultaneous short objectives drawn from 4 templates (build N
  buildings / produce N planks / chop N logs / earn N money), cash reward
  scaled to the amount, tracked via new `stats.buildingsCompleted` and
  `stats.logsChopped` counters (delta from a per-contract `startValue`
  snapshot) alongside the existing `stats.planksEarned`/`totalEarned`.
  Piggybacks on the existing 1s tick (`checkContracts()` alongside
  `checkAchievements()`); a completed contract pays out, toasts, and is
  replaced next tick. Persisted in `save()`/`load()` so a reload doesn't
  reset progress. Compact card UI (`#contractsCard`, top-right under the
  icon buttons), bilingual via the same inline `lang === 'ru' ? ... : ...`
  pattern the rest of the file already uses for dynamic strings.
- Verified with a headless-browser pass: contracts generate on first load;
  forced a contract to completion via the real `earn()` path (not by
  faking state) and confirmed payout + toast + replacement; confirmed
  contract IDs survive a reload; confirmed text re-renders in both
  languages after a language toggle.
- **Found and fixed a real mobile-layout bug** while testing at 390px
  width: `#topRightBtns` (5 icon buttons) wraps to two rows at that width
  (pre-existing behavior, not introduced this session), and the new
  contracts card's initial top offset only cleared one row, so it visually
  collided with the wrapped `RU`/`Reset` buttons. Fixed by pushing the
  card down far enough to clear both wrapped rows at both mobile
  breakpoints (`max-width: 680px` and `max-width: 390px`).
- Also found, but did **not** fix this session (documented in
  `TYCOON_V19_PLAN.md` as a follow-up instead, to keep this session's
  slice focused): the 5-chip top-left HUD stats row itself overflows and
  wraps badly at 390px width, and the field-upgrade world-space label
  ("Build Speed 1/3") can render partially off the left edge of the
  viewport. Both predate this session.

---

## Format for new entries

```
### YYYY-MM-DD — Short summary
- What changed and why, one bullet per notable change.
- Note any TYCOON_V19_PLAN.md checklist items completed.
```
