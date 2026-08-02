export class ModuleInstance {
  constructor(definition, position, index) {
    this.id = `${definition.id}-${index}`;
    this.moduleId = definition.id;
    this.definition = definition;
    this.position = { x: position.x, y: position.y ?? 0, z: position.z };
    this.bounds = {
      minX: this.position.x + definition.bounds.minX,
      maxX: this.position.x + definition.bounds.maxX,
      minZ: this.position.z + definition.bounds.minZ,
      maxZ: this.position.z + definition.bounds.maxZ,
    };
  }

  worldPoint(localPoint) {
    return {
      x: this.position.x + localPoint.x,
      y: this.position.y + (localPoint.y ?? 0),
      z: this.position.z + localPoint.z,
    };
  }
}

export class WorldGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.startNodeId = null;
    this.objectiveNodeIds = [];
    this.extractionNodeId = null;
    this.branchNodeIds = [];
  }

  addNode(instance, role = 'route') {
    if (this.nodes.has(instance.id)) throw new Error(`Duplicate graph node: ${instance.id}`);
    this.nodes.set(instance.id, { instance, role });
    this.edges.set(instance.id, new Map());
    return instance.id;
  }

  connect(fromId, toId, metadata = {}) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId))
      throw new Error('Cannot connect missing graph nodes');
    if (fromId === toId) throw new Error('Cannot connect a graph node to itself');
    const edge = { from: fromId, to: toId, ...metadata };
    this.edges.get(fromId).set(toId, edge);
    this.edges.get(toId).set(fromId, {
      ...edge,
      from: toId,
      to: fromId,
      fromConnector: metadata.toConnector,
      toConnector: metadata.fromConnector,
    });
    return edge;
  }

  getNode(id) {
    return this.nodes.get(id)?.instance ?? null;
  }

  getNodeRecord(id) {
    return this.nodes.get(id) ?? null;
  }

  neighbors(id) {
    return [...(this.edges.get(id)?.keys() ?? [])];
  }

  edge(fromId, toId) {
    return this.edges.get(fromId)?.get(toId) ?? null;
  }

  shortestPath(fromId, toId) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return [];
    const queue = [fromId];
    const previous = new Map([[fromId, null]]);
    while (queue.length) {
      const current = queue.shift();
      if (current === toId) break;
      for (const next of this.neighbors(current)) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        queue.push(next);
      }
    }
    if (!previous.has(toId)) return [];
    const path = [];
    for (let node = toId; node; node = previous.get(node)) path.unshift(node);
    return path;
  }

  hasPath(fromId, toId) {
    return this.shortestPath(fromId, toId).length > 0;
  }

  degree(id) {
    return this.edges.get(id)?.size ?? 0;
  }

  serialize() {
    return {
      startNodeId: this.startNodeId,
      objectiveNodeIds: [...this.objectiveNodeIds],
      extractionNodeId: this.extractionNodeId,
      branchNodeIds: [...this.branchNodeIds],
      nodes: [...this.nodes.values()].map(({ instance, role }) => ({
        id: instance.id,
        moduleId: instance.moduleId,
        role,
        position: { ...instance.position },
        bounds: { ...instance.bounds },
      })),
      edges: [...this.nodes.keys()].flatMap((from) =>
        [...this.edges.get(from).values()]
          .filter((edge) => edge.from === from && from < edge.to)
          .map((edge) => ({
            from: edge.from,
            to: edge.to,
            fromConnector: edge.fromConnector,
            toConnector: edge.toConnector,
          })),
      ),
    };
  }
}
