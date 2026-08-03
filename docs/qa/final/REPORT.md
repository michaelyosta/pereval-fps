# Final QA report

Date: 2026-08-03
Project: `pereval-fps`
Branch: `codex/procedural-expedition`

## Verified commands

| Check                  | Result                                 |
| ---------------------- | -------------------------------------- |
| `npm test`             | 40 passed                              |
| `npm run lint`         | passed                                 |
| `npm run format:check` | passed                                 |
| `npm run build`        | passed                                 |
| `npm run test:e2e`     | 17 passed; no page/console errors      |
| `npm run qa:seeds`     | 8 deterministic graph schemas exported |
| `npm run benchmark`    | completed; JSON written                |

## Measured benchmark

The checked-in benchmark is from `?mode=expedition&seed=benchmark&watcher=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 632.66 ms
- sample: 1,604.40 ms, 7.48 FPS, 133.70 ms sampled frame time
- renderer: 92 calls, 1,703 triangles, 316 points, 132 lines
- resources: 51 entries, 3,496,779 encoded bytes, 96 geometries, 21 textures
- run timings: 3.60 ms generation, 0.80 ms nav/collision, 4.80 ms reset, 0.30 ms collider build, 1.10 ms module assembly, 3.30 ms world assembly
- page errors: none; console errors: none

The production bundle measured after lazy-loading the legacy arena is `707.57 kB` minified / `191.70 kB` gzip for the expedition entry, plus a `25.33 kB` (`8.04 kB` gzip) arena chunk. Static floors, wall/obstacle boxes, and module frames are batched in the renderer. The benchmark artifact is [benchmark.json](benchmark.json), with the matching expedition capture at [expedition-benchmark.png](expedition-benchmark.png).

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

The expedition E2E visual artifact is `docs/qa/expedition/seed-e2e.png`: a real seeded run entering the generated module layout, then completing an accelerated objective and extraction into the results overlay. The fixed seed manifest under `docs/qa/expedition/seeds/` contains eight exported graph schemas and eight browser screenshots. The expedition E2E suite also verifies authored obstacle-aware polygon navigation with connector portals, event-driven armory/blocked-route dynamic obstacles, a pressure-triggered mid-run encounter, persisted success/failure history, a real four-cycle restart/resource soak, a virtual 20-minute normal-mode duration soak, and three different simulated normal-mode balance profiles that complete the full 30-second extraction duration.

## Known issues / next pass

1. Extend the event-driven dynamic OBB model to more event choreography, arbitrary non-box geometry, and a fully general long-range enemy path follower.
2. Continue splitting the large expedition application chunk and profile remaining draw-call-heavy procedural decorations.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
