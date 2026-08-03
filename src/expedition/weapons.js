import { WEAPON_DEFINITIONS } from '../data/weapons/index.js';

export const FireMode = Object.freeze({ Semi: 'semi', Auto: 'auto' });

export class AmmoDefinition {
  constructor({ id, reserveType, maxStack = 30 } = {}) {
    this.id = id;
    this.reserveType = reserveType;
    this.maxStack = maxStack;
  }
}

export class ProjectileProfile {
  constructor({ range = 100, penetration = 0, damageFalloff = 1 } = {}) {
    this.range = range;
    this.penetration = penetration;
    this.damageFalloff = damageFalloff;
  }
}

export class RecoilProfile {
  constructor({ pitch = 0.014, yaw = 0.02, recovery = 1 } = {}) {
    this.pitch = pitch;
    this.yaw = yaw;
    this.recovery = recovery;
  }
}

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
    fireMode = FireMode.Semi,
    adsSpeed = 1,
    movementMultiplier = 1,
    noise = 1,
    penetration = 0,
    damageFalloff = 1,
    rarity = 'common',
    instabilityPerShot = 0,
    heatLimit = 0,
    ammoDefinition = null,
    projectileProfile = null,
    recoilProfile = null,
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
    this.fireMode = fireMode;
    this.adsSpeed = adsSpeed;
    this.movementMultiplier = movementMultiplier;
    this.noise = noise;
    this.rarity = rarity;
    this.ammo = ammoDefinition ?? new AmmoDefinition({ id: reserveType, reserveType });
    this.projectile = projectileProfile ?? new ProjectileProfile({ range, penetration, damageFalloff });
    this.recoil = recoilProfile ?? new RecoilProfile();
    this.instabilityPerShot = instabilityPerShot;
    this.heatLimit = heatLimit;
    this.tags = [...tags];
  }

  damageAt(distance = 0) {
    const normalized = Math.max(0, Math.min(1, distance / Math.max(1, this.projectile.range)));
    return this.damage * (1 - normalized * (1 - this.projectile.damageFalloff));
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
    this.reloadDuration = 0;
    this.instability = 0;
    this.overheated = false;
  }

  tick(seconds) {
    const dt = Math.max(0, seconds);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.reloading && this.instability > 0) {
      this.instability = Math.max(0, this.instability - dt * 5);
      if (this.overheated && this.instability <= (this.definition.heatLimit || 100) * 0.45)
        this.overheated = false;
    }
    if (this.reloading) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
      if (this.reloadRemaining === 0) this.finishReload();
    }
  }

  fire() {
    if (this.reloading || this.cooldown > 0 || this.ammo <= 0)
      return { fired: false, reason: this.ammo <= 0 ? 'empty' : 'cooldown' };
    if (this.overheated) return { fired: false, reason: 'overheated' };
    this.ammo -= 1;
    this.cooldown = 60 / this.definition.fireRate;
    this.instability = Math.min(
      this.definition.heatLimit || 100,
      this.instability + this.definition.instabilityPerShot,
    );
    if (this.definition.heatLimit && this.instability >= this.definition.heatLimit) this.overheated = true;
    return {
      fired: true,
      damage: this.definition.damage,
      pellets: this.definition.pellets,
      spread: this.definition.spread,
      noise: this.definition.noise,
      projectile: this.definition.projectile,
      fireMode: this.definition.fireMode,
      overheated: this.overheated,
    };
  }

  startReload(multiplier = 1) {
    if (this.reloading || this.ammo >= this.definition.magazine || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadDuration = this.definition.reloadSeconds * Math.max(0.25, multiplier);
    this.reloadRemaining = this.reloadDuration;
    return true;
  }

  finishReload() {
    const moved = Math.min(this.definition.magazine - this.ammo, this.reserve);
    this.ammo += moved;
    this.reserve -= moved;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.overheated = false;
    this.instability = Math.max(0, this.instability - 35);
    return moved;
  }
}

export class WeaponInstance extends WeaponState {}

export class WeaponController {
  constructor(registry = new WeaponRegistry()) {
    this.registry = registry;
    this.active = null;
  }

  equip(id, options) {
    this.active = new WeaponInstance(this.registry.get(id), options);
    return this.active;
  }

  fire() {
    return this.active?.fire() ?? { fired: false, reason: 'no-weapon' };
  }

  reload() {
    return this.active?.startReload() ?? false;
  }

  tick(seconds) {
    this.active?.tick(seconds);
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
  return WEAPON_DEFINITIONS.map((definition) => new WeaponDefinition(definition));
}
