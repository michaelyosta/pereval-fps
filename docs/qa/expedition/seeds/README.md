# Expedition seed manifest

These are real deterministic generation snapshots produced on 2026-08-02 with `WorldGenerator`. They cover the authored graph, objective, extraction, loot, enemy archetypes, Watcher candidate placement, authored obstacle bounds, and obstacle-aware module-local polygon navigation metadata. They are not substitutes for a full manual 20–30 minute expedition; the accelerated browser lifecycle and restart-soak checks are tracked separately.

| Label        | Seed           | Modules | Main path | Objective       | Alternative extraction | Loot | Enemy groups | Watcher groups | Notable tags                            |
| ------------ | -------------- | ------: | --------: | --------------- | ---------------------- | ---: | -----------: | -------------: | --------------------------------------- |
| short-linear | `short-linear` |      11 |         9 | activate-relays | exposed_yard-10        |   15 |           12 |              1 | horror, watcher, danger                 |
| branching    | `branching`    |      10 |         8 | restore-power   | exposed_yard-8         |   15 |           11 |              1 | danger, horror, watcher                 |
| underground  | `underground`  |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           13 |              1 | underground, rare-loot, high-threat     |
| weapon-cache | `weapon-cache` |      11 |         9 | activate-relays | exposed_yard-9         |   15 |           13 |              1 | danger, horror, watcher                 |
| watcher      | `watcher`      |      11 |         9 | activate-relays | exposed_yard-9         |   13 |           13 |              0 | danger, rare-loot                       |
| high-threat  | `high-threat`  |      12 |        10 | restore-power   | horror_dark_zone-11    |   17 |           13 |              1 | underground, rare-loot, horror, watcher |
| low-loot     | `low-loot`     |      11 |         9 | extract-sample  | exposed_yard-9         |   16 |           13 |              1 | danger, horror, watcher                 |
| rich-loot    | `rich-loot`    |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           11 |              1 | horror, watcher, danger                 |

The graph schema is `nodes`, `edges`, `startNodeId`, `objectiveNodeIds`, `extractionNodeId`, and `branchNodeIds`; points and placements are derived from each node's authored module definition. Re-run a logical snapshot with:

```text
node --input-type=module -e "import { WorldGenerator } from './src/expedition/worldGenerator.js'; console.log(new WorldGenerator().generate({seed:'watcher'}).graph.serialize())"
```

The deterministic browser test uses seed `e2e` and produces [seed-e2e.png](../seed-e2e.png), including the generated module frame, HUD/debug state, and results overlay after an accelerated objective/extraction flow. `tests/e2e/expedition-soak.spec.js` repeats the same seeded assembly four times and checks for stale scene/runtime state.

## Accelerated browser passes

These are real Playwright `testMode=1` passes; `elapsedMs` is wall-clock browser time and `elapsedSeconds` is the in-game timer after the intentionally accelerated three-second extraction. They validate different generated seeds and weapon selections, not the 20–30 minute balance target.

| Seed           | Weapon  | Wall time | In-game timer | Objective steps | Threat | Anomaly | Result  |
| -------------- | ------- | --------: | ------------: | --------------: | -----: | ------: | ------- |
| `short-linear` | pistol  | 14,731 ms |        0.25 s |               3 |  25.95 |   25.06 | success |
| `underground`  | shotgun | 15,014 ms |        0.25 s |               3 |  25.95 |   25.06 | success |
| `high-threat`  | rifle   | 13,712 ms |        0.25 s |               3 |  26.16 |   25.31 | success |

The suite also contains a normal-mode virtual duration soak (`normal-duration`). It advances 1,200 seconds of in-game time with `testMode=0`, injects periodic pressure signals, verifies that at least one dormant group is spawned through the runtime pipeline, and checks that threat/anomaly remain bounded. This is a timer/finite-budget soak, not a manual 20–30 minute balance assessment.

The `normal-profile` browser case uses the same `testMode=0` path, advances 1,200 seconds, completes the objective, and completes the configured 30-second primary extraction through `RunManager.tick`. It is stronger lifecycle/timer evidence than an accelerated pass, but it remains simulated rather than a manual balance session.
