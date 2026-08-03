export class InventoryItem {
  constructor({
    id,
    type = id,
    amount = 1,
    maxStack = 1,
    weight = 0,
    quest = false,
    protectedItem = false,
    metadata = {},
  }) {
    this.id = id;
    this.type = type;
    this.amount = amount;
    this.maxStack = Math.max(1, maxStack);
    this.weight = Math.max(0, weight);
    this.quest = quest;
    this.protectedItem = protectedItem;
    this.metadata = { ...metadata };
  }

  clone() {
    return new InventoryItem(this);
  }
}

export class Inventory {
  constructor({ capacity = 12, weightLimit = 30 } = {}) {
    this.capacity = Math.max(1, capacity);
    this.weightLimit = Math.max(0, weightLimit);
    this.items = [];
  }

  get weight() {
    return this.items.reduce((sum, item) => sum + item.amount * item.weight, 0);
  }

  count(idOrType) {
    return this.items
      .filter((item) => item.id === idOrType || item.type === idOrType)
      .reduce((sum, item) => sum + item.amount, 0);
  }

  has(idOrType, amount = 1) {
    return this.count(idOrType) >= amount;
  }

  canAdd(item, amount = item.amount ?? 1) {
    const existing = this.items.filter(
      (candidate) => candidate.id === item.id && candidate.amount < candidate.maxStack,
    );
    const freeSlots = this.capacity - this.items.length;
    const stackRoom = existing.reduce((sum, candidate) => sum + candidate.maxStack - candidate.amount, 0);
    if (amount > stackRoom + freeSlots * item.maxStack) return { ok: false, reason: 'capacity' };
    if (this.weight + amount * item.weight > this.weightLimit) return { ok: false, reason: 'weight' };
    return { ok: true };
  }

  add(rawItem, amount = rawItem.amount ?? 1) {
    const item =
      rawItem instanceof InventoryItem ? rawItem.clone() : new InventoryItem({ ...rawItem, amount });
    item.amount = amount;
    const availability = this.canAdd(item, amount);
    if (!availability.ok) return { added: 0, ...availability };
    let remaining = amount;
    for (const candidate of this.items.filter(
      (entry) => entry.id === item.id && entry.amount < entry.maxStack,
    )) {
      const moved = Math.min(remaining, candidate.maxStack - candidate.amount);
      candidate.amount += moved;
      remaining -= moved;
      if (!remaining) break;
    }
    while (remaining > 0) {
      const moved = Math.min(remaining, item.maxStack);
      this.items.push(new InventoryItem({ ...item, amount: moved }));
      remaining -= moved;
    }
    return { added: amount, ok: true };
  }

  remove(idOrType, amount = 1, { force = false } = {}) {
    if (!this.has(idOrType, amount)) return { removed: 0, ok: false, reason: 'missing' };
    const matching = this.items.filter((item) => item.id === idOrType || item.type === idOrType);
    if (!force && matching.some((item) => item.quest)) return { removed: 0, ok: false, reason: 'quest-item' };
    let remaining = amount;
    for (let index = this.items.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const item = this.items[index];
      if (item.id !== idOrType && item.type !== idOrType) continue;
      const moved = Math.min(remaining, item.amount);
      item.amount -= moved;
      remaining -= moved;
      if (item.amount === 0) this.items.splice(index, 1);
    }
    return { removed: amount, ok: true };
  }

  drop(idOrType, amount = 1) {
    return this.remove(idOrType, amount);
  }

  consume(idOrType, amount = 1) {
    return this.remove(idOrType, amount);
  }

  toJSON() {
    return {
      capacity: this.capacity,
      weightLimit: this.weightLimit,
      items: this.items.map((item) => ({ ...item })),
    };
  }
}

export class Equipment {
  constructor({ slots = ['primary', 'secondary', 'artifact'] } = {}) {
    this.slots = Object.fromEntries(slots.map((slot) => [slot, null]));
    this.activeSlot = slots[0] ?? null;
  }

  equip(item, slot = this.activeSlot) {
    if (!(slot in this.slots)) return false;
    this.slots[slot] = item instanceof InventoryItem ? item.clone() : { ...item };
    this.activeSlot = slot;
    return true;
  }

  switchTo(slot) {
    if (!(slot in this.slots) || !this.slots[slot]) return false;
    this.activeSlot = slot;
    return true;
  }

  active() {
    return this.slots[this.activeSlot] ?? null;
  }
}
