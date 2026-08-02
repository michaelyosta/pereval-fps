import * as THREE from 'three';

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
    this.dispose();
    const group = new THREE.Group();
    group.name = 'expeditionWorld';
    const openSides = collectOpenSides(generatedWorld.graph);
    const colliders = [];
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x5d5447, roughness: 0.95, metalness: 0 });
    this.materials.push(floorMaterial);
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

      for (const wallData of createWallSegments(instance, openSides.get(instance.id) ?? new Set())) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(wallData.hw * 2, wallData.height, wallData.hd * 2),
          material,
        );
        wall.position.set(wallData.x, wallData.height / 2, wallData.z);
        wall.rotation.y = wallData.rotation;
        wall.userData.moduleId = instance.moduleId;
        wall.userData.shootable = true;
        wall.userData.collider = wallData;
        group.add(wall);
        colliders.push(wallData);
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
        group.add(marker);
      }
    }
    this.scene.add(group);
    this.group = group;
    return { group, colliders, moduleCount: generatedWorld.modules.length };
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
