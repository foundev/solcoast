import * as THREE from 'three';
import { clamp, createRng, distXZ, lerp, lerpAngle, yawFromDir } from '../core/math';
import { getGroundHeight } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
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
  0xeef2f7, 0x2658a8, 0xd95f18, 0x168f68, 0xc82b4b, 0xd4a428, 0x5d46a8, 0x1f7f8c, 0x3b4554,
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
        break;
      }
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

function createTrafficExtrusion(isSuv: boolean): {
  bodyGeo: THREE.BufferGeometry;
  cabinGeo: THREE.BufferGeometry;
} {
  const b = new THREE.Shape();
  if (isSuv) {
    b.moveTo(-2.05, 0.36);
    b.lineTo(2.10, 0.36);
    b.quadraticCurveTo(2.22, 0.56, 2.12, 0.84);
    b.lineTo(1.08, 0.96);
    b.lineTo(-2.08, 0.98);
    b.quadraticCurveTo(-2.18, 0.72, -2.05, 0.36);
  } else {
    b.moveTo(-2.10, 0.30);
    b.lineTo(2.14, 0.29);
    b.quadraticCurveTo(2.26, 0.44, 2.18, 0.66);
    b.quadraticCurveTo(1.72, 0.84, 1.05, 0.88);
    b.lineTo(-1.95, 0.90);
    b.quadraticCurveTo(-2.22, 0.72, -2.10, 0.30);
  }

  const c = new THREE.Shape();
  if (isSuv) {
    c.moveTo(-1.82, 0.94);
    c.lineTo(0.96, 0.92);
    c.quadraticCurveTo(0.56, 1.56, 0.24, 1.62);
    c.lineTo(-1.46, 1.60);
    c.quadraticCurveTo(-1.76, 1.38, -1.82, 0.94);
  } else {
    c.moveTo(-1.48, 0.86);
    c.lineTo(0.92, 0.84);
    c.quadraticCurveTo(0.45, 1.36, 0.02, 1.40);
    c.lineTo(-0.78, 1.38);
    c.quadraticCurveTo(-1.26, 1.18, -1.48, 0.86);
  }

  const extrude = (shape: THREE.Shape, w: number, bevel: number) => {
    const depth = w - bevel * 2;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 3,
      curveSegments: 10,
    });
    g.translate(0, 0, -depth * 0.5);
    g.rotateY(Math.PI * 0.5);
    g.computeVertexNormals();
    return g;
  };

  return {
    bodyGeo: extrude(b, isSuv ? 1.94 : 1.86, 0.1),
    cabinGeo: extrude(c, isSuv ? 1.58 : 1.48, 0.08),
  };
}

export interface TrafficRenderer {
  syncFromState: (cars: TrafficCarState[], nightFactor: number) => void;
}

export function createTrafficMeshes(cars: TrafficCarState[], scene: THREE.Scene): TrafficRenderer {
  const root = new THREE.Group();
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1929,
    roughness: 0.06,
    metalness: 0.2,
    clearcoat: 1.0,
    envMapIntensity: 1.8,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e4, metalness: 0.88, roughness: 0.18 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff8dc, emissive: 0xffe8a3, emissiveIntensity: 1.0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1e3e, emissive: 0xff1133, emissiveIntensity: 1.0 });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });

  const sedanGeos = createTrafficExtrusion(false);
  const suvGeos = createTrafficExtrusion(true);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
  wheelGeo.rotateZ(Math.PI * 0.5);
  const hubGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.26, 10);
  hubGeo.rotateZ(Math.PI * 0.5);
  const shadowGeo = new THREE.PlaneGeometry(2.6, 5.1);
  shadowGeo.rotateX(-Math.PI * 0.5);

  const groups: THREE.Group[] = [];

  for (const c of cars) {
    const isSuv = c.id % 3 === 0;
    const geos = isSuv ? suvGeos : sedanGeos;

    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: c.color,
      metalness: 0.48,
      roughness: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.35,
    });

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.04;
    g.add(shadow);

    const body = new THREE.Mesh(geos.bodyGeo, paint);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const cabin = new THREE.Mesh(geos.cabinGeo, glassMat);
    cabin.castShadow = true;
    g.add(cabin);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.11, 0.08), headMat);
    hl.position.set(0, isSuv ? 0.68 : 0.58, -2.22);
    g.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.11, 0.08), tailMat);
    tl.position.set(0, isSuv ? 0.76 : 0.66, 2.2);
    g.add(tl);

    for (const wx of [-0.94, 0.94]) {
      for (const wz of [-1.28, 1.28]) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.34, wz);
        g.add(w);
        const h = new THREE.Mesh(hubGeo, rimMat);
        h.position.set(wx, 0.34, wz);
        g.add(h);
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
      headMat.emissiveIntensity = 0.6 + nightFactor * 2.5;
      tailMat.emissiveIntensity = 0.7 + nightFactor * 2.1;
      for (let i = 0; i < stateCars.length && i < groups.length; i++) {
        const c = stateCars[i];
        groups[i].position.set(c.x, c.y, c.z);
        groups[i].rotation.y = -c.yaw;
      }
    },
  };
}
