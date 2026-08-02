/** @typedef {{ health:number, maxHealth:number, alive:boolean, kills:number, ammo:number, reserve:number, magSize:number, reloading:boolean, paused:boolean }} GameplayState */

const clampPositive = (value) => Math.max(0, Number(value) || 0);

/**
 * Apply player damage as a game command. UI observes the emitted event but never owns this mutation.
 * @param {GameplayState} state
 * @param {number} amount
 * @param {(event: object) => void} emit
 * @param {object} [source]
 */
export function damagePlayer(state, amount, emit = () => {}, source = undefined) {
  if (!state.alive || state.health <= 0) return { applied: 0, killed: false };
  const applied = Math.min(clampPositive(amount), state.health);
  if (applied <= 0) return { applied: 0, killed: false };
  state.health -= applied;
  const killed = state.health <= 0;
  if (killed) state.alive = false;
  emit({ amount: applied, health: state.health, killed, source });
  return { applied, killed };
}

/**
 * Count a kill only on the live -> dead transition.
 * @param {GameplayState} state
 * @param {{alive:boolean, health:number}} enemy
 * @param {(event: object) => void} emit
 */
export function applyEnemyDamage(state, enemy, amount, emit = () => {}) {
  if (!enemy || !enemy.alive) return { applied: 0, killed: false };
  const applied = clampPositive(amount);
  enemy.health -= applied;
  const killed = enemy.health <= 0;
  if (killed) {
    enemy.health = 0;
    enemy.alive = false;
    state.kills += 1;
  }
  emit({ amount: applied, killed, health: enemy.health });
  return { applied, killed };
}

/** @param {GameplayState} state */
export function reloadMagazine(state) {
  if (state.reloading || state.ammo >= state.magSize || state.reserve <= 0) return 0;
  const transferred = Math.min(state.magSize - state.ammo, state.reserve);
  state.ammo += transferred;
  state.reserve -= transferred;
  return transferred;
}

/** @param {GameplayState} state */
export function respawnPlayer(state) {
  state.alive = true;
  state.health = state.maxHealth;
  state.ammo = state.magSize;
  state.reserve = 120;
  state.reloading = false;
}

/** @param {GameplayState} state */
export function advanceGameTime(state, dt) {
  if (!state.paused && state.alive) state.time = (state.time || 0) + Math.max(0, dt);
  return state.time || 0;
}
