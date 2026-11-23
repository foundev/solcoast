import * as THREE from 'three';
import {
  clamp,
  distXZ,
  forwardFromYaw,
  lerp,
  lerpAngle,
  resolveCircleAABB,
  resolveCircleOBB,
  rightFromYaw,
  yawFromDir,
  type AABB,
  type OBB2D,
} from '../core/math';
import {
  applyCarHitToHuman,
  computeTumblePivotY,
  resolveCircleOrientedCar,
  stepHumanRagdollPhysics,
  type HumanBodyPhysics,
  type HumanRagdollMode,
} from '../core/physics';
import { getGroundHeight, isDeepWater } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
import { createHumanRigController, type HumanRigController } from './humanRig';
import type { PedestrianState } from './pedestrians';
import type { TrafficCarState } from './traffic';
import { DRIVER_SEAT_OFFSETS, type VehicleState } from './vehicle';

export interface PlayerState extends HumanBodyPhysics {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  walkPhase: number;
  vehicleId: string | null;
  walkedMeters: number;
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

export interface FootMoveInput {
  forward: number;
  right: number;
  sprint: boolean;
  jump: boolean;
  cameraYaw: number;
}

export interface CharacterPose {
  bodyOffsetY: number;
  torsoPitchX: number; // negative = lean forward (-Z)
  torsoTwistY: number;
  headCounterY: number;
  leftHipX: number; // positive = thigh swings forward (-Z)
  leftKneeX: number; // ALWAYS <= 0 (knee bends backward toward +Z)
  leftAnkleX: number;
  rightHipX: number;
  rightKneeX: number; // ALWAYS <= 0
  rightAnkleX: number;
  leftShoulderX: number; // positive = arm swings forward (-Z)
  leftElbowX: number; // ALWAYS >= 0 (elbow bends forward toward -Z)
  rightShoulderX: number;
  rightElbowX: number; // ALWAYS >= 0
}

export function createInitialPlayerState(startingVehicle: VehicleState | null): PlayerState {
  const basePhysics = {
    vx: 0,
    vy: 0,
    vz: 0,
    ragdollMode: 'normal' as HumanRagdollMode,
    ragdollTimer: 0,
    fallPitch: 0,
    fallRoll: 0,
    angVelPitch: 0,
    angVelRoll: 0,
    angVelYaw: 0,
    lastImpactSpeed: 0,
    lastImpactKind: 'none' as const,
    pendingRagdollImpact: null,
    rapierControlled: false,
  };
  if (startingVehicle) {
    return {
      ...basePhysics,
      x: startingVehicle.x,
      y: startingVehicle.y,
      z: startingVehicle.z,
      yaw: startingVehicle.yaw,
      speed: 0,
      grounded: true,
      sprinting: false,
      walkPhase: 0,
      vehicleId: startingVehicle.id,
      walkedMeters: 0,
    };
  }
  return {
    ...basePhysics,
    x: 155,
    y: getGroundHeight(155, 28),
    z: 28,
    yaw: 0,
    speed: 0,
    grounded: true,
    sprinting: false,
    walkPhase: 0,
    vehicleId: null,
    walkedMeters: 0,
  };
}

export function stepPlayerOnFoot(
  p: PlayerState,
  input: FootMoveInput,
  dt: number,
  colliders: AABB[],
  vehicles: VehicleState[],
  trafficCars: TrafficCarState[] = [],
  pedestrians: PedestrianState[] = [],
  propObbs: OBB2D[] = [],
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  p.lastImpactSpeed = 0;
  p.lastImpactKind = 'none';

  // When Rapier3D articulated ragdoll or 3-stage physical get-up owns the player, skip foot locomotion!
  if (p.rapierControlled) {
    p.sprinting = false;
    return;
  }

  // Fallback kinematic ragdoll when Rapier3D isn't mounted (e.g. headless unit tests)
  const ragdollLocked = stepHumanRagdollPhysics(p, safeDt, colliders, true);
  if (ragdollLocked) {
    p.grounded = p.ragdollMode !== 'airborne';
    p.speed = Math.hypot(p.vx, p.vz);
    p.sprinting = false;
    return;
  }

  const camFwd = forwardFromYaw(input.cameraYaw);
  const camRight = rightFromYaw(input.cameraYaw);

  let moveX = camFwd.x * input.forward + camRight.x * input.right;
  let moveZ = camFwd.z * input.forward + camRight.z * input.right;
  const moveLen = Math.hypot(moveX, moveZ);

  const stumbleDamp = p.ragdollMode === 'stumble' ? 0.55 : 1.0;
  const maxSpeed = (input.sprint ? 12.2 : 6.4) * stumbleDamp;
  p.sprinting = input.sprint && moveLen > 0.1 && p.ragdollMode === 'normal';

  if (moveLen > 0.05) {
    moveX /= moveLen;
    moveZ /= moveLen;
    const targetYaw = yawFromDir(moveX, moveZ);
    p.yaw = lerpAngle(p.yaw, targetYaw, clamp(safeDt * 13, 0, 1));
    p.speed = lerp(p.speed, maxSpeed, clamp(safeDt * 12, 0, 1));
  } else {
    p.speed = lerp(p.speed, 0, clamp(safeDt * 14, 0, 1));
    if (p.speed < 0.08) p.speed = 0;
  }

  const prevX = p.x;
  const prevZ = p.z;
  const desiredVx = moveX * p.speed + (p.ragdollMode === 'stumble' ? p.vx * 0.45 : 0);
  const desiredVz = moveZ * p.speed + (p.ragdollMode === 'stumble' ? p.vz * 0.45 : 0);
  if (p.ragdollMode === 'normal') {
    p.vx = desiredVx;
    p.vz = desiredVz;
  }
  let nextX = p.x + desiredVx * safeDt;
  let nextZ = p.z + desiredVz * safeDt;

  const radius = 0.34;
  for (const box of colliders) {
    const res = resolveCircleAABB(nextX, nextZ, radius, box);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
    }
  }
  for (const obb of propObbs) {
    const res = resolveCircleOBB(nextX, nextZ, radius, obb);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
    }
  }

  // 2-pass solid oriented hull collisions against ALL player vehicles & ALL AI traffic cars
  // (guarantees you can NEVER walk through parked fleet cars, traffic cars, or wedged pairs!)
  p.x = nextX;
  p.z = nextZ;
  for (let pass = 0; pass < 2; pass++) {
    for (const v of vehicles) {
      const hit = resolveCircleOrientedCar(p.x, p.z, radius, v);
      if (hit.hit) {
        applyCarHitToHuman(p, v, hit, true);
      }
    }

    for (const tc of trafficCars) {
      const tcHull = {
        x: tc.x,
        z: tc.z,
        yaw: tc.yaw,
        vx: tc.vx,
        vz: tc.vz,
        halfWidth: 1.06,
        halfLength: 2.28,
      };
      const hit = resolveCircleOrientedCar(p.x, p.z, radius, tcHull);
      if (hit.hit) {
        const impact = applyCarHitToHuman(p, tcHull, hit, true);
        if (impact > 2.2) {
          tc.speed *= 0.35;
        }
      }
    }

    for (const box of colliders) {
      const res = resolveCircleAABB(p.x, p.z, radius, box);
      if (res.hit) {
        p.x += res.dx;
        p.z += res.dz;
      }
    }
    for (const obb of propObbs) {
      const res = resolveCircleOBB(p.x, p.z, radius, obb);
      if (res.hit) {
        p.x += res.dx;
        p.z += res.dz;
      }
    }
  }

  // Solid shoulder-to-shoulder & sprint-tackle collisions with ALL sidewalk pedestrians!
  const pedMinDist = 0.86;
  for (const ped of pedestrians) {
    if (ped.ragdollMode === 'airborne' && ped.y > p.y + 1.4) continue;
    const dx = p.x - ped.x;
    const dz = p.z - ped.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < pedMinDist * pedMinDist && dSq > 1e-6) {
      const d = Math.sqrt(dSq);
      const nx = dx / d; // points from pedestrian -> player
      const nz = dz / d;
      const overlap = pedMinDist - d;

      // Separate both bodies cleanly so you can NEVER walk through someone
      p.x += nx * overlap * 0.52;
      p.z += nz * overlap * 0.52;
      ped.x -= nx * overlap * 0.48;
      ped.z -= nz * overlap * 0.48;

      // Closing speed of player into pedestrian
      const closing = -(desiredVx - ped.vx) * nx - (desiredVz - ped.vz) * nz;
      if (closing > 1.4 && ped.ragdollMode !== 'airborne' && ped.ragdollMode !== 'downed') {
        p.lastImpactSpeed = Math.max(p.lastImpactSpeed, closing);
        if (closing >= 8.2 && p.sprinting) {
          // Full-speed sprint shoulder-tackle triggers real Rapier3D 11-limb knockdown!
          ped.vx = -nx * clamp(closing * 0.85, 5.5, 11.5);
          ped.vz = -nz * clamp(closing * 0.85, 5.5, 11.5);
          ped.vy = 2.6;
          ped.pendingRagdollImpact = {
            vx: ped.vx,
            vy: ped.vy,
            vz: ped.vz,
            hitZone: 'body',
            sideOffset: Math.sin(ped.id * 3.1) >= 0 ? 0.45 : -0.45,
          };
          ped.ragdollMode = 'airborne';
          ped.ragdollTimer = 1.45;
          ped.angVelPitch = 4.6;
          ped.angVelRoll = (Math.sin(ped.id * 3.1) >= 0 ? 1 : -1) * 2.2;
          ped.angVelYaw = 2.5;
          ped.lastImpactSpeed = closing;
          ped.lastImpactKind = 'body';
          p.speed *= 0.48;
          p.lastImpactKind = 'body';
        } else {
          // Realistic shoulder bump / stumble recoil
          ped.vx = -nx * clamp(closing * 0.95, 2.2, 5.6);
          ped.vz = -nz * clamp(closing * 0.95, 2.2, 5.6);
          ped.ragdollMode = 'stumble';
          ped.ragdollTimer = 0.48;
          ped.fallPitch = -clamp(closing * 0.055, 0.14, 0.36);
          ped.fallRoll = (Math.sin(ped.id * 5.7) >= 0 ? 1 : -1) * 0.18;
          ped.lastImpactSpeed = closing;
          ped.lastImpactKind = 'bump';
          p.speed *= 0.72;
          p.lastImpactKind = 'bump';
        }
      }
    }
  }

  nextX = p.x;
  nextZ = p.z;
  if (isDeepWater(nextX, nextZ)) {
    if (!isDeepWater(nextX, prevZ)) {
      nextZ = prevZ;
    } else if (!isDeepWater(prevX, nextZ)) {
      nextX = prevX;
    } else {
      nextX = prevX;
      nextZ = prevZ;
    }
  }

  p.x = nextX;
  p.z = nextZ;

  const groundY = getGroundHeight(p.x, p.z);
  if (p.grounded && input.jump && p.ragdollMode === 'normal') {
    p.vy = 8.4;
    p.grounded = false;
  }
  if (p.ragdollMode === 'airborne') {
    p.grounded = false;
  } else if (p.grounded) {
    // Smoothly step up/down curbs, ramps, and boardwalk edges without sinking into geometry
    p.y = lerp(p.y, groundY, clamp(safeDt * 24, 0, 1));
    if (Math.abs(p.y - groundY) < 0.015) p.y = groundY;
    p.vy = 0;
  } else {
    p.vy -= 24.0 * safeDt;
    p.y += p.vy * safeDt;
    if (p.y <= groundY) {
      p.y = groundY;
      p.vy = 0;
      p.grounded = true;
    }
  }

  const moved = Math.hypot(p.x - prevX, p.z - prevZ);
  p.walkedMeters += moved;
  if (p.speed > 0.2 && p.grounded) {
    p.walkPhase += p.speed * safeDt * 1.35;
  }
}

export function findNearestVehicle(
  x: number,
  z: number,
  vehicles: VehicleState[],
  maxRange = 5.2,
): { vehicle: VehicleState; dist: number } | null {
  let best: VehicleState | null = null;
  let bestDist = maxRange;
  for (const v of vehicles) {
    const d = distXZ(x, z, v.x, v.z);
    if (d <= bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best ? { vehicle: best, dist: bestDist } : null;
}

export function computeSafeExitPosition(
  v: VehicleState,
  colliders: AABB[],
): { x: number; y: number; z: number } {
  const r = rightFromYaw(v.yaw);
  const f = forwardFromYaw(v.yaw);
  const candidates = [
    { x: v.x - r.x * 2.35, z: v.z - r.z * 2.35 },
    { x: v.x + r.x * 2.35, z: v.z + r.z * 2.35 },
    { x: v.x - f.x * 3.1, z: v.z - f.z * 3.1 },
    { x: v.x + f.x * 3.1, z: v.z + f.z * 3.1 },
  ];

  for (const c of candidates) {
    if (isDeepWater(c.x, c.z)) continue;
    let blocked = false;
    for (const box of colliders) {
      if (resolveCircleAABB(c.x, c.z, 0.65, box).hit) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      return { x: c.x, y: getGroundHeight(c.x, c.z), z: c.z };
    }
  }

  return { x: v.x, y: getGroundHeight(v.x, v.z) + 0.5, z: v.z };
}

/**
 * Computes anatomically accurate joint angles for Three.js right-handed space
 * where forward is -Z and limbs hang downward along -Y:
 *  - rotateX(+theta) on (0, -L, 0) swings the limb FORWARD (-Z).
 *  - rotateX(-theta) on (0, -L, 0) swings the limb BACKWARD (+Z).
 *  - Therefore: knees ALWAYS bend backward (<= 0), elbows ALWAYS bend forward (>= 0).
 */
export function computeCharacterPose(s: PlayerState, elapsed = 0): CharacterPose {
  // Mid-air athletic jump pose
  if (!s.grounded) {
    return {
      bodyOffsetY: 0,
      torsoPitchX: -0.1,
      torsoTwistY: 0,
      headCounterY: 0,
      leftHipX: 0.42,
      leftKneeX: -0.68,
      leftAnkleX: -0.18,
      rightHipX: -0.18,
      rightKneeX: -0.45,
      rightAnkleX: -0.22,
      leftShoulderX: 0.35,
      leftElbowX: 0.72,
      rightShoulderX: -0.12,
      rightElbowX: 0.58,
    };
  }

  const moveNorm = clamp(s.speed / 6.2, 0, 1);
  const runBlend = s.sprinting ? clamp((s.speed - 5.5) / 6.0, 0, 1) : 0;

  // Idle relaxed athletic stance with subtle breathing
  if (moveNorm < 0.03) {
    const breath = Math.sin(elapsed * 2.1);
    return {
      bodyOffsetY: breath * 0.008,
      torsoPitchX: -0.015,
      torsoTwistY: 0,
      headCounterY: 0,
      leftHipX: 0.02,
      leftKneeX: -0.04,
      leftAnkleX: 0.02,
      rightHipX: -0.02,
      rightKneeX: -0.04,
      rightAnkleX: 0.02,
      leftShoulderX: -0.03,
      leftElbowX: 0.14 + breath * 0.02,
      rightShoulderX: -0.03,
      rightElbowX: 0.14 + breath * 0.02,
    };
  }

  const pL = s.walkPhase;
  const pR = s.walkPhase + Math.PI;

  const hipAmp = lerp(0.46, 0.86, runBlend) * moveNorm;
  const kneeSwingAmp = lerp(0.74, 1.32, runBlend) * moveNorm;
  const armAmp = lerp(0.36, 0.78, runBlend) * moveNorm;

  // Single-leg biomechanical gait curve:
  //   sin(p) > 0 => thigh forward; cos(p - 0.4) > 0 => swing-through / heel-lift knee flexion backward (< 0)
  const evalLeg = (p: number) => {
    const sinP = Math.sin(p);
    const hipX = sinP * hipAmp + runBlend * 0.12;
    // Knee bends backward (NEGATIVE) most during push-off -> mid-swing, straightens cleanly at heel strike (p ~ PI/2)
    const swingBend = Math.max(0, Math.cos(p - 0.35));
    const stanceSoft = 0.07 + runBlend * 0.12;
    const kneeX = -clamp((stanceSoft + swingBend * kneeSwingAmp), 0, 1.48);
    // Keep foot natural: slight plantarflexion on toe-off, level on forward strike
    const ankleX = clamp(-kneeX * 0.25 - sinP * 0.12 * moveNorm, -0.35, 0.28);
    return { hipX, kneeX, ankleX };
  };

  // Single-arm counter-swing curve (opposite to same-side leg):
  //   Elbows ALWAYS bend forward (POSITIVE), increasing on forward swing and while sprinting
  const evalArm = (legPhase: number) => {
    const swingFwd = -Math.sin(legPhase); // +1 when arm swings forward, -1 when trailing back
    const shoulderX = swingFwd * armAmp - runBlend * 0.08;
    const baseBend = lerp(0.18, 0.92, runBlend);
    const swingBend = Math.max(0, swingFwd) * lerp(0.32, 0.42, runBlend);
    const elbowX = clamp((baseBend + swingBend) * (0.35 + 0.65 * moveNorm), 0.1, 1.48);
    return { shoulderX, elbowX };
  };

  const legL = evalLeg(pL);
  const legR = evalLeg(pR);
  const armL = evalArm(pL);
  const armR = evalArm(pR);

  // Subtle counter-rotation of shoulders vs hips + vertical stride bounce
  const twist = -Math.sin(pL) * lerp(0.065, 0.13, runBlend) * moveNorm;
  const bounce = Math.abs(Math.sin(pL)) * lerp(0.028, 0.065, runBlend) * moveNorm;

  return {
    bodyOffsetY: bounce,
    torsoPitchX: -lerp(0.04, 0.18, runBlend) * moveNorm,
    torsoTwistY: twist,
    headCounterY: -twist * 0.75,
    leftHipX: legL.hipX,
    leftKneeX: legL.kneeX,
    leftAnkleX: legL.ankleX,
    rightHipX: legR.hipX,
    rightKneeX: legR.kneeX,
    rightAnkleX: legR.ankleX,
    leftShoulderX: armL.shoulderX,
    leftElbowX: armL.elbowX,
    rightShoulderX: armR.shoulderX,
    rightElbowX: armR.elbowX,
  };
}

export interface PlayerMeshHandles {
  root: THREE.Group;
  getAvatarRoot: () => THREE.Object3D | null;
  syncFromState: (
    state: PlayerState,
    elapsed?: number,
    dt?: number,
    activeVehicle?: VehicleState | null,
    activeVehicleBodyGroup?: THREE.Group | null,
    hideInHoodCam?: boolean,
  ) => void;
  attachGltfCharacter: (model: THREE.Object3D, animations: THREE.AnimationClip[]) => void;
}

const SEATED_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
] as const;

const _seatPos = new THREE.Vector3();
const _seatQuat = new THREE.Quaternion();
const _aimP0 = new THREE.Vector3();
const _aimP1 = new THREE.Vector3();
const _aimCurDir = new THREE.Vector3();
const _aimDesDir = new THREE.Vector3();
const _aimDelta = new THREE.Quaternion();
const _aimWorldQ = new THREE.Quaternion();
const _aimParentQ = new THREE.Quaternion();
const _seatReclineQ = new THREE.Quaternion();
const _seatHeadTurnQ = new THREE.Quaternion();
const _seatEul = new THREE.Euler(0, 0, 0, 'XYZ');

function aimBoneInAvatarSpace(
  avatarRoot: THREE.Object3D,
  bone: THREE.Object3D,
  child: THREE.Object3D,
  targetDirLocalToRoot: THREE.Vector3,
): void {
  if (!bone.parent) return;
  avatarRoot.updateMatrixWorld(true);
  bone.getWorldPosition(_aimP0);
  child.getWorldPosition(_aimP1);
  _aimCurDir.subVectors(_aimP1, _aimP0).normalize();

  // Convert desired direction from avatar's parent (entityRoot, facing -Z) space to world space
  const refObj = avatarRoot.parent ?? avatarRoot;
  refObj.getWorldQuaternion(_aimWorldQ);
  _aimDesDir.copy(targetDirLocalToRoot).normalize().applyQuaternion(_aimWorldQ);

  _aimDelta.setFromUnitVectors(_aimCurDir, _aimDesDir);
  bone.getWorldQuaternion(_aimWorldQ);
  _aimWorldQ.premultiply(_aimDelta);
  bone.parent.getWorldQuaternion(_aimParentQ);
  bone.quaternion.copy(_aimParentQ).invert().multiply(_aimWorldQ);
  bone.updateMatrixWorld(true);
}

/**
 * Poses the Ready Player Me street-tough protagonist cleanly seated in the driver's bucket seat,
 * legs tucked into the footwell, torso reclined slightly, head turning into corners, and both
 * hands gripping the steering wheel at 10-and-2!
 */
export function applySeatedDrivingPose(
  avatarRoot: THREE.Object3D,
  restQuats: Map<string, THREE.Quaternion>,
  steerAngle: number,
): void {
  // Start from clean rest pose so AnimationMixer tracks don't fight or drift
  for (const name of SEATED_BONES) {
    const b = avatarRoot.getObjectByName(name);
    const rq = restQuats.get(name);
    if (b && rq) b.quaternion.copy(rq);
  }

  const hips = avatarRoot.getObjectByName('Hips');
  const head = avatarRoot.getObjectByName('Head');
  const lUpLeg = avatarRoot.getObjectByName('LeftUpLeg');
  const lLeg = avatarRoot.getObjectByName('LeftLeg');
  const lFoot = avatarRoot.getObjectByName('LeftFoot');
  const rUpLeg = avatarRoot.getObjectByName('RightUpLeg');
  const rLeg = avatarRoot.getObjectByName('RightLeg');
  const rFoot = avatarRoot.getObjectByName('RightFoot');
  const lArm = avatarRoot.getObjectByName('LeftArm');
  const lFore = avatarRoot.getObjectByName('LeftForeArm');
  const lHand = avatarRoot.getObjectByName('LeftHand');
  const rArm = avatarRoot.getObjectByName('RightArm');
  const rFore = avatarRoot.getObjectByName('RightForeArm');
  const rHand = avatarRoot.getObjectByName('RightHand');

  if (hips) {
    // Anchor pelvis right at local (0, 0, 0) (aligned to DRIVER_SEAT_OFFSETS) with sporty recline
    hips.position.set(0, 0, 0);
    _seatEul.set(-0.12, 0, 0);
    _seatReclineQ.setFromEuler(_seatEul);
    hips.quaternion.multiply(_seatReclineQ);
  }

  if (head) {
    _seatEul.set(0.06, -steerAngle * 0.45, 0);
    _seatHeadTurnQ.setFromEuler(_seatEul);
    head.quaternion.multiply(_seatHeadTurnQ);
  }

  // Update ancestor chain (entity root + tumblePivot) AND descendants so bone aiming uses current-frame car orientation
  avatarRoot.updateWorldMatrix(true, true);

  if (lUpLeg && lLeg && lFoot) {
    aimBoneInAvatarSpace(avatarRoot, lUpLeg, lLeg, _seatPos.set(-0.06, -0.02, -0.998));
    aimBoneInAvatarSpace(avatarRoot, lLeg, lFoot, _seatPos.set(0, -0.68, -0.73));
  }
  if (rUpLeg && rLeg && rFoot) {
    aimBoneInAvatarSpace(avatarRoot, rUpLeg, rLeg, _seatPos.set(0.06, -0.02, -0.998));
    aimBoneInAvatarSpace(avatarRoot, rLeg, rFoot, _seatPos.set(0, -0.68, -0.73));
  }

  // Dynamic steering wheel hand motion: elbows tucked inside cabin bolsters while hands grip wheel at 10-and-2
  const steerShift = clamp(steerAngle * 0.48, -0.22, 0.22);
  if (lArm && lFore && lHand) {
    aimBoneInAvatarSpace(avatarRoot, lArm, lFore, _seatPos.set(-0.1, -0.46 + steerShift * 0.35, -0.88));
    aimBoneInAvatarSpace(avatarRoot, lFore, lHand, _seatPos.set(0.14, 0.26 + steerShift, -0.95));
  }
  if (rArm && rFore && rHand) {
    aimBoneInAvatarSpace(avatarRoot, rArm, rFore, _seatPos.set(0.1, -0.46 - steerShift * 0.35, -0.88));
    aimBoneInAvatarSpace(avatarRoot, rFore, rHand, _seatPos.set(-0.14, 0.26 - steerShift, -0.95));
  }
}

/**
 * Cleanly sculpted, anatomically proportioned 3D human character (~1.82m tall):
 * tailored Miami resort linen blazer over coral tee, rolled forearm cuffs,
 * tapered trousers, sculpted sneakers, realistic head/jaw/hair/aviators,
 * articulated hips/knees/ankles/shoulders/elbows, and soft ground contact shadow.
 */
export function createPlayerMesh(scene: THREE.Scene): PlayerMeshHandles {
  const root = new THREE.Group();
  // Center-of-mass tumble pivot (y = 0.92m) so airborne spins & downed poses lie flush on the ground
  const tumblePivot = new THREE.Group();
  tumblePivot.position.y = 0.92;
  root.add(tumblePivot);

  const body = new THREE.Group();
  body.position.y = -0.92;
  tumblePivot.add(body);

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdca581, roughness: 0.58 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xe64878, roughness: 0.78 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.74 });
  const lapelMat = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.72 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.5 });
  const buckleMat = new THREE.MeshStandardMaterial({ color: 0xd9b36c, metalness: 0.9, roughness: 0.2 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1d2638, roughness: 0.82 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.42 });
  const shoeSoleMat = new THREE.MeshStandardMaterial({ color: 0x1dd8eb, roughness: 0.35 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x231914, roughness: 0.84 });
  const shadesMat = new THREE.MeshPhysicalMaterial({
    color: 0x09101a,
    roughness: 0.05,
    metalness: 0.42,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
  });

  // Soft ground contact shadow
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 1.12),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    }),
  );
  contactShadow.rotation.x = -Math.PI * 0.5;
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // Pelvis / tailored waist + belt
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.155, 0.17, 16), pantsMat);
  pelvis.scale.set(1.14, 1, 0.76);
  pelvis.position.y = 0.92;
  pelvis.castShadow = true;
  body.add(pelvis);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.042, 16), beltMat);
  belt.scale.set(1.15, 1, 0.78);
  belt.position.y = 0.99;
  body.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.046, 0.022), buckleMat);
  buckle.position.set(0, 0.99, -0.13);
  body.add(buckle);

  // Upper Body Pivot (lumbar spine)
  const upperBody = new THREE.Group();
  upperBody.position.y = 1.0;
  body.add(upperBody);

  // Smooth anatomical Lathe torso (waist -> ribcage -> broad chest -> collar base)
  const torsoPts = [
    new THREE.Vector2(0.155, 0.0),
    new THREE.Vector2(0.16, 0.11),
    new THREE.Vector2(0.19, 0.27),
    new THREE.Vector2(0.215, 0.42),
    new THREE.Vector2(0.185, 0.49),
    new THREE.Vector2(0.08, 0.52),
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoPts, 20);
  torsoGeo.scale(1.06, 1.0, 0.66);
  const blazerTorso = new THREE.Mesh(torsoGeo, jacketMat);
  blazerTorso.castShadow = true;
  blazerTorso.receiveShadow = true;
  upperBody.add(blazerTorso);

  // Open blazer front V-panel revealing coral crew-neck tee
  const teeFront = new THREE.Mesh(
    new THREE.CylinderGeometry(0.125, 0.095, 0.47, 12, 1, false, Math.PI * 0.72, Math.PI * 0.56),
    shirtMat,
  );
  teeFront.scale.set(1.02, 1, 0.75);
  teeFront.position.set(0, 0.25, -0.052);
  upperBody.add(teeFront);

  // Tailored blazer lapels framing the V-opening
  for (const side of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.34, 0.024), lapelMat);
    lapel.position.set(side * 0.088, 0.31, -0.132);
    lapel.rotation.z = side * -0.18;
    lapel.rotation.y = side * 0.18;
    upperBody.add(lapel);
  }

  // Sculpted blazer hem/skirt tail draping slightly over belt
  const jacketHem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.168, 0.182, 0.14, 16, 1, true, -Math.PI * 0.82, Math.PI * 1.64),
    jacketMat,
  );
  jacketHem.scale.set(1.12, 1, 0.74);
  jacketHem.position.y = -0.05;
  jacketHem.castShadow = true;
  upperBody.add(jacketHem);

  // Neck + Anatomical Head Group
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.11, 12), skinMat);
  neck.position.y = 0.55;
  upperBody.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.69;
  upperBody.add(headGroup);

  // Cranium + tapered jaw + subtle nose & ears
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.112, 18, 16), skinMat);
  cranium.scale.set(0.9, 1.05, 0.98);
  cranium.position.y = 0.025;
  cranium.castShadow = true;
  headGroup.add(cranium);

  const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.052, 0.095, 14), skinMat);
  jaw.scale.set(0.95, 1, 1.02);
  jaw.position.set(0, -0.048, -0.012);
  headGroup.add(jaw);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.042, 6), skinMat);
  nose.rotation.x = -Math.PI * 0.42;
  nose.position.set(0, -0.01, -0.114);
  headGroup.add(nose);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), skinMat);
    ear.scale.set(0.45, 1.25, 0.75);
    ear.position.set(side * 0.102, 0.0, 0.005);
    headGroup.add(ear);
  }

  // Styled short coastal hair
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 14), hairMat);
  hairTop.scale.set(0.94, 0.86, 1.03);
  hairTop.position.set(0, 0.058, 0.014);
  headGroup.add(hairTop);

  const hairFront = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.08, 6, 10), hairMat);
  hairFront.rotation.z = Math.PI * 0.44;
  hairFront.position.set(0.012, 0.108, -0.052);
  headGroup.add(hairFront);

  // Reflective gold-framed aviator sunglasses
  for (const side of [-0.044, 0.044]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), shadesMat);
    lens.scale.set(1.16, 0.82, 0.3);
    lens.position.set(side, 0.012, -0.106);
    headGroup.add(lens);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.009, 0.016), buckleMat);
  bridge.position.set(0, 0.026, -0.109);
  headGroup.add(bridge);

  // Articulated Arms (natural shoulder cap -> rolled linen sleeve -> bare skin forearm -> sculpted hand)
  const makeArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.44, 0);
    // Natural outward hang so arms never clip into blazer/hips
    shoulder.rotation.z = side * 0.08;
    upperBody.add(shoulder);

    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.064, 12, 10), jacketMat);
    shoulderCap.castShadow = true;
    shoulder.add(shoulderCap);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.27, 12), jacketMat);
    upperArm.position.y = -0.145;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.04, 12), lapelMat);
    cuff.position.y = -0.275;
    shoulder.add(cuff);

    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);

    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.044, 10, 8), skinMat);
    elbow.add(elbowJoint);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.034, 0.24, 12), skinMat);
    forearm.position.y = -0.125;
    forearm.castShadow = true;
    elbow.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skinMat);
    hand.scale.set(0.75, 1.2, 0.95);
    hand.position.y = -0.27;
    elbow.add(hand);

    return { shoulder, elbow };
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  // Articulated Legs (hip -> tapered thigh -> knee -> calf -> ankle -> sculpted sneaker)
  const makeLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.108, 0.89, 0);
    body.add(hip);

    const hipCap = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), pantsMat);
    hip.add(hipCap);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.064, 0.40, 14), pantsMat);
    thigh.position.y = -0.21;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);

    const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), pantsMat);
    knee.add(kneeCap);

    const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.048, 0.40, 14), pantsMat);
    calf.position.y = -0.205;
    calf.castShadow = true;
    knee.add(calf);

    const ankle = new THREE.Group();
    ankle.position.y = -0.415;
    knee.add(ankle);

    // Sculpted athletic sneaker (heel, toe box, rubber midsole)
    const heel = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), shoeMat);
    heel.scale.set(0.96, 0.9, 1.15);
    heel.position.set(0, -0.015, 0.01);
    ankle.add(heel);

    const forefoot = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.105, 6, 10), shoeMat);
    forefoot.rotation.x = Math.PI * 0.5;
    forefoot.scale.set(1.04, 1.0, 0.85);
    forefoot.position.set(0, -0.025, -0.062);
    forefoot.castShadow = true;
    ankle.add(forefoot);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.026, 0.245), shoeSoleMat);
    sole.position.set(0, -0.052, -0.048);
    ankle.add(sole);

    return { hip, knee, ankle };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  let humanRig: HumanRigController | null = null;
  let gltfAvatarRoot: THREE.Object3D | null = null;
  const restBoneQuats = new Map<string, THREE.Quaternion>();
  const savedHipsPos = new THREE.Vector3(0, 1.02, 0);
  let wasSeated = false;

  const attachGltfCharacter = (model: THREE.Object3D, animations: THREE.AnimationClip[]) => {
    body.visible = false;
    model.position.y = -0.92;
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    restBoneQuats.clear();
    for (const name of SEATED_BONES) {
      const b = model.getObjectByName(name);
      if (b) restBoneQuats.set(name, b.quaternion.clone());
    }
    const hips = model.getObjectByName('Hips');
    if (hips) savedHipsPos.copy(hips.position);

    tumblePivot.add(model);
    gltfAvatarRoot = model;
    humanRig = createHumanRigController(model, animations);
  };

  scene.add(root);

  const syncFromState = (
    s: PlayerState,
    elapsed = 0,
    dt = 1 / 60,
    activeVehicle?: VehicleState | null,
    activeVehicleBodyGroup?: THREE.Group | null,
    hideInHoodCam = false,
  ) => {
    // When driving a vehicle, render our REAL street-tough protagonist seated behind the wheel!
    if (s.vehicleId !== null) {
      if (!gltfAvatarRoot || !activeVehicle || !activeVehicleBodyGroup || hideInHoodCam) {
        root.visible = false;
        return;
      }
      root.visible = true;
      contactShadow.visible = false;
      // CRITICAL: updateWorldMatrix(true, false) updates ancestor vehicleMesh.root as well as bodyGroup!
      // updateMatrixWorld(true) alone leaves vehicleMesh.root 1 frame stale, making the driver stick out on turns.
      activeVehicleBodyGroup.updateWorldMatrix(true, false);

      const seat = DRIVER_SEAT_OFFSETS[activeVehicle.config.modelKind] ?? DRIVER_SEAT_OFFSETS.ferrari;
      _seatPos.set(seat.x, seat.y, seat.z).applyMatrix4(activeVehicleBodyGroup.matrixWorld);
      activeVehicleBodyGroup.getWorldQuaternion(_seatQuat);

      root.position.copy(_seatPos);
      root.quaternion.copy(_seatQuat);
      // Center tumblePivot at 0 so Hips local (0,0,0) lands directly on the exact seat coordinate!
      tumblePivot.position.set(0, 0, 0);
      tumblePivot.rotation.set(0, 0, 0);
      gltfAvatarRoot.position.y = 0;
      root.updateWorldMatrix(true, true);

      applySeatedDrivingPose(gltfAvatarRoot, restBoneQuats, activeVehicle.steerAngle);
      wasSeated = true;
      return;
    }

    // Restoring on-foot stance cleanly when exiting a car
    if (wasSeated && gltfAvatarRoot) {
      wasSeated = false;
      gltfAvatarRoot.position.y = -0.92;
      const hips = gltfAvatarRoot.getObjectByName('Hips');
      if (hips) hips.position.copy(savedHipsPos);
      root.rotation.set(0, -s.yaw, 0);
    }

    root.visible = true;
    contactShadow.visible = true;

    // When Rapier3D articulated ragdoll or 3-stage physical get-up owns the player skeleton,
    // keep tumblePivot neutral so Rapier drives every real bone directly without fighting AnimationMixer!
    if (s.rapierControlled) {
      tumblePivot.position.y = 0.92;
      tumblePivot.rotation.set(0, 0, 0);
      return;
    }

    root.position.set(s.x, s.y, s.z);
    root.rotation.set(0, -s.yaw, 0);
    tumblePivot.position.y = computeTumblePivotY(s.fallPitch, s.fallRoll, s.ragdollMode);
    tumblePivot.rotation.set(s.fallPitch, 0, s.fallRoll);

    const ragdollFrozen = s.ragdollMode === 'airborne' || s.ragdollMode === 'downed';
    if (humanRig) {
      humanRig.update(dt, s.speed, s.sprinting, s.grounded, elapsed, ragdollFrozen);
      return;
    }

    const pose = computeCharacterPose(s, elapsed);
    body.position.y = pose.bodyOffsetY;
    upperBody.rotation.x = pose.torsoPitchX;
    upperBody.rotation.y = pose.torsoTwistY;
    headGroup.rotation.y = pose.headCounterY;

    leftLeg.hip.rotation.x = pose.leftHipX;
    leftLeg.knee.rotation.x = pose.leftKneeX;
    leftLeg.ankle.rotation.x = pose.leftAnkleX;

    rightLeg.hip.rotation.x = pose.rightHipX;
    rightLeg.knee.rotation.x = pose.rightKneeX;
    rightLeg.ankle.rotation.x = pose.rightAnkleX;

    leftArm.shoulder.rotation.x = pose.leftShoulderX;
    leftArm.elbow.rotation.x = pose.leftElbowX;

    rightArm.shoulder.rotation.x = pose.rightShoulderX;
    rightArm.elbow.rotation.x = pose.rightElbowX;
  };

  return {
    root,
    getAvatarRoot: () => gltfAvatarRoot,
    syncFromState,
    attachGltfCharacter,
  };
}
