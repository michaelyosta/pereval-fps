# Operation “Pereval”

`Pereval` is a browser FPS prototype built with Three.js. It keeps the original visual brief: a fortified desert outpost at golden hour and the anomalous rifle “OBLOMOK-7”. The playable map, weapon, bots, particles, and WebAudio are local and procedural; there are no remote runtime assets.

The project is now a local Vite application with explicit gameplay services, a repeatable survival/extraction expedition loop, unit tests, Playwright coverage, a deterministic demo route, debug telemetry, quality presets, and a measured benchmark.

## Preview

- [Start screen](docs/qa/iteration-01/start.png)
- [Combat HUD](docs/qa/iteration-01/combat.png)
- [Demo scene](docs/qa/final/demo.png)
- [OBLOMOK-7 concept reference](assets/concepts/oblomok-7-concept.png)

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

Useful routes:

- `/?mode=expedition&seed=12345` — seeded expedition (the default mode).
- `/?mode=arena` — preserved five-kill legacy arena for combat regression.
- `/?mode=arena&demo=1` — cinematic camera and safe presentation scene.
- `/?debug=1` — compact FPS, frame time, renderer counters, weapon, spread, recoil, and player position overlay.
- `/?mode=expedition&seed=12345&testMode=1` — accelerated deterministic QA lifecycle.
- `/?quality=Low|Medium|High|Ultra` — select a render preset without changing gameplay.

Production checks:

```bash
npm run build
npm run preview
```

## Controls

| Input       | Action          |
| ----------- | --------------- |
| WASD        | Move            |
| Shift       | Sprint          |
| Left mouse  | Fire            |
| Right mouse | Aim down sights |
| R           | Reload          |
| Space       | Jump            |
| E           | Interact        |
| H           | Heal            |
| M           | Visited map     |
| Escape      | Pause / resume  |

If Pointer Lock is unavailable, the game falls back to a normal mouse mode instead of leaving the match in a broken state. Pause freezes match time, AI, weapon timers, and death/respawn progression.

## Gameplay contracts

- Player damage is authoritative in the gameplay core and emits one event per applied hit.
- Enemy kills transition once from alive to dead and increment the match counter once.
- Enemy shots use a vertical capsule player hit volume, line-of-sight, nearest-wall blocking, movement/distance penalties, and burst timing.
- Player shots validate the muzzle-to-impact segment so the weapon cannot shoot through nearby cover.
- Player and bot movement share height-aware capsule collision with oriented world boxes and a small step offset.
- Arena ends after five kills; expedition kills are statistics and do not end a run. Expedition success requires objective completion and a completed extraction.
- Expedition module walls are generated from graph edges and feed player collision, bot movement/LOS, and player-shot blocking; legacy arena keeps its original world path.

## Architecture

```text
src/main.js             composition root, input, loop, camera, pause/victory
src/world.js            procedural base, lighting, renderable/shootable world
src/combat.js            OBLOMOK-7, fire/reload, recoil, ballistics and FX
src/bots.js              patrol/attack/death/respawn and enemy hit handling
src/ui.js                HUD, killfeed, damage feedback, WebAudio
src/core/EventBus.js     small synchronous event bus
src/core/gameplay.js     pure health, kill, reload, respawn, and time rules
src/core/ballistics.js   capsule ray tests and wall blocking
src/core/collision.js    height-aware oriented-box capsule resolver
src/config/graphics.js   Low/Medium/High/Ultra render presets
src/core/expedition/     seeded RNG, run lifecycle, campaign contracts
src/expedition/          authored modules, connector routes, encounters, objectives, extraction, inventory, noise, threat, Watcher
```

Modules receive the shared service object through `g.services`; there is no `window.g`, dynamic import cycle, or UI callback overwrite.

## Tests and QA

```bash
npm test                 # gameplay, ballistics, capsule collision, expedition services
npm run lint
npm run format:check
npm run test:e2e         # lifecycle, seed passes, encounter spawn, balance profile, combat, pause, demo
npm run benchmark        # writes docs/qa/final/benchmark.json and demo.png
```

The benchmark reports actual values from the current machine. The checked-in run used headless Chromium without assuming a discrete GPU: 2.57 FPS, 388.50 ms sampled frame time, 808 draw calls, 11,407 triangles, 51 resources, 3.64 MB encoded resource bytes, 342 geometries, and 41 textures. The in-app visual QA overlay is a separate measurement; neither environment is presented as a universal hardware claim.

The build currently emits one main JavaScript chunk of about 711.23 kB minified and 192.78 kB gzip. This is a known optimization target, not hidden behind a made-up budget.

`npm audit --omit=dev --audit-level=high` is clean. The full development-tool audit currently reports five transitive Vite/Vitest/esbuild advisories; the available `npm audit fix --force` is a breaking upgrade, so it is intentionally not applied in this gameplay pass.

## Assets

The runtime uses local CanvasTexture materials. Color maps are tagged `THREE.SRGBColorSpace`; bump/roughness data maps use `THREE.NoColorSpace`. The generated Image Gen image in `assets/concepts/` is a concept reference only and is not loaded by the game. See [assets/README.md](assets/README.md) and [assets/manifest.json](assets/manifest.json).

## Scope and limitations

The expedition foundation is a compact vertical slice rather than a production multiplayer/AAA stack. There is no networking, content streaming, skeletal animation pipeline, baked lightmap, or external PBR asset library. The authored expedition graph, connector-aware routes, module-local polygon navmesh, objective data, extraction points, loot placements, events, finite encounter groups, selected loadout, and skill rewards are deterministic by seed; the hideout persists campaign stash, unlocks, best time, and bounded run history through `SaveSystem`, while temporary run skills are discarded on death. Arbitrary internal obstacle baking, a fully general long-range path follower, code splitting, and draw-call-heavy decoration profiling remain known optimization targets. Legacy arena decoration remains a separate compatibility path. Headless browser performance is software-dependent; use the in-app debug overlay or a real browser on the target GPU for hardware decisions.

See [EXPEDITION_AUDIT.md](docs/design/EXPEDITION_AUDIT.md) for the original defect inventory and [docs/qa/final/REPORT.md](docs/qa/final/REPORT.md) for the final verification record.

## Expedition foundation

The expedition route owns a single `RunManager` state machine:

`Boot → MainMenu → Hideout → Loadout → GeneratingRun → Deploying → Exploration → ObjectiveActive → ExtractionAvailable → Extracting → Results`.

`?seed=` is preserved in the `RunConfig`, generated graph and connector routes, objective, extraction points, loot containers, events, enemy groups, encounter scheduler, temporary skill rewards, debug overlay, and results data. `?mode=arena` remains the explicit legacy regression route. Threat/Anomaly pressure can schedule safe dormant enemy groups mid-run; expedition kills do not respawn. Temporary skills are run-scoped; campaign unlocks, stash, and recent run history are versioned through `SaveSystem`.

## License

MIT. See [LICENSE](LICENSE).
