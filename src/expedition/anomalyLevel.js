export const AnomalyBand = Object.freeze({
  Quiet: 'quiet',
  Unstable: 'unstable',
  Critical: 'critical',
});

function bandFor(value) {
  if (value >= 70) return AnomalyBand.Critical;
  if (value >= 30) return AnomalyBand.Unstable;
  return AnomalyBand.Quiet;
}

export class AnomalyLevel {
  constructor({ value = 0, decayPerSecond = 0.25, seed = 'anomaly' } = {}) {
    this.value = Math.max(0, Math.min(100, value));
    this.decayPerSecond = Math.max(0, decayPerSecond);
    this.seed = String(seed);
    this.band = bandFor(this.value);
    this.lastSource = null;
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener({ ...event, value: this.value, band: this.band });
  }

  set(value, source = 'system') {
    const next = Math.max(0, Math.min(100, Number(value) || 0));
    const previous = this.value;
    const previousBand = this.band;
    this.value = next;
    this.band = bandFor(next);
    this.lastSource = source;
    if (previous !== next || previousBand !== this.band) {
      this.emit({ type: 'changed', previous, source, thresholdCrossed: previousBand !== this.band });
    }
    return this.value;
  }

  add(amount, source = 'event') {
    const delta = Number(amount) || 0;
    return this.set(this.value + delta, source);
  }

  update(seconds, { threat = 0, inAnomaly = false } = {}) {
    const dt = Math.max(0, Number(seconds) || 0);
    const environmentalGain = inAnomaly ? 0.9 : Math.max(0, threat - 45) * 0.004;
    if (environmentalGain > 0) this.add(environmentalGain * dt, inAnomaly ? 'anomaly-zone' : 'threat');
    else if (this.value > 0) this.set(this.value - this.decayPerSecond * dt, 'decay');
    return this.value;
  }

  snapshot() {
    return {
      value: this.value,
      band: this.band,
      lastSource: this.lastSource,
      seed: this.seed,
    };
  }
}
