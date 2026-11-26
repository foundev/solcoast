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

/** Tight 2D Oriented Bounding Box in world XZ (rotY matches Three.js mesh.rotation.y). */
export interface OBB2D {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  rotY: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const twoPi = Math.PI * 2;
  let a = (((rad + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  if (a <= -Math.PI) a += twoPi;
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

const NO_CIRCLE_HIT: Readonly<{ dx: number; dz: number; hit: boolean }> = Object.freeze({
  dx: 0,
  dz: 0,
  hit: false,
});

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
  if (
    cx < box.minX - radius ||
    cx > box.maxX + radius ||
    cz < box.minZ - radius ||
    cz > box.maxZ + radius
  ) {
    return NO_CIRCLE_HIT;
  }

  const closestX = cx < box.minX ? box.minX : cx > box.maxX ? box.maxX : cx;
  const closestZ = cz < box.minZ ? box.minZ : cz > box.maxZ ? box.maxZ : cz;
  const vx = cx - closestX;
  const vz = cz - closestZ;
  const distSq = vx * vx + vz * vz;

  if (distSq >= radius * radius) {
    return NO_CIRCLE_HIT;
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

/**
 * Exact 2D circle vs. oriented bounding box (OBB) resolution in world XZ.
 * Shared across all indoor furniture props AND outdoor street/beach/park props!
 */
export function resolveCircleOBB(
  px: number,
  pz: number,
  radius: number,
  obb: OBB2D,
): { hit: boolean; dx: number; dz: number } {
  // Fast scalar broadphase reject (avoids Math.hypot on 99.9% of non-colliding OBBs!)
  const relX = px - obb.cx;
  const relZ = pz - obb.cz;
  const maxBound = obb.halfW + obb.halfD + radius;
  if (
    relX > maxBound ||
    relX < -maxBound ||
    relZ > maxBound ||
    relZ < -maxBound ||
    relX * relX + relZ * relZ >= maxBound * maxBound
  ) {
    return NO_CIRCLE_HIT;
  }

  const cos = obb.rotY === 0 ? 1 : Math.cos(obb.rotY);
  const sin = obb.rotY === 0 ? 0 : Math.sin(obb.rotY);

  // Transform point into OBB local frame (inverse of Three.js Y-rotation)
  const lx = relX * cos - relZ * sin;
  const lz = relX * sin + relZ * cos;

  const clx = clamp(lx, -obb.halfW, obb.halfW);
  const clz = clamp(lz, -obb.halfD, obb.halfD);
  const dlx = lx - clx;
  const dlz = lz - clz;
  const dSq = dlx * dlx + dlz * dlz;

  if (dSq >= radius * radius) return NO_CIRCLE_HIT;

  let plx = 0;
  let plz = 0;
  if (dSq > 1e-6) {
    const d = Math.sqrt(dSq);
    const push = radius - d;
    plx = (dlx / d) * push;
    plz = (dlz / d) * push;
  } else {
    const penX = obb.halfW - Math.abs(lx) + radius;
    const penZ = obb.halfD - Math.abs(lz) + radius;
    if (penX < penZ) {
      plx = lx >= 0 ? penX : -penX;
    } else {
      plz = lz >= 0 ? penZ : -penZ;
    }
  }

  return {
    hit: true,
    dx: plx * cos + plz * sin,
    dz: -plx * sin + plz * cos,
  };
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
