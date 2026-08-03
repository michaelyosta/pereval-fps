import { RunSeed } from './SeededRandom.js';

export const RunState = Object.freeze({
  Boot: 'Boot',
  MainMenu: 'MainMenu',
  Hideout: 'Hideout',
  Loadout: 'Loadout',
  GeneratingRun: 'GeneratingRun',
  Deploying: 'Deploying',
  Exploration: 'Exploration',
  ObjectiveActive: 'ObjectiveActive',
  ExtractionAvailable: 'ExtractionAvailable',
  Extracting: 'Extracting',
  RunSuccess: 'RunSuccess',
  PlayerDead: 'PlayerDead',
  RunFailed: 'RunFailed',
  Results: 'Results',
});

export const RUN_TRANSITIONS = Object.freeze({
  [RunState.Boot]: [RunState.MainMenu],
  [RunState.MainMenu]: [RunState.Hideout, RunState.Loadout],
  [RunState.Hideout]: [RunState.Loadout, RunState.GeneratingRun, RunState.MainMenu],
  [RunState.Loadout]: [RunState.Hideout, RunState.GeneratingRun],
  [RunState.GeneratingRun]: [RunState.Deploying, RunState.RunFailed],
  [RunState.Deploying]: [RunState.Exploration, RunState.PlayerDead, RunState.RunFailed],
  [RunState.Exploration]: [RunState.ObjectiveActive, RunState.PlayerDead, RunState.RunFailed],
  [RunState.ObjectiveActive]: [
    RunState.Exploration,
    RunState.ExtractionAvailable,
    RunState.PlayerDead,
    RunState.RunFailed,
  ],
  [RunState.ExtractionAvailable]: [
    RunState.Exploration,
    RunState.Extracting,
    RunState.PlayerDead,
    RunState.RunFailed,
  ],
  [RunState.Extracting]: [
    RunState.ExtractionAvailable,
    RunState.RunSuccess,
    RunState.PlayerDead,
    RunState.RunFailed,
  ],
  [RunState.RunSuccess]: [RunState.Results],
  [RunState.PlayerDead]: [RunState.RunFailed, RunState.Results],
  [RunState.RunFailed]: [RunState.Results],
  [RunState.Results]: [RunState.Hideout, RunState.MainMenu],
});

export function canTransition(from, to) {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export class RunConfig {
  constructor(options = {}) {
    this.seed = RunSeed.from(options.seed ?? 'default');
    this.difficulty = options.difficulty ?? 'standard';
    this.primaryWeapon = options.primaryWeapon ?? 'oblomok-7';
    this.testMode = options.testMode === true;
    this.watcher = options.watcher !== false;
    this.maxGenerationAttempts = Number.isInteger(options.maxGenerationAttempts)
      ? Math.max(1, options.maxGenerationAttempts)
      : 6;
    this.extractionDuration = Number.isFinite(options.extractionDuration)
      ? Math.max(1, options.extractionDuration)
      : this.testMode
        ? 3
        : 30;
  }
}

export class CampaignState {
  constructor(snapshot = {}) {
    this.version = 2;
    this.completedRuns = Number.isInteger(snapshot.completedRuns) ? snapshot.completedRuns : 0;
    this.permanentUnlocks = Array.isArray(snapshot.permanentUnlocks) ? [...snapshot.permanentUnlocks] : [];
    this.stash = { ...(snapshot.stash ?? {}) };
    this.bestTime = Number.isFinite(snapshot.bestTime) ? snapshot.bestTime : null;
    this.runHistory = Array.isArray(snapshot.runHistory)
      ? snapshot.runHistory
          .filter((entry) => entry && typeof entry === 'object')
          .slice(0, 12)
          .map((entry) => ({
            ...entry,
            stats: { ...(entry.stats ?? {}) },
            loot: Array.isArray(entry.loot) ? entry.loot.map((item) => ({ ...item })) : [],
          }))
      : [];
  }

  clone() {
    return new CampaignState(this);
  }
}

export class RunResult {
  constructor({ status, reason, run, campaign } = {}) {
    this.status = status ?? 'failure';
    this.reason = reason ?? null;
    this.seed = run?.config?.seed?.display ?? null;
    this.elapsedSeconds = run?.elapsedSeconds ?? 0;
    this.threat = run?.threat ?? 0;
    this.anomaly = run?.anomaly ?? 0;
    this.anomalyBand = run?.anomalyBand ?? 'quiet';
    this.stats = { ...(run?.stats ?? {}) };
    this.visitedModules = [...(run?.visitedModules ?? [])];
    this.loot = status === 'success' ? [...(run?.loot ?? [])] : [];
    this.temporarySkills = [...(run?.temporarySkills ?? [])];
    this.permanentRewards = [...(run?.permanentRewards ?? [])];
    this.watcher = run?.watcher?.snapshot?.() ?? null;
    this.campaign = campaign?.clone?.() ?? campaign ?? null;
  }
}

export class ActiveRun {
  constructor(config, generatedWorld) {
    this.config = config;
    this.map = generatedWorld;
    this.elapsedSeconds = 0;
    this.threat = 0;
    this.anomaly = 0;
    this.anomalyBand = 'quiet';
    this.watcherState = config.watcher ? 'dormant' : 'disabled';
    this.loot = [];
    this.stats = {
      kills: 0,
      killsByType: {},
      shots: 0,
      hits: 0,
      damageTaken: 0,
      objectivesCompleted: 0,
      lootCollected: 0,
      healingUsed: 0,
      noiseEvents: 0,
      eventsResolved: 0,
    };
    this.temporarySkills = [];
    this.skillOptions = [];
    this.skillChoiceOpen = false;
    this.permanentRewards = [];
    this.visitedModules = [];
    this.performance = {};
    this.loadout = { primaryWeapon: config.primaryWeapon };
    this.equipment = null;
    this.weapon = null;
    this.result = null;
    this.objective = generatedWorld.objective;
    this.extraction = {
      available: false,
      active: false,
      progress: 0,
      duration: config.extractionDuration,
      nodeId: generatedWorld.extractionNodeId,
    };
  }
}
