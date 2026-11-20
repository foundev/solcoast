import * as THREE from 'three';
import { clamp, lerpAngle, yawFromDir } from '../core/math';
import type { BoatModelKind } from '../world/assets';

export interface BoatState {
  id: string;
  kind: BoatModelKind;
  x: number;
  z: number;
  yaw: number;
  baseY: number;
  phase: number;
  speed: number;
  scale: number;
  moored: boolean;
  waypoints?: { x: number; z: number }[];
  wpIndex: number;
}

export interface BoatFleetRenderer {
  attachGltfBoats: (cloneBoat: (kind: BoatModelKind) => THREE.Group | null) => void;
  update: (elapsed: number, dt: number, nightFactor: number) => void;
}

export function createCoastalBoatFleet(): BoatState[] {
  return [
    // 6 Moored Marina Cove boats right beside the wooden slips
    {
      id: 'marina-cruiser-1',
      kind: 'cruiser',
      x: -88,
      z: 214,
      yaw: 0,
      baseY: -0.78,
      phase: 0.2,
      speed: 0,
      scale: 1.0,
      moored: true,
      wpIndex: 0,
    },
    {
      id: 'marina-speedboat-1',
      kind: 'speedboat',
      x: -61,
      z: 221,
      yaw: Math.PI,
      baseY: -0.72,
      phase: 1.4,
      speed: 0,
      scale: 1.05,
      moored: true,
      wpIndex: 0,
    },
    {
      id: 'marina-sailboat-1',
      kind: 'sailboat',
      x: -29,
      z: 217,
      yaw: 0,
      baseY: -0.75,
      phase: 2.5,
      speed: 0,
      scale: 1.05,
      moored: true,
      wpIndex: 0,
    },
    {
      id: 'marina-motorboat-1',
      kind: 'motorboat',
      x: -2,
      z: 224,
      yaw: Math.PI,
      baseY: -0.68,
      phase: 3.7,
      speed: 0,
      scale: 1.1,
      moored: true,
      wpIndex: 0,
    },
    {
      id: 'marina-watertaxi-1',
      kind: 'watertaxi',
      x: 31,
      z: 216,
      yaw: 0,
      baseY: -0.76,
      phase: 4.9,
      speed: 0,
      scale: 1.0,
      moored: true,
      wpIndex: 0,
    },
    {
      id: 'marina-cruiser-2',
      kind: 'cruiser',
      x: 59,
      z: 222,
      yaw: Math.PI,
      baseY: -0.78,
      phase: 5.8,
      speed: 0,
      scale: 1.12,
      moored: true,
      wpIndex: 0,
    },

    // 6 Actively cruising offshore watercraft along Sol Beach, South Bay & Key Sol
    {
      id: 'cruise-speedboat-1',
      kind: 'speedboat',
      x: 268,
      z: -35,
      yaw: Math.PI,
      baseY: -0.7,
      phase: 0.6,
      speed: 11.5,
      scale: 1.15,
      moored: false,
      waypoints: [
        { x: 268, z: -75 },
        { x: 282, z: 85 },
        { x: 350, z: 120 },
        { x: 365, z: -85 },
      ],
      wpIndex: 1,
    },
    {
      id: 'cruise-sailboat-1',
      kind: 'sailboat',
      x: 330,
      z: 55,
      yaw: 0,
      baseY: -0.75,
      phase: 1.9,
      speed: 4.2,
      scale: 1.18,
      moored: false,
      waypoints: [
        { x: 330, z: 100 },
        { x: 390, z: -40 },
        { x: 430, z: -180 },
        { x: 360, z: -90 },
      ],
      wpIndex: 1,
    },
    {
      id: 'cruise-cruiser-1',
      kind: 'cruiser',
      x: 220,
      z: 268,
      yaw: -Math.PI * 0.5,
      baseY: -0.78,
      phase: 3.1,
      speed: 6.8,
      scale: 1.25,
      moored: false,
      waypoints: [
        { x: 260, z: 268 },
        { x: -130, z: 278 },
        { x: -160, z: 330 },
        { x: 280, z: 325 },
      ],
      wpIndex: 1,
    },
    {
      id: 'cruise-watertaxi-1',
      kind: 'watertaxi',
      x: -40,
      z: 256,
      yaw: Math.PI * 0.5,
      baseY: -0.76,
      phase: 4.2,
      speed: 6.2,
      scale: 1.05,
      moored: false,
      waypoints: [
        { x: -120, z: 256 },
        { x: 145, z: 256 },
        { x: 185, z: 295 },
        { x: -95, z: 295 },
      ],
      wpIndex: 1,
    },
    {
      id: 'cruise-motorboat-1',
      kind: 'motorboat',
      x: 245,
      z: 50,
      yaw: 0,
      baseY: -0.68,
      phase: 2.2,
      speed: 9.2,
      scale: 1.1,
      moored: false,
      waypoints: [
        { x: 245, z: 115 },
        { x: 248, z: -70 },
        { x: 305, z: -95 },
        { x: 312, z: 105 },
      ],
      wpIndex: 1,
    },
    {
      id: 'cruise-sailboat-2',
      kind: 'sailboat',
      x: 110,
      z: 315,
      yaw: -Math.PI * 0.5,
      baseY: -0.75,
      phase: 5.1,
      speed: 3.8,
      scale: 1.12,
      moored: false,
      waypoints: [
        { x: 195, z: 315 },
        { x: -155, z: 315 },
        { x: -180, z: 365 },
        { x: 225, z: 365 },
      ],
      wpIndex: 1,
    },

    // Monumental 185m Atlantic Cruise Liner gliding along the PortMiami horizon!
    {
      id: 'atlantic-cruise-liner',
      kind: 'cruiseship',
      x: 610,
      z: 180,
      yaw: 0,
      baseY: -2.2,
      phase: 0,
      speed: 2.8,
      scale: 1.0,
      moored: false,
      waypoints: [
        { x: 610, z: 480 },
        { x: 610, z: -480 },
        { x: 760, z: -480 },
        { x: 760, z: 480 },
      ],
      wpIndex: 1,
    },
  ];
}

export function stepBoats(boats: BoatState[], dt: number): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  for (const b of boats) {
    if (b.moored || !b.waypoints || b.waypoints.length === 0 || b.speed <= 0) continue;
    const wp = b.waypoints[b.wpIndex];
    const dx = wp.x - b.x;
    const dz = wp.z - b.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (b.kind === 'cruiseship' ? 32 : 12)) {
      b.wpIndex = (b.wpIndex + 1) % b.waypoints.length;
    }
    if (dist > 0.5) {
      const targetYaw = yawFromDir(dx, dz);
      b.yaw = lerpAngle(b.yaw, targetYaw, clamp(safeDt * (b.kind === 'cruiseship' ? 0.35 : 1.4), 0, 1));
      b.x += Math.sin(b.yaw) * b.speed * safeDt;
      b.z += -Math.cos(b.yaw) * b.speed * safeDt;
    }
  }
}

export function createCoastalBoatMeshes(
  boats: BoatState[],
  scene: THREE.Scene,
  onReadyHideFallback?: () => void,
): BoatFleetRenderer {
  const container = new THREE.Group();
  scene.add(container);

  const wakeGeo = new THREE.PlaneGeometry(2.6, 16);
  wakeGeo.rotateX(-Math.PI * 0.5);
  const wakeMat = new THREE.MeshBasicMaterial({
    color: 0xdff8ff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  const handles: {
    state: BoatState;
    root: THREE.Group;
    wake: THREE.Mesh | null;
    emissiveMats: THREE.MeshStandardMaterial[];
  }[] = [];

  for (const b of boats) {
    const root = new THREE.Group();
    root.position.set(b.x, b.baseY, b.z);
    root.rotation.y = -b.yaw;
    root.visible = false; // Shown cleanly once real 3D GLB loads
    container.add(root);

    let wake: THREE.Mesh | null = null;
    if (!b.moored && b.speed > 3) {
      wake = new THREE.Mesh(wakeGeo, wakeMat);
      const wakeLenScale = b.kind === 'cruiseship' ? 5.0 : clamp(b.speed / 7, 0.7, 1.8);
      const wakeWidthScale = b.kind === 'cruiseship' ? 6.5 : b.scale * 0.9;
      wake.scale.set(wakeWidthScale, 1, wakeLenScale);
      wake.position.set(0, -b.baseY - 0.36, b.kind === 'cruiseship' ? 115 : 8.5 * b.scale);
      root.add(wake);
    }

    handles.push({ state: b, root, wake, emissiveMats: [] });
  }

  return {
    attachGltfBoats(cloneBoat) {
      let attachedAny = false;
      for (const h of handles) {
        const model = cloneBoat(h.state.kind);
        if (!model) continue;
        attachedAny = true;
        model.scale.setScalar(h.state.scale);
        model.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          // Keep water shadows lightweight for high FPS
          obj.castShadow = h.state.moored && h.state.kind !== 'cruiseship';
          obj.receiveShadow = false;
          if (obj.material instanceof THREE.MeshStandardMaterial) {
            const mName = (obj.material.name ?? '').toLowerCase();
            if (/window|cabin|bridge|balcony|glazing/i.test(mName) && h.state.kind === 'cruiseship') {
              const glowMat = obj.material.clone();
              glowMat.emissive.setHex(0xffe1a0);
              glowMat.emissiveIntensity = 0.2;
              obj.material = glowMat;
              h.emissiveMats.push(glowMat);
            }
          }
        });
        h.root.add(model);
        h.root.visible = true;
      }
      if (attachedAny && onReadyHideFallback) {
        onReadyHideFallback();
      }
    },

    update(elapsed: number, dt: number, nightFactor: number) {
      stepBoats(boats, dt);
      for (const h of handles) {
        if (!h.root.visible) continue;
        const b = h.state;
        const bobAmp = b.kind === 'cruiseship' ? 0.08 : 0.14;
        const rollAmp = b.kind === 'cruiseship' ? 0.006 : b.kind === 'sailboat' ? 0.045 : 0.028;
        h.root.position.set(b.x, b.baseY + Math.sin(elapsed * 1.25 + b.phase) * bobAmp, b.z);
        h.root.rotation.y = -b.yaw;
        h.root.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * rollAmp;
        h.root.rotation.x = Math.cos(elapsed * 1.1 + b.phase) * (rollAmp * 0.45);
        for (const em of h.emissiveMats) {
          em.emissiveIntensity = 0.08 + nightFactor * 1.45;
        }
      }
    },
  };
}
