# Final QA report

Date: 2026-08-02
Project: `pereval-fps`
Branch: `codex/procedural-expedition`

## Verified commands

| Check                  | Result                           |
| ---------------------- | -------------------------------- |
| `npm test`             | 37 passed                        |
| `npm run lint`         | passed                           |
| `npm run format:check` | passed                           |
| `npm run build`        | passed                           |
| `npm run test:e2e`     | 8 passed; no page/console errors |
| `npm run benchmark`    | completed; JSON written          |

## Measured benchmark

The checked-in benchmark is from `?mode=arena&demo=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 667.75 ms
- sample: 1,860.30 ms, 2.69 FPS, 372.06 ms sampled frame time
- renderer: 805 calls, 11,443 triangles, 816 points, 0 lines
- resources: 50 entries, 3,562,040 encoded bytes
- page errors: none; console errors: none

The production bundle measured 702.63 kB minified / 190.00 kB gzip in the same build.

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

The expedition E2E visual artifact is `docs/qa/expedition/seed-e2e.png`: a real seeded run entering the generated module layout, then completing an accelerated objective and extraction into the results overlay. The expedition E2E suite also verifies a pressure-triggered mid-run encounter and the hideout's persisted success/failure history.

## Known issues / next pass

1. Replace the connector-aware graph planner and authored box colliders with a full polygon navigation mesh and long-range enemy path follower.
2. Split the large application chunk and profile draw-call-heavy procedural decorations.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
