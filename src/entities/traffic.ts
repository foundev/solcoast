import * as THREE from 'three';
import { clamp, createRng, distXZ, lerp, lerpAngle, yawFromDir } from '../core/math';
import { getGroundHeight } from '../world/cityData';
import type { TrafficNode } from '../world/types';
import type { VehicleState } from './vehicle';

export interface TrafficCarState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  cruiseSpeed: number;
  color: number;
  fromNode: number;
  toNode: number;
  progress: number;
}

const TRAFFIC_COLORS = [
  0xeef2f7, 0x3b82f6, 0xf97316, 0x10b981, 0xf43f5e, 0xeab308, 0x8b5cf6, 0x14b8a6, 0x64748b,
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
    cars.push({
      id: i,
      x: pos.x,
      y: getGroundHeight(pos.x, pos.z),
      z: pos.z,
      yaw: pos.yaw,
      speed: 11 + rng() * 6,
      cruiseSpeed: 12 + rng() * 6,
      color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
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
  // Right-hand lane offset (3.8m to the right of travel direction)
  const rx = -dz / len;
  const rz = dx / len;
  const laneOffset = 3.8;
  return {
    x: from.x + dx * t + rx * laneOffset,
    z: from.z + dz * t + rz * laneOffset,
    yaw: yawFromDir(dx, dz),
  };
}

/**
 * Advances AI traffic cars along the city road graph, yielding smoothly to
 * player vehicles and other nearby traffic cars.
 */
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

    // Look ahead for obstacles (player cars or other traffic)
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
      // Soft bumper deflection if player crashes into NPC car
      if (dist < 3.4 && dist > 0.01) {
        const push = (3.4 - dist) * 0.5;
        pv.x += (dx / dist) * push;
        pv.z += (dz / dist) * push;
        pv.vx *= 0.72;
        pv.vz *= 0.72;
        pv.lastCollisionImpact = Math.max(pv.lastCollisionImpact, 8);
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

    const pos = lanePosition(nodes[car.fromNode], nodes[car.toNode], clamp(car.progress, 0, 1));
    car.x = lerp(car.x, pos.x, clamp(safeDt * 9, 0, 1));
    car.z = lerp(car.z, pos.z, clamp(safeDt * 9, 0, 1));
    car.y = getGroundHeight(car.x, car.z);
    car.yaw = lerpAngle(car.yaw, pos.yaw, clamp(safeDt * 7, 0, 1));
  }
}

export interface TrafficRenderer {
  syncFromState: (cars: TrafficCarState[], nightFactor: number) => void;
}

export function createTrafficMeshes(cars: TrafficCarState[], scene: THREE.Scene): TrafficRenderer {
  const root = new THREE.Group();
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f1f33, roughness: 0.12, clearcoat: 0.8 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff8dc, emissive: 0xffe8a3, emissiveIntensity: 1.0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff1133, emissiveIntensity: 1.0 });

  const groups: THREE.Group[] = [];
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.62, 4.15);
  const cabinGeo = new THREE.BoxGeometry(1.62, 0.52, 2.05);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 10);
  wheelGeo.rotateZ(Math.PI * 0.5);

  for (const c of cars) {
    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: c.color,
      metalness: 0.35,
      roughness: 0.28,
      clearcoat: 0.7,
    });
    const body = new THREE.Mesh(bodyGeo, paint);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);

    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 1.12, 0.08);
    g.add(cabin);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.08), headMat);
    hl.position.set(0, 0.64, -2.08);
    g.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.08), tailMat);
    tl.position.set(0, 0.68, 2.08);
    g.add(tl);

    for (const wx of [-0.95, 0.95]) {
      for (const wz of [-1.25, 1.25]) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.34, wz);
        g.add(w);
      }
    }

    g.position.set(c.x, c.y, c.z);
    g.rotation.y = -c.yaw;
    root.add(g);
    groups.push(g);
  }

  scene.add(root);

  return {
    syncFromState(stateCars: TrafficCarState[], nightFactor: number) {
      headMat.emissiveIntensity = 0.5 + nightFactor * 2.4;
      tailMat.emissiveIntensity = 0.6 + nightFactor * 2.0;
      for (let i = 0; i < stateCars.length && i < groups.length; i++) {
        const c = stateCars[i];
        groups[i].position.set(c.x, c.y, c.z);
        groups[i].rotation.y = -c.yaw;
      }
    },
  };
}
