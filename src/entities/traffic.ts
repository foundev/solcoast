import * as THREE from 'three';
import {
  clamp,
  createRng,
  distXZ,
  lerp,
  lerpAngle,
  wrapAngle,
  yawFromDir,
  type AABB,
  type OBB2D,
} from '../core/math';
import { resolveCarVsBuildingSAT, resolveCarVsCarSAT, resolveCarVsObbSAT } from '../core/physics';
import type { CarModelKind } from '../world/assets';
import { getGroundHeight, isDeepWater } from '../world/cityData';
import { createLightGlowTexture } from '../world/postfx';
import { createContactShadowTexture } from '../world/textures';
import type { TrafficNode } from '../world/types';
import { createSculptedTrafficBodyGeometry } from './carGeometry';
import type { VehicleState } from './vehicle';

export interface TrafficCarState {
  id: number;
  modelKind: CarModelKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  yawRate: number;
  mass: number;
  /** Seconds remaining in free-skid crash physics after a heavy collision */
  stunnedTimer: number;
  pitchTilt: number;
  rollTilt: number;
  suspOffset: number;
  speed: number;
  cruiseSpeed: number;
  color: number;
  fromNode: number;
  toNode: number;
  progress: number;
  lastImpactSpeed: number;
  lastImpactX: number;
  lastImpactZ: number;
  lastImpactNx: number;
  lastImpactNz: number;
}

const TRAFFIC_MODELS: CarModelKind[] = ['taxi', 'suv', 'ev', 'coupe', 'gt', 'jdm', 'spyder'];

const TRAFFIC_COLORS = [
  0xeef2f7,
  0x2254a4,
  0xd85c18,
  0x158a64,
  0xc42848,
  0xd1a024,
  0x5842a4,
  0x1c7a88,
  0x36404f,
  0xb9c3cf,
  0x18253a,
  0xd4507a,
  0x26a69a,
  0xc8a96e,
];

export const TRAFFIC_RENDER_DIST = 225;
const TRAFFIC_RECYCLE_DIST = 320;
const TRAFFIC_SPAWN_MIN = 230;
const TRAFFIC_SPAWN_MAX = 305;

export function createTrafficCars(nodes: TrafficNode[], count = 48): TrafficCarState[] {
  const rng = createRng(991122);
  const cars: TrafficCarState[] = [];
  if (nodes.length === 0) return cars;

  // Identify central & coastal nodes so the player's starting neighborhood has lively traffic immediately
  const coreIndices: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].x >= -240 && nodes[i].z >= -240 && nodes[i].neighbors.length > 0) {
      coreIndices.push(i);
    }
  }

  for (let i = 0; i < count; i++) {
    const preferCore = coreIndices.length > 0 && i % 5 < 2;
    let chosenFrom = -1;
    let chosenTo = -1;
    let chosenProgress = 0.5;
    let chosenPos = { x: 0, z: 0, yaw: 0 };

    for (let attempt = 0; attempt < 14; attempt++) {
      const fromIdx =
        preferCore && attempt < 8
          ? coreIndices[Math.floor(rng() * coreIndices.length)]
          : Math.floor(rng() * nodes.length);
      const from = nodes[fromIdx];
      if (!from || from.neighbors.length === 0) continue;
      const toIdx = from.neighbors[Math.floor(rng() * from.neighbors.length)];
      const to = nodes[toIdx];
      if (!to) continue;
      const progress = 0.12 + rng() * 0.76;
      const pos = lanePosition(from, to, progress);

      let crowded = false;
      for (let j = 0; j < cars.length; j++) {
        const dx = cars[j].x - pos.x;
        const dz = cars[j].z - pos.z;
        if (dx * dx + dz * dz < 18 * 18) {
          crowded = true;
          break;
        }
      }
      chosenFrom = fromIdx;
      chosenTo = toIdx;
      chosenProgress = progress;
      chosenPos = pos;
      if (!crowded) break;
    }

    if (chosenFrom < 0) continue;
    const modelKind = TRAFFIC_MODELS[i % TRAFFIC_MODELS.length];
    const initSpeed = 11 + rng() * 6.5;
    const mass =
      modelKind === 'suv'
        ? 2150
        : modelKind === 'taxi' || modelKind === 'ev'
          ? 1720
          : 1520;
    cars.push({
      id: i,
      modelKind,
      x: chosenPos.x,
      y: getGroundHeight(chosenPos.x, chosenPos.z),
      z: chosenPos.z,
      vx: Math.sin(chosenPos.yaw) * initSpeed,
      vz: -Math.cos(chosenPos.yaw) * initSpeed,
      yaw: chosenPos.yaw,
      yawRate: 0,
      mass,
      stunnedTimer: 0,
      pitchTilt: 0,
      rollTilt: 0,
      suspOffset: 0,
      speed: initSpeed,
      cruiseSpeed: 12 + rng() * 6.5,
      color: modelKind === 'taxi' ? 0xf5b81d : TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
      fromNode: chosenFrom,
      toNode: chosenTo,
      progress: chosenProgress,
      lastImpactSpeed: 0,
      lastImpactX: chosenPos.x,
      lastImpactZ: chosenPos.z,
      lastImpactNx: 0,
      lastImpactNz: 1,
    });
  }
  return cars;
}

export function findNearestTrafficCar(
  x: number,
  z: number,
  cars: TrafficCarState[],
  maxRange = 5.8,
): { car: TrafficCarState; dist: number } | null {
  let best: TrafficCarState | null = null;
  let bestDist = maxRange;
  for (const c of cars) {
    const d = distXZ(x, z, c.x, c.z);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best ? { car: best, dist: bestDist } : null;
}

/**
 * Relocates a commandeered AI traffic car slot to a distant road intersection (>220m away)
 * so the player drives the taken car as a full VehicleState while street traffic stays lively.
 */
export function relocateTrafficCarAway(
  car: TrafficCarState,
  nodes: TrafficNode[],
  avoidX: number,
  avoidZ: number,
): void {
  if (nodes.length === 0) return;
  let chosenIdx = -1;
  let bestDistSq = -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.neighbors.length === 0) continue;
    const dSq = (n.x - avoidX) * (n.x - avoidX) + (n.z - avoidZ) * (n.z - avoidZ);
    if (dSq > 240 * 240 && dSq < 460 * 460) {
      chosenIdx = i;
      break;
    }
    if (dSq > bestDistSq) {
      bestDistSq = dSq;
      chosenIdx = i;
    }
  }
  if (chosenIdx < 0) chosenIdx = 0;
  const from = nodes[chosenIdx];
  if (from.neighbors.length === 0) return;
  const toIdx = from.neighbors[car.id % from.neighbors.length];
  const to = nodes[toIdx];
  const pos = lanePosition(from, to, 0.25);
  car.fromNode = chosenIdx;
  car.toNode = toIdx;
  car.progress = 0.25;
  car.x = pos.x;
  car.z = pos.z;
  car.y = getGroundHeight(pos.x, pos.z);
  car.yaw = pos.yaw;
  car.yawRate = 0;
  car.vx = Math.sin(pos.yaw) * car.cruiseSpeed;
  car.vz = -Math.cos(pos.yaw) * car.cruiseSpeed;
  car.speed = car.cruiseSpeed;
  car.stunnedTimer = 0;
  car.pitchTilt = 0;
  car.rollTilt = 0;
  car.suspOffset = 0;
}

function lanePosition(
  from: TrafficNode,
  to: TrafficNode,
  t: number,
): { x: number; z: number; yaw: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const rx = -dz / len;
  const rz = dx / len;
  const laneOffset = 3.8;
  return {
    x: from.x + dx * t + rx * laneOffset,
    z: from.z + dz * t + rz * laneOffset,
    yaw: yawFromDir(dx, dz),
  };
}

let trafficRecycleCursor = 0;

/**
 * Invisibly recycles a distant AI traffic car (> TRAFFIC_RECYCLE_DIST away) onto an
 * uncrowded road segment in the outer horizon ring [TRAFFIC_SPAWN_MIN, TRAFFIC_SPAWN_MAX]
 * around the player so every avenue stays lively without cars ever popping into view.
 */
function recycleTrafficNearFocus(
  car: TrafficCarState,
  cars: TrafficCarState[],
  nodes: TrafficNode[],
  playerVehicles: VehicleState[],
  focusX: number,
  focusZ: number,
): void {
  const nLen = nodes.length;
  if (nLen === 0) return;
  const minSq = TRAFFIC_SPAWN_MIN * TRAFFIC_SPAWN_MIN;
  const maxSq = TRAFFIC_SPAWN_MAX * TRAFFIC_SPAWN_MAX;
  const start = trafficRecycleCursor % nLen;
  trafficRecycleCursor = (trafficRecycleCursor + 7) % nLen;

  for (let step = 0; step < nLen; step++) {
    const fromIdx = (start + step) % nLen;
    const from = nodes[fromIdx];
    if (from.neighbors.length === 0) continue;

    for (let k = 0; k < from.neighbors.length; k++) {
      const toIdx = from.neighbors[(car.id + k) % from.neighbors.length];
      const to = nodes[toIdx];
      if (!to) continue;
      const t = 0.25 + ((car.id * 17 + step * 13) % 50) / 100;
      const pos = lanePosition(from, to, t);
      const dSq = (pos.x - focusX) * (pos.x - focusX) + (pos.z - focusZ) * (pos.z - focusZ);
      if (dSq < minSq || dSq > maxSq) continue;

      let clear = true;
      for (let j = 0; j < cars.length; j++) {
        const o = cars[j];
        if (o === car) continue;
        const dx = o.x - pos.x;
        const dz = o.z - pos.z;
        if (dx * dx + dz * dz < 20 * 20) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      for (let j = 0; j < playerVehicles.length; j++) {
        const pv = playerVehicles[j];
        const dx = pv.x - pos.x;
        const dz = pv.z - pos.z;
        if (dx * dx + dz * dz < 24 * 24) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      car.fromNode = fromIdx;
      car.toNode = toIdx;
      car.progress = t;
      car.x = pos.x;
      car.z = pos.z;
      car.y = getGroundHeight(pos.x, pos.z);
      car.yaw = pos.yaw;
      car.yawRate = 0;
      car.speed = car.cruiseSpeed;
      car.vx = Math.sin(pos.yaw) * car.cruiseSpeed;
      car.vz = -Math.cos(pos.yaw) * car.cruiseSpeed;
      car.pitchTilt = 0;
      car.rollTilt = 0;
      car.suspOffset = 0;
      return;
    }
  }
}

/**
 * Projects a recovered traffic car onto the closest road edge & progress t matching its heading,
 * so post-crash cars resume driving smoothly from where they stopped instead of snapping across lanes!
 */
function reattachTrafficToNearestLane(car: TrafficCarState, nodes: TrafficNode[]): void {
  if (nodes.length === 0) return;
  const cFx = Math.sin(car.yaw);
  const cFz = -Math.cos(car.yaw);
  let bestFrom = car.fromNode;
  let bestTo = car.toNode;
  let bestT = 0.25;
  let bestScore = Infinity;

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.neighbors.length === 0) continue;
    for (let k = 0; k < a.neighbors.length; k++) {
      const j = a.neighbors[k];
      const b = nodes[j];
      if (!b) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 1) continue;
      const len = Math.sqrt(lenSq);
      // Right-hand lane centerline endpoints
      const rx = (-dz / len) * 3.8;
      const rz = (dx / len) * 3.8;
      const ax = a.x + rx;
      const az = a.z + rz;
      const t = clamp(((car.x - ax) * dx + (car.z - az) * dz) / lenSq, 0.05, 0.92);
      const px = ax + dx * t;
      const pz = az + dz * t;
      const dSq = (car.x - px) * (car.x - px) + (car.z - pz) * (car.z - pz);
      const align = (dx / len) * cFx + (dz / len) * cFz;
      // Gently prefer the lane aligned with the car's current facing direction
      const score = dSq + (1 - align) * 28;
      if (score < bestScore) {
        bestScore = score;
        bestFrom = i;
        bestTo = j;
        bestT = t;
      }
    }
  }

  car.fromNode = bestFrom;
  car.toNode = bestTo;
  car.progress = bestT;
  car.speed = Math.min(car.speed, 2.5);
  car.yawRate = 0;
}

export function stepTraffic(
  cars: TrafficCarState[],
  nodes: TrafficNode[],
  playerVehicles: VehicleState[],
  dt: number,
  colliders: AABB[] = [],
  propObbs: OBB2D[] = [],
  focusX?: number,
  focusZ?: number,
  pedestrians?: ReadonlyArray<{ x: number; z: number; ragdollMode: string }>,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  const recycleSq = TRAFFIC_RECYCLE_DIST * TRAFFIC_RECYCLE_DIST;
  let recycledThisStep = 0;

  // 1. Advance either lane-following AI or free-skidding post-crash rigid-body physics!
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    car.lastImpactSpeed = 0;

    // GTA-style invisible horizon recycling keeps bustling traffic around the player across all 14 districts
    if (
      focusX !== undefined &&
      focusZ !== undefined &&
      car.stunnedTimer <= 0 &&
      recycledThisStep < 2
    ) {
      const dfx = car.x - focusX;
      const dfz = car.z - focusZ;
      if (dfx * dfx + dfz * dfz > recycleSq) {
        recycleTrafficNearFocus(car, cars, nodes, playerVehicles, focusX, focusZ);
        recycledThisStep++;
      }
    }

    if (car.stunnedTimer > 0) {
      // Free-skidding GTA crash physics: car spins & slides freely on its tires, then settles cleanly to a stop
      car.stunnedTimer = Math.max(0, car.stunnedTimer - safeDt);
      const prevX = car.x;
      const prevZ = car.z;

      car.vx *= Math.exp(-3.2 * safeDt);
      car.vz *= Math.exp(-3.2 * safeDt);
      car.yawRate *= Math.exp(-3.6 * safeDt);
      const spd = Math.hypot(car.vx, car.vz);
      if (spd > 28) {
        const s = 28 / spd;
        car.vx *= s;
        car.vz *= s;
      }
      car.x += car.vx * safeDt;
      car.z += car.vz * safeDt;
      car.yaw = wrapAngle(car.yaw + car.yawRate * safeDt);

      // Bounce solidly off building walls & outdoor street props & stay out of deep water
      for (const box of colliders) {
        const hit = resolveCarVsBuildingSAT(car, box);
        if (hit.hit && hit.closingSpeed > 1.2) {
          car.lastImpactSpeed = Math.max(car.lastImpactSpeed, hit.closingSpeed);
          car.lastImpactX = hit.contactX;
          car.lastImpactZ = hit.contactZ;
          car.lastImpactNx = hit.nx;
          car.lastImpactNz = hit.nz;
          car.suspOffset = -0.09;
        }
      }
      for (const obb of propObbs) {
        const hit = resolveCarVsObbSAT(car, obb);
        if (hit.hit && hit.closingSpeed > 1.2) {
          car.lastImpactSpeed = Math.max(car.lastImpactSpeed, hit.closingSpeed);
          car.lastImpactX = hit.contactX;
          car.lastImpactZ = hit.contactZ;
          car.lastImpactNx = hit.nx;
          car.lastImpactNz = hit.nz;
          car.suspOffset = -0.08;
        }
      }
      if (isDeepWater(car.x, car.z)) {
        car.x = prevX;
        car.z = prevZ;
        car.vx *= -0.3;
        car.vz *= -0.3;
      }

      car.y = getGroundHeight(car.x, car.z);
      car.speed = Math.hypot(car.vx, car.vz);
      car.pitchTilt = lerp(car.pitchTilt, 0, clamp(safeDt * 7, 0, 1));
      car.rollTilt = lerp(car.rollTilt, clamp(car.yawRate * 0.04, -0.1, 0.1), clamp(safeDt * 8, 0, 1));
      car.suspOffset = lerp(car.suspOffset, 0, clamp(safeDt * 9, 0, 1));

      // Keep car in free-skid damping until nearly stopped, then ALWAYS reattach to nearest road segment!
      if (car.stunnedTimer <= 0) {
        if (car.speed > 1.8) {
          car.stunnedTimer = 0.25;
        } else {
          reattachTrafficToNearestLane(car, nodes);
        }
      }
      continue;
    }

    const from = nodes[car.fromNode];
    const to = nodes[car.toNode];
    if (!from || !to) continue;
    const segLen = Math.hypot(to.x - from.x, to.z - from.z) || 1;

    const fx = Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw);
    const rz = Math.sin(car.yaw);
    let targetSpeed = car.cruiseSpeed;

    // 1a. Brake cleanly for player vehicles (parked or moving) ahead in our lane
    for (const pv of playerVehicles) {
      const dx = pv.x - car.x;
      const dz = pv.z - car.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > 17 * 17) continue;
      const dist = Math.sqrt(dSq) || 0.001;
      const fwdProj = dx * fx + dz * fz;
      const latProj = Math.abs(dx * rx + dz * rz);
      if (fwdProj > 0 && latProj < 3.4) {
        if (dist < 10.5) {
          targetSpeed = 0;
          break;
        }
        targetSpeed = Math.min(targetSpeed, car.cruiseSpeed * clamp((dist - 10.5) / 6.5, 0, 1));
      }
    }

    // 1b. Smooth following distance & deadlock-free intersection yielding with other AI traffic
    if (targetSpeed > 0) {
      for (let j = 0; j < cars.length; j++) {
        if (i === j) continue;
        const other = cars[j];
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 18 * 18) continue;
        const fwdProj = dx * fx + dz * fz;
        if (fwdProj <= 0.5) continue;
        const dist = Math.sqrt(dSq) || 0.001;
        const latProj = Math.abs(dx * rx + dz * rz);
        const oFx = Math.sin(other.yaw);
        const oFz = -Math.cos(other.yaw);
        const headingDot = fx * oFx + fz * oFz;

        if (headingDot > 0.45 && latProj < 2.8) {
          // Same-lane following: maintain clean 9.5m center-to-center spacing (~5m bumper gap)
          if (dist < 9.5 || other.stunnedTimer > 0) {
            targetSpeed = 0;
            break;
          }
          const followFactor = clamp((dist - 9.5) / 8.5, 0, 1);
          targetSpeed = Math.min(targetSpeed, other.speed + (car.cruiseSpeed - other.speed) * followFactor * 0.65);
        } else if (headingDot < -0.65 && latProj < 2.3 && dist < 11) {
          // Head-on obstacle blocking our lane (e.g. spun-out car)
          targetSpeed = 0;
          break;
        } else if (Math.abs(headingDot) <= 0.45 && dist < 16 && fwdProj > dist * 0.52) {
          // Cross-traffic approaching intersection: yield cleanly if other car is crossing in front of our lane
          const otherHeadingTowardMe = (car.x - other.x) * oFx + (car.z - other.z) * oFz;
          const otherAlreadyInPath = latProj < 4.5 && fwdProj < 12;
          if (otherAlreadyInPath || (otherHeadingTowardMe > -2 && (other.speed > car.speed + 0.5 || other.id < car.id))) {
            targetSpeed = 0;
            break;
          }
        }
      }
    }

    // 1c. Yield calmly for pedestrians crossing directly in front of our bumper
    if (targetSpeed > 0 && pedestrians) {
      for (let pIdx = 0; pIdx < pedestrians.length; pIdx++) {
        const ped = pedestrians[pIdx];
        if (ped.ragdollMode !== 'normal') continue;
        const dx = ped.x - car.x;
        const dz = ped.z - car.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 10.5 * 10.5) continue;
        const fwdProj = dx * fx + dz * fz;
        const latProj = Math.abs(dx * rx + dz * rz);
        if (fwdProj > 1.5 && fwdProj < 10.5 && latProj < 2.1) {
          targetSpeed = 0;
          break;
        }
      }
    }

    // Crisp braking vs smooth city acceleration so cars stop well before bumpers touch!
    const accelRate = targetSpeed < car.speed ? 10.5 : 3.4;
    car.speed = lerp(car.speed, targetSpeed, clamp(safeDt * accelRate, 0, 1));
    car.progress += (car.speed * safeDt) / segLen;

    if (car.progress >= 1) {
      const prevId = car.fromNode;
      const nextNode = nodes[car.toNode];
      const candidates = nextNode.neighbors.filter((n) => n !== prevId);
      const pool = candidates.length > 0 ? candidates : nextNode.neighbors;
      const rawIdx = car.id + Math.floor(car.x + car.z);
      const pickIdx = ((rawIdx % pool.length) + pool.length) % pool.length;
      const pick = pool[pickIdx];
      car.fromNode = car.toNode;
      car.toNode = pick;
      car.progress -= 1;
    }

    // Physically bounded lane steering (NEVER computes teleport/lerp velocity spikes on turns or recovery!)
    const prevX = car.x;
    const prevZ = car.z;
    const pos = lanePosition(nodes[car.fromNode], nodes[car.toNode], clamp(car.progress, 0, 1));
    const errX = pos.x - car.x;
    const errZ = pos.z - car.z;
    const errDist = Math.hypot(errX, errZ);
    const maxStep = Math.max(car.speed, 2.5) * safeDt * 1.25 + 0.02;
    if (errDist > 1e-4) {
      const stepDist = Math.min(errDist, maxStep, errDist * clamp(safeDt * 8.5, 0, 1) + car.speed * safeDt * 0.55);
      car.x += (errX / errDist) * stepDist;
      car.z += (errZ / errDist) * stepDist;
    }
    const rawVx = (car.x - prevX) / safeDt;
    const rawVz = (car.z - prevZ) / safeDt;
    const rawSpd = Math.hypot(rawVx, rawVz);
    const maxPhysSpd = Math.max(car.cruiseSpeed + 2, car.speed + 2);
    if (rawSpd > maxPhysSpd && rawSpd > 0.01) {
      const sc = maxPhysSpd / rawSpd;
      car.vx = rawVx * sc;
      car.vz = rawVz * sc;
    } else {
      car.vx = rawVx;
      car.vz = rawVz;
    }
    car.y = getGroundHeight(car.x, car.z);
    // Steer yaw smoothly toward actual travel vector while turning through intersections
    const desiredYaw = errDist > 1.2 ? yawFromDir(errX, errZ) : pos.yaw;
    car.yaw = lerpAngle(car.yaw, desiredYaw, clamp(safeDt * 6.5, 0, 1));
    car.yawRate = 0;
    const tFx = Math.sin(car.yaw);
    const tFz = -Math.cos(car.yaw);
    const tRx = Math.cos(car.yaw);
    const tRz = Math.sin(car.yaw);
    const tPitch = clamp(
      Math.atan2(
        getGroundHeight(car.x + tFx * 1.8, car.z + tFz * 1.8) -
          getGroundHeight(car.x - tFx * 1.8, car.z - tFz * 1.8),
        3.6,
      ),
      -0.24,
      0.24,
    );
    const tRoll = clamp(
      Math.atan2(
        getGroundHeight(car.x + tRx * 0.9, car.z + tRz * 0.9) -
          getGroundHeight(car.x - tRx * 0.9, car.z - tRz * 0.9),
        1.8,
      ),
      -0.2,
      0.2,
    );
    car.pitchTilt = lerp(car.pitchTilt, tPitch, clamp(safeDt * 8, 0, 1));
    car.rollTilt = lerp(car.rollTilt, tRoll, clamp(safeDt * 8, 0, 1));
    car.suspOffset = lerp(car.suspOffset, 0, clamp(safeDt * 10, 0, 1));
  }

  // 2. Exact 2D SAT rigid-body collisions: ALL player vehicles (active & parked!) <-> ALL AI traffic cars!
  for (const pv of playerVehicles) {
    for (const car of cars) {
      const contact = resolveCarVsCarSAT(pv, car);
      if (!contact.hit) continue;

      if (contact.closingSpeed > 0.35) {
        const impact = contact.closingSpeed;
        if (impact > pv.lastCollisionImpact) {
          pv.lastCollisionImpact = impact;
          pv.lastImpactX = contact.contactX;
          pv.lastImpactZ = contact.contactZ;
          pv.lastImpactNx = contact.nx;
          pv.lastImpactNz = contact.nz;
        }
        pv.suspVel -= clamp(impact * 0.085, 0, 1.5);
        pv.pitchVel -= clamp(impact * 0.048, 0, 0.9);
        const pf = Math.sin(pv.yaw);
        const pzf = -Math.cos(pv.yaw);
        pv.speed = pv.vx * pf + pv.vz * pzf;

        if (impact > 2.4) {
          car.stunnedTimer = Math.max(car.stunnedTimer, clamp(1.1 + impact * 0.075, 1.25, 2.2));
          car.suspOffset = -clamp(impact * 0.012, 0.03, 0.14);
          car.pitchTilt = clamp(impact * 0.012, 0.02, 0.11);
          car.rollTilt = clamp(car.yawRate * 0.035, -0.11, 0.11);
          car.lastImpactSpeed = Math.max(car.lastImpactSpeed, impact);
          car.lastImpactX = contact.contactX;
          car.lastImpactZ = contact.contactZ;
          car.lastImpactNx = -contact.nx;
          car.lastImpactNz = -contact.nz;
        } else {
          car.speed *= 0.2;
        }
      }
    }
  }

  // 3. Controlled SAT collisions between AI traffic cars (prevents overlapping without runaway pinball!)
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const contact = resolveCarVsCarSAT(a, b);
      if (!contact.hit) continue;

      const impact = contact.closingSpeed;
      const eitherStunned = a.stunnedTimer > 0 || b.stunnedTimer > 0;
      if (impact < 5.5 && !eitherStunned) {
        // Minor AI-vs-AI brush: separate cleanly and brake smoothly without launching into pinball chaos!
        a.speed *= 0.2;
        b.speed *= 0.2;
        a.vx *= 0.25;
        a.vz *= 0.25;
        b.vx *= 0.25;
        b.vz *= 0.25;
        a.yawRate = 0;
        b.yawRate = 0;
        continue;
      }
      if (impact < 2.2) continue;

      for (const c of [a, b]) {
        // Only propagate crash skids from hard impacts — cap stun duration so pileups settle quickly!
        c.stunnedTimer = Math.max(c.stunnedTimer, clamp(0.85 + impact * 0.055, 0.9, 1.75));
        c.suspOffset = -clamp(impact * 0.01, 0.03, 0.12);
        c.lastImpactSpeed = Math.max(c.lastImpactSpeed, impact);
        c.lastImpactX = contact.contactX;
        c.lastImpactZ = contact.contactZ;
        c.lastImpactNx = contact.nx;
        c.lastImpactNz = contact.nz;
      }
    }
  }
}

export interface TrafficRenderer {
  root: THREE.Group;
  attachGltfCars: (cloneCar: (kind: CarModelKind) => THREE.Group | null) => void;
  syncFromState: (cars: TrafficCarState[], nightFactor: number, focusX?: number, focusZ?: number) => void;
}

export function createTrafficMeshes(cars: TrafficCarState[], scene: THREE.Scene): TrafficRenderer {
  const root = new THREE.Group();
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1726,
    roughness: 0.04,
    metalness: 0.22,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8e0ec, metalness: 0.9, roughness: 0.16 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff8dc, emissive: 0xffe8a3, emissiveIntensity: 1.0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1e3e, emissive: 0xff1133, emissiveIntensity: 1.0 });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.76,
  });
  const glowTex = createLightGlowTexture();

  const sedanGeos = createSculptedTrafficBodyGeometry('sedan');
  const suvGeos = createSculptedTrafficBodyGeometry('suv');
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  wheelGeo.rotateZ(Math.PI * 0.5);
  const hubGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.26, 12);
  hubGeo.rotateZ(Math.PI * 0.5);
  const shadowGeo = new THREE.PlaneGeometry(2.7, 5.2);
  shadowGeo.rotateX(-Math.PI * 0.5);

  const groups: THREE.Group[] = [];
  const proceduralShells: THREE.Group[] = [];
  const paintMats: THREE.MeshPhysicalMaterial[] = [];
  const headGlows: THREE.Sprite[] = [];

  for (const c of cars) {
    const isSuv = c.modelKind === 'suv';
    const geos = isSuv ? suvGeos : sedanGeos;

    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: c.color,
      metalness: 0.58,
      roughness: 0.18,
      clearcoat: 0.95,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.65,
    });
    paintMats.push(paint);

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.04;
    g.add(shadow);

    const proc = new THREE.Group();
    const body = new THREE.Mesh(geos.body, paint);
    body.castShadow = false;
    body.receiveShadow = true;
    proc.add(body);

    const cabin = new THREE.Mesh(geos.cabin, glassMat);
    proc.add(cabin);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.11, 0.08), headMat);
    hl.position.set(0, isSuv ? 0.68 : 0.56, -2.18);
    proc.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.11, 0.08), tailMat);
    tl.position.set(0, isSuv ? 0.76 : 0.66, 2.16);
    proc.add(tl);

    for (const wx of [-0.94, 0.94]) {
      for (const wz of [-1.28, 1.28]) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.34, wz);
        proc.add(w);
        const h = new THREE.Mesh(hubGeo, rimMat);
        h.position.set(wx, 0.34, wz);
        proc.add(h);
      }
    }
    g.add(proc);
    proceduralShells.push(proc);

    // Subtle additive headlight glare halo at night
    const hGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffeeb8,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    hGlow.position.set(0, isSuv ? 0.68 : 0.56, -2.35);
    hGlow.scale.set(2.0, 0.9, 1);
    g.add(hGlow);
    headGlows.push(hGlow);

    g.position.set(c.x, c.y, c.z);
    g.rotation.order = 'YXZ';
    g.rotation.set(c.pitchTilt, -c.yaw, c.rollTilt);
    root.add(g);
    groups.push(g);
  }

  scene.add(root);

  return {
    root,
    attachGltfCars(cloneCar) {
      for (let i = 0; i < cars.length && i < groups.length; i++) {
        const c = cars[i];
        const model = cloneCar(c.modelKind);
        if (!model) continue;

        const paint = paintMats[i];
        model.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          // Contact shadow plane grounds traffic cars with zero extra shadow-pass cost
          obj.castShadow = false;
          obj.receiveShadow = false;

          const matName = Array.isArray(obj.material)
            ? ''
            : (obj.material?.name ?? '').toLowerCase();
          if (matName === 'paint' || matName.startsWith('body paint')) {
            obj.material = paint;
          } else if (matName.startsWith('glass') || matName.includes('tinted glass')) {
            obj.material = glassMat;
          } else if (matName === 'redlens' || matName.includes('tail lamp')) {
            obj.material = tailMat;
          } else if (matName === 'clearlens' || matName.includes('clear lamp')) {
            obj.material = headMat;
          }
        });

        proceduralShells[i].visible = false;
        groups[i].add(model);
      }
    },

    syncFromState(stateCars: TrafficCarState[], nightFactor: number, focusX?: number, focusZ?: number) {
      headMat.emissiveIntensity = 0.6 + nightFactor * 2.5;
      tailMat.emissiveIntensity = 0.7 + nightFactor * 2.1;
      for (const sp of headGlows) {
        sp.material.opacity = 0.08 + nightFactor * 0.45;
      }
      for (let i = 0; i < stateCars.length && i < groups.length; i++) {
        const c = stateCars[i];
        if (focusX !== undefined && focusZ !== undefined) {
          const dSq = (c.x - focusX) * (c.x - focusX) + (c.z - focusZ) * (c.z - focusZ);
          groups[i].visible = dSq <= TRAFFIC_RENDER_DIST * TRAFFIC_RENDER_DIST;
          if (!groups[i].visible) continue;
        }
        groups[i].position.set(c.x, c.y + c.suspOffset, c.z);
        groups[i].rotation.set(c.pitchTilt, -c.yaw, c.rollTilt);
      }
    },
  };
}
