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
import { createContactShadowTexture, createSmokePuffTexture } from '../world/textures';

export interface PaintFinish {
  name: string;
  hex: number;
  accentHex: number;
  caliperHex: number;
}

export const PAINT_FINISHES: PaintFinish[] = [
  { name: 'Sunset Coral', hex: 0xe83b6f, accentHex: 0xffc6d9, caliperHex: 0xffcf33 },
  { name: 'Electric Cyan', hex: 0x00b8e6, accentHex: 0xaaf7ff, caliperHex: 0xff3b5c },
  { name: 'Pearl White', hex: 0xf0f3f8, accentHex: 0xffcf5c, caliperHex: 0xe62e4d },
  { name: 'Midnight Violet', hex: 0x5624d6, accentHex: 0xff3ea5, caliperHex: 0x38f2ff },
  { name: 'Art Deco Mint', hex: 0x1fc794, accentHex: 0xd1fff0, caliperHex: 0xffcf33 },
  { name: 'Solar Gold', hex: 0xe89e1e, accentHex: 0xfff0b3, caliperHex: 0xe62e4d },
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
    spawnYaw: 0,
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
  throttle: number;
  steer: number;
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
  speed: number;
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
    forwardSpeed *= Math.exp(-0.95 * safeDt);
    if (Math.abs(forwardSpeed) < 0.06) forwardSpeed = 0;
  }

  forwardSpeed = clamp(forwardSpeed, -16, v.config.maxSpeed);

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

  const newFwd = forwardFromYaw(v.yaw);
  const newRight = rightFromYaw(v.yaw);

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
  v.wheelSpin += (v.speed / 0.37) * safeDt;

  const accelInstant = (forwardSpeed - prevForward) / safeDt;
  const targetPitch = clamp(-accelInstant * 0.0022, -0.05, 0.055);
  const targetRoll = clamp(-input.steer * clamp(absSpeed / 22, 0, 1) * 0.06, -0.07, 0.07);
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

/**
 * Helper to extrude a 2D side-profile shape (where X = longitudinal -Z..+Z, Y = height)
 * centered along the vehicle's width axis (X in local car space, front at -Z).
 */
function extrudeCarProfile(
  shape: THREE.Shape,
  width: number,
  bevelSize = 0.13,
  bevelThickness = 0.14,
): THREE.BufferGeometry {
  const depth = Math.max(0.1, width - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 5,
    curveSegments: 16,
  });
  // Center extrusion along Z, then rotate +90deg around Y so shape X maps to car -Z (front = +shapeX -> -Z)
  geo.translate(0, 0, -depth * 0.5);
  geo.rotateY(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

function createLicensePlateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#fff7eb');
  grad.addColorStop(0.55, '#ffffff');
  grad.addColorStop(1, '#d8f6f2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#ff5e8e';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 122, 58);
  ctx.fillStyle = '#0e7c7b';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('SOL COAST', 64, 17);
  ctx.fillStyle = '#182234';
  ctx.font = '900 28px system-ui';
  ctx.fillText('SOL 305', 64, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildBodyProfile(style: VehicleBodyStyle): THREE.Shape {
  // Shape coordinates: x > 0 = FRONT (-Z), x < 0 = REAR (+Z), y = elevation above road
  const s = new THREE.Shape();
  if (style === 'sedan') {
    s.moveTo(-2.32, 0.34);
    s.lineTo(2.36, 0.32);
    s.quadraticCurveTo(2.48, 0.44, 2.42, 0.66); // front bumper nose
    s.quadraticCurveTo(2.12, 0.84, 1.24, 0.90); // sleek EV hood
    s.quadraticCurveTo(0.88, 0.93, 0.64, 0.94); // cowl
    s.lineTo(-1.82, 0.96); // crisp beltline
    s.quadraticCurveTo(-2.36, 0.94, -2.42, 0.68); // fastback tail
    s.quadraticCurveTo(-2.42, 0.42, -2.32, 0.34);
  } else if (style === 'spyder') {
    s.moveTo(-2.22, 0.30);
    s.lineTo(2.30, 0.28);
    s.quadraticCurveTo(2.44, 0.42, 2.38, 0.60);
    s.quadraticCurveTo(1.98, 0.78, 1.10, 0.83);
    s.lineTo(-1.35, 0.85);
    s.quadraticCurveTo(-2.12, 0.90, -2.34, 0.74); // rear tonneau deck
    s.quadraticCurveTo(-2.38, 0.44, -2.22, 0.30);
  } else {
    // Supercar / widebody coupe low-slung exotic silhouette
    s.moveTo(-2.28, 0.28);
    s.lineTo(2.34, 0.26);
    s.quadraticCurveTo(2.48, 0.38, 2.38, 0.56); // sharp aero nose
    s.quadraticCurveTo(1.96, 0.74, 1.12, 0.82); // low sloping hood
    s.quadraticCurveTo(0.35, 0.84, -0.55, 0.88); // mid-engine intake waist
    s.quadraticCurveTo(-1.62, 0.96, -2.26, 0.86); // muscular rear haunch
    s.quadraticCurveTo(-2.40, 0.64, -2.28, 0.28);
  }
  return s;
}

function buildGreenhouseProfile(style: VehicleBodyStyle): THREE.Shape {
  const s = new THREE.Shape();
  if (style === 'sedan') {
    s.moveTo(-1.65, 0.88);
    s.lineTo(1.06, 0.85);
    s.quadraticCurveTo(0.54, 1.38, 0.08, 1.44);
    s.lineTo(-0.78, 1.42);
    s.quadraticCurveTo(-1.38, 1.24, -1.65, 0.88);
  } else {
    // Teardrop exotic canopy
    s.moveTo(-1.58, 0.84);
    s.lineTo(1.04, 0.78);
    s.quadraticCurveTo(0.46, 1.28, -0.08, 1.31);
    s.quadraticCurveTo(-0.88, 1.30, -1.58, 0.84);
  }
  return s;
}

interface DriftSmokeParticle {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
}

export interface VehicleMeshHandles {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  caliperMaterial: THREE.MeshStandardMaterial;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  headlightSpot: THREE.SpotLight;
  headlightTarget: THREE.Object3D;
  wheelMeshes: THREE.Object3D[];
  frontWheelPivots: THREE.Object3D[];
  syncFromState: (state: VehicleState, nightFactor: number, dt?: number) => void;
  applyPaint: (paintIndex: number) => void;
}

let sharedContactShadowTex: THREE.CanvasTexture | null = null;
let sharedPlateTex: THREE.CanvasTexture | null = null;
let sharedSmokeTex: THREE.CanvasTexture | null = null;

export function createVehicleMesh(state: VehicleState, scene: THREE.Scene): VehicleMeshHandles {
  if (!sharedContactShadowTex) sharedContactShadowTex = createContactShadowTexture();
  if (!sharedPlateTex) sharedPlateTex = createLicensePlateTexture();
  if (!sharedSmokeTex) sharedSmokeTex = createSmokePuffTexture();

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const finish = PAINT_FINISHES[state.paintIndex % PAINT_FINISHES.length];

  // Photorealistic clearcoat metallic automotive paint (shines with PMREM sky IBL!)
  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: finish.hex,
    metalness: 0.68,
    roughness: 0.17,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.55,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: finish.accentHex,
    metalness: 0.55,
    roughness: 0.25,
  });

  const caliperMaterial = new THREE.MeshStandardMaterial({
    color: finish.caliperHex,
    metalness: 0.45,
    roughness: 0.3,
  });

  const carbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x151820,
    roughness: 0.34,
    metalness: 0.35,
    clearcoat: 0.6,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xeaf0f8,
    metalness: 0.96,
    roughness: 0.1,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1522,
    roughness: 0.04,
    metalness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.86,
    envMapIntensity: 2.0,
  });

  const interiorMat = new THREE.MeshStandardMaterial({
    color: state.style === 'spyder' ? 0x5c3a28 : 0x1a1e28,
    roughness: 0.76,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4fcff,
    emissive: 0xd9f7ff,
    emissiveIntensity: 2.2,
  });

  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff193b,
    emissive: 0xff1133,
    emissiveIntensity: 1.4,
  });

  // Soft ground ambient-occlusion contact shadow so car looks firmly planted
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.05, 5.75),
    new THREE.MeshBasicMaterial({
      map: sharedContactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
  );
  shadowPlane.rotation.x = -Math.PI * 0.5;
  shadowPlane.position.y = 0.045;
  root.add(shadowPlane);

  // 1. Sculpted Main Aerodynamic Lower Body
  const bodyGeo = extrudeCarProfile(buildBodyProfile(state.style), 1.98, 0.13, 0.15);
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  // Sculpted wide fender haunches over front & rear axles
  const haunchGeo = new THREE.CylinderGeometry(0.46, 0.48, 2.12, 16, 1, false, 0, Math.PI);
  haunchGeo.rotateZ(Math.PI * 0.5);
  haunchGeo.scale(1, 0.72, 1.32);
  for (const wz of [-1.42, 1.42]) {
    const haunch = new THREE.Mesh(haunchGeo, paintMaterial);
    haunch.position.set(0, 0.58, wz);
    haunch.castShadow = true;
    bodyGroup.add(haunch);

    // Dark inner wheel well liner
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.43, 2.02, 14),
      carbonMat,
    );
    well.rotation.z = Math.PI * 0.5;
    well.position.set(0, 0.42, wz);
    bodyGroup.add(well);
  }

  // Front carbon aero splitter, dark grille intake, side rocker skirts, and rear finned diffuser
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.08, 0.58), carbonMat);
  splitter.position.set(0, 0.23, -2.26);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.22, 0.14), carbonMat);
  grille.position.set(0, 0.39, -2.42);
  bodyGroup.add(grille);

  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 2.42), carbonMat);
    skirt.position.set(side * 0.99, 0.25, 0);
    bodyGroup.add(skirt);

    // Sculpted side air intake recess (exotic mid-engine look)
    if (state.style === 'supercar' || state.style === 'coupe') {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.68), carbonMat);
      intake.position.set(side * 1.02, 0.56, 0.68);
      bodyGroup.add(intake);
    }

    // Aerodynamic wing mirrors on curved stalks
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), carbonMat);
    stalk.position.set(side * 1.02, 0.93, -0.68);
    bodyGroup.add(stalk);
    const mirrorCap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), paintMaterial);
    mirrorCap.scale.set(1.25, 0.68, 1.45);
    mirrorCap.position.set(side * 1.14, 0.97, -0.66);
    bodyGroup.add(mirrorCap);
  }

  // Rear carbon diffuser with vertical aero strakes + quad chrome exhaust pipes
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.24, 0.36), carbonMat);
  diffuser.position.set(0, 0.31, 2.24);
  bodyGroup.add(diffuser);
  for (let fx = -0.6; fx <= 0.6; fx += 0.3) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.42), carbonMat);
    fin.position.set(fx, 0.26, 2.27);
    bodyGroup.add(fin);
  }
  const exhaustGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.24, 12);
  exhaustGeo.rotateX(Math.PI * 0.5);
  for (const ex of [-0.66, -0.5, 0.5, 0.66]) {
    const tip = new THREE.Mesh(exhaustGeo, chromeMat);
    tip.position.set(ex, 0.31, 2.38);
    bodyGroup.add(tip);
  }

  // Rear license plate
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.22),
    new THREE.MeshStandardMaterial({ map: sharedPlateTex, roughness: 0.4 }),
  );
  plate.position.set(0, 0.53, 2.41);
  bodyGroup.add(plate);

  // 2. Visible Cockpit Interior (bucket seats, console, steering wheel)
  for (const sx of [-0.42, 0.42]) {
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.14), interiorMat);
    seatBack.position.set(sx, 0.88, 0.44);
    seatBack.rotation.x = -0.22;
    bodyGroup.add(seatBack);
    const headrest = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.12, 4, 8), interiorMat);
    headrest.position.set(sx, 1.2, 0.5);
    bodyGroup.add(headrest);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.22, 0.55), carbonMat);
  dash.position.set(0, 0.82, -0.52);
  bodyGroup.add(dash);
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 8, 16), carbonMat);
  wheelRim.position.set(-0.42, 0.94, -0.34);
  wheelRim.rotation.x = -0.35;
  bodyGroup.add(wheelRim);

  // 3. Sculpted Glass Greenhouse OR Open-Top Spyder Windshield & Roll Hoops
  if (state.style === 'spyder') {
    const wsFrame = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.54, 0.06), glassMat);
    wsFrame.position.set(0, 1.04, -0.78);
    wsFrame.rotation.x = -0.62;
    bodyGroup.add(wsFrame);

    for (const side of [-0.82, 0.82]) {
      const aPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 0.62, 8), paintMaterial);
      aPillar.position.set(side, 1.04, -0.78);
      aPillar.rotation.x = -0.62;
      bodyGroup.add(aPillar);
    }

    for (const side of [-0.44, 0.44]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.042, 10, 18, Math.PI), chromeMat);
      hoop.position.set(side, 1.0, 0.78);
      bodyGroup.add(hoop);
    }
  } else {
    const canopyGeo = extrudeCarProfile(buildGreenhouseProfile(state.style), 1.56, 0.09, 0.11);
    const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
    canopyMesh.castShadow = true;
    bodyGroup.add(canopyMesh);

    // Sculpted painted/carbon roof panel cap
    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(1.26, 0.055, state.style === 'sedan' ? 1.48 : 1.08),
      state.style === 'supercar' ? carbonMat : paintMaterial,
    );
    roofCap.position.set(0, state.style === 'sedan' ? 1.49 : 1.36, state.style === 'sedan' ? 0.34 : 0.22);
    bodyGroup.add(roofCap);
  }

  // Swan-neck carbon rear wing for supercar / coupe
  if (state.style === 'supercar' || state.style === 'coupe') {
    const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.055, 0.34), carbonMat);
    wingBlade.position.set(0, 1.18, 2.12);
    wingBlade.rotation.x = 0.08;
    wingBlade.castShadow = true;
    bodyGroup.add(wingBlade);

    for (const side of [-0.97, 0.97]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.4), paintMaterial);
      endplate.position.set(side, 1.17, 2.12);
      bodyGroup.add(endplate);
    }
    for (const side of [-0.52, 0.52]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.28, 0.18), carbonMat);
      strut.position.set(side, 1.02, 2.04);
      strut.rotation.x = -0.18;
      bodyGroup.add(strut);
    }
  }

  // 4. Sculpted Angular LED Headlight Housings + Projector Lenses + Full-Width OLED Tailbar
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.28), carbonMat);
    housing.position.set(side * 0.68, 0.58, -2.28);
    housing.rotation.y = side * -0.18;
    bodyGroup.add(housing);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.055, 0.12), headlightMaterial);
    drl.position.set(side * 0.68, 0.61, -2.38);
    drl.rotation.y = side * -0.18;
    bodyGroup.add(drl);

    const projector = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), headlightMaterial);
    projector.position.set(side * 0.64, 0.56, -2.38);
    bodyGroup.add(projector);
  }

  const tailHousing = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.18, 0.14), carbonMat);
  tailHousing.position.set(0, 0.74, 2.32);
  bodyGroup.add(tailHousing);

  const tailbar = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.08, 0.08), brakeLightMaterial);
  tailbar.position.set(0, 0.74, 2.38);
  bodyGroup.add(tailbar);

  // 5. Realistic Wheels: Rounded Torus Sidewall Tires + Multi-Spoke Alloy Rims + Brake Rotors & Calipers
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x171a21, roughness: 0.86, metalness: 0.05 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0x9fa8b6, metalness: 0.82, roughness: 0.34 });

  const wheelPositions = [
    { x: -1.02, z: -1.42, front: true },
    { x: 1.02, z: -1.42, front: true },
    { x: -1.02, z: 1.42, front: false },
    { x: 1.02, z: 1.42, front: false },
  ];

  const wheelMeshes: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];

  for (const wp of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, 0.37, wp.z);
    root.add(pivot);
    if (wp.front) frontWheelPivots.push(pivot);

    // Non-spinning brake caliper mounted to hub upright!
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), caliperMaterial);
    caliper.position.set(Math.sign(wp.x) * 0.03, 0.06, wp.front ? 0.15 : -0.15);
    pivot.add(caliper);

    const wheelSpinGroup = new THREE.Group();
    pivot.add(wheelSpinGroup);
    wheelMeshes.push(wheelSpinGroup);

    // Tire tread + rounded sidewall toruses
    const tread = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.24, 24), tireMat);
    tread.rotation.z = Math.PI * 0.5;
    tread.castShadow = true;
    wheelSpinGroup.add(tread);

    const sidewall = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 10, 24), tireMat);
    sidewall.rotation.y = Math.PI * 0.5;
    sidewall.position.x = Math.sign(wp.x) * 0.075;
    wheelSpinGroup.add(sidewall);

    // Metallic rim barrel & brake disc rotor
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.27, 20), chromeMat);
    barrel.rotation.z = Math.PI * 0.5;
    wheelSpinGroup.add(barrel);

    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.04, 18), rotorMat);
    rotor.rotation.z = Math.PI * 0.5;
    rotor.position.x = Math.sign(wp.x) * 0.02;
    wheelSpinGroup.add(rotor);

    // 5-Spoke sculpted metallic alloy star face
    const outerX = Math.sign(wp.x) * 0.135;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), accentMaterial);
    hub.rotation.z = Math.PI * 0.5;
    hub.position.x = outerX;
    wheelSpinGroup.add(hub);

    for (let sp = 0; sp < 5; sp++) {
      const ang = (sp / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.045), chromeMat);
      spoke.position.set(outerX, Math.cos(ang) * 0.12, Math.sin(ang) * 0.12);
      spoke.rotation.x = ang;
      wheelSpinGroup.add(spoke);
    }
  }

  // Real dynamic headlight beam projecting onto the asphalt at dusk/night
  const headlightSpot = new THREE.SpotLight(0xe6f8ff, 0, 58, Math.PI * 0.25, 0.52, 1.25);
  headlightSpot.position.set(0, 0.85, -2.35);
  const headlightTarget = new THREE.Object3D();
  headlightTarget.position.set(0, 0.08, -26);
  root.add(headlightSpot);
  root.add(headlightTarget);
  headlightSpot.target = headlightTarget;

  // Drift tire smoke particle pool
  const smokePool: DriftSmokeParticle[] = [];
  let smokeTimer = 0;

  scene.add(root);

  const applyPaint = (paintIndex: number) => {
    const p = PAINT_FINISHES[((paintIndex % PAINT_FINISHES.length) + PAINT_FINISHES.length) % PAINT_FINISHES.length];
    paintMaterial.color.setHex(p.hex);
    accentMaterial.color.setHex(p.accentHex);
    caliperMaterial.color.setHex(p.caliperHex);
  };

  const syncFromState = (s: VehicleState, nightFactor: number, dt = 1 / 60) => {
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
    headlightMaterial.emissiveIntensity = s.headlightsOn ? 1.5 + nightFactor * 2.4 : 0.2;
    headlightSpot.intensity = lightsActive ? 26 * nightFactor : 0;
    brakeLightMaterial.emissiveIntensity = s.braking ? 4.2 : 0.9 + nightFactor * 1.1;

    // Emit soft tire smoke puffs while drifting
    if (s.drifting && sharedSmokeTex) {
      smokeTimer += dt;
      if (smokeTimer >= 0.045) {
        smokeTimer = 0;
        const fwd = forwardFromYaw(s.yaw);
        const right = rightFromYaw(s.yaw);
        for (const side of [-0.95, 0.95]) {
          const mat = new THREE.SpriteMaterial({
            map: sharedSmokeTex,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
          });
          const sp = new THREE.Sprite(mat);
          sp.position.set(
            s.x - fwd.x * 1.5 + right.x * side,
            s.y + 0.22,
            s.z - fwd.z * 1.5 + right.z * side,
          );
          sp.scale.set(0.75, 0.75, 1);
          scene.add(sp);
          smokePool.push({
            sprite: sp,
            vx: (Math.random() - 0.5) * 1.1,
            vy: 0.8 + Math.random() * 0.6,
            vz: (Math.random() - 0.5) * 1.1,
            age: 0,
            maxAge: 0.65 + Math.random() * 0.35,
          });
        }
      }
    }

    // Update & recycle active tire smoke particles
    for (let i = smokePool.length - 1; i >= 0; i--) {
      const p = smokePool[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        smokePool.splice(i, 1);
      } else {
        const life = p.age / p.maxAge;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        const sc = 0.75 + life * 2.4;
        p.sprite.scale.set(sc, sc, 1);
        p.sprite.material.opacity = (1 - life) * 0.38;
      }
    }
  };

  syncFromState(state, 0.2, 0.016);

  return {
    root,
    bodyGroup,
    paintMaterial,
    accentMaterial,
    caliperMaterial,
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
