function connectorFor(instance, id) {
  return instance?.definition?.connectors?.find((connector) => connector.id === id) ?? null;
}

function connectorWorldPosition(instance, connector) {
  return connector ? instance.worldPoint(connector.playerTransition ?? connector.position) : null;
}

function edgeAllowed(graph, fromId, toId) {
  const edge = graph.edge(fromId, toId);
  if (!edge) return false;
  const from = graph.getNode(fromId);
  const to = graph.getNode(toId);
  const fromConnector = connectorFor(from, edge.fromConnector);
  const toConnector = connectorFor(to, edge.toConnector);
  if (!fromConnector || !toConnector || fromConnector.blocked || toConnector.blocked) return false;
  if (fromConnector.type !== toConnector.type) return false;
  if (
    fromConnector.allowedCategories.length &&
    !fromConnector.allowedCategories.includes(to.definition.category)
  )
    return false;
  if (
    toConnector.allowedCategories.length &&
    !toConnector.allowedCategories.includes(from.definition.category)
  )
    return false;
  return true;
}

function edgeCost(graph, fromId, toId, { avoidDanger = false } = {}) {
  const node = graph.getNode(toId);
  const difficulty = node?.definition?.difficulty ?? 1;
  const tags = node?.definition?.tags ?? [];
  const dangerPenalty = avoidDanger && (tags.includes('danger') || tags.includes('horror')) ? 8 : 0;
  return 1 + difficulty * 0.15 + dangerPenalty;
}

export class ConnectorAwarePlanner {
  constructor(graph) {
    this.graph = graph;
  }

  transition(fromId, toId) {
    if (!this.graph || !edgeAllowed(this.graph, fromId, toId)) return null;
    const edge = this.graph.edge(fromId, toId);
    const from = this.graph.getNode(fromId);
    const to = this.graph.getNode(toId);
    const fromConnector = connectorFor(from, edge.fromConnector);
    const toConnector = connectorFor(to, edge.toConnector);
    return {
      from: fromId,
      to: toId,
      fromConnector: fromConnector.id,
      toConnector: toConnector.id,
      type: fromConnector.type,
      distance: Math.hypot(to.position.x - from.position.x, to.position.z - from.position.z),
      fromPosition: connectorWorldPosition(from, fromConnector),
      toPosition: connectorWorldPosition(to, toConnector),
    };
  }

  plan(fromId, toId, options = {}) {
    if (!this.graph?.getNode(fromId) || !this.graph?.getNode(toId)) return null;
    const distances = new Map([[fromId, 0]]);
    const previous = new Map();
    const queue = [{ id: fromId, cost: 0 }];
    while (queue.length) {
      queue.sort((left, right) => left.cost - right.cost || left.id.localeCompare(right.id));
      const current = queue.shift();
      if (current.id === toId) break;
      if (current.cost !== distances.get(current.id)) continue;
      for (const nextId of [...this.graph.neighbors(current.id)].sort()) {
        if (!edgeAllowed(this.graph, current.id, nextId)) continue;
        const nextCost = current.cost + edgeCost(this.graph, current.id, nextId, options);
        if (nextCost >= (distances.get(nextId) ?? Infinity)) continue;
        distances.set(nextId, nextCost);
        previous.set(nextId, current.id);
        queue.push({ id: nextId, cost: nextCost });
      }
    }
    if (!distances.has(toId)) return null;
    const nodes = [];
    for (let id = toId; id; id = previous.get(id) ?? null) nodes.unshift(id);
    const transitions = [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const transition = this.transition(nodes[index], nodes[index + 1]);
      if (!transition) return null;
      transitions.push(transition);
    }
    return {
      from: fromId,
      to: toId,
      nodes,
      transitions,
      cost: distances.get(toId),
      distance: transitions.reduce((sum, item) => sum + item.distance, 0),
      nextNodeId: nodes[1] ?? null,
      nextConnector: transitions[0]?.fromConnector ?? null,
    };
  }

  next(route, currentNodeId) {
    if (!route?.nodes?.length) return null;
    const index = route.nodes.indexOf(currentNodeId);
    if (index < 0 || index >= route.nodes.length - 1) return null;
    return route.transitions[index] ?? null;
  }
}

export class NavigationAgent {
  constructor(planner, navigationMesh = null) {
    this.planner = planner;
    this.navigationMesh = navigationMesh;
    this.route = null;
    this.currentNodeId = null;
    this.targetNodeId = null;
    this.transitionIndex = 0;
    this.crossingIndex = null;
    this.localWaypointIndex = 0;
    this.localPath = null;
    this.localPathTransition = null;
  }

  setTarget(currentNodeId, targetNodeId) {
    if (this.route && this.currentNodeId === currentNodeId && this.targetNodeId === targetNodeId)
      return this.route;
    this.currentNodeId = currentNodeId;
    this.targetNodeId = targetNodeId;
    this.transitionIndex = 0;
    this.crossingIndex = null;
    this.localWaypointIndex = 0;
    this.localPath = null;
    this.localPathTransition = null;
    this.route =
      currentNodeId && targetNodeId && currentNodeId !== targetNodeId
        ? (this.planner?.plan(currentNodeId, targetNodeId) ?? null)
        : null;
    return this.route;
  }

  waypoint(currentNodeId, position, radius = 0.85) {
    if (!this.route) return null;
    this.currentNodeId = currentNodeId;
    while (this.transitionIndex < this.route.transitions.length) {
      const transition = this.route.transitions[this.transitionIndex];
      if (currentNodeId === transition.to) {
        this.transitionIndex += 1;
        this.crossingIndex = null;
        this.localWaypointIndex = 0;
        this.localPath = null;
        this.localPathTransition = null;
        continue;
      }
      if (currentNodeId !== transition.from) return null;
      const localWaypoints = this.navigationMesh?.waypointsForTransition?.(transition) ?? null;
      if (localWaypoints?.length) {
        if (this.localPathTransition !== transition || !this.localPath) {
          const localPath = this.navigationMesh?.pathWithinNode?.(
            currentNodeId,
            position,
            localWaypoints[0],
          ) ?? [localWaypoints[0]];
          this.localPath = localPath
            .map((point) => ({ ...point, phase: 'local', transition }))
            .concat(localWaypoints.slice(1));
          this.localPathTransition = transition;
          this.localWaypointIndex = 0;
        }
        if (this.localWaypointIndex >= this.localPath.length) return null;
        const localWaypoint = this.localPath[this.localWaypointIndex];
        const localDistance = Math.hypot(position.x - localWaypoint.x, position.z - localWaypoint.z);
        if (localDistance <= radius) {
          if (localWaypoint.phase === 'exit') this.crossingIndex = this.transitionIndex;
          this.localWaypointIndex += 1;
          if (this.localWaypointIndex >= this.localPath.length) return null;
          return { ...this.localPath[this.localWaypointIndex], transition };
        }
        return { ...localWaypoint, transition };
      }
      if (this.crossingIndex === this.transitionIndex) {
        return { ...transition.toPosition, phase: 'crossing', transition };
      }
      const distance = Math.hypot(
        position.x - transition.fromPosition.x,
        position.z - transition.fromPosition.z,
      );
      if (distance <= radius) {
        this.crossingIndex = this.transitionIndex;
        return { ...transition.toPosition, phase: 'crossing', transition };
      }
      return { ...transition.fromPosition, phase: 'exit', transition };
    }
    return null;
  }

  snapshot() {
    return {
      currentNodeId: this.currentNodeId,
      targetNodeId: this.targetNodeId,
      transitionIndex: this.transitionIndex,
      crossingIndex: this.crossingIndex,
      localWaypointIndex: this.localWaypointIndex,
      nodes: this.route?.nodes ? [...this.route.nodes] : [],
    };
  }
}

export function connectorRouteIsValid(graph, route) {
  if (!route?.nodes?.length || route.nodes[0] === undefined) return false;
  const planner = new ConnectorAwarePlanner(graph);
  return route.transitions?.every((transition) =>
    Boolean(planner.transition(transition.from, transition.to)),
  );
}
