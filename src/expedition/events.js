export const EVENT_DEFINITIONS = Object.freeze({
  armory: {
    label: 'Открыть закрытый оружейный склад',
    rewards: [
      { itemId: 'weapon-part', amount: 1 },
      { itemId: 'rifle-ammo', amount: 12 },
    ],
    threat: 4,
    anomaly: 0,
    noise: 1.8,
  },
  'rare-cache': {
    label: 'Осмотреть тайник с редкой добычей',
    rewards: [{ itemId: 'artifact', amount: 1 }],
    threat: 3,
    anomaly: 2,
    noise: 0.8,
  },
  'wounded-scout': {
    label: 'Проверить сигнал разведчика',
    rewards: [
      { itemId: 'bandage', amount: 1 },
      { itemId: 'shelter-resource', amount: 1 },
    ],
    threat: 2,
    anomaly: 0,
    noise: 0.6,
    skill: true,
  },
  'anomaly-nest': {
    label: 'Исследовать аномальное гнездо',
    rewards: [{ itemId: 'anomaly-charge', amount: 1 }],
    threat: 8,
    anomaly: 14,
    noise: 2.6,
  },
  'blackout-room': {
    label: 'Включить аварийное освещение',
    rewards: [{ itemId: 'fuse', amount: 1 }],
    threat: -6,
    anomaly: -4,
    noise: 1.2,
    recovery: true,
  },
  'blocked-route': {
    label: 'Проверить заблокированный путь',
    rewards: [{ itemId: 'shelter-resource', amount: 1 }],
    threat: 1,
    anomaly: 0,
    noise: 1.1,
  },
  ambush: {
    label: 'Пережить засаду',
    rewards: [{ itemId: 'medkit', amount: 1 }],
    threat: 10,
    anomaly: 3,
    noise: 3.2,
  },
  'distress-signal': {
    label: 'Ответить на временный сигнал бедствия',
    rewards: [{ itemId: 'pistol-ammo', amount: 10 }],
    threat: 5,
    anomaly: 2,
    noise: 2.2,
    skill: true,
  },
});

const EVENT_RUNTIME_OBSTACLES = Object.freeze({
  armory: Object.freeze({
    anchor: 'east',
    hw: 0.55,
    hd: 1.8,
    height: 2.6,
    rotation: 0,
    tag: 'event:armory-shutter',
  }),
  'blocked-route': Object.freeze({
    anchor: 'north',
    hw: 1.5,
    hd: 0.55,
    height: 2.4,
    rotation: Math.PI / 8,
    tag: 'event:blocked-route',
  }),
});

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function getEventDefinition(type) {
  const definition = EVENT_DEFINITIONS[type] ?? EVENT_DEFINITIONS['blocked-route'];
  const dynamicObstacle = EVENT_RUNTIME_OBSTACLES[type] ?? null;
  return dynamicObstacle ? { ...definition, dynamicObstacle: { ...dynamicObstacle } } : definition;
}

export function createEventObstacle(event, node) {
  const dynamicObstacle = getEventDefinition(event?.type).dynamicObstacle;
  if (!event?.id || !event?.nodeId || !node || !dynamicObstacle) return null;
  const bounds = node.bounds;
  const maxHw = Math.max(0.35, (bounds.maxX - bounds.minX) / 2 - 0.5);
  const maxHd = Math.max(0.35, (bounds.maxZ - bounds.minZ) / 2 - 0.5);
  const hw = Math.min(dynamicObstacle.hw, maxHw);
  const hd = Math.min(dynamicObstacle.hd, maxHd);
  let x = node.position.x;
  let z = node.position.z;
  if (dynamicObstacle.anchor === 'north') z = bounds.minZ + hd + 0.75;
  if (dynamicObstacle.anchor === 'south') z = bounds.maxZ - hd - 0.75;
  if (dynamicObstacle.anchor === 'west') x = bounds.minX + hw + 0.75;
  if (dynamicObstacle.anchor === 'east') x = bounds.maxX - hw - 0.75;
  return {
    id: event.dynamicObstacleId ?? `event-obstacle:${event.id}`,
    eventId: event.id,
    nodeId: event.nodeId,
    x: clamp(x, bounds.minX + hw, bounds.maxX - hw),
    z: clamp(z, bounds.minZ + hd, bounds.maxZ - hd),
    hw,
    hd,
    height: dynamicObstacle.height,
    rotation: dynamicObstacle.rotation,
    tag: dynamicObstacle.tag,
  };
}

export class EventDirector {
  constructor(events = []) {
    this.events = events.map((event) => ({
      ...event,
      resolved: event.resolved === true,
      definition: getEventDefinition(event.type),
      dynamicObstacleId:
        event.dynamicObstacleId ??
        (getEventDefinition(event.type).dynamicObstacle ? `event-obstacle:${event.id}` : null),
      dynamicObstacleActive:
        event.dynamicObstacleActive ??
        (!event.resolved && Boolean(getEventDefinition(event.type).dynamicObstacle)),
    }));
  }

  get(id) {
    return this.events.find((event) => event.id === id) ?? null;
  }

  available() {
    return this.events.filter((event) => !event.resolved);
  }

  preview(id) {
    const event = this.get(id);
    if (!event || event.resolved) return null;
    return {
      id: event.id,
      type: event.type,
      nodeId: event.nodeId,
      label: event.definition.label,
      rewards: event.definition.rewards.map((reward) => ({ ...reward })),
    };
  }

  resolve(id) {
    const event = this.get(id);
    if (!event || event.resolved) return null;
    event.resolved = true;
    return {
      ...event,
      rewards: event.definition.rewards.map((reward) => ({ ...reward })),
      threat: event.definition.threat,
      anomaly: event.definition.anomaly,
      noise: event.definition.noise,
      recovery: event.definition.recovery === true,
      skill: event.definition.skill === true,
    };
  }

  snapshot() {
    return this.events.map((event) => ({
      id: event.id,
      type: event.type,
      nodeId: event.nodeId,
      optional: event.optional,
      resolved: event.resolved,
      dynamicObstacleId: event.dynamicObstacleId,
      dynamicObstacleActive: event.dynamicObstacleActive,
    }));
  }
}
