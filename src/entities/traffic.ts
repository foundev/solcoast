import * as THREE from 'three';
import { clamp, createRng, distXZ, lerp, lerpAngle, yawFromDir } from '../core/math';
import type { CarModelKind } from '../world/assets';
import { getGroundHeight } from '../world/cityData';
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
  impactVx: number;
  impactVz: number;
  yaw: number;
  speed: number;
  cruiseSpeed: number;
  color: number;
  fromNode: number;
  toNode: number;
  progress: number;
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
    cars.push({
      id: i,
      modelKind,
      x: pos.x,
      y: getGroundHeight(pos.x, pos.z),
      z: pos.z,
      vx: Math.sin(pos.yaw) * initSpeed,
      vz: -Math.cos(pos.yaw) * initSpeed,
      impactVx: 0,
      impactVz: 0,
      yaw: pos.yaw,
      speed: initSpeed,
      cruiseSpeed: 12 + rng() * 6,
      color: modelKind === 'taxi' ? 0xf5b81d : TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
      fromNode: fromIdx,
      toNode: toIdx,
      progress,
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
): void {
  const safeDt = clamp(dt, 0.001, 0.05);

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
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
      }
      // Realistic momentum-based car-to-car collision impulse!
      const minCarDist = 3.55;
      if (dist < minCarDist && dist > 0.01) {
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minCarDist - dist;
        pv.x += nx * overlap * 0.55;
        pv.z += nz * overlap * 0.55;
        car.x -= nx * overlap * 0.45;
        car.z -= nz * overlap * 0.45;

        const relVx = pv.vx - car.vx;
        const relVz = pv.vz - car.vz;
        const relAlongNormal = relVx * nx + relVz * nz;
        if (relAlongNormal < 0) {
          const impulse = -relAlongNormal * 0.72;
          pv.vx += nx * impulse;
          pv.vz += nz * impulse;
          pv.vx *= 0.84;
          pv.vz *= 0.84;
          car.impactVx -= nx * clamp(impulse * 1.15, 0, 18);
          car.impactVz -= nz * clamp(impulse * 1.15, 0, 18);
          car.speed *= 0.4;
          pv.lastCollisionImpact = Math.max(pv.lastCollisionImpact, Math.abs(relAlongNormal));
        }
      }
    }

    if (targetSpeed > 0) {
      for (let j = 0; j < cars.length; j++) {
        if (i === j) continue;
        const other = cars[j];
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const dist = distXZ(car.x, car.z, other.x, other.z);
        if (dist < 11 && dx * fx + dz * fz > 0.5 * dist) {
          targetSpeed = Math.min(targetSpeed, other.speed * 0.6);
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

    // Damp post-collision lateral shunt recoil smoothly before returning to lane
    car.impactVx *= Math.exp(-4.2 * safeDt);
    car.impactVz *= Math.exp(-4.2 * safeDt);
    const prevX = car.x;
    const prevZ = car.z;

    const pos = lanePosition(nodes[car.fromNode], nodes[car.toNode], clamp(car.progress, 0, 1));
    const lanePull = Math.hypot(car.impactVx, car.impactVz) > 1.2 ? 1.8 : 9.0;
    car.x = lerp(car.x, pos.x, clamp(safeDt * lanePull, 0, 1)) + car.impactVx * safeDt;
    car.z = lerp(car.z, pos.z, clamp(safeDt * lanePull, 0, 1)) + car.impactVz * safeDt;
    car.vx = (car.x - prevX) / safeDt;
    car.vz = (car.z - prevZ) / safeDt;
    car.y = getGroundHeight(car.x, car.z);
    car.yaw = lerpAngle(car.yaw, pos.yaw, clamp(safeDt * 7, 0, 1));
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
        groups[i].position.set(c.x, c.y, c.z);
        groups[i].rotation.y = -c.yaw;
      }
    },
  };
}
