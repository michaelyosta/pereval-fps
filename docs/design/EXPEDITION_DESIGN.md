# Expedition design

The current expedition foundation is deliberately data-first. RunManager owns one run and the UI only projects its state.

## Lifecycle

Boot -> MainMenu -> Hideout -> Loadout -> GeneratingRun -> Deploying -> Exploration -> ObjectiveActive -> ExtractionAvailable -> Extracting -> Results.

Death transitions through PlayerDead -> RunFailed -> Results. A failed critical objective follows RunFailed -> Results. Five kills never complete an expedition; kills are recorded in ActiveRun.stats.

## Run ownership

RunConfig stores the display seed, difficulty, test mode, Watcher flag, generation attempt limit, and extraction duration. ActiveRun stores the generated map, objective instance, timer, threat, loot, stats, temporary skills, extraction progress, and result. CampaignState stores only persistent completion, unlocks, stash, and best time.

## Success

The objective director must complete every ordered step. That unlocks extraction. The extraction system then requires the player to hold a primary or alternative point until its timer completes. Leaving the point reduces progress; only completion creates a successful RunResult.

## Deferred systems

Three.js world assembly, full hideout screens, combat weapon adapters, enemy movement, and the final results presentation are intentionally separate consumers of these services. This keeps simulation rules testable without a browser.
