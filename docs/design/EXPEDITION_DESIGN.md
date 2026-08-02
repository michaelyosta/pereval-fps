# Expedition design

The current expedition foundation is deliberately data-first. RunManager owns one run and the UI only projects its state.

## Lifecycle

Boot -> MainMenu -> Hideout -> Loadout -> GeneratingRun -> Deploying -> Exploration -> ObjectiveActive -> ExtractionAvailable -> Extracting -> Results.

Death transitions through PlayerDead -> RunFailed -> Results. A failed critical objective follows RunFailed -> Results. Five kills never complete an expedition; kills are recorded in ActiveRun.stats.

## Run ownership

RunConfig stores the display seed, difficulty, test mode, Watcher flag, generation attempt limit, and extraction duration. ActiveRun stores the generated map, objective instance, timer, threat, anomaly band, loot, stats, temporary skills, event state, extraction progress, encounter state, and result. NoiseSystem, ThreatDirector, AnomalyLevel, WatcherDirector, and EncounterDirector are run-scoped services. CampaignState stores persistent completion, unlocks, stash, best time, and the bounded recent-run history; temporary skills never cross a run boundary.

## Success

The objective director must complete every ordered step. That unlocks extraction. The extraction system then requires the player to hold a primary or alternative point until its timer completes. Leaving the point reduces progress; only completion creates a successful RunResult.

## Optional events

World generation selects deterministic optional event descriptors from eight event types. EventDirector exposes the unresolved events, applies capacity checks, grants typed rewards, changes threat/anomaly, can start recovery, and can offer a temporary skill choice. ThreeWorldAssembler creates the event markers and the normal InteractionSystem handles their prompts and progress.

## Noise and pursuit

Movement, sprinting, shots, loot, objectives, events, and extraction emit NoiseSystem events on the module graph. Intensity is attenuated through authored audio zones; noise raises threat and anomaly without revealing an exact position unless visual contact is set. WatcherDirector activates at a seeded anomaly/noise threshold from a safe candidate, then the runtime bot moves from that sampled position; it does not teleport to the player.

## Navigation and pursuit

World generation produces connector-aware main/objective/alternative-extraction routes. The planner validates connector type, blocked state, allowed categories, transition points, route cost, and next connector. Encounter candidates must be reachable through that planner, not merely present in the graph. Bots still use the existing collision-constrained local movement; a polygon nav mesh and long-range path following remain outside this vertical slice.

EncounterDirector reserves a finite initial budget, then schedules dormant seeded enemy groups in response to threat, anomaly, loud noise, or extraction pressure. The main thread consumes the request through the real bot spawn pipeline. Expedition kills do not respawn the group, preserving a finite encounter economy.

## Deferred systems

The current milestone intentionally keeps the whole generated world loaded and uses authored box colliders rather than a polygon navigation mesh. Visual weapon models and audio are shared procedural adapters; replacing them with authored assets, code splitting, and draw-call-heavy decoration profiling are deferred.
