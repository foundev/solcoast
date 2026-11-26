import * as THREE from 'three';
import { clamp, createRng, lerpAngle, resolveCircleAABB, yawFromDir, type AABB } from '../core/math';
import {
  applyCarHitToHuman,
  computeTumblePivotY,
  resolveCircleOrientedCar,
  stepHumanRagdollPhysics,
  type HumanBodyPhysics,
  type HumanRagdollMode,
  type OrientedCarHull,
} from '../core/physics';
import { DynamicPointGrid, forEachNearbyAABB } from '../core/spatialGrid';
import type { ClonedPerson } from '../world/assets';
import { getGroundHeight, isDeepWater } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
import type { RagdollPhysicsWorld } from '../systems/ragdollWorld';
import { createHumanRigController, type HumanRigController } from './humanRig';
import type { TrafficCarState } from './traffic';
import type { VehicleState } from './vehicle';

export interface PedestrianState extends HumanBodyPhysics {
  id: number;
  routeIndex: number;
  /** Unique deterministic appearance index guaranteed never to collide with neighbors on the same route */
  variantIndex: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  speed: number;
  walkPhase: number;
  waypoints: { x: number; z: number }[];
  wpIndex: number;
  dir: 1 | -1;
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

// 36 scenic pedestrian stroll corridors spanning ALL 14 Sol Coast districts (avenues, cross-streets, beach, parks & hills)!
export const STROLL_ROUTES: { x: number; z: number }[][] = [
  // 1. Boardwalk Promenade West Lane
  [
    { x: 156, z: -165 },
    { x: 156, z: -50 },
    { x: 156, z: 65 },
    { x: 156, z: 155 },
  ],
  // 2. Boardwalk Promenade East Lane
  [
    { x: 162, z: 150 },
    { x: 162, z: 35 },
    { x: 162, z: -85 },
    { x: 162, z: -170 },
  ],
  // 3. Ocean Drive West Café Sidewalk
  [
    { x: 128, z: -165 },
    { x: 128, z: -55 },
    { x: 128, z: 55 },
    { x: 128, z: 145 },
  ],
  // 4. Sol Beach Golden Sand Shoreline Stroll
  [
    { x: 176, z: -145 },
    { x: 184, z: -30 },
    { x: 180, z: 75 },
    { x: 175, z: 135 },
  ],
  // 5. Palm Plaza Central Park Loop (Inner)
  [
    { x: 6, z: 6 },
    { x: 44, z: 6 },
    { x: 44, z: 44 },
    { x: 6, z: 44 },
  ],
  // 6. Palm Plaza Outer Sidewalk
  [
    { x: -7, z: -7 },
    { x: 57, z: -7 },
    { x: 57, z: 57 },
    { x: -7, z: 57 },
  ],
  // 7. Marina Cove Waterfront Promenade
  [
    { x: -115, z: 176 },
    { x: -30, z: 176 },
    { x: 55, z: 176 },
    { x: 120, z: 176 },
  ],
  // 8. Marina Cove Timber Yacht Docks
  [
    { x: -75, z: 184 },
    { x: -75, z: 234 },
    { x: -75, z: 184 },
    { x: -15, z: 184 },
    { x: -15, z: 234 },
  ],
  // 9. South Pier Deck Stroll
  [
    { x: 166, z: 157 },
    { x: 215, z: 157 },
    { x: 262, z: 157 },
    { x: 262, z: 163 },
    { x: 172, z: 163 },
  ],
  // 10. Neon Strip Boulevard Sidewalk (East)
  [
    { x: -8, z: -175 },
    { x: -8, z: -65 },
    { x: -8, z: 45 },
    { x: -8, z: 145 },
  ],
  // 11. Downtown Biscayne Plaza Sidewalk
  [
    { x: -122, z: -165 },
    { x: -122, z: -45 },
    { x: -122, z: 75 },
    { x: -188, z: 75 },
    { x: -188, z: -125 },
  ],
  // 12. Key Sol Island Resort Loop
  [
    { x: 254, z: -245 },
    { x: 254, z: -155 },
    { x: 344, z: -155 },
    { x: 344, z: -245 },
  ],
  // 13. Wynwood Mural Gallery Walk (North-South)
  [
    { x: -188, z: -365 },
    { x: -188, z: -275 },
    { x: -188, z: -215 },
    { x: -122, z: -215 },
    { x: -122, z: -365 },
  ],
  // 14. Wynwood Street-Art East-West Corridor
  [
    { x: -275, z: -278 },
    { x: -175, z: -278 },
    { x: -95, z: -278 },
    { x: -95, z: -302 },
    { x: -275, z: -302 },
  ],
  // 15. Sol Coast Arena Perimeter Plaza
  [
    { x: -365, z: -276 },
    { x: -305, z: -276 },
    { x: -305, z: -214 },
    { x: -365, z: -214 },
  ],
  // 16. Coral Heights Mediterranean Boulevard
  [
    { x: -278, z: -165 },
    { x: -278, z: -45 },
    { x: -278, z: 75 },
    { x: -278, z: 145 },
  ],
  // 17. Coral Park & Basketball Courts Promenade
  [
    { x: -364, z: -4 },
    { x: -306, z: -4 },
    { x: -306, z: 54 },
    { x: -364, z: 54 },
  ],
  // 18. North Beach Waterfront Promenade (overlooking North Bay & Key Sol)
  [
    { x: 128, z: -368 },
    { x: 128, z: -290 },
    { x: 128, z: -215 },
    { x: 82, z: -215 },
    { x: 82, z: -368 },
  ],
  // 19. Ocean Drive Café Sidewalk Counter-Flow (Hotel Solaire Strip)
  [
    { x: 130, z: 148 },
    { x: 130, z: 45 },
    { x: 130, z: -55 },
    { x: 130, z: -168 },
  ],
  // 20. Collins Avenue West Sidewalk
  [
    { x: 60, z: -368 },
    { x: 60, z: -188 },
    { x: 60, z: -8 },
    { x: 60, z: 148 },
  ],
  // 21. Collins Avenue East Sidewalk
  [
    { x: 80, z: 148 },
    { x: 80, z: -8 },
    { x: 80, z: -188 },
    { x: 80, z: -368 },
  ],
  // 22. Sol Beach Mid-Sand & Surf Counter-Stroll
  [
    { x: 186, z: 140 },
    { x: 182, z: 38 },
    { x: 188, z: -55 },
    { x: 180, z: -152 },
  ],
  // 23. Neon Boulevard West Sidewalk (Midtown & Club Neon)
  [
    { x: -30, z: 148 },
    { x: -30, z: 30 },
    { x: -30, z: -90 },
    { x: -30, z: -210 },
  ],
  // 24. Biscayne Avenue East Sidewalk (Financial District)
  [
    { x: -100, z: -280 },
    { x: -100, z: -150 },
    { x: -100, z: -20 },
    { x: -100, z: 148 },
  ],
  // 25. 12th Street Cross-Town Corridor (Hotel Solaire <-> Club Neon <-> Downtown)
  [
    { x: 128, z: -100 },
    { x: 20, z: -100 },
    { x: -110, z: -100 },
    { x: -278, z: -100 },
  ],
  // 26. 5th Street Cross-Town Corridor (Café Habana <-> Palm Plaza <-> Ocean Dr)
  [
    { x: -280, z: -10 },
    { x: -140, z: -10 },
    { x: -10, z: -10 },
    { x: 128, z: -10 },
  ],
  // 27. 1st Street Cross-Town Corridor (Coral Heights <-> Downtown <-> South Beach)
  [
    { x: 128, z: 80 },
    { x: 10, z: 80 },
    { x: -130, z: 80 },
    { x: -280, z: 80 },
  ],
  // 28. Causeway Boulevard North Midtown Promenade
  [
    { x: -280, z: -190 },
    { x: -140, z: -190 },
    { x: -10, z: -190 },
    { x: 128, z: -190 },
  ],
  // 29. North Bay Highlands — Highland Pkwy Scenic Sidewalk
  [
    { x: -548, z: -550 },
    { x: -370, z: -550 },
    { x: -190, z: -550 },
    { x: -10, z: -550 },
    { x: 128, z: -550 },
  ],
  // 30. North Bay Highlands — Vista Crest Rd Promenade
  [
    { x: 128, z: -460 },
    { x: -40, z: -460 },
    { x: -210, z: -460 },
    { x: -380, z: -460 },
    { x: -548, z: -460 },
  ],
  // 31. North Bay Rd Cross-City Bluff Walk
  [
    { x: -548, z: -370 },
    { x: -370, z: -370 },
    { x: -190, z: -370 },
    { x: -10, z: -370 },
    { x: 128, z: -370 },
  ],
  // 32. Sunset Hills — Sunset Ridge Dr Hilltop Overlook
  [
    { x: -550, z: -548 },
    { x: -550, z: -410 },
    { x: -550, z: -280 },
    { x: -550, z: -150 },
  ],
  // 33. Sunset Hills — Grove Terrace Hillside Stroll
  [
    { x: -460, z: -548 },
    { x: -460, z: -380 },
    { x: -460, z: -220 },
    { x: -460, z: -80 },
  ],
  // 34. Coconut Grove — Grove Botanical Park Loop
  [
    { x: -542, z: -92 },
    { x: -488, z: -92 },
    { x: -488, z: -38 },
    { x: -542, z: -38 },
  ],
  // 35. Coconut Grove — Coral Way South Boulevard
  [
    { x: -370, z: -210 },
    { x: -370, z: -70 },
    { x: -370, z: 60 },
    { x: -370, z: 148 },
  ],
  // 36. Coconut Grove — Southwest Terrace Loop
  [
    { x: -460, z: -10 },
    { x: -460, z: 148 },
    { x: -550, z: 148 },
    { x: -550, z: -10 },
  ],
  // 37. Sunset Hills — Coral Way North Ridge Sidewalk
  [
    { x: -370, z: -548 },
    { x: -370, z: -430 },
    { x: -370, z: -310 },
    { x: -370, z: -215 },
  ],
  // 38. North Bay Highlands — Palm Grove Ave North Sidewalk
  [
    { x: -280, z: -548 },
    { x: -280, z: -430 },
    { x: -280, z: -310 },
    { x: -280, z: -215 },
  ],
];

const BASE_AVATAR_COUNT = 6;
export const PED_RENDER_DIST = 110;
const PED_RECYCLE_DIST = 175;
const PED_SPAWN_MIN = 112;
const PED_SPAWN_MAX = 170;

/**
 * Computes evenly spaced positions along a multi-segment route so pedestrians
 * start well-distributed instead of clumping together, and assigns every walker
 * on the same route a guaranteed DISTINCT base avatar model (avoiding modulo collisions!).
 */
export function createPedestrians(count = 144): PedestrianState[] {
  const rng = createRng(551305);
  const peds: PedestrianState[] = [];
  const routeCount = STROLL_ROUTES.length;
  const perRoute = Math.max(1, Math.ceil(count / routeCount));

  for (let i = 0; i < count; i++) {
    const routeIdx = i % routeCount;
    const slotOnRoute = Math.floor(i / routeCount);
    const route = STROLL_ROUTES[routeIdx];

    // Spread walkers evenly across valid consecutive open segments (0..N-2) so nobody spawns on
    // invalid wrap-around diagonals across buildings or open Marina water!
    const totalSegs = Math.max(1, route.length - 1);
    const routeFrac = ((slotOnRoute + 0.12 + rng() * 0.72) / perRoute) % 1;
    const exactSeg = routeFrac * totalSegs;
    const startIdx = Math.min(totalSegs - 1, Math.floor(exactSeg));
    const nextIdx = startIdx + 1;
    const t = exactSeg - Math.floor(exactSeg);

    const a = route[startIdx];
    const b = route[nextIdx];
    const x = a.x + (b.x - a.x) * t + (rng() - 0.5) * 0.8;
    const z = a.z + (b.z - a.z) * t + (rng() - 0.5) * 0.8;

    // Guarantee each slot (0..perRoute-1) on the SAME route gets a DIFFERENT base avatar (0..5)!
    const avatarBase = (slotOnRoute + routeIdx * 5) % BASE_AVATAR_COUNT;
    const styleTier = (routeIdx + slotOnRoute * 3) % 12;
    const variantIndex = styleTier * BASE_AVATAR_COUNT + avatarBase;

    // Mix casual strollers (1.2-1.75 m/s) with energetic boardwalk/park/avenue joggers (2.2-2.7 m/s)
    const isJogger = (i * 7 + routeIdx) % 11 === 0;
    const speed = isJogger ? 2.2 + rng() * 0.5 : 1.2 + rng() * 0.55;

    peds.push({
      id: i,
      routeIndex: routeIdx,
      variantIndex,
      x,
      y: getGroundHeight(x, z),
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: yawFromDir(b.x - a.x, b.z - a.z),
      speed,
      walkPhase: rng() * Math.PI * 2,
      waypoints: route,
      wpIndex: nextIdx,
      dir: slotOnRoute % 2 === 0 ? 1 : -1,
      ragdollMode: 'normal',
      ragdollTimer: 0,
      fallPitch: 0,
      fallRoll: 0,
      angVelPitch: 0,
      angVelRoll: 0,
      angVelYaw: 0,
      lastImpactSpeed: 0,
      lastImpactKind: 'none',
      pendingRagdollImpact: null,
      rapierControlled: false,
    });
  }

  return peds;
}

let pedRecycleCursor = 0;

/**
 * Invisibly streams distant non-ragdolling pedestrians (> PED_RECYCLE_DIST away) onto active
 * sidewalks in the outer ring [PED_SPAWN_MIN, PED_SPAWN_MAX] around the player so every district
 * feels lively with strolling locals and joggers without popping into view.
 */
function recyclePedestrianNearFocus(
  p: PedestrianState,
  peds: PedestrianState[],
  focusX: number,
  focusZ: number,
): void {
  const rCount = STROLL_ROUTES.length;
  const minSq = PED_SPAWN_MIN * PED_SPAWN_MIN;
  const maxSq = PED_SPAWN_MAX * PED_SPAWN_MAX;
  const startRoute = pedRecycleCursor % rCount;
  pedRecycleCursor = (pedRecycleCursor + 5) % rCount;

  for (let rStep = 0; rStep < rCount; rStep++) {
    const rIdx = (startRoute + rStep) % rCount;
    const route = STROLL_ROUTES[rIdx];
    const segCount = Math.max(1, route.length - 1);

    for (let seg = 0; seg < segCount; seg++) {
      const a = route[seg];
      const b = route[seg + 1];
      // Sample 6 evenly distributed candidate points along each valid sidewalk segment
      for (let s = 0; s < 6; s++) {
        const jitter = ((p.id * 17 + rStep * 11 + s * 7) % 11) * 0.01;
        const t = 0.06 + s * 0.16 + jitter;
        const sx = a.x + (b.x - a.x) * t;
        const sz = a.z + (b.z - a.z) * t;
        const dSq = (sx - focusX) * (sx - focusX) + (sz - focusZ) * (sz - focusZ);
        if (dSq < minSq || dSq > maxSq) continue;
        if (isDeepWater(sx, sz)) continue;

        let crowded = false;
        for (let j = 0; j < peds.length; j++) {
          const o = peds[j];
          if (o === p) continue;
          const ox = o.x - sx;
          const oz = o.z - sz;
          if (ox * ox + oz * oz < 3.4 * 3.4) {
            crowded = true;
            break;
          }
        }
        if (crowded) continue;

        p.routeIndex = rIdx;
        p.waypoints = route;
        p.wpIndex = seg + 1;
        p.dir = (p.id + rStep) % 2 === 0 ? 1 : -1;
        p.x = sx;
        p.z = sz;
        p.y = getGroundHeight(sx, sz);
        p.vx = 0;
        p.vz = 0;
        p.yaw = yawFromDir(b.x - a.x, b.z - a.z);
        return;
      }
    }
  }
}

const pedGrid = new DynamicPointGrid(6, 256, 1024);
const pedTrafficGrid = new DynamicPointGrid(10, 128, 512);
const _pedTcHull: OrientedCarHull = {
  x: 0,
  z: 0,
  yaw: 0,
  vx: 0,
  vz: 0,
  halfWidth: 1.04,
  halfLength: 2.24,
};

export function stepPedestrians(
  peds: PedestrianState[],
  vehicles: VehicleState[],
  dt: number,
  trafficCars: TrafficCarState[] = [],
  colliders: AABB[] = [],
  focusX?: number,
  focusZ?: number,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  const pedRadius = 0.44;
  const recycleSq = PED_RECYCLE_DIST * PED_RECYCLE_DIST;
  const activeSimSq = (PED_RENDER_DIST + 30) * (PED_RENDER_DIST + 30);
  let recycledThisStep = 0;

  // Build spatial grids once per tick to eliminate O(N^2) ped-ped and ped-traffic scans!
  pedGrid.rebuild(peds);
  const hasTraffic = trafficCars.length > 0;
  if (hasTraffic) {
    pedTrafficGrid.rebuild(trafficCars);
  }

  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    p.lastImpactSpeed = 0;
    p.lastImpactKind = 'none';

    let distFocusSq = 0;
    if (focusX !== undefined && focusZ !== undefined) {
      const dfx = p.x - focusX;
      const dfz = p.z - focusZ;
      distFocusSq = dfx * dfx + dfz * dfz;
      if (
        p.ragdollMode === 'normal' &&
        !p.rapierControlled &&
        distFocusSq > recycleSq &&
        recycledThisStep < 4
      ) {
        recyclePedestrianNearFocus(p, peds, focusX, focusZ);
        recycledThisStep++;
        const nfx = p.x - focusX;
        const nfz = p.z - focusZ;
        distFocusSq = nfx * nfx + nfz * nfz;
      }
    }
    const isNearFocus = focusX === undefined || distFocusSq <= activeSimSq;

    // 1. Check solid oriented vehicle collisions against player vehicles & nearby AI traffic cars!
    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi];
      if (p.ragdollMode === 'airborne' && p.y > v.y + 2.0) continue;
      const dxv = p.x - v.x;
      const dzv = p.z - v.z;
      if (dxv * dxv + dzv * dzv > 12) continue;
      const hit = resolveCircleOrientedCar(p.x, p.z, pedRadius, v);
      if (hit.hit) {
        const impact = applyCarHitToHuman(p, v, hit, false);
        if (impact > 2.0) {
          const damp = clamp(1 - impact * 0.0035, 0.9, 0.99);
          v.vx *= damp;
          v.vz *= damp;
          v.pitchTilt = clamp(v.pitchTilt + 0.018, -0.065, 0.065);
          v.lastCollisionImpact = Math.max(v.lastCollisionImpact, impact * 0.65);
        }
      }
    }

    if (isNearFocus && hasTraffic) {
      pedTrafficGrid.forEachIndexInRadius(p.x, p.z, 3.6, (ti) => {
        const tc = trafficCars[ti];
        if (p.ragdollMode === 'airborne' && p.y > tc.y + 2.0) return;
        const dxt = p.x - tc.x;
        const dzt = p.z - tc.z;
        if (dxt * dxt + dzt * dzt > 12) return;
        _pedTcHull.x = tc.x;
        _pedTcHull.z = tc.z;
        _pedTcHull.yaw = tc.yaw;
        _pedTcHull.vx = tc.vx;
        _pedTcHull.vz = tc.vz;
        const hit = resolveCircleOrientedCar(p.x, p.z, pedRadius, _pedTcHull);
        if (hit.hit) {
          const impact = applyCarHitToHuman(p, _pedTcHull, hit, false);
          if (impact > 2.0) {
            tc.speed *= 0.4;
          }
        }
      });
    }

    // 2. When Rapier3D articulated ragdoll or 3-stage physical get-up owns this pedestrian, skip fallback/strolling!
    if (p.rapierControlled) {
      continue;
    }

    // 3. Fallback tumble/stumble/slide/recovery when Rapier3D isn't active (light stumbles or headless tests)
    if (stepHumanRagdollPhysics(p, safeDt, colliders, false)) {
      continue;
    }

    // 4. Normal strolling locomotion along route with calm sidestep & personal-space separation
    const target = p.waypoints[p.wpIndex];
    let dx = target.x - p.x;
    let dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 2.2) {
      let next = p.wpIndex + p.dir;
      if (next >= p.waypoints.length || next < 0) {
        p.dir = p.dir === 1 ? -1 : 1;
        next = clamp(p.wpIndex + p.dir, 0, p.waypoints.length - 1);
      }
      p.wpIndex = next;
    }

    // Step aside calmly around slow/parked cars (player & AI) with tangential passing so nobody oscillates!
    let avoidX = 0;
    let avoidZ = 0;
    let speedBoost = 1.0;
    const goalDirX = dist > 0.05 ? dx / dist : 0;
    const goalDirZ = dist > 0.05 ? dz / dist : 0;
    if (isNearFocus) {
      for (let vi = 0; vi < vehicles.length; vi++) {
        const v = vehicles[vi];
        if (v.vx * v.vx + v.vz * v.vz > 196) continue;
        const ox = p.x - v.x;
        const oz = p.z - v.z;
        const dSq = ox * ox + oz * oz;
        if (dSq >= 4.4 * 4.4 || dSq <= 0.0001) continue;
        const d = Math.sqrt(dSq);
        const nx = ox / d;
        const nz = oz / d;
        const tx = -nz;
        const tz = nx;
        const sideSign = tx * goalDirX + tz * goalDirZ >= 0 ? 1 : -1;
        const strength = clamp((4.4 - d) / 4.4, 0.2, 1.0) * 1.45;
        avoidX += (nx * 0.65 + tx * sideSign * 0.75) * strength;
        avoidZ += (nz * 0.65 + tz * sideSign * 0.75) * strength;
        speedBoost = 1.25;
      }

      if (hasTraffic) {
        pedTrafficGrid.forEachIndexInRadius(p.x, p.z, 3.9, (ti) => {
          const tc = trafficCars[ti];
          if (tc.vx * tc.vx + tc.vz * tc.vz > 196) return;
          const ox = p.x - tc.x;
          const oz = p.z - tc.z;
          const dSq = ox * ox + oz * oz;
          if (dSq >= 3.8 * 3.8 || dSq <= 0.0001) return;
          const d = Math.sqrt(dSq);
          const nx = ox / d;
          const nz = oz / d;
          const tx = -nz;
          const tz = nx;
          const sideSign = tx * goalDirX + tz * goalDirZ >= 0 ? 1 : -1;
          const strength = clamp((3.8 - d) / 3.8, 0.2, 1.0) * 1.45;
          avoidX += (nx * 0.65 + tx * sideSign * 0.75) * strength;
          avoidZ += (nz * 0.65 + tz * sideSign * 0.75) * strength;
          speedBoost = 1.25;
        });
      }

      // Smooth right-hand passing separation via O(1) spatial hash!
      pedGrid.forEachIndexInRadius(p.x, p.z, 1.7, (j) => {
        if (i === j) return;
        const other = peds[j];
        const ox = p.x - other.x;
        const oz = p.z - other.z;
        const dSq = ox * ox + oz * oz;
        if (dSq < 1.65 * 1.65 && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          const nx = ox / d;
          const nz = oz / d;
          const push = (1.65 - d) * 0.42;
          avoidX += (nx * 0.65 - nz * 0.45) * push;
          avoidZ += (nz * 0.65 + nx * 0.45) * push;
        }
      });
    }

    // Clamp avoidance magnitude so walkers stay smoothly forward-moving instead of oscillating in place
    const avoidMagSq = avoidX * avoidX + avoidZ * avoidZ;
    if (avoidMagSq > 0.85 * 0.85) {
      const sc = 0.85 / Math.sqrt(avoidMagSq);
      avoidX *= sc;
      avoidZ *= sc;
    }

    if (dist > 0.05) {
      dx = goalDirX + avoidX;
      dz = goalDirZ + avoidZ;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;

      const curSpeed = p.speed * speedBoost;
      p.vx = dx * curSpeed;
      p.vz = dz * curSpeed;
      let nextX = p.x + p.vx * safeDt;
      let nextZ = p.z + p.vz * safeDt;

      // Keep sidestepping walkers cleanly outside nearby building facades & dry land
      if (isNearFocus && colliders.length > 0) {
        forEachNearbyAABB(colliders, nextX, nextZ, pedRadius + 0.5, (box) => {
          const res = resolveCircleAABB(nextX, nextZ, pedRadius, box);
          if (res.hit) {
            nextX += res.dx;
            nextZ += res.dz;
          }
        });
      }

      if (!isDeepWater(nextX, nextZ)) {
        p.x = nextX;
        p.z = nextZ;
      }
      p.y = getGroundHeight(p.x, p.z);
      p.yaw = lerpAngle(p.yaw, yawFromDir(dx, dz), clamp(safeDt * 6.5, 0, 1));
      p.walkPhase += curSpeed * safeDt * 2.1;
    }
  }
}

export interface PedestrianRenderer {
  root: THREE.Group;
  attachGltfPeople: (clonePerson: (variantIndex: number) => ClonedPerson | null) => void;
  spawnPendingRagdolls: (peds: PedestrianState[], ragdollWorld: RagdollPhysicsWorld, focusX: number, focusZ: number) => void;
  syncFromState: (
    peds: PedestrianState[],
    dt: number,
    focusX: number,
    focusZ: number,
    ragdollWorld?: RagdollPhysicsWorld | null,
  ) => void;
}

interface PedInstance {
  root: THREE.Group;
  tumblePivot: THREE.Group;
  avatarRoot: THREE.Object3D | null;
  variantIndex: number;
  rig: HumanRigController | null;
}

/**
 * Renders 70+ varied locals across all 11 districts using styled Ready Player Me
 * civilian avatars driven by 4 distinct studio optical mocap walk clips, seamlessly
 * handing off to live 11-limb Rapier3D articulated ragdolls & 3-stage physical get-ups on impact!
 */
export function createPedestrianMeshes(peds: PedestrianState[], scene: THREE.Scene): PedestrianRenderer {
  const container = new THREE.Group();
  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
  });
  const shadowGeo = new THREE.PlaneGeometry(1.0, 1.0);
  shadowGeo.rotateX(-Math.PI * 0.5);

  const instances: PedInstance[] = [];
  for (const p of peds) {
    const pedRoot = new THREE.Group();
    pedRoot.position.set(p.x, p.y, p.z);
    pedRoot.rotation.y = -p.yaw;
    pedRoot.visible = false;

    const tumblePivot = new THREE.Group();
    tumblePivot.position.y = 0.92;
    pedRoot.add(tumblePivot);

    container.add(pedRoot);
    instances.push({ root: pedRoot, tumblePivot, avatarRoot: null, variantIndex: p.variantIndex, rig: null });
  }
  scene.add(container);

  let elapsedAccum = 0;
  let frameCount = 0;

  return {
    root: container,
    attachGltfPeople(clonePerson) {
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const cloned = clonePerson(inst.variantIndex);
        if (!cloned) continue;

        cloned.scene.position.y = -0.92;
        cloned.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
          }
        });

        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.position.y = 0.03;
        inst.root.add(shadow);
        inst.tumblePivot.add(cloned.scene);
        inst.avatarRoot = cloned.scene;

        const rig = createHumanRigController(
          cloned.scene,
          cloned.animations,
          cloned.preferredWalkClip,
        );
        rig.update(0.016, 4.0, false, true, i * 0.73);
        rig.mixer.setTime((i * 0.73) % 2.0);
        inst.rig = rig;
      }
    },

    spawnPendingRagdolls(statePeds, ragdollWorld, focusX, focusZ) {
      for (let i = 0; i < statePeds.length && i < instances.length; i++) {
        const p = statePeds[i];
        const impact = p.pendingRagdollImpact;
        if (!impact) continue;
        p.pendingRagdollImpact = null;

        const inst = instances[i];
        if (!inst.avatarRoot) continue;
        const dSq = (p.x - focusX) * (p.x - focusX) + (p.z - focusZ) * (p.z - focusZ);
        if (dSq > PED_RENDER_DIST * PED_RENDER_DIST) continue;

        // Ensure neutral tumblePivot & fresh world matrices before spawning 11-limb Rapier ragdoll
        inst.root.visible = true;
        inst.root.position.set(p.x, p.y, p.z);
        inst.root.rotation.set(0, -p.yaw, 0);
        inst.tumblePivot.position.y = 0.92;
        inst.tumblePivot.rotation.set(0, 0, 0);
        inst.root.updateMatrixWorld(true);

        const spawned = ragdollWorld.spawnRagdoll(`ped:${p.id}`, inst.root, inst.avatarRoot, impact, false);
        if (spawned) {
          p.rapierControlled = true;
          p.fallPitch = 0;
          p.fallRoll = 0;
        }
      }
    },

    syncFromState(
      statePeds: PedestrianState[],
      dt: number,
      focusX: number,
      focusZ: number,
      ragdollWorld?: RagdollPhysicsWorld | null,
    ) {
      elapsedAccum += dt;
      frameCount++;
      const renderDistSq = PED_RENDER_DIST * PED_RENDER_DIST;
      const halfRateSq = 68 * 68;
      for (let i = 0; i < statePeds.length && i < instances.length; i++) {
        const p = statePeds[i];
        const inst = instances[i];
        if (!inst.rig) continue;

        // Sync active Rapier3D ragdoll / 3-stage physical get-up back into PedestrianState
        if (p.rapierControlled && ragdollWorld) {
          const status = ragdollWorld.getStatus(`ped:${p.id}`);
          if (status) {
            p.x = status.x;
            p.y = status.y;
            p.z = status.z;
            p.yaw = status.yaw;
            p.ragdollMode = status.phase === 'ragdoll' ? 'airborne' : 'recovering';
            inst.root.visible = true;
            inst.tumblePivot.position.y = 0.92;
            inst.tumblePivot.rotation.set(0, 0, 0);
            continue;
          } else {
            // 3-stage physical get-up finished cleanly -> resume studio mocap stroll!
            p.rapierControlled = false;
            p.ragdollMode = 'normal';
            p.fallPitch = 0;
            p.fallRoll = 0;
            p.vx = 0;
            p.vz = 0;
          }
        }

        // Distance-cull far skinned pedestrians (>110m) & half-rate animate distant walkers (68-110m)
        const dSq = (p.x - focusX) * (p.x - focusX) + (p.z - focusZ) * (p.z - focusZ);
        if (dSq > renderDistSq) {
          inst.root.visible = false;
          continue;
        }
        inst.root.visible = true;
        inst.root.position.set(p.x, p.y, p.z);
        inst.root.rotation.y = -p.yaw;
        inst.tumblePivot.position.y = computeTumblePivotY(p.fallPitch, p.fallRoll, p.ragdollMode);
        inst.tumblePivot.rotation.set(p.fallPitch, 0, p.fallRoll);

        if (dSq > halfRateSq && ((i + frameCount) & 1) === 1) {
          continue;
        }
        const rigDt = dSq > halfRateSq ? dt * 2 : dt;
        const ragdollFrozen = p.ragdollMode === 'airborne' || p.ragdollMode === 'downed';
        const isJogging = p.speed > 2.05;
        const animSpeed = p.ragdollMode === 'normal' ? p.speed * 2.4 : p.ragdollMode === 'recovering' ? 0.1 : 1.0;
        inst.rig.update(rigDt, animSpeed, isJogging, p.ragdollMode !== 'airborne', elapsedAccum + i, ragdollFrozen);
      }
    },
  };
}
