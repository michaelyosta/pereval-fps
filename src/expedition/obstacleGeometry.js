const EPSILON = 1e-7;

function rotatePoint(x, z, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { x: cos * x - sin * z, z: sin * x + cos * z };
}

function localPoint(point, obstacle) {
  const dx = point.x - obstacle.x;
  const dz = point.z - obstacle.z;
  return {
    x: obstacle.cos * dx + obstacle.sin * dz,
    z: -obstacle.sin * dx + obstacle.cos * dz,
  };
}

export function createObstacleGeometry(obstacle, center = obstacle, inset = 0) {
  const rotation = Number.isFinite(obstacle.rotation) ? obstacle.rotation : 0;
  const hw = Math.max(0, (obstacle.hw ?? 0) + inset);
  const hd = Math.max(0, (obstacle.hd ?? 0) + inset);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const extentX = Math.abs(cos) * hw + Math.abs(sin) * hd;
  const extentZ = Math.abs(sin) * hw + Math.abs(cos) * hd;
  return {
    x: center.x,
    z: center.z,
    hw,
    hd,
    rotation,
    cos,
    sin,
    minX: center.x - extentX,
    maxX: center.x + extentX,
    minZ: center.z - extentZ,
    maxZ: center.z + extentZ,
    tag: obstacle.tag ?? 'obstacle',
  };
}

export function obstacleCorners(obstacle, offset = 0) {
  const hw = obstacle.hw + offset;
  const hd = obstacle.hd + offset;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, z]) => {
    const rotated = rotatePoint(x, z, obstacle.rotation ?? 0);
    return { x: obstacle.x + rotated.x, z: obstacle.z + rotated.z };
  });
}

export function pointInsideObstacle(point, obstacle, margin = 0) {
  const local = localPoint(point, obstacle);
  return Math.abs(local.x) < obstacle.hw + margin && Math.abs(local.z) < obstacle.hd + margin;
}

function segmentAxisInterval(start, delta, min, max) {
  if (Math.abs(delta) <= EPSILON) {
    if (start < min || start > max) return null;
    return [0, 1];
  }
  const first = (min - start) / delta;
  const second = (max - start) / delta;
  return [Math.min(first, second), Math.max(first, second)];
}

export function segmentIntersectsObstacle(start, end, obstacle) {
  const localStart = localPoint(start, obstacle);
  const localEnd = localPoint(end, obstacle);
  const dx = localEnd.x - localStart.x;
  const dz = localEnd.z - localStart.z;
  const xInterval = segmentAxisInterval(localStart.x, dx, -obstacle.hw, obstacle.hw);
  const zInterval = segmentAxisInterval(localStart.z, dz, -obstacle.hd, obstacle.hd);
  if (!xInterval || !zInterval) return false;
  const entry = Math.max(0, xInterval[0], zInterval[0]);
  const exit = Math.min(1, xInterval[1], zInterval[1]);
  return entry <= exit + EPSILON;
}

export function obstacleOverlapsLocalPoint(obstacle, point, margin = 0) {
  return pointInsideObstacle(point, createObstacleGeometry(obstacle), margin);
}
