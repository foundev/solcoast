import * as THREE from 'three';
import {
  clamp,
  distXZ,
  forwardFromYaw,
  lerp,
  lerpAngle,
  resolveCircleAABB,
  rightFromYaw,
  yawFromDir,
  type AABB,
} from '../core/math';
import { getGroundHeight, isDeepWater } from '../world/cityData';
import type { VehicleState } from './vehicle';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  walkPhase: number;
  vehicleId: string | null; // null = on foot
  walkedMeters: number;
}

export interface FootMoveInput {
  forward: number; // -1..+1 relative to cameraYaw
  right: number; // -1..+1 relative to cameraYaw
  sprint: boolean;
  jump: boolean;
  cameraYaw: number;
}

export function createInitialPlayerState(startingVehicle: VehicleState | null): PlayerState {
  if (startingVehicle) {
    return {
      x: startingVehicle.x,
      y: startingVehicle.y,
      z: startingVehicle.z,
      vy: 0,
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
    x: 155,
    y: getGroundHeight(155, 28),
    z: 28,
    vy: 0,
    yaw: 0,
    speed: 0,
    grounded: true,
    sprinting: false,
    walkPhase: 0,
    vehicleId: null,
    walkedMeters: 0,
  };
}

/**
 * Updates on-foot character locomotion (camera-relative walk/sprint, jump/gravity,
 * terrain height, smooth building collision, and shoreline water safety).
 */
export function stepPlayerOnFoot(
  p: PlayerState,
  input: FootMoveInput,
  dt: number,
  colliders: AABB[],
  vehicles: VehicleState[],
): void {
  const safeDt = clamp(dt, 0.001, 0.05);

  const camFwd = forwardFromYaw(input.cameraYaw);
  const camRight = rightFromYaw(input.cameraYaw);

  let moveX = camFwd.x * input.forward + camRight.x * input.right;
  let moveZ = camFwd.z * input.forward + camRight.z * input.right;
  const moveLen = Math.hypot(moveX, moveZ);

  const maxSpeed = input.sprint ? 12.2 : 6.4;
  p.sprinting = input.sprint && moveLen > 0.1;

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
  let nextX = p.x + moveX * p.speed * safeDt;
  let nextZ = p.z + moveZ * p.speed * safeDt;

  const radius = 0.55;
  for (const box of colliders) {
    const res = resolveCircleAABB(nextX, nextZ, radius, box);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
    }
  }

  // Keep player from clipping inside parked cars
  for (const v of vehicles) {
    const d = distXZ(nextX, nextZ, v.x, v.z);
    const minDist = 1.95;
    if (d < minDist && d > 1e-4) {
      const push = minDist - d;
      nextX += ((nextX - v.x) / d) * push;
      nextZ += ((nextZ - v.z) / d) * push;
    }
  }

  // Keep on-foot character safely out of deep ocean water
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

  // Jump & gravity
  const groundY = getGroundHeight(p.x, p.z);
  if (p.grounded && input.jump) {
    p.vy = 8.4;
    p.grounded = false;
  }
  p.vy -= 24.0 * safeDt;
  p.y += p.vy * safeDt;
  if (p.y <= groundY) {
    p.y = groundY;
    p.vy = 0;
    p.grounded = true;
  }

  const moved = Math.hypot(p.x - prevX, p.z - prevZ);
  p.walkedMeters += moved;
  if (p.speed > 0.2 && p.grounded) {
    p.walkPhase += p.speed * safeDt * 1.45;
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

/**
 * Finds a clean, collision-free exit point beside a vehicle (driver side first,
 * then passenger side, then rear).
 */
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

export interface PlayerMeshHandles {
  root: THREE.Group;
  syncFromState: (state: PlayerState) => void;
}

export function createPlayerMesh(scene: THREE.Scene): PlayerMeshHandles {
  const root = new THREE.Group();

  // Stylish Miami look: white/coral coastal jacket, dark shades, cyan sneakers
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6b593, roughness: 0.72 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xff5e8e, roughness: 0.6 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fc, roughness: 0.55 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1f283d, roughness: 0.75 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2cf3ff, roughness: 0.4 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x221b18, roughness: 0.85 });
  const shadesMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0d14, roughness: 0.1, clearcoat: 1.0 });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.68, 0.3), jacketMat);
  torso.position.y = 1.16;
  torso.castShadow = true;
  root.add(torso);

  const tee = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 0.315), shirtMat);
  tee.position.y = 1.15;
  root.add(tee);

  // Head + sunglasses
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), skinMat);
  head.position.y = 1.69;
  head.castShadow = true;
  root.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), hairMat);
  hair.position.y = 1.86;
  root.add(hair);

  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.08), shadesMat);
  shades.position.set(0, 1.71, -0.15);
  root.add(shades);

  // Articulated arms & legs
  const makeLimb = (w: number, h: number, d: number, mat: THREE.Material, py: number, x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, py, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = -h * 0.5;
    mesh.castShadow = true;
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  };

  const leftArm = makeLimb(0.16, 0.58, 0.16, jacketMat, 1.44, -0.36);
  const rightArm = makeLimb(0.16, 0.58, 0.16, jacketMat, 1.44, 0.36);
  const leftLeg = makeLimb(0.2, 0.72, 0.2, pantsMat, 0.82, -0.15);
  const rightLeg = makeLimb(0.2, 0.72, 0.2, pantsMat, 0.82, 0.15);

  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.12, 0.28), shoeMat);
  shoeL.position.set(0, -0.74, -0.04);
  leftLeg.add(shoeL);

  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.12, 0.28), shoeMat);
  shoeR.position.set(0, -0.74, -0.04);
  rightLeg.add(shoeR);

  scene.add(root);

  const syncFromState = (s: PlayerState) => {
    root.visible = s.vehicleId === null;
    if (!root.visible) return;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = -s.yaw;

    const swingAmp = clamp(s.speed / 8, 0, 1) * (s.sprinting ? 0.82 : 0.52);
    const swing = Math.sin(s.walkPhase) * swingAmp;
    leftLeg.rotation.x = swing;
    rightLeg.rotation.x = -swing;
    leftArm.rotation.x = -swing * 0.85;
    rightArm.rotation.x = swing * 0.85;
  };

  return { root, syncFromState };
}
