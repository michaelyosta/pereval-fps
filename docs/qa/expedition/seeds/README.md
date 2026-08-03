# Expedition seed manifest

These are real deterministic generation snapshots produced on 2026-08-03 with `WorldGenerator`. They cover the authored graph, objective, extraction, loot, enemy archetypes, Watcher candidate placement, authored obstacle bounds, and obstacle-aware module-local polygon navigation metadata. Each row links to the exported graph schema and the screenshot captured during the corresponding browser run. They are not substitutes for a full manual 20–30 minute expedition; the accelerated browser lifecycle and restart-soak checks are tracked separately.

| Label        | Seed           | Modules | Main path | Objective       | Alternative extraction | Loot | Enemy groups | Watcher groups | Artifacts                                             | Notable tags                            |
| ------------ | -------------- | ------: | --------: | --------------- | ---------------------- | ---: | -----------: | -------------: | ----------------------------------------------------- | --------------------------------------- |
| short-linear | `short-linear` |      11 |         9 | activate-relays | exposed_yard-10        |   15 |           12 |              1 | [graph](short-linear.json) · [shot](short-linear.png) | horror, watcher, danger                 |
| branching    | `branching`    |      10 |         8 | restore-power   | exposed_yard-8         |   15 |           11 |              1 | [graph](branching.json) · [shot](branching.png)       | danger, horror, watcher                 |
| underground  | `underground`  |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           13 |              1 | [graph](underground.json) · [shot](underground.png)   | underground, rare-loot, high-threat     |
| weapon-cache | `weapon-cache` |      11 |         9 | activate-relays | exposed_yard-9         |   15 |           13 |              1 | [graph](weapon-cache.json) · [shot](weapon-cache.png) | danger, horror, watcher                 |
| watcher      | `watcher`      |      11 |         9 | activate-relays | exposed_yard-9         |   13 |           14 |              1 | [graph](watcher.json) · [shot](watcher.png)           | danger, rare-loot                       |
| high-threat  | `high-threat`  |      12 |        10 | restore-power   | horror_dark_zone-11    |   17 |           13 |              1 | [graph](high-threat.json) · [shot](high-threat.png)   | underground, rare-loot, horror, watcher |
| low-loot     | `low-loot`     |      11 |         9 | extract-sample  | exposed_yard-9         |   16 |           13 |              1 | [graph](low-loot.json) · [shot](low-loot.png)         | danger, horror, watcher                 |
| rich-loot    | `rich-loot`    |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           11 |              1 | [graph](rich-loot.json) · [shot](rich-loot.png)       | horror, watcher, danger                 |

The graph schema is `nodes`, `edges`, `startNodeId`, `objectiveNodeIds`, `extractionNodeId`, and `branchNodeIds`; points and placements are derived from each node's authored module definition. Re-run a logical snapshot with:

```text
node --input-type=module -e "import { WorldGenerator } from './src/expedition/worldGenerator.js'; console.log(new WorldGenerator().generate({seed:'watcher'}).graph.serialize())"
```

The deterministic browser test uses seed `e2e` and produces [seed-e2e.png](../seed-e2e.png), including the generated module frame, HUD/debug state, and results overlay after an accelerated objective/extraction flow. The eight seeded Playwright passes below also capture one active-run screenshot each; the watcher and high-threat cases inject a loud noise signal and verify the Watcher reaches `stalking`. `tests/e2e/expedition-soak.spec.js` repeats the same seeded assembly four times and checks for stale scene/runtime state.

## Accelerated browser passes

These are real Playwright `testMode=1` passes; `elapsedMs` is wall-clock browser time and `elapsedSeconds` is the in-game timer after the intentionally accelerated three-second extraction. They validate different generated seeds and weapon selections, not the 20–30 minute balance target.

| Seed           | Weapon    | Watcher | Wall time | In-game timer | Objective steps | Threat | Anomaly | Result  |
| -------------- | --------- | ------- | --------: | ------------: | --------------: | -----: | ------: | ------- |
| `short-linear` | pistol    | off     | 19,034 ms |        0.75 s |               3 |  25.95 |   25.06 | success |
| `branching`    | rifle     | off     | 18,773 ms |        0.75 s |               3 |  26.16 |   25.31 | success |
| `underground`  | shotgun   | off     | 17,755 ms |        0.70 s |               3 |  25.95 |   25.06 | success |
| `weapon-cache` | oblomok-7 | off     | 18,314 ms |        0.75 s |               3 |  25.95 |   25.06 | success |
| `watcher`      | rifle     | on      | 16,823 ms |        1.00 s |               3 |  30.95 |   30.58 | success |
| `high-threat`  | oblomok-7 | on      | 17,265 ms |        1.00 s |               3 |  31.16 |   30.83 | success |
| `low-loot`     | pistol    | off     | 16,694 ms |        0.70 s |               3 |  25.95 |   25.06 | success |
| `rich-loot`    | shotgun   | off     | 17,155 ms |        0.70 s |               3 |  25.95 |   25.06 | success |

The suite also contains a normal-mode virtual duration soak (`normal-duration`). It advances 1,200 seconds of in-game time with `testMode=0`, injects periodic pressure signals, verifies that at least one dormant group is spawned through the runtime pipeline, and checks that threat/anomaly remain bounded. This is a timer/finite-budget soak, not a manual 20–30 minute balance assessment.

The `normal-profile` browser case uses the same `testMode=0` path, advances 1,200 seconds, completes the objective, and completes the configured 30-second primary extraction through `RunManager.tick`. A separate three-seed profile repeats that full simulated lifecycle with different weapons and Watcher settings:

| Seed               | Weapon  | Watcher | In-game duration | Objective steps | Result  |
| ------------------ | ------- | ------- | ---------------: | --------------: | ------- |
| `balance-fast`     | pistol  | off     |       1,231.45 s |               3 | success |
| `balance-optional` | shotgun | on      |       1,231.45 s |               3 | success |
| `balance-watcher`  | rifle   | on      |       1,231.45 s |               3 | success |

These are stronger lifecycle/timer evidence than an accelerated pass, but remain simulated rather than manual balance sessions.
The current navmesh evidence also includes rotated authored boxes. Dynamic obstacles and arbitrary non-box geometry remain outside this profile.
