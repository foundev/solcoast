import * as THREE from 'three';
import { clamp, createRng, distXZ, lerpAngle, yawFromDir } from '../core/math';
import type { ClonedPerson } from '../world/assets';
import { getGroundHeight } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
import { createHumanRigController, type HumanRigController } from './humanRig';
import type { VehicleState } from './vehicle';

export interface PedestrianState {
  id: number;
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

// 12 scenic pedestrian stroll corridors spanning ALL 8 Sol Coast districts!
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
  // 10. Neon Strip Boulevard Sidewalk (Collins Ave)
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
];

export function createPedestrians(count = 52): PedestrianState[] {
  const rng = createRng(551305);
  const peds: PedestrianState[] = [];

  for (let i = 0; i < count; i++) {
    const route = STROLL_ROUTES[i % STROLL_ROUTES.length];
    const startIdx = Math.floor(rng() * route.length);
    const nextIdx = (startIdx + 1) % route.length;
    const t = rng();
    const a = route[startIdx];
    const b = route[nextIdx];
    const x = a.x + (b.x - a.x) * t + (rng() - 0.5) * 1.4;
    const z = a.z + (b.z - a.z) * t + (rng() - 0.5) * 1.4;

    peds.push({
      id: i,
      x,
      y: getGroundHeight(x, z),
      z,
      yaw: yawFromDir(b.x - a.x, b.z - a.z),
      speed: 1.35 + rng() * 0.65,
      walkPhase: rng() * Math.PI * 2,
      waypoints: route,
      wpIndex: nextIdx,
      dir: rng() < 0.5 ? 1 : -1,
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

  for (const p of peds) {
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
  rig: HumanRigController | null;
}

/**
 * Renders 50+ varied sidewalk & beachfront pedestrians using styled Ready Player Me
 * civilian avatars driven by studio optical motion capture. Strict 85m distance culling
 * ensures only the nearest ~6-10 characters skin on the GPU per frame (locked 60-120 FPS).
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
    pedRoot.visible = false; // Stay hidden until real rigged GLB humans finish loading
    container.add(pedRoot);
    instances.push({ root: pedRoot, rig: null });
  }
  scene.add(container);

  let elapsedAccum = 0;

  return {
    attachGltfPeople(clonePerson) {
      for (let i = 0; i < instances.length; i++) {
        const cloned = clonePerson(i);
        if (!cloned) continue;

        cloned.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
          }
        });

        const inst = instances[i];
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.position.y = 0.03;
        inst.root.add(shadow);
        inst.root.add(cloned.scene);

        const rig = createHumanRigController(
          cloned.scene,
          cloned.animations,
          cloned.preferredWalkClip,
        );
        // Prime into walking state at a desynchronized phase offset across the crowd
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

        // Distance-cull far skinned pedestrians (>85m) so 50+ locals across the city stay butter-smooth!
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
