# Final QA report

Date: 2026-08-02
Project: `pereval-fps`
Branch: `codex/procedural-expedition`

## Verified commands

| Check               | Result                           |
| ------------------- | -------------------------------- |
| `npm test`          | 27 passed                        |
| `npm run lint`      | passed                           |
| `npm run build`     | passed                           |
| `npm run test:e2e`  | 3 passed; no page/console errors |
| `npm run benchmark` | completed; JSON written          |

## Measured benchmark

The checked-in benchmark is from `?mode=arena&demo=1&debug=1` at 1280×720 in headless Chromium on the local machine. It recorded:

- first load: 630.78 ms
- sample: 1,666.30 ms, 3.00 FPS, 333.26 ms sampled frame time
- renderer: 833 calls, 11,659 triangles, 816 points, 0 lines
- resources: 37 entries, 2,964,197 encoded bytes
- page errors: none; console errors: none

The in-app browser visual check showed approximately 60 FPS and 16.7 ms frame time under a different browser/GPU path. These measurements are reported separately and are not extrapolated into a universal hardware claim.

## Visual pass

The interface keeps the original military desert-base identity, warm low sun, teal shadow contrast, anomalous weapon motif, restrained HUD, and readable title treatment. The pause/settings overlay and victory screen share the same visual language. The generated concept image is preserved under `assets/concepts/` as a reference, while runtime materials remain procedural and local.

The expedition E2E visual artifact is `docs/qa/expedition/seed-e2e.png`: a real seeded run entering the generated module layout, then completing an accelerated objective and extraction into the results overlay.

## Known issues / next pass

1. Integrate generated module colliders/connectors into the full Three.js navigation mesh; the current assembler is an explicit frame/floor plan.
2. Connect data-driven weapon/inventory/threat services to the existing combat and bot adapters.
3. Finish hideout/loadout screens, permanent stash UI, and full results history.
4. Split the large application chunk and profile draw-call-heavy procedural decorations.

The runtime dependency audit is clean with `npm audit --omit=dev --audit-level=high`. The dev toolchain still has five transitive Vite/Vitest/esbuild advisories; automatic force-fixing would be a breaking upgrade and is deferred.
