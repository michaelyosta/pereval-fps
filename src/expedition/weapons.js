export class WeaponDefinition {
  constructor({
    id,
    name,
    category,
    damage,
    pellets = 1,
    magazine,
    reserveType = 'standard',
    fireRate,
    spread,
    reloadSeconds,
    range = 100,
    tags = [],
  }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.damage = damage;
    this.pellets = pellets;
    this.magazine = magazine;
    this.reserveType = reserveType;
    this.fireRate = fireRate;
    this.spread = spread;
    this.reloadSeconds = reloadSeconds;
    this.range = range;
    this.tags = [...tags];
  }
}

export class WeaponState {
  constructor(definition, { ammo = definition.magazine, reserve = definition.magazine * 4 } = {}) {
    this.definition = definition;
    this.ammo = ammo;
    this.reserve = reserve;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  tick(seconds) {
    this.cooldown = Math.max(0, this.cooldown - Math.max(0, seconds));
    if (this.reloading) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - Math.max(0, seconds));
      if (this.reloadRemaining === 0) this.finishReload();
    }
  }

  fire() {
    if (this.reloading || this.cooldown > 0 || this.ammo <= 0)
      return { fired: false, reason: this.ammo <= 0 ? 'empty' : 'cooldown' };
    this.ammo -= 1;
    this.cooldown = 60 / this.definition.fireRate;
    return {
      fired: true,
      damage: this.definition.damage,
      pellets: this.definition.pellets,
      spread: this.definition.spread,
    };
  }

  startReload() {
    if (this.reloading || this.ammo >= this.definition.magazine || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadRemaining = this.definition.reloadSeconds;
    return true;
  }

  finishReload() {
    const moved = Math.min(this.definition.magazine - this.ammo, this.reserve);
    this.ammo += moved;
    this.reserve -= moved;
    this.reloading = false;
    this.reloadRemaining = 0;
  }
}

export class WeaponRegistry {
  constructor(definitions = createDefaultWeapons()) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  get(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error('Unknown weapon: ' + id);
    return definition;
  }

  all() {
    return [...this.definitions.values()];
  }

  createState(id, options) {
    return new WeaponState(this.get(id), options);
  }
}

export function createDefaultWeapons() {
  return [
    new WeaponDefinition({
      id: 'pistol',
      name: 'Пистолет',
      category: 'sidearm',
      damage: 28,
      magazine: 15,
      reserveType: 'pistol',
      fireRate: 300,
      spread: 0.012,
      reloadSeconds: 1.2,
      range: 70,
      tags: ['quiet', 'fast-switch'],
    }),
    new WeaponDefinition({
      id: 'rifle',
      name: 'Автомат',
      category: 'rifle',
      damage: 18,
      magazine: 30,
      reserveType: 'rifle',
      fireRate: 720,
      spread: 0.022,
      reloadSeconds: 1.8,
      range: 120,
      tags: ['automatic', 'medium-range'],
    }),
    new WeaponDefinition({
      id: 'shotgun',
      name: 'Дробовик',
      category: 'shotgun',
      damage: 12,
      pellets: 8,
      magazine: 6,
      reserveType: 'shell',
      fireRate: 80,
      spread: 0.12,
      reloadSeconds: 2.2,
      range: 35,
      tags: ['loud', 'close-range'],
    }),
    new WeaponDefinition({
      id: 'oblomok-7',
      name: 'ОБЛОМОК-7',
      category: 'artifact',
      damage: 42,
      magazine: 30,
      reserveType: 'anomalous',
      fireRate: 480,
      spread: 0.018,
      reloadSeconds: 2,
      range: 140,
      tags: ['artifact', 'anomaly', 'piercing'],
    }),
  ];
}
