function point(x, z, role) {
  return { x, y: 0, z, role };
}

export class ModuleConnector {
  constructor({
    id,
    position,
    direction,
    width = 2,
    type = 'door',
    allowedCategories = [],
    blocked = false,
    playerTransition = null,
  }) {
    this.id = id;
    this.position = { ...position };
    this.direction = { ...direction };
    this.width = width;
    this.type = type;
    this.allowedCategories = [...allowedCategories];
    this.blocked = blocked;
    this.playerTransition = playerTransition ?? { ...position };
  }
}

export class LevelModuleDefinition {
  constructor({
    id,
    label,
    category,
    summary,
    size,
    weight = 1,
    difficulty = 1,
    connectors,
    bounds,
    spawnPoints = [],
    lootPoints = [],
    enemyPoints = [],
    objectivePoints = [],
    coverPoints = [],
    obstacles = [],
    audioZones = [],
    lightZones = [],
    tags = [],
  }) {
    this.id = id;
    this.label = label ?? id;
    this.category = category;
    this.summary = summary ?? '';
    this.size = { ...size };
    this.weight = weight;
    this.difficulty = difficulty;
    this.connectors = connectors.map((connector) =>
      connector instanceof ModuleConnector ? connector : new ModuleConnector(connector),
    );
    this.bounds = { ...bounds };
    this.spawnPoints = spawnPoints.map((item) => ({ ...item }));
    this.lootPoints = lootPoints.map((item) => ({ ...item }));
    this.enemyPoints = enemyPoints.map((item) => ({ ...item }));
    this.objectivePoints = objectivePoints.map((item) => ({ ...item }));
    this.coverPoints = coverPoints.map((item) => ({ ...item }));
    this.obstacles = obstacles.map((item) => ({ rotation: 0, height: 2.2, ...item }));
    this.audioZones = audioZones.map((item) => ({ ...item }));
    this.lightZones = lightZones.map((item) => ({ ...item }));
    this.tags = [...tags];
  }
}

export const LevelModule = LevelModuleDefinition;

const ALL_CATEGORIES = [
  'start',
  'hub',
  'industrial',
  'interior',
  'vertical',
  'technical',
  'underground',
  'objective',
  'outdoor',
  'extraction',
  'optional',
  'danger',
  'horror',
];

function connector(id, x, z, dx, dz, type = 'door', allowedCategories = ALL_CATEGORIES) {
  return new ModuleConnector({
    id,
    position: { x, y: 0, z },
    direction: { x: dx, z: dz },
    width: 2,
    type,
    allowedCategories,
    playerTransition: { x: x + dx * 1.4, y: 0, z: z + dz * 1.4 },
  });
}

function obstacle(x, z, hw, hd, tag = 'cover', height = 2.2) {
  return { x, z, hw, hd, tag, height, rotation: 0 };
}

function moduleDefinition(options) {
  const { size } = options;
  return new LevelModuleDefinition({
    ...options,
    bounds: options.bounds ?? { minX: -size.x / 2, maxX: size.x / 2, minZ: -size.z / 2, maxZ: size.z / 2 },
    spawnPoints: options.spawnPoints ?? [point(0, 0, 'entry')],
    lootPoints: options.lootPoints ?? [point(-size.x * 0.2, -size.z * 0.15, 'cache')],
    enemyPoints: options.enemyPoints ?? [point(size.x * 0.2, size.z * 0.15, 'guard')],
    objectivePoints: options.objectivePoints ?? [],
    coverPoints: options.coverPoints ?? [point(0, 0, 'cover')],
    audioZones: options.audioZones ?? [
      { x: 0, z: 0, radius: Math.max(size.x, size.z) * 0.45, absorption: 0.1 },
    ],
    lightZones: options.lightZones ?? [
      { x: 0, z: 0, radius: Math.max(size.x, size.z) * 0.4, intensity: 0.8 },
    ],
  });
}

export class LevelModuleRegistry {
  constructor(definitions = createDefaultModules()) {
    this.definitions = new Map();
    definitions.forEach((definition) => this.register(definition));
  }

  register(definition) {
    if (!(definition instanceof LevelModuleDefinition))
      throw new TypeError('Expected a LevelModuleDefinition');
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate level module: ${definition.id}`);
    this.definitions.set(definition.id, definition);
    return this;
  }

  get(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown level module: ${id}`);
    return definition;
  }

  all() {
    return [...this.definitions.values()];
  }
}

export function createDefaultModules() {
  return [
    moduleDefinition({
      id: 'border_checkpoint',
      label: 'Стартовый пограничный блокпост',
      category: 'start',
      summary: 'Старая КПП с укрытым входом и ящиком первичных ресурсов.',
      size: { x: 14, z: 12 },
      difficulty: 1,
      tags: ['start', 'resource', 'safe'],
      connectors: [connector('east', 7, 0, 1, 0), connector('north', 0, -6, 0, -1)],
    }),
    moduleDefinition({
      id: 'central_courtyard',
      label: 'Центральный двор',
      category: 'hub',
      summary: 'Перекрёсток маршрутов с простреливаемыми линиями и редкими укрытиями.',
      size: { x: 18, z: 16 },
      difficulty: 2,
      tags: ['hub', 'branch', 'combat'],
      connectors: [
        connector('west', -9, 0, -1, 0),
        connector('east', 9, 0, 1, 0),
        connector('north', 0, -8, 0, -1),
        connector('south', 0, 8, 0, 1),
      ],
      objectivePoints: [point(0, -2, 'relay')],
      lootPoints: [point(-5, 4, 'supply'), point(5, -4, 'supply')],
      obstacles: [obstacle(-3, 1.5, 1.1, 0.9, 'burned-vehicle'), obstacle(3, -1.5, 1.1, 0.9, 'crate-stack')],
    }),
    moduleDefinition({
      id: 'container_terminal',
      label: 'Контейнерный терминал',
      category: 'industrial',
      summary: 'Ряды контейнеров, создающие короткие разрывы видимости.',
      size: { x: 16, z: 14 },
      difficulty: 2,
      tags: ['industrial', 'cover', 'loot'],
      connectors: [
        connector('west', -8, 0, -1, 0),
        connector('east', 8, 0, 1, 0),
        connector('south', 0, 7, 0, 1),
      ],
      lootPoints: [point(-5, -4, 'container'), point(4, 4, 'container')],
      coverPoints: [point(-3, 0, 'container'), point(3, 0, 'container')],
      obstacles: [obstacle(-3, 0, 1.1, 1.4, 'container-row'), obstacle(3, 0, 1.1, 1.4, 'container-row')],
    }),
    moduleDefinition({
      id: 'warehouse',
      label: 'Склад',
      category: 'industrial',
      summary: 'Заваленный склад с ресурсами, шумными дверями и опасными углами.',
      size: { x: 15, z: 13 },
      difficulty: 2,
      tags: ['industrial', 'loot', 'noise'],
      connectors: [
        connector('west', -7.5, 0, -1, 0),
        connector('east', 7.5, 0, 1, 0),
        connector('north', 0, -6.5, 0, -1),
      ],
      lootPoints: [point(-4, -3, 'supply'), point(4, 2, 'ammo')],
      audioZones: [{ x: 0, z: 0, radius: 7, absorption: 0.05 }],
      obstacles: [obstacle(0, 1.5, 1.5, 0.8, 'collapsed-shelf')],
    }),
    moduleDefinition({
      id: 'barracks',
      label: 'Казарма',
      category: 'interior',
      summary: 'Тесные комнаты и личные шкафчики, где можно найти лечение.',
      size: { x: 13, z: 11 },
      difficulty: 2,
      tags: ['interior', 'medical', 'close'],
      connectors: [
        connector('west', -6.5, 0, -1, 0),
        connector('east', 6.5, 0, 1, 0),
        connector('south', 0, 5.5, 0, 1),
      ],
      lootPoints: [point(-3, -2, 'locker'), point(3, 2, 'medical')],
      objectivePoints: [point(0, 0, 'room')],
      lightZones: [{ x: 0, z: 0, radius: 5, intensity: 0.5 }],
    }),
    moduleDefinition({
      id: 'admin_ruins',
      label: 'Разрушенное административное здание',
      category: 'interior',
      summary: 'Открытые проломы и документы, меняющие контекст задачи.',
      size: { x: 17, z: 12 },
      difficulty: 3,
      tags: ['interior', 'story', 'cover'],
      connectors: [
        connector('west', -8.5, 0, -1, 0),
        connector('east', 8.5, 0, 1, 0),
        connector('north', 0, -6, 0, -1),
      ],
      lootPoints: [point(5, -2, 'desk')],
      objectivePoints: [point(-2, 1, 'terminal')],
      coverPoints: [point(2, 3, 'rubble')],
      obstacles: [obstacle(-3.5, -3, 1.2, 0.8, 'rubble-wall')],
    }),
    moduleDefinition({
      id: 'watchtower',
      label: 'Сторожевая вышка',
      category: 'vertical',
      summary: 'Подъём с обзором, но почти без укрытий на верхней площадке.',
      size: { x: 12, z: 12 },
      difficulty: 3,
      tags: ['vertical', 'high-risk', 'scouting'],
      connectors: [
        connector('west', -6, 0, -1, 0),
        connector('east', 6, 0, 1, 0),
        connector('south', 0, 6, 0, 1),
      ],
      enemyPoints: [point(0, 0, 'tower'), point(3, -2, 'tower')],
      objectivePoints: [point(0, -1, 'relay')],
    }),
    moduleDefinition({
      id: 'repair_hangar',
      label: 'Ремонтный ангар',
      category: 'industrial',
      summary: 'Большой ангар с техникой, редкими деталями и гулким шумом.',
      size: { x: 20, z: 15 },
      difficulty: 3,
      tags: ['industrial', 'large', 'resource'],
      connectors: [
        connector('west', -10, 0, -1, 0),
        connector('east', 10, 0, 1, 0),
        connector('north', 0, -7.5, 0, -1),
      ],
      lootPoints: [point(-6, 3, 'parts'), point(6, -3, 'weapon')],
      objectivePoints: [point(0, 0, 'machine')],
      audioZones: [{ x: 0, z: 0, radius: 10, absorption: 0.02 }],
      obstacles: [obstacle(-4, 0.5, 1.5, 1, 'repair-bench'), obstacle(4, 0.5, 1.5, 1, 'repair-bench')],
    }),
    moduleDefinition({
      id: 'technical_corridor',
      label: 'Технический коридор',
      category: 'technical',
      summary: 'Связующий узел с аварийными дверями и коротким обходным путём.',
      size: { x: 11, z: 8 },
      difficulty: 2,
      tags: ['technical', 'shortcut', 'relay-capable'],
      connectors: [
        connector('west', -5.5, 0, -1, 0),
        connector('east', 5.5, 0, 1, 0),
        connector('north', 0, -4, 0, -1),
        connector('south', 0, 4, 0, 1),
      ],
      objectivePoints: [point(0, 0, 'relay')],
    }),
    moduleDefinition({
      id: 'underground_bunker',
      label: 'Подземный бункер',
      category: 'underground',
      summary: 'Низкий бетонный бункер с ценным лутом и плохой слышимостью.',
      size: { x: 14, z: 13 },
      difficulty: 4,
      tags: ['underground', 'rare-loot', 'dark'],
      connectors: [
        connector('west', -7, 0, -1, 0),
        connector('east', 7, 0, 1, 0),
        connector('north', 0, -6.5, 0, -1),
      ],
      lootPoints: [point(-3, -3, 'rare'), point(3, 2, 'rare')],
      enemyPoints: [point(0, 0, 'ambush')],
      lightZones: [{ x: 0, z: 0, radius: 4, intensity: 0.18 }],
      audioZones: [{ x: 0, z: 0, radius: 6, absorption: 0.75 }],
    }),
    moduleDefinition({
      id: 'generator_room',
      label: 'Генераторная',
      category: 'objective',
      summary: 'Основной силовой узел: топливо, предохранитель и громкий запуск.',
      size: { x: 15, z: 14 },
      difficulty: 3,
      tags: ['objective', 'power', 'noise'],
      connectors: [
        connector('west', -7.5, 0, -1, 0),
        connector('east', 7.5, 0, 1, 0),
        connector('south', 0, 7, 0, 1),
      ],
      objectivePoints: [point(0, 0, 'generator'), point(-3, 2, 'fuel')],
      lootPoints: [point(-4, -3, 'fuel'), point(4, -2, 'fuse')],
    }),
    moduleDefinition({
      id: 'field_laboratory',
      label: 'Полевая лаборатория',
      category: 'objective',
      summary: 'Изолированная лаборатория с контейнером аномального образца.',
      size: { x: 16, z: 14 },
      difficulty: 4,
      tags: ['objective', 'sample', 'anomaly'],
      connectors: [
        connector('west', -8, 0, -1, 0),
        connector('east', 8, 0, 1, 0),
        connector('north', 0, -7, 0, -1),
      ],
      objectivePoints: [point(0, 0, 'sample'), point(3, -2, 'console')],
      lootPoints: [point(-4, 3, 'medical')],
      obstacles: [obstacle(-4, -3, 1, 1, 'sealed-cabinet')],
    }),
    moduleDefinition({
      id: 'dry_river',
      label: 'Высохшее русло',
      category: 'outdoor',
      summary: 'Открытый низкий маршрут с быстрым переходом и плохим укрытием.',
      size: { x: 22, z: 12 },
      difficulty: 3,
      tags: ['outdoor', 'shortcut', 'open'],
      connectors: [
        connector('west', -11, 0, -1, 0),
        connector('east', 11, 0, 1, 0),
        connector('north', 0, -6, 0, -1),
      ],
      objectivePoints: [point(-4, 0, 'relay')],
      coverPoints: [point(0, -2, 'bank')],
    }),
    moduleDefinition({
      id: 'anomaly_site',
      label: 'Аномальная площадка',
      category: 'objective',
      summary: 'Нестабильная площадка с искажённым светом и изменяющейся угрозой.',
      size: { x: 18, z: 17 },
      difficulty: 5,
      tags: ['objective', 'sample', 'anomaly', 'high-threat'],
      connectors: [
        connector('west', -9, 0, -1, 0),
        connector('east', 9, 0, 1, 0),
        connector('south', 0, 8.5, 0, 1),
      ],
      objectivePoints: [point(0, 0, 'anomaly-core')],
      enemyPoints: [point(-4, -3, 'anomaly'), point(4, 3, 'anomaly')],
      obstacles: [obstacle(0, 4, 1.5, 0.8, 'anomaly-rubble')],
    }),
    moduleDefinition({
      id: 'extraction_zone',
      label: 'Эвакуационная зона',
      category: 'extraction',
      summary: 'Площадка с устройством удержания и двумя вариантами подхода.',
      size: { x: 16, z: 15 },
      difficulty: 3,
      tags: ['extraction', 'objective', 'finale'],
      connectors: [
        connector('west', -8, 0, -1, 0),
        connector('north', 0, -7.5, 0, -1),
        connector('south', 0, 7.5, 0, 1),
      ],
      objectivePoints: [point(0, 0, 'extraction-device')],
      lootPoints: [point(-4, 3, 'last-supply')],
      obstacles: [obstacle(4, -3, 1, 0.8, 'barrier')],
    }),
    moduleDefinition({
      id: 'hidden_cache',
      label: 'Скрытый тайник',
      category: 'optional',
      summary: 'Короткий тупик с редкой наградой и слабым освещением.',
      size: { x: 10, z: 9 },
      difficulty: 3,
      tags: ['optional', 'rare-loot', 'dead-end'],
      connectors: [connector('south', 0, 4.5, 0, 1)],
      lootPoints: [point(0, -1, 'rare')],
      objectivePoints: [point(0, -2, 'cache')],
      lightZones: [{ x: 0, z: 0, radius: 3, intensity: 0.25 }],
    }),
    moduleDefinition({
      id: 'exposed_yard',
      label: 'Опасное открытое пространство',
      category: 'danger',
      summary: 'Прямая видимость, редкое укрытие и высокая вероятность засады.',
      size: { x: 20, z: 18 },
      difficulty: 5,
      tags: ['danger', 'open', 'ambush'],
      connectors: [
        connector('west', -10, 0, -1, 0),
        connector('east', 10, 0, 1, 0),
        connector('north', 0, -9, 0, -1),
      ],
      enemyPoints: [point(-5, 0, 'ambush'), point(5, 0, 'ambush')],
      coverPoints: [point(0, 0, 'burned-vehicle')],
      obstacles: [obstacle(0, 2.5, 2, 1, 'burned-vehicle')],
    }),
    moduleDefinition({
      id: 'horror_dark_zone',
      label: 'Тесная хоррор-зона',
      category: 'horror',
      summary: 'Слабый свет, глухие проходы и место для непредсказуемой встречи.',
      size: { x: 12, z: 10 },
      difficulty: 5,
      tags: ['horror', 'watcher', 'dark', 'optional'],
      connectors: [connector('west', -6, 0, -1, 0), connector('east', 6, 0, 1, 0)],
      enemyPoints: [point(0, 0, 'watcher')],
      lightZones: [{ x: 0, z: 0, radius: 2.5, intensity: 0.08 }],
      audioZones: [{ x: 0, z: 0, radius: 5, absorption: 0.9 }],
    }),
  ];
}
