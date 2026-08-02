const UINT32_MAX = 0xffffffff;

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  return hashString(String(value ?? 'default'));
}

export class SeededRandom {
  constructor(seed = 0) {
    this.seed = hashSeed(seed);
    this.state = this.seed || 0x6d2b79f5;
  }

  nextUint() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  next() {
    return this.nextUint() / (UINT32_MAX + 1);
  }

  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError('SeededRandom.int expects integer bounds with max >= min');
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick(values) {
    if (!Array.isArray(values) || values.length === 0) throw new RangeError('Cannot pick from an empty list');
    return values[this.int(0, values.length - 1)];
  }

  chance(probability) {
    return this.next() < Math.max(0, Math.min(1, probability));
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  fork(label) {
    return new SeededRandom(hashSeed(`${this.seed}:${String(label)}`));
  }

  snapshot() {
    return { seed: this.seed, state: this.state };
  }
}

export class RunSeed {
  constructor(value = 'default') {
    this.display = String(value);
    this.numeric = hashSeed(this.display);
  }

  derive(label) {
    return new RunSeed(`${this.display}:${String(label)}`);
  }

  toString() {
    return this.display;
  }

  toJSON() {
    return this.display;
  }

  static from(value) {
    return value instanceof RunSeed ? value : new RunSeed(value);
  }
}

export class GenerationContext {
  constructor(seed = 'default') {
    this.runSeed = RunSeed.from(seed);
    this.random = new SeededRandom(this.runSeed.numeric);
    this.streams = new Map();
  }

  stream(name) {
    const key = String(name);
    if (!this.streams.has(key)) this.streams.set(key, this.random.fork(key));
    return this.streams.get(key);
  }

  fork(name) {
    return new GenerationContext(this.runSeed.derive(name));
  }
}
