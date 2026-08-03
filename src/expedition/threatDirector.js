import { SeededRandom } from '../core/expedition/SeededRandom.js';

export const ThreatPhase = Object.freeze({
  Recovery: 'recovery',
  Monitor: 'monitor',
  Escalating: 'escalating',
  Crisis: 'crisis',
});

export class ThreatDirector {
  constructor({
    seed = 'threat',
    maxActive = 12,
    maxEncounters = 8,
    minSpawnDistance = 14,
    recoveryDuration = 12,
  } = {}) {
    this.random = new SeededRandom(seed);
    this.maxActive = maxActive;
    this.maxEncounters = maxEncounters;
    this.minSpawnDistance = minSpawnDistance;
    this.recoveryDuration = recoveryDuration;
    this.threat = 0;
    this.phase = ThreatPhase.Monitor;
    this.recoveryRemaining = 0;
    this.cooldown = 0;
    this.activeEnemies = new Map();
    this.encountersStarted = 0;
    this.lastReason = 'initial';
    this.player = { position: { x: 0, z: 0 }, nodeId: null };
  }

  setPlayer(player) {
    this.player = { ...this.player, ...player };
  }

  registerEnemy(enemy) {
    if (enemy?.id) this.activeEnemies.set(enemy.id, enemy);
  }

  removeEnemy(id) {
    this.activeEnemies.delete(id);
  }

  addThreat(amount, reason = 'signal') {
    this.threat = Math.max(0, Math.min(100, this.threat + amount));
    this.lastReason = reason;
    if (this.threat >= 75) this.phase = ThreatPhase.Crisis;
    else if (this.threat >= 45) this.phase = ThreatPhase.Escalating;
    else if (this.phase !== ThreatPhase.Recovery) this.phase = ThreatPhase.Monitor;
    return this.threat;
  }

  startRecovery(duration = this.recoveryDuration, reason = 'recovery') {
    this.phase = ThreatPhase.Recovery;
    this.lastReason = reason;
    this.recoveryRemaining = Math.max(0, duration);
    this.cooldown = Math.max(this.cooldown, this.recoveryRemaining);
  }

  update(seconds) {
    const dt = Math.max(0, seconds);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.phase === ThreatPhase.Recovery) {
      this.recoveryRemaining = Math.max(0, this.recoveryRemaining - dt);
      this.threat = Math.max(0, this.threat - dt * 0.7);
      if (this.recoveryRemaining <= 0)
        this.phase = this.threat >= 45 ? ThreatPhase.Escalating : ThreatPhase.Monitor;
    } else if (this.activeEnemies.size === 0) {
      this.threat = Math.max(0, this.threat - dt * 0.1);
    }
  }

  safeSpawn(candidate, { minDistance = this.minSpawnDistance } = {}) {
    if (!candidate?.position) return false;
    const dx = candidate.position.x - this.player.position.x;
    const dz = candidate.position.z - this.player.position.z;
    if (Math.hypot(dx, dz) < minDistance) return false;
    if (candidate.visible === true || candidate.inLineOfSight === true) return false;
    return candidate.nodeId == null || candidate.nodeId !== this.player.nodeId;
  }

  chooseSpawnPoint(candidates, options = {}) {
    const safe = candidates.filter((candidate) => this.safeSpawn(candidate, options));
    return safe.length ? this.random.pick(safe) : null;
  }

  requestEncounter({ candidates = [], force = false } = {}) {
    if (!force && (this.phase === ThreatPhase.Recovery || this.cooldown > 0)) return null;
    if (this.activeEnemies.size >= this.maxActive || this.encountersStarted >= this.maxEncounters)
      return null;
    const spawn = this.chooseSpawnPoint(candidates);
    if (!spawn) return null;
    this.encountersStarted += 1;
    this.cooldown = this.phase === ThreatPhase.Crisis ? 3 : 8;
    this.addThreat(this.phase === ThreatPhase.Crisis ? 4 : 2, 'encounter-started');
    return { ...spawn, encounter: this.encountersStarted };
  }

  snapshot() {
    return {
      threat: this.threat,
      phase: this.phase,
      cooldown: this.cooldown,
      recoveryRemaining: this.recoveryRemaining,
      activeEnemies: this.activeEnemies.size,
      encountersStarted: this.encountersStarted,
      maxEncounters: this.maxEncounters,
      lastReason: this.lastReason,
    };
  }
}
