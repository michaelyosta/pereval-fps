# Final QA report

Date: 2026-08-02
Project: `pereval-fps`
Branch: `codex/procedural-expedition`

## Verified commands

| Check               | Result                           |
| ------------------- | -------------------------------- |
| `npm test`          | 28 passed                        |
| `npm run lint`      | passed                           |
| `npm run build`     | passed                           |
| `npm run test:e2e`  | 3 passed; no page/console errors |
| `npm run benchmark` | completed; JSON written          |

## Measured benchmark

The checked-in benchmark is from `?mode=arena&demo=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 672.29 ms
- sample: 1,846.50 ms, 2.71 FPS, 369.30 ms sampled frame time
- renderer: 860 calls, 11,993 triangles, 816 points, 0 lines
- resources: 39 entries, 3,064,407 encoded bytes
- page errors: none; console errors: none

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

The expedition E2E visual artifact is `docs/qa/expedition/seed-e2e.png`: a real seeded run entering the generated module layout, then completing an accelerated objective and extraction into the results overlay.

## Known issues / next pass

1. Replace the generated box-collider route with a full navigation mesh and connector-aware path planner.
2. Finish the combat adapter for data-driven weapon damage, inventory consumption, and threat-driven encounter pacing.
3. Add permanent stash UI and full results history to the hideout.
4. Split the large application chunk and profile draw-call-heavy procedural decorations.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
