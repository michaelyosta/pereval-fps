const EPSILON = 1e-6;

function raySphere(origin, direction, center, radius, maxDistance = Infinity) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return Infinity;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const far = -b + root;
  if (near >= 0 && near <= maxDistance) return near;
  if (far >= 0 && far <= maxDistance) return far;
  return Infinity;
}

/**
 * Intersect a normalized ray with a vertical capsule. Coordinates are deliberately plain
 * objects so this logic can run in unit tests without a renderer or Three.js scene.
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction
 * @param {{x:number,z:number,bottomY:number,topY:number,radius:number}} capsule
 */
export function rayCapsuleDistance(origin, direction, capsule, maxDistance = Infinity) {
  const dx = direction.x;
  const dz = direction.z;
  const ox = origin.x - capsule.x;
  const oz = origin.z - capsule.z;
  const a = dx * dx + dz * dz;
  let best = Infinity;

  if (a > EPSILON) {
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - capsule.radius * capsule.radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        const y = origin.y + direction.y * t;
        if (t >= 0 && t <= maxDistance && y >= capsule.bottomY && y <= capsule.topY) best = Math.min(best, t);
      }
    }
  }

  best = Math.min(
    best,
    raySphere(
      origin,
      direction,
      { x: capsule.x, y: capsule.bottomY, z: capsule.z },
      capsule.radius,
      maxDistance,
    ),
    raySphere(
      origin,
      direction,
      { x: capsule.x, y: capsule.topY, z: capsule.z },
      capsule.radius,
      maxDistance,
    ),
  );
  return best;
}

export function isBlockedByWall(wallDistance, hitDistance, epsilon = 0.05) {
  return Number.isFinite(wallDistance) && wallDistance + epsilon < hitDistance;
}
