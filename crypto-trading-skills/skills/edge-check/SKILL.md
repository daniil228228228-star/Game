---
name: edge-check
description: Method for testing whether a trading idea (rule, signal, ML/forecast model) has a real edge before risking money. Use when the user asks "is this strategy profitable", brings a signal/skill/model, or wants a forecast; also to answer honestly when someone promises "stable signals".
---

# edge-check

Checklist used in this project (see `research/` for working code):
1. **Costs first**: Bybit taker 0.055%/side (0.11% round trip), plus funding for perps. Short-horizon rules usually die here.
2. **Signal at bar close, trade at next open.** No look-ahead; hold exactly N hours or stop/target with stop-first on ambiguous bars.
3. **Out-of-sample by time**: split the sample in halves (or 2-year slices). Keep only what is positive in all parts.
4. **Symmetry test**: if "follow" and "fade" versions both lose, it is just fees, there is no edge.
5. **Clustering**: coins fall together; compute t-stats on per-day averages, not on all trades.
6. **Multiple testing**: count how many variants you tried; with ~200 tests a |t|>3 appears by luck about once.
7. **Robustness**: neighbours of the best parameter must also work (SMA 40-300 all positive passes; a single spike does not).
8. **Baselines**: compare to always-long, buy&hold and random entries at the same times.
9. **Models** (Kronos, Chronos-2, TimesFM): score direction accuracy and correlation on 200+ historical forecasts vs 50% / 0.
Report honestly: say "no edge" when that is the result.
