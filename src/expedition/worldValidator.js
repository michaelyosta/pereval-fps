import { connectorRouteIsValid } from './navigation.js';

function boundsOverlap(a, b, padding = 0.25) {
  return (
    a.minX < b.maxX - padding &&
    a.maxX > b.minX + padding &&
    a.minZ < b.maxZ - padding &&
    a.maxZ > b.minZ + padding
  );
}

function findConnector(instance, id) {
  return instance.definition.connectors.find((connector) => connector.id === id) ?? null;
}

function obstacleOverlapsPoint(obstacle, point, margin = 0.35) {
  return (
    Math.abs(point.x - obstacle.x) < obstacle.hw + margin &&
    Math.abs(point.z - obstacle.z) < obstacle.hd + margin
  );
}

export class WorldValidator {
  validate(world) {
    const errors = [];
    const graph = world?.graph;
    if (!graph || graph.nodes.size === 0) errors.push('graph is empty');
    if (graph && !graph.startNodeId) errors.push('missing start node');
    if (graph && !graph.extractionNodeId) errors.push('missing extraction node');

    if (
      graph?.startNodeId &&
      graph?.extractionNodeId &&
      !graph.hasPath(graph.startNodeId, graph.extractionNodeId)
    ) {
      errors.push('extraction is unreachable');
    }

    const objectiveIds = graph?.objectiveNodeIds ?? [];
    if (!objectiveIds.length) errors.push('missing objective node');
    if (graph?.startNodeId && objectiveIds.some((id) => !graph.hasPath(graph.startNodeId, id))) {
      errors.push('objective is unreachable');
    }
    if (graph?.startNodeId && graph?.extractionNodeId) {
      const routeLength = graph.shortestPath(graph.startNodeId, graph.extractionNodeId).length;
      if (routeLength < 5) errors.push('main route is too short');
    }

    for (const [name, route] of Object.entries(world?.navigation ?? {})) {
      if (!route || !connectorRouteIsValid(graph, route)) errors.push(`invalid connector route: ${name}`);
      if (world?.navigationMesh && !world.navigationMesh.validateRoute(route))
        errors.push(`invalid navigation mesh route: ${name}`);
    }

    if (graph && ![...graph.nodes.keys()].some((id) => graph.degree(id) > 2))
      errors.push('graph has no branch');
    if (graph) {
      const nodes = [...graph.nodes.values()].map(({ instance }) => instance);
      for (let index = 0; index < nodes.length; index += 1) {
        for (let other = index + 1; other < nodes.length; other += 1) {
          if (boundsOverlap(nodes[index].bounds, nodes[other].bounds)) {
            errors.push(`module bounds overlap: ${nodes[index].id}/${nodes[other].id}`);
          }
        }
      }

      for (const [fromId, neighbors] of graph.edges) {
        for (const edge of neighbors.values()) {
          if (edge.from !== fromId || fromId > edge.to) continue;
          const from = graph.getNode(fromId);
          const to = graph.getNode(edge.to);
          const fromConnector = findConnector(from, edge.fromConnector);
          const toConnector = findConnector(to, edge.toConnector);
          if (!fromConnector || !toConnector)
            errors.push(`edge has invalid connectors: ${fromId}/${edge.to}`);
          if (fromConnector?.blocked || toConnector?.blocked)
            errors.push(`edge uses blocked connector: ${fromId}/${edge.to}`);
          if (fromConnector && toConnector && fromConnector.type !== toConnector.type)
            errors.push(`connector type mismatch: ${fromId}/${edge.to}`);
        }
      }

      for (const { instance } of graph.nodes.values()) {
        const definition = instance.definition;
        for (const obstacle of definition.obstacles ?? []) {
          if (
            obstacle.hw <= 0 ||
            obstacle.hd <= 0 ||
            obstacle.x - obstacle.hw < definition.bounds.minX ||
            obstacle.x + obstacle.hw > definition.bounds.maxX ||
            obstacle.z - obstacle.hd < definition.bounds.minZ ||
            obstacle.z + obstacle.hd > definition.bounds.maxZ
          ) {
            errors.push(`obstacle outside module bounds: ${definition.id}/${obstacle.tag ?? 'obstacle'}`);
          }
        }
        const points = [
          ...definition.spawnPoints,
          ...definition.lootPoints,
          ...definition.enemyPoints,
          ...definition.objectivePoints,
        ];
        for (const item of points) {
          if (
            item.x < definition.bounds.minX ||
            item.x > definition.bounds.maxX ||
            item.z < definition.bounds.minZ ||
            item.z > definition.bounds.maxZ
          ) {
            errors.push(`point outside module bounds: ${definition.id}/${item.role ?? 'point'}`);
          } else if ((definition.obstacles ?? []).some((obstacle) => obstacleOverlapsPoint(obstacle, item))) {
            errors.push(`point inside obstacle: ${definition.id}/${item.role ?? 'point'}`);
          }
        }
      }
    }

    const lootCount = world?.lootContainers?.length ?? 0;
    const enemyCount = world?.enemyGroups?.length ?? 0;
    if (lootCount < 1) errors.push('missing starting resources');
    if (graph && enemyCount > graph.nodes.size * 3) errors.push('enemy density is too high');
    if (graph && lootCount > graph.nodes.size * 4) errors.push('loot density is too high');

    return { valid: errors.length === 0, errors };
  }
}
