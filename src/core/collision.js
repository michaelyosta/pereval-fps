const EPSILON = 1e-6;

function toLocal(x, z, collider) {
  const dx = x - collider.x;
  const dz = z - collider.z;
  const angle = collider.rotation || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: cos * dx + sin * dz, z: -sin * dx + cos * dz, cos, sin };
}

function toWorld(x, z, collider, basis) {
  return {
    x: collider.x + basis.cos * x - basis.sin * z,
    z: collider.z + basis.sin * x + basis.cos * z,
  };
}

export function colliderBlocksCapsule(collider, { bottomY = 0, topY = 1.8, stepHeight = 0.45 } = {}) {
  const height = collider.height ?? Infinity;
  return height > stepHeight && bottomY < height && topY > 0;
}

/** Resolve a standing capsule's horizontal footprint against height-aware oriented boxes. */
export function resolveCapsuleMotion(x, z, radius, colliders, options = {}) {
  for (const collider of colliders) {
    if (!colliderBlocksCapsule(collider, options)) continue;
    const local = toLocal(x, z, collider);
    const closestX = Math.max(-collider.hw, Math.min(local.x, collider.hw));
    const closestZ = Math.max(-collider.hd, Math.min(local.z, collider.hd));
    let dx = local.x - closestX;
    let dz = local.z - closestZ;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= radius * radius) continue;

    if (distanceSquared > EPSILON) {
      const distance = Math.sqrt(distanceSquared);
      const resolved = toWorld(
        closestX + (dx / distance) * radius,
        closestZ + (dz / distance) * radius,
        collider,
        local,
      );
      x = resolved.x;
      z = resolved.z;
      continue;
    }

    const left = local.x + collider.hw;
    const right = collider.hw - local.x;
    const top = local.z + collider.hd;
    const bottom = collider.hd - local.z;
    const minimum = Math.min(left, right, top, bottom);
    let resolvedX = local.x;
    let resolvedZ = local.z;
    if (minimum === left) resolvedX = -collider.hw - radius;
    else if (minimum === right) resolvedX = collider.hw + radius;
    else if (minimum === top) resolvedZ = -collider.hd - radius;
    else resolvedZ = collider.hd + radius;
    const resolved = toWorld(resolvedX, resolvedZ, collider, local);
    x = resolved.x;
    z = resolved.z;
  }
  return [x, z];
}

export function pointBlockedByCollider(x, z, margin, collider, options = {}) {
  if (!colliderBlocksCapsule(collider, options)) return false;
  const local = toLocal(x, z, collider);
  return Math.abs(local.x) < collider.hw + margin && Math.abs(local.z) < collider.hd + margin;
}
