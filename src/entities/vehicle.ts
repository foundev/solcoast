import * as THREE from 'three';
import {
  clamp,
  forwardFromYaw,
  lerp,
  resolveCircleAABB,
  rightFromYaw,
  wrapAngle,
  type AABB,
} from '../core/math';
import { getGroundHeight, isDeepWater } from '../world/cityData';

export interface PaintFinish {
  name: string;
  hex: number;
  accentHex: number;
}

export const PAINT_FINISHES: PaintFinish[] = [
  { name: 'Sunset Coral', hex: 0xff467e, accentHex: 0xffc6d9 },
  { name: 'Electric Cyan', hex: 0x00d9ff, accentHex: 0xaaf7ff },
  { name: 'Pearl White', hex: 0xf4f6fb, accentHex: 0xffcf5c },
  { name: 'Midnight Violet', hex: 0x6b2dff, accentHex: 0xff3ea5 },
  { name: 'Art Deco Mint', hex: 0x26e5a8, accentHex: 0xd1fff0 },
  { name: 'Solar Gold', hex: 0xffb82e, accentHex: 0xfff0b3 },
];

export type VehicleBodyStyle = 'supercar' | 'sedan' | 'spyder' | 'coupe';

export interface VehicleConfig {
  id: string;
  name: string;
  style: VehicleBodyStyle;
  defaultPaintIndex: number;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  maxSpeed: number; // m/s (52 m/s ~ 116 mph)
  accel: number;
  brakeDecel: number;
  turnRate: number;
}

export const DEFAULT_VEHICLES: VehicleConfig[] = [
  {
    id: 'solstice-gt',
    name: 'Solstice GT',
    style: 'supercar',
    defaultPaintIndex: 0,
    spawnX: 144,
    spawnZ: 28,
    spawnYaw: 0, // Facing North up Ocean Drive
    maxSpeed: 54,
    accel: 24,
    brakeDecel: 38,
    turnRate: 2.35,
  },
  {
    id: 'biscayne-ev',
    name: 'Biscayne EV',
    style: 'sedan',
    defaultPaintIndex: 1,
    spawnX: -196,
    spawnZ: -38,
    spawnYaw: 0,
    maxSpeed: 50,
    accel: 26,
    brakeDecel: 36,
    turnRate: 2.15,
  },
  {
    id: 'keysol-spyder',
    name: 'Key Sol Spyder',
    style: 'spyder',
    defaultPaintIndex: 2,
    spawnX: 18,
    spawnZ: 164,
    spawnYaw: Math.PI * 0.5,
    maxSpeed: 52,
    accel: 23,
    brakeDecel: 37,
    turnRate: 2.45,
  },
  {
    id: 'neon-apex',
    name: 'Neon Apex',
    style: 'coupe',
    defaultPaintIndex: 3,
    spawnX: -16,
    spawnZ: -90,
    spawnYaw: Math.PI,
    maxSpeed: 53,
    accel: 25,
    brakeDecel: 38,
    turnRate: 2.4,
  },
];

export interface VehicleDriveInput {
  throttle: number; // -1..+1
  steer: number; // -1 (left) .. +1 (right)
  handbrake: boolean;
}

export interface VehicleState {
  id: string;
  name: string;
  style: VehicleBodyStyle;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  steerAngle: number;
  wheelSpin: number;
  pitchTilt: number;
  rollTilt: number;
  speed: number; // signed forward speed (m/s)
  lateralSpeed: number;
  drifting: boolean;
  braking: boolean;
  headlightsOn: boolean;
  paintIndex: number;
  odometerMeters: number;
  lastCollisionImpact: number;
  config: VehicleConfig;
}

export function createVehicleState(cfg: VehicleConfig): VehicleState {
  return {
    id: cfg.id,
    name: cfg.name,
    style: cfg.style,
    x: cfg.spawnX,
    y: getGroundHeight(cfg.spawnX, cfg.spawnZ),
    z: cfg.spawnZ,
    vx: 0,
    vz: 0,
    yaw: cfg.spawnYaw,
    steerAngle: 0,
    wheelSpin: 0,
    pitchTilt: 0,
    rollTilt: 0,
    speed: 0,
    lateralSpeed: 0,
    drifting: false,
    braking: false,
    headlightsOn: true,
    paintIndex: cfg.defaultPaintIndex,
    odometerMeters: 0,
    lastCollisionImpact: 0,
    config: cfg,
  };
}

/**
 * Arcade-sim driving physics with crisp acceleration, speed-sensitive steering,
 * handbrake drifting, smooth wall sliding, and water boundary protection.
 */
export function stepVehiclePhysics(
  v: VehicleState,
  input: VehicleDriveInput,
  dt: number,
  colliders: AABB[],
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  v.lastCollisionImpact = 0;

  const fwd = forwardFromYaw(v.yaw);
  const right = rightFromYaw(v.yaw);

  let forwardSpeed = v.vx * fwd.x + v.vz * fwd.z;
  let lateralSpeed = v.vx * right.x + v.vz * right.z;

  const prevForward = forwardSpeed;

  // Longitudinal forces (throttle, braking, reverse, natural drag)
  v.braking = false;
  if (input.handbrake) {
    v.braking = true;
    const decel = v.config.brakeDecel * 0.72 * safeDt;
    if (Math.abs(forwardSpeed) <= decel) forwardSpeed = 0;
    else forwardSpeed -= Math.sign(forwardSpeed) * decel;
  } else if (input.throttle > 0.05) {
    if (forwardSpeed < -1) {
      v.braking = true;
      forwardSpeed += v.config.brakeDecel * safeDt;
    } else {
      const topRatio = clamp(forwardSpeed / v.config.maxSpeed, 0, 1);
      const torqueCurve = 1.0 - topRatio * 0.62;
      forwardSpeed += input.throttle * v.config.accel * torqueCurve * safeDt;
    }
  } else if (input.throttle < -0.05) {
    if (forwardSpeed > 1) {
      v.braking = true;
      forwardSpeed -= v.config.brakeDecel * safeDt;
    } else {
      forwardSpeed += input.throttle * v.config.accel * 0.52 * safeDt;
    }
  } else {
    // Rolling coast drag
    forwardSpeed *= Math.exp(-0.95 * safeDt);
    if (Math.abs(forwardSpeed) < 0.06) forwardSpeed = 0;
  }

  forwardSpeed = clamp(forwardSpeed, -16, v.config.maxSpeed);

  // Smooth steering wheel response & speed-sensitive yaw rate
  const targetSteer = input.steer * 0.48;
  v.steerAngle = lerp(v.steerAngle, targetSteer, clamp(safeDt * 11, 0, 1));

  const absSpeed = Math.abs(forwardSpeed);
  if (absSpeed > 0.25) {
    const dirSign = forwardSpeed >= 0 ? 1 : -1;
    const lowSpeedFactor = clamp(absSpeed / 7.5, 0, 1);
    const highSpeedStability = 1.0 - clamp(absSpeed / (v.config.maxSpeed * 1.45), 0, 0.42);
    const driftTurnBoost = input.handbrake && absSpeed > 8 ? 1.38 : 1.0;
    const yawDelta =
      input.steer *
      v.config.turnRate *
      lowSpeedFactor *
      highSpeedStability *
      driftTurnBoost *
      dirSign *
      safeDt;
    v.yaw = wrapAngle(v.yaw + yawDelta);
  }

  // Recompute basis after yaw update & apply lateral tire grip (lower grip during handbrake drift)
  const newFwd = forwardFromYaw(v.yaw);
  const newRight = rightFromYaw(v.yaw);

  // Preserve some previous world momentum into lateral slip when turning sharply
  const worldVx = v.vx;
  const worldVz = v.vz;
  const oldLat = worldVx * newRight.x + worldVz * newRight.z;
  const grip = input.handbrake ? 1.9 : 8.8;
  lateralSpeed = oldLat * Math.exp(-grip * safeDt);
  if (Math.abs(lateralSpeed) < 0.04) lateralSpeed = 0;

  v.drifting = (input.handbrake || Math.abs(lateralSpeed) > 4.2) && absSpeed > 9;
  v.vx = newFwd.x * forwardSpeed + newRight.x * lateralSpeed;
  v.vz = newFwd.z * forwardSpeed + newRight.z * lateralSpeed;

  const prevX = v.x;
  const prevZ = v.z;
  let nextX = v.x + v.vx * safeDt;
  let nextZ = v.z + v.vz * safeDt;

  // Building / obstacle collision with smooth sliding response
  const carRadius = 1.85;
  for (const box of colliders) {
    const res = resolveCircleAABB(nextX, nextZ, carRadius, box);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
      const nLen = Math.hypot(res.dx, res.dz);
      if (nLen > 1e-5) {
        const nx = res.dx / nLen;
        const nz = res.dz / nLen;
        const vn = v.vx * nx + v.vz * nz;
        if (vn < 0) {
          v.lastCollisionImpact = Math.max(v.lastCollisionImpact, -vn);
          v.vx -= nx * vn * 1.25;
          v.vz -= nz * vn * 1.25;
          v.vx *= 0.82;
          v.vz *= 0.82;
        }
      }
    }
  }

  // Water / seawall boundary protection (try sliding along X or Z before bouncing)
  if (isDeepWater(nextX, nextZ)) {
    if (!isDeepWater(nextX, prevZ)) {
      nextZ = prevZ;
      v.vz *= -0.25;
    } else if (!isDeepWater(prevX, nextZ)) {
      nextX = prevX;
      v.vx *= -0.25;
    } else {
      nextX = prevX;
      nextZ = prevZ;
      v.vx *= -0.3;
      v.vz *= -0.3;
    }
    v.lastCollisionImpact = Math.max(v.lastCollisionImpact, absSpeed * 0.4);
  }

  v.x = nextX;
  v.z = nextZ;
  v.y = lerp(v.y, getGroundHeight(v.x, v.z), clamp(safeDt * 18, 0, 1));

  const moved = Math.hypot(v.x - prevX, v.z - prevZ);
  v.odometerMeters += moved;

  v.speed = v.vx * newFwd.x + v.vz * newFwd.z;
  v.lateralSpeed = v.vx * newRight.x + v.vz * newRight.z;
  v.wheelSpin += (v.speed / 0.38) * safeDt;

  // Dynamic suspension body pitch & roll feedback
  const accelInstant = (forwardSpeed - prevForward) / safeDt;
  const targetPitch = clamp(-accelInstant * 0.0022, -0.055, 0.065);
  const targetRoll = clamp(-input.steer * clamp(absSpeed / 22, 0, 1) * 0.065, -0.075, 0.075);
  v.pitchTilt = lerp(v.pitchTilt, targetPitch, clamp(safeDt * 10, 0, 1));
  v.rollTilt = lerp(v.rollTilt, targetRoll, clamp(safeDt * 10, 0, 1));
}

export function speedToMph(speedMetersPerSec: number): number {
  return Math.round(Math.abs(speedMetersPerSec) * 2.23694);
}

export function computeGear(speedMetersPerSec: number): string {
  if (speedMetersPerSec < -0.6) return 'R';
  if (Math.abs(speedMetersPerSec) < 0.4) return 'N';
  const mph = Math.abs(speedMetersPerSec) * 2.23694;
  if (mph < 22) return '1';
  if (mph < 44) return '2';
  if (mph < 68) return '3';
  if (mph < 92) return '4';
  if (mph < 112) return '5';
  return '6';
}

export interface VehicleMeshHandles {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  headlightSpot: THREE.SpotLight;
  headlightTarget: THREE.Object3D;
  wheelMeshes: THREE.Object3D[];
  frontWheelPivots: THREE.Object3D[];
  syncFromState: (state: VehicleState, nightFactor: number) => void;
  applyPaint: (paintIndex: number) => void;
}

export function createVehicleMesh(state: VehicleState, scene: THREE.Scene): VehicleMeshHandles {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const finish = PAINT_FINISHES[state.paintIndex % PAINT_FINISHES.length];

  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: finish.hex,
    metalness: 0.52,
    roughness: 0.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: finish.accentHex,
    metalness: 0.4,
    roughness: 0.3,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161922,
    roughness: 0.55,
    metalness: 0.35,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1726,
    roughness: 0.06,
    metalness: 0.25,
    clearcoat: 1.0,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4fcff,
    emissive: 0xcff6ff,
    emissiveIntensity: 2.2,
  });

  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff1f44,
    emissive: 0xff173c,
    emissiveIntensity: 1.3,
  });

  // Lower aerodynamic chassis & splitter
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.54, 4.65), paintMaterial);
  lowerBody.position.set(0, 0.62, 0);
  lowerBody.castShadow = true;
  lowerBody.receiveShadow = true;
  bodyGroup.add(lowerBody);

  // Front aero nose wedge
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.34, 0.85), paintMaterial);
  nose.position.set(0, 0.52, -2.25);
  nose.rotation.x = 0.14;
  nose.castShadow = true;
  bodyGroup.add(nose);

  // Front splitter & rear diffuser
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.12, 0.48), carbonMat);
  splitter.position.set(0, 0.32, -2.32);
  bodyGroup.add(splitter);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.2, 0.45), carbonMat);
  diffuser.position.set(0, 0.38, 2.24);
  bodyGroup.add(diffuser);

  // Side skirts & accent pinstripe
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 2.8), carbonMat);
    skirt.position.set(side * 1.04, 0.35, 0);
    bodyGroup.add(skirt);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.18), paintMaterial);
    mirror.position.set(side * 1.12, 0.98, -0.58);
    bodyGroup.add(mirror);
  }

  // Cabin geometry varies cleanly by vehicle body style
  if (state.style === 'spyder') {
    // Open-top luxury roadster windshield + tan/dark interior + roll hoops
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.48, 0.12), glassMat);
    windshield.position.set(0, 1.05, -0.68);
    windshield.rotation.x = -0.52;
    bodyGroup.add(windshield);

    const interior = new THREE.Mesh(
      new THREE.BoxGeometry(1.66, 0.32, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.78 }),
    );
    interior.position.set(0, 0.84, 0.15);
    bodyGroup.add(interior);

    for (const side of [-0.46, 0.46]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 12, Math.PI), accentMaterial);
      hoop.position.set(side, 1.02, 0.88);
      bodyGroup.add(hoop);
    }
  } else {
    const cabinLen = state.style === 'sedan' ? 2.45 : 1.95;
    const cabinH = state.style === 'sedan' ? 0.58 : 0.48;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.74, cabinH, cabinLen), glassMat);
    cabin.position.set(0, 0.88 + cabinH * 0.45, 0.12);
    cabin.castShadow = true;
    bodyGroup.add(cabin);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.56, 0.1, cabinLen * 0.72),
      state.style === 'supercar' ? carbonMat : paintMaterial,
    );
    roof.position.set(0, 0.88 + cabinH * 0.94, 0.16);
    bodyGroup.add(roof);
  }

  // Rear wing for supercar / coupe
  if (state.style === 'supercar' || state.style === 'coupe') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.08, 0.34), carbonMat);
    wing.position.set(0, 1.15, 2.08);
    wing.castShadow = true;
    bodyGroup.add(wing);
    for (const side of [-0.62, 0.62]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.22), carbonMat);
      strut.position.set(side, 0.99, 2.04);
      bodyGroup.add(strut);
    }
  }

  // Sleek modern LED Headlight DRL blades
  for (const side of [-0.72, 0.72]) {
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.12), headlightMaterial);
    drl.position.set(side, 0.64, -2.42);
    bodyGroup.add(drl);
  }

  // Full-width glowing LED rear tailbar
  const tailbar = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.13, 0.1), brakeLightMaterial);
  tailbar.position.set(0, 0.72, 2.33);
  bodyGroup.add(tailbar);

  // 4 Wheels with metallic alloy spokes
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdbe2f0, metalness: 0.85, roughness: 0.2 });

  const wheelPositions = [
    { x: -1.04, z: -1.42, front: true },
    { x: 1.04, z: -1.42, front: true },
    { x: -1.04, z: 1.42, front: false },
    { x: 1.04, z: 1.42, front: false },
  ];

  const wheelMeshes: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];

  for (const wp of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, 0.38, wp.z);
    root.add(pivot);
    if (wp.front) frontWheelPivots.push(pivot);

    const wheelSpinGroup = new THREE.Group();
    pivot.add(wheelSpinGroup);
    wheelMeshes.push(wheelSpinGroup);

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14), tireMat);
    tire.rotation.z = Math.PI * 0.5;
    tire.castShadow = true;
    wheelSpinGroup.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 8), rimMat);
    rim.rotation.z = Math.PI * 0.5;
    wheelSpinGroup.add(rim);

    // Visible spoke bar so spinning wheels are easy to see
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.08), accentMaterial);
    wheelSpinGroup.add(spoke);
  }

  // Real dynamic headlight beam projecting ahead on the road at dusk/night
  const headlightSpot = new THREE.SpotLight(0xdff7ff, 0, 52, Math.PI * 0.24, 0.55, 1.3);
  headlightSpot.position.set(0, 0.9, -2.2);
  const headlightTarget = new THREE.Object3D();
  headlightTarget.position.set(0, 0.1, -24);
  root.add(headlightSpot);
  root.add(headlightTarget);
  headlightSpot.target = headlightTarget;

  scene.add(root);

  const applyPaint = (paintIndex: number) => {
    const p = PAINT_FINISHES[((paintIndex % PAINT_FINISHES.length) + PAINT_FINISHES.length) % PAINT_FINISHES.length];
    paintMaterial.color.setHex(p.hex);
    accentMaterial.color.setHex(p.accentHex);
  };

  const syncFromState = (s: VehicleState, nightFactor: number) => {
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = -s.yaw;
    bodyGroup.rotation.x = s.pitchTilt;
    bodyGroup.rotation.z = s.rollTilt;

    for (const p of frontWheelPivots) {
      p.rotation.y = -s.steerAngle;
    }
    for (const w of wheelMeshes) {
      w.rotation.x = -s.wheelSpin;
    }

    const lightsActive = s.headlightsOn && nightFactor > 0.08;
    headlightMaterial.emissiveIntensity = s.headlightsOn ? 1.5 + nightFactor * 2.2 : 0.2;
    headlightSpot.intensity = lightsActive ? 22 * nightFactor : 0;
    brakeLightMaterial.emissiveIntensity = s.braking ? 3.8 : 0.9 + nightFactor * 0.9;
  };

  syncFromState(state, 0.2);

  return {
    root,
    bodyGroup,
    paintMaterial,
    accentMaterial,
    brakeLightMaterial,
    headlightMaterial,
    headlightSpot,
    headlightTarget,
    wheelMeshes,
    frontWheelPivots,
    syncFromState,
    applyPaint,
  };
}
