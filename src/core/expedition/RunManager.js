import { CampaignState, ActiveRun, RunConfig, RunResult, RunState, canTransition } from './runTypes.js';
import { WorldGenerator } from '../../expedition/worldGenerator.js';
import { ObjectiveDirector } from '../../expedition/objectives.js';
import { ExtractionSystem } from '../../expedition/extraction.js';
import { ThreatDirector } from '../../expedition/threatDirector.js';
import { Equipment, Inventory } from '../../expedition/inventory.js';
import { WeaponRegistry } from '../../expedition/weapons.js';
import { ItemRegistry } from '../../expedition/loot.js';
import { SkillRegistry } from '../../expedition/skills.js';
import { NoiseSystem } from '../../expedition/noise.js';
import { AnomalyLevel } from '../../expedition/anomalyLevel.js';
import { WatcherDirector } from '../../expedition/watcher.js';
import { EventDirector } from '../../expedition/events.js';
import { EncounterDirector } from '../../expedition/encounters.js';

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedMs(start) {
  return Number(Math.max(0, monotonicNow() - start).toFixed(2));
}

export class RunManager {
  constructor({ generator = new WorldGenerator(), campaign = null, saveSystem = null } = {}) {
    this.generator = generator;
    this.saveSystem = saveSystem;
    this.weaponRegistry = new WeaponRegistry();
    this.itemRegistry = new ItemRegistry();
    this.skillRegistry = new SkillRegistry();
    this.state = RunState.Boot;
    this.run = null;
    this.objectiveDirector = null;
    this.extraction = null;
    this.threatDirector = null;
    this.noiseSystem = null;
    this.anomalyLevel = null;
    this.watcher = null;
    this.eventDirector = null;
    this.encounterDirector = null;
    this.noiseSequence = 0;
    this.lastNoiseId = null;
    this.performance = {};
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
    const runResetStart = monotonicNow();
    this.run?.map?.dispose?.();
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
      this.noiseSystem = new NoiseSystem({ graph: generatedWorld.graph });
      this.anomalyLevel = new AnomalyLevel({ seed: config.seed.display + ':anomaly' });
      this.watcher = new WatcherDirector({
        seed: config.seed.display + ':watcher',
        enabled: config.watcher,
      });
      this.eventDirector = new EventDirector(generatedWorld.events);
      this.encounterDirector = new EncounterDirector({
        groups: generatedWorld.enemyGroups,
        graph: generatedWorld.graph,
        threatDirector: this.threatDirector,
        seed: config.seed.display + ':encounters',
        testMode: config.testMode,
      });
      this.watcher.onEvent((event) => this.emit(event));
      this.run.objectiveDirector = this.objectiveDirector;
      this.run.threatDirector = this.threatDirector;
      this.run.noiseSystem = this.noiseSystem;
      this.run.anomalyLevel = this.anomalyLevel;
      this.run.watcher = this.watcher;
      this.run.eventDirector = this.eventDirector;
      this.run.encounterDirector = this.encounterDirector;
      this.run.objective = this.objectiveDirector.instance;
      const weaponDefinition = this.weaponRegistry.get(config.primaryWeapon);
      this.run.equipment = new Equipment();
      this.run.equipment.equip(
        {
          id: weaponDefinition.id,
          type: 'weapon',
          metadata: { name: weaponDefinition.name, category: weaponDefinition.category },
        },
        'primary',
      );
      this.run.weapon = this.weaponRegistry.createState(weaponDefinition.id);
      this.run.skillOptions = [];
      this.run.skillChoiceOpen = false;
      this.run.inventory = new Inventory({ capacity: 12, weightLimit: 30 });
      for (const item of generatedWorld.startResources) {
        const definition = this.itemRegistry.get(item.itemId ?? item.type);
        this.run.inventory.add(definition.toInventoryItem(item.amount ?? 1));
      }
      if (!this.run.inventory.has('medkit'))
        this.run.inventory.add(this.itemRegistry.get('bandage').toInventoryItem(1));
      const ammoItemId =
        {
          pistol: 'pistol-ammo',
          rifle: 'rifle-ammo',
          shell: 'shell',
          anomalous: 'anomaly-charge',
        }[weaponDefinition.reserveType] ?? 'rifle-ammo';
      if (!this.run.inventory.has(ammoItemId))
        this.run.inventory.add(this.itemRegistry.get(ammoItemId).toInventoryItem(10));
      this.run.weapon.reserve = this.run.inventory.count(ammoItemId);
      this.performance = {
        ...(generatedWorld.metadata?.timings ?? {}),
        runResetMs: elapsedMs(runResetStart),
      };
      this.run.performance = { ...this.performance };
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

  recordPerformance(timings = {}) {
    this.performance = { ...this.performance, ...timings };
    if (this.run) this.run.performance = { ...this.performance };
    return { ...this.performance };
  }

  restart(reason = 'restart') {
    if (!this.run) return false;
    if (this.state === RunState.Results) return true;
    if (this.state === RunState.RunSuccess) this.transition(RunState.Results, reason);
    else if (this.state !== RunState.RunFailed) {
      this.transition(RunState.RunFailed, reason);
      this.transition(RunState.Results, reason);
    } else this.transition(RunState.Results, reason);
    return true;
  }

  tick(seconds, { insideExtraction = true, playerPosition = null, playerNodeId = null } = {}) {
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
      this.noiseSystem?.update(seconds);
      const activeNoise = this.lastNoiseId ? this.noiseSystem?.events.get(this.lastNoiseId) : null;
      this.anomalyLevel?.update(seconds, {
        threat: this.threatDirector?.threat ?? this.run.threat,
        inAnomaly: this.run.objective?.type === 'extract-sample' && this.state === RunState.ObjectiveActive,
      });
      this.watcher?.update(seconds, {
        anomaly: this.anomalyLevel?.value ?? 0,
        noise: activeNoise,
        playerPosition,
        playerNodeId,
      });
      this.threatDirector?.setPlayer({
        position: playerPosition ?? this.threatDirector.player.position,
        nodeId: playerNodeId,
      });
      const encounter = this.encounterDirector?.update(seconds, {
        threat: this.threatDirector?.threat ?? this.run.threat,
        anomaly: this.anomalyLevel?.value ?? this.run.anomaly,
        noise: activeNoise,
        playerPosition,
        playerNodeId,
        state: this.state,
      });
      if (encounter) this.emit(encounter);
      this.run.threat = this.threatDirector?.threat ?? this.run.threat;
      this.run.anomaly = this.anomalyLevel?.value ?? this.run.anomaly;
      this.run.anomalyBand = this.anomalyLevel?.band ?? this.run.anomalyBand;
      this.run.watcherState = this.watcher?.state ?? this.run.watcherState;
      for (const skill of this.run.temporarySkills) {
        if (Number.isFinite(skill.remaining)) skill.remaining = Math.max(0, skill.remaining - seconds);
      }
      this.run.temporarySkills = this.run.temporarySkills.filter((skill) => skill.remaining !== 0);
    }
    if (this.state === RunState.Extracting) this.tickExtraction(seconds, insideExtraction);
  }

  nodeForPosition(position) {
    if (!this.run?.map?.graph || !position) return null;
    const navNode = this.run.map.navigationMesh?.nodeForPosition?.(position);
    if (navNode) return navNode;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const [id, record] of this.run.map.graph.nodes) {
      const node = record.instance;
      const distance = Math.hypot(position.x - node.position.x, position.z - node.position.z);
      if (distance < nearestDistance) {
        nearest = id;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  recordNoise({
    kind = 'movement',
    nodeId = null,
    position = null,
    intensity = 1,
    duration = 1,
    visualContact = false,
  } = {}) {
    if (!this.run || !this.noiseSystem) return new Map();
    const id = `noise-${this.noiseSequence++}`;
    const resolvedNodeId = nodeId ?? this.nodeForPosition(position) ?? this.run.map.graph.startNodeId;
    const event = {
      id,
      kind,
      nodeId: resolvedNodeId,
      position,
      intensity,
      duration,
      visualContact,
    };
    const signals = this.noiseSystem.emit(event);
    this.lastNoiseId = id;
    this.run.stats.noiseEvents += 1;
    const movementNoiseMultiplier = ['movement', 'sprint'].includes(kind)
      ? (this.run.temporarySkills.find((skill) => skill.id === 'quiet-step')?.modifier
          ?.movementNoiseMultiplier ?? 1)
      : 1;
    const effectiveIntensity = intensity * movementNoiseMultiplier;
    const anomalyGain =
      kind === 'shot'
        ? effectiveIntensity * 1.4
        : kind === 'anomaly'
          ? effectiveIntensity * 1.1
          : effectiveIntensity * 0.18;
    this.anomalyLevel?.add(anomalyGain, kind);
    this.threatDirector?.addThreat(
      Math.min(5, effectiveIntensity * (kind === 'shot' ? 1.25 : 0.15)),
      `noise:${kind}`,
    );
    this.run.threat = this.threatDirector?.threat ?? this.run.threat;
    this.run.anomaly = this.anomalyLevel?.value ?? this.run.anomaly;
    this.run.anomalyBand = this.anomalyLevel?.band ?? this.run.anomalyBand;
    this.emit({ type: 'noise-emitted', event, signals });
    return signals;
  }

  consumeWeaponAmmo(amount = 1) {
    if (!this.run?.weapon) return false;
    const ammoItemId =
      {
        pistol: 'pistol-ammo',
        rifle: 'rifle-ammo',
        shell: 'shell',
        anomalous: 'anomaly-charge',
      }[this.run.weapon.definition.reserveType] ?? 'rifle-ammo';
    return this.run.inventory?.remove(ammoItemId, amount, { force: true })?.ok ?? false;
  }

  resolveEvent(eventId) {
    if (!this.run || !this.eventDirector) return { ok: false, reason: 'no-run' };
    const preview = this.eventDirector.preview(eventId);
    if (!preview) return { ok: false, reason: 'already-resolved' };
    for (const reward of preview.rewards) {
      const definition = this.itemRegistry.get(reward.itemId);
      const availability = this.run.inventory.canAdd(
        definition.toInventoryItem(reward.amount),
        reward.amount,
      );
      if (!availability.ok) return { ok: false, reason: availability.reason, eventId };
    }
    const event = this.eventDirector.resolve(eventId);
    const collected = [];
    for (const reward of event.rewards) {
      const definition = this.itemRegistry.get(reward.itemId);
      const item = definition.toInventoryItem(reward.amount);
      this.run.inventory.add(item, reward.amount);
      this.run.loot.push({
        id: item.id,
        type: item.type,
        amount: reward.amount,
        metadata: { ...item.metadata },
      });
      collected.push({ id: item.id, amount: reward.amount });
    }
    this.run.stats.eventsResolved += 1;
    this.run.threat = Math.max(0, Math.min(100, this.run.threat + event.threat));
    this.threatDirector?.addThreat(event.threat, `event:${event.type}`);
    this.anomalyLevel?.add(Math.max(0, event.anomaly), `event:${event.type}`);
    if (event.recovery) this.threatDirector?.startRecovery(undefined, `event:${event.type}`);
    this.recordNoise({
      kind: `event:${event.type}`,
      nodeId: event.nodeId,
      position: this.run.map.graph.getNode(event.nodeId)?.position,
      intensity: event.noise,
      duration: 1.2,
    });
    if (event.skill) this.offerSkillChoice(`event:${event.type}`);
    this.emit({ type: 'event-resolved', eventId, eventType: event.type, items: collected });
    return { ok: true, eventId, type: event.type, items: collected };
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
    if (stepId) {
      const requiredItems =
        step.id === 'activate-generator' ? ['fuel', 'fuse'] : step.id === 'take-sample' ? ['sample'] : [];
      if (requiredItems.length && !requiredItems.some((itemId) => this.run.inventory?.has(itemId)))
        return false;
      for (const itemId of requiredItems) {
        if (this.run.inventory?.has(itemId)) {
          this.run.inventory.remove(itemId, 1, { force: true });
          break;
        }
      }
    }
    const completed = this.objectiveDirector?.completeStep({ stepId, force: !stepId });
    if (!completed) return false;
    this.run.stats.objectivesCompleted += 1;
    this.run.threat = Math.min(100, this.run.threat + (step.threat || 8));
    this.threatDirector?.addThreat(step.threat || 8, 'objective-step');
    this.anomalyLevel?.add(step.threat || 8, 'objective');
    this.run.anomaly = this.anomalyLevel?.value ?? this.run.anomaly;
    this.run.anomalyBand = this.anomalyLevel?.band ?? this.run.anomalyBand;
    this.emit({ type: 'objective-step-completed', step });
    this.recordNoise({
      kind: 'objective',
      nodeId: step.nodeId,
      position: this.run.map.graph.getNode(step.nodeId)?.position,
      intensity: step.id.includes('hold') ? 2.8 : 1.4,
      duration: step.id.includes('hold') ? 3 : 1,
    });
    if (this.objectiveDirector?.isComplete()) {
      this.run.extraction.available = true;
      this.extraction?.unlock();
      this.transition(RunState.ExtractionAvailable, 'objective-complete');
      this.offerSkillChoice('objective');
      this.emit({ type: 'extraction-available', nodeId: this.run.extraction.nodeId });
    }
    return true;
  }

  completeObjective() {
    if (!this.run) throw new Error('No active run');
    while (!this.run.objective.completed) this.completeObjectiveStep();
    return this.run.objective;
  }

  recordKill(count = 1, archetype = null) {
    if (!this.run) return;
    this.run.stats.kills += Math.max(0, count);
    if (archetype)
      this.run.stats.killsByType[archetype] = (this.run.stats.killsByType[archetype] ?? 0) + count;
    this.emit({ type: 'kill-recorded', count, archetype });
  }

  addLoot(item) {
    if (!this.run || !item) return false;
    const added = this.run.inventory?.add(item);
    if (added && !added.ok) return false;
    this.run.loot.push({ ...item });
    this.emit({ type: 'loot-collected', item });
    return true;
  }

  collectLoot(containerId) {
    if (!this.run || !this.run.inventory) return { ok: false, reason: 'no-run' };
    const container = this.run.map.lootContainers?.find((item) => item.id === containerId);
    if (!container || container.opened) return { ok: false, reason: 'already-open' };
    const preview = container.preview?.(this.itemRegistry) ?? [];
    for (const item of preview) {
      const availability = this.run.inventory.canAdd(item, item.amount);
      if (!availability.ok) return { ok: false, reason: availability.reason, id: containerId };
    }
    const items = container.open(this.itemRegistry);
    const collected = [];
    for (const item of items) {
      const result = this.run.inventory.add(item, item.amount);
      if (!result.ok) return { ok: false, reason: result.reason, id: containerId };
      const collectedItem = {
        id: item.id,
        type: item.type,
        amount: item.amount,
        metadata: { ...item.metadata },
      };
      this.run.loot.push(collectedItem);
      collected.push(collectedItem);
      if (item.type === 'ammo' && item.metadata?.ammoType === this.run.weapon?.definition?.reserveType)
        this.run.weapon.reserve += item.amount;
    }
    this.run.stats.lootCollected += collected.length;
    this.emit({ type: 'loot-collected', containerId, items: collected });
    this.recordNoise({
      kind: container.secured ? 'forced-loot' : 'loot',
      nodeId: container.nodeId,
      position: container.position,
      intensity: container.secured ? 2.4 : 0.7,
      duration: container.secured ? 1.5 : 0.6,
    });
    return { ok: true, id: containerId, items: collected };
  }

  useHealing(itemId = 'medkit') {
    if (!this.run?.inventory) return { ok: false, reason: 'no-run', amount: 0 };
    const definition = this.itemRegistry.get(itemId);
    if (!definition.heal) return { ok: false, reason: 'not-healing', amount: 0 };
    const consumed = this.run.inventory.consume(itemId, 1);
    if (!consumed.ok) return { ok: false, reason: consumed.reason, amount: 0 };
    this.run.stats.healingUsed += 1;
    const healingMultiplier =
      this.run.temporarySkills.find((skill) => skill.id === 'field-medic')?.modifier?.healingMultiplier ?? 1;
    const amount = Math.round(definition.heal * healingMultiplier);
    this.emit({ type: 'healing-used', itemId, amount });
    return { ok: true, itemId, amount };
  }

  addTemporarySkill(skill) {
    if (!this.run || !skill) return false;
    const definition = this.skillRegistry.get(skill.id);
    if (!this.run.temporarySkills.some((item) => item.id === skill.id)) {
      this.run.temporarySkills.push({
        id: definition.id,
        source: skill.source ?? 'reward',
        remaining: definition.duration,
        modifier: { ...definition.modifier },
      });
    }
    return true;
  }

  offerSkillChoice(source = 'reward') {
    if (!this.run || this.run.skillChoiceOpen) return this.run?.skillOptions ?? [];
    const generated = (this.run.map.temporarySkills ?? [])
      .map((skill) => this.skillRegistry.get(skill.id))
      .filter(Boolean);
    const pool = [...generated, ...this.skillRegistry.all()].filter(
      (definition, index, list) => list.findIndex((candidate) => candidate.id === definition.id) === index,
    );
    const available = pool.filter(
      (definition) => !this.run.temporarySkills.some((skill) => skill.id === definition.id),
    );
    this.run.skillOptions = available.slice(0, 3).map((definition) => ({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      source,
    }));
    this.run.skillChoiceOpen = this.run.skillOptions.length > 0;
    if (this.run.skillChoiceOpen) this.emit({ type: 'skill-offer', options: this.run.skillOptions, source });
    return this.run.skillOptions;
  }

  chooseSkill(skillId = null) {
    if (!this.run?.skillChoiceOpen) return false;
    const option = this.run.skillOptions.find((item) => item.id === skillId) ?? this.run.skillOptions[0];
    if (!option) return false;
    this.addTemporarySkill({ id: option.id, source: option.source });
    this.run.skillChoiceOpen = false;
    this.run.skillOptions = [];
    this.emit({ type: 'skill-selected', skill: option });
    return true;
  }

  activateExtraction(pointId = 'primary') {
    if (this.state !== RunState.ExtractionAvailable)
      throw new Error(`Cannot activate extraction from ${this.state}`);
    if (this.run.skillChoiceOpen) this.chooseSkill();
    const point = this.extraction?.begin(pointId);
    if (!point) throw new Error('Unknown extraction point: ' + pointId);
    this.run.extraction.active = true;
    this.run.extraction.progress = 0;
    this.run.extraction.duration = point.duration;
    this.run.extraction.nodeId = point.nodeId;
    this.transition(RunState.Extracting, 'extraction-started');
    this.recordNoise({
      kind: 'extraction',
      nodeId: point.nodeId,
      position: this.run.map.graph.getNode(point.nodeId)?.position,
      intensity: point.mode === 'noisy' ? 3.5 : 1.8,
      duration: point.duration,
    });
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
      const reward = 'field-clearance';
      if (!this.campaign.permanentUnlocks.includes(reward)) this.campaign.permanentUnlocks.push(reward);
      this.run.permanentRewards.push(reward);
      for (const item of this.run.inventory?.items ?? []) {
        if (item.quest) continue;
        this.campaign.stash[item.id] = (this.campaign.stash[item.id] ?? 0) + item.amount;
      }
    } else {
      const protectedItem = this.run.inventory?.items?.find((item) => item.protectedItem);
      if (protectedItem) {
        this.campaign.stash[protectedItem.id] = (this.campaign.stash[protectedItem.id] ?? 0) + 1;
      }
      this.run.temporarySkills = [];
      this.run.loot = [];
      if (this.run.inventory) this.run.inventory.items = [];
    }
    this.campaign.runHistory.unshift({
      status,
      reason,
      seed: this.run.config.seed.display,
      elapsedSeconds: this.run.elapsedSeconds,
      weapon: this.run.loadout.primaryWeapon,
      anomalyBand: this.run.anomalyBand,
      modules: this.run.visitedModules.length,
      events: this.run.stats.eventsResolved,
      stats: { ...this.run.stats },
      loot: status === 'success' ? [...this.run.loot] : [],
    });
    this.campaign.runHistory = this.campaign.runHistory.slice(0, 12);
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
            loadout: { ...this.run.loadout },
            weapon: this.run.weapon
              ? {
                  id: this.run.weapon.definition.id,
                  ammo: this.run.weapon.ammo,
                  reserve: this.run.weapon.reserve,
                }
              : null,
            elapsedSeconds: this.run.elapsedSeconds,
            performance: { ...this.run.performance },
            threat: this.run.threat,
            threatDirector: this.threatDirector?.snapshot?.() ?? null,
            anomaly: this.run.anomaly,
            anomalyBand: this.run.anomalyBand,
            watcher: this.watcher?.snapshot?.() ?? null,
            encounters: this.encounterDirector?.snapshot?.() ?? null,
            events: this.eventDirector?.snapshot?.() ?? [],
            loot: [...this.run.loot],
            stats: { ...this.run.stats },
            visitedModules: [...this.run.visitedModules],
            temporarySkills: [...this.run.temporarySkills],
            inventory: this.run.inventory?.toJSON?.() ?? null,
            skillOptions: [...this.run.skillOptions],
            skillChoiceOpen: this.run.skillChoiceOpen,
            extraction: { ...this.run.extraction },
            objective: this.run.objective,
            result: this.run.result,
          }
        : null,
    };
  }
}
