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

// Scenic pedestrian stroll corridors: Boardwalk, Ocean Drive Sidewalk, Palm Plaza Loop, Marina Promenade, South Pier
const STROLL_ROUTES: { x: number; z: number }[][] = [
  // Boardwalk Promenade (North-South)
  [
    { x: 158, z: -155 },
    { x: 158, z: -40 },
    { x: 158, z: 75 },
    { x: 158, z: 150 },
  ],
  // Boardwalk East Edge
  [
    { x: 162, z: 145 },
    { x: 162, z: 30 },
    { x: 162, z: -90 },
    { x: 162, z: -165 },
  ],
  // Ocean Drive West Sidewalk (past Art Deco cafés!)
  [
    { x: 128, z: -165 },
    { x: 128, z: -55 },
    { x: 128, z: 55 },
    { x: 128, z: 140 },
  ],
  // Palm Plaza Central Park Loop
  [
    { x: 6, z: 6 },
    { x: 44, z: 6 },
    { x: 44, z: 44 },
    { x: 6, z: 44 },
  ],
  // Marina Cove Waterfront Promenade
  [
    { x: -100, z: 176 },
    { x: -25, z: 176 },
    { x: 55, z: 176 },
    { x: 115, z: 176 },
  ],
  // South Pier Stroll
  [
    { x: 166, z: 157 },
    { x: 215, z: 157 },
    { x: 262, z: 157 },
    { x: 262, z: 163 },
    { x: 172, z: 163 },
  ],
];

export function createPedestrians(count = 16): PedestrianState[] {
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
      speed: 1.45 + rng() * 0.55,
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
 * Renders sidewalk pedestrians strictly using real skeletal-rigged CC0 civilian GLB models
 * (Sam, Maya, Jordan, Harper) with upright posture and counter-swinging human arms.
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
        // Rotate across Maya (1), Jordan (2), Harper (3), Sam (0) so crowd looks varied
        const cloned = clonePerson(i + 1);
        if (!cloned) continue;

        // Keep pedestrians lightweight: contact shadow handles grounding without costly skinned shadow passes
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
        inst.root.visible = true;

        const rig = createHumanRigController(cloned.scene, cloned.animations);
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

        // Distance-cull far skinned pedestrians (>95m) so GPU only skins nearby crowd
        const dSq = (p.x - focusX) * (p.x - focusX) + (p.z - focusZ) * (p.z - focusZ);
        if (dSq > 95 * 95) {
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
