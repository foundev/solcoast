export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

/**
 * Compass yaw convention:
 *   0       = North (-Z)
 *   +PI/2   = East  (+X, Atlantic Ocean)
 *   PI      = South (+Z, Marina Cove)
 *   -PI/2   = West  (-X, Downtown Biscayne)
 * Matches Three.js mesh.rotation.y = -yaw when local forward is -Z.
 */
export function forwardFromYaw(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

export function rightFromYaw(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: Math.sin(yaw) };
}

export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

export function distXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Smooth circle-vs-AABB resolution in the XZ plane.
 * Returns push vector (dx, dz) to separate the circle from the box.
 */
export function resolveCircleAABB(
  cx: number,
  cz: number,
  radius: number,
  box: AABB,
): { dx: number; dz: number; hit: boolean } {
  const closestX = clamp(cx, box.minX, box.maxX);
  const closestZ = clamp(cz, box.minZ, box.maxZ);
  const vx = cx - closestX;
  const vz = cz - closestZ;
  const distSq = vx * vx + vz * vz;

  if (distSq >= radius * radius) {
    return { dx: 0, dz: 0, hit: false };
  }

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    return { dx: (vx / dist) * push, dz: (vz / dist) * push, hit: true };
  }

  // Circle center is inside the box; push out along minimum penetration axis.
  const left = cx - box.minX;
  const right = box.maxX - cx;
  const top = cz - box.minZ;
  const bottom = box.maxZ - cz;

  let minPen = left;
  let dx = -(left + radius);
  let dz = 0;

  if (right < minPen) {
    minPen = right;
    dx = right + radius;
    dz = 0;
  }
  if (top < minPen) {
    minPen = top;
    dx = 0;
    dz = -(top + radius);
  }
  if (bottom < minPen) {
    dx = 0;
    dz = bottom + radius;
  }
  return { dx, dz, hit: true };
}

/** Deterministic PRNG (Mulberry32) so city generation is reproducible. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
