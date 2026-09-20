# Changelog — Tycoon 3D v19+ (tycoon-v19.html)

Separate from the root `CHANGELOG.md`, which tracks the earlier
`tycoon.html` prototype. See `TYCOON_V19_PLAN.md` for the roadmap this log
tracks progress against.

## Session log

### 2026-09-20 — Delivery-vehicle status labels now name the target building; a Bloom texture attempt hit an environment limit
- User asked for the Bloom connector to be used for the texture pass
  (spec sections 12-13). Generated 4 seamless texture candidates (brick,
  concrete, corrugated metal, asphalt) via `bloom_generate_image` against
  the account's existing "Элитруф" brand -- all 4 generations completed
  successfully. However, this sandbox's outbound network policy blocks
  `trybloom.ai` (confirmed with a direct `curl` 403 and the agent-proxy's
  own status log), and no other available tool (`Read`, `WebFetch` --
  text-only) can pull the actual image bytes in from that host. The 4
  generated images exist in the Bloom workspace but couldn't be
  downloaded, converted to JPG, or embedded into the game. This is an
  environment limitation, not a prompt problem -- noted in
  `TYCOON_V19_PLAN.md` so a future session doesn't spend credits
  re-attempting the same blocked path.
- Pivoted the rest of the session to a real, deliverable slice instead:
  **delivery-vehicle status labels now name the target building**
  (previously flagged as remaining polish on section 5). Added
  `jobTargetName(ud)` reading a new `ud.assignedEntry`, which
  `assignVehicleJob()` now sets in every branch -- both for a real
  construction/upgrade target and the delivery role's "nothing under
  construction, restock the nearest built warehouse/factory" fallback
  (previously a bare-position helper, `nearestBuiltByArchetype()`, now
  removed and inlined, with no way to name what it found). Status text
  now reads e.g. "МАТЕРИАЛЫ / → Дом" while driving and "разгрузка: Дом" /
  "работает: Дом" once arrived.
- Verified with a headless-browser pass: confirmed a real construction
  target is named correctly right after assignment; confirmed the
  delivery restock fallback also correctly names a built warehouse via
  `assignedEntry` (not just its bare position); confirmed the "nothing
  to do" idle/waiting paths are untouched and handle a null
  `assignedEntry` without crashing. Re-ran the full regression suite
  (boot, construction, contracts, road-node routing, the lift, worker
  roles, the pinch-zoom fix) with zero new failures.
- Checked off spec item 5 in `TYCOON_V19_PLAN.md`.

### 2026-09-20 — Critical fix: pinch-zoom crashed the whole game on real phones (user-reported)
- User published this file as a Claude Artifact and reported an
  immediate hard crash on their iPhone with a screenshot: `TypeError:
  undefined is not an object (evaluating 'event.touches[1].pageX')`,
  which blanks the whole screen behind the boot-error overlay (that
  overlay's global error handler treats any uncaught runtime error as
  fatal, not just boot-time ones).
- Traced it to the vendored `vendor_v19/three_r128/OrbitControls.js` (not
  the game's own code, which has no `touches[1]` reference at all):
  `handleTouchStartDolly()`/`handleTouchMoveDolly()` read
  `event.touches[0]`/`[1]` completely unguarded, unlike the sibling
  rotate/pan handlers in the same file, which already check
  `touches.length` first. The controls' touch state machine dispatches
  purely on a `state` set at `touchstart` and only cleared on `touchend`,
  so lifting the second finger mid-pinch -- routine on a real phone,
  basically unreachable from a synthetic mouse-driven test -- fires one
  more `touchmove` with 1 touch left while state is still
  `TOUCH_DOLLY_PAN`.
- Fixed with the same `if (event.touches.length < 2) return;` guard the
  file already uses elsewhere, in both dolly handlers.
- Verified with a headless-browser pass (Playwright with `hasTouch:
  true` for real `Touch`/`TouchEvent` support): confirmed the repro was
  faithful by running it against the unfixed file first (via `git
  stash`) and getting the identical error and boot-error overlay;
  restored the fix and got zero errors on the identical touch sequence;
  separately confirmed a genuine two-finger pinch (no finger lift) still
  actually zooms the camera, so the fix doesn't disable pinch-zoom, only
  the crash. Re-ran the full regression suite with zero new failures.
- Republished the Claude Artifact (same URL, `6FEiX58PSjZHSzjuyTDuoM`)
  with the patched vendor file so the user's already-shared link is
  fixed immediately, and pushed the same fix to the repo.

### 2026-09-20 — Fix an orphaned-construction-site bug in doPrestige() (autonomous loop, dedicated audit pass)
- Followed through on the previous session's own suggestion to do a
  focused "does this visibly do what it claims" audit rather than build
  something new. Read `doPrestige()` together with `purchaseCurrentPad()`
  and `upgradeBuilding()` and found a real, reachable bug:
  `stageIndex` reaches `STAGES.length` (unlocking the prestige button)
  the instant the **last** building's construction *starts*, not when it
  finishes, and any building can have an upgrade in progress at prestige
  time too. `doPrestige()` only ever cleared the `buildings` array --
  never `growingMeshes` or `constructionSites`, the separate arrays
  holding in-progress construction animation state and each site's
  crane/scaffolding/fence group. Prestiging while anything was mid-build
  left that site running in the scene forever (or until its own timer
  happened to expire) with no building behind it anymore.
- Fixed by clearing both arrays (and removing their scene objects) inside
  `doPrestige()`, plus clearing any worker's `workBuild`/`target` if it
  pointed at a now-gone site so they re-roll a sensible target instead of
  playing their hammering animation forever next to an empty foundation.
- Verified with a headless-browser pass: bought all 10 stages back-to-back
  (cheated money/planks) so all 10 were simultaneously mid-construction --
  the worst case -- then called the real `doPrestige()` (auto-accepting
  its `confirm()` dialog) and confirmed every captured site/mesh reference
  was detached from the scene afterward, both arrays were empty, and no
  worker still targeted a stale build. Also verified the ordinary path
  (let everything finish, then prestige) still resets money/stageIndex/
  buildings and increments the prestige multiplier correctly. Re-ran the
  full existing regression suite with zero new failures.
- Incidental finding, not fixed (out of scope, noted in
  `TYCOON_V19_PLAN.md` for the eventual performance pass): under the
  10-simultaneous-construction stress case, the in-game construction
  timer fell behind real wall-clock time by roughly 3x -- `animate()`'s
  dt-clamp (0.1s/frame ceiling) means the simulation itself slows down
  once real frame time exceeds that, not just dropped visual frames. Not
  reachable in normal play given the steep cost curve, so a stress-test
  data point rather than a live bug.
- Checked off nothing new in the numbered spec checklist (this was a bug
  fix, not a new feature), but the fix is folded into the existing
  section 21 (Prestige) entry.

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

### 2026-09-20 — Three direct user-reported fixes: camera follow, construction reveal, label overflow
- **Joystick camera auto-follow**: `updatePlayer()` now interpolates the
  camera's azimuth around the player toward "directly behind the player's
  facing direction" every frame while the joystick is actively pushed and
  the player is moving, instead of only translating camera position (which
  never changed the *viewing angle*, making it uncomfortable to walk and
  steer at the same time). Idle-joystick free-look (drag/OrbitControls)
  is untouched.
- **Construction reveal is no longer a slow "grow"**: the building mesh
  used to scale/fade in gradually from phase 3 onward, so the finished
  house appeared to inflate out of the ground well before its real
  textures showed up. Now the mesh stays fully hidden through phase 4
  (frame/walls/roof — the crane/scaffolding/fence visuals already carry
  the "under construction" read) and only reveals in the last 12% of
  build time (phase 5, finish) with a quick ease-out-cubic pop, so
  geometry and textures appear together in one beat.
- **Label overflow on mobile fixed**: reduced every label sprite's
  `.scale.set()` by ~0.68x across all ~9 call sites (sawmill dropoff,
  field-upgrade pads, construction-site phase label, building upgrade
  pad, lift/delivery vehicle status labels, `makeLabelSprite`'s internal
  default, the main gold build-pad label), preserving aspect ratio, and
  fixed a stale hardcoded `regenerateSprite(..., 1.15)` override in
  `applyLanguage()` that had drifted from the creation-time value. Root
  cause (found in a prior session) was sprite *world-space* scale being
  too large relative to the visible viewport at close camera distances on
  narrow portrait screens, not the font-fitting logic.
- Verified with a headless-browser pass: 90 simulated frames of held-
  joystick turning show the camera azimuth converging from a 2.7 rad
  offset down to 0.005 rad behind the player; sampled construction-mesh
  visibility/scale across the full build timeline confirms it stays
  hidden through phase 4 and only pops in during phase 5; a close-up
  screenshot of a field-upgrade label at the same tight camera distance
  that previously clipped now fits cleanly. Re-ran the pinch-zoom and
  boot regression tests with zero new console errors.
- Updated `TYCOON_V19_PLAN.md`: added a "What recent sessions added"
  entry, upgraded item 23 (label auto-fit) to `[x]` with the corrected
  root-cause note, and item 24 (camera tuning) to `[~]`.

### 2026-09-20 — Progression-stage milestone banner
- Added `MILESTONE_ERAS`, grouping the 10-stage `STAGES` array into 5
  named eras two buildings at a time (Residential Quarter → Commercial
  District → Industrial Zone → Corporate District → Metropolis), each
  with an emoji/title/subtitle in both languages, addressing spec
  section 18's "the player should always know the next big milestone"
  which the plain `🏗️ N/10` HUD counter only covered loosely.
- `eraIndexForCount(n)` is a pure function of `stageIndex`, so no
  separate "already announced" flag is needed — prestige resetting
  `stageIndex` to 0 naturally re-announces the same eras on the way back
  up instead of requiring extra state to track.
- `purchaseCurrentPad()` now compares the era before/after each purchase
  and shows a centered, auto-dismissing banner (`#milestoneBanner`) only
  on an actual era transition (5 of the 10 purchases) — kept as a
  separate element from the existing toast system so it doesn't collide
  with the "Construction started" toast firing in the same call.
- Verified with a headless-browser pass: `eraIndexForCount()`'s output
  checked for every count 0-10; bought all 10 buildings in sequence and
  confirmed the banner's text only changes at the 5 correct transition
  points; screenshotted the banner on a 390px mobile viewport and
  confirmed it renders fully on-screen, legible, and non-overlapping
  with the HUD. Re-ran the boot, pinch-zoom, and prior-session regression
  tests with zero new failures.
- Updated `TYCOON_V19_PLAN.md`: checked off item 18, removed it from the
  "suggested next slice" list, updated the v22 release-line note.

### 2026-09-20 — Economy pacing audit; slowed the passive sawmill rate
- Built a pure-numeric idle-progression simulator (drives the game's own
  real formula functions via `page.evaluate()`, no scene/rendering
  involved) to compare idle play, light manual tree-chopping (3 logs/
  min), and active chopping (8 logs/min) across a full 10-building +
  all-upgrades run.
- Finding: with the original `BASE_SAWMILL_AUTO_INTERVAL = 10`, all
  three profiles finished within a few percent of each other — manual
  chopping, the interactive mechanic the hint overlay specifically
  teaches, had almost no effect on progression speed, because plank
  costs on the main build path are trivially small next to money costs.
- Fix: `BASE_SAWMILL_AUTO_INTERVAL: 10 → 16` (passive rate 6 → 3.75
  planks/min). Re-ran the simulation: the early build race is still
  correctly money-dominated, but the midgame/endgame upgrade grind now
  separates idle (~10505s to fully finish) from active play (~3361s,
  ~3.1x apart, up from ~2.3x) — active chopping now visibly matters.
- Verified: before/after simulation comparison; re-ran the full existing
  regression suite (boot, pinch-zoom, the three user-reported fixes,
  milestone banner) with zero new failures, since this was a single
  constant change with no logic touched.
- Updated `TYCOON_V19_PLAN.md`: checked off item 20, added the audit
  writeup, refreshed the "suggested next slice" list.

### 2026-09-20 — Curbs, sidewalks, and fire hydrants along the road network
- Added curb + sidewalk strips flanking both sides of every road segment
  (reuses the existing road-building loop's direction/length math, no
  separate pass needed) and scattered fire hydrants along the sidewalk
  every third segment (spec sections 14-15).
- Verified: no console errors on boot; screenshots confirm curbs/
  sidewalks/hydrants are grounded correctly, not floating or clipping.
- Updated `TYCOON_V19_PLAN.md`: item 14-15 upgraded to `[~]` (crosswalks/
  parking/cones still remain).

### 2026-09-20 — Icon clipping, camera glitch, and construction-site scaling fixes
- **Icon sprites** (gear/up-arrow on upgrade pads): were genuinely
  clipped at the canvas edges. `makeIconSprite()` now uses a 128x128
  canvas at 64px font instead of 96x96 at 76px, for real margin.
- **Camera glitch on a slight joystick nudge**: root cause was a hard
  `joyMag > 0.08` on/off switch between two different position formulas.
  Replaced with one continuous formula (`followWeight` ramps over
  `joyMag ∈ [0.04, 0.18]`) that's provably identical to the old
  plain-translate behavior at weight 0. Max per-frame camera jump under
  a threshold-jitter simulation dropped from 0.78 to 0.34 units.
- **Construction sites all looked identical**: added `envW`/`envH` scale
  factors (from the real `stage.baseSize`/`height`) to
  `spawnConstructionSite()`'s building envelope + crane rig, with
  equipment repositioned outward proportionally. Total rig height now
  ranges 5.5 (House) to 14.3 (Empire) instead of one fixed size for
  every building.
- Verified: raw-canvas dumps confirm icons no longer clip; a jitter
  simulation (before/after via `git stash`) confirms the camera
  smoothness improvement; `THREE.Box3` measurements confirm construction
  sites now scale with the building; a full purchase→complete lifecycle
  test confirms buildings still finish correctly. Zero new console
  errors across the full existing regression suite.
- Still open from this round of feedback (not addressed yet): reported
  material/texture overlap on some buildings, and a general push for
  more detailed/realistic buildings and construction sites.

### 2026-09-20 — Fixed benches/signposts/lamps sitting on the road
- Root cause: road-side decor was anchored to a spiral corner point
  using the radial direction from the map's origin as its offset basis,
  instead of the actual road segment's own direction -- diverging
  sharply at some corners (one bench measured only 0.08 units from the
  next road segment, effectively on the road).
- Fixed by anchoring to each road segment's own midpoint + direction
  (matching how curbs/sidewalks are already placed), which has no
  neighboring-segment problem since the nearest other segment is always
  at least half a segment away.
- Verified with a segment-distance diagnostic checking every bench
  against every road segment in the network: all now consistently 2.95
  units clear, versus a 0.08 worst case before. Zero new console errors.

### 2026-09-20 — Construction sites now differ by archetype, not just size
- Follow-up to the size-only scaling fix, which "didn't look very
  different" per direct feedback -- early buildings are close enough in
  size that a pure scale difference wasn't very visible.
- `spawnConstructionSite()` now picks one of 4 archetype groups (house /
  shop / industrial / vertical) and gives each a genuinely different
  wall shape+material and roof shape+material: industrial (warehouse,
  factory) gets a wider corrugated-metal shell; vertical (office, tower)
  gets a narrower shell in the same emissive glass curtain-wall material
  the finished buildings use; house keeps its gable roof.
- Verified programmatically (material/geometry properties compared
  across all 4 groups) rather than via screenshots, since the game's own
  `animate()` loop continuously re-derives camera position from
  OrbitControls' damped state, fighting a one-off camera move meant only
  for a screenshot. Re-ran the full regression suite with zero failures.

### 2026-09-20 — Fixed the warehouse's office annex being swallowed inside the main body
- Root cause: `buildWarehouse()`'s "office" annex (siding walls, gable
  roof, window, door) was positioned at `x = -w*0.38`, but its own
  half-width (`w*0.12`) meant its entire footprint sat inside the main
  body's range (which extends to `-w*0.5`) -- the whole wing was fully
  swallowed inside the opaque main box, invisible instead of reading as
  a distinct attached structure.
- Found via a `THREE.Box3` overlap scanner across all 10 building
  archetypes (screenshots weren't reliable for this hunt, since the
  game's own camera-follow loop kept re-centering on the player every
  frame regardless of manual camera moves).
- Fixed by moving the annex to `-w*0.55` (now pokes out ~29% of its own
  width). Verified with the same scanner (no longer flagged) and an
  isolated screenshot showing the annex clearly visible on the
  warehouse's side.
- The scanner's other flagged pairs (wood trim bands on houses, a "sky
  lobby" band on office/tower) are intentional layered trim, matching
  the same pattern used throughout the file -- not bugs.

### 2026-09-20 — Fixed flickering outer-ring road marking; added camera-obstruction avoidance
- **Road marking flicker**: `outerRingMark` sat only 0.007 units above
  `outerRingRoad` while fully overlapping its radius band -- classic
  z-fighting, made worse by that ring's distance from the camera (near
  the map edge). Bumped the gap to 0.045, matching the inner roads'
  already-working lane-marking separation.
- **Camera clipping through buildings**: added a raycast obstruction
  check to the camera-follow code in `updatePlayer()`. Each frame, after
  computing the desired camera position, a reused `THREE.Raycaster`
  checks the line from the player's eye to that position against all
  completed building meshes and pulls the camera in front of the
  nearest hit if one exists.
- Verified: a real building placed between the player and a
  deliberately-far camera position pulled the camera in from ~12 units
  to ~4.4 (in front of the wall); a separate open-grass case confirmed
  zero effect when nothing's in the way; confirmed the pulled-in
  position survives several real animation frames (OrbitControls'
  damping doesn't stomp it back). Zero new failures across the full
  regression suite.

### 2026-09-20 — Added crosswalks and construction-site cones
- `addCrosswalk()`: 5-stripe zebra crossing, oriented via the same
  rotation convention the road/lane meshes already use. Added at 3 of
  the road-segment stops the benches/signs iterate over.
- `makeTrafficCone()`: 3 cones scattered around every construction
  site's yard.
- Verified numerically (scene traverse counted 15 stripe meshes = 3
  crosswalks x 5, and 3 cone meshes per construction site, all at
  expected positions) since screenshots keep fighting the follow-camera.
  Zero new failures across the regression suite.

### 2026-09-20 — Fixed scattered decor (trees/rocks/bushes) spawning on the road
- Root cause: `scatterScenery()` only checked clearance against the 10
  stage node positions, never against the road segments connecting
  them, so a piece could land in the middle of a long segment with no
  check at all. Confirmed via a live-scene scan: ~2% of scattered decor
  landed within the road's footprint, one as close as 1.24 units from
  its centerline.
- Fixed with `distToNearestRoadSegment()` (perpendicular point-to-
  segment distance against every road segment) and a `ROAD_CLEAR = 2.6`
  rejection in the scatter loop.
- Verified across 5 fresh random-seeded page loads post-fix: zero decor
  pieces landed on/near a road in any of them, with placement counts
  staying similar to before. Zero new failures across the regression
  suite.

### 2026-09-20 — Fixed two field-upgrade pads sitting directly on the road
- The road segment connecting stage 3 to stage 4 runs almost due south
  right past x=-20, cutting through a corner of the sawmill camp. The
  'sawmill' and 'yield' field-upgrade pads' original positions put them
  only 0.69 and 0.94 units from that segment's centerline -- sitting on
  the paved road (half-width 1.15), not just near it. Permanent,
  deterministic map geometry, so it affected every playthrough.
- Pushed both pads' X offset out further so they clear the road +
  sidewalk (now 2.89 and 2.86 units away).
- Verified with the `distToNearestRoadSegment()` helper against every
  hand-placed sawmill-area position; both pads now clear, still close
  enough to read as near the mill, and comfortably apart from each
  other. Zero new failures across the regression suite.

---

## Format for new entries

```
### YYYY-MM-DD — Short summary
- What changed and why, one bullet per notable change.
- Note any TYCOON_V19_PLAN.md checklist items completed.
```
