# Expedition audit

Date: 2026-08-02  
Base branch: `codex/fps-correctness`  
Working branch: `codex/procedural-expedition`  
Base commit: `51c2f21`

## Baseline evidence

The baseline was run before changing the project on the working branch:

- `npm test -- --reporter=dot`: 10 tests passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm run build`: passed; one approximately 580 kB minified application chunk.
- `npm run test:e2e`: 2 Playwright tests passed.
- `npm run benchmark`: completed without page or console errors. The existing headless run reported 2.35 FPS and 829 draw calls; this is a baseline measurement, not a target.

## Current architecture

The composition root is `src/main.js`. It owns the Three.js renderer, input, camera, frame loop, pause flow, death/respawn timer, and the old five-kill victory condition. The modules receive the shared `g` object through `g.services`:

- `src/world.js` builds one authored arena, its colliders, shootables, lighting, dust, and demo camera waypoints.
- `src/combat.js` owns OBLOMOK-7 firing, reloads, recoil, hit validation, and weapon effects.
- `src/bots.js` owns patrol, attack, enemy damage, death, and respawn.
- `src/ui.js` owns the existing HUD, killfeed, audio, damage feedback, and debug values.
- `src/core/gameplay.js`, `ballistics.js`, and `collision.js` contain the already corrected pure gameplay contracts.

The existing arena is currently created once by `world.init()`. Its decorative textures, dust positions, and several scene placements use `Math.random()`. That implementation remains valid for the explicit legacy route, but it is not a suitable source of deterministic expedition layout.

## Components to preserve

- Damage, death, respawn, fair ballistics, wall blocking, capsule collision, bot separation, pause timing, victory presentation, Vite, ESLint, Prettier, Vitest, Playwright, benchmark, and debug overlay.
- The authored Three.js art direction and local procedural asset strategy.
- The existing arena regression path as `?mode=arena`, so correctness fixes remain testable while expedition systems are introduced.

## Components to replace or move behind a mode boundary

- The five-kill match ending is arena-only. Expedition kills are statistics and may satisfy an objective step, but do not end a run.
- Arena `restartMatch()`/`respawn()` control is being separated from expedition run completion. Expedition completion is owned by `RunManager`.
- The single fixed world builder will become a renderer-facing consumer of a generated logical world. Generation must not be placed in DOM callbacks or Three.js object construction.
- Random layout and encounter selection in expedition code must use `SeededRandom` streams. The legacy arena remains available for regression while its visual randomness is migrated separately.

## Initial risks

1. A simultaneous rewrite of `main.js` and `world.js` could regress the proven combat contracts. The migration therefore adds pure expedition services before changing arena rendering.
2. Generated modules can be individually valid while their graph is not playable. `WorldValidator` must check connectivity, objective and extraction reachability, branch presence, bounds, connector use, resources, and density on every attempt.
3. UI can accidentally become a second state machine. `RunManager` owns transitions and results; UI is only a projection and input adapter.
4. Three.js resources can leak when a generated world is replaced. `GeneratedWorld`/`WorldAssembler` will own teardown in a later milestone.
5. The current arena E2E assumes the old default URL. It must explicitly use `?mode=arena` once expedition becomes the default.

## Migration plan

1. Add the typed-in-JavaScript run lifecycle and deterministic seed primitives. Keep transitions explicit and unit-testable.
2. Add authored module definitions, graph assembly, validation, bounded derived-seed retries, and deterministic generation tests.
3. Add `GeneratedWorld` and `WorldAssembler` adapters so logical modules can be rendered without coupling generation to Three.js.
4. Route `?mode=arena` to the unchanged arena and make expedition the default route. Add a minimal hideout/loadout/deployment projection before adding the full expedition HUD.
5. Add objective, extraction, inventory, noise, threat, enemy, skill, save, and results services in that order, each with unit tests.
6. Add deterministic expedition E2E and death E2E, then perform real seeded playthroughs and record QA artifacts.

## First milestone boundary

The first milestone is a repeatable vertical slice, not a full campaign:

- one seeded 10–16 module map with a main route, branch, danger or reward detour, shortcut, objective, and extraction;
- three objective definitions and one working objective director;
- one primary and one alternative extraction point;
- four weapon families, authored loot, temporary skills, three enemy archetypes, and a bounded threat escalation;
- hideout, loadout, versioned campaign save, results, and temporary-vs-permanent progression rules;
- deterministic unit/E2E coverage, real QA runs, and documented limitations.

Anything outside that boundary—crafting, hunger/thirst, multiplayer, open-world streaming, a full story campaign, and a large asset pipeline—is deliberately deferred.
