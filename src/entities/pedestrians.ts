import * as THREE from 'three';
import { clamp, createRng, distXZ, lerpAngle, yawFromDir } from '../core/math';
import type { ClonedPerson } from '../world/assets';
import { getGroundHeight } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
import { createHumanRigController, type HumanRigController } from './humanRig';
import type { VehicleState } from './vehicle';

export interface PedestrianState {
  id: number;
  routeIndex: number;
  /** Unique deterministic appearance index guaranteed never to collide with neighbors on the same route */
  variantIndex: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  walkPhase: number;
  waypoints: { x: number; z: number }[];
  wpIndex: number;
  dir: 1 | -1;
}

// 18 scenic pedestrian stroll corridors spanning ALL 11 Sol Coast districts!
const STROLL_ROUTES: { x: number; z: number }[][] = [
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
  // 10. Neon Strip Boulevard Sidewalk
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
];

const BASE_AVATAR_COUNT = 6;

/**
 * Computes evenly spaced positions along a multi-segment route so pedestrians
 * start well-distributed instead of clumping together, and assigns every walker
 * on the same route a guaranteed DISTINCT base avatar model (avoiding modulo collisions!).
 */
export function createPedestrians(count = 72): PedestrianState[] {
  const rng = createRng(551305);
  const peds: PedestrianState[] = [];
  const routeCount = STROLL_ROUTES.length;
  const perRoute = Math.max(1, Math.ceil(count / routeCount));

  for (let i = 0; i < count; i++) {
    const routeIdx = i % routeCount;
    const slotOnRoute = Math.floor(i / routeCount);
    const route = STROLL_ROUTES[routeIdx];

    // Spread walkers evenly across the route's segments with gentle jitter so they don't bunch up
    const routeFrac = ((slotOnRoute + 0.15 + rng() * 0.65) / perRoute) % 1;
    const totalSegs = route.length;
    const exactSeg = routeFrac * totalSegs;
    const startIdx = Math.floor(exactSeg) % totalSegs;
    const nextIdx = (startIdx + 1) % totalSegs;
    const t = exactSeg - Math.floor(exactSeg);

    const a = route[startIdx];
    const b = route[nextIdx];
    const x = a.x + (b.x - a.x) * t + (rng() - 0.5) * 1.6;
    const z = a.z + (b.z - a.z) * t + (rng() - 0.5) * 1.6;

    // Guarantee each slot (0..perRoute-1) on the SAME route gets a DIFFERENT base avatar (0..5)!
    // Previous bug: `routeCount (12) % 6 === 0` caused every walker on a route to share `i % 6`!
    const avatarBase = (slotOnRoute + routeIdx * 5) % BASE_AVATAR_COUNT;
    const styleTier = (routeIdx + slotOnRoute * 3) % 12;
    const variantIndex = styleTier * BASE_AVATAR_COUNT + avatarBase;

    peds.push({
      id: i,
      routeIndex: routeIdx,
      variantIndex,
      x,
      y: getGroundHeight(x, z),
      z,
      yaw: yawFromDir(b.x - a.x, b.z - a.z),
      speed: 1.35 + rng() * 0.55,
      walkPhase: rng() * Math.PI * 2,
      waypoints: route,
      wpIndex: nextIdx,
      dir: slotOnRoute % 2 === 0 ? 1 : -1,
    });
  }

  return peds;
}

export function stepPedestrians(
  peds: PedestrianState[],
  vehicles: VehicleState[],
  dt: number,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);

  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
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

    // Step aside calmly if a vehicle approaches close
    let avoidX = 0;
    let avoidZ = 0;
    let speedBoost = 1.0;
    for (const v of vehicles) {
      const d = distXZ(p.x, p.z, v.x, v.z);
      if (d < 6.5 && d > 0.01) {
        avoidX += ((p.x - v.x) / d) * 3.5;
        avoidZ += ((p.z - v.z) / d) * 3.5;
        speedBoost = 1.75;
      }
    }

    // Gentle personal-space separation so pedestrians naturally pass each other instead of clumping
    for (let j = 0; j < peds.length; j++) {
      if (i === j) continue;
      const other = peds[j];
      const ox = p.x - other.x;
      const oz = p.z - other.z;
      const dSq = ox * ox + oz * oz;
      if (dSq < 2.4 * 2.4 && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const push = (2.4 - d) * 0.75;
        avoidX += (ox / d) * push;
        avoidZ += (oz / d) * push;
      }
    }

    if (dist > 0.05) {
      dx = dx / dist + avoidX;
      dz = dz / dist + avoidZ;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;

      const curSpeed = p.speed * speedBoost;
      p.x += dx * curSpeed * safeDt;
      p.z += dz * curSpeed * safeDt;
      p.y = getGroundHeight(p.x, p.z);
      p.yaw = lerpAngle(p.yaw, yawFromDir(dx, dz), clamp(safeDt * 8, 0, 1));
      p.walkPhase += curSpeed * safeDt * 2.1;
    }
  }
}

export interface PedestrianRenderer {
  attachGltfPeople: (clonePerson: (variantIndex: number) => ClonedPerson | null) => void;
  syncFromState: (peds: PedestrianState[], dt: number, focusX: number, focusZ: number) => void;
}

interface PedInstance {
  root: THREE.Group;
  variantIndex: number;
  rig: HumanRigController | null;
}

/**
 * Renders 70+ varied locals across all 11 districts using styled Ready Player Me
 * civilian avatars driven by 4 distinct studio optical mocap walk clips.
 * Strict 85m distance culling keeps GPU skinning fast at 60-120 FPS.
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
    container.add(pedRoot);
    instances.push({ root: pedRoot, variantIndex: p.variantIndex, rig: null });
  }
  scene.add(container);

  let elapsedAccum = 0;

  return {
    attachGltfPeople(clonePerson) {
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const cloned = clonePerson(inst.variantIndex);
        if (!cloned) continue;

        cloned.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
          }
        });

        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.position.y = 0.03;
        inst.root.add(shadow);
        inst.root.add(cloned.scene);

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

    syncFromState(statePeds: PedestrianState[], dt: number, focusX: number, focusZ: number) {
      elapsedAccum += dt;
      for (let i = 0; i < statePeds.length && i < instances.length; i++) {
        const p = statePeds[i];
        const inst = instances[i];
        if (!inst.rig) continue;

        // Distance-cull far skinned pedestrians (>85m) so 70+ locals across the city stay butter-smooth!
        const dSq = (p.x - focusX) * (p.x - focusX) + (p.z - focusZ) * (p.z - focusZ);
        if (dSq > 85 * 85) {
          inst.root.visible = false;
          continue;
        }
        inst.root.visible = true;
        inst.root.position.set(p.x, p.y, p.z);
        inst.root.rotation.y = -p.yaw;
        inst.rig.update(dt, p.speed * 2.4, false, true, elapsedAccum + i);
      }
    },
  };
}
