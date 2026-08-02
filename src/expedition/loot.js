import { InventoryItem } from './inventory.js';

export class ItemDefinition {
  constructor({
    id,
    name = id,
    category,
    maxStack = 1,
    weight = 0,
    heal = 0,
    ammoType = null,
    quest = false,
    protectedItem = false,
    rarity = 'common',
    tags = [],
  }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.maxStack = Math.max(1, maxStack);
    this.weight = Math.max(0, weight);
    this.heal = Math.max(0, heal);
    this.ammoType = ammoType;
    this.quest = quest;
    this.protectedItem = protectedItem;
    this.rarity = rarity;
    this.tags = [...tags];
  }

  toInventoryItem(amount = 1, metadata = {}) {
    return new InventoryItem({
      id: this.id,
      type: this.category,
      amount,
      maxStack: this.maxStack,
      weight: this.weight,
      quest: this.quest,
      protectedItem: this.protectedItem,
      metadata: { ...metadata, name: this.name, heal: this.heal, ammoType: this.ammoType },
    });
  }
}

export class ItemRegistry {
  constructor(definitions = createDefaultItems()) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  get(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error('Unknown item: ' + id);
    return definition;
  }

  has(id) {
    return this.definitions.has(id);
  }

  all() {
    return [...this.definitions.values()];
  }
}

export class Pickup {
  constructor({ id, itemId, amount = 1, position, nodeId = null } = {}) {
    this.id = id;
    this.itemId = itemId;
    this.amount = amount;
    this.position = position ? { ...position } : null;
    this.nodeId = nodeId;
    this.collected = false;
  }

  collect(registry) {
    if (this.collected) return null;
    const definition = registry.get(this.itemId);
    this.collected = true;
    return definition.toInventoryItem(this.amount, { pickupId: this.id, nodeId: this.nodeId });
  }
}

export class LootContainer {
  constructor({ id, nodeId, position, kind = 'crate', secured = false, contents = [] } = {}) {
    this.id = id;
    this.nodeId = nodeId;
    this.position = position ? { ...position } : null;
    this.kind = kind;
    this.secured = Boolean(secured);
    this.contents = contents.map((item) => new Pickup({ ...item, nodeId }));
    this.opened = false;
  }

  open(registry) {
    if (this.opened) return [];
    this.opened = true;
    return this.contents.map((pickup) => pickup.collect(registry)).filter(Boolean);
  }

  preview(registry) {
    if (this.opened) return [];
    return this.contents
      .filter((pickup) => !pickup.collected)
      .map((pickup) =>
        registry
          .get(pickup.itemId)
          .toInventoryItem(pickup.amount, { pickupId: pickup.id, nodeId: this.nodeId }),
      );
  }
}

export function createDefaultItems() {
  return [
    new ItemDefinition({
      id: 'pistol-ammo',
      name: 'Патроны пистолета',
      category: 'ammo',
      ammoType: 'pistol',
      maxStack: 30,
      weight: 0.08,
    }),
    new ItemDefinition({
      id: 'rifle-ammo',
      name: 'Автоматные патроны',
      category: 'ammo',
      ammoType: 'rifle',
      maxStack: 30,
      weight: 0.08,
    }),
    new ItemDefinition({
      id: 'shell',
      name: 'Дробовые патроны',
      category: 'ammo',
      ammoType: 'shell',
      maxStack: 12,
      weight: 0.16,
    }),
    new ItemDefinition({
      id: 'anomaly-charge',
      name: 'Аномальный заряд',
      category: 'ammo',
      ammoType: 'anomalous',
      maxStack: 8,
      weight: 0.25,
      rarity: 'rare',
    }),
    new ItemDefinition({
      id: 'medkit',
      name: 'Аптечка',
      category: 'healing',
      maxStack: 2,
      weight: 1.2,
      heal: 45,
    }),
    new ItemDefinition({
      id: 'bandage',
      name: 'Бинт',
      category: 'healing',
      maxStack: 4,
      weight: 0.3,
      heal: 20,
    }),
    new ItemDefinition({
      id: 'fuel',
      name: 'Топливо',
      category: 'quest',
      maxStack: 2,
      weight: 2,
      quest: true,
    }),
    new ItemDefinition({
      id: 'fuse',
      name: 'Предохранитель',
      category: 'quest',
      maxStack: 2,
      weight: 0.4,
      quest: true,
    }),
    new ItemDefinition({
      id: 'sample',
      name: 'Аномальный образец',
      category: 'sample',
      maxStack: 1,
      weight: 1.5,
      quest: true,
      rarity: 'rare',
    }),
    new ItemDefinition({
      id: 'weapon-part',
      name: 'Деталь оружия',
      category: 'resource',
      maxStack: 5,
      weight: 0.5,
    }),
    new ItemDefinition({
      id: 'shelter-resource',
      name: 'Ресурс убежища',
      category: 'resource',
      maxStack: 10,
      weight: 0.2,
    }),
    new ItemDefinition({
      id: 'artifact',
      name: 'Редкий артефакт',
      category: 'artifact',
      maxStack: 1,
      weight: 1,
      protectedItem: true,
      rarity: 'rare',
    }),
  ];
}
