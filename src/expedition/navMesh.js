const DEFAULT_AGENT_RADIUS = 0.35;
const DEFAULT_CLEARANCE = 0.2;

function cellKey(x, z) {
  return `${x}:${z}`;
}

function clonePoint(point) {
  return { x: point.x, z: point.z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pointInTriangle(point, [a, b, c]) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNegative = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
  const hasPositive = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
  return !(hasNegative && hasPositive);
}

function insetBounds(bounds, inset) {
  return {
    minX: bounds.minX + inset,
    maxX: bounds.maxX - inset,
    minZ: bounds.minZ + inset,
    maxZ: bounds.maxZ - inset,
  };
}

function connectorFor(graph, nodeId, connectorId) {
  return graph.getNode(nodeId)?.definition?.connectors?.find((item) => item.id === connectorId) ?? null;
}

function connectorWorldPosition(instance, connector) {
  return instance.worldPoint(connector.playerTransition ?? connector.position);
}

function connectorDirection(connector) {
  const length = Math.hypot(connector.direction.x, connector.direction.z) || 1;
  return { x: connector.direction.x / length, z: connector.direction.z / length };
}

export class NavMeshPolygon {
  constructor({ id, nodeId, vertices, bounds }) {
    this.id = id;
    this.nodeId = nodeId;
    this.vertices = vertices.map(clonePoint);
    this.bounds = { ...bounds };
  }

  contains(point) {
    return pointInTriangle(point, this.vertices);
  }
}

export class ExpeditionNavMesh {
  constructor(
    graph,
    { agentRadius = DEFAULT_AGENT_RADIUS, clearance = DEFAULT_CLEARANCE, cellSize = 16 } = {},
  ) {
    this.graph = graph;
    this.agentRadius = Math.max(0, agentRadius);
    this.clearance = Math.max(0, clearance);
    this.cellSize = Math.max(1, cellSize);
    this.polygons = new Map();
    this.nodeBounds = new Map();
    this.portals = new Map();
    this.cells = new Map();
    this.build();
  }

  build() {
    if (!this.graph) return this;
    for (const [nodeId, record] of this.graph.nodes) {
      const bounds = insetBounds(record.instance.bounds, this.agentRadius + this.clearance);
      if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) continue;
      this.nodeBounds.set(nodeId, bounds);
      const a = { x: bounds.minX, z: bounds.minZ };
      const b = { x: bounds.maxX, z: bounds.minZ };
      const c = { x: bounds.maxX, z: bounds.maxZ };
      const d = { x: bounds.minX, z: bounds.maxZ };
      this.polygons.set(nodeId, [
        new NavMeshPolygon({ id: `${nodeId}:north-east`, nodeId, vertices: [a, b, c], bounds }),
        new NavMeshPolygon({ id: `${nodeId}:south-west`, nodeId, vertices: [a, c, d], bounds }),
      ]);
      this.insertNode(nodeId, bounds);
    }

    for (const [fromId, neighbors] of this.graph.edges ?? []) {
      for (const [toId, edge] of neighbors) {
        const from = this.graph.getNode(fromId);
        const to = this.graph.getNode(toId);
        const fromConnector = connectorFor(this.graph, fromId, edge.fromConnector);
        const toConnector = connectorFor(this.graph, toId, edge.toConnector);
        if (!from || !to || !fromConnector || !toConnector) continue;
        const fromPosition = connectorWorldPosition(from, fromConnector);
        const toPosition = connectorWorldPosition(to, toConnector);
        const fromDirection = connectorDirection(fromConnector);
        const toDirection = connectorDirection(toConnector);
        const insideDistance = 1.4 + this.agentRadius + this.clearance;
        this.portals.set(`${fromId}>${toId}`, {
          from: fromId,
          to: toId,
          fromConnector: fromConnector.id,
          toConnector: toConnector.id,
          type: fromConnector.type,
          fromPosition,
          toPosition,
          fromInside: {
            x: fromPosition.x - fromDirection.x * insideDistance,
            z: fromPosition.z - fromDirection.z * insideDistance,
          },
          toInside: {
            x: toPosition.x - toDirection.x * insideDistance,
            z: toPosition.z - toDirection.z * insideDistance,
          },
        });
      }
    }
    return this;
  }

  insertNode(nodeId, bounds) {
    const minX = Math.floor(bounds.minX / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minZ = Math.floor(bounds.minZ / this.cellSize);
    const maxZ = Math.floor(bounds.maxZ / this.cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const key = cellKey(x, z);
        if (!this.cells.has(key)) this.cells.set(key, new Set());
        this.cells.get(key).add(nodeId);
      }
    }
  }

  candidateNodes(point) {
    const x = Math.floor(point.x / this.cellSize);
    const z = Math.floor(point.z / this.cellSize);
    const result = new Set();
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const nodeId of this.cells.get(cellKey(x + dx, z + dz)) ?? []) result.add(nodeId);
      }
    }
    return result;
  }

  nodeForPosition(point) {
    if (!point) return null;
    const candidates = this.candidateNodes(point);
    for (const nodeId of candidates) {
      if (this.isWalkable(point, nodeId)) return nodeId;
    }
    let nearest = null;
    let nearestDistance = Infinity;
    for (const nodeId of candidates) {
      const bounds = this.nodeBounds.get(nodeId);
      if (!bounds) continue;
      const x = Math.max(bounds.minX, Math.min(point.x, bounds.maxX));
      const z = Math.max(bounds.minZ, Math.min(point.z, bounds.maxZ));
      const candidateDistance = Math.hypot(point.x - x, point.z - z);
      if (candidateDistance < nearestDistance) {
        nearest = nodeId;
        nearestDistance = candidateDistance;
      }
    }
    return nearest;
  }

  isWalkable(point, nodeId = this.nodeForPosition(point)) {
    if (!point || !nodeId) return false;
    return (this.polygons.get(nodeId) ?? []).some((polygon) => polygon.contains(point));
  }

  portal(fromId, toId) {
    return this.portals.get(`${fromId}>${toId}`) ?? null;
  }

  waypointsForTransition(transition) {
    const portal = this.portal(transition.from, transition.to);
    if (!portal) return [];
    return [
      { ...portal.fromInside, phase: 'local', transition },
      { ...portal.fromPosition, phase: 'exit', transition },
      { ...portal.toPosition, phase: 'crossing', transition },
      { ...portal.toInside, phase: 'entry', transition },
    ];
  }

  waypointsForRoute(route, startPosition = null, targetPosition = null) {
    if (!route?.transitions?.length) return targetPosition ? [clonePoint(targetPosition)] : [];
    const points = [];
    for (const transition of route.transitions) {
      for (const point of this.waypointsForTransition(transition)) {
        if (!points.length || distance(points.at(-1), point) > 0.01) points.push(point);
      }
    }
    if (targetPosition && (!points.length || distance(points.at(-1), targetPosition) > 0.01))
      points.push(clonePoint(targetPosition));
    if (startPosition && points.length && distance(startPosition, points[0]) <= 0.01) points.shift();
    return points;
  }

  validateRoute(route) {
    if (!route?.nodes?.length) return false;
    if (route.nodes.some((nodeId) => !this.polygons.has(nodeId))) return false;
    return (route.transitions ?? []).every((transition) =>
      Boolean(this.portal(transition.from, transition.to)),
    );
  }

  snapshot() {
    return {
      agentRadius: this.agentRadius,
      clearance: this.clearance,
      polygonCount: [...this.polygons.values()].reduce((count, polygons) => count + polygons.length, 0),
      nodeCount: this.nodeBounds.size,
      portalCount: this.portals.size,
      indexedCellCount: this.cells.size,
    };
  }

  dispose() {
    this.polygons.clear();
    this.nodeBounds.clear();
    this.portals.clear();
    this.cells.clear();
  }
}
