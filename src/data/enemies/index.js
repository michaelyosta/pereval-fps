export const ENEMY_DEFINITIONS = {
  soldier: {
    id: 'soldier',
    name: 'Вооружённый солдат',
    health: 100,
    speed: 1.6,
    palette: 0,
    role: 'ranged',
    attackRange: 45,
    damage: 8,
    tags: ['patrol', 'cover', 'burst-fire'],
  },
  stalker: {
    id: 'stalker',
    name: 'Быстрое существо',
    health: 65,
    speed: 3.2,
    palette: 2,
    role: 'melee',
    attackRange: 2.3,
    damage: 12,
    tags: ['fast', 'close-range', 'ambush'],
  },
  anomaly: {
    id: 'anomaly',
    name: 'Аномальный стрелок',
    health: 140,
    speed: 1.05,
    palette: 3,
    role: 'telegraph-ranged',
    attackRange: 38,
    damage: 18,
    chargeSeconds: 0.8,
    tags: ['telegraph', 'ranged', 'anomalous'],
  },
  watcher: {
    id: 'watcher',
    name: 'Watcher',
    health: 180,
    speed: 2.2,
    palette: 2,
    role: 'watcher',
    attackRange: 2.8,
    damage: 24,
    tags: ['unique', 'stalker', 'anomalous', 'no-teleport'],
  },
};

export function getEnemyDefinition(id = 'soldier') {
  return ENEMY_DEFINITIONS[id] ?? ENEMY_DEFINITIONS.soldier;
}
