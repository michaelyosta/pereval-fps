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

export function getEventDefinition(type) {
  return EVENT_DEFINITIONS[type] ?? EVENT_DEFINITIONS['blocked-route'];
}

export class EventDirector {
  constructor(events = []) {
    this.events = events.map((event) => ({
      ...event,
      resolved: event.resolved === true,
      definition: getEventDefinition(event.type),
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
    }));
  }
}
