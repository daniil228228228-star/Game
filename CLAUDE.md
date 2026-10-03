# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-first 3D tycoon / city-builder game (Three.js r128). **The user develops the game themselves and periodically uploads a newer single-file "standalone" build; the latest upload is the base to work on** (currently `v161`, imported 2026-10-03). In this repo it lives in a dev layout: `tycoon-v161.html` (~39k lines, game code inline) plus `assets/` (textures with height/roughness maps, and the user's later layers as `assets/*.js|css`, loaded via `<script src>`/`<link>`) and `vendor/three_r128/` (Three.js + OrbitControls). No CDN dependencies — keep it that way. Serve the repo root with any static server to play.

`tools/standalone.mjs` converts between that layout and the user's single-file builds (inlines vendor JS, textures as base64, bundled assets). It is lossless: `unbundle` of an upload followed by `build` reproduces the upload byte for byte (checked by `tests/bundle.test.mjs`). To import a new upload: `node tools/standalone.mjs unbundle <upload.html> tycoon-vNNN.html`, then update `ENTRY` in `tests/lib/harness.mjs`.

`archive/` holds everything that is not the live game: abandoned prototypes, the v19→v63 lineage, and the whole **v116 snapshot** (`archive/tycoon-v116/`: game file, its docs `CHANGELOG_V116.md`/`ROADS_V116_NOTES.md`, and its 11-file test suite). The v116 docs record many hard-won root causes (road network, construction timing, traffic yielding, staged unlocks) in Russian with file:line evidence; v161 descends from the same lineage, so check there before re-debugging similar problems, but verify against v161 — it has since diverged. `VISION.md` is the design brief written against v116 and still describes the intended direction; reconcile it with v161 when working on features.

## Commands

```bash
npm install                 # only needed for tests (playwright); node_modules/ is gitignored
npm test                    # runs every tests/*.test.mjs sequentially via tests/run-all.mjs
node tests/boot.test.mjs    # run a single test file (standalone script; exit 0 = pass)
python3 -m http.server 8000 # manual play: http://localhost:8000/tycoon-v161.html
node tools/standalone.mjs build tycoon-v161.html dist/tycoon-v161-standalone.html   # single-file build to hand to the user
```

Tests are Playwright + Chromium (expected at `/opt/pw-browsers/chromium`) with iPhone 13 emulation and software WebGL (`--use-gl=swiftshader`, only a few fps — wait on state, not wall-clock timers, and never run two browsers at once). There is no linter. The suite is currently minimal (boot + bundle round-trip); the v116 tests in `archive/tycoon-v116/tests/` target v116 internals and need porting before reuse.

## Architecture: a stack of patch layers (inherited from v116, re-verify for v161)

The file is 63 inline `<script>` blocks, many named `<script id="vNN-...">`, where later layers re-assign functions/variables defined by earlier ones. Rules that every change must respect:

- **Only the last assignment, in execution order, is live.** Grep *all* definitions of a name before editing; edit the one that actually wins. Layers from v56 onward are IIFEs, so their functions are invisible to other layers unless exported on `window`.
- **Execution order is not source order.** Deferred code (`DOMContentLoaded`, `setTimeout(...,80)`, `setInterval`) runs after every synchronous block and can clobber a wrapper installed synchronously by a later-in-file layer (this hid the `constructionDuration` lengthening until commit `978bde8`; the early boot timers calling `refreshTransportAccessRoads` raced the same way). When a "fixed" value doesn't stick, check what runs later.
- **Temporal-dead-zone traps:** a top-level call that references a `let`/`const` declared thousands of lines later in the same block throws and silently aborts the rest of that block (broke boot once; see the thirteenth-pass changelog). Put such calls after `load();` near the end of the file.
- **Fix at the owning function rather than stacking another patch layer.** v116 had 63 inline blocks; v161 has 85 inline blocks plus 14 `assets/*.js` modules (versioned `-vNNN` layers from v149 on). Past "final/canonical rebuild" layers for roads are exactly why these files don't converge.
- **Don't trust the file's self-audit objects** (`window.__TYCOON_V11x_..._AUDIT__`, etc.): they check their own bookkeeping. Assert on real scene/DOM state (`scene.traverse`, Box3/OBB overlaps, computed style).

Major subsystems in v116 (names may differ in v161; grep first): stage-based house progression (`STAGES`, `purchaseCurrentPad()`, `spawnBuilding()`), road network (master grid + stage roads + service/industrial roads, rendered by `addCorner`/`addIntersection59`/union contours; `serviceAccessGraph()` is the industrial-zone node tree), logistics (`createBuildDeliveryPlan()` gates construction progress on a delivery ticket; trucks via `syncDeliveryFleet()`, yielding in `serviceVehicleYieldFactor()`), the market plaza (`MARKET_STALLS_V116`), in-world guidance (`nextActionableTargetV117()`), and feedback (`sfx`, `spawnBurst`, `triggerShake`).

## Design rules that constrain implementations

- Progression UI is **circular ground pads** triggered through `nearestManualTargetV53()` → `#actionPrompt` / `#actionBtn`. Floating quest/toast/objective panels are intentionally hidden (`#nextCard`, `#requiredActionV38`, `#eventBanner`); the only sanctioned panel exceptions are the market's resource-exchange menu and the top resource bar. Reuse the pad mechanism for new interactions.
- A **brand-new save** (no `tycoon3d_save_v3` in localStorage) starts as an empty world; **any existing save** must default every staged-unlock flag to "already built" (`industrialZoneBuiltV116`, `sawmillBuiltV118`/`fleetDepotBuiltV118`/`concretePlantBuiltV118`/`metalYardBuiltV118`, `marketStallsBuiltV118`, `manualRoadModeV116`) so returning players see no change. Save-format changes need a migration.
- Roads: one connected network that is not re-laid on upgrades (guard rebuilds with signatures), every building has its own connected driveway, delivery routes are paved end to end, turns are smooth arcs, no road/curb through parking, conveyors or buildings, junction arm count matches real destinations.
- Feedback must be rare and meaningful (HUD stat pulses once fired near-continuously and read as flicker). Keep mobile performance in mind (modest particle counts, pooled objects).

## Testing notes

`tests/lib/harness.mjs` is the shared setup (static server on the repo root, iPhone 13 context, `openGame({save})` with save injection under `tycoon3d_save_v3`, console-error and 4xx collection). A fresh game is an *absent* localStorage key (`save:'clear'`), not `{}`. v116 lessons that likely still hold: setting `stageIndex` alone does not spawn buildings (call `spawnBuilding()`, or `purchaseCurrentPad()` for the real path); a benign `navigator.vibrate` console warning appears headless and is filtered; the game shows a harmless "Stability mode enabled" toast under software rendering.

## Workflow conventions

Develop on branch `claude/3d-building-tycoon-game-pigx1h` and push there directly (no PRs). Record each change in `CHANGELOG_V161.md` (Russian, dated sections with file:line root cause and before/after evidence) and update `VISION.md` if the described behavior changes. When the user uploads a new build, import it with `tools/standalone.mjs` rather than editing the standalone file.
