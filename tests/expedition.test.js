import { describe, expect, it } from 'vitest';
import { GenerationContext, SeededRandom } from '../src/core/expedition/SeededRandom.js';
import { RunManager } from '../src/core/expedition/RunManager.js';
import { RunState } from '../src/core/expedition/runTypes.js';
import { LevelModuleRegistry } from '../src/expedition/levelModules.js';
import { WorldGenerator } from '../src/expedition/worldGenerator.js';
import { WorldValidator } from '../src/expedition/worldValidator.js';
import { ExtractionSystem } from '../src/expedition/extraction.js';
import { Inventory, Equipment } from '../src/expedition/inventory.js';
import { ObjectiveDirector } from '../src/expedition/objectives.js';
import { SpatialIndex, WorldAssembler } from '../src/expedition/worldRuntime.js';
import { NoiseSystem } from '../src/expedition/noise.js';
import { AnomalyBand, AnomalyLevel } from '../src/expedition/anomalyLevel.js';
import { WatcherDirector, WatcherState } from '../src/expedition/watcher.js';
import { ThreatDirector, ThreatPhase } from '../src/expedition/threatDirector.js';
import { WeaponController, WeaponRegistry } from '../src/expedition/weapons.js';
import { SkillRegistry } from '../src/expedition/skills.js';
import { SaveSystem } from '../src/expedition/saveSystem.js';
import { ItemRegistry, LootContainer } from '../src/expedition/loot.js';
import { InteractionSystem, Interactable } from '../src/expedition/interactions.js';
import { EventDirector } from '../src/expedition/events.js';
import { EncounterDirector } from '../src/expedition/encounters.js';
import { ConnectorAwarePlanner, NavigationAgent } from '../src/expedition/navigation.js';
import { ExpeditionNavMesh } from '../src/expedition/navMesh.js';
import * as THREE from 'three';
import { ThreeWorldAssembler } from '../src/expedition/threeWorldAssembler.js';

describe('seeded expedition generation', () => {
  it('keeps random streams reproducible and independent by name', () => {
    const left = new GenerationContext('e2e').stream('layout');
    const right = new GenerationContext('e2e').stream('layout');
    expect([left.next(), left.next(), left.next()]).toEqual([right.next(), right.next(), right.next()]);
    expect(new GenerationContext('e2e').stream('layout').next()).not.toBe(
      new GenerationContext('e2e').stream('loot').next(),
    );
    expect(new SeededRandom('e2e').shuffle([1, 2, 3])).toEqual(new SeededRandom('e2e').shuffle([1, 2, 3]));
  });

  it('has the complete authored module registry', () => {
    const registry = new LevelModuleRegistry();
    expect(registry.all()).toHaveLength(18);
    expect(registry.get('generator_room')).toMatchObject({
      category: 'objective',
      tags: expect.arrayContaining(['power']),
    });
    expect(registry.all().some((definition) => definition.obstacles.length > 0)).toBe(true);
    for (const definition of registry.all()) {
      expect(definition).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          size: expect.any(Object),
          connectors: expect.any(Array),
          bounds: expect.any(Object),
          spawnPoints: expect.any(Array),
          lootPoints: expect.any(Array),
          enemyPoints: expect.any(Array),
          objectivePoints: expect.any(Array),
          coverPoints: expect.any(Array),
          audioZones: expect.any(Array),
          lightZones: expect.any(Array),
          tags: expect.any(Array),
        }),
      );
    }
  });

  it('generates a valid reproducible graph with a branch and reachable extraction', () => {
    const generator = new WorldGenerator();
    const first = generator.generate({ seed: '12345' });
    const second = generator.generate({ seed: '12345' });
    const third = generator.generate({ seed: '54321' });
    expect(first.graph.serialize()).toEqual(second.graph.serialize());
    expect(first.graph.nodes.size).toBeGreaterThanOrEqual(10);
    expect(first.graph.nodes.size).toBeLessThanOrEqual(16);
    expect(first.graph.branchNodeIds.length).toBeGreaterThan(0);
    expect(first.graph.hasPath(first.graph.startNodeId, first.graph.objectiveNodeIds[0])).toBe(true);
    expect(first.graph.hasPath(first.graph.startNodeId, first.graph.extractionNodeId)).toBe(true);
    expect(first.navigation.main.nodes[0]).toBe(first.graph.startNodeId);
    expect(first.navigation.main.nodes.at(-1)).toBe(first.graph.extractionNodeId);
    expect(
      first.navigation.main.transitions.every(
        (transition) => transition.fromPosition && transition.toPosition,
      ),
    ).toBe(true);
    expect(
      new ConnectorAwarePlanner(first.graph).next(first.navigation.main, first.graph.startNodeId),
    ).toEqual(first.navigation.main.transitions[0]);
    const agent = new NavigationAgent(new ConnectorAwarePlanner(first.graph));
    agent.setTarget(first.graph.startNodeId, first.graph.extractionNodeId);
    const firstTransition = first.navigation.main.transitions[0];
    expect(
      agent.waypoint(first.graph.startNodeId, first.graph.getNode(first.graph.startNodeId).position),
    ).toMatchObject({ phase: 'exit', x: expect.any(Number), z: expect.any(Number) });
    expect(agent.waypoint(first.graph.startNodeId, firstTransition.fromPosition)).toMatchObject({
      phase: 'crossing',
    });
    expect(agent.waypoint(firstTransition.to, firstTransition.toPosition)?.phase ?? 'complete').toMatch(
      /crossing|exit|complete/,
    );
    expect(new WorldValidator().validate(first).valid).toBe(true);
    expect(first.graph.serialize()).not.toEqual(third.graph.serialize());
    expect(first.generationAttempts).toBeLessThanOrEqual(6);
    expect(first.navigationMesh.snapshot()).toMatchObject({
      nodeCount: first.graph.nodes.size,
      obstacleCount: expect.any(Number),
    });
    const meshSnapshot = first.navigationMesh.snapshot();
    expect(meshSnapshot.polygonCount).toBe(meshSnapshot.regionCount * 2);
    expect(meshSnapshot.obstacleCount).toBeGreaterThan(0);
    expect(first.navigationMesh.validateRoute(first.navigation.main)).toBe(true);
    const navigationMesh = new ExpeditionNavMesh(first.graph);
    expect(navigationMesh.nodeForPosition(first.graph.getNode(first.graph.startNodeId).position)).toBe(
      first.graph.startNodeId,
    );
    const meshAgent = new NavigationAgent(new ConnectorAwarePlanner(first.graph), navigationMesh);
    meshAgent.setTarget(first.graph.startNodeId, first.graph.extractionNodeId);
    expect(
      meshAgent.waypoint(first.graph.startNodeId, first.graph.getNode(first.graph.startNodeId).position),
    ).toMatchObject({ phase: 'local' });
    const obstacleNodeId = [...first.navigationMesh.obstacles.entries()].find(
      ([, obstacles]) => obstacles.length > 0,
    )?.[0];
    const obstacle = first.navigationMesh.obstacles.get(obstacleNodeId)?.[0];
    expect(obstacleNodeId).toBeTruthy();
    expect(
      first.navigationMesh.isWalkable({ x: obstacle.minX + 0.5, z: obstacle.minZ + 0.5 }, obstacleNodeId),
    ).toBe(false);
    const obstaclePath = first.navigationMesh.pathWithinNode(
      obstacleNodeId,
      { x: obstacle.minX - 2, z: obstacle.minZ - 2 },
      { x: obstacle.maxX + 2, z: obstacle.maxZ + 2 },
    );
    expect(obstaclePath.length).toBeGreaterThan(1);
    expect(obstaclePath.every((point) => first.navigationMesh.isWalkable(point, obstacleNodeId))).toBe(true);
    navigationMesh.dispose();
  });

  it('keeps logical world generation separate from an indexed assembly plan', () => {
    const world = new WorldGenerator().generate({ seed: 'assembly' });
    const assembled = new WorldAssembler().assemble(world);
    expect(assembled.modules).toHaveLength(world.modules.length);
    expect(assembled.colliders).toHaveLength(world.modules.length);
    expect(world.spatialIndex.nearest({ x: 0, z: 0 }, 20)?.moduleId).toBe('border_checkpoint');
    expect(world.spatialIndex.query({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }).length).toBeGreaterThan(0);
  });

  it('assembles and disposes a seed-dependent Three.js module scene', () => {
    const world = new WorldGenerator().generate({ seed: 'render-plan' });
    const scene = new THREE.Scene();
    const assembler = new ThreeWorldAssembler(scene);
    const result = assembler.assemble(world);
    expect(result.moduleCount).toBe(world.modules.length);
    expect(result.colliders.length).toBeGreaterThan(world.modules.length);
    expect(result.colliders.every((collider) => collider.height > 0)).toBe(true);
    expect(result.colliders.some((collider) => collider.tag.includes('burned-vehicle'))).toBe(true);
    expect(result.group.children.some((child) => child.userData.shootable)).toBe(true);
    expect(scene.getObjectByName('expeditionWorld')).toBeTruthy();
    assembler.dispose();
    expect(scene.getObjectByName('expeditionWorld')).toBeUndefined();
  });
});

describe('expedition run lifecycle', () => {
  function startedManager() {
    const manager = new RunManager();
    manager.start();
    manager.openHideout();
    manager.openLoadout();
    manager.beginRun({ seed: 'lifecycle', testMode: true });
    manager.deploy();
    return manager;
  }

  it('uses explicit states and does not end after five kills', () => {
    const manager = startedManager();
    expect(manager.state).toBe(RunState.Exploration);
    manager.recordKill(5);
    expect(manager.state).toBe(RunState.Exploration);
    manager.completeObjective();
    expect(manager.state).toBe(RunState.ExtractionAvailable);
  });

  it('restarts an active run through a fresh generated world without recording a fake result', () => {
    const manager = startedManager();
    const previousRun = manager.run;
    const previousMesh = previousRun.map.navigationMesh;
    expect(manager.restart('soak-restart')).toBe(true);
    expect(manager.state).toBe(RunState.Results);
    expect(manager.campaign.runHistory).toHaveLength(0);
    manager.returnToHideout();
    manager.openLoadout();
    manager.beginRun({ seed: 'lifecycle-restarted', testMode: true });
    manager.deploy();
    expect(manager.run).not.toBe(previousRun);
    expect(manager.run.map).not.toBe(previousRun.map);
    expect(previousMesh.snapshot().nodeCount).toBe(0);
    expect(manager.run.elapsedSeconds).toBe(0);
    expect(manager.state).toBe(RunState.Exploration);
  });

  it('succeeds only after the extraction timer completes', () => {
    const manager = startedManager();
    manager.completeObjective();
    manager.activateExtraction();
    expect(manager.state).toBe(RunState.Extracting);
    expect(manager.tickExtraction(1, true)).toBe(false);
    expect(manager.tickExtraction(2, true)).toBe(true);
    expect(manager.state).toBe(RunState.Results);
    expect(manager.run.result).toMatchObject({ status: 'success', seed: 'lifecycle' });
    expect(manager.campaign.completedRuns).toBe(1);
    expect(manager.campaign.runHistory[0]).toMatchObject({ status: 'success', seed: 'lifecycle' });
    expect(manager.run.temporarySkills).toHaveLength(1);
  });

  it('finishes a death as failure and preserves permanent campaign state only', () => {
    const manager = startedManager();
    manager.campaign.permanentUnlocks.push('sidearm-license');
    manager.addTemporarySkill({ id: 'quiet-step' });
    manager.playerDied('watcher');
    expect(manager.state).toBe(RunState.Results);
    expect(manager.run.result.status).toBe('failure');
    expect(manager.run.result.temporarySkills).toEqual([]);
    expect(manager.campaign.permanentUnlocks).toEqual(['sidearm-license']);
    expect(manager.campaign.completedRuns).toBe(0);
    expect(manager.campaign.runHistory[0]).toMatchObject({ status: 'failure', reason: 'watcher' });
  });

  it('keeps ordinary extracted resources and one protected artifact in campaign stash', () => {
    const success = startedManager();
    success.run.inventory.add({ id: 'rifle-ammo', type: 'ammo', amount: 4, maxStack: 30, weight: 0.02 });
    success.completeObjective();
    success.activateExtraction();
    success.tickExtraction(3, true);
    expect(success.campaign.stash['rifle-ammo']).toBeGreaterThan(0);

    const failure = startedManager();
    failure.run.inventory.add({
      id: 'artifact',
      type: 'artifact',
      amount: 1,
      maxStack: 1,
      weight: 1,
      protectedItem: true,
    });
    failure.playerDied('protected-item-test');
    expect(failure.campaign.stash.artifact).toBe(1);
  });

  it('stores the selected loadout and awards a permanent unlock on extraction', () => {
    const manager = new RunManager();
    manager.start();
    manager.openHideout();
    manager.openLoadout();
    manager.beginRun({ seed: 'loadout', testMode: true, primaryWeapon: 'rifle' });
    expect(manager.run.loadout.primaryWeapon).toBe('rifle');
    expect(manager.run.weapon.definition.id).toBe('rifle');
    manager.deploy();
    manager.completeObjective();
    manager.activateExtraction();
    manager.tickExtraction(3, true);
    expect(manager.campaign.permanentUnlocks).toContain('field-clearance');
  });

  it('offers three seeded skill choices and keeps the selected skill scoped to the run', () => {
    const manager = startedManager();
    manager.completeObjective();
    expect(manager.run.skillChoiceOpen).toBe(true);
    expect(manager.run.skillOptions).toHaveLength(3);
    const selected = manager.run.skillOptions[1].id;
    expect(manager.chooseSkill(selected)).toBe(true);
    expect(manager.run.skillChoiceOpen).toBe(false);
    expect(manager.run.temporarySkills[0].id).toBe(selected);
  });

  it('collects seeded container contents and consumes healing resources', () => {
    const manager = startedManager();
    const container = manager.run.map.lootContainers.find((item) => item.contents?.length);
    expect(container).toBeTruthy();
    const collected = manager.collectLoot(container.id);
    expect(collected.ok).toBe(true);
    expect(manager.run.inventory.items.length).toBeGreaterThan(0);
    expect(manager.collectLoot(container.id).ok).toBe(false);
    const healing = manager.useHealing('bandage');
    expect(healing).toMatchObject({ ok: true, amount: 20 });
    expect(manager.run.stats.healingUsed).toBe(1);
  });

  it('requires objective steps in order and supports an alternate extraction point', () => {
    const manager = startedManager();
    const firstStep = manager.run.objective.steps[0];
    expect(manager.completeObjectiveStep('wrong-step')).toBe(false);
    expect(manager.completeObjectiveStep(firstStep.id)).toBe(true);
    expect(manager.state).toBe(RunState.ObjectiveActive);
    manager.completeObjective();
    manager.activateExtraction('alternative');
    expect(manager.run.extraction.nodeId).toBe(manager.run.map.alternativeExtractionNodeId);
    expect(manager.run.extraction.duration).toBeLessThan(3);
  });
});

describe('expedition interaction services', () => {
  it('supports distance, line-of-sight and cancellable progress interactions', () => {
    let visible = true;
    let completed = 0;
    const interactions = new InteractionSystem({ lineOfSight: () => visible });
    interactions.register(
      new Interactable({
        id: 'generator',
        type: 'objective',
        position: { x: 0, z: 0 },
        label: 'Start generator',
        radius: 2,
        duration: 1,
        onInteract: () => {
          completed += 1;
          return true;
        },
      }),
    );
    expect(interactions.prompt({ x: 1, z: 0 }).available).toBe(true);
    expect(interactions.interact({ x: 1, z: 0 }).value).toBe('started');
    expect(interactions.tick(0.5, { x: 1, z: 0 }).value).toBe('progress');
    visible = false;
    expect(interactions.tick(0.1, { x: 1, z: 0 }).reason).toBe('cancelled');
    expect(completed).toBe(0);
    visible = true;
    expect(interactions.interact({ x: 1, z: 0 }).value).toBe('started');
    expect(interactions.tick(1, { x: 1, z: 0 }).ok).toBe(true);
    expect(completed).toBe(1);
  });

  it('defines typed loot items and protects quest pickups', () => {
    const registry = new ItemRegistry();
    const container = new LootContainer({
      id: 'quest-crate',
      nodeId: 'generator-room',
      position: { x: 0, z: 0 },
      contents: [{ id: 'fuel-pickup', itemId: 'fuel', amount: 1 }],
    });
    const preview = container.preview(registry);
    expect(preview[0]).toMatchObject({ id: 'fuel', quest: true });
    expect(container.open(registry)[0]).toMatchObject({ id: 'fuel', quest: true });
    expect(container.open(registry)).toEqual([]);
  });

  it('protects quest items and enforces inventory capacity', () => {
    const inventory = new Inventory({ capacity: 1, weightLimit: 2 });
    expect(inventory.add({ id: 'ammo-9mm', type: 'ammo', amount: 3, maxStack: 10, weight: 0.1 }).ok).toBe(
      true,
    );
    expect(inventory.add({ id: 'fuel', amount: 1, weight: 3 }).reason).toBe('capacity');
    const weightLimited = new Inventory({ capacity: 2, weightLimit: 2 });
    weightLimited.add({ id: 'ammo-9mm', amount: 3, maxStack: 10, weight: 0.1 });
    expect(weightLimited.add({ id: 'fuel', amount: 1, weight: 3 }).reason).toBe('weight');
    expect(inventory.add({ id: 'sample', amount: 1, weight: 0.2, quest: true }).ok).toBe(false);
    const questInventory = new Inventory({ capacity: 2, weightLimit: 2 });
    expect(questInventory.add({ id: 'sample', amount: 1, weight: 0.2, quest: true }).ok).toBe(true);
    expect(questInventory.drop('sample')).toMatchObject({ ok: false, reason: 'quest-item' });
  });

  it('switches equipped weapons without losing inventory ownership', () => {
    const equipment = new Equipment();
    expect(equipment.equip({ id: 'pistol' }, 'secondary')).toBe(true);
    expect(equipment.equip({ id: 'shotgun' }, 'primary')).toBe(true);
    expect(equipment.switchTo('secondary')).toBe(true);
    expect(equipment.active()).toMatchObject({ id: 'pistol' });
  });

  it('completes objective steps in order and resets extraction when leaving the zone', () => {
    const objective = new ObjectiveDirector({
      id: 'relay-test',
      title: 'Relay test',
      type: 'relay',
      steps: [
        { id: 'one', label: 'one', nodeId: 'a' },
        { id: 'two', label: 'two', nodeId: 'b' },
      ],
    });
    expect(objective.completeStep({ stepId: 'two', nodeId: 'b' })).toBe(false);
    expect(objective.completeStep({ stepId: 'one', nodeId: 'a' })).toBe(true);
    expect(objective.completeStep({ stepId: 'two', nodeId: 'a' })).toBe(false);
    expect(objective.completeStep({ stepId: 'two', nodeId: 'b' })).toBe(true);
    expect(objective.isComplete()).toBe(true);

    const extraction = new ExtractionSystem({
      testMode: true,
      points: [{ id: 'safe', nodeId: 'exit', duration: 30 }],
    });
    extraction.unlock();
    extraction.begin('safe');
    extraction.tick(1, { inside: true });
    expect(extraction.tick(1, { inside: false }).progress).toBe(0);
    expect(extraction.tick(3, { inside: true }).completed).toBe(true);
  });

  it('queries nearby entries through the spatial index without scanning the scene', () => {
    const index = new SpatialIndex(8);
    index.insert(
      'far',
      { minX: 80, maxX: 90, minZ: 80, maxZ: 90 },
      { id: 'far', position: { x: 85, z: 85 } },
    );
    index.insert('near', { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, { id: 'near', position: { x: 0, z: 0 } });
    expect(index.nearest({ x: 1, z: 1 }, 10)?.id).toBe('near');
    expect(index.query({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 }).map((item) => item.id)).toEqual(['near']);
  });

  it('propagates loud noise as an investigation without inventing exact player position', () => {
    const world = new WorldGenerator().generate({ seed: 'noise' });
    const source = world.graph.startNodeId;
    const target = world.graph.extractionNodeId;
    const noise = new NoiseSystem({ graph: world.graph });
    const quiet = noise.emit({ id: 'quiet', kind: 'movement', nodeId: source, intensity: 0.01, duration: 1 });
    expect(quiet.has(target)).toBe(false);
    const loud = noise.emit({ id: 'shot', kind: 'shot', nodeId: source, intensity: 4, duration: 2 });
    expect(loud.get(target)).toMatchObject({ approximate: true, position: null });
    expect(noise.investigate(target)?.event.kind).toBe('shot');
    noise.update(2);
    expect(noise.investigate(target)).toBe(null);
  });

  it('holds threat director safety rules and a finite encounter budget', () => {
    const director = new ThreatDirector({ seed: 'threat', maxEncounters: 1, recoveryDuration: 5 });
    director.setPlayer({ position: { x: 0, z: 0 }, nodeId: 'player' });
    const candidates = [
      { id: 'near', position: { x: 2, z: 0 }, nodeId: 'far', visible: false },
      { id: 'visible', position: { x: 20, z: 0 }, nodeId: 'far', visible: true },
      { id: 'safe', position: { x: 20, z: 0 }, nodeId: 'far', visible: false },
    ];
    expect(director.requestEncounter({ candidates })?.id).toBe('safe');
    expect(director.requestEncounter({ candidates })).toBe(null);
    director.startRecovery();
    expect(director.phase).toBe(ThreatPhase.Recovery);
    expect(director.requestEncounter({ candidates, force: false })).toBe(null);
    director.update(5);
    expect(director.phase).not.toBe(ThreatPhase.Recovery);
  });

  it('schedules a deterministic safe mid-run encounter from a dormant group', () => {
    const world = new WorldGenerator().generate({ seed: 'encounter-runtime' });
    const playerPosition = world.graph.getNode(world.graph.startNodeId).position;
    const makeDirector = () => {
      const threat = new ThreatDirector({ seed: 'encounter-runtime:threat', maxEncounters: 2 });
      threat.setPlayer({ position: playerPosition, nodeId: world.graph.startNodeId });
      const director = new EncounterDirector({
        groups: world.enemyGroups,
        graph: world.graph,
        threatDirector: threat,
        seed: 'encounter-runtime:encounters',
        testMode: true,
        activationDelay: 0,
      });
      director.claimInitialGroups(2, { playerPosition });
      return { director, threat };
    };
    const left = makeDirector();
    const right = makeDirector();
    left.threat.addThreat(42, 'objective-step');
    right.threat.addThreat(42, 'objective-step');
    const leftEvent = left.director.update(0.1, {
      threat: left.threat.threat,
      anomaly: 0,
      playerPosition,
      playerNodeId: world.graph.startNodeId,
    });
    const rightEvent = right.director.update(0.1, {
      threat: right.threat.threat,
      anomaly: 0,
      playerPosition,
      playerNodeId: world.graph.startNodeId,
    });
    expect(leftEvent).toMatchObject({ type: 'encounter-requested', trigger: 'threat-threshold' });
    expect(leftEvent.groupId).toBe(rightEvent.groupId);
    expect(left.director.snapshot().groups.find((group) => group.id === leftEvent.groupId)?.state).toBe(
      'pending',
    );
    expect(left.director.markSpawned(leftEvent.groupId, ['runtime-bot'])).toBe(true);
    expect(left.director.snapshot().groups.find((group) => group.id === leftEvent.groupId)).toMatchObject({
      state: 'spawned',
      spawnedBotIds: ['runtime-bot'],
    });
  });

  it('raises anomaly from noise and activates Watcher without teleporting', () => {
    const level = new AnomalyLevel({ decayPerSecond: 0 });
    level.add(72, 'shot');
    expect(level.band).toBe(AnomalyBand.Critical);
    const watcher = new WatcherDirector({ seed: 'watcher-test', activationAnomaly: 60 });
    watcher.registerCandidate({ id: 'watcher-1', nodeId: 'dark-zone', position: { x: 20, z: 0 } });
    watcher.update(0.1, { anomaly: level.value, playerPosition: { x: 0, z: 0 }, playerNodeId: 'start' });
    expect(watcher.state).toBe(WatcherState.Stalking);
    const initialPosition = watcher.position;
    watcher.update(1, { anomaly: 80, playerPosition: { x: 4, z: 0 }, playerNodeId: 'dark-zone' });
    expect(watcher.position).toEqual(initialPosition);
    expect(watcher.snapshot().lastReason).toBe('anomaly-threshold');
  });

  it('records runtime noise into threat, anomaly and run statistics', () => {
    const manager = new RunManager();
    manager.start();
    manager.openHideout();
    manager.openLoadout();
    manager.beginRun({ seed: 'noise-runtime', testMode: true });
    manager.deploy();
    const signals = manager.recordNoise({
      kind: 'shot',
      position: { x: 0, z: 0 },
      intensity: 2.8,
      duration: 2,
    });
    expect(signals.size).toBeGreaterThan(0);
    expect(manager.run.stats.noiseEvents).toBe(1);
    expect(manager.run.anomaly).toBeGreaterThan(0);
    expect(manager.run.threat).toBeGreaterThan(0);
    manager.tick(2, { playerPosition: { x: 0, z: 0 }, playerNodeId: manager.run.map.graph.startNodeId });
    expect(manager.noiseSystem.events.size).toBe(0);
  });

  it('resolves optional events into rewards without blocking the objective', () => {
    const manager = new RunManager();
    manager.start();
    manager.openHideout();
    manager.openLoadout();
    manager.beginRun({ seed: 'events', testMode: true });
    manager.deploy();
    const event = manager.run.map.events[0];
    expect(new EventDirector(manager.run.map.events).preview(event.id)).toBeTruthy();
    const result = manager.resolveEvent(event.id);
    expect(result.ok).toBe(true);
    expect(manager.run.stats.eventsResolved).toBe(1);
    expect(manager.run.eventDirector.get(event.id).resolved).toBe(true);
    expect(manager.resolveEvent(event.id).ok).toBe(false);
    expect(manager.state).toBe(RunState.Exploration);
  });

  it('provides four distinct weapon behaviors and twelve expiring temporary skills', () => {
    const weapons = new WeaponRegistry();
    expect(weapons.all()).toHaveLength(4);
    expect(weapons.get('rifle')).toMatchObject({ fireMode: 'auto', movementMultiplier: 0.92 });
    expect(weapons.get('oblomok-7').heatLimit).toBeGreaterThan(0);
    const shotgun = weapons.createState('shotgun', { ammo: 1, reserve: 8 });
    expect(shotgun.fire()).toMatchObject({ fired: true, pellets: 8 });
    expect(shotgun.startReload()).toBe(true);
    shotgun.tick(2.2);
    expect(shotgun.ammo).toBe(6);
    expect(new SkillRegistry().all()).toHaveLength(12);
    const controller = new WeaponController(weapons);
    controller.equip('oblomok-7', { ammo: 2, reserve: 2 });
    expect(controller.fire()).toMatchObject({ fired: true, damage: 42, noise: 2.8 });
    expect(controller.active.instability).toBe(8);
    const skill = new SkillRegistry().grant('quiet-step');
    skill.tick(skill.definition.duration);
    expect(skill.active).toBe(false);
  });

  it('round-trips versioned campaign state without persisting temporary run skills', () => {
    const storage = new Map();
    const adapter = {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) ?? null,
    };
    const save = new SaveSystem({ storage: adapter });
    const campaign = {
      completedRuns: 2,
      permanentUnlocks: ['shotgun'],
      stash: { ammo: 12 },
      bestTime: 42,
      runHistory: [{ status: 'success', seed: 'history', stats: { kills: 4 }, loot: [] }],
    };
    save.save(campaign);
    expect(save.load()).toMatchObject(campaign);
    expect(save.load(JSON.stringify({ version: 0, runs: 3, unlocks: ['pistol'] }))).toMatchObject({
      completedRuns: 3,
      permanentUnlocks: ['pistol'],
    });
    expect(save.load('{broken')).toMatchObject({ completedRuns: 0, permanentUnlocks: [] });
    expect(
      save.load(JSON.stringify({ version: 1, completedRuns: 4, permanentUnlocks: ['rifle'] })),
    ).toMatchObject({
      completedRuns: 4,
      permanentUnlocks: ['rifle'],
      runHistory: [],
    });
    expect(save.serialize({ temporarySkills: ['quiet-step'] })).not.toHaveProperty('temporarySkills');
    const exported = save.export(campaign);
    expect(save.import(exported)).toMatchObject(campaign);
    expect(save.reset()).toMatchObject({ completedRuns: 0, permanentUnlocks: [] });
  });
});
