import * as THREE from 'three';
import { clamp, createRng, distXZ, lerpAngle, yawFromDir } from '../core/math';
import { getGroundHeight } from '../world/cityData';
import { createContactShadowTexture } from '../world/textures';
import { computeCharacterPose, type PlayerState } from './player';
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
  skinHex: number;
  topHex: number;
  bottomHex: number;
  hairHex: number;
}

const SKIN_TONES = [0xe8bc9b, 0xd9a17b, 0xba7f59, 0x8d5738, 0xf2ccb0];
const MIAMI_TOPS = [0xff5e8e, 0x22d3ee, 0xf5f5f4, 0xfbbf24, 0x34d399, 0xa78bfa, 0xfb7185, 0x38bdf8];
const MIAMI_BOTTOMS = [0x1e293b, 0x334155, 0xe5dec9, 0x1d4ed8, 0x475569];
const HAIR_TONES = [0x1b1512, 0x4a3121, 0x8c6239, 0xc9a25e, 0x2e2320];

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

export function createPedestrians(count = 26): PedestrianState[] {
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
      speed: 1.55 + rng() * 0.75,
      walkPhase: rng() * Math.PI * 2,
      waypoints: route,
      wpIndex: nextIdx,
      dir: rng() < 0.5 ? 1 : -1,
      skinHex: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
      topHex: MIAMI_TOPS[Math.floor(rng() * MIAMI_TOPS.length)],
      bottomHex: MIAMI_BOTTOMS[Math.floor(rng() * MIAMI_BOTTOMS.length)],
      hairHex: HAIR_TONES[Math.floor(rng() * HAIR_TONES.length)],
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
        speedBoost = 1.8;
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
  syncFromState: (peds: PedestrianState[], elapsed: number) => void;
}

interface PedRig {
  root: THREE.Group;
  body: THREE.Group;
  upper: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
}

export function createPedestrianMeshes(peds: PedestrianState[], scene: THREE.Scene): PedestrianRenderer {
  const root = new THREE.Group();
  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.6,
  });
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shadowGeo.rotateX(-Math.PI * 0.5);

  // Shared geometries for fast batched draw perf across all pedestrians
  const torsoGeo = new THREE.CylinderGeometry(0.18, 0.145, 0.48, 10);
  torsoGeo.scale(1.05, 1, 0.68);
  const headGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const hairGeo = new THREE.SphereGeometry(0.118, 10, 8);
  const upperLimbGeo = new THREE.CylinderGeometry(0.05, 0.042, 0.25, 8);
  const lowerLimbGeo = new THREE.CylinderGeometry(0.042, 0.034, 0.24, 8);
  const thighGeo = new THREE.CylinderGeometry(0.072, 0.056, 0.38, 8);
  const calfGeo = new THREE.CylinderGeometry(0.056, 0.044, 0.38, 8);
  const shoeGeo = new THREE.BoxGeometry(0.095, 0.06, 0.21);
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.55 });

  const rigs: PedRig[] = [];

  for (const p of peds) {
    const skinMat = new THREE.MeshStandardMaterial({ color: p.skinHex, roughness: 0.62 });
    const topMat = new THREE.MeshStandardMaterial({ color: p.topHex, roughness: 0.78 });
    const botMat = new THREE.MeshStandardMaterial({ color: p.bottomHex, roughness: 0.82 });
    const hairMat = new THREE.MeshStandardMaterial({ color: p.hairHex, roughness: 0.85 });

    const pedRoot = new THREE.Group();
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.03;
    pedRoot.add(shadow);

    const body = new THREE.Group();
    pedRoot.add(body);

    const upper = new THREE.Group();
    upper.position.y = 0.96;
    body.add(upper);

    const torso = new THREE.Mesh(torsoGeo, topMat);
    torso.position.y = 0.25;
    torso.castShadow = true;
    upper.add(torso);

    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 0.63;
    head.castShadow = true;
    upper.add(head);

    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.scale.set(0.96, 0.85, 1.04);
    hair.position.set(0, 0.68, 0.015);
    upper.add(hair);

    const makeArm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, 0.44, 0);
      shoulder.rotation.z = side * 0.07;
      upper.add(shoulder);
      const u = new THREE.Mesh(upperLimbGeo, topMat);
      u.position.y = -0.13;
      shoulder.add(u);
      const elbow = new THREE.Group();
      elbow.position.y = -0.26;
      shoulder.add(elbow);
      const l = new THREE.Mesh(lowerLimbGeo, skinMat);
      l.position.y = -0.12;
      elbow.add(l);
      return { shoulder, elbow };
    };

    const makeLeg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.88, 0);
      body.add(hip);
      const t = new THREE.Mesh(thighGeo, botMat);
      t.position.y = -0.19;
      t.castShadow = true;
      hip.add(t);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      const c = new THREE.Mesh(calfGeo, botMat);
      c.position.y = -0.19;
      c.castShadow = true;
      knee.add(c);
      const sh = new THREE.Mesh(shoeGeo, shoeMat);
      sh.position.set(0, -0.41, -0.04);
      knee.add(sh);
      return { hip, knee };
    };

    const lArm = makeArm(-1);
    const rArm = makeArm(1);
    const lLeg = makeLeg(-1);
    const rLeg = makeLeg(1);

    root.add(pedRoot);
    rigs.push({
      root: pedRoot,
      body,
      upper,
      leftHip: lLeg.hip,
      leftKnee: lLeg.knee,
      rightHip: rLeg.hip,
      rightKnee: rLeg.knee,
      leftShoulder: lArm.shoulder,
      leftElbow: lArm.elbow,
      rightShoulder: rArm.shoulder,
      rightElbow: rArm.elbow,
    });
  }

  scene.add(root);

  const tmpPlayer: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    vy: 0,
    yaw: 0,
    speed: 2.2,
    grounded: true,
    sprinting: false,
    walkPhase: 0,
    vehicleId: null,
    walkedMeters: 0,
  };

  return {
    syncFromState(statePeds: PedestrianState[], elapsed: number) {
      for (let i = 0; i < statePeds.length && i < rigs.length; i++) {
        const p = statePeds[i];
        const rig = rigs[i];
        rig.root.position.set(p.x, p.y, p.z);
        rig.root.rotation.y = -p.yaw;

        tmpPlayer.speed = p.speed * 2.2;
        tmpPlayer.walkPhase = p.walkPhase;
        const pose = computeCharacterPose(tmpPlayer, elapsed + i);

        rig.body.position.y = pose.bodyOffsetY;
        rig.upper.rotation.x = pose.torsoPitchX;
        rig.upper.rotation.y = pose.torsoTwistY;
        rig.leftHip.rotation.x = pose.leftHipX;
        rig.leftKnee.rotation.x = pose.leftKneeX;
        rig.rightHip.rotation.x = pose.rightHipX;
        rig.rightKnee.rotation.x = pose.rightKneeX;
        rig.leftShoulder.rotation.x = pose.leftShoulderX;
        rig.leftElbow.rotation.x = pose.leftElbowX;
        rig.rightShoulder.rotation.x = pose.rightShoulderX;
        rig.rightElbow.rotation.x = pose.rightElbowX;
      }
    },
  };
}
