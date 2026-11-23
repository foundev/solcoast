import * as THREE from 'three';
import {
  clamp,
  distXZ,
  forwardFromYaw,
  lerp,
  lerpAngle,
  resolveCircleAABB,
  rightFromYaw,
  yawFromDir,
  type AABB,
} from '../core/math';
import { createHumanRigController, type HumanRigController } from '../entities/humanRig';
import type { FootMoveInput, PlayerState } from '../entities/player';
import type { ClonedPerson } from './assets';
import { getGroundHeight } from './cityData';
import { createContactShadowTexture } from './textures';

export type InteriorId = 'hotel-solaire' | 'club-neon' | 'cafe-habana' | 'wynwood-gallery';

export interface InteriorNpcDef {
  id: string;
  name: string;
  role: string;
  x: number;
  z: number;
  yaw: number;
  variantIndex: number;
  lines: string[];
  actionCost?: number;
  actionToast?: string;
  dancing?: boolean;
}

export interface InteriorDef {
  id: InteriorId;
  name: string;
  districtLabel: string;
  accentColor: number;
  /** World-space outdoor doorway trigger on sidewalk */
  entranceX: number;
  entranceZ: number;
  /** Facing yaw when stepping back outside */
  outdoorExitYaw: number;
  /** Interior room bounds (local to the interior's origin) */
  width: number;
  depth: number;
  height: number;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  exitX: number;
  exitZ: number;
  colliders: AABB[];
  npcs: InteriorNpcDef[];
}

export const INTERIOR_ORIGIN_Y = -60;

export const INTERIORS: InteriorDef[] = [
  {
    id: 'hotel-solaire',
    name: 'Hotel Solaire Lobby',
    districtLabel: 'Ocean Drive',
    accentColor: 0xff6ca8,
    entranceX: 128.5,
    entranceZ: -65,
    outdoorExitYaw: Math.PI * 0.5,
    width: 24,
    depth: 20,
    height: 6.2,
    spawnX: 0,
    spawnZ: 6.8,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 8.6,
    colliders: [
      // Reception desk (north-west)
      { minX: -9.5, maxX: -2.0, minZ: -7.5, maxZ: -5.2, minY: 0, maxY: 2.2 },
      // Cocktail bar counter (north-east)
      { minX: 2.8, maxX: 10.2, minZ: -7.4, maxZ: -5.2, minY: 0, maxY: 2.2 },
      // Central Art Deco fountain/planter island
      { minX: -2.1, maxX: 2.1, minZ: -1.6, maxZ: 2.0, minY: 0, maxY: 2.0 },
      // West lounge sofa + coffee table
      { minX: -10.5, maxX: -6.2, minZ: 1.5, maxZ: 5.5, minY: 0, maxY: 1.5 },
      // East lounge sofa + coffee table
      { minX: 6.2, maxX: 10.5, minZ: 1.5, maxZ: 5.5, minY: 0, maxY: 1.5 },
    ],
    npcs: [
      {
        id: 'solaire-concierge',
        name: 'Elena',
        role: 'Concierge',
        x: -5.8,
        z: -7.9,
        yaw: Math.PI,
        variantIndex: 13,
        lines: [
          'Elena: "Welcome to Hotel Solaire! Your penthouse terrace overlooks all of Ocean Drive."',
          'Elena: "Try taking the Key Sol Spyder across the north causeway at sunset — best drive on the coast."',
        ],
      },
      {
        id: 'solaire-bartender',
        name: 'Mateo',
        role: 'Bartender',
        x: 6.8,
        z: -7.9,
        yaw: Math.PI,
        variantIndex: 18,
        actionCost: 20,
        actionToast: 'Mateo poured you a chilled Sol Coast Mojito (-$20)!',
        lines: ['Mateo: "House special mojito? Mint fresh from Palm Plaza."'],
      },
      {
        id: 'solaire-guest-1',
        name: 'Camila',
        role: 'Hotel Guest',
        x: -4.8,
        z: 3.4,
        yaw: Math.PI * 0.65,
        variantIndex: 25,
        lines: [
          'Camila: "Love the Art Deco chandelier in here. Just flew in for the Wynwood mural opening!"',
        ],
      },
      {
        id: 'solaire-guest-2',
        name: 'Devon',
        role: 'Lounge Guest',
        x: 2.8,
        z: -2.2,
        yaw: 0.4,
        variantIndex: 32,
        lines: ['Devon: "Heard someone racing a red supercar down Ocean Drive at 120 mph earlier."'],
      },
      {
        id: 'solaire-guest-3',
        name: 'Sora',
        role: 'Tourist',
        x: 4.8,
        z: 3.5,
        yaw: -Math.PI * 0.6,
        variantIndex: 41,
        lines: ['Sora: "The dunes down on Sol Beach look unreal right before dusk."'],
      },
    ],
  },
  {
    id: 'club-neon',
    name: 'Club Neon',
    districtLabel: 'Neon Strip',
    accentColor: 0x2cf3ff,
    entranceX: -8.5,
    entranceZ: -65,
    outdoorExitYaw: -Math.PI * 0.5,
    width: 26,
    depth: 24,
    height: 6.8,
    spawnX: 0,
    spawnZ: 8.8,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 10.6,
    colliders: [
      // Elevated DJ Stage & Booth (North)
      { minX: -6.5, maxX: 6.5, minZ: -11.5, maxZ: -6.8, minY: 0, maxY: 3.0 },
      // West neon bar counter
      { minX: -12.4, maxX: -8.8, minZ: -4.5, maxZ: 5.5, minY: 0, maxY: 2.0 },
      // East VIP booths
      { minX: 8.8, maxX: 12.4, minZ: -4.5, maxZ: 5.5, minY: 0, maxY: 1.8 },
    ],
    npcs: [
      {
        id: 'neon-dj',
        name: 'DJ Solis',
        role: 'Resident DJ',
        x: 0,
        z: -8.5,
        yaw: Math.PI,
        variantIndex: 20,
        dancing: true,
        lines: [
          'DJ Solis: "Vice Wave 98.5 live from Club Neon! Keep the bass loud, Sol Coast!"',
          'DJ Solis: "Dropping the sunset synth set next — hit the floor!"',
        ],
      },
      {
        id: 'neon-bartender',
        name: 'Rico',
        role: 'Club Bartender',
        x: -11.0,
        z: 0.5,
        yaw: Math.PI * 0.5,
        variantIndex: 29,
        actionCost: 25,
        actionToast: 'Rico slid you an Electric Neon Spritz (-$25)!',
        lines: ['Rico: "First round is on the house... alright, $25."'],
      },
      {
        id: 'neon-dancer-1',
        name: 'Maya',
        role: 'Clubber',
        x: -2.4,
        z: -1.8,
        yaw: 0.25,
        variantIndex: 7,
        dancing: true,
        lines: ['Maya: "This LED floor goes crazy at midnight!"'],
      },
      {
        id: 'neon-dancer-2',
        name: 'Julian',
        role: 'Clubber',
        x: 2.2,
        z: -2.2,
        yaw: -0.35,
        variantIndex: 14,
        dancing: true,
        lines: ['Julian: "Best sound system on the entire Neon Strip."'],
      },
      {
        id: 'neon-dancer-3',
        name: 'Zoe',
        role: 'Clubber',
        x: 0.4,
        z: 1.6,
        yaw: -0.1,
        variantIndex: 39,
        dancing: true,
        lines: ['Zoe: "You look like you stepped straight out of Ocean Drive!"'],
      },
      {
        id: 'neon-vip-1',
        name: 'Marcus',
        role: 'VIP Regular',
        x: 7.4,
        z: 1.2,
        yaw: -Math.PI * 0.5,
        variantIndex: 46,
        lines: ['Marcus: "Big drift meet happening over by Sol Coast Arena later tonight."'],
      },
    ],
  },
  {
    id: 'cafe-habana',
    name: 'Café Habana',
    districtLabel: 'Coral Heights',
    accentColor: 0xffb347,
    entranceX: -278.5,
    entranceZ: 25,
    outdoorExitYaw: -Math.PI * 0.5,
    width: 18,
    depth: 16,
    height: 4.8,
    spawnX: 0,
    spawnZ: 5.2,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 6.8,
    colliders: [
      // Espresso bar & pastry case (north wall)
      { minX: -6.5, maxX: 6.5, minZ: -6.2, maxZ: -3.8, minY: 0, maxY: 2.0 },
      // Bistro tables
      { minX: -6.4, maxX: -4.2, minZ: -0.8, maxZ: 1.4, minY: 0, maxY: 1.2 },
      { minX: 4.2, maxX: 6.4, minZ: -0.8, maxZ: 1.4, minY: 0, maxY: 1.2 },
      { minX: -6.4, maxX: -4.2, minZ: 2.8, maxZ: 5.0, minY: 0, maxY: 1.2 },
      { minX: 4.2, maxX: 6.4, minZ: 2.8, maxZ: 5.0, minY: 0, maxY: 1.2 },
    ],
    npcs: [
      {
        id: 'habana-barista',
        name: 'Sofia',
        role: 'Barista',
        x: -1.2,
        z: -6.5,
        yaw: Math.PI,
        variantIndex: 11,
        actionCost: 8,
        actionToast: 'Sofia brewed you a strong Coral Heights Cafecito (-$8)!',
        lines: ['Sofia: "Fresh cafecito and warm pastelitos right out of the oven!"'],
      },
      {
        id: 'habana-local-1',
        name: 'Carlos',
        role: 'Neighborhood Regular',
        x: -3.2,
        z: 0.3,
        yaw: -Math.PI * 0.5,
        variantIndex: 24,
        lines: ['Carlos: "Best espresso in Coral Heights — and the basketball courts are right across the street."'],
      },
      {
        id: 'habana-local-2',
        name: 'Nadia',
        role: 'Local',
        x: 3.1,
        z: 3.6,
        yaw: Math.PI * 0.6,
        variantIndex: 37,
        lines: ['Nadia: "Nice shades. You driving that supercar parked out front?"'],
      },
    ],
  },
  {
    id: 'wynwood-gallery',
    name: 'Wynwood Art Gallery',
    districtLabel: 'Wynwood Arts',
    accentColor: 0xffcf5c,
    entranceX: -188.5,
    entranceZ: -245,
    outdoorExitYaw: -Math.PI * 0.5,
    width: 24,
    depth: 22,
    height: 5.8,
    spawnX: 0,
    spawnZ: 7.6,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 9.6,
    colliders: [
      // Central modern sculpture pedestal
      { minX: -2.2, maxX: 2.2, minZ: -2.2, maxZ: 2.2, minY: 0, maxY: 2.5 },
      // Exhibition partition walls (left & right)
      { minX: -8.0, maxX: -6.8, minZ: -6.5, maxZ: 2.5, minY: 0, maxY: 3.6 },
      { minX: 6.8, maxX: 8.0, minZ: -6.5, maxZ: 2.5, minY: 0, maxY: 3.6 },
      // Curator desk (north)
      { minX: -3.4, maxX: 3.4, minZ: -9.6, maxZ: -8.0, minY: 0, maxY: 1.5 },
    ],
    npcs: [
      {
        id: 'wynwood-curator',
        name: 'André',
        role: 'Gallery Curator',
        x: 0,
        z: -10.2,
        yaw: Math.PI,
        variantIndex: 16,
        lines: [
          'André: "Welcome to Wynwood Contemporary. Every canvas here celebrates Sol Coast neon and sea."',
          'André: "Walk behind the partition walls to see our limited Sunset Series."',
        ],
      },
      {
        id: 'wynwood-visitor-1',
        name: 'Liam',
        role: 'Art Collector',
        x: -4.8,
        z: -2.5,
        yaw: -Math.PI * 0.5,
        variantIndex: 27,
        lines: ['Liam: "The palette on this mural triptych is pure Miami."'],
      },
      {
        id: 'wynwood-visitor-2',
        name: 'Chloe',
        role: 'Photographer',
        x: 4.8,
        z: -1.8,
        yaw: Math.PI * 0.5,
        variantIndex: 34,
        lines: ['Chloe: "I love shooting the light reflections off the sculpture pedestal."'],
      },
      {
        id: 'wynwood-visitor-3',
        name: 'Tariq',
        role: 'Visitor',
        x: -9.8,
        z: -2.0,
        yaw: -Math.PI * 0.4,
        variantIndex: 43,
        lines: ['Tariq: "Check out the painted warehouses outside — the whole district is a gallery."'],
      },
    ],
  },
];

function createFloorTileTexture(colA: string, colB: string, grid = 4): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cell = size / grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? colA : colB;
      ctx.fillRect(x * cell, y * cell, cell, cell);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * cell, y * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGalleryArtworkTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  const palettes = [
    ['#150e2e', '#ff2e93', '#2cf3ff', '#ffd166'],
    ['#0c2233', '#00f5d4', '#ff6b35', '#ffe66d'],
    ['#2a1228', '#ff5e8e', '#ffcf5c', '#72efdd'],
    ['#121b38', '#3a86ff', '#ff006e', '#ffbe0b'],
  ];
  const p = palettes[seed % palettes.length];
  const grad = ctx.createLinearGradient(0, 0, 256, 192);
  grad.addColorStop(0, p[0]);
  grad.addColorStop(1, p[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 192);

  // Retro Miami sun & geometric waves
  ctx.fillStyle = p[3];
  ctx.beginPath();
  ctx.arc(128 + ((seed % 3) - 1) * 35, 86, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = p[2];
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(18 + i * 16, 118 + i * 14, 180 - i * 24, 9);
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 184);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function findNearbyBuildingEntrance(x: number, z: number, maxRange = 3.8): InteriorDef | null {
  for (const def of INTERIORS) {
    if (distXZ(x, z, def.entranceX, def.entranceZ) <= maxRange) {
      return def;
    }
  }
  return null;
}

export function findNearbyInteriorNpc(
  def: InteriorDef,
  x: number,
  z: number,
  maxRange = 4.2,
): InteriorNpcDef | null {
  let best: InteriorNpcDef | null = null;
  let bestDist = maxRange;
  for (const npc of def.npcs) {
    const d = distXZ(x, z, npc.x, npc.z);
    if (d <= bestDist) {
      bestDist = d;
      best = npc;
    }
  }
  return best;
}

/**
 * Steps player walking, sprinting, jumping & solid furniture/NPC/wall collisions inside an active interior.
 */
export function stepPlayerInInterior(
  p: PlayerState,
  def: InteriorDef,
  input: FootMoveInput,
  dt: number,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  const camFwd = forwardFromYaw(input.cameraYaw);
  const camRight = rightFromYaw(input.cameraYaw);

  let moveX = camFwd.x * input.forward + camRight.x * input.right;
  let moveZ = camFwd.z * input.forward + camRight.z * input.right;
  const moveLen = Math.hypot(moveX, moveZ);

  const maxSpeed = input.sprint ? 7.8 : 4.8;
  p.sprinting = input.sprint && moveLen > 0.1;

  if (moveLen > 0.05) {
    moveX /= moveLen;
    moveZ /= moveLen;
    const targetYaw = yawFromDir(moveX, moveZ);
    p.yaw = lerpAngle(p.yaw, targetYaw, clamp(safeDt * 13, 0, 1));
    p.speed = lerp(p.speed, maxSpeed, clamp(safeDt * 12, 0, 1));
  } else {
    p.speed = lerp(p.speed, 0, clamp(safeDt * 14, 0, 1));
    if (p.speed < 0.08) p.speed = 0;
  }

  const prevX = p.x;
  const prevZ = p.z;
  let nextX = p.x + moveX * p.speed * safeDt;
  let nextZ = p.z + moveZ * p.speed * safeDt;

  // Clamp cleanly inside room walls
  const radius = 0.48;
  const halfW = def.width * 0.5 - 0.55;
  const halfD = def.depth * 0.5 - 0.55;
  nextX = clamp(nextX, -halfW, halfW);
  nextZ = clamp(nextZ, -halfD, halfD);

  // Solid interior furniture, bar counters, booths, & partition walls
  for (const box of def.colliders) {
    const res = resolveCircleAABB(nextX, nextZ, radius, box);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
    }
  }

  // Solid indoor NPC bodies (never walk through indoor characters!)
  const npcMinDist = 0.85;
  for (const npc of def.npcs) {
    const dx = nextX - npc.x;
    const dz = nextZ - npc.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < npcMinDist * npcMinDist && dSq > 1e-6) {
      const d = Math.sqrt(dSq);
      const push = npcMinDist - d;
      nextX += (dx / d) * push;
      nextZ += (dz / d) * push;
    }
  }

  p.x = clamp(nextX, -halfW, halfW);
  p.z = clamp(nextZ, -halfD, halfD);

  const floorY = INTERIOR_ORIGIN_Y;
  if (p.grounded && input.jump) {
    p.vy = 6.8;
    p.grounded = false;
  }
  if (p.grounded) {
    p.y = floorY;
    p.vy = 0;
  } else {
    p.vy -= 22.0 * safeDt;
    p.y += p.vy * safeDt;
    if (p.y <= floorY) {
      p.y = floorY;
      p.vy = 0;
      p.grounded = true;
    }
  }

  p.walkedMeters += Math.hypot(p.x - prevX, p.z - prevZ);
  if (p.speed > 0.2 && p.grounded) {
    p.walkPhase += p.speed * safeDt * 1.35;
  }
}

interface BuiltNpcHandle {
  def: InteriorNpcDef;
  root: THREE.Group;
  rig: HumanRigController | null;
}

interface BuiltVenue {
  def: InteriorDef;
  group: THREE.Group;
  npcs: BuiltNpcHandle[];
  danceFloorMat?: THREE.MeshStandardMaterial;
  lasers?: THREE.Mesh[];
  exitRing: THREE.Mesh;
}

export interface InteriorSystemHandles {
  outdoorMarkersRoot: THREE.Group;
  attachGltfNpcs: (clonePedestrian: (variantIndex: number) => ClonedPerson | null) => void;
  setActiveInterior: (id: InteriorId | null) => void;
  update: (elapsed: number, dt: number, activeId: InteriorId | null, playerX: number, playerZ: number) => void;
}

function buildVenueGeometry(def: InteriorDef): BuiltVenue {
  const group = new THREE.Group();
  group.position.set(0, INTERIOR_ORIGIN_Y, 0);
  group.visible = false;

  const w = def.width;
  const d = def.depth;
  const h = def.height;

  // Room palette & floor texture tailored per venue
  let floorTex: THREE.CanvasTexture;
  let wallHex = 0xf4eee6;
  let ceilHex = 0x1e2230;
  let lightHex = 0xffe4bd;
  let ambientIntensity = 0.85;

  if (def.id === 'hotel-solaire') {
    floorTex = createFloorTileTexture('#f3ece1', '#d6c7b2', 4);
    floorTex.repeat.set(6, 5);
    wallHex = 0xf7e4dc;
    ceilHex = 0x2a1d2e;
    lightHex = 0xffd7a3;
  } else if (def.id === 'club-neon') {
    floorTex = createFloorTileTexture('#141026', '#1f163b', 4);
    floorTex.repeat.set(5, 5);
    wallHex = 0x131124;
    ceilHex = 0x0a0914;
    lightHex = 0x4de8ff;
    ambientIntensity = 0.55;
  } else if (def.id === 'cafe-habana') {
    floorTex = createFloorTileTexture('#c96f4b', '#b55c3c', 4);
    floorTex.repeat.set(5, 4);
    wallHex = 0xf6dfc0;
    ceilHex = 0x5c3b28;
    lightHex = 0xffcf91;
  } else {
    floorTex = createFloorTileTexture('#dcdce2', '#d0d0d8', 4);
    floorTex.repeat.set(6, 5);
    wallHex = 0xf5f6fa;
    ceilHex = 0x2d3240;
    lightHex = 0xfff8ec;
    ambientIntensity = 0.95;
  }

  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI * 0.5;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: wallHex, roughness: 0.72 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: ceilHex, roughness: 0.85 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: def.accentColor,
    emissive: def.accentColor,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.62 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xf0c15a, metalness: 0.88, roughness: 0.24 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.5, metalness: 0.35 });
  const velvetMat = new THREE.MeshStandardMaterial({
    color: def.id === 'club-neon' ? 0x6b1452 : 0x165e6b,
    roughness: 0.88,
  });

  // 4 solid walls + ceiling
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), wallMat);
  northWall.position.set(0, h * 0.5, -d * 0.5);
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), wallMat);
  southWall.position.set(0, h * 0.5, d * 0.5);
  const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, d), wallMat);
  westWall.position.set(-w * 0.5, h * 0.5, 0);
  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, d), wallMat);
  eastWall.position.set(w * 0.5, h * 0.5, 0);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceiling.rotation.x = Math.PI * 0.5;
  ceiling.position.y = h;
  group.add(northWall, southWall, westWall, eastWall, ceiling);

  // Glowing cove trim along top perimeter of room
  const trimN = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.16, 0.16), accentMat);
  trimN.position.set(0, h - 0.3, -d * 0.5 + 0.25);
  const trimW = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, d - 0.6), accentMat);
  trimW.position.set(-w * 0.5 + 0.25, h - 0.3, 0);
  const trimE = trimW.clone();
  trimE.position.x = w * 0.5 - 0.25;
  group.add(trimN, trimW, trimE);

  // Double glass exit doorway frame + glowing exit mat on South wall
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 0.3), goldMat);
  doorFrame.position.set(def.exitX, 1.6, d * 0.5 - 0.25);
  group.add(doorFrame);
  const exitRingMat = new THREE.MeshBasicMaterial({
    color: 0x46f7b4,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
  const exitRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.35, 24), exitRingMat);
  exitRing.rotation.x = -Math.PI * 0.5;
  exitRing.position.set(def.exitX, 0.04, def.exitZ);
  group.add(exitRing);

  // Interior lighting (ambient hemisphere + 2 crisp warm/mood point lights)
  const hemi = new THREE.HemisphereLight(0xfff6eb, 0x2a2d3d, ambientIntensity);
  group.add(hemi);
  const ptA = new THREE.PointLight(lightHex, 32, 26, 1.4);
  ptA.position.set(-w * 0.22, h - 1.0, -d * 0.15);
  const ptB = new THREE.PointLight(def.id === 'club-neon' ? 0xff2e93 : lightHex, 32, 26, 1.4);
  ptB.position.set(w * 0.22, h - 1.0, d * 0.12);
  group.add(ptA, ptB);

  let danceFloorMat: THREE.MeshStandardMaterial | undefined;
  let lasers: THREE.Mesh[] | undefined;

  // Venue-specific rich 3D furnishings!
  if (def.id === 'hotel-solaire') {
    // Art Deco reception desk & marble cocktail bar
    const desk = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.15, 1.8), woodMat);
    desk.position.set(-5.75, 0.58, -6.35);
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 2.0), goldMat);
    deskTop.position.set(-5.75, 1.2, -6.35);
    group.add(desk, deskTop);

    const bar = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.12, 1.8), darkMat);
    bar.position.set(6.5, 0.56, -6.3);
    const barTop = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 2.0), goldMat);
    barTop.position.set(6.5, 1.16, -6.3);
    group.add(bar, barTop);

    // Backlit Art Deco bar bottle wall
    const bottleShelf = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.6, 0.35), accentMat);
    bottleShelf.position.set(6.5, 2.4, -d * 0.5 + 0.4);
    group.add(bottleShelf);

    // Central tropical planter island & gleaming gold Art Deco chandelier
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.9, 16), goldMat);
    planter.position.set(0, 0.45, 0.2);
    const foliage = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.45, 1),
      new THREE.MeshStandardMaterial({ color: 0x26854c, roughness: 0.78 }),
    );
    foliage.position.set(0, 1.65, 0.2);
    group.add(planter, foliage);

    const chand = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 8, 24), goldMat);
    chand.rotation.x = Math.PI * 0.5;
    chand.position.set(0, h - 1.1, 0.2);
    group.add(chand);

    // Velvet lounge sofas & cocktail tables
    for (const side of [-1, 1]) {
      const sofa = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 3.8), velvetMat);
      sofa.position.set(side * 9.5, 0.43, 3.5);
      const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), woodMat);
      table.position.set(side * 7.5, 0.25, 3.5);
      group.add(sofa, table);
    }
  } else if (def.id === 'club-neon') {
    // Glowing animated LED dance floor!
    const danceTex = createFloorTileTexture('#00f0ff', '#ff2e93', 6);
    danceTex.repeat.set(2, 2);
    danceFloorMat = new THREE.MeshStandardMaterial({
      map: danceTex,
      emissive: new THREE.Color(0x2cf3ff),
      emissiveMap: danceTex,
      emissiveIntensity: 1.4,
      roughness: 0.18,
    });
    const danceFloor = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 11.5), danceFloorMat);
    danceFloor.rotation.x = -Math.PI * 0.5;
    danceFloor.position.set(0, 0.03, -0.2);
    group.add(danceFloor);

    // Elevated DJ stage, glowing turntable booth & giant speaker stacks
    const stage = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.75, 4.4), darkMat);
    stage.position.set(0, 0.375, -9.2);
    const djDesk = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.1, 1.2), accentMat);
    djDesk.position.set(0, 1.3, -7.8);
    group.add(stage, djDesk);

    for (const sx of [-5.2, 5.2]) {
      const spk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.4, 1.6), darkMat);
      spk.position.set(sx, 2.4, -9.0);
      group.add(spk);
    }

    // Sweeping neon laser beams from ceiling rig!
    lasers = [];
    const laserGeo = new THREE.ConeGeometry(0.65, 11, 8, 1, true);
    laserGeo.translate(0, -5.5, 0);
    for (let i = 0; i < 4; i++) {
      const col = i % 2 === 0 ? 0x00f0ff : 0xff2e93;
      const lMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(laserGeo, lMat);
      beam.position.set(-4.5 + i * 3.0, h - 0.4, -5.2);
      group.add(beam);
      lasers.push(beam);
    }

    // West glowing bar + East VIP booths
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 9.6), darkMat);
    bar.position.set(-10.0, 0.58, 0.5);
    const barNeon = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 9.7), accentMat);
    barNeon.position.set(-10.0, 1.18, 0.5);
    const vip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 9.4), velvetMat);
    vip.position.set(10.6, 0.45, 0.5);
    group.add(bar, barNeon, vip);
  } else if (def.id === 'cafe-habana') {
    // Warm timber espresso counter + copper espresso machine + bistro tables
    const counter = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.08, 1.8), woodMat);
    counter.position.set(0, 0.54, -5.0);
    const espresso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.72, 0.8), goldMat);
    espresso.position.set(-1.4, 1.44, -5.0);
    const pastry = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.65, 0.9),
      new THREE.MeshPhysicalMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0.55, roughness: 0.08 }),
    );
    pastry.position.set(2.2, 1.4, -5.0);
    group.add(counter, espresso, pastry);

    const tableCoords = [
      { x: -5.3, z: 0.3 },
      { x: 5.3, z: 0.3 },
      { x: -5.3, z: 3.9 },
      { x: 5.3, z: 3.9 },
    ];
    for (const tc of tableCoords) {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 14), woodMat);
      top.position.set(tc.x, 0.82, tc.z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 0.82, 10), darkMat);
      leg.position.set(tc.x, 0.41, tc.z);
      group.add(top, leg);
    }
  } else {
    // Wynwood Contemporary Art Gallery: white partition walls, framed Miami pop-art canvases & sculpture!
    const partMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    for (const sx of [-7.4, 7.4]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.65, 3.6, 8.8), partMat);
      part.position.set(sx, 1.8, -2.0);
      group.add(part);
    }

    // 6 Framed original vibrant canvases mounted on walls & partitions
    const artSpots = [
      { x: -7.02, y: 2.0, z: -3.6, ry: Math.PI * 0.5 },
      { x: -7.02, y: 2.0, z: 0.4, ry: Math.PI * 0.5 },
      { x: 7.02, y: 2.0, z: -3.6, ry: -Math.PI * 0.5 },
      { x: 7.02, y: 2.0, z: 0.4, ry: -Math.PI * 0.5 },
      { x: -11.72, y: 2.2, z: -2.0, ry: Math.PI * 0.5 },
      { x: 11.72, y: 2.2, z: -2.0, ry: -Math.PI * 0.5 },
    ];
    artSpots.forEach((spot, idx) => {
      const tex = createGalleryArtworkTexture(idx);
      const canvasMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 2.0, 0.12),
        [
          darkMat,
          darkMat,
          darkMat,
          darkMat,
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }),
          darkMat,
        ],
      );
      canvasMesh.position.set(spot.x, spot.y, spot.z);
      canvasMesh.rotation.y = spot.ry;
      group.add(canvasMesh);
    });

    // Central gleaming sculptural centerpiece + curator desk
    const ped = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.0, 3.8), partMat);
    ped.position.set(0, 0.5, 0);
    const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.95, 0.24, 64, 12), goldMat);
    sculpt.position.set(0, 2.2, 0);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.05, 1.2), darkMat);
    desk.position.set(0, 0.525, -8.8);
    group.add(ped, sculpt, desk);
  }

  // Create NPC anchor groups
  const npcs: BuiltNpcHandle[] = [];
  for (const nDef of def.npcs) {
    const npcRoot = new THREE.Group();
    npcRoot.position.set(nDef.x, 0, nDef.z);
    npcRoot.rotation.y = -nDef.yaw;
    group.add(npcRoot);
    npcs.push({ def: nDef, root: npcRoot, rig: null });
  }

  return { def, group, npcs, danceFloorMat, lasers, exitRing };
}

export function createInteriorSystem(scene: THREE.Scene): InteriorSystemHandles {
  const venues = new Map<InteriorId, BuiltVenue>();
  const outdoorMarkersRoot = new THREE.Group();
  const doorMarkers: { ring: THREE.Mesh; beam: THREE.Mesh; phase: number }[] = [];

  for (let i = 0; i < INTERIORS.length; i++) {
    const def = INTERIORS[i];
    const built = buildVenueGeometry(def);
    scene.add(built.group);
    venues.set(def.id, built);

    // Outdoor glowing walk-in doorway marker right on the sidewalk!
    const mGroup = new THREE.Group();
    const gy = getGroundHeight(def.entranceX, def.entranceZ);
    mGroup.position.set(def.entranceX, gy, def.entranceZ);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.38, 28),
      new THREE.MeshBasicMaterial({
        color: def.accentColor,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.06;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.05, 3.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: def.accentColor,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beam.position.y = 1.6;

    mGroup.add(ring, beam);
    outdoorMarkersRoot.add(mGroup);
    doorMarkers.push({ ring, beam, phase: i * 1.4 });
  }
  scene.add(outdoorMarkersRoot);

  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.6,
  });
  const shadowGeo = new THREE.PlaneGeometry(1.0, 1.0);
  shadowGeo.rotateX(-Math.PI * 0.5);

  return {
    outdoorMarkersRoot,

    attachGltfNpcs(clonePedestrian) {
      for (const venue of venues.values()) {
        for (let i = 0; i < venue.npcs.length; i++) {
          const handle = venue.npcs[i];
          const cloned = clonePedestrian(handle.def.variantIndex);
          if (!cloned) continue;
          cloned.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });
          const shadow = new THREE.Mesh(shadowGeo, shadowMat);
          shadow.position.y = 0.03;
          handle.root.add(shadow, cloned.scene);

          const rig = createHumanRigController(cloned.scene, cloned.animations);
          rig.update(0.016, 0, false, true, i * 0.8);
          rig.mixer.setTime((i * 0.85) % 2.0);
          handle.rig = rig;
        }
      }
    },

    setActiveInterior(id: InteriorId | null) {
      outdoorMarkersRoot.visible = id === null;
      for (const [vid, venue] of venues) {
        venue.group.visible = vid === id;
      }
    },

    update(elapsed: number, dt: number, activeId: InteriorId | null, playerX: number, playerZ: number) {
      if (activeId === null) {
        // Pulse outdoor doorway entrance rings
        for (const m of doorMarkers) {
          const s = 1 + Math.sin(elapsed * 3.2 + m.phase) * 0.1;
          m.ring.scale.set(s, s, 1);
        }
        return;
      }

      const venue = venues.get(activeId);
      if (!venue) return;

      const exitPulse = 1 + Math.sin(elapsed * 3.6) * 0.1;
      venue.exitRing.scale.set(exitPulse, exitPulse, 1);

      // Animate Club Neon pulsing LED floor & sweeping laser beams!
      if (venue.danceFloorMat) {
        const hue = (elapsed * 0.14) % 1;
        venue.danceFloorMat.emissive.setHSL(hue, 0.95, 0.55);
        venue.danceFloorMat.emissiveIntensity = 1.1 + Math.sin(elapsed * 6.4) * 0.45;
      }
      if (venue.lasers) {
        venue.lasers.forEach((beam, idx) => {
          beam.rotation.z = Math.sin(elapsed * (1.4 + idx * 0.3) + idx * 1.2) * 0.55;
          beam.rotation.x = Math.cos(elapsed * (1.1 + idx * 0.25) + idx) * 0.35;
        });
      }

      // Animate indoor NPCs & subtly turn them toward you when you approach to talk!
      for (let i = 0; i < venue.npcs.length; i++) {
        const handle = venue.npcs[i];
        if (!handle.rig) continue;

        const dx = playerX - handle.def.x;
        const dz = playerZ - handle.def.z;
        const d = Math.hypot(dx, dz);
        const targetYaw = d < 4.0 ? yawFromDir(dx, dz) : handle.def.yaw;
        const curYaw = -handle.root.rotation.y;
        const nextYaw = lerpAngle(curYaw, targetYaw, clamp(dt * 5.0, 0, 1));
        handle.root.rotation.y = -nextYaw;

        if (handle.def.dancing) {
          // Lively club groove bobbing + swaying!
          handle.root.position.y = Math.abs(Math.sin(elapsed * 5.4 + i * 1.1)) * 0.08;
          handle.root.rotation.z = Math.sin(elapsed * 2.7 + i * 0.9) * 0.055;
          handle.rig.update(dt, 0.1, false, true, elapsed + i);
        } else {
          handle.rig.update(dt, 0, false, true, elapsed + i);
        }
      }
    },
  };
}
