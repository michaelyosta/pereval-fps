import {
  createObstacleGeometry,
  obstacleCorners,
  pointInsideObstacle,
  segmentIntersectsObstacle,
} from './obstacleGeometry.js';

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

function obstacleBounds(instance, obstacle, inset) {
  return createObstacleGeometry(obstacle, instance.worldPoint(obstacle), inset);
}

function isAxisAlignedObstacle(obstacle) {
  return (
    Math.abs(Math.sin(obstacle.rotation ?? 0)) <= 1e-6 || Math.abs(Math.cos(obstacle.rotation ?? 0)) <= 1e-6
  );
}

function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function splitRectangle(rect, obstacle) {
  if (!overlaps(rect, obstacle)) return [rect];
  const minX = Math.max(rect.minX, obstacle.minX);
  const maxX = Math.min(rect.maxX, obstacle.maxX);
  const minZ = Math.max(rect.minZ, obstacle.minZ);
  const maxZ = Math.min(rect.maxZ, obstacle.maxZ);
  const pieces = [];
  if (minX > rect.minX) pieces.push({ ...rect, maxX: minX });
  if (maxX < rect.maxX) pieces.push({ ...rect, minX: maxX });
  if (minZ > rect.minZ) pieces.push({ minX, maxX, minZ: rect.minZ, maxZ: minZ });
  if (maxZ < rect.maxZ) pieces.push({ minX, maxX, minZ: maxZ, maxZ: rect.maxZ });
  return pieces.filter((piece) => piece.minX < piece.maxX && piece.minZ < piece.maxZ);
}

function distanceToRect(point, rect) {
  const x = Math.max(rect.minX, Math.min(point.x, rect.maxX));
  const z = Math.max(rect.minZ, Math.min(point.z, rect.maxZ));
  return Math.hypot(point.x - x, point.z - z);
}

function segmentClear(start, end, bounds, obstacles) {
  if (
    start.x < bounds.minX ||
    start.x > bounds.maxX ||
    start.z < bounds.minZ ||
    start.z > bounds.maxZ ||
    end.x < bounds.minX ||
    end.x > bounds.maxX ||
    end.z < bounds.minZ ||
    end.z > bounds.maxZ ||
    obstacles.some((obstacle) => segmentIntersectsObstacle(start, end, obstacle))
  )
    return false;
  const length = distance(start, end);
  const steps = Math.max(1, Math.ceil(length / 0.25));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const point = {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    };
    if (point.x < bounds.minX || point.x > bounds.maxX || point.z < bounds.minZ || point.z > bounds.maxZ)
      return false;
  }
  return true;
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
    this.regions = new Map();
    this.obstacles = new Map();
    this.dynamicObstacles = new Map();
    this.dynamicObstacleRecords = new Map();
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
      const obstacleRects = (record.instance.definition.obstacles ?? []).map((obstacle) =>
        obstacleBounds(record.instance, obstacle, this.agentRadius + this.clearance),
      );
      let regions = [bounds];
      for (const obstacle of obstacleRects.filter(isAxisAlignedObstacle))
        regions = regions.flatMap((region) => splitRectangle(region, obstacle));
      this.obstacles.set(nodeId, obstacleRects);
      this.regions.set(nodeId, regions);
      this.polygons.set(
        nodeId,
        regions.flatMap((region, index) => {
          const a = { x: region.minX, z: region.minZ };
          const b = { x: region.maxX, z: region.minZ };
          const c = { x: region.maxX, z: region.maxZ };
          const d = { x: region.minX, z: region.maxZ };
          return [
            new NavMeshPolygon({
              id: `${nodeId}:${index}:north-east`,
              nodeId,
              vertices: [a, b, c],
              bounds: region,
            }),
            new NavMeshPolygon({
              id: `${nodeId}:${index}:south-west`,
              nodeId,
              vertices: [a, c, d],
              bounds: region,
            }),
          ];
        }),
      );
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
      for (const region of this.regions.get(nodeId) ?? []) {
        const candidateDistance = distanceToRect(point, region);
        if (candidateDistance < nearestDistance) {
          nearest = nodeId;
          nearestDistance = candidateDistance;
        }
      }
    }
    return nearest;
  }

  isWalkable(point, nodeId = this.nodeForPosition(point)) {
    if (!point || !nodeId) return false;
    return (
      (this.polygons.get(nodeId) ?? []).some((polygon) => polygon.contains(point)) &&
      !this.obstaclesForNode(nodeId).some((obstacle) => pointInsideObstacle(point, obstacle))
    );
  }

  obstaclesForNode(nodeId) {
    return [
      ...(this.obstacles.get(nodeId) ?? []),
      ...[...(this.dynamicObstacles.get(nodeId)?.values() ?? [])],
    ];
  }

  setDynamicObstacle(id, nodeId, obstacle) {
    if (!id || !nodeId || !this.nodeBounds.has(nodeId) || !obstacle) return null;
    this.removeDynamicObstacle(id);
    const source = { ...obstacle };
    const geometry = createObstacleGeometry(
      source,
      { x: source.x, z: source.z },
      this.agentRadius + this.clearance,
    );
    const record = { id, nodeId, source, ...geometry, dynamic: true };
    if (!this.dynamicObstacles.has(nodeId)) this.dynamicObstacles.set(nodeId, new Map());
    this.dynamicObstacles.get(nodeId).set(id, record);
    this.dynamicObstacleRecords.set(id, record);
    return { ...record, source: { ...source } };
  }

  updateDynamicObstacle(id, patch = {}) {
    const current = this.dynamicObstacleRecords.get(id);
    if (!current) return null;
    return this.setDynamicObstacle(id, patch.nodeId ?? current.nodeId, {
      ...current.source,
      ...patch,
    });
  }

  removeDynamicObstacle(id) {
    const current = this.dynamicObstacleRecords.get(id);
    if (!current) return false;
    this.dynamicObstacles.get(current.nodeId)?.delete(id);
    if (this.dynamicObstacles.get(current.nodeId)?.size === 0) this.dynamicObstacles.delete(current.nodeId);
    this.dynamicObstacleRecords.delete(id);
    return true;
  }

  clearDynamicObstacles(nodeId = null) {
    const ids = nodeId
      ? [...(this.dynamicObstacles.get(nodeId)?.keys() ?? [])]
      : [...this.dynamicObstacleRecords.keys()];
    for (const id of ids) this.removeDynamicObstacle(id);
    return ids.length;
  }

  pathWithinNode(nodeId, start, target) {
    const bounds = this.nodeBounds.get(nodeId);
    const obstacles = this.obstaclesForNode(nodeId);
    if (!bounds || !start || !target) return target ? [clonePoint(target)] : [];
    if (segmentClear(start, target, bounds, obstacles)) return [clonePoint(target)];

    const points = [clonePoint(start), clonePoint(target)];
    const cornerOffset = 0.12;
    for (const obstacle of obstacles) {
      const corners = obstacleCorners(obstacle, cornerOffset);
      for (const corner of corners) {
        if (
          corner.x > bounds.minX &&
          corner.x < bounds.maxX &&
          corner.z > bounds.minZ &&
          corner.z < bounds.maxZ &&
          !obstacles.some((other) => pointInsideObstacle(corner, other, 0.01))
        )
          points.push(corner);
      }
    }

    const costs = new Map([[0, 0]]);
    const previous = new Map();
    const queue = [{ index: 0, cost: 0 }];
    while (queue.length) {
      queue.sort((left, right) => left.cost - right.cost || left.index - right.index);
      const current = queue.shift();
      if (current.index === 1) break;
      if (current.cost !== costs.get(current.index)) continue;
      for (let next = 0; next < points.length; next += 1) {
        if (next === current.index || !segmentClear(points[current.index], points[next], bounds, obstacles))
          continue;
        const nextCost = current.cost + distance(points[current.index], points[next]);
        if (nextCost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, nextCost);
        previous.set(next, current.index);
        queue.push({ index: next, cost: nextCost });
      }
    }
    if (!costs.has(1)) return [clonePoint(target)];
    const path = [];
    for (let index = 1; index !== undefined; index = previous.get(index))
      path.unshift(clonePoint(points[index]));
    return path;
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
    return (route.transitions ?? []).every((transition) => {
      const portal = this.portal(transition.from, transition.to);
      return Boolean(
        portal &&
        this.isWalkable(portal.fromInside, transition.from) &&
        this.isWalkable(portal.toInside, transition.to),
      );
    });
  }

  snapshot() {
    const obstacles = [...this.obstacles.values()].flat();
    const dynamicObstacles = [...this.dynamicObstacleRecords.values()];
    return {
      agentRadius: this.agentRadius,
      clearance: this.clearance,
      polygonCount: [...this.polygons.values()].reduce((count, polygons) => count + polygons.length, 0),
      regionCount: [...this.regions.values()].reduce((count, regions) => count + regions.length, 0),
      obstacleCount: obstacles.length,
      rotatedObstacleCount: obstacles.filter((obstacle) => !isAxisAlignedObstacle(obstacle)).length,
      dynamicObstacleCount: dynamicObstacles.length,
      dynamicRotatedObstacleCount: dynamicObstacles.filter((obstacle) => !isAxisAlignedObstacle(obstacle))
        .length,
      nodeCount: this.nodeBounds.size,
      portalCount: this.portals.size,
      indexedCellCount: this.cells.size,
    };
  }

  dispose() {
    this.polygons.clear();
    this.regions.clear();
    this.obstacles.clear();
    this.dynamicObstacles.clear();
    this.dynamicObstacleRecords.clear();
    this.nodeBounds.clear();
    this.portals.clear();
    this.cells.clear();
  }
}
