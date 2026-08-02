import { CampaignState, ActiveRun, RunConfig, RunResult, RunState, canTransition } from './runTypes.js';
import { WorldGenerator } from '../../expedition/worldGenerator.js';
import { ObjectiveDirector } from '../../expedition/objectives.js';
import { ExtractionSystem } from '../../expedition/extraction.js';
import { ThreatDirector } from '../../expedition/threatDirector.js';
import { Inventory } from '../../expedition/inventory.js';

export class RunManager {
  constructor({ generator = new WorldGenerator(), campaign = null, saveSystem = null } = {}) {
    this.generator = generator;
    this.saveSystem = saveSystem;
    this.state = RunState.Boot;
    this.run = null;
    this.objectiveDirector = null;
    this.extraction = null;
    this.threatDirector = null;
    this.campaign = campaign
      ? campaign instanceof CampaignState
        ? campaign
        : new CampaignState(campaign)
      : (saveSystem?.load?.() ?? new CampaignState());
    this.listeners = new Set();
    this.transitionHistory = [];
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event, this.snapshot());
  }

  transition(next, reason = null) {
    if (!canTransition(this.state, next)) throw new Error(`Invalid run transition: ${this.state} -> ${next}`);
    const previous = this.state;
    this.state = next;
    const event = { type: 'state-changed', previous, next, reason };
    this.transitionHistory.push(event);
    this.emit(event);
    return this.state;
  }

  start() {
    if (this.state === RunState.Boot) this.transition(RunState.MainMenu, 'boot-complete');
    return this.state;
  }

  openHideout() {
    if (this.state === RunState.MainMenu || this.state === RunState.Results)
      this.transition(RunState.Hideout, 'open-hideout');
    return this.state;
  }

  openLoadout() {
    if (this.state === RunState.MainMenu) this.transition(RunState.Loadout, 'open-loadout');
    else if (this.state === RunState.Hideout) this.transition(RunState.Loadout, 'prepare-loadout');
    return this.state;
  }

  beginRun(options = {}) {
    if (![RunState.Hideout, RunState.Loadout].includes(this.state)) {
      throw new Error(`Cannot begin a run from ${this.state}`);
    }
    const config = options instanceof RunConfig ? options : new RunConfig(options);
    this.transition(RunState.GeneratingRun, 'generate-run');
    try {
      const generatedWorld = this.generator.generate(config);
      this.run = new ActiveRun(config, generatedWorld);
      this.objectiveDirector = new ObjectiveDirector(generatedWorld.objective, generatedWorld);
      this.extraction = new ExtractionSystem({
        testMode: config.testMode,
        points: [
          {
            id: 'primary',
            nodeId: generatedWorld.extractionNodeId,
            duration: config.extractionDuration,
            mode: 'hold',
          },
          {
            id: 'alternative',
            nodeId: generatedWorld.alternativeExtractionNodeId,
            duration: config.testMode ? 2 : Math.max(5, config.extractionDuration - 8),
            mode: 'noisy',
          },
        ],
      });
      this.threatDirector = new ThreatDirector({ seed: config.seed.display + ':threat' });
      this.run.objectiveDirector = this.objectiveDirector;
      this.run.threatDirector = this.threatDirector;
      this.run.objective = this.objectiveDirector.instance;
      this.run.inventory = new Inventory({ capacity: 12, weightLimit: 30 });
      for (const item of generatedWorld.startResources)
        this.run.inventory.add({ id: item.type, type: item.type, amount: 1, maxStack: 10, weight: 0.1 });
      this.emit({
        type: 'run-generated',
        seed: config.seed.display,
        attempts: generatedWorld.generationAttempts,
      });
      this.transition(RunState.Deploying, 'world-ready');
      return this.run;
    } catch (error) {
      this.run = null;
      this.transition(RunState.RunFailed, error.message);
      this.transition(RunState.Results, 'generation-failed');
      throw error;
    }
  }

  deploy() {
    if (this.state !== RunState.Deploying) throw new Error(`Cannot deploy from ${this.state}`);
    this.transition(RunState.Exploration, 'player-deployed');
    this.emit({ type: 'run-started', seed: this.run.config.seed.display });
    return this.run;
  }

  tick(seconds, { insideExtraction = true } = {}) {
    if (!this.run || !Number.isFinite(seconds) || seconds <= 0) return;
    if (
      [
        RunState.Exploration,
        RunState.ObjectiveActive,
        RunState.ExtractionAvailable,
        RunState.Extracting,
      ].includes(this.state)
    ) {
      this.run.elapsedSeconds += seconds;
      this.threatDirector?.update(seconds);
    }
    if (this.state === RunState.Extracting) this.tickExtraction(seconds, insideExtraction);
  }

  startObjective() {
    if (this.state !== RunState.Exploration) throw new Error(`Cannot start objective from ${this.state}`);
    this.objectiveDirector?.start();
    this.transition(RunState.ObjectiveActive, 'objective-started');
  }

  completeObjectiveStep(stepId = null) {
    if (!this.run || ![RunState.Exploration, RunState.ObjectiveActive].includes(this.state)) {
      throw new Error(`Cannot complete objective step from ${this.state}`);
    }
    if (this.state === RunState.Exploration) this.startObjective();
    const objective = this.run.objective;
    const step = objective.steps[objective.currentStep];
    if (!step || (stepId && step.id !== stepId)) return false;
    const completed = this.objectiveDirector?.completeStep({ stepId, force: !stepId });
    if (!completed) return false;
    this.run.stats.objectivesCompleted += 1;
    this.run.threat = Math.min(100, this.run.threat + (step.threat || 8));
    this.threatDirector?.addThreat(step.threat || 8);
    this.emit({ type: 'objective-step-completed', step });
    if (this.objectiveDirector?.isComplete()) {
      this.run.extraction.available = true;
      this.extraction?.unlock();
      this.transition(RunState.ExtractionAvailable, 'objective-complete');
      this.emit({ type: 'extraction-available', nodeId: this.run.extraction.nodeId });
    }
    return true;
  }

  completeObjective() {
    if (!this.run) throw new Error('No active run');
    while (!this.run.objective.completed) this.completeObjectiveStep();
    return this.run.objective;
  }

  recordKill(count = 1) {
    if (!this.run) return;
    this.run.stats.kills += Math.max(0, count);
    this.emit({ type: 'kill-recorded', count });
  }

  addLoot(item) {
    if (!this.run || !item) return false;
    const added = this.run.inventory?.add(item);
    if (added && !added.ok) return false;
    this.run.loot.push({ ...item });
    this.emit({ type: 'loot-collected', item });
    return true;
  }

  addTemporarySkill(skill) {
    if (!this.run || !skill) return false;
    if (!this.run.temporarySkills.some((item) => item.id === skill.id))
      this.run.temporarySkills.push({ ...skill });
    return true;
  }

  activateExtraction(pointId = 'primary') {
    if (this.state !== RunState.ExtractionAvailable)
      throw new Error(`Cannot activate extraction from ${this.state}`);
    const point = this.extraction?.begin(pointId);
    if (!point) throw new Error('Unknown extraction point: ' + pointId);
    this.run.extraction.active = true;
    this.run.extraction.progress = 0;
    this.run.extraction.duration = point.duration;
    this.run.extraction.nodeId = point.nodeId;
    this.transition(RunState.Extracting, 'extraction-started');
    this.emit({ type: 'extraction-started', duration: this.run.extraction.duration });
  }

  tickExtraction(seconds, insideZone) {
    if (this.state !== RunState.Extracting || !this.run) return false;
    const result = this.extraction?.tick(seconds, { inside: insideZone }) ?? {
      completed: false,
      progress: this.run.extraction.progress,
    };
    this.run.extraction.progress = result.progress;
    this.run.threat = Math.min(100, this.run.threat + seconds * (insideZone ? 0.35 : 0.05));
    if (result.completed) {
      this.completeExtraction();
      return true;
    }
    return false;
  }

  completeExtraction() {
    if (this.state !== RunState.Extracting) throw new Error(`Cannot complete extraction from ${this.state}`);
    this.run.extraction.progress = this.run.extraction.duration;
    this.transition(RunState.RunSuccess, 'extraction-complete');
    this.finalize('success', 'extracted');
    this.transition(RunState.Results, 'show-results');
    return this.run.result;
  }

  playerDied(reason = 'player-died') {
    if (!this.run || [RunState.Results, RunState.RunSuccess, RunState.RunFailed].includes(this.state))
      return false;
    if (this.state !== RunState.PlayerDead) this.transition(RunState.PlayerDead, reason);
    this.finalize('failure', reason);
    this.transition(RunState.RunFailed, reason);
    this.transition(RunState.Results, 'show-results');
    return true;
  }

  failCriticalObjective(reason = 'critical-objective-failed') {
    if (!this.run || [RunState.Results, RunState.RunSuccess, RunState.RunFailed].includes(this.state))
      return false;
    this.transition(RunState.RunFailed, reason);
    this.finalize('failure', reason);
    this.transition(RunState.Results, 'show-results');
    return true;
  }

  finalize(status, reason) {
    if (!this.run) return null;
    if (status === 'success') {
      this.campaign.completedRuns += 1;
      if (this.campaign.bestTime === null || this.run.elapsedSeconds < this.campaign.bestTime)
        this.campaign.bestTime = this.run.elapsedSeconds;
    }
    this.run.result = new RunResult({ status, reason, run: this.run, campaign: this.campaign });
    this.saveSystem?.save?.(this.campaign);
    this.emit({ type: 'run-finished', result: this.run.result });
    return this.run.result;
  }

  returnToHideout() {
    if (this.state !== RunState.Results) throw new Error(`Cannot return to hideout from ${this.state}`);
    return this.openHideout();
  }

  snapshot() {
    return {
      state: this.state,
      campaign: this.campaign.clone(),
      run: this.run
        ? {
            config: this.run.config,
            map: this.run.map,
            elapsedSeconds: this.run.elapsedSeconds,
            threat: this.run.threat,
            loot: [...this.run.loot],
            stats: { ...this.run.stats },
            temporarySkills: [...this.run.temporarySkills],
            inventory: this.run.inventory?.toJSON?.() ?? null,
            extraction: { ...this.run.extraction },
            objective: this.run.objective,
            result: this.run.result,
          }
        : null,
    };
  }
}
