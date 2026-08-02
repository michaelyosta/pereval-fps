import { GenerationContext, RunSeed } from '../core/expedition/SeededRandom.js';
import { RunConfig } from '../core/expedition/runTypes.js';
import { LevelModuleRegistry } from './levelModules.js';
import { ModuleInstance, WorldGraph } from './worldGraph.js';
import { WorldValidator } from './worldValidator.js';
import { GeneratedWorld } from './worldRuntime.js';
import { LootContainer } from './loot.js';
import { ConnectorAwarePlanner } from './navigation.js';

const TRANSIT_MODULES = [
  'container_terminal',
  'warehouse',
  'barracks',
  'admin_ruins',
  'watchtower',
  'repair_hangar',
  'technical_corridor',
  'underground_bunker',
  'dry_river',
];
const OPTIONAL_MODULES = ['hidden_cache', 'exposed_yard', 'horror_dark_zone'];
const EVENT_TYPES = [
  'armory',
  'rare-cache',
  'wounded-scout',
  'anomaly-nest',
  'blackout-room',
  'blocked-route',
  'ambush',
  'distress-signal',
];
const TEMPORARY_SKILLS = [
  'steady-hands',
  'field-medic',
  'scavenger',
  'quiet-step',
  'anomaly-sense',
  'fast-reload',
  'deep-breath',
  'route-memory',
  'hardcase',
  'low-profile',
  'signal-reader',
  'last-stand',
];

function itemForLoot(random, instance, point, objectiveType, index) {
  if (point.role === 'fuel') return { itemId: 'fuel', amount: 1 };
  if (point.role === 'fuse') return { itemId: 'fuse', amount: 1 };
  if (
    objectiveType === 'extract-sample' &&
    index === 0 &&
    ['field_laboratory', 'anomaly_site'].includes(instance.moduleId)
  )
    return { itemId: 'sample', amount: 1 };
  const itemId = random.pick([
    'rifle-ammo',
    'pistol-ammo',
    'shell',
    'medkit',
    'bandage',
    'weapon-part',
    'shelter-resource',
    'artifact',
  ]);
  const amount = ['rifle-ammo', 'pistol-ammo'].includes(itemId)
    ? random.int(5, 15)
    : itemId === 'shell'
      ? random.int(2, 6)
      : 1;
  return { itemId, amount };
}

function chooseWeighted(random, definitions, used) {
  const candidates = definitions.filter((definition) => !used.has(definition.id));
  if (!candidates.length) return definitions[random.int(0, definitions.length - 1)];
  const total = candidates.reduce((sum, item) => sum + Math.max(0.01, item.weight), 0);
  let cursor = random.next() * total;
  for (const candidate of candidates) {
    cursor -= Math.max(0.01, candidate.weight);
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

function chooseConnector(from, to) {
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  const fromDirection =
    Math.abs(dx) >= Math.abs(dz) ? { x: dx >= 0 ? 1 : -1, z: 0 } : { x: 0, z: dz >= 0 ? 1 : -1 };
  const toDirection = { x: -fromDirection.x, z: -fromDirection.z };
  const preferredFrom =
    from.definition.connectors.find(
      (item) => item.direction.x === fromDirection.x && item.direction.z === fromDirection.z && !item.blocked,
    ) ?? from.definition.connectors.find((item) => !item.blocked);
  const preferredTo =
    to.definition.connectors.find(
      (item) => item.direction.x === toDirection.x && item.direction.z === toDirection.z && !item.blocked,
    ) ?? to.definition.connectors.find((item) => !item.blocked);
  return { fromConnector: preferredFrom?.id, toConnector: preferredTo?.id };
}

function objectiveFor(random, nodes, forcedType = null) {
  const type = forcedType ?? random.pick(['restore-power', 'extract-sample', 'activate-relays']);
  if (type === 'restore-power') {
    const target = nodes.find(({ instance }) => instance.moduleId === 'generator_room');
    return {
      id: 'restore-power',
      title: 'Восстановить питание',
      type,
      nodeIds: [target.instance.id],
      steps: [
        { id: 'find-fuel', label: 'Найти топливо или предохранитель', nodeId: target.instance.id },
        { id: 'activate-generator', label: 'Активировать генератор', nodeId: target.instance.id },
        { id: 'hold-generator', label: 'Выдержать шумовой запуск', nodeId: target.instance.id },
      ],
      currentStep: 0,
      completed: false,
    };
  }
  if (type === 'extract-sample') {
    const targets = nodes.filter(({ instance }) =>
      ['field_laboratory', 'anomaly_site'].includes(instance.moduleId),
    );
    const target = targets[0];
    return {
      id: 'extract-sample',
      title: 'Извлечь образец',
      type,
      nodeIds: targets.map(({ instance }) => instance.id),
      steps: [
        { id: 'unlock-container', label: 'Разблокировать контейнер', nodeId: target.instance.id },
        { id: 'take-sample', label: 'Забрать образец', nodeId: target.instance.id },
        { id: 'stabilize-zone', label: 'Пережить изменение зоны', nodeId: target.instance.id },
      ],
      currentStep: 0,
      completed: false,
    };
  }
  const relayNodes = nodes
    .filter(
      ({ instance }) =>
        instance.definition.tags.includes('relay-capable') ||
        instance.definition.objectivePoints.some((item) => item.role === 'relay'),
    )
    .slice(0, 3);
  const selected = relayNodes.length >= 3 ? relayNodes : nodes.slice(1, 4);
  return {
    id: 'activate-relays',
    title: 'Активировать ретрансляторы',
    type,
    nodeIds: selected.map(({ instance }) => instance.id),
    steps: selected.map(({ instance }, index) => ({
      id: `relay-${index + 1}`,
      label: `Активировать ретранслятор ${index + 1}`,
      nodeId: instance.id,
    })),
    currentStep: 0,
    completed: false,
  };
}

export class WorldGenerator {
  constructor({
    registry = new LevelModuleRegistry(),
    validator = new WorldValidator(),
    maxAttempts = 6,
  } = {}) {
    this.registry = registry;
    this.validator = validator;
    this.maxAttempts = Math.max(1, maxAttempts);
    this.lastAttempts = [];
  }

  generate(input = {}) {
    const config = input instanceof RunConfig ? input : new RunConfig(input);
    const rootContext = new GenerationContext(RunSeed.from(config.seed));
    const maxAttempts = Math.min(config.maxGenerationAttempts, this.maxAttempts);
    this.lastAttempts = [];
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const world = this.buildAttempt(rootContext.fork(`world-attempt-${attempt}`), config, attempt);
      const validation = this.validator.validate(world);
      this.lastAttempts.push({ attempt, seed: world.generationSeed, validation });
      if (validation.valid) {
        world.validation = validation;
        world.generationAttempts = attempt + 1;
        return world;
      }
    }
    const reason = this.lastAttempts.at(-1)?.validation.errors.join('; ') ?? 'unknown generation failure';
    throw new Error(`Unable to generate a valid expedition after ${maxAttempts} attempts: ${reason}`);
  }

  buildAttempt(context, config, attempt) {
    const random = context.stream('layout');
    const graph = new WorldGraph();
    const used = new Set();
    const instances = [];
    const add = (moduleId, role, position) => {
      const definition = this.registry.get(moduleId);
      const instance = new ModuleInstance(definition, position, instances.length);
      graph.addNode(instance, role);
      instances.push({ instance, role });
      used.add(moduleId);
      return instance;
    };

    const start = add('border_checkpoint', 'start', { x: 0, z: 0 });
    const hub = add('central_courtyard', 'hub', { x: 24, z: 0 });
    graph.startNodeId = start.id;
    graph.connect(start.id, hub.id, chooseConnector(start, hub));

    const beforeObjectiveCount = random.int(3, 4);
    let previous = hub;
    const mainNodes = [start, hub];
    for (let index = 0; index < beforeObjectiveCount; index += 1) {
      const definition = chooseWeighted(
        random,
        TRANSIT_MODULES.map((id) => this.registry.get(id)),
        used,
      );
      const node = add(definition.id, 'main-route', { x: 48 + index * 24, z: 0 });
      graph.connect(previous.id, node.id, chooseConnector(previous, node));
      mainNodes.push(node);
      previous = node;
    }

    const objectiveType = random.pick(['restore-power', 'extract-sample', 'activate-relays']);
    const objectiveModuleId =
      objectiveType === 'restore-power'
        ? 'generator_room'
        : objectiveType === 'extract-sample'
          ? random.chance(0.55)
            ? 'field_laboratory'
            : 'anomaly_site'
          : 'technical_corridor';
    const objective = add(objectiveModuleId, 'objective', { x: 48 + beforeObjectiveCount * 24, z: 0 });
    graph.connect(previous.id, objective.id, chooseConnector(previous, objective));
    graph.objectiveNodeIds.push(objective.id);
    mainNodes.push(objective);
    previous = objective;

    const afterObjectiveCount = random.int(1, 2);
    for (let index = 0; index < afterObjectiveCount; index += 1) {
      const definition = chooseWeighted(
        random,
        TRANSIT_MODULES.map((id) => this.registry.get(id)),
        used,
      );
      const node = add(definition.id, 'return-route', { x: previous.position.x + 24, z: 0 });
      graph.connect(previous.id, node.id, chooseConnector(previous, node));
      mainNodes.push(node);
      previous = node;
    }

    const extraction = add('extraction_zone', 'extraction', { x: previous.position.x + 24, z: 0 });
    graph.connect(previous.id, extraction.id, chooseConnector(previous, extraction));
    graph.extractionNodeId = extraction.id;
    mainNodes.push(extraction);

    const branchStart = mainNodes[Math.min(2, mainNodes.length - 2)];
    const branchOneDefinition = chooseWeighted(
      random,
      OPTIONAL_MODULES.map((id) => this.registry.get(id)),
      used,
    );
    const branchOne = add(branchOneDefinition.id, 'branch', { x: branchStart.position.x, z: -24 });
    graph.connect(branchStart.id, branchOne.id, chooseConnector(branchStart, branchOne));
    graph.branchNodeIds.push(branchOne.id);
    const branchTwoDefinition = chooseWeighted(
      random,
      [
        this.registry.get('hidden_cache'),
        this.registry.get('exposed_yard'),
        this.registry.get('horror_dark_zone'),
      ],
      used,
    );
    const branchTwo = add(
      branchTwoDefinition.id,
      branchTwoDefinition.tags.includes('danger') || branchTwoDefinition.tags.includes('horror')
        ? 'danger-branch'
        : 'reward-branch',
      { x: branchStart.position.x + 24, z: -24 },
    );
    graph.connect(branchOne.id, branchTwo.id, chooseConnector(branchOne, branchTwo));
    graph.branchNodeIds.push(branchTwo.id);
    const shortcutTarget = mainNodes[Math.min(4, mainNodes.length - 2)];
    graph.connect(branchTwo.id, shortcutTarget.id, chooseConnector(branchTwo, shortcutTarget));

    const objectiveData = objectiveFor(random, instances, objectiveType);
    const lootContainers = instances.flatMap(({ instance }) =>
      instance.definition.lootPoints.map(
        (point, index) =>
          new LootContainer({
            id: `loot-${instance.id}-${index}`,
            nodeId: instance.id,
            position: instance.worldPoint(point),
            kind: random.pick(['crate', 'medical', 'weapon', 'rare']),
            secured: random.chance(0.25),
            contents: [itemForLoot(random, instance, point, objectiveType, index)],
          }),
      ),
    );
    const enemyGroups = instances.flatMap(({ instance }) =>
      instance.definition.enemyPoints.map((point, index) => ({
        id: `enemy-group-${instance.id}-${index}`,
        nodeId: instance.id,
        archetype: point.role === 'watcher' ? 'watcher' : random.pick(['soldier', 'stalker', 'anomaly']),
        count: point.role === 'watcher' ? 1 : random.int(1, 3),
        position: instance.worldPoint(point),
      })),
    );
    const eventCount = random.int(5, 7);
    const events = random
      .shuffle(EVENT_TYPES)
      .slice(0, eventCount)
      .map((type, index) => ({
        id: `event-${attempt}-${index}`,
        type,
        nodeId: instances[random.int(1, instances.length - 1)].instance.id,
        optional: true,
        resolved: false,
      }));
    const temporarySkills = random
      .shuffle(TEMPORARY_SKILLS)
      .slice(0, 3)
      .map((id, index) => ({ id, source: `reward-${index}`, acquired: false }));
    const alternativeExtraction =
      graph.branchNodeIds.find((id) => graph.getNode(id).definition.tags.includes('danger')) ??
      graph.branchNodeIds.at(-1);
    const planner = new ConnectorAwarePlanner(graph);
    const navigation = {
      main: planner.plan(start.id, extraction.id),
      objective: planner.plan(start.id, objective.id),
      alternativeExtraction: planner.plan(start.id, alternativeExtraction, { avoidDanger: false }),
    };
    return new GeneratedWorld({
      generationSeed: context.runSeed.display,
      graph,
      modules: instances,
      objective: objectiveData,
      extractionNodeId: extraction.id,
      alternativeExtractionNodeId: alternativeExtraction,
      lootContainers,
      enemyGroups,
      events,
      temporarySkills,
      navigation,
      startResources: lootContainers
        .filter((item) => item.nodeId === start.id)
        .slice(0, 3)
        .flatMap((container) =>
          container.contents.map((pickup) => ({ itemId: pickup.itemId, amount: pickup.amount })),
        ),
      metadata: {
        difficulty: config.difficulty,
        watcher: config.watcher,
        routeLength: graph.shortestPath(start.id, extraction.id).length,
      },
    });
  }
}
