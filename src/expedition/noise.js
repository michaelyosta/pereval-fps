export class NoiseEvent {
  constructor({
    id,
    kind = 'movement',
    nodeId,
    position = null,
    intensity = 1,
    duration = 1,
    visualContact = false,
  }) {
    this.id = id;
    this.kind = kind;
    this.nodeId = nodeId;
    this.position = position ? { ...position } : null;
    this.intensity = Math.max(0, intensity);
    this.duration = Math.max(0, duration);
    this.remaining = this.duration;
    this.visualContact = visualContact;
  }
}

function moduleAbsorption(node) {
  return Math.max(
    0,
    Math.min(1, node?.definition?.audioZones?.reduce((sum, zone) => sum + (zone.absorption ?? 0), 0) ?? 0),
  );
}

export class NoiseSystem {
  constructor({ graph = null, hearingThreshold = 0.08 } = {}) {
    this.graph = graph;
    this.hearingThreshold = hearingThreshold;
    this.events = new Map();
    this.listeners = new Set();
  }

  onInvestigation(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(rawEvent) {
    const event = rawEvent instanceof NoiseEvent ? rawEvent : new NoiseEvent(rawEvent);
    this.events.set(event.id, event);
    const signals = this.propagate(event);
    for (const [nodeId, signal] of signals) {
      for (const listener of this.listeners) listener({ event, nodeId, ...signal });
    }
    return signals;
  }

  propagate(event) {
    if (!this.graph?.nodes?.has(event.nodeId)) return new Map();
    const queue = [{ nodeId: event.nodeId, intensity: event.intensity, hops: 0 }];
    const best = new Map();
    while (queue.length) {
      const current = queue.shift();
      if (current.intensity < this.hearingThreshold) continue;
      if ((best.get(current.nodeId)?.intensity ?? 0) >= current.intensity) continue;
      best.set(current.nodeId, {
        intensity: current.intensity,
        approximate: !event.visualContact || current.nodeId !== event.nodeId,
        position: event.visualContact && current.nodeId === event.nodeId ? event.position : null,
      });
      for (const next of this.graph.neighbors(current.nodeId)) {
        const nextNode = this.graph.getNode(next);
        const attenuation = 0.72 * (1 - moduleAbsorption(nextNode) * 0.75);
        queue.push({ nodeId: next, intensity: current.intensity * attenuation, hops: current.hops + 1 });
      }
    }
    return best;
  }

  investigate(nodeId) {
    const candidates = [];
    for (const event of this.events.values()) {
      const signal = this.propagate(event).get(nodeId);
      if (signal) candidates.push({ event, ...signal });
    }
    candidates.sort((left, right) => right.intensity - left.intensity);
    return candidates[0] ?? null;
  }

  update(seconds) {
    for (const [id, event] of this.events) {
      event.remaining -= Math.max(0, seconds);
      if (event.remaining <= 0) this.events.delete(id);
    }
  }
}
