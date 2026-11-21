import * as THREE from 'three';
import { clamp, createRng, distXZ, lerp, lerpAngle, wrapAngle, yawFromDir, type AABB } from '../core/math';
import { resolveCarVsBuildingSAT, resolveCarVsCarSAT } from '../core/physics';
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
  0xeef2f7, 0x2254a4, 0xd85c18, 0x158a64, 0xc42848, 0xd1a024, 0x5842a4, 0x1c7a88, 0x36404f,
];

export function createTrafficCars(nodes: TrafficNode[], count = 18): TrafficCarState[] {
  const rng = createRng(991122);
  const cars: TrafficCarState[] = [];
  if (nodes.length === 0) return cars;

  for (let i = 0; i < count; i++) {
    const fromIdx = Math.floor(rng() * nodes.length);
    const from = nodes[fromIdx];
    if (from.neighbors.length === 0) continue;
    const toIdx = from.neighbors[Math.floor(rng() * from.neighbors.length)];
    const to = nodes[toIdx];
    const progress = rng();
    const pos = lanePosition(from, to, progress);
    const modelKind = TRAFFIC_MODELS[i % TRAFFIC_MODELS.length];
    const initSpeed = 11 + rng() * 6;
    const mass =
      modelKind === 'suv'
        ? 2150
        : modelKind === 'taxi' || modelKind === 'ev'
          ? 1720
          : 1520;
    cars.push({
      id: i,
      modelKind,
      x: pos.x,
      y: getGroundHeight(pos.x, pos.z),
      z: pos.z,
      vx: Math.sin(pos.yaw) * initSpeed,
      vz: -Math.cos(pos.yaw) * initSpeed,
      yaw: pos.yaw,
      yawRate: 0,
      mass,
      stunnedTimer: 0,
      pitchTilt: 0,
      rollTilt: 0,
      suspOffset: 0,
      speed: initSpeed,
      cruiseSpeed: 12 + rng() * 6,
      color: modelKind === 'taxi' ? 0xf5b81d : TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
      fromNode: fromIdx,
      toNode: toIdx,
      progress,
      lastImpactSpeed: 0,
      lastImpactX: pos.x,
      lastImpactZ: pos.z,
      lastImpactNx: 0,
      lastImpactNz: 1,
    });
  }
  return cars;
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

export function stepTraffic(
  cars: TrafficCarState[],
  nodes: TrafficNode[],
  playerVehicles: VehicleState[],
  dt: number,
  colliders: AABB[] = [],
): void {
  const safeDt = clamp(dt, 0.001, 0.05);

  // 1. Advance either lane-following AI or free-skidding post-crash rigid-body physics!
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    car.lastImpactSpeed = 0;

    if (car.stunnedTimer > 0) {
      // Free-skidding GTA crash physics: car spins & slides freely on its tires after a collision!
      car.stunnedTimer = Math.max(0, car.stunnedTimer - safeDt);
      const prevX = car.x;
      const prevZ = car.z;

      car.vx *= Math.exp(-2.65 * safeDt);
      car.vz *= Math.exp(-2.65 * safeDt);
      car.yawRate *= Math.exp(-2.85 * safeDt);
      car.x += car.vx * safeDt;
      car.z += car.vz * safeDt;
      car.yaw = wrapAngle(car.yaw + car.yawRate * safeDt);

      // Bounce solidly off building walls & stay out of deep water
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

      // Once stopped & stunned timer completes, re-sync to nearest road node so traffic flows naturally again
      if (car.stunnedTimer <= 0 && car.speed < 1.2 && nodes.length > 0) {
        let bestNode = 0;
        let bestDistSq = Infinity;
        for (let n = 0; n < nodes.length; n++) {
          const dSq = (nodes[n].x - car.x) ** 2 + (nodes[n].z - car.z) ** 2;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestNode = n;
          }
        }
        const from = nodes[bestNode];
        if (from.neighbors.length > 0) {
          car.fromNode = bestNode;
          car.toNode = from.neighbors[car.id % from.neighbors.length];
          car.progress = 0.05;
        }
      }
      continue;
    }

    const from = nodes[car.fromNode];
    const to = nodes[car.toNode];
    const segLen = Math.hypot(to.x - from.x, to.z - from.z) || 1;

    const fx = Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    let targetSpeed = car.cruiseSpeed;

    for (const pv of playerVehicles) {
      const dx = pv.x - car.x;
      const dz = pv.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 13 && dx * fx + dz * fz > 0.35 * dist) {
        targetSpeed = 0;
        break;
      }
    }

    if (targetSpeed > 0) {
      for (let j = 0; j < cars.length; j++) {
        if (i === j) continue;
        const other = cars[j];
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const dist = distXZ(car.x, car.z, other.x, other.z);
        if (dist < 11.5 && dx * fx + dz * fz > 0.5 * dist) {
          targetSpeed = Math.min(targetSpeed, other.stunnedTimer > 0 ? 0 : other.speed * 0.6);
        }
      }
    }

    car.speed = lerp(car.speed, targetSpeed, clamp(safeDt * 4.5, 0, 1));
    car.progress += (car.speed * safeDt) / segLen;

    if (car.progress >= 1) {
      const prevId = car.fromNode;
      const nextNode = nodes[car.toNode];
      const candidates = nextNode.neighbors.filter((n) => n !== prevId);
      const pool = candidates.length > 0 ? candidates : nextNode.neighbors;
      const pick = pool[(car.id + Math.floor(car.x + car.z + 1000)) % pool.length];
      car.fromNode = car.toNode;
      car.toNode = pick;
      car.progress -= 1;
    }

    const prevX = car.x;
    const prevZ = car.z;
    const pos = lanePosition(nodes[car.fromNode], nodes[car.toNode], clamp(car.progress, 0, 1));
    car.x = lerp(car.x, pos.x, clamp(safeDt * 8.5, 0, 1));
    car.z = lerp(car.z, pos.z, clamp(safeDt * 8.5, 0, 1));
    car.vx = (car.x - prevX) / safeDt;
    car.vz = (car.z - prevZ) / safeDt;
    car.y = getGroundHeight(car.x, car.z);
    car.yaw = lerpAngle(car.yaw, pos.yaw, clamp(safeDt * 7, 0, 1));
    car.yawRate = 0;
    car.pitchTilt = lerp(car.pitchTilt, 0, clamp(safeDt * 8, 0, 1));
    car.rollTilt = lerp(car.rollTilt, 0, clamp(safeDt * 8, 0, 1));
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

        if (impact > 1.6) {
          car.stunnedTimer = Math.max(car.stunnedTimer, clamp(1.25 + impact * 0.095, 1.4, 2.8));
          car.suspOffset = -clamp(impact * 0.012, 0.03, 0.14);
          car.pitchTilt = clamp(impact * 0.012, 0.02, 0.11);
          car.rollTilt = clamp(car.yawRate * 0.035, -0.11, 0.11);
          car.lastImpactSpeed = Math.max(car.lastImpactSpeed, impact);
          car.lastImpactX = contact.contactX;
          car.lastImpactZ = contact.contactZ;
          car.lastImpactNx = -contact.nx;
          car.lastImpactNz = -contact.nz;
        }
      }
    }
  }

  // 3. Chain-reaction pileup SAT collisions between AI traffic cars!
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const contact = resolveCarVsCarSAT(a, b);
      if (!contact.hit || contact.closingSpeed < 1.2) continue;
      const impact = contact.closingSpeed;
      for (const c of [a, b]) {
        c.stunnedTimer = Math.max(c.stunnedTimer, clamp(1.1 + impact * 0.08, 1.2, 2.4));
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
    g.rotation.y = -c.yaw;
    root.add(g);
    groups.push(g);
  }

  scene.add(root);

  return {
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
          groups[i].visible = dSq <= 185 * 185;
          if (!groups[i].visible) continue;
        }
        groups[i].position.set(c.x, c.y + c.suspOffset, c.z);
        groups[i].rotation.set(c.pitchTilt, -c.yaw, c.rollTilt);
      }
    },
  };
}
