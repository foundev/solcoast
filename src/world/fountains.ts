import * as THREE from 'three';

export type FountainStyle = 'plaza-grand' | 'art-deco' | 'spanish-courtyard' | 'modern-zen';

export interface AnimatedFountainWater {
  group: THREE.Group;
  update: (elapsed: number) => void;
}

interface DropletTrack {
  phase: number;
  speed: number;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  arcPeak: number;
  sx: number;
  sy: number;
  sz: number;
}

interface RippleRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
  minScale: number;
  maxScale: number;
}

let sharedDropGeo: THREE.SphereGeometry | null = null;
let sharedDropMat: THREE.MeshStandardMaterial | null = null;
let sharedRippleGeo: THREE.RingGeometry | null = null;

function getSharedWaterResources() {
  if (!sharedDropGeo) {
    sharedDropGeo = new THREE.SphereGeometry(0.055, 7, 5);
    sharedDropMat = new THREE.MeshStandardMaterial({
      color: 0xe8fbff,
      emissive: 0x5be3ff,
      emissiveIntensity: 0.45,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    sharedRippleGeo = new THREE.RingGeometry(0.85, 1.0, 28);
    sharedRippleGeo.rotateX(-Math.PI * 0.5);
  }
  return { dropGeo: sharedDropGeo, dropMat: sharedDropMat!, rippleGeo: sharedRippleGeo! };
}

/**
 * Builds instanced, live-animated arcing water jets, bubbling plumes, waterfall shimmer,
 * and expanding ripple rings tailored to each of the 4 Sol Coast fountain varieties.
 * All droplets per fountain batch into 1 single InstancedMesh draw call (instead of 32-102)!
 */
export function createFountainWaterEffect(style: FountainStyle, scale = 1.0): AnimatedFountainWater {
  const { dropGeo, dropMat, rippleGeo } = getSharedWaterResources();
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const droplets: DropletTrack[] = [];
  const ripples: RippleRing[] = [];

  const addArcStream = (
    count: number,
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
    arcPeak: number,
    dropScale: number,
    speed: number,
    phaseOffset: number,
  ) => {
    for (let i = 0; i < count; i++) {
      droplets.push({
        phase: (i / count + phaseOffset) % 1,
        speed,
        startX: sx,
        startY: sy,
        startZ: sz,
        endX: ex,
        endY: ey,
        endZ: ez,
        arcPeak,
        sx: dropScale,
        sy: dropScale * 1.45,
        sz: dropScale,
      });
    }
  };

  const addRipple = (y: number, minScale: number, maxScale: number, phase: number) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd6f9ff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const m = new THREE.Mesh(rippleGeo, mat);
    m.position.y = y;
    group.add(m);
    ripples.push({ mesh: m, mat, phase, minScale, maxScale });
  };

  if (style === 'plaza-grand') {
    // 1. Soaring central geyser plume from the top 5.05m chalice up to 7.4m!
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      addArcStream(
        5,
        0,
        5.0,
        0,
        Math.cos(ang) * 0.65,
        4.55,
        Math.sin(ang) * 0.65,
        2.3,
        1.65,
        0.95,
        i * 0.17,
      );
    }
    // 2. 8 graceful inward parabolic jets from the outer 5.1m pool rim arcing into Tier 1!
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      addArcStream(5, c * 4.4, 0.88, s * 4.4, c * 2.0, 2.18, s * 2.0, 1.85, 1.55, 0.78, i * 0.13);
    }
    // 3. Cascading spill streams from Tier 1 (2.5m) into the grand lower pool (0.85m)
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      addArcStream(4, c * 2.55, 2.22, s * 2.55, c * 3.15, 0.85, s * 3.15, 0.25, 1.35, 1.1, i * 0.11);
    }
    addRipple(0.89, 1.8, 4.7, 0.0);
    addRipple(0.89, 1.8, 4.7, 0.5);
    addRipple(2.22, 0.9, 2.3, 0.25);
  } else if (style === 'art-deco') {
    // 1. Graceful sunburst central crest plume from 2.45m up to 3.05m
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      addArcStream(
        4,
        0,
        2.45,
        0,
        Math.cos(ang) * 0.44,
        2.08,
        Math.sin(ang) * 0.44,
        0.65,
        0.78,
        1.1,
        i * 0.25,
      );
    }
    // 2. 4 curved streams pouring cleanly out of the 4 golden swan-neck spouts (r=0.72, y=0.88 -> pool y=0.58)
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      addArcStream(4, c * 0.72, 0.88, s * 0.72, c * 1.05, 0.58, s * 1.05, 0.16, 0.72, 1.25, i * 0.2);
    }
    addRipple(0.61, 0.52, 1.26, 0.0);
    addRipple(0.61, 0.52, 1.26, 0.5);
  } else if (style === 'spanish-courtyard') {
    // 1. Bubbling amphora top fountain plume (y=2.34 -> 2.78 -> spills to 1.28)
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      addArcStream(
        4,
        0,
        2.32,
        0,
        Math.cos(ang) * 0.52,
        1.28,
        Math.sin(ang) * 0.52,
        0.48,
        0.75,
        1.05,
        i * 0.25,
      );
    }
    // 2. 4 bronze spout arcs splashing into the 8-pointed star cobalt basin (y=0.90 -> 0.62)
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      addArcStream(4, c * 0.66, 0.90, s * 0.66, c * 0.96, 0.62, s * 0.96, 0.14, 0.68, 1.3, i * 0.25);
    }
    addRipple(0.66, 0.45, 1.04, 0.0);
    addRipple(0.66, 0.45, 1.04, 0.5);
  } else {
    // modern-zen: shimmering water droplets gliding down the 3 stepped brass monolith water-walls!
    const walls: [number, number, number, number][] = [
      [-1.05, 0.15, 0.22, 2.1],
      [0.05, -0.10, 0.24, 2.8],
      [1.15, 0.12, 0.21, 1.7],
    ];
    for (let wi = 0; wi < walls.length; wi++) {
      const [wx, wz, halfD, topY] = walls[wi];
      for (const side of [-1, 1]) {
        for (const ox of [-0.26, 0, 0.26]) {
          addArcStream(
            3,
            wx + ox,
            topY,
            wz + side * halfD,
            wx + ox,
            0.48,
            wz + side * (halfD + 0.12),
            0.06,
            0.62,
            1.15,
            (wi * 0.31 + (side > 0 ? 0.5 : 0) + ox) % 1,
          );
        }
      }
    }
    addRipple(0.51, 0.55, 1.25, 0.0);
    addRipple(0.51, 0.55, 1.25, 0.5);
  }

  const dropInst = new THREE.InstancedMesh(dropGeo, dropMat, droplets.length);
  dropInst.castShadow = false;
  dropInst.receiveShadow = false;
  dropInst.frustumCulled = false; // Group itself is distance-culled; droplets orbit fountain origin
  group.add(dropInst);

  // Direct matrix buffer writes avoid per-droplet Matrix4.compose() overhead
  const matArray = dropInst.instanceMatrix.array as Float32Array;
  for (let i = 0; i < droplets.length; i++) {
    const base = i * 16;
    const d = droplets[i];
    matArray[base + 0] = d.sx;
    matArray[base + 5] = d.sy;
    matArray[base + 10] = d.sz;
    matArray[base + 15] = 1;
  }

  return {
    group,
    update(elapsed: number) {
      for (let i = 0; i < droplets.length; i++) {
        const d = droplets[i];
        const t = (elapsed * d.speed + d.phase) % 1;
        const x = d.startX + (d.endX - d.startX) * t;
        const z = d.startZ + (d.endZ - d.startZ) * t;
        const baseY = d.startY + (d.endY - d.startY) * t;
        const y = baseY + 4 * d.arcPeak * t * (1 - t);
        const base = i * 16;
        matArray[base + 12] = x;
        matArray[base + 13] = y;
        matArray[base + 14] = z;
      }
      dropInst.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i];
        const t = (elapsed * 0.55 + r.phase) % 1;
        const s = r.minScale + (r.maxScale - r.minScale) * t;
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = (1 - t) * 0.48;
      }
    },
  };
}
