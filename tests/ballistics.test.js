import { describe, expect, it } from 'vitest';
import { isBlockedByWall, rayCapsuleDistance } from '../src/core/ballistics.js';

const origin = { x: 0, y: 1.62, z: 0 };
const direction = { x: 0, y: 0, z: -1 };
const player = { x: 0, z: -5, bottomY: 0.25, topY: 1.7, radius: 0.38 };

describe('fair enemy ballistics', () => {
  it('hits a player capsule when the ray passes through it', () => {
    expect(rayCapsuleDistance(origin, direction, player, 20)).toBeCloseTo(4.62, 2);
  });

  it('misses when the ray passes beside the hit volume', () => {
    expect(rayCapsuleDistance(origin, { x: 0.2873478856, y: 0, z: -0.9578262852 }, player, 20)).toBe(
      Infinity,
    );
  });

  it('lets a nearer wall block a player hit', () => {
    const hitDistance = rayCapsuleDistance(origin, direction, player, 20);
    expect(isBlockedByWall(3, hitDistance)).toBe(true);
    expect(isBlockedByWall(5, hitDistance)).toBe(false);
  });
});
