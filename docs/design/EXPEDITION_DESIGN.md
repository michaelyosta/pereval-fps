# Expedition design

The current expedition foundation is deliberately data-first. RunManager owns one run and the UI only projects its state.

## Lifecycle

Boot -> MainMenu -> Hideout -> Loadout -> GeneratingRun -> Deploying -> Exploration -> ObjectiveActive -> ExtractionAvailable -> Extracting -> Results.

Death transitions through PlayerDead -> RunFailed -> Results. A failed critical objective follows RunFailed -> Results. Five kills never complete an expedition; kills are recorded in ActiveRun.stats.

## Run ownership

RunConfig stores the display seed, difficulty, test mode, Watcher flag, generation attempt limit, and extraction duration. ActiveRun stores the generated map, objective instance, timer, threat, anomaly band, loot, stats, temporary skills, event state, extraction progress, and result. NoiseSystem, ThreatDirector, AnomalyLevel, and WatcherDirector are run-scoped services. CampaignState stores only persistent completion, unlocks, stash, and best time.

## Success

The objective director must complete every ordered step. That unlocks extraction. The extraction system then requires the player to hold a primary or alternative point until its timer completes. Leaving the point reduces progress; only completion creates a successful RunResult.

## Optional events

World generation selects deterministic optional event descriptors from eight event types. EventDirector exposes the unresolved events, applies capacity checks, grants typed rewards, changes threat/anomaly, can start recovery, and can offer a temporary skill choice. ThreeWorldAssembler creates the event markers and the normal InteractionSystem handles their prompts and progress.

## Noise and pursuit

Movement, sprinting, shots, loot, objectives, events, and extraction emit NoiseSystem events on the module graph. Intensity is attenuated through authored audio zones; noise raises threat and anomaly without revealing an exact position unless visual contact is set. WatcherDirector activates at a seeded anomaly/noise threshold from a safe candidate, then the runtime bot moves from that sampled position; it does not teleport to the player.

## Deferred systems

The current milestone intentionally keeps the whole generated world loaded, uses authored box colliders instead of a navigation mesh, and exposes a compact shelter rather than a full stash/map screen. ThreatDirector has a finite encounter scheduler and seeded enemy groups but does not yet spawn new encounter groups mid-run. Visual weapon models and audio are shared procedural adapters; replacing them with authored assets is deferred.
