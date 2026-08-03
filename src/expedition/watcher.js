import { SeededRandom } from '../core/expedition/SeededRandom.js';

export const WatcherState = Object.freeze({
  Disabled: 'disabled',
  Dormant: 'dormant',
  Stalking: 'stalking',
  Retreating: 'retreating',
  Engaged: 'engaged',
});

function distanceBetween(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot((left.x ?? 0) - (right.x ?? 0), (left.z ?? 0) - (right.z ?? 0));
}

export class WatcherDirector {
  constructor({
    seed = 'watcher',
    enabled = true,
    activationAnomaly = 62,
    activationNoise = 3.5,
    maxActivations = 1,
  } = {}) {
    this.random = new SeededRandom(seed);
    this.enabled = enabled;
    this.activationAnomaly = activationAnomaly;
    this.activationNoise = activationNoise;
    this.maxActivations = Math.max(0, maxActivations);
    this.state = enabled ? WatcherState.Dormant : WatcherState.Disabled;
    this.activations = 0;
    this.observedSeconds = 0;
    this.strikeCooldown = 0;
    this.candidate = null;
    this.position = null;
    this.nodeId = null;
    this.player = { position: null, nodeId: null };
    this.lastReason = null;
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
    return event;
  }

  setPlayer({ position = null, nodeId = null } = {}) {
    this.player = { position: position ? { ...position } : null, nodeId };
  }

  registerCandidate(candidate) {
    if (!candidate?.id || !candidate?.position) return false;
    this.candidate = this.candidate ?? candidate;
    return true;
  }

  canActivate() {
    return this.enabled && this.state === WatcherState.Dormant && this.activations < this.maxActivations;
  }

  activate(reason = 'anomaly', candidate = this.candidate) {
    if (!this.canActivate() || !candidate?.position) return false;
    if (distanceBetween(candidate.position, this.player.position) < 10) return false;
    this.activations += 1;
    this.state = WatcherState.Stalking;
    this.candidate = candidate;
    // The initial position is sampled once. Subsequent movement belongs to the runtime bot;
    // the director never teleports the Watcher to the player.
    this.position = { ...candidate.position };
    this.nodeId = candidate.nodeId ?? null;
    this.lastReason = reason;
    this.observedSeconds = 0;
    return this.emit({
      type: 'watcher-activated',
      reason,
      candidateId: candidate.id,
      position: { ...this.position },
    });
  }

  update(seconds, { anomaly = 0, noise = null, playerPosition = null, playerNodeId = null } = {}) {
    const dt = Math.max(0, Number(seconds) || 0);
    this.setPlayer({ position: playerPosition, nodeId: playerNodeId });
    if (!this.canActivate()) {
      if (this.state === WatcherState.Stalking || this.state === WatcherState.Engaged) {
        this.observedSeconds += dt;
        this.strikeCooldown = Math.max(0, this.strikeCooldown - dt);
        const distance = distanceBetween(this.position, this.player.position);
        if (distance < 4 && this.state === WatcherState.Stalking) {
          this.state = WatcherState.Engaged;
          this.emit({ type: 'watcher-engaged', distance });
        } else if (this.state === WatcherState.Engaged && distance > 12) {
          this.state = WatcherState.Retreating;
          this.emit({ type: 'watcher-retreating', distance });
        }
      }
      return this.snapshot();
    }
    const loudEnough = noise && noise.intensity >= this.activationNoise;
    if (anomaly >= this.activationAnomaly || loudEnough) {
      this.activate(loudEnough ? `noise:${noise.kind}` : 'anomaly-threshold');
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      enabled: this.enabled,
      state: this.state,
      activations: this.activations,
      observedSeconds: this.observedSeconds,
      candidateId: this.candidate?.id ?? null,
      position: this.position ? { ...this.position } : null,
      nodeId: this.nodeId,
      lastReason: this.lastReason,
    };
  }
}
