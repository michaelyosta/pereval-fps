function cellKey(x, z) {
  return x + ':' + z;
}

function boundsForPoint(point, radius) {
  return { minX: point.x - radius, maxX: point.x + radius, minZ: point.z - radius, maxZ: point.z + radius };
}

export class SpatialIndex {
  constructor(cellSize = 16) {
    this.cellSize = Math.max(1, cellSize);
    this.cells = new Map();
    this.entries = new Map();
  }

  cellsFor(bounds) {
    const minX = Math.floor(bounds.minX / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minZ = Math.floor(bounds.minZ / this.cellSize);
    const maxZ = Math.floor(bounds.maxZ / this.cellSize);
    const result = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) result.push(cellKey(x, z));
    }
    return result;
  }

  insert(id, bounds, value = id) {
    this.remove(id);
    const keys = this.cellsFor(bounds);
    this.entries.set(id, { id, bounds: { ...bounds }, value, keys });
    for (const key of keys) {
      if (!this.cells.has(key)) this.cells.set(key, new Set());
      this.cells.get(key).add(id);
    }
    return value;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    for (const key of entry.keys) this.cells.get(key)?.delete(id);
    this.entries.delete(id);
    return true;
  }

  query(bounds) {
    const ids = new Set();
    for (const key of this.cellsFor(bounds)) for (const id of this.cells.get(key) ?? []) ids.add(id);
    return [...ids]
      .map((id) => this.entries.get(id))
      .filter(
        (entry) =>
          entry.bounds.minX <= bounds.maxX &&
          entry.bounds.maxX >= bounds.minX &&
          entry.bounds.minZ <= bounds.maxZ &&
          entry.bounds.maxZ >= bounds.minZ,
      )
      .map((entry) => entry.value);
  }

  nearest(point, radius = Infinity, predicate = () => true) {
    const candidates = this.query(boundsForPoint(point, radius === Infinity ? this.cellSize * 4 : radius));
    let nearest = null;
    let nearestDistance = radius;
    for (const candidate of candidates) {
      if (!predicate(candidate)) continue;
      const dx = (candidate.position?.x ?? candidate.x ?? 0) - point.x;
      const dz = (candidate.position?.z ?? candidate.z ?? 0) - point.z;
      const distance = Math.hypot(dx, dz);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  clear() {
    this.cells.clear();
    this.entries.clear();
  }
}

export class GeneratedWorld {
  constructor(snapshot) {
    Object.assign(this, snapshot);
    this.spatialIndex = snapshot.spatialIndex ?? new SpatialIndex();
  }

  buildSpatialIndex() {
    this.spatialIndex.clear();
    for (const { instance } of this.modules) this.spatialIndex.insert(instance.id, instance.bounds, instance);
    for (const loot of this.lootContainers)
      this.spatialIndex.insert(loot.id, boundsForPoint(loot.position, 1), loot);
    for (const enemy of this.enemyGroups)
      this.spatialIndex.insert(enemy.id, boundsForPoint(enemy.position, 2), enemy);
    return this.spatialIndex;
  }

  dispose() {
    this.spatialIndex.clear();
    this.navigationMesh?.dispose?.();
  }
}

export class WorldAssembler {
  assemble(input) {
    const world = input instanceof GeneratedWorld ? input : new GeneratedWorld(input);
    world.buildSpatialIndex();
    const modules = world.modules.map(({ instance, role }) => ({
      id: instance.id,
      moduleId: instance.moduleId,
      role,
      position: { ...instance.position },
      bounds: { ...instance.bounds },
      tags: [...instance.definition.tags],
    }));
    return {
      world,
      modules,
      colliders: modules.map((module) => ({ ...module.bounds, height: 3.5, tag: module.moduleId })),
      objectiveMarkers: world.objective.steps.map((step) => ({ stepId: step.id, nodeId: step.nodeId })),
      loot: world.lootContainers.map((item) => ({ ...item })),
      enemies: world.enemyGroups.map((group) => ({ ...group })),
    };
  }

  dispose(assembled) {
    assembled?.world?.dispose?.();
  }
}
