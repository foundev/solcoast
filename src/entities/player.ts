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
import { createContactShadowTexture } from '../world/textures';
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
  vehicleId: string | null;
  walkedMeters: number;
}

export interface FootMoveInput {
  forward: number;
  right: number;
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

  for (const v of vehicles) {
    const d = distXZ(nextX, nextZ, v.x, v.z);
    const minDist = 1.95;
    if (d < minDist && d > 1e-4) {
      const push = minDist - d;
      nextX += ((nextX - v.x) / d) * push;
      nextZ += ((nextZ - v.z) / d) * push;
    }
  }

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
  syncFromState: (state: PlayerState, elapsed?: number) => void;
}

/**
 * Anatomically proportioned smooth articulated humanoid character with
 * capsule/ellipsoid limbs, elbow & knee joints, tailored Miami linen jacket,
 * reflective aviator sunglasses, and soft ground contact shadow.
 */
export function createPlayerMesh(scene: THREE.Scene): PlayerMeshHandles {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdda985, roughness: 0.62 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xe64878, roughness: 0.78 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e2738, roughness: 0.8 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.45 });
  const shoeAccentMat = new THREE.MeshStandardMaterial({ color: 0x1dd8eb, roughness: 0.35 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x241a15, roughness: 0.85 });
  const shadesMat = new THREE.MeshPhysicalMaterial({
    color: 0x09101a,
    roughness: 0.06,
    metalness: 0.4,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9b36c, metalness: 0.9, roughness: 0.2 });

  // Soft ground contact shadow
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 1.15),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    }),
  );
  contactShadow.rotation.x = -Math.PI * 0.5;
  contactShadow.position.y = 0.03;
  root.add(contactShadow);

  // Pelvis / hips
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.14, 6, 12), pantsMat);
  pelvis.rotation.z = Math.PI * 0.5;
  pelvis.position.y = 0.92;
  pelvis.castShadow = true;
  body.add(pelvis);

  // Upper body group (subtle breathing & lean when sprinting)
  const upperBody = new THREE.Group();
  upperBody.position.y = 0.96;
  body.add(upperBody);

  // Tapered athletic torso + open tailored blazer panels + inner crew tee
  const torsoCore = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.165, 0.52, 14), shirtMat);
  torsoCore.scale.set(1.08, 1, 0.68);
  torsoCore.position.y = 0.26;
  torsoCore.castShadow = true;
  upperBody.add(torsoCore);

  // Left & right jacket panels + collar
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.40, 6, 12), jacketMat);
    panel.scale.set(0.92, 1.0, 0.96);
    panel.position.set(side * 0.13, 0.25, 0.01);
    panel.castShadow = true;
    upperBody.add(panel);
  }
  const jacketBack = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.175, 0.50, 14), jacketMat);
  jacketBack.scale.set(1.1, 1, 0.62);
  jacketBack.position.set(0, 0.26, 0.03);
  jacketBack.castShadow = true;
  upperBody.add(jacketBack);

  // Shoulders
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.34, 6, 12), jacketMat);
  shoulders.rotation.z = Math.PI * 0.5;
  shoulders.position.y = 0.49;
  shoulders.castShadow = true;
  upperBody.add(shoulders);

  // Neck + sculpted oval head + styled hair + aviator sunglasses
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.068, 0.12, 10), skinMat);
  neck.position.y = 0.58;
  upperBody.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.72;
  upperBody.add(headGroup);

  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 14), skinMat);
  cranium.scale.set(0.92, 1.08, 0.98);
  cranium.castShadow = true;
  headGroup.add(cranium);

  const hairCrown = new THREE.Mesh(new THREE.SphereGeometry(0.142, 14, 12), hairMat);
  hairCrown.scale.set(0.95, 0.85, 1.04);
  hairCrown.position.set(0, 0.055, 0.02);
  headGroup.add(hairCrown);

  const hairSweep = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.11, 5, 10), hairMat);
  hairSweep.rotation.z = Math.PI * 0.42;
  hairSweep.position.set(0.02, 0.12, -0.05);
  headGroup.add(hairSweep);

  // Aviator sunglasses with gold bridge
  for (const side of [-0.052, 0.052]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.044, 10, 8), shadesMat);
    lens.scale.set(1.15, 0.78, 0.35);
    lens.position.set(side, 0.015, -0.125);
    headGroup.add(lens);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.02), frameMat);
  bridge.position.set(0, 0.032, -0.13);
  headGroup.add(bridge);

  // Articulated Arms (upper arm + elbow pivot + forearm + hand)
  const makeArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.47, 0);
    upperBody.add(shoulder);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.21, 6, 10), jacketMat);
    upper.position.y = -0.14;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);

    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.2, 6, 10), jacketMat);
    lower.position.y = -0.13;
    lower.castShadow = true;
    elbow.add(lower);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 8), skinMat);
    hand.position.y = -0.27;
    elbow.add(hand);

    return { shoulder, elbow };
  };

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  // Articulated Legs (thigh + knee pivot + calf + sculpted sneaker)
  const makeLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.115, 0.90, 0);
    body.add(hip);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.29, 6, 12), pantsMat);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);

    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.3, 6, 12), pantsMat);
    calf.position.y = -0.2;
    calf.castShadow = true;
    knee.add(calf);

    // Sculpted sneaker with sole accent
    const shoeUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.12, 5, 10), shoeMat);
    shoeUpper.rotation.x = Math.PI * 0.5;
    shoeUpper.position.set(0, -0.43, -0.045);
    shoeUpper.castShadow = true;
    knee.add(shoeUpper);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.032, 0.25), shoeAccentMat);
    sole.position.set(0, -0.465, -0.045);
    knee.add(sole);

    return { hip, knee };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  scene.add(root);

  const syncFromState = (s: PlayerState, elapsed = 0) => {
    root.visible = s.vehicleId === null;
    if (!root.visible) return;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = -s.yaw;

    const moveNorm = clamp(s.speed / 8, 0, 1);
    const amp = moveNorm * (s.sprinting ? 0.85 : 0.55);
    const sinP = Math.sin(s.walkPhase);

    // Natural stride with bent knees & swinging elbows
    leftLeg.hip.rotation.x = sinP * amp;
    rightLeg.hip.rotation.x = -sinP * amp;
    leftLeg.knee.rotation.x = Math.max(0, -sinP) * amp * 0.95;
    rightLeg.knee.rotation.x = Math.max(0, sinP) * amp * 0.95;

    leftArm.shoulder.rotation.x = -sinP * amp * 0.85;
    rightArm.shoulder.rotation.x = sinP * amp * 0.85;
    leftArm.elbow.rotation.x = -0.18 - Math.max(0, sinP) * amp * 0.65;
    rightArm.elbow.rotation.x = -0.18 - Math.max(0, -sinP) * amp * 0.65;

    // Subtle forward lean when sprinting + gentle vertical cadence bounce + idle breath
    upperBody.rotation.x = s.sprinting ? -0.16 : -moveNorm * 0.05;
    body.position.y = moveNorm > 0.05 ? Math.abs(Math.cos(s.walkPhase)) * 0.055 : Math.sin(elapsed * 2.2) * 0.012;
  };

  return { root, syncFromState };
}
