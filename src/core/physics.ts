import { clamp, forwardFromYaw, resolveCircleAABB, rightFromYaw, type AABB } from './math';
import { getGroundHeight, isDeepWater } from '../world/cityData';

export type HumanRagdollMode = 'normal' | 'stumble' | 'airborne' | 'downed' | 'recovering';

export interface PendingRagdollImpact {
  vx: number;
  vy: number;
  vz: number;
  hitZone: 'bumper' | 'body';
  sideOffset: number;
}

export interface HumanBodyPhysics {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  ragdollMode: HumanRagdollMode;
  ragdollTimer: number;
  fallPitch: number;
  fallRoll: number;
  angVelPitch: number;
  angVelRoll: number;
  angVelYaw: number;
  lastImpactSpeed: number;
  lastImpactKind: 'none' | 'bump' | 'body';
  /** Set on heavy car/sprint hits so Rapier3D spawns a live 11-limb articulated ragdoll */
  pendingRagdollImpact: PendingRagdollImpact | null;
  /** True while Rapier3D physics or 3-stage physical get-up owns this character's skeleton */
  rapierControlled: boolean;
}

export interface OrientedCarHull {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  halfWidth?: number;
  halfLength?: number;
}

export interface RigidCarBody {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  yawRate: number;
  mass: number;
  halfWidth?: number;
  halfLength?: number;
}

export interface CarCollisionContact {
  hit: boolean;
  /** Outward unit normal pointing from B (or wall) toward A */
  nx: number;
  nz: number;
  penetration: number;
  contactX: number;
  contactZ: number;
  /** Relative closing speed along impact normal (m/s, >= 0) */
  closingSpeed: number;
}

function getObbCorners(cx: number, cz: number, rightX: number, rightZ: number, fwdX: number, fwdZ: number, hw: number, hl: number): [number, number][] {
  return [
    [cx + rightX * hw + fwdX * hl, cz + rightZ * hw + fwdZ * hl],
    [cx - rightX * hw + fwdX * hl, cz - rightZ * hw + fwdZ * hl],
    [cx - rightX * hw - fwdX * hl, cz - rightZ * hw - fwdZ * hl],
    [cx + rightX * hw - fwdX * hl, cz + rightZ * hw - fwdZ * hl],
  ];
}

/**
 * Exact 2D Separating Axis Theorem (SAT) Oriented-Box vs. Oriented-Box collision solver
 * with true rigid-body mass, moment of inertia, lever-arm yaw torque (PIT maneuvers & T-bones!),
 * inelastic automotive restitution, and tangential metal-scraping friction.
 */
export function resolveCarVsCarSAT(a: RigidCarBody, b: RigidCarBody): CarCollisionContact {
  const hwA = a.halfWidth ?? 1.06;
  const hlA = a.halfLength ?? 2.28;
  const hwB = b.halfWidth ?? 1.06;
  const hlB = b.halfLength ?? 2.28;

  // Quick broadphase circle reject
  const maxR = Math.hypot(hwA, hlA) + Math.hypot(hwB, hlB);
  const dxCenter = a.x - b.x;
  const dzCenter = a.z - b.z;
  if (dxCenter * dxCenter + dzCenter * dzCenter > maxR * maxR) {
    return { hit: false, nx: 0, nz: 0, penetration: 0, contactX: 0, contactZ: 0, closingSpeed: 0 };
  }

  const fwdA = forwardFromYaw(a.yaw);
  const rightA = rightFromYaw(a.yaw);
  const fwdB = forwardFromYaw(b.yaw);
  const rightB = rightFromYaw(b.yaw);

  const axes: [number, number][] = [
    [rightA.x, rightA.z],
    [fwdA.x, fwdA.z],
    [rightB.x, rightB.z],
    [fwdB.x, fwdB.z],
  ];

  let minOverlap = Infinity;
  let bestAxisX = 0;
  let bestAxisZ = 0;
  let bestAxisIdx = 0;

  for (let i = 0; i < 4; i++) {
    const [ax, az] = axes[i];
    const projA =
      hwA * Math.abs(rightA.x * ax + rightA.z * az) +
      hlA * Math.abs(fwdA.x * ax + fwdA.z * az);
    const projB =
      hwB * Math.abs(rightB.x * ax + rightB.z * az) +
      hlB * Math.abs(fwdB.x * ax + fwdB.z * az);
    const dist = Math.abs(dxCenter * ax + dzCenter * az);
    const overlap = projA + projB - dist;
    if (overlap <= 0) {
      return { hit: false, nx: 0, nz: 0, penetration: 0, contactX: 0, contactZ: 0, closingSpeed: 0 };
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxisX = ax;
      bestAxisZ = az;
      bestAxisIdx = i;
    }
  }

  // Ensure normal points from B -> A
  if (dxCenter * bestAxisX + dzCenter * bestAxisZ < 0) {
    bestAxisX = -bestAxisX;
    bestAxisZ = -bestAxisZ;
  }

  // Estimate contact point: deepest vertex of the incident box along the collision normal
  const cornersA = getObbCorners(a.x, a.z, rightA.x, rightA.z, fwdA.x, fwdA.z, hwA, hlA);
  const cornersB = getObbCorners(b.x, b.z, rightB.x, rightB.z, fwdB.x, fwdB.z, hwB, hlB);

  let contactX = (a.x + b.x) * 0.5;
  let contactZ = (a.z + b.z) * 0.5;
  if (bestAxisIdx < 2) {
    // Axis came from A: B's vertex furthest along +normal (into A) is the contact!
    let bestProj = -Infinity;
    for (const [cx, cz] of cornersB) {
      const p = cx * bestAxisX + cz * bestAxisZ;
      if (p > bestProj) {
        bestProj = p;
        contactX = cx;
        contactZ = cz;
      }
    }
  } else {
    // Axis came from B: A's vertex furthest along -normal (into B) is the contact!
    let bestProj = Infinity;
    for (const [cx, cz] of cornersA) {
      const p = cx * bestAxisX + cz * bestAxisZ;
      if (p < bestProj) {
        bestProj = p;
        contactX = cx;
        contactZ = cz;
      }
    }
  }

  // Mass-weighted positional separation (prevents ANY overlap or ghosting!)
  const invMassA = a.mass > 0 ? 1 / a.mass : 0;
  const invMassB = b.mass > 0 ? 1 / b.mass : 0;
  const totalInvMass = invMassA + invMassB;
  if (totalInvMass > 0) {
    const sep = minOverlap + 0.005;
    a.x += bestAxisX * sep * (invMassA / totalInvMass);
    a.z += bestAxisZ * sep * (invMassA / totalInvMass);
    b.x -= bestAxisX * sep * (invMassB / totalInvMass);
    b.z -= bestAxisZ * sep * (invMassB / totalInvMass);
  }

  // 2D rigid-body rotational inertia (with yawRate increasing clockwise from -Z toward +X:
  // v_rot = (-yawRate * rz, +yawRate * rx) — wait: let's verify!
  // forwardFromYaw(yaw) = (sin(yaw), -cos(yaw)); d/dyaw (sin, -cos) = (cos, sin) = rightFromYaw!
  // For any offset (rx, rz), rotating clockwise by +dyaw maps (rx, rz) -> (rx - rz*dyaw, rz + rx*dyaw)!
  // So rotational velocity at (rx, rz) is: vx_rot = -yawRate * rz, vz_rot = +yawRate * rx!
  // And torque from force (fx, fz) at (rx, rz) is: tau = rx * fz - rz * fx!
  // Effective automotive yaw inertia (heavy front engine + chassis frame resists over-spinning
  // while transferring punchy GTA-style linear shove AND crisp PIT-maneuver spin!)
  const wA = hwA * 2;
  const lA = hlA * 2;
  const wB = hwB * 2;
  const lB = hlB * 2;
  const invInertiaA = a.mass > 0 ? 7.5 / (a.mass * (wA * wA + lA * lA)) : 0;
  const invInertiaB = b.mass > 0 ? 7.5 / (b.mass * (wB * wB + lB * lB)) : 0;

  const rAx = contactX - a.x;
  const rAz = contactZ - a.z;
  const rBx = contactX - b.x;
  const rBz = contactZ - b.z;

  const vAx = a.vx - a.yawRate * rAz;
  const vAz = a.vz + a.yawRate * rAx;
  const vBx = b.vx - b.yawRate * rBz;
  const vBz = b.vz + b.yawRate * rBx;

  const relVx = vAx - vBx;
  const relVz = vAz - vBz;
  const velAlongNormal = relVx * bestAxisX + relVz * bestAxisZ;

  if (velAlongNormal >= 0) {
    return {
      hit: true,
      nx: bestAxisX,
      nz: bestAxisZ,
      penetration: minOverlap,
      contactX,
      contactZ,
      closingSpeed: 0,
    };
  }

  const closingSpeed = -velAlongNormal;
  const rACrossN = rAx * bestAxisZ - rAz * bestAxisX;
  const rBCrossN = rBx * bestAxisZ - rBz * bestAxisX;

  const denomN =
    totalInvMass +
    rACrossN * rACrossN * invInertiaA +
    rBCrossN * rBCrossN * invInertiaB;

  // Automotive inelastic crunch restitution (metallic energy absorption, not rubber superball!)
  const restitution = closingSpeed < 2.0 ? 0.08 : 0.24;
  const jN = (-(1 + restitution) * velAlongNormal) / Math.max(1e-6, denomN);

  // Tangential scraping friction impulse
  const tx = -bestAxisZ;
  const tz = bestAxisX;
  const velAlongT = relVx * tx + relVz * tz;
  const rACrossT = rAx * tz - rAz * tx;
  const rBCrossT = rBx * tz - rBz * tx;
  const denomT =
    totalInvMass +
    rACrossT * rACrossT * invInertiaA +
    rBCrossT * rBCrossT * invInertiaB;
  const mu = 0.34;
  const jT = clamp(-velAlongT / Math.max(1e-6, denomT), -jN * mu, jN * mu);

  const impX = bestAxisX * jN + tx * jT;
  const impZ = bestAxisZ * jN + tz * jT;

  a.vx += impX * invMassA;
  a.vz += impZ * invMassA;
  a.yawRate = clamp(a.yawRate + (rAx * impZ - rAz * impX) * invInertiaA, -5.5, 5.5);

  b.vx -= impX * invMassB;
  b.vz -= impZ * invMassB;
  b.yawRate = clamp(b.yawRate - (rBx * impZ - rBz * impX) * invInertiaB, -5.5, 5.5);

  return {
    hit: true,
    nx: bestAxisX,
    nz: bestAxisZ,
    penetration: minOverlap,
    contactX,
    contactZ,
    closingSpeed,
  };
}

/**
 * Exact 2D SAT Oriented-Car vs. Axis-Aligned Building/Wall collision solver.
 * Connects crisply at bumper/fender corners and applies authentic glancing corner-spin torque!
 */
export function resolveCarVsBuildingSAT(car: RigidCarBody, box: AABB): CarCollisionContact {
  const staticWall: RigidCarBody = {
    x: (box.minX + box.maxX) * 0.5,
    z: (box.minZ + box.maxZ) * 0.5,
    vx: 0,
    vz: 0,
    yaw: 0,
    yawRate: 0,
    mass: 0, // Infinite mass static wall
    halfWidth: (box.maxX - box.minX) * 0.5,
    halfLength: (box.maxZ - box.minZ) * 0.5,
  };
  return resolveCarVsCarSAT(car, staticWall);
}

export interface ObbHitResult {
  hit: boolean;
  /** Outward separation vector in world XZ */
  dx: number;
  dz: number;
  /** Unit normal pointing from car toward circle */
  nx: number;
  nz: number;
  /** Signed local X offset along car right axis (useful for realistic spin lever arm) */
  localX: number;
  /** Signed local Z offset along car forward axis (-halfLen = front bumper, +halfLen = rear) */
  localZ: number;
}

/**
 * Exact 2D circle vs. oriented car bounding box (OBB) collision in world XZ.
 * Gives crisp bumper/fender contacts instead of oversized circular invisible walls.
 */
export function resolveCircleOrientedCar(
  cx: number,
  cz: number,
  radius: number,
  car: OrientedCarHull,
): ObbHitResult {
  const halfW = car.halfWidth ?? 1.06;
  const halfL = car.halfLength ?? 2.28;

  const fwd = forwardFromYaw(car.yaw);
  const right = rightFromYaw(car.yaw);

  const relX = cx - car.x;
  const relZ = cz - car.z;

  // Express circle center in car's local frame (localX = right, localZ = -forward so front is -halfL)
  const localX = relX * right.x + relZ * right.z;
  const localZ = -(relX * fwd.x + relZ * fwd.z);

  const clampedX = clamp(localX, -halfW, halfW);
  const clampedZ = clamp(localZ, -halfL, halfL);

  let diffX = localX - clampedX;
  let diffZ = localZ - clampedZ;
  const distSq = diffX * diffX + diffZ * diffZ;

  if (distSq >= radius * radius) {
    return { hit: false, dx: 0, dz: 0, nx: 0, nz: 0, localX, localZ };
  }

  let pushLocalX = 0;
  let pushLocalZ = 0;
  let nLocalX = 0;
  let nLocalZ = 0;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    const pen = radius - dist;
    nLocalX = diffX / dist;
    nLocalZ = diffZ / dist;
    pushLocalX = nLocalX * pen;
    pushLocalZ = nLocalZ * pen;
  } else {
    // Center is inside car hull — eject cleanly along nearest face
    const penX = halfW - Math.abs(localX) + radius;
    const penZ = halfL - Math.abs(localZ) + radius;
    if (penX < penZ) {
      nLocalX = localX >= 0 ? 1 : -1;
      pushLocalX = nLocalX * penX;
    } else {
      nLocalZ = localZ >= 0 ? 1 : -1;
      pushLocalZ = nLocalZ * penZ;
    }
  }

  // Transform separation & normal back to world XZ
  const dx = right.x * pushLocalX - fwd.x * pushLocalZ;
  const dz = right.z * pushLocalX - fwd.z * pushLocalZ;
  const nx = right.x * nLocalX - fwd.x * nLocalZ;
  const nz = right.z * nLocalX - fwd.z * nLocalZ;

  return { hit: true, dx, dz, nx, nz, localX, localZ };
}

/**
 * Applies a realistic car-vs-human bumper/fender collision impulse.
 * - Creeping/parked (< 2.5 m/s): solid separation + gentle balance step
 * - Low bump (2.5..6.5 m/s): stumble/shove knockback
 * - Medium/High speed (>= 6.5 m/s): hood launch + multi-axis tumble + slide + recovery
 * Returns impact speed (> 0 if hit occurred).
 */
export function applyCarHitToHuman(
  body: HumanBodyPhysics,
  car: OrientedCarHull,
  hit: ObbHitResult,
  isPlayer = false,
): number {
  // Always separate human cleanly outside the car's body so nobody clips through metal
  body.x += hit.dx;
  body.z += hit.dz;

  const carSpeed = Math.hypot(car.vx, car.vz);
  // A parked or slowly creeping car (< 3.5 m/s) is just a solid obstacle — NEVER launches a walking human!
  if (carSpeed < 3.5) {
    return 0;
  }

  // Only count kinetic impact from the car actually moving INTO the person (not the person walking into a stopped car!)
  const carTowardHuman = Math.max(0, car.vx * hit.nx + car.vz * hit.nz);
  const impactSpeed = Math.max(carTowardHuman, carSpeed * 0.45);
  if (carTowardHuman < 1.2 && carSpeed < 5.5) {
    return 0;
  }

  // Avoid re-launching a body that was just launched this fraction of a second
  if (body.ragdollMode === 'airborne' && body.vy > 1.5 && carTowardHuman < 3.5) {
    return 0;
  }

  body.lastImpactSpeed = Math.max(body.lastImpactSpeed, impactSpeed);

  if (impactSpeed < 6.0) {
    // Low-speed moving fender bump -> mild stumble step back away from bumper
    const pushSpeed = clamp(impactSpeed * 0.8, 1.8, 4.2);
    body.vx = hit.nx * pushSpeed + car.vx * 0.25;
    body.vz = hit.nz * pushSpeed + car.vz * 0.25;
    body.ragdollMode = 'stumble';
    body.ragdollTimer = isPlayer ? 0.32 : 0.5;
    body.fallPitch = clamp(-impactSpeed * 0.05, -0.24, 0.24);
    body.fallRoll = clamp(hit.localX * 0.14, -0.2, 0.2);
    body.lastImpactKind = 'bump';
    return impactSpeed;
  }

  // Medium / high-speed moving car hit -> realistic hood-roll & Rapier3D articulated ragdoll!
  const speedFactor = clamp((impactSpeed - 6.0) / 22, 0, 1);
  const sideDeflect = (hit.localX >= 0 ? 1 : -1) * (0.9 + speedFactor * 1.4);
  const right = rightFromYaw(car.yaw);

  // Realistic momentum transfer (bodies roll 4-8m off the hood instead of flying 25m!)
  const launchScale = isPlayer ? 0.58 : 0.72;
  body.vx = clamp(car.vx * launchScale + hit.nx * (1.6 + speedFactor * 2.0) + right.x * sideDeflect, -18, 18);
  body.vz = clamp(car.vz * launchScale + hit.nz * (1.6 + speedFactor * 2.0) + right.z * sideDeflect, -18, 18);
  body.vy = clamp(2.1 + impactSpeed * 0.14, 2.2, isPlayer ? 4.8 : 6.2);

  // Queue real Rapier3D 11-limb articulated ragdoll impulse (bumper sweeps legs onto sloped hood!)
  body.pendingRagdollImpact = {
    vx: body.vx,
    vy: body.vy,
    vz: body.vz,
    hitZone: 'bumper',
    sideOffset: clamp(hit.localX, -1, 1),
  };

  // Fallback kinematic tumble fields (used only in headless unit tests when Rapier3D is not mounted)
  body.ragdollMode = 'airborne';
  body.ragdollTimer = isPlayer ? 0.85 : 1.5 + speedFactor * 0.9;
  const frontHitSign = hit.localZ <= 0 ? -1 : 1;
  body.angVelPitch = frontHitSign * (3.6 + speedFactor * 5.2);
  body.angVelRoll = clamp(hit.localX * 3.0, -4.5, 4.5);
  body.angVelYaw = clamp(-hit.localX * 3.5, -5.0, 5.0);
  body.lastImpactKind = 'body';

  return impactSpeed;
}

/**
 * Steps realistic 3D stumble, airborne tumble, bounce, asphalt slide, and stand-up recovery
 * for a knocked human (either pedestrian or player). Returns true while ragdoll controls motion.
 */
export function stepHumanRagdollPhysics(
  body: HumanBodyPhysics,
  dt: number,
  colliders: AABB[],
  isPlayer = false,
): boolean {
  if (body.ragdollMode === 'normal') return false;

  const safeDt = clamp(dt, 0.001, 0.05);
  const prevX = body.x;
  const prevZ = body.z;

  if (body.ragdollMode === 'stumble') {
    body.ragdollTimer -= safeDt;
    body.vx *= Math.exp(-7.2 * safeDt);
    body.vz *= Math.exp(-7.2 * safeDt);
    let nextX = body.x + body.vx * safeDt;
    let nextZ = body.z + body.vz * safeDt;

    for (const box of colliders) {
      const res = resolveCircleAABB(nextX, nextZ, 0.45, box);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
        body.vx *= -0.25;
        body.vz *= -0.25;
      }
    }
    if (!isDeepWater(nextX, nextZ)) {
      body.x = nextX;
      body.z = nextZ;
    }
    const groundY = getGroundHeight(body.x, body.z);
    body.y += (groundY - body.y) * clamp(safeDt * 20, 0, 1);
    body.vy = 0;

    // Ease torso lean back upright as balance recovers
    body.fallPitch *= Math.exp(-6.5 * safeDt);
    body.fallRoll *= Math.exp(-6.5 * safeDt);

    if (body.ragdollTimer <= 0) {
      body.ragdollMode = 'normal';
      body.fallPitch = 0;
      body.fallRoll = 0;
      body.vx = 0;
      body.vz = 0;
    }
    return !isPlayer; // Player retains partial foot control during mild stumbles
  }

  if (body.ragdollMode === 'airborne') {
    body.vy -= 22.0 * safeDt;
    body.vx *= Math.exp(-0.35 * safeDt);
    body.vz *= Math.exp(-0.35 * safeDt);

    let nextX = body.x + body.vx * safeDt;
    let nextZ = body.z + body.vz * safeDt;
    let nextY = body.y + body.vy * safeDt;

    // Realistic bounce off building walls (never fly inside buildings!)
    for (const box of colliders) {
      const res = resolveCircleAABB(nextX, nextZ, 0.48, box);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
        const len = Math.hypot(res.dx, res.dz) || 1;
        const nx = res.dx / len;
        const nz = res.dz / len;
        const vn = body.vx * nx + body.vz * nz;
        if (vn < 0) {
          body.vx -= 1.45 * vn * nx;
          body.vz -= 1.45 * vn * nz;
          body.vx *= 0.65;
          body.vz *= 0.65;
          body.angVelPitch *= -0.45;
          body.lastImpactSpeed = Math.max(body.lastImpactSpeed, -vn);
          body.lastImpactKind = 'bump';
        }
      }
    }

    if (isDeepWater(nextX, nextZ)) {
      nextX = prevX;
      nextZ = prevZ;
      body.vx *= -0.35;
      body.vz *= -0.35;
    }

    body.x = nextX;
    body.z = nextZ;
    body.y = nextY;

    // Tumble rotation in midair
    body.fallPitch += body.angVelPitch * safeDt;
    body.fallRoll += body.angVelRoll * safeDt;
    body.yaw += body.angVelYaw * safeDt;

    const groundY = getGroundHeight(body.x, body.z);
    if (body.y <= groundY) {
      body.y = groundY;
      if (body.vy < -2.4) {
        // Realistic damped human ground bounce & skid impact
        body.lastImpactSpeed = Math.max(body.lastImpactSpeed, -body.vy);
        body.lastImpactKind = 'bump';
        body.vy = -body.vy * 0.24;
        body.vx *= 0.68;
        body.vz *= 0.68;
        body.angVelPitch *= 0.45;
        body.angVelRoll *= 0.45;
        body.angVelYaw *= 0.35;
      } else {
        body.vy = 0;
        body.ragdollMode = 'downed';
        // Snap target orientation to nearest flat-on-back (-PI/2) or flat-on-front (+PI/2)
        const wrappedPitch = Math.atan2(Math.sin(body.fallPitch), Math.cos(body.fallPitch));
        body.fallPitch = wrappedPitch;
        body.fallRoll = Math.atan2(Math.sin(body.fallRoll), Math.cos(body.fallRoll)) * 0.35;
        body.angVelPitch = 0;
        body.angVelRoll = 0;
        body.angVelYaw = 0;
      }
    }
    return true;
  }

  if (body.ragdollMode === 'downed') {
    // High asphalt/sand slide friction until body comes to rest
    body.vx *= Math.exp(-5.8 * safeDt);
    body.vz *= Math.exp(-5.8 * safeDt);
    let nextX = body.x + body.vx * safeDt;
    let nextZ = body.z + body.vz * safeDt;

    for (const box of colliders) {
      const res = resolveCircleAABB(nextX, nextZ, 0.48, box);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
        body.vx *= -0.2;
        body.vz *= -0.2;
      }
    }
    if (!isDeepWater(nextX, nextZ)) {
      body.x = nextX;
      body.z = nextZ;
    }
    body.y = getGroundHeight(body.x, body.z);
    body.vy = 0;

    // Settle cleanly flat onto the ground (either supine -PI/2 or prone +PI/2)
    const targetFlat = body.fallPitch >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    body.fallPitch += (targetFlat - body.fallPitch) * clamp(safeDt * 12, 0, 1);
    body.fallRoll *= Math.exp(-10 * safeDt);

    const slideSpeed = Math.hypot(body.vx, body.vz);
    if (slideSpeed < 0.45) {
      body.ragdollTimer -= safeDt;
      if (body.ragdollTimer <= 0) {
        body.ragdollMode = 'recovering';
        body.ragdollTimer = isPlayer ? 0.52 : 0.72;
        body.vx = 0;
        body.vz = 0;
      }
    }
    return true;
  }

  if (body.ragdollMode === 'recovering') {
    body.ragdollTimer -= safeDt;
    body.y = getGroundHeight(body.x, body.z);
    body.fallPitch *= Math.exp(-7.5 * safeDt);
    body.fallRoll *= Math.exp(-7.5 * safeDt);
    if (body.ragdollTimer <= 0) {
      body.ragdollMode = 'normal';
      body.fallPitch = 0;
      body.fallRoll = 0;
      body.vx = 0;
      body.vz = 0;
    }
    return true;
  }

  return false;
}

/**
 * Computes visual center-of-mass pivot height (y) so a standing character's feet sit at y=0,
 * an airborne body spins around its torso center (0.92m), and a downed body lies flush
 * on top of the pavement (0.19m) instead of sinking halfway underground!
 */
export function computeTumblePivotY(fallPitch: number, fallRoll: number, ragdollMode: HumanRagdollMode): number {
  const flatAmount = clamp(
    Math.max(Math.abs(Math.sin(fallPitch)), Math.abs(Math.sin(fallRoll))),
    0,
    1,
  );
  if (ragdollMode === 'airborne') {
    // Keep pelvis elevated slightly while spinning midair so head/legs don't clip floor before impact
    return 0.92 - flatAmount * 0.36;
  }
  // Lying flat on ground: lower center-of-mass smoothly to body thickness (~0.19m)
  return 0.92 - flatAmount * 0.73;
}
