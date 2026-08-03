import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { RunConfig } from '../src/core/expedition/runTypes.js';
import { WorldGenerator } from '../src/expedition/worldGenerator.js';

const OUTPUT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/qa/expedition/seeds',
);
const scenarios = [
  { seed: 'short-linear', weapon: 'pistol', watcher: false },
  { seed: 'branching', weapon: 'rifle', watcher: false },
  { seed: 'underground', weapon: 'shotgun', watcher: false },
  { seed: 'weapon-cache', weapon: 'oblomok-7', watcher: false },
  { seed: 'watcher', weapon: 'rifle', watcher: true },
  { seed: 'high-threat', weapon: 'oblomok-7', watcher: true },
  { seed: 'low-loot', weapon: 'pistol', watcher: false },
  { seed: 'rich-loot', weapon: 'shotgun', watcher: false },
];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

for (const scenario of scenarios) {
  const generator = new WorldGenerator();
  const config = new RunConfig({
    seed: scenario.seed,
    primaryWeapon: scenario.weapon,
    watcher: scenario.watcher,
    testMode: false,
  });
  const world = generator.generate(config);
  const graph = world.graph.serialize();
  const mainPath = world.graph.shortestPath(graph.startNodeId, graph.extractionNodeId);
  const objectivePath = world.graph.shortestPath(graph.startNodeId, graph.objectiveNodeIds[0]);
  const modules = world.modules.map(({ instance, role }) => ({
    id: instance.id,
    moduleId: instance.moduleId,
    role,
    label: instance.definition.label,
    category: instance.definition.category,
    difficulty: instance.definition.difficulty,
    tags: [...instance.definition.tags],
    position: { ...instance.position },
  }));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scenario,
    generation: {
      seed: world.generationSeed,
      attempts: world.generationAttempts,
      validation: world.validation,
      timings: world.metadata?.timings ?? {},
    },
    summary: {
      modules: modules.length,
      mainPathLength: mainPath.length,
      objectivePathLength: objectivePath.length,
      branchCount: graph.branchNodeIds.length,
      lootContainers: world.lootContainers.length,
      enemyGroups: world.enemyGroups.length,
      watcherGroups: world.enemyGroups.filter((group) => group.archetype === 'watcher').length,
      events: world.events.length,
      obstacleCount: world.navigationMesh.snapshot().obstacleCount,
    },
    objective: world.objective,
    extraction: {
      primaryNodeId: world.extractionNodeId,
      alternativeNodeId: world.alternativeExtractionNodeId,
      primaryPath: mainPath,
      alternativePath: world.graph.shortestPath(graph.startNodeId, world.alternativeExtractionNodeId),
    },
    events: world.events.map(({ id, type, nodeId, optional }) => ({ id, type, nodeId, optional })),
    modules,
    graph,
    navigationMesh: world.navigationMesh.snapshot(),
    knownLimitations: [
      'This structural export does not claim a manual 20–30 minute balance session.',
      'Dynamic and rotated arbitrary geometry remain outside the authored axis-aligned navmesh profile.',
    ],
  };
  const output = await prettier.format(JSON.stringify(report), { parser: 'json', printWidth: 110 });
  await writeFile(path.join(OUTPUT_DIRECTORY, `${scenario.seed}.json`), output, 'utf8');
  world.dispose();
}

console.log(`Exported ${scenarios.length} expedition seed schemas to ${OUTPUT_DIRECTORY}`);
