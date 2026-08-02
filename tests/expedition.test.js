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
import { ThreatDirector, ThreatPhase } from '../src/expedition/threatDirector.js';
import { WeaponRegistry } from '../src/expedition/weapons.js';
import { SkillRegistry } from '../src/expedition/skills.js';
import { SaveSystem } from '../src/expedition/saveSystem.js';
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
    expect(new WorldValidator().validate(first).valid).toBe(true);
    expect(first.graph.serialize()).not.toEqual(third.graph.serialize());
    expect(first.generationAttempts).toBeLessThanOrEqual(6);
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
    expect(manager.run.temporarySkills).toEqual([]);
  });

  it('finishes a death as failure and preserves permanent campaign state only', () => {
    const manager = startedManager();
    manager.campaign.permanentUnlocks.push('sidearm-license');
    manager.addTemporarySkill({ id: 'quiet-step' });
    manager.playerDied('watcher');
    expect(manager.state).toBe(RunState.Results);
    expect(manager.run.result.status).toBe('failure');
    expect(manager.run.result.temporarySkills).toEqual([{ id: 'quiet-step' }]);
    expect(manager.campaign.permanentUnlocks).toEqual(['sidearm-license']);
    expect(manager.campaign.completedRuns).toBe(0);
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

  it('provides four distinct weapon behaviors and twelve expiring temporary skills', () => {
    const weapons = new WeaponRegistry();
    expect(weapons.all()).toHaveLength(4);
    const shotgun = weapons.createState('shotgun', { ammo: 1, reserve: 8 });
    expect(shotgun.fire()).toMatchObject({ fired: true, pellets: 8 });
    expect(shotgun.startReload()).toBe(true);
    shotgun.tick(2.2);
    expect(shotgun.ammo).toBe(6);
    expect(new SkillRegistry().all()).toHaveLength(12);
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
    const campaign = { completedRuns: 2, permanentUnlocks: ['shotgun'], stash: { ammo: 12 }, bestTime: 42 };
    save.save(campaign);
    expect(save.load()).toMatchObject(campaign);
    expect(save.load(JSON.stringify({ version: 0, runs: 3, unlocks: ['pistol'] }))).toMatchObject({
      completedRuns: 3,
      permanentUnlocks: ['pistol'],
    });
    expect(save.load('{broken')).toMatchObject({ completedRuns: 0, permanentUnlocks: [] });
    expect(save.serialize({ temporarySkills: ['quiet-step'] })).not.toHaveProperty('temporarySkills');
  });
});
