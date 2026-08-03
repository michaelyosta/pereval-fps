import * as THREE from 'three';
import { getEventDefinition } from './events.js';

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedMs(start) {
  return Number(Math.max(0, monotonicNow() - start).toFixed(2));
}

const CATEGORY_COLORS = {
  start: 0x6b8d9d,
  hub: 0x927b5c,
  industrial: 0x8f6c49,
  interior: 0x756d72,
  vertical: 0x5c718c,
  technical: 0x597b78,
  underground: 0x4f4e58,
  objective: 0x876c43,
  outdoor: 0x6f845c,
  extraction: 0x5b9a91,
  optional: 0x6a577d,
  danger: 0x964e42,
  horror: 0x3e4650,
};
const LOOT_COLORS = {
  crate: 0xb9874d,
  medical: 0x6aa38d,
  weapon: 0x8d91a0,
  rare: 0xcaa95b,
};
const EVENT_COLORS = {
  armory: 0xd6a45f,
  'rare-cache': 0xcaa95b,
  'wounded-scout': 0x6aa38d,
  'anomaly-nest': 0xd06c86,
  'blackout-room': 0x6c8faf,
  'blocked-route': 0x927b5c,
  ambush: 0xb34a4a,
  'distress-signal': 0x75b7ae,
};

function sideForDelta(dx, dz) {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'east' : 'west';
  return dz >= 0 ? 'south' : 'north';
}
function oppositeSide(side) {
  return { north: 'south', south: 'north', east: 'west', west: 'east' }[side];
}
function collectOpenSides(graph) {
  const openSides = new Map();
  for (const nodeId of graph.nodes.keys()) openSides.set(nodeId, new Set());
  for (const [fromId, neighbors] of graph.edges.entries()) {
    for (const toId of neighbors.keys()) {
      if (fromId >= toId) continue;
      const from = graph.getNode(fromId);
      const to = graph.getNode(toId);
      const side = sideForDelta(to.position.x - from.position.x, to.position.z - from.position.z);
      openSides.get(fromId).add(side);
      openSides.get(toId).add(oppositeSide(side));
    }
  }
  return openSides;
}
function createWallSegments(instance, openSides) {
  const { x: width, z: depth } = instance.definition.size;
  const gap = 3.4;
  const height = 3.2;
  const thickness = 0.225;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const segments = [];
  const addHorizontal = (side, z, length, x) => {
    segments.push({
      kind: 'wall',
      x,
      z,
      hw: length / 2,
      hd: thickness,
      height,
      rotation: 0,
      tag: instance.moduleId + ':' + side,
    });
  };
  const addVertical = (side, x, length, z) => {
    segments.push({
      kind: 'wall',
      x,
      z,
      hw: thickness,
      hd: length / 2,
      height,
      rotation: 0,
      tag: instance.moduleId + ':' + side,
    });
  };
  if (openSides.has('north')) {
    addHorizontal(
      'north-left',
      instance.position.z - halfDepth,
      (width - gap) / 2,
      instance.position.x - (width + gap) / 4,
    );
    addHorizontal(
      'north-right',
      instance.position.z - halfDepth,
      (width - gap) / 2,
      instance.position.x + (width + gap) / 4,
    );
  } else addHorizontal('north', instance.position.z - halfDepth, width, instance.position.x);
  if (openSides.has('south')) {
    addHorizontal(
      'south-left',
      instance.position.z + halfDepth,
      (width - gap) / 2,
      instance.position.x - (width + gap) / 4,
    );
    addHorizontal(
      'south-right',
      instance.position.z + halfDepth,
      (width - gap) / 2,
      instance.position.x + (width + gap) / 4,
    );
  } else addHorizontal('south', instance.position.z + halfDepth, width, instance.position.x);
  if (openSides.has('west')) {
    addVertical(
      'west-near',
      instance.position.x - halfWidth,
      (depth - gap) / 2,
      instance.position.z - (depth + gap) / 4,
    );
    addVertical(
      'west-far',
      instance.position.x - halfWidth,
      (depth - gap) / 2,
      instance.position.z + (depth + gap) / 4,
    );
  } else addVertical('west', instance.position.x - halfWidth, depth, instance.position.z);
  if (openSides.has('east')) {
    addVertical(
      'east-near',
      instance.position.x + halfWidth,
      (depth - gap) / 2,
      instance.position.z - (depth + gap) / 4,
    );
    addVertical(
      'east-far',
      instance.position.x + halfWidth,
      (depth - gap) / 2,
      instance.position.z + (depth + gap) / 4,
    );
  } else addVertical('east', instance.position.x + halfWidth, depth, instance.position.z);
  return segments;
}
export class ThreeWorldAssembler {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.materials = [];
  }

  assemble(generatedWorld) {
    const assemblyStart = monotonicNow();
    this.dispose();
    const group = new THREE.Group();
    group.name = 'expeditionWorld';
    const openSides = collectOpenSides(generatedWorld.graph);
    const colliders = [];
    const interactables = [];
    const collisionBuildStart = monotonicNow();
    const collidersByModule = new Map();
    for (const { instance } of generatedWorld.modules) {
      const moduleColliders = [...createWallSegments(instance, openSides.get(instance.id) ?? new Set())];
      for (const obstacleData of instance.definition.obstacles ?? []) {
        moduleColliders.push({
          kind: 'obstacle',
          ...obstacleData,
          x: instance.position.x + obstacleData.x,
          z: instance.position.z + obstacleData.z,
          height: obstacleData.height ?? 2.2,
          rotation: obstacleData.rotation ?? 0,
          tag: instance.moduleId + ':' + (obstacleData.tag ?? 'obstacle'),
        });
      }
      collidersByModule.set(instance.id, moduleColliders);
      colliders.push(...moduleColliders);
    }
    const colliderBuildMs = elapsedMs(collisionBuildStart);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x5d5447, roughness: 0.95, metalness: 0 });
    this.materials.push(floorMaterial);
    const moduleAssemblyStart = monotonicNow();
    for (const { instance, role } of generatedWorld.modules) {
      const color = CATEGORY_COLORS[instance.definition.category] ?? 0x777777;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.08 });
      this.materials.push(material);
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(instance.definition.size.x, 0.12, instance.definition.size.z),
        floorMaterial,
      );
      floor.position.set(instance.position.x, -0.06, instance.position.z);
      floor.userData.moduleId = instance.moduleId;
      floor.userData.role = role;
      group.add(floor);

      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(instance.definition.size.x, 3.2, instance.definition.size.z),
        ),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 }),
      );
      this.materials.push(frame.material);
      frame.position.set(instance.position.x, 1.6, instance.position.z);
      frame.userData.moduleId = instance.moduleId;
      group.add(frame);

      for (const collider of collidersByModule.get(instance.id) ?? []) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(collider.hw * 2, collider.height, collider.hd * 2),
          material,
        );
        wall.position.set(collider.x, collider.height / 2, collider.z);
        wall.rotation.y = collider.rotation;
        wall.userData.moduleId = instance.moduleId;
        wall.userData.shootable = true;
        wall.userData.collider = collider;
        group.add(wall);
      }

      if (role === 'objective' || role === 'extraction') {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, 0.1, 16),
          new THREE.MeshBasicMaterial({
            color: role === 'extraction' ? 0x62e0c5 : 0xf0bd65,
            transparent: true,
            opacity: 0.78,
          }),
        );
        this.materials.push(marker.material);
        marker.position.set(instance.position.x, 0.08, instance.position.z);
        marker.userData.moduleId = instance.moduleId;
        marker.userData.marker = role;
        marker.userData.interactableId = `module-${instance.id}`;
        group.add(marker);
        interactables.push({
          id: `module-${instance.id}`,
          type: role,
          label: role === 'objective' ? 'Взаимодействовать с объектом' : 'Активировать эвакуацию',
          position: { ...instance.position },
          object: marker,
          nodeId: instance.id,
          radius: Math.max(instance.definition.size.x, instance.definition.size.z) * 0.45,
        });
      }
    }
    const moduleAssemblyMs = elapsedMs(moduleAssemblyStart);
    for (const loot of generatedWorld.lootContainers ?? []) {
      const material = new THREE.MeshStandardMaterial({
        color: LOOT_COLORS[loot.kind] ?? LOOT_COLORS.crate,
        roughness: 0.7,
        metalness: loot.kind === 'weapon' ? 0.35 : 0.08,
        emissive: loot.kind === 'rare' ? 0x3d2912 : 0x000000,
        emissiveIntensity: loot.kind === 'rare' ? 0.35 : 0,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.65, 0.75), material);
      mesh.position.set(loot.position.x, 0.33, loot.position.z);
      mesh.userData.interactableId = loot.id;
      mesh.userData.interactableType = 'loot';
      mesh.userData.nodeId = loot.nodeId;
      group.add(mesh);
      interactables.push({
        id: loot.id,
        type: 'loot',
        label: loot.secured ? 'Открыть закрытый контейнер' : 'Открыть контейнер',
        position: { ...loot.position },
        object: mesh,
        nodeId: loot.nodeId,
        radius: 2.4,
      });
    }
    for (const event of generatedWorld.events ?? []) {
      const node = generatedWorld.graph.getNode(event.nodeId);
      if (!node) continue;
      const definition = getEventDefinition(event.type);
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.08, 8, 18),
        new THREE.MeshBasicMaterial({
          color: EVENT_COLORS[event.type] ?? 0xd6a45f,
          transparent: true,
          opacity: 0.82,
        }),
      );
      this.materials.push(marker.material);
      marker.position.set(node.position.x, 0.18, node.position.z);
      marker.rotation.x = Math.PI / 2;
      marker.userData.interactableId = event.id;
      marker.userData.interactableType = 'event';
      marker.userData.nodeId = event.nodeId;
      group.add(marker);
      interactables.push({
        id: event.id,
        type: 'event',
        label: definition.label,
        position: { ...node.position },
        object: marker,
        nodeId: event.nodeId,
        radius: 2.6,
      });
    }
    this.scene.add(group);
    this.group = group;
    return {
      group,
      colliders,
      interactables,
      moduleCount: generatedWorld.modules.length,
      timings: {
        colliderBuildMs,
        moduleAssemblyMs,
        worldAssemblyMs: elapsedMs(assemblyStart),
      },
    };
  }

  dispose() {
    if (!this.group) return;
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
    });
    this.scene.remove(this.group);
    for (const material of this.materials) material.dispose?.();
    this.materials = [];
    this.group = null;
  }
}
