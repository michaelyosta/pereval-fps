# Final QA report

Date: 2026-08-02
Project: `pereval-fps`
Branch: `codex/fps-correctness`

## Verified commands

| Check               | Result                           |
| ------------------- | -------------------------------- |
| `npm test`          | 10 passed                        |
| `npm run lint`      | passed                           |
| `npm run build`     | passed                           |
| `npm run test:e2e`  | 2 passed; no page/console errors |
| `npm run benchmark` | completed; JSON written          |

## Measured benchmark

The checked-in benchmark is from `?demo=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 730.13 ms
- sample: 1,985.40 ms, 2.01 FPS, 496.35 ms sampled frame time
- renderer: 831 calls, 11,467 triangles, 816 points, 0 lines
- resources: 24 entries, 2,538,441 encoded bytes
- page errors: none; console errors: none

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

## Known issues / next pass

1. Split the large application chunk and profile draw-call-heavy procedural decorations.
2. Seed procedural texture noise when pixel-stable screenshot diffs become important.
3. Replace selected procedural maps with authored PBR assets only after gameplay and performance budgets are agreed.
4. Add broader interaction coverage for respawn expiry and quality switching through Playwright.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
