import * as THREE from 'three';
import {
  clamp,
  forwardFromYaw,
  lerp,
  rightFromYaw,
  wrapAngle,
  type AABB,
  type OBB2D,
} from '../core/math';
import { resolveCarVsBuildingSAT, resolveCarVsCarSAT, resolveCarVsObbSAT } from '../core/physics';
import type { CarModelKind } from '../world/assets';
import { getGroundHeight, isDeepWater } from '../world/cityData';
import { createLightGlowTexture } from '../world/postfx';
import { createContactShadowTexture, createSmokePuffTexture } from '../world/textures';
import {
  createSculptedCabinGeometry,
  createSculptedCarBodyGeometry,
} from './carGeometry';

export interface PaintFinish {
  name: string;
  hex: number;
  accentHex: number;
  caliperHex: number;
}

export const PAINT_FINISHES: PaintFinish[] = [
  { name: 'Sunset Coral', hex: 0xe8386b, accentHex: 0xffc6d9, caliperHex: 0xffcf33 },
  { name: 'Electric Cyan', hex: 0x00b8e6, accentHex: 0xaaf7ff, caliperHex: 0xff3b5c },
  { name: 'Pearl White', hex: 0xf0f3f8, accentHex: 0xffcf5c, caliperHex: 0xe62e4d },
  { name: 'Midnight Violet', hex: 0x5624d6, accentHex: 0xff3ea5, caliperHex: 0x38f2ff },
  { name: 'Art Deco Mint', hex: 0x1fc794, accentHex: 0xd1fff0, caliperHex: 0xffcf33 },
  { name: 'Solar Gold', hex: 0xe89e1e, accentHex: 0xfff0b3, caliperHex: 0xe62e4d },
];

/** Exact measured cockpit driver-seat Hips anchor (local to vehicle bodyGroup) for every 3D car model */
export const DRIVER_SEAT_OFFSETS: Record<CarModelKind, { x: number; y: number; z: number }> = {
  ferrari: { x: -0.36, y: 0.36, z: 0.14 },
  spyder: { x: -0.38, y: 0.48, z: 0.08 },
  gt: { x: -0.38, y: 0.41, z: -0.06 },
  coupe: { x: -0.38, y: 0.44, z: -0.02 },
  jdm: { x: -0.35, y: 0.44, z: 0.18 },
  ev: { x: -0.38, y: 0.56, z: 0.04 },
  taxi: { x: -0.38, y: 0.58, z: 0.02 },
  suv: { x: -0.4, y: 0.64, z: 0.04 },
};

export type VehicleBodyStyle = 'supercar' | 'sedan' | 'spyder' | 'coupe';

export interface VehicleConfig {
  id: string;
  name: string;
  style: VehicleBodyStyle;
  modelKind: CarModelKind;
  defaultPaintIndex: number;
  customColorHex?: number;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  maxSpeed: number;
  accel: number;
  brakeDecel: number;
  turnRate: number;
}

const MODEL_SPEC_TABLE: Record<
  CarModelKind,
  { name: string; style: VehicleBodyStyle; maxSpeed: number; accel: number; brakeDecel: number; turnRate: number }
> = {
  ferrari: { name: 'Solstice GT', style: 'supercar', maxSpeed: 54, accel: 24, brakeDecel: 38, turnRate: 2.35 },
  spyder: { name: 'Coastal Spyder', style: 'spyder', maxSpeed: 52, accel: 23, brakeDecel: 37, turnRate: 2.45 },
  gt: { name: 'Street GT', style: 'coupe', maxSpeed: 53, accel: 25, brakeDecel: 38, turnRate: 2.4 },
  coupe: { name: 'Miami GT Coupe', style: 'coupe', maxSpeed: 52, accel: 24, brakeDecel: 37, turnRate: 2.4 },
  jdm: { name: 'Biscayne JDM', style: 'coupe', maxSpeed: 51, accel: 24, brakeDecel: 37, turnRate: 2.5 },
  ev: { name: 'Metro EV', style: 'sedan', maxSpeed: 50, accel: 26, brakeDecel: 36, turnRate: 2.15 },
  taxi: { name: 'Sol City Taxi', style: 'sedan', maxSpeed: 47, accel: 21, brakeDecel: 35, turnRate: 2.2 },
  suv: { name: 'Coastal SUV', style: 'sedan', maxSpeed: 46, accel: 20, brakeDecel: 34, turnRate: 2.05 },
};

export function getModelDisplayName(kind: CarModelKind): string {
  return MODEL_SPEC_TABLE[kind].name;
}

export function createVehicleConfigForModel(
  id: string,
  modelKind: CarModelKind,
  spawnX: number,
  spawnZ: number,
  spawnYaw: number,
  customName?: string,
  customColorHex?: number,
): VehicleConfig {
  const spec = MODEL_SPEC_TABLE[modelKind];
  return {
    id,
    name: customName ?? spec.name,
    style: spec.style,
    modelKind,
    defaultPaintIndex: 0,
    customColorHex,
    spawnX,
    spawnZ,
    spawnYaw,
    maxSpeed: spec.maxSpeed,
    accel: spec.accel,
    brakeDecel: spec.brakeDecel,
    turnRate: spec.turnRate,
  };
}

export const DEFAULT_VEHICLES: VehicleConfig[] = [
  {
    id: 'solstice-gt',
    name: 'Solstice GT',
    style: 'supercar',
    modelKind: 'ferrari',
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
    modelKind: 'ev',
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
    modelKind: 'spyder',
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
    modelKind: 'gt',
    defaultPaintIndex: 3,
    spawnX: -16,
    spawnZ: -90,
    spawnYaw: Math.PI,
    maxSpeed: 53,
    accel: 25,
    brakeDecel: 38,
    turnRate: 2.4,
  },
  {
    id: 'ocean-taxi',
    name: 'Sol City Taxi',
    style: 'sedan',
    modelKind: 'taxi',
    defaultPaintIndex: 5,
    spawnX: 74,
    spawnZ: 18,
    spawnYaw: 0,
    maxSpeed: 47,
    accel: 21,
    brakeDecel: 35,
    turnRate: 2.2,
  },
  {
    id: 'midnight-jdm',
    name: 'Biscayne JDM',
    style: 'coupe',
    modelKind: 'jdm',
    defaultPaintIndex: 4,
    spawnX: -66,
    spawnZ: 164,
    spawnYaw: Math.PI * 0.5,
    maxSpeed: 51,
    accel: 24,
    brakeDecel: 37,
    turnRate: 2.5,
  },
  {
    id: 'coral-suv',
    name: 'Coral Cruiser SUV',
    style: 'sedan',
    modelKind: 'suv',
    defaultPaintIndex: 0,
    spawnX: -286,
    spawnZ: 28,
    spawnYaw: 0,
    maxSpeed: 46,
    accel: 20,
    brakeDecel: 34,
    turnRate: 2.05,
  },
  {
    id: 'wynwood-coupe',
    name: 'Wynwood GT Coupe',
    style: 'coupe',
    modelKind: 'coupe',
    defaultPaintIndex: 1,
    spawnX: -196,
    spawnZ: -268,
    spawnYaw: Math.PI,
    maxSpeed: 52,
    accel: 24,
    brakeDecel: 37,
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
  vy: number;
  vz: number;
  yaw: number;
  yawRate: number;
  steerAngle: number;
  wheelSpin: number;
  suspOffset: number;
  suspVel: number;
  pitchTilt: number;
  pitchVel: number;
  rollTilt: number;
  rollVel: number;
  grounded: boolean;
  speed: number;
  lateralSpeed: number;
  drifting: boolean;
  braking: boolean;
  headlightsOn: boolean;
  paintIndex: number;
  odometerMeters: number;
  mass: number;
  lastCollisionImpact: number;
  lastImpactX: number;
  lastImpactZ: number;
  lastImpactNx: number;
  lastImpactNz: number;
  config: VehicleConfig;
}

export function createVehicleState(cfg: VehicleConfig): VehicleState {
  const mass =
    cfg.modelKind === 'suv'
      ? 2150
      : cfg.modelKind === 'taxi' || cfg.modelKind === 'ev'
        ? 1720
        : cfg.modelKind === 'ferrari'
          ? 1450
          : 1540;
  return {
    id: cfg.id,
    name: cfg.name,
    style: cfg.style,
    x: cfg.spawnX,
    y: getGroundHeight(cfg.spawnX, cfg.spawnZ),
    z: cfg.spawnZ,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: cfg.spawnYaw,
    yawRate: 0,
    steerAngle: 0,
    wheelSpin: 0,
    suspOffset: 0,
    suspVel: 0,
    pitchTilt: 0,
    pitchVel: 0,
    rollTilt: 0,
    rollVel: 0,
    grounded: true,
    speed: 0,
    lateralSpeed: 0,
    drifting: false,
    braking: false,
    headlightsOn: true,
    paintIndex: cfg.defaultPaintIndex,
    odometerMeters: 0,
    mass,
    lastCollisionImpact: 0,
    lastImpactX: cfg.spawnX,
    lastImpactZ: cfg.spawnZ,
    lastImpactNx: 0,
    lastImpactNz: 1,
    config: cfg,
  };
}

/**
 * GTA-style dynamic vehicle physics model:
 * - True yaw angular momentum (`yawRate`) with front/rear tire slip-angle grip & powerslides
 * - Controllable handbrake drifts, RWD exit oversteer, & counter-steer recovery
 * - Real 3D airborne jumps off bridges/ramps/dunes under gravity (-21 m/s²)
 * - Second-order damped spring suspension (`suspOffset`, `pitchTilt`, `rollTilt`) with squat, dive, body roll & landing compression
 * - Rotational crash impulse when glancing off walls & corners
 */
export function stepVehiclePhysics(
  v: VehicleState,
  input: VehicleDriveInput,
  dt: number,
  colliders: AABB[],
  propObbs: OBB2D[] = [],
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  v.lastCollisionImpact = 0;

  const fwd = forwardFromYaw(v.yaw);
  const right = rightFromYaw(v.yaw);

  let forwardSpeed = v.vx * fwd.x + v.vz * fwd.z;
  let lateralSpeed = v.vx * right.x + v.vz * right.z;
  const prevForward = forwardSpeed;

  const isSportRwd = v.style === 'supercar' || v.style === 'coupe' || v.style === 'spyder';
  const absSpeed = Math.abs(forwardSpeed);

  // Speed-sensitive steering angle (tight low-speed lock, stable high-speed precision)
  const maxSteerAngle = lerp(0.54, 0.24, clamp(absSpeed / v.config.maxSpeed, 0, 1));
  const targetSteer = input.steer * maxSteerAngle;
  v.steerAngle = lerp(v.steerAngle, targetSteer, clamp(safeDt * 12, 0, 1));

  v.braking = false;
  let accelForce = 0;

  if (v.grounded) {
    // 1. Longitudinal drive, braking, handbrake & aerodynamic drag
    if (input.handbrake) {
      v.braking = true;
      const hbDecel = v.config.brakeDecel * 0.52 * safeDt;
      if (absSpeed <= hbDecel) forwardSpeed = 0;
      else forwardSpeed -= Math.sign(forwardSpeed) * hbDecel;
    } else if (input.throttle > 0.05) {
      if (forwardSpeed < -1.2) {
        v.braking = true;
        forwardSpeed += v.config.brakeDecel * safeDt;
      } else {
        const topRatio = clamp(forwardSpeed / v.config.maxSpeed, 0, 1);
        // Punchy low-end launch torque tapering smoothly toward top speed
        const torqueCurve = 1.18 - topRatio * 0.78;
        const delta = input.throttle * v.config.accel * torqueCurve * safeDt;
        forwardSpeed += delta;
        accelForce = delta / safeDt;
      }
    } else if (input.throttle < -0.05) {
      if (forwardSpeed > 1.2) {
        v.braking = true;
        const delta = v.config.brakeDecel * safeDt;
        forwardSpeed -= delta;
        accelForce = -delta / safeDt;
      } else {
        const delta = input.throttle * v.config.accel * 0.56 * safeDt;
        forwardSpeed += delta;
        accelForce = delta / safeDt;
      }
    } else {
      // Natural rolling resistance + quadratic aero drag
      const drag = (0.72 + absSpeed * 0.012) * safeDt;
      forwardSpeed *= Math.exp(-drag);
      if (Math.abs(forwardSpeed) < 0.06) forwardSpeed = 0;
    }

    forwardSpeed = clamp(forwardSpeed, -17, v.config.maxSpeed);

    // 2. GTA-style yaw rotational inertia & front/rear tire slip dynamics!
    const dirSign = forwardSpeed >= -0.1 ? 1 : -1;
    const speedEngage = clamp(Math.abs(forwardSpeed) / 6.5, 0, 1);
    const highSpeedTrim = 1.0 - clamp(Math.abs(forwardSpeed) / (v.config.maxSpeed * 1.55), 0, 0.36);

    // Handbrake or hard RWD throttle-cornering breaks rear traction into a smooth drift!
    const powerOversteer =
      isSportRwd && input.throttle > 0.65 && Math.abs(input.steer) > 0.5 && absSpeed > 10 && absSpeed < 34;
    const rearBreakaway = input.handbrake && absSpeed > 5.5 ? 1.48 : powerOversteer ? 1.18 : 1.0;

    // Target angular velocity from steering + natural counter-steer recovery when sliding
    const desiredYawRate =
      input.steer * v.config.turnRate * speedEngage * highSpeedTrim * rearBreakaway * dirSign;

    // Responsive turn-in with real rotational inertia (lets car hold a slide & counter-steer!)
    const yawResponse = input.handbrake ? 5.2 : 8.5;
    v.yawRate = lerp(v.yawRate, desiredYawRate, clamp(safeDt * yawResponse, 0, 1));
    if (absSpeed < 0.35 && Math.abs(v.yawRate) < 0.15) {
      v.yawRate *= Math.exp(-10 * safeDt);
    }
    v.yaw = wrapAngle(v.yaw + v.yawRate * safeDt);

    // 3. Recompute lateral slip velocity in the newly rotated car frame
    const newFwd = forwardFromYaw(v.yaw);
    const newRight = rightFromYaw(v.yaw);
    const oldLat = v.vx * newRight.x + v.vz * newRight.z;

    // Dynamic tire lateral grip: tight when cruising, sliding smoothly on handbrake/power-drift!
    const slipRatio = clamp(Math.abs(oldLat) / 11, 0, 1);
    const baseGrip = isSportRwd ? 7.8 : 9.2;
    const lateralGrip = input.handbrake
      ? 1.55
      : powerOversteer
        ? 3.4
        : lerp(baseGrip, baseGrip * 0.52, slipRatio * 0.65);

    // Slight rear kickout during handbrake/power-slide adds authentic GTA drift angle!
    const driftKick =
      (input.handbrake || powerOversteer) && absSpeed > 8
        ? -input.steer * absSpeed * (input.handbrake ? 0.14 : 0.055) * safeDt
        : 0;
    lateralSpeed = oldLat * Math.exp(-lateralGrip * safeDt) + driftKick;
    if (Math.abs(lateralSpeed) < 0.03) lateralSpeed = 0;

    // Mild cornering scrub when drifting hard (realistic tire scrubbing energy loss)
    if (Math.abs(lateralSpeed) > 3.5) {
      forwardSpeed *= Math.exp(-0.28 * clamp(Math.abs(lateralSpeed) / 10, 0, 1) * safeDt);
    }

    const isBurnout = isSportRwd && input.handbrake && input.throttle > 0.5 && absSpeed < 6;
    v.drifting = isBurnout || ((input.handbrake || Math.abs(lateralSpeed) > 3.6) && absSpeed > 7.5);
    v.vx = newFwd.x * forwardSpeed + newRight.x * lateralSpeed;
    v.vz = newFwd.z * forwardSpeed + newRight.z * lateralSpeed;
  } else {
    // Mid-air ballistic flight: slight air drag & damped angular rotation!
    v.yawRate *= Math.exp(-1.4 * safeDt);
    v.yaw = wrapAngle(v.yaw + v.yawRate * safeDt);
    v.vx *= Math.exp(-0.18 * safeDt);
    v.vz *= Math.exp(-0.18 * safeDt);
    v.drifting = false;
  }

  // 4. Integrate XZ position & resolve exact SAT OBB building/wall collisions WITH corner-spin torque!
  const prevX = v.x;
  const prevZ = v.z;
  v.x += v.vx * safeDt;
  v.z += v.vz * safeDt;

  for (const box of colliders) {
    const contact = resolveCarVsBuildingSAT(v, box);
    if (contact.hit && contact.closingSpeed > 0.1) {
      const impact = contact.closingSpeed;
      if (impact > v.lastCollisionImpact) {
        v.lastCollisionImpact = impact;
        v.lastImpactX = contact.contactX;
        v.lastImpactZ = contact.contactZ;
        v.lastImpactNx = contact.nx;
        v.lastImpactNz = contact.nz;
      }
      // Realistic chassis compression & nose jolt on wall crunch
      v.pitchVel -= clamp(impact * 0.042, 0, 0.9);
      v.suspVel -= clamp(impact * 0.065, 0, 1.3);
    }
  }
  for (const obb of propObbs) {
    const contact = resolveCarVsObbSAT(v, obb);
    if (contact.hit && contact.closingSpeed > 0.1) {
      const impact = contact.closingSpeed;
      if (impact > v.lastCollisionImpact) {
        v.lastCollisionImpact = impact;
        v.lastImpactX = contact.contactX;
        v.lastImpactZ = contact.contactZ;
        v.lastImpactNx = contact.nx;
        v.lastImpactNz = contact.nz;
      }
      v.pitchVel -= clamp(impact * 0.036, 0, 0.75);
      v.suspVel -= clamp(impact * 0.055, 0, 1.1);
    }
  }

  let nextX = v.x;
  let nextZ = v.z;
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

  // 5. Real 3D vertical gravity, crest jumps (Causeway, dunes, pier!) & spring-damper suspension!
  const prevGroundY = getGroundHeight(prevX, prevZ);
  const groundY = getGroundHeight(v.x, v.z);
  const terrainDrop = groundY - prevGroundY;
  const horizMoved = Math.hypot(v.x - prevX, v.z - prevZ);

  if (v.grounded) {
    // Estimate terrain vertical slope velocity when cresting ramps/bridges/dunes at speed
    const slopeVy = terrainDrop / safeDt;
    // Catch real air when flying off a sharp ramp/crest drop faster than gravity pulls down!
    if (slopeVy < -2.6 && horizMoved / safeDt > 14 && v.y > groundY + 0.08) {
      v.grounded = false;
      v.vy = clamp(v.vy, 0.8, 6.5);
    } else {
      // Track upward slope momentum so launching off a ramp crest carries upward velocity!
      if (slopeVy > 0.6 && horizMoved / safeDt > 10) {
        v.vy = lerp(v.vy, clamp(slopeVy, 0, 7.5), clamp(safeDt * 12, 0, 1));
      } else {
        v.vy *= Math.exp(-10 * safeDt);
      }

      const curbDelta = groundY - v.y;
      v.y = lerp(v.y, groundY, clamp(safeDt * 24, 0, 1));
      if (Math.abs(v.y - groundY) < 0.01) v.y = groundY;

      // Curb / dune bump compresses chassis suspension spring realistically!
      if (Math.abs(curbDelta) > 0.05 && horizMoved > 0.04) {
        v.suspVel -= clamp(curbDelta * 3.8, -1.8, 1.8);
        v.pitchVel -= clamp(curbDelta * 1.4, -0.7, 0.7);
      }
    }
  } else {
    v.vy -= 21.0 * safeDt;
    v.y += v.vy * safeDt;
    if (v.y <= groundY) {
      const landImpact = Math.max(0, -v.vy);
      v.y = groundY;
      v.vy = 0;
      v.grounded = true;
      // Heavy landing compresses suspension & triggers subtle bump impact!
      v.suspVel -= clamp(landImpact * 0.42, 0, 3.2);
      v.pitchVel -= clamp(landImpact * 0.06, 0, 0.6);
      if (landImpact > 4.5) {
        v.lastCollisionImpact = Math.max(v.lastCollisionImpact, landImpact * 0.7);
      }
    }
  }

  // Second-order damped spring suspension for vertical bounce, pitch (squat/dive), and body roll!
  const suspK = 68;
  const suspDamp = 9.5;
  v.suspVel += (-suspK * v.suspOffset - suspDamp * v.suspVel) * safeDt;
  v.suspOffset = clamp(v.suspOffset + v.suspVel * safeDt, -0.18, 0.16);

  const curFwd = forwardFromYaw(v.yaw);
  const curRight = rightFromYaw(v.yaw);
  v.speed = v.vx * curFwd.x + v.vz * curFwd.z;
  v.lateralSpeed = v.vx * curRight.x + v.vz * curRight.z;
  v.odometerMeters += horizMoved;
  v.wheelSpin += (v.speed / 0.37) * safeDt;

  const accelInstant = accelForce !== 0 ? accelForce : (v.speed - prevForward) / safeDt;
  // Soft suspension cars (SUV/Taxi/Sedan) roll & squat more than stiff supercars!
  const softness = v.style === 'sedan' ? 1.45 : v.style === 'spyder' ? 1.15 : 0.95;

  // Sample rolling road slope under front/rear axles & left/right track so vehicles tilt naturally over hills!
  let groundPitch = 0;
  let groundRoll = 0;
  if (v.grounded) {
    const yFwd = getGroundHeight(v.x + curFwd.x * 1.8, v.z + curFwd.z * 1.8);
    const yBack = getGroundHeight(v.x - curFwd.x * 1.8, v.z - curFwd.z * 1.8);
    const yRight = getGroundHeight(v.x + curRight.x * 0.9, v.z + curRight.z * 0.9);
    const yLeft = getGroundHeight(v.x - curRight.x * 0.9, v.z - curRight.z * 0.9);
    groundPitch = clamp(Math.atan2(yFwd - yBack, 3.6), -0.22, 0.22);
    groundRoll = clamp(Math.atan2(yLeft - yRight, 1.8), -0.16, 0.16);
  }

  // Right-hand rule around +X with nose at -Z: +pitch lifts nose (uphill + rear squat), -pitch dips nose (downhill + brake dive)
  const targetPitch = v.grounded
    ? clamp(groundPitch + accelInstant * 0.0034 * softness, -0.26, 0.26)
    : clamp(v.vy * 0.024, -0.22, 0.22);
  // Right-hand rule around +Z: turning right (+yawRate) shifts weight left (-X down, +X up -> +rollTilt)
  const lateralG = v.grounded ? v.yawRate * v.speed * 0.012 + v.lateralSpeed * 0.008 : 0;
  const targetRoll = clamp(groundRoll + lateralG * 0.38 * softness, -0.22, 0.22);

  const pitchK = 54;
  const pitchDamp = 8.2;
  v.pitchVel += (pitchK * (targetPitch - v.pitchTilt) - pitchDamp * v.pitchVel) * safeDt;
  v.pitchTilt = clamp(v.pitchTilt + v.pitchVel * safeDt, -0.28, 0.28);

  const rollK = 50;
  const rollDamp = 7.8;
  v.rollVel += (rollK * (targetRoll - v.rollTilt) - rollDamp * v.rollVel) * safeDt;
  v.rollTilt = clamp(v.rollTilt + v.rollVel * safeDt, -0.22, 0.22);
}

/**
 * Resolves exact 2D SAT rigid-body collisions between ALL drivable player vehicles
 * (so you can NEVER drive through parked fleet cars — ramming a parked taxi or SUV
 * physically shunts, spins, and jolts both vehicles with true mass & lever-arm physics!).
 */
export function resolveVehiclePairCollisions(vehicles: VehicleState[]): void {
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const contact = resolveCarVsCarSAT(a, b);
      if (!contact.hit) continue;

      if (contact.closingSpeed > 0.25) {
        const impact = contact.closingSpeed;
        for (const car of [a, b]) {
          if (impact > car.lastCollisionImpact) {
            car.lastCollisionImpact = impact;
            car.lastImpactX = contact.contactX;
            car.lastImpactZ = contact.contactZ;
            car.lastImpactNx = contact.nx;
            car.lastImpactNz = contact.nz;
          }
          car.suspVel -= clamp(impact * 0.08, 0, 1.5);
          car.pitchVel -= clamp(impact * 0.045, 0, 0.9);
          car.rollVel += clamp((car === a ? 1 : -1) * impact * 0.05, -0.9, 0.9);
          const cf = forwardFromYaw(car.yaw);
          car.speed = car.vx * cf.x + car.vz * cf.z;
        }
      }
    }
  }
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

interface DriftSmokeParticle {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
}

export interface ActiveHeadlightRig {
  spot: THREE.SpotLight;
  target: THREE.Object3D;
  sync: (activeVehicle: VehicleState | null, nightFactor: number) => void;
}

/** Single shared SpotLight rig attached dynamically to whichever car the player is driving (1 SpotLight total!) */
export function createActiveHeadlightRig(scene: THREE.Scene): ActiveHeadlightRig {
  const spot = new THREE.SpotLight(0xe8f9ff, 0, 62, Math.PI * 0.26, 0.52, 1.2);
  const target = new THREE.Object3D();
  spot.target = target;
  scene.add(spot);
  scene.add(target);

  return {
    spot,
    target,
    sync(activeVehicle, nightFactor) {
      if (!activeVehicle || !activeVehicle.headlightsOn || nightFactor <= 0.08) {
        spot.intensity = 0;
        return;
      }
      const fwd = forwardFromYaw(activeVehicle.yaw);
      spot.position.set(
        activeVehicle.x + fwd.x * 2.35,
        activeVehicle.y + 0.85 + activeVehicle.suspOffset,
        activeVehicle.z + fwd.z * 2.35,
      );
      target.position.set(
        activeVehicle.x + fwd.x * 28,
        activeVehicle.y + 0.08,
        activeVehicle.z + fwd.z * 28,
      );
      target.updateMatrixWorld();
      spot.intensity = 28 * nightFactor;
    },
  };
}

export interface VehicleMeshHandles {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  caliperMaterial: THREE.MeshStandardMaterial;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  wheelMeshes: THREE.Object3D[];
  frontWheelPivots: THREE.Object3D[];
  syncFromState: (state: VehicleState, nightFactor: number, dt?: number, isOccupied?: boolean) => void;
  applyPaint: (paintIndex: number) => void;
  attachGltfSupercar: (ferrariRoot: THREE.Group) => void;
  attachGltfCar: (carRoot: THREE.Group, isFerrari?: boolean) => void;
  dispose: () => void;
}

let sharedContactShadowTex: THREE.CanvasTexture | null = null;
let sharedPlateTex: THREE.CanvasTexture | null = null;
let sharedSmokeTex: THREE.CanvasTexture | null = null;
let sharedGlowTex: THREE.CanvasTexture | null = null;

export function createVehicleMesh(state: VehicleState, scene: THREE.Scene): VehicleMeshHandles {
  if (!sharedContactShadowTex) sharedContactShadowTex = createContactShadowTexture();
  if (!sharedPlateTex) sharedPlateTex = createLicensePlateTexture();
  if (!sharedSmokeTex) sharedSmokeTex = createSmokePuffTexture();
  if (!sharedGlowTex) sharedGlowTex = createLightGlowTexture();

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const finish = PAINT_FINISHES[state.paintIndex % PAINT_FINISHES.length];
  const initialColorHex = state.config.customColorHex ?? finish.hex;

  // True high-gloss metallic automotive clearcoat paint reflecting PMREM sky & clouds!
  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: initialColorHex,
    metalness: 0.72,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.85,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: finish.accentHex,
    metalness: 0.55,
    roughness: 0.25,
  });

  const caliperMaterial = new THREE.MeshStandardMaterial({
    color: finish.caliperHex,
    metalness: 0.45,
    roughness: 0.28,
  });

  const carbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x13161e,
    roughness: 0.3,
    metalness: 0.38,
    clearcoat: 0.65,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xeef3fa,
    metalness: 0.98,
    roughness: 0.08,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x091420,
    roughness: 0.03,
    metalness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 0.82,
    envMapIntensity: 2.3,
  });

  const interiorMat = new THREE.MeshStandardMaterial({
    color: state.style === 'spyder' ? 0x623b26 : 0x181c26,
    roughness: 0.75,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4fcff,
    emissive: 0xd9f7ff,
    emissiveIntensity: 2.4,
  });

  const brakeLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff1638,
    emissive: 0xff1133,
    emissiveIntensity: 1.5,
  });

  // Soft ground ambient-occlusion contact shadow
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 5.8),
    new THREE.MeshBasicMaterial({
      map: sharedContactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.86,
    }),
  );
  shadowPlane.rotation.x = -Math.PI * 0.5;
  shadowPlane.position.y = 0.045;
  root.add(shadowPlane);

  // 1. TRUE 3D MULTI-STATION LOFTED CURVED AUTOMOTIVE SHELL!
  const bodyMesh = new THREE.Mesh(createSculptedCarBodyGeometry(state.style), paintMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  // Dark recessed wheel well arches so tires sit tucked cleanly inside the fenders
  for (const wz of [-1.42, 1.42]) {
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 1.98, 16),
      carbonMat,
    );
    well.rotation.z = Math.PI * 0.5;
    well.position.set(0, 0.42, wz);
    bodyGroup.add(well);
  }

  // Front aero splitter, intake mesh, side skirts, wing mirrors, carbon diffuser & quad exhaust
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.07, 0.56), carbonMat);
  splitter.position.set(0, 0.21, -2.24);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.2, 0.14), carbonMat);
  grille.position.set(0, 0.36, -2.38);
  bodyGroup.add(grille);

  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 2.38), carbonMat);
    skirt.position.set(side * 0.94, 0.23, 0);
    bodyGroup.add(skirt);

    // Sculpted side aero intake duct
    if (state.style === 'supercar' || state.style === 'coupe') {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.64), carbonMat);
      intake.position.set(side * 0.99, 0.54, 0.65);
      bodyGroup.add(intake);
    }

    // Aerodynamic mirrors
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.06), carbonMat);
    stalk.position.set(side * 0.96, 0.9, -0.64);
    bodyGroup.add(stalk);
    const mirrorCap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), paintMaterial);
    mirrorCap.scale.set(1.25, 0.66, 1.45);
    mirrorCap.position.set(side * 1.09, 0.94, -0.62);
    bodyGroup.add(mirrorCap);
  }

  // Rear carbon diffuser with vertical strakes + quad chrome exhaust tips + SOL 305 plate
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.24, 0.34), carbonMat);
  diffuser.position.set(0, 0.32, 2.22);
  bodyGroup.add(diffuser);
  for (let fx = -0.54; fx <= 0.54; fx += 0.27) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.4), carbonMat);
    fin.position.set(fx, 0.27, 2.25);
    bodyGroup.add(fin);
  }
  const exhaustGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.24, 12);
  exhaustGeo.rotateX(Math.PI * 0.5);
  for (const ex of [-0.6, -0.44, 0.44, 0.6]) {
    const tip = new THREE.Mesh(exhaustGeo, chromeMat);
    tip.position.set(ex, 0.32, 2.36);
    bodyGroup.add(tip);
  }

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, 0.21),
    new THREE.MeshStandardMaterial({ map: sharedPlateTex, roughness: 0.38 }),
  );
  plate.position.set(0, 0.55, 2.37);
  bodyGroup.add(plate);

  // 2. Cockpit Interior + Visible Seated Driver Silhouette (turns steering wheel!)
  for (const sx of [-0.4, 0.4]) {
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.54, 0.14), interiorMat);
    seatBack.position.set(sx, 0.86, 0.44);
    seatBack.rotation.x = -0.22;
    bodyGroup.add(seatBack);
    const headrest = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.11, 4, 8), interiorMat);
    headrest.position.set(sx, 1.16, 0.5);
    bodyGroup.add(headrest);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.2, 0.52), carbonMat);
  dash.position.set(0, 0.8, -0.52);
  bodyGroup.add(dash);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(-0.4, 0.92, -0.34);
  steeringWheel.rotation.x = -0.35;
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 16), carbonMat);
  steeringWheel.add(wheelRim);
  bodyGroup.add(steeringWheel);

  // 3. Sculpted Lofted Glass Greenhouse OR Open-Top Spyder Windshield & Roll Hoops
  if (state.style === 'spyder') {
    const wsFrame = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.52, 0.055), glassMat);
    wsFrame.position.set(0, 1.02, -0.76);
    wsFrame.rotation.x = -0.62;
    bodyGroup.add(wsFrame);

    for (const side of [-0.78, 0.78]) {
      const aPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.6, 8), paintMaterial);
      aPillar.position.set(side, 1.02, -0.76);
      aPillar.rotation.x = -0.62;
      bodyGroup.add(aPillar);
    }

    for (const side of [-0.42, 0.42]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 10, 18, Math.PI), chromeMat);
      hoop.position.set(side, 0.98, 0.76);
      bodyGroup.add(hoop);
    }
  } else {
    const canopyMesh = new THREE.Mesh(createSculptedCabinGeometry(state.style), glassMat);
    canopyMesh.castShadow = true;
    bodyGroup.add(canopyMesh);

    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(1.08, 0.045, state.style === 'sedan' ? 1.1 : 0.85),
      state.style === 'supercar' ? carbonMat : paintMaterial,
    );
    roofCap.position.set(0, state.style === 'sedan' ? 1.46 : 1.32, 0.12);
    bodyGroup.add(roofCap);
  }

  // Swan-neck carbon rear wing for supercar / coupe
  if (state.style === 'supercar' || state.style === 'coupe') {
    const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.32), carbonMat);
    wingBlade.position.set(0, 1.18, 2.08);
    wingBlade.rotation.x = 0.08;
    wingBlade.castShadow = true;
    bodyGroup.add(wingBlade);

    for (const side of [-0.95, 0.95]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.21, 0.38), paintMaterial);
      endplate.position.set(side, 1.17, 2.08);
      bodyGroup.add(endplate);
    }
    for (const side of [-0.5, 0.5]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.27, 0.16), carbonMat);
      strut.position.set(side, 1.03, 2.01);
      strut.rotation.x = -0.18;
      bodyGroup.add(strut);
    }
  }

  // 4. Sculpted Angular LED Headlights + Additive Lens Glow Halos + Full-Width OLED Tailbar
  const headGlowSprites: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.15, 0.26), carbonMat);
    housing.position.set(side * 0.62, 0.56, -2.24);
    housing.rotation.y = side * -0.22;
    bodyGroup.add(housing);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.1), headlightMaterial);
    drl.position.set(side * 0.62, 0.59, -2.34);
    drl.rotation.y = side * -0.22;
    bodyGroup.add(drl);

    const glowMat = new THREE.SpriteMaterial({
      map: sharedGlowTex,
      color: 0xd9f7ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(glowMat);
    sp.position.set(side * 0.62, 0.58, -2.42);
    sp.scale.set(1.1, 0.75, 1);
    bodyGroup.add(sp);
    headGlowSprites.push(sp);
  }

  const tailHousing = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.16, 0.14), carbonMat);
  tailHousing.position.set(0, 0.74, 2.28);
  bodyGroup.add(tailHousing);

  const tailbar = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.075, 0.08), brakeLightMaterial);
  tailbar.position.set(0, 0.74, 2.34);
  bodyGroup.add(tailbar);

  const tailGlowSprites: THREE.Sprite[] = [];
  for (const side of [-0.62, 0.62]) {
    const tGlowMat = new THREE.SpriteMaterial({
      map: sharedGlowTex,
      color: 0xff2244,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(tGlowMat);
    sp.position.set(side, 0.74, 2.42);
    sp.scale.set(1.0, 0.65, 1);
    bodyGroup.add(sp);
    tailGlowSprites.push(sp);
  }

  // 5. Realistic Wheels: Rounded Torus Tires + 5-Spoke Alloy Rims + Brake Rotors & Stationary Calipers
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161920, roughness: 0.86, metalness: 0.05 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0xa0aab8, metalness: 0.84, roughness: 0.32 });

  const wheelPositions = [
    { x: -0.99, z: -1.42, front: true },
    { x: 0.99, z: -1.42, front: true },
    { x: -1.01, z: 1.42, front: false },
    { x: 1.01, z: 1.42, front: false },
  ];

  const wheelMeshes: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];
  const proceduralWheelPivots: THREE.Object3D[] = [];
  let gltfWheelBaseRotX = 0;

  for (const wp of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, 0.37, wp.z);
    root.add(pivot);
    proceduralWheelPivots.push(pivot);
    if (wp.front) frontWheelPivots.push(pivot);

    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), caliperMaterial);
    caliper.position.set(Math.sign(wp.x) * 0.03, 0.06, wp.front ? 0.15 : -0.15);
    pivot.add(caliper);

    const wheelSpinGroup = new THREE.Group();
    pivot.add(wheelSpinGroup);
    wheelMeshes.push(wheelSpinGroup);

    const tread = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.24, 24), tireMat);
    tread.rotation.z = Math.PI * 0.5;
    tread.castShadow = true;
    wheelSpinGroup.add(tread);

    const sidewall = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.075, 10, 24), tireMat);
    sidewall.rotation.y = Math.PI * 0.5;
    sidewall.position.x = Math.sign(wp.x) * 0.075;
    wheelSpinGroup.add(sidewall);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.27, 20), chromeMat);
    barrel.rotation.z = Math.PI * 0.5;
    wheelSpinGroup.add(barrel);

    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 18), rotorMat);
    rotor.rotation.z = Math.PI * 0.5;
    rotor.position.x = Math.sign(wp.x) * 0.02;
    wheelSpinGroup.add(rotor);

    const outerX = Math.sign(wp.x) * 0.135;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), accentMaterial);
    hub.rotation.z = Math.PI * 0.5;
    hub.position.x = outerX;
    wheelSpinGroup.add(hub);

    for (let sp = 0; sp < 5; sp++) {
      const ang = (sp / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.22, 0.042), chromeMat);
      spoke.position.set(outerX, Math.cos(ang) * 0.12, Math.sin(ang) * 0.12);
      spoke.rotation.x = ang;
      wheelSpinGroup.add(spoke);
    }
  }

  // Drift tire smoke + persistent asphalt skid marks ring buffer!
  const smokePool: DriftSmokeParticle[] = [];
  const skidMarks: THREE.Mesh[] = [];
  const skidGeo = new THREE.PlaneGeometry(0.32, 0.92);
  skidGeo.rotateX(-Math.PI * 0.5);
  const skidMat = new THREE.MeshBasicMaterial({
    color: 0x0b0c10,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  let smokeTimer = 0;
  let skidTimer = 0;

  scene.add(root);

  const applyPaint = (paintIndex: number) => {
    const p = PAINT_FINISHES[((paintIndex % PAINT_FINISHES.length) + PAINT_FINISHES.length) % PAINT_FINISHES.length];
    paintMaterial.color.setHex(p.hex);
    accentMaterial.color.setHex(p.accentHex);
    caliperMaterial.color.setHex(p.caliperHex);
  };

  const syncFromState = (s: VehicleState, nightFactor: number, dt = 1 / 60, _isOccupied = false) => {
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = -s.yaw;
    bodyGroup.position.y = s.suspOffset;
    bodyGroup.rotation.x = s.pitchTilt;
    bodyGroup.rotation.z = s.rollTilt;

    steeringWheel.rotation.z = -s.steerAngle * 2.2;

    for (const p of frontWheelPivots) {
      p.rotation.y = -s.steerAngle;
    }
    for (const w of wheelMeshes) {
      w.rotation.x = gltfWheelBaseRotX - s.wheelSpin;
    }

    headlightMaterial.emissiveIntensity = s.headlightsOn ? 1.5 + nightFactor * 2.6 : 0.2;
    brakeLightMaterial.emissiveIntensity = s.braking ? 4.4 : 0.95 + nightFactor * 1.15;

    for (const sp of headGlowSprites) {
      sp.visible = s.headlightsOn;
      sp.material.opacity = 0.22 + nightFactor * 0.62;
    }
    for (const sp of tailGlowSprites) {
      sp.material.opacity = s.braking ? 0.78 : 0.16 + nightFactor * 0.44;
      const sc = s.braking ? 1.45 : 0.95;
      sp.scale.set(sc, sc * 0.65, 1);
    }

    // Drift tire smoke & asphalt skid marks
    if (s.drifting) {
      const fwd = forwardFromYaw(s.yaw);
      const right = rightFromYaw(s.yaw);

      smokeTimer += dt;
      if (smokeTimer >= 0.04 && sharedSmokeTex) {
        smokeTimer = 0;
        for (const side of [-0.96, 0.96]) {
          const mat = new THREE.SpriteMaterial({
            map: sharedSmokeTex,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          });
          const sp = new THREE.Sprite(mat);
          sp.position.set(
            s.x - fwd.x * 1.45 + right.x * side,
            s.y + 0.22,
            s.z - fwd.z * 1.45 + right.z * side,
          );
          sp.scale.set(0.8, 0.8, 1);
          scene.add(sp);
          smokePool.push({
            sprite: sp,
            vx: (Math.random() - 0.5) * 1.1,
            vy: 0.85 + Math.random() * 0.6,
            vz: (Math.random() - 0.5) * 1.1,
            age: 0,
            maxAge: 0.68 + Math.random() * 0.35,
          });
        }
      }

      skidTimer += dt;
      if (skidTimer >= 0.032) {
        skidTimer = 0;
        for (const side of [-0.96, 0.96]) {
          const mark = new THREE.Mesh(skidGeo, skidMat);
          mark.position.set(
            s.x - fwd.x * 1.42 + right.x * side,
            s.y + 0.058,
            s.z - fwd.z * 1.42 + right.z * side,
          );
          mark.rotation.y = -s.yaw;
          scene.add(mark);
          skidMarks.push(mark);
          if (skidMarks.length > 160) {
            const oldest = skidMarks.shift()!;
            scene.remove(oldest);
          }
        }
      }
    }

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
        const sc = 0.8 + life * 2.6;
        p.sprite.scale.set(sc, sc, 1);
        p.sprite.material.opacity = (1 - life) * 0.4;
      }
    }
  };

  const attachGltfCar = (carRoot: THREE.Group, isFerrari = false) => {
    // Hide procedural car shell & procedural wheel pivots while preserving glow halos, spotlights & contact shadow
    for (const child of bodyGroup.children) {
      if (!(child instanceof THREE.Sprite)) {
        child.visible = false;
      }
    }
    for (const wp of proceduralWheelPivots) {
      wp.visible = false;
    }

    carRoot.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      const name = obj.name.toLowerCase();
      const matName = Array.isArray(obj.material)
        ? ''
        : (obj.material?.name ?? '').toLowerCase();

      if (
        name === 'body' ||
        matName === 'body_color' ||
        matName === 'paint' ||
        matName.startsWith('body paint')
      ) {
        obj.material = paintMaterial;
      } else if (
        name === 'glass' ||
        matName === 'glass_gray' ||
        matName.startsWith('glass') ||
        matName.includes('tinted glass')
      ) {
        obj.material = glassMat;
      } else if (
        name === 'lights_red' ||
        matName === 'taillight_glass' ||
        matName === 'redlens' ||
        matName.includes('tail lamp')
      ) {
        obj.material = brakeLightMaterial;
      } else if (
        name === 'lights' ||
        name === 'leds' ||
        matName === 'projector_glass' ||
        matName === 'clearlens' ||
        matName.includes('clear lamp')
      ) {
        obj.material = headlightMaterial;
      } else if (name === 'trim' || matName === 'carbon_fiber') {
        obj.material = carbonMat;
      } else if (matName === 'metal_chrome' || matName === 'chrome') {
        obj.material = chromeMat;
      } else if (name === 'brakes' || matName.includes('brake caliper')) {
        obj.material = caliperMaterial;
      }
    });

    // Rewire steering & spinning wheels when the model provides dedicated wheel nodes (e.g. Ferrari 458)
    wheelMeshes.length = 0;
    frontWheelPivots.length = 0;
    if (isFerrari) {
      gltfWheelBaseRotX = -Math.PI * 0.5;
      const wheelNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
      for (const wn of wheelNames) {
        const wheelObj = carRoot.getObjectByName(wn);
        if (!wheelObj) continue;
        if (wn === 'wheel_fl' || wn === 'wheel_fr') {
          const parent = wheelObj.parent;
          if (parent) {
            const steerPivot = new THREE.Group();
            steerPivot.position.copy(wheelObj.position);
            wheelObj.position.set(0, 0, 0);
            parent.add(steerPivot);
            steerPivot.add(wheelObj);
            frontWheelPivots.push(steerPivot);
          }
        }
        wheelMeshes.push(wheelObj);
      }
    }

    bodyGroup.add(carRoot);
  };

  const attachGltfSupercar = (ferrariRoot: THREE.Group) => attachGltfCar(ferrariRoot, true);

  const dispose = () => {
    scene.remove(root);
    for (const sm of skidMarks) scene.remove(sm);
    for (const p of smokePool) scene.remove(p.sprite);
    skidMarks.length = 0;
    smokePool.length = 0;
  };

  syncFromState(state, 0.2, 0.016, false);

  return {
    root,
    bodyGroup,
    paintMaterial,
    accentMaterial,
    caliperMaterial,
    brakeLightMaterial,
    headlightMaterial,
    wheelMeshes,
    frontWheelPivots,
    syncFromState,
    applyPaint,
    attachGltfSupercar,
    attachGltfCar,
    dispose,
  };
}
