export class ExtractionPoint {
  constructor({ id, nodeId, mode = 'hold', duration = 30, requiredItem = null, noise = 1 }) {
    this.id = id;
    this.nodeId = nodeId;
    this.mode = mode;
    this.duration = duration;
    this.requiredItem = requiredItem;
    this.noise = noise;
    this.active = false;
    this.progress = 0;
  }

  reset() {
    this.active = false;
    this.progress = 0;
  }
}

export class ExtractionSystem {
  constructor({ points = [], testMode = false } = {}) {
    this.points = points.map((point) =>
      point instanceof ExtractionPoint
        ? point
        : new ExtractionPoint({
            ...point,
            duration: testMode ? Math.min(3, point.duration) : point.duration,
          }),
    );
    this.available = false;
    this.activePointId = null;
    this.lastEvent = null;
  }

  unlock(pointId = null) {
    this.available = true;
    if (pointId && !this.points.some((point) => point.id === pointId))
      throw new Error('Unknown extraction point: ' + pointId);
    return this.available;
  }

  point(pointId = this.activePointId ?? this.points[0]?.id) {
    return this.points.find((point) => point.id === pointId) ?? null;
  }

  begin(pointId, inventory = null) {
    if (!this.available) throw new Error('Extraction is not available');
    const point = this.point(pointId);
    if (!point) throw new Error('Unknown extraction point: ' + pointId);
    if (point.requiredItem && !inventory?.has?.(point.requiredItem))
      throw new Error('Missing extraction item: ' + point.requiredItem);
    this.points.forEach((candidate) => candidate.reset());
    point.active = true;
    this.activePointId = point.id;
    this.lastEvent = { type: 'started', pointId: point.id };
    return point;
  }

  tick(seconds, { inside = true } = {}) {
    const point = this.point();
    if (!point?.active || !Number.isFinite(seconds) || seconds <= 0)
      return { completed: false, progress: point?.progress ?? 0 };
    if (inside) point.progress = Math.min(point.duration, point.progress + seconds);
    else point.progress = Math.max(0, point.progress - seconds * 2);
    const completed = point.progress >= point.duration;
    if (completed) {
      point.active = false;
      this.lastEvent = { type: 'completed', pointId: point.id };
    }
    return {
      completed,
      progress: point.progress,
      duration: point.duration,
      threatMultiplier: inside ? 1.5 : 0.5,
    };
  }

  cancel() {
    const point = this.point();
    point?.reset();
    this.activePointId = null;
    this.lastEvent = { type: 'cancelled' };
  }
}
