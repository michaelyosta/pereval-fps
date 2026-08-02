# Expedition seed manifest

These are real logical generation snapshots produced on 2026-08-02 with WorldGenerator. They are not claimed as full playthrough timings or screenshots; browser playthrough artifacts will be added once the Three.js world assembler is connected.

| Label        | Seed           | Modules | Main path | Objective       | Alternative extraction | Loot | Enemy groups | Notable tags                        |
| ------------ | -------------- | ------: | --------: | --------------- | ---------------------- | ---: | -----------: | ----------------------------------- |
| short-linear | `short-linear` |      11 |         9 | activate-relays | exposed_yard-10        |   15 |           12 | horror, watcher, danger             |
| branching    | `branching`    |      10 |         8 | restore-power   | exposed_yard-8         |   15 |           11 | danger, horror, watcher             |
| underground  | `underground`  |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           13 | underground, rare-loot, high-threat |
| weapon-cache | `weapon-cache` |      11 |         9 | activate-relays | exposed_yard-9         |   15 |           13 | danger, horror, watcher             |
| watcher      | `watcher`      |      11 |         9 | activate-relays | exposed_yard-9         |   13 |           13 | danger, rare-loot                   |
| high-threat  | `high-threat`  |      12 |        10 | restore-power   | horror_dark_zone-11    |   17 |           13 | underground, rare-loot, horror      |
| low-loot     | `low-loot`     |      11 |         9 | extract-sample  | exposed_yard-9         |   16 |           13 | danger, horror, watcher             |
| rich-loot    | `rich-loot`    |      10 |         8 | extract-sample  | exposed_yard-9         |   13 |           11 | horror, watcher, danger             |

The graph, points, events, and generated placements are deterministic for each seed. Re-run the logical snapshot with:

```text
node --input-type=module -e "import { WorldGenerator } from './src/expedition/worldGenerator.js'; console.log(new WorldGenerator().generate({seed:'watcher'}).graph.serialize())"
```
The deterministic browser test uses seed e2e and produces [seed-e2e.png](../seed-e2e.png), including the generated module frame, HUD/debug state, and results overlay after an accelerated objective/extraction flow.
