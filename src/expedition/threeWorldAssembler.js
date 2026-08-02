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
    return { group, moduleCount: generatedWorld.modules.length };
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
