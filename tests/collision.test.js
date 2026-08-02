import { describe, expect, it } from 'vitest';
import { pointBlockedByCollider, resolveCapsuleMotion } from '../src/core/collision.js';

describe('height-aware capsule collision', () => {
  it('steps over cover lower than the step offset', () => {
    const lowCover = { x: 0, z: 0, hw: 1, hd: 1, height: 0.3 };
    expect(pointBlockedByCollider(0, 0, 0.1, lowCover, { stepHeight: 0.45 })).toBe(false);
    expect(resolveCapsuleMotion(0, 0, 0.4, [lowCover], { stepHeight: 0.45 })).toEqual([0, 0]);
  });

  it('resolves a tall rotated collider without tunneling through its footprint', () => {
    const wall = { x: 0, z: 0, hw: 1, hd: 0.2, height: 3.5, rotation: Math.PI / 4 };
    const [x, z] = resolveCapsuleMotion(0, 0, 0.4, [wall]);
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(0.4);
  });
});
