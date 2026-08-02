# Iteration 01 QA report

Date: 2026-08-02  
Branch: `codex/fps-correctness`

## Automated checks

- `npm test`: 10 tests passed across gameplay, ballistics, and height-aware capsule collision.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:e2e`: 2 Playwright tests passed — combat/pause flow and demo scene, with zero page errors and zero console errors.

## Browser checks

- Start screen remains readable and preserves the desert-base / golden-hour visual direction.
- Starting the match keeps the player alive long enough to act; damage changes the health bar and the pause overlay is reachable with Escape.
- Pause settings expose quality, sensitivity, and Y inversion controls.
- Debug overlay now reports real renderer counters after the frame render, not zeros from a pre-render sample.

Artifacts: [start](start.png), [combat](combat.png), and [demo](demo.png).

## Remaining risks

- The main build chunk is still large: approximately 579 kB minified / 153 kB gzip.
- Headless Chromium benchmark performance is software-dependent and not a GPU claim.
- Procedural textures are not seeded, so cold-start screenshots are not pixel-identical.
