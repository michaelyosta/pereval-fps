# Final QA report

Date: 2026-08-03
Project: `pereval-fps`
Branch: `codex/procedural-expedition`

## Verified commands

| Check                  | Result                                 |
| ---------------------- | -------------------------------------- |
| `npm test`             | 38 passed                              |
| `npm run lint`         | passed                                 |
| `npm run format:check` | passed                                 |
| `npm run build`        | passed                                 |
| `npm run test:e2e`     | 16 passed; no page/console errors      |
| `npm run qa:seeds`     | 8 deterministic graph schemas exported |
| `npm run benchmark`    | completed; JSON written                |

## Measured benchmark

The checked-in benchmark is from `?mode=expedition&seed=benchmark&watcher=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 683.60 ms
- sample: 1,650.10 ms, 4.24 FPS, 235.73 ms sampled frame time
- renderer: 254 calls, 3,533 triangles, 816 points, 36 lines
- resources: 51 entries, 3,695,993 encoded bytes, 314 geometries, 41 textures
- page errors: none; console errors: none

The production bundle measured in the same pass is `716.25 kB` minified / `194.34 kB` gzip. The benchmark artifact is [benchmark.json](benchmark.json), with the matching expedition capture at [expedition-benchmark.png](expedition-benchmark.png).

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

The expedition E2E visual artifact is `docs/qa/expedition/seed-e2e.png`: a real seeded run entering the generated module layout, then completing an accelerated objective and extraction into the results overlay. The fixed seed manifest under `docs/qa/expedition/seeds/` contains eight exported graph schemas and eight browser screenshots. The expedition E2E suite also verifies authored obstacle-aware polygon navigation with connector portals, a pressure-triggered mid-run encounter, persisted success/failure history, a real four-cycle restart/resource soak, a virtual 20-minute normal-mode duration soak, and three different simulated normal-mode balance profiles that complete the full 30-second extraction duration.

## Known issues / next pass

1. Extend the current authored axis-aligned obstacle mesh to dynamic/rotated arbitrary geometry and a fully general long-range enemy path follower.
2. Split the large application chunk and profile draw-call-heavy procedural decorations.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
