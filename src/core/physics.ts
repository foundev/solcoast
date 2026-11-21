import { clamp, forwardFromYaw, resolveCircleAABB, rightFromYaw, type AABB } from './math';
import { getGroundHeight, isDeepWater } from '../world/cityData';

export type HumanRagdollMode = 'normal' | 'stumble' | 'airborne' | 'downed' | 'recovering';

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
  // Relative closing velocity along outward normal
  const relVx = car.vx - body.vx;
  const relVz = car.vz - body.vz;
  const closingAlongNormal = Math.max(0, relVx * hit.nx + relVz * hit.nz);
  const impactSpeed = Math.max(closingAlongNormal, carSpeed * 0.65);

  if (impactSpeed < 1.8) {
    // Stationary / creeping solid contact
    return 0;
  }

  // Avoid re-launching a body that was just launched this fraction of a second
  if (body.ragdollMode === 'airborne' && body.vy > 1.5 && closingAlongNormal < 3.5) {
    return 0;
  }

  body.lastImpactSpeed = Math.max(body.lastImpactSpeed, impactSpeed);

  if (impactSpeed < 5.8) {
    // Low-speed fender bump -> stumble recoil away from car
    const pushSpeed = clamp(impactSpeed * 1.15, 2.2, 6.2);
    body.vx = hit.nx * pushSpeed + car.vx * 0.35;
    body.vz = hit.nz * pushSpeed + car.vz * 0.35;
    body.ragdollMode = 'stumble';
    body.ragdollTimer = isPlayer ? 0.36 : 0.55;
    body.fallPitch = clamp(-impactSpeed * 0.08, -0.42, 0.42);
    body.fallRoll = clamp(hit.localX * 0.22, -0.35, 0.35);
    body.lastImpactKind = 'bump';
    return impactSpeed;
  }

  // Medium / high-speed impact -> realistic hood-launch, parabolic arc & multi-axis tumble!
  const speedFactor = clamp((impactSpeed - 5.5) / 22, 0, 1);
  const sideDeflect = (hit.localX >= 0 ? 1 : -1) * (1.4 + speedFactor * 2.2);
  const right = rightFromYaw(car.yaw);

  // Momentum transfer: carry ~88% of car velocity + normal kick + lateral fender deflection
  const launchScale = isPlayer ? 0.82 : 0.96;
  body.vx = clamp(car.vx * launchScale + hit.nx * (3.2 + speedFactor * 3.8) + right.x * sideDeflect, -32, 32);
  body.vz = clamp(car.vz * launchScale + hit.nz * (3.2 + speedFactor * 3.8) + right.z * sideDeflect, -32, 32);
  body.vy = clamp(3.0 + impactSpeed * 0.22, 3.2, isPlayer ? 7.6 : 9.4);

  // Align fall direction along impact velocity & spin naturally based on off-center hit lever arm
  body.ragdollMode = 'airborne';
  body.ragdollTimer = isPlayer ? 0.95 : 1.7 + speedFactor * 1.1;
  const frontHitSign = hit.localZ <= 0 ? -1 : 1;
  body.angVelPitch = frontHitSign * (4.2 + speedFactor * 6.5);
  body.angVelRoll = clamp(hit.localX * 3.8, -5.5, 5.5);
  body.angVelYaw = clamp(-hit.localX * 4.5, -6.5, 6.5);
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
