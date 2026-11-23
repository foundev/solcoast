import * as THREE from 'three';
import {
  clamp,
  distXZ,
  forwardFromYaw,
  lerp,
  lerpAngle,
  resolveCircleAABB,
  resolveCircleOBB,
  rightFromYaw,
  yawFromDir,
  type AABB,
  type OBB2D,
} from '../core/math';
import { createHumanRigController, type HumanRigController } from '../entities/humanRig';
import type { FootMoveInput, PlayerState } from '../entities/player';
import type {
  ClonedPerson,
  InteriorPropKind,
  InteriorTextureKey,
  InteriorTextureMap,
  NpcUniformKind,
} from './assets';
import { getGroundHeight } from './cityData';
import { createFountainWaterEffect, type AnimatedFountainWater } from './fountains';
import { createContactShadowTexture } from './textures';

export type InteriorId = 'hotel-solaire' | 'club-neon' | 'cafe-habana' | 'wynwood-gallery';

export type CeilingStyle =
  | 'coffered'
  | 'rafters'
  | 'trusses'
  | 'skylight'
  | 'gallery-track'
  | 'neon-cove';

export interface InteriorRoomDef {
  id: string;
  name: string;
  shortLabel: string;
  /** Zero-indexed floor level (0 = 1F, 1 = 2F, 2 = 3F). Defaults to 0. */
  floor?: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  floorColorA: string;
  floorColorB: string;
  floorMapTint: string;
  wallColor: number;
  ceilingColor: number;
  lightColor: number;
  lightIntensity: number;
  ambientIntensity: number;
  floorRoughness?: number;
  floorMetalness?: number;
  /** Photographic Poly Haven PBR texture set for floor & walls */
  floorPbr: InteriorTextureKey;
  floorTint?: number;
  wallPbr: InteriorTextureKey;
  wallTint?: number;
  /** Architectural wainscoting lower wall + chair rail + crown molding */
  wainscotColor?: number;
  crownColor?: number;
  ceilingStyle: CeilingStyle;
  sconceColor?: number;
}

export interface InteriorDoorwayDef {
  /** Wall plane axis: 'x' means wall at x = coord spanning z in [min, max] */
  axis: 'x' | 'z';
  coord: number;
  min: number;
  max: number;
  height: number;
  frameColor: number;
  accentNeon?: number;
  floor?: number;
}

export interface InteriorWindowDef {
  /** Wall plane axis: 'x' means wall at x = coord spanning z in [min, max] */
  axis: 'x' | 'z';
  coord: number;
  min: number;
  max: number;
  sillY: number;
  topY: number;
  frameColor: number;
  cols?: number;
  tintColor?: number;
  opacity?: number;
  /** Optional intentional exterior tint color & darker exterior opacity (e.g. nightclub or bathroom privacy tint) */
  exteriorTintColor?: number;
  exteriorOpacity?: number;
  floor?: number;
}

export interface InteriorPropPlacement {
  kind: InteriorPropKind;
  x: number;
  y?: number;
  z: number;
  rotY?: number;
  scale?: number;
  /** If true, y is ceiling height and prop hangs downward from y */
  hangFromCeiling?: boolean;
  floor?: number;
}

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
  floor?: number;
  /** Optional 3D hotel staff uniform (bellhop, maid, concierge, bartender, waiter, security) */
  uniform?: NpcUniformKind;
  /** Optional living patrol loop inside the interior (walks between waypoints using mocap Walk) */
  patrol?: { x: number; z: number }[];
  patrolIndex?: number;
  patrolPause?: number;
}

export interface InteriorDoorDef {
  id: string;
  label: string;
  floor: number;
  axis: 'x' | 'z';
  coord: number;
  min: number;
  max: number;
  height: number;
  /** +1 or -1 swing direction when opening into the room */
  swingDir: 1 | -1;
  doubleDoor?: boolean;
  /** Optional keycard id required to unlock/open this door (e.g. 'hotel-suite-201', 'hotel-penthouse') */
  requiredKeycard?: string;
  /** If true, door belongs to an occupied guest room — cannot be unlocked; pressing [E] knocks! */
  occupied?: boolean;
  lockedToast?: string;
  knockLines?: string[];
  /** Side (+1 or -1 along wall normal) where electronic keycard reader sits (for suite entry doors) */
  readerSide?: 1 | -1;
}

export interface InteriorElevatorDef {
  floor: number;
  floorLabel: string;
  shortFloor: string;
  /** Interactive call trigger position right in front of the brass elevator doors */
  x: number;
  z: number;
  /** Player arrival spawn when stepping out of the elevator onto this floor */
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  /** Optional keycard required to select this floor in the elevator (e.g. 'hotel-penthouse') */
  requiredKeycard?: string;
  lockedToast?: string;
}

export interface StorefrontDef {
  /** Exact world-space building wall plane to bolt the storefront flush onto */
  wallX: number;
  centerZ: number;
  /** Which direction the storefront faces into the street (+1 = East/+X, -1 = West/-X) */
  facingSignX: 1 | -1;
  signText: string;
  subtitle: string;
  style: 'art-deco-hotel' | 'neon-club' | 'cuban-cafe' | 'modern-gallery';
}

export interface InteriorPropObb extends OBB2D {
  floor?: number;
}

export interface InteriorAABB extends AABB {
  floor?: number;
}

export interface InteriorDef {
  id: InteriorId;
  name: string;
  districtLabel: string;
  accentColor: number;
  /** World-space outdoor doorway trigger on sidewalk right in front of the double doors */
  entranceX: number;
  entranceZ: number;
  /** Facing yaw when stepping back outside */
  outdoorExitYaw: number;
  storefront: StorefrontDef;
  /** Overall bounding box across all rooms (for minimap framing) */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  rooms: InteriorRoomDef[];
  doorways: InteriorDoorwayDef[];
  windows?: InteriorWindowDef[];
  doors?: InteriorDoorDef[];
  elevators?: InteriorElevatorDef[];
  /** Auto-generated perimeter & interior partition walls (with doorway cutouts) */
  walls: InteriorAABB[];
  /** Auto-generated exact tight rotated 2D OBB colliders for every floor-standing 3D prop! */
  propColliders: InteriorPropObb[];
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  exitX: number;
  exitZ: number;
  /** Exact architectural built-in colliders (bars, counters, DJ stage, sculpture plinths) */
  colliders: InteriorAABB[];
  props: InteriorPropPlacement[];
  npcs: InteriorNpcDef[];
}

export const INTERIOR_ORIGIN_Y = -60;
export const FLOOR_STRIDE_Y = 12;
export const REAL_STORY_HEIGHT = 4.8;

/** Visual Y offset of a floor inside venue.group so all floors stack flush at their true 3D story heights! */
export function getVisualFloorBaseY(floor: number): number {
  return floor * REAL_STORY_HEIGHT;
}

export function getFloorFromPlayerY(playerY: number, def?: InteriorDef | null): number {
  const raw = Math.max(0, Math.round((playerY - INTERIOR_ORIGIN_Y) / FLOOR_STRIDE_Y));
  if (!def) return raw;
  let maxFloor = 0;
  for (const r of def.rooms) {
    if ((r.floor ?? 0) > maxFloor) maxFloor = r.floor ?? 0;
  }
  return clamp(raw, 0, maxFloor);
}

export function getInteriorWorldAnchor(
  def: InteriorDef,
  currentFloor = 0,
): { worldX: number; worldY: number; worldZ: number; worldRotY: number } {
  const worldRotY = def.storefront.facingSignX === 1 ? Math.PI * 0.5 : -Math.PI * 0.5;
  const exitRoom = getInteriorRoomAt(def, def.exitX, def.exitZ, 0);
  const exitWallZ = exitRoom.maxZ;
  const worldX = def.storefront.wallX - def.storefront.facingSignX * exitWallZ;
  // Step 1F floor 14cm above the outdoor sidewalk slab (0.22 -> 0.36m) so the floor & rugs NEVER Z-fight/flash!
  const baseGroundY = getGroundHeight(def.entranceX, def.entranceZ) + 0.14;
  const worldY = baseGroundY - currentFloor * (FLOOR_STRIDE_Y - REAL_STORY_HEIGHT);
  const worldZ = def.storefront.centerZ;
  return { worldX, worldY, worldZ, worldRotY };
}

export function interiorLocalToWorld(
  def: InteriorDef,
  lx: number,
  py: number,
  lz: number,
  currentFloor = getFloorFromPlayerY(py, def),
): { x: number; y: number; z: number; rotY: number } {
  const { worldX, worldY, worldZ, worldRotY } = getInteriorWorldAnchor(def, currentFloor);
  const sinR = Math.sin(worldRotY);
  const cosR = Math.cos(worldRotY);
  return {
    x: worldX + lx * cosR + lz * sinR,
    y: worldY + (py - INTERIOR_ORIGIN_Y),
    z: worldZ - lx * sinR + lz * cosR,
    rotY: worldRotY,
  };
}

export function getInteriorFloorLabel(def: InteriorDef, floor: number): string | null {
  const elev = def.elevators?.find((e) => e.floor === floor);
  return elev ? elev.shortFloor : null;
}

export function findNearbyInteriorElevator(
  def: InteriorDef,
  floor: number,
  x: number,
  z: number,
  maxRange = 2.6,
): InteriorElevatorDef | null {
  if (!def.elevators) return null;
  for (const e of def.elevators) {
    if (e.floor !== floor) continue;
    if (distXZ(x, z, e.x, e.z) <= maxRange) {
      return e;
    }
  }
  return null;
}

export function findNearbyInteriorDoor(
  def: InteriorDef,
  floor: number,
  x: number,
  z: number,
  maxRange = 2.1,
): InteriorDoorDef | null {
  if (!def.doors) return null;
  let best: InteriorDoorDef | null = null;
  let bestDist = maxRange;
  for (const d of def.doors) {
    if (d.floor !== floor) continue;
    const mid = (d.min + d.max) * 0.5;
    const dx = d.axis === 'x' ? x - d.coord : x - mid;
    const dz = d.axis === 'x' ? z - mid : z - d.coord;
    const dist = Math.hypot(dx, dz);
    if (dist <= bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** Steps patrolling hotel staff smoothly along their floor waypoints (stops politely when player approaches). */
export function stepInteriorPatrols(
  def: InteriorDef,
  dt: number,
  playerX: number,
  playerZ: number,
  playerFloor: number,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  for (const npc of def.npcs) {
    if (!npc.patrol || npc.patrol.length < 2) continue;
    const npcFloor = npc.floor ?? 0;
    // Pause politely when a guest approaches on the same floor
    if (npcFloor === playerFloor && distXZ(playerX, playerZ, npc.x, npc.z) < 2.8) {
      continue;
    }
    if ((npc.patrolPause ?? 0) > 0) {
      npc.patrolPause = Math.max(0, (npc.patrolPause ?? 0) - safeDt);
      continue;
    }
    const idx = npc.patrolIndex ?? 1;
    const target = npc.patrol[idx % npc.patrol.length];
    const dx = target.x - npc.x;
    const dz = target.z - npc.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.22) {
      npc.patrolIndex = (idx + 1) % npc.patrol.length;
      npc.patrolPause = 2.4;
      continue;
    }
    const walkSpeed = 1.25;
    const step = Math.min(dist, walkSpeed * safeDt);
    npc.x += (dx / dist) * step;
    npc.z += (dz / dist) * step;
    npc.yaw = lerpAngle(npc.yaw, yawFromDir(dx, dz), clamp(safeDt * 6.5, 0, 1));
  }
}

interface WallSegment {
  axis: 'x' | 'z';
  coord: number;
  start: number;
  end: number;
  outwardSign: 1 | -1;
  height: number;
  wallColor: number;
  room: InteriorRoomDef;
  floor: number;
  isExterior: boolean;
}

function subtractIntervals(
  start: number,
  end: number,
  cuts: { min: number; max: number }[],
): { start: number; end: number }[] {
  let segs = [{ start, end }];
  for (const cut of cuts) {
    const next: { start: number; end: number }[] = [];
    for (const s of segs) {
      if (cut.max <= s.start + 0.01 || cut.min >= s.end - 0.01) {
        next.push(s);
      } else {
        if (cut.min > s.start + 0.05) next.push({ start: s.start, end: cut.min });
        if (cut.max < s.end - 0.05) next.push({ start: cut.max, end: s.end });
      }
    }
    segs = next;
  }
  return segs;
}

function computeRoomWallSegments(rooms: InteriorRoomDef[], doorways: InteriorDoorwayDef[]): WallSegment[] {
  const segs: WallSegment[] = [];
  for (const r of rooms) {
    const rFloor = r.floor ?? 0;
    const sameFloorOthers = rooms.filter((o) => o !== r && (o.floor ?? 0) === rFloor);
    const addEdge = (
      axis: 'x' | 'z',
      coord: number,
      start: number,
      end: number,
      outwardSign: 1 | -1,
    ) => {
      // Find adjacent rooms on the same floor touching the outward face of this wall edge
      const touchingSpans: { min: number; max: number }[] = [];
      for (const o of sameFloorOthers) {
        if (axis === 'x') {
          const touchCoord = outwardSign > 0 ? o.minX : o.maxX;
          if (Math.abs(touchCoord - coord) < 0.08) {
            const ovMin = Math.max(start, o.minZ);
            const ovMax = Math.min(end, o.maxZ);
            if (ovMax > ovMin + 0.05) touchingSpans.push({ min: ovMin, max: ovMax });
          }
        } else {
          const touchCoord = outwardSign > 0 ? o.minZ : o.maxZ;
          if (Math.abs(touchCoord - coord) < 0.08) {
            const ovMin = Math.max(start, o.minX);
            const ovMax = Math.min(end, o.maxX);
            if (ovMax > ovMin + 0.05) touchingSpans.push({ min: ovMin, max: ovMax });
          }
        }
      }

      // Split [start, end] at adjacent room boundaries so every sub-span is purely interior or purely exterior
      const splitPts = new Set<number>([start, end]);
      for (const sp of touchingSpans) {
        if (sp.min > start + 0.05 && sp.min < end - 0.05) splitPts.add(sp.min);
        if (sp.max > start + 0.05 && sp.max < end - 0.05) splitPts.add(sp.max);
      }
      const sortedPts = Array.from(splitPts).sort((a, b) => a - b);

      const cuts = doorways
        .filter((d) => (d.floor ?? 0) === rFloor && d.axis === axis && Math.abs(d.coord - coord) < 0.05)
        .map((d) => ({ min: Math.max(start, d.min), max: Math.min(end, d.max) }))
        .filter((c) => c.max > c.min + 0.05);

      for (let i = 0; i < sortedPts.length - 1; i++) {
        const s0 = sortedPts[i];
        const s1 = sortedPts[i + 1];
        if (s1 - s0 < 0.05) continue;
        const mid = (s0 + s1) * 0.5;
        const isShared = touchingSpans.some((sp) => mid >= sp.min + 0.02 && mid <= sp.max - 0.02);
        for (const s of subtractIntervals(s0, s1, cuts)) {
          segs.push({
            axis,
            coord,
            start: s.start,
            end: s.end,
            outwardSign,
            height: r.height,
            wallColor: r.wallColor,
            room: r,
            floor: rFloor,
            isExterior: !isShared,
          });
        }
      }
    };
    addEdge('x', r.minX, r.minZ, r.maxZ, -1);
    addEdge('x', r.maxX, r.minZ, r.maxZ, 1);
    addEdge('z', r.minZ, r.minX, r.maxX, -1);
    addEdge('z', r.maxZ, r.minX, r.maxX, 1);
  }
  return segs;
}

function buildWallColliders(rooms: InteriorRoomDef[], doorways: InteriorDoorwayDef[]): InteriorAABB[] {
  const segs = computeRoomWallSegments(rooms, doorways);
  const thick = 0.28;
  return segs.map((s) => {
    if (s.axis === 'x') {
      const x0 = s.outwardSign > 0 ? s.coord : s.coord - thick;
      const x1 = s.outwardSign > 0 ? s.coord + thick : s.coord;
      return { minX: x0, maxX: x1, minZ: s.start, maxZ: s.end, minY: 0, maxY: s.height, floor: s.floor };
    }
    const z0 = s.outwardSign > 0 ? s.coord : s.coord - thick;
    const z1 = s.outwardSign > 0 ? s.coord + thick : s.coord;
    return { minX: s.start, maxX: s.end, minZ: z0, maxZ: z1, minY: 0, maxY: s.height, floor: s.floor };
  });
}

// Exact measured floor-standing GLB footprints [widthX, depthZ] in meters (inset ~4-6cm on soft edges/leaves
// so collisions hug the visible 3D mesh tightly with zero invisible forcefields!)
const PROP_FOOTPRINTS: Partial<Record<InteriorPropKind, [number, number]>> = {
  armchair: [0.74, 0.86],
  art_deco_fountain: [3.28, 3.28],
  fountain_plaza_grand: [11.8, 11.8],
  fountain_spanish_courtyard: [3.28, 3.28],
  fountain_modern_zen: [4.52, 3.12],
  artist_easel: [1.02, 0.84],
  bar_stool: [0.42, 0.42],
  bed_suite: [1.44, 1.98],
  bistro_table: [1.26, 1.26],
  cabinet: [2.36, 0.48],
  chalkboard: [0.78, 0.58],
  coffee_cart: [2.04, 0.98],
  coffee_table: [0.54, 1.12],
  console_table: [1.46, 0.52],
  dining_chair: [0.38, 0.48],
  dining_table: [2.16, 1.30],
  display_shelves: [0.34, 1.02],
  dj_booth_rig: [5.05, 1.00],
  gallery_bench: [1.10, 0.44],
  grand_piano: [1.44, 2.48],
  grandfather_clock: [0.58, 0.40],
  hotel_elevator_doors: [2.70, 0.42],
  hotel_housekeeping_cart: [1.40, 0.54],
  hotel_ice_machine: [0.94, 0.70],
  hotel_luggage_cart: [1.18, 0.64],
  hotel_reception_desk: [4.95, 1.48],
  hotel_room_service_cart: [0.94, 0.72],
  hotel_soaking_tub: [2.00, 0.92],
  hotel_toilet_bidet: [0.64, 0.66],
  hotel_tv_minibar: [2.10, 0.58],
  hotel_vanity_sink: [2.10, 0.62],
  lounge_chair: [0.88, 1.02],
  metal_shelves: [2.26, 0.66],
  neon_sculpture_arch: [2.04, 2.04],
  pastry_display_case: [1.82, 0.82],
  potted_plant_1: [0.40, 0.40],
  potted_plant_2: [0.44, 0.44],
  sofa_club: [1.50, 0.60],
  sofa_luxury: [2.62, 0.86],
  stage_lights: [3.40, 1.30],
};

function buildPropColliders(props: InteriorPropPlacement[]): InteriorPropObb[] {
  const out: InteriorPropObb[] = [];
  for (const p of props) {
    if (p.hangFromCeiling) continue;
    // Only floor-standing props collide at walking height (tabletop/wall/stage-top props skip)
    if ((p.y ?? 0) >= 0.35) continue;
    const fp = PROP_FOOTPRINTS[p.kind];
    if (!fp) continue;
    const sc = p.scale ?? 1.0;
    out.push({
      cx: p.x,
      cz: p.z,
      halfW: fp[0] * sc * 0.5,
      halfD: fp[1] * sc * 0.5,
      rotY: p.rotY ?? 0,
      floor: p.floor ?? 0,
    });
  }
  return out;
}

function makeVenue(
  raw: Omit<InteriorDef, 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'walls' | 'propColliders'>,
): InteriorDef {
  const minX = Math.min(...raw.rooms.map((r) => r.minX));
  const maxX = Math.max(...raw.rooms.map((r) => r.maxX));
  const minZ = Math.min(...raw.rooms.map((r) => r.minZ));
  const maxZ = Math.max(...raw.rooms.map((r) => r.maxZ));
  return {
    ...raw,
    minX,
    maxX,
    minZ,
    maxZ,
    walls: buildWallColliders(raw.rooms, raw.doorways),
    propColliders: buildPropColliders(raw.props),
  };
}

export const INTERIORS: InteriorDef[] = [
  // ─── 1. HOTEL SOLAIRE (OCEAN DRIVE — 3-FLOOR, 10-ROOM LUXURY ART DECO HOTEL) ──
  // Centered cleanly inside Ocean Drive block (x: 82..128, z: -98..-32) with generous sidewalk setbacks on all 4 sides!
  makeVenue({
    id: 'hotel-solaire',
    name: 'Hotel Solaire',
    districtLabel: 'Ocean Drive',
    accentColor: 0xff6ca8,
    entranceX: 126.5,
    entranceZ: -62.0,
    outdoorExitYaw: Math.PI * 0.5,
    storefront: {
      wallX: 124.0,
      centerZ: -62.0,
      facingSignX: 1,
      signText: 'HOTEL SOLAIRE',
      subtitle: 'OCEAN DRIVE · 3 FLOORS · SUITES · PENTHOUSE',
      style: 'art-deco-hotel',
    },
    spawnX: 0,
    spawnZ: 9.6,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 11.2,
    elevators: [
      {
        floor: 0,
        floorLabel: '1F — Grand Lobby & Lounge',
        shortFloor: '1F LOBBY',
        x: 0,
        z: -2.4,
        spawnX: 0,
        spawnZ: -1.7,
        spawnYaw: Math.PI,
      },
      {
        floor: 1,
        floorLabel: '2F — Guest Suites (201–204)',
        shortFloor: '2F SUITES',
        x: 0,
        z: -0.4,
        spawnX: 0,
        spawnZ: 0.4,
        spawnYaw: Math.PI,
      },
      {
        floor: 2,
        floorLabel: '3F — The Ocean Penthouse',
        shortFloor: '3F PENTHOUSE',
        x: 0,
        z: 8.4,
        spawnX: 0,
        spawnZ: 7.4,
        spawnYaw: 0,
        requiredKeycard: 'hotel-penthouse',
        lockedToast: 'Floor 3 Penthouse requires a VIP Keycard — check in with Concierge Elena on 1F ($500)!',
      },
    ],
    rooms: [
      // ── FLOOR 0 (1F: GRAND LOBBY & OCEAN LOUNGE) ──
      {
        id: 'atrium',
        name: '1F Grand Marble Lobby',
        shortLabel: 'LOBBY',
        floor: 0,
        minX: -10,
        maxX: 10,
        minZ: -4,
        maxZ: 12,
        height: 4.65,
        floorColorA: '#f5efe4',
        floorColorB: '#d9ccb6',
        floorMapTint: '#363c52',
        wallColor: 0xf6e6dc,
        ceilingColor: 0x2a2030,
        lightColor: 0xffdfb0,
        lightIntensity: 1.5,
        ambientIntensity: 0.9,
        floorRoughness: 0.24,
        floorPbr: 'marble',
        floorTint: 0xfff8ee,
        wallPbr: 'plaster',
        wallTint: 0xfaeae0,
        wainscotColor: 0x3b2418,
        crownColor: 0xe6bd68,
        ceilingStyle: 'coffered',
        sconceColor: 0xffd28a,
      },
      {
        id: 'lounge',
        name: '1F Ocean Cocktail Lounge',
        shortLabel: 'BAR LOUNGE',
        floor: 0,
        minX: 10,
        maxX: 23,
        minZ: -4,
        maxZ: 10,
        height: 4.65,
        floorColorA: '#543525',
        floorColorB: '#44291c',
        floorMapTint: '#3e2d39',
        wallColor: 0x1e3a42,
        ceilingColor: 0x191620,
        lightColor: 0xffb870,
        lightIntensity: 1.35,
        ambientIntensity: 0.65,
        floorRoughness: 0.35,
        floorPbr: 'parquet',
        floorTint: 0xc29874,
        wallPbr: 'plaster',
        wallTint: 0x2b5059,
        wainscotColor: 0x361e12,
        crownColor: 0xd4a44a,
        ceilingStyle: 'coffered',
        sconceColor: 0xffb866,
      },

      // ── FLOOR 1 (2F: GUEST CORRIDOR + ENTERABLE SUITES 201 & 202 + EN-SUITE BATHS) ──
      {
        id: 'corridor-2f',
        name: '2F Guest Suites Corridor',
        shortLabel: '2F HALL',
        floor: 1,
        minX: -12,
        maxX: 12,
        minZ: -2,
        maxZ: 5,
        height: 3.6,
        floorColorA: '#6b2232',
        floorColorB: '#591c2a',
        floorMapTint: '#482636',
        wallColor: 0xf4e8dc,
        ceilingColor: 0xede4da,
        lightColor: 0xffe0b2,
        lightIntensity: 1.3,
        ambientIntensity: 0.85,
        floorRoughness: 0.82,
        floorPbr: 'parquet',
        floorTint: 0x997054,
        wallPbr: 'plaster',
        wallTint: 0xf6ebe0,
        wainscotColor: 0x3d2417,
        crownColor: 0xd9a84e,
        ceilingStyle: 'coffered',
        sconceColor: 0xffd28a,
      },
      {
        id: 'suite-201',
        name: 'Suite 201 — Ocean Breeze King',
        shortLabel: 'SUITE 201',
        floor: 1,
        minX: -22,
        maxX: -12,
        minZ: -4,
        maxZ: 6,
        height: 3.6,
        floorColorA: '#e4d8c6',
        floorColorB: '#d9cbb6',
        floorMapTint: '#3b3750',
        wallColor: 0xf6efe6,
        ceilingColor: 0xf0e9e0,
        lightColor: 0xffe2ba,
        lightIntensity: 1.35,
        ambientIntensity: 0.88,
        floorRoughness: 0.45,
        floorPbr: 'parquet',
        floorTint: 0xe6d2b8,
        wallPbr: 'plaster',
        wallTint: 0xf8f1e8,
        wainscotColor: 0xd8c8b4,
        crownColor: 0xd9a84e,
        ceilingStyle: 'coffered',
        sconceColor: 0xffe0ad,
      },
      {
        id: 'bath-201',
        name: 'Suite 201 — Marble Bath',
        shortLabel: 'BATH 201',
        floor: 1,
        minX: -22,
        maxX: -15,
        minZ: -10,
        maxZ: -4,
        height: 3.4,
        floorColorA: '#f2f0ec',
        floorColorB: '#e4e1db',
        floorMapTint: '#2b4752',
        wallColor: 0xf4f7f9,
        ceilingColor: 0xf5f7fa,
        lightColor: 0xfff6ea,
        lightIntensity: 1.45,
        ambientIntensity: 0.92,
        floorRoughness: 0.18,
        floorPbr: 'marble',
        floorTint: 0xffffff,
        wallPbr: 'tile_white',
        wallTint: 0xf7fafc,
        crownColor: 0xd9a84e,
        ceilingStyle: 'coffered',
      },
      {
        id: 'suite-202',
        name: 'Suite 202 — Art Deco Deluxe',
        shortLabel: 'SUITE 202',
        floor: 1,
        minX: 12,
        maxX: 22,
        minZ: -4,
        maxZ: 6,
        height: 3.6,
        floorColorA: '#dfd4c4',
        floorColorB: '#d2c4b0',
        floorMapTint: '#2d3f4d',
        wallColor: 0xedf4f2,
        ceilingColor: 0xedf2f0,
        lightColor: 0xffe2ba,
        lightIntensity: 1.35,
        ambientIntensity: 0.88,
        floorRoughness: 0.45,
        floorPbr: 'parquet',
        floorTint: 0xdfc9ae,
        wallPbr: 'plaster',
        wallTint: 0xeef5f2,
        wainscotColor: 0x2c575c,
        crownColor: 0xd9a84e,
        ceilingStyle: 'coffered',
        sconceColor: 0xffe0ad,
      },
      {
        id: 'bath-202',
        name: 'Suite 202 — Marble Bath',
        shortLabel: 'BATH 202',
        floor: 1,
        minX: 15,
        maxX: 22,
        minZ: -10,
        maxZ: -4,
        height: 3.4,
        floorColorA: '#f2f0ec',
        floorColorB: '#e4e1db',
        floorMapTint: '#2b4752',
        wallColor: 0xf4f7f9,
        ceilingColor: 0xf5f7fa,
        lightColor: 0xfff6ea,
        lightIntensity: 1.45,
        ambientIntensity: 0.92,
        floorRoughness: 0.18,
        floorPbr: 'marble',
        floorTint: 0xffffff,
        wallPbr: 'tile_white',
        wallTint: 0xf7fafc,
        crownColor: 0xd9a84e,
        ceilingStyle: 'coffered',
      },

      // ── FLOOR 2 (3F: THE OCEAN PENTHOUSE — FOYER, GRAND SALON, MASTER & SPA BATH) ──
      {
        id: 'foyer-ph',
        name: '3F Penthouse Elevator Foyer',
        shortLabel: 'PH FOYER',
        floor: 2,
        minX: -5,
        maxX: 5,
        minZ: 4,
        maxZ: 10,
        height: 4.2,
        floorColorA: '#f5efe4',
        floorColorB: '#dfd3c0',
        floorMapTint: '#3e334a',
        wallColor: 0xf6ece2,
        ceilingColor: 0x241d2a,
        lightColor: 0xffdfb4,
        lightIntensity: 1.35,
        ambientIntensity: 0.85,
        floorRoughness: 0.2,
        floorPbr: 'marble',
        floorTint: 0xfff8ef,
        wallPbr: 'plaster',
        wallTint: 0xf7eee5,
        wainscotColor: 0x3b2418,
        crownColor: 0xe6bd68,
        ceilingStyle: 'coffered',
        sconceColor: 0xffd28a,
      },
      {
        id: 'ph-salon',
        name: '3F Penthouse Salon & Wet Bar',
        shortLabel: 'PH SALON',
        floor: 2,
        minX: -12,
        maxX: 12,
        minZ: -8,
        maxZ: 4,
        height: 4.8,
        floorColorA: '#ebe2d4',
        floorColorB: '#ddd1be',
        floorMapTint: '#44354c',
        wallColor: 0xf7f0e8,
        ceilingColor: 0x261f2e,
        lightColor: 0xffd8a8,
        lightIntensity: 1.5,
        ambientIntensity: 0.9,
        floorRoughness: 0.28,
        floorPbr: 'marble',
        floorTint: 0xfff8ee,
        wallPbr: 'plaster',
        wallTint: 0xf8f1e8,
        wainscotColor: 0x382319,
        crownColor: 0xe6bd68,
        ceilingStyle: 'coffered',
        sconceColor: 0xffd596,
      },
      {
        id: 'ph-master',
        name: '3F Penthouse Master Bedroom',
        shortLabel: 'PH MASTER',
        floor: 2,
        minX: -22,
        maxX: -12,
        minZ: -8,
        maxZ: 4,
        height: 4.2,
        floorColorA: '#e4d6c2',
        floorColorB: '#d7c6ae',
        floorMapTint: '#3b3248',
        wallColor: 0xf5ece2,
        ceilingColor: 0xede5dc,
        lightColor: 0xffd9ad,
        lightIntensity: 1.4,
        ambientIntensity: 0.88,
        floorRoughness: 0.42,
        floorPbr: 'parquet',
        floorTint: 0xe8d4ba,
        wallPbr: 'plaster',
        wallTint: 0xf7efe6,
        wainscotColor: 0xd6c4ae,
        crownColor: 0xe6bd68,
        ceilingStyle: 'coffered',
        sconceColor: 0xffe0ad,
      },
      {
        id: 'ph-spa',
        name: '3F Penthouse Marble Spa',
        shortLabel: 'PH SPA',
        floor: 2,
        minX: -22,
        maxX: -12,
        minZ: 4,
        maxZ: 10,
        height: 3.6,
        floorColorA: '#f5f2ec',
        floorColorB: '#e6e1d8',
        floorMapTint: '#2b4a52',
        wallColor: 0xf5f8fa,
        ceilingColor: 0xf5f7fa,
        lightColor: 0xfff5e6,
        lightIntensity: 1.5,
        ambientIntensity: 0.92,
        floorRoughness: 0.16,
        floorPbr: 'marble',
        floorTint: 0xfffdf8,
        wallPbr: 'tile_white',
        wallTint: 0xf8fafc,
        crownColor: 0xe6bd68,
        ceilingStyle: 'coffered',
      },
    ],
    doorways: [
      // Floor 0: Grand Lobby <-> Ocean Cocktail Lounge (open brass hotel archway)
      { floor: 0, axis: 'x', coord: 10, min: 1.5, max: 6.5, height: 3.8, frameColor: 0xd9a84e },
      // Floor 1: 2F Corridor <-> Suite 201 & Suite 202 (fitted with real hinged keycard doors!), plus En-Suite Bath doors
      { floor: 1, axis: 'x', coord: -12, min: 0.75, max: 2.25, height: 2.6, frameColor: 0xd9a84e },
      { floor: 1, axis: 'x', coord: 12, min: 0.75, max: 2.25, height: 2.6, frameColor: 0xd9a84e },
      { floor: 1, axis: 'z', coord: -4, min: -19.8, max: -18.4, height: 2.5, frameColor: 0xd9a84e },
      { floor: 1, axis: 'z', coord: -4, min: 18.4, max: 19.8, height: 2.5, frameColor: 0xd9a84e },
      // Floor 2: Penthouse Foyer <-> Grand Salon (double doors), Master Bedroom & Marble Spa (hinged doors)
      { floor: 2, axis: 'z', coord: 4, min: -1.5, max: 1.5, height: 3.0, frameColor: 0xe6bd68 },
      { floor: 2, axis: 'x', coord: -12, min: -3.2, max: -1.6, height: 2.7, frameColor: 0xe6bd68 },
      { floor: 2, axis: 'z', coord: 4, min: -17.8, max: -16.2, height: 2.6, frameColor: 0xe6bd68 },
    ],
    windows: [
      // Floor 0 (1F Grand Marble Lobby & Ocean Cocktail Lounge): 1-to-1 matching exterior/interior windows!
      { floor: 0, axis: 'z', coord: 12, min: -8.3, max: -4.1, sillY: 0.85, topY: 3.85, frameColor: 0xd9a84e, cols: 3 },
      { floor: 0, axis: 'z', coord: 12, min: 4.1, max: 8.3, sillY: 0.85, topY: 3.85, frameColor: 0xd9a84e, cols: 3 },
      { floor: 0, axis: 'x', coord: -10, min: 5.2, max: 9.6, sillY: 0.95, topY: 3.85, frameColor: 0xd9a84e, cols: 3 },
      { floor: 0, axis: 'z', coord: -4, min: 4.2, max: 8.2, sillY: 0.95, topY: 3.85, frameColor: 0xd9a84e, cols: 3 },
      { floor: 0, axis: 'z', coord: 10, min: 13.8, max: 19.2, sillY: 0.95, topY: 3.55, frameColor: 0xd9a84e, cols: 3 },
      { floor: 0, axis: 'x', coord: 23, min: 7.3, max: 9.4, sillY: 0.95, topY: 3.55, frameColor: 0xd9a84e, cols: 2 },
      { floor: 0, axis: 'z', coord: -4, min: 11.8, max: 14.8, sillY: 0.95, topY: 3.55, frameColor: 0xd9a84e, cols: 2 },
      // Floor 1 (2F Guest Corridor + Suite 201 + Bath 201 + Suite 202 + Bath 202): 1-to-1 matching front, side & rear windows!
      { floor: 1, axis: 'z', coord: 5, min: -6.6, max: -4.6, sillY: 0.95, topY: 2.85, frameColor: 0xd9a84e, cols: 2 },
      { floor: 1, axis: 'z', coord: 5, min: 4.6, max: 6.6, sillY: 0.95, topY: 2.85, frameColor: 0xd9a84e, cols: 2 },
      { floor: 1, axis: 'z', coord: 6, min: -20.8, max: -17.2, sillY: 0.8, topY: 2.95, frameColor: 0xd9a84e, cols: 3 },
      { floor: 1, axis: 'x', coord: -22, min: 2.2, max: 4.8, sillY: 0.85, topY: 2.95, frameColor: 0xd9a84e, cols: 2 },
      { floor: 1, axis: 'z', coord: -4, min: -14.6, max: -12.5, sillY: 0.85, topY: 2.95, frameColor: 0xd9a84e, cols: 2 },
      {
        floor: 1,
        axis: 'z',
        coord: -10,
        min: -21.0,
        max: -18.4,
        sillY: 1.2,
        topY: 2.75,
        frameColor: 0xd9a84e,
        cols: 2,
        exteriorTintColor: 0x263844,
        exteriorOpacity: 0.5,
      },
      { floor: 1, axis: 'z', coord: 6, min: 17.2, max: 20.8, sillY: 0.8, topY: 2.95, frameColor: 0xd9a84e, cols: 3 },
      { floor: 1, axis: 'x', coord: 22, min: 2.2, max: 4.8, sillY: 0.85, topY: 2.95, frameColor: 0xd9a84e, cols: 2 },
      { floor: 1, axis: 'z', coord: -4, min: 12.5, max: 14.6, sillY: 0.85, topY: 2.95, frameColor: 0xd9a84e, cols: 2 },
      {
        floor: 1,
        axis: 'z',
        coord: -10,
        min: 18.4,
        max: 21.0,
        sillY: 1.2,
        topY: 2.75,
        frameColor: 0xd9a84e,
        cols: 2,
        exteriorTintColor: 0x263844,
        exteriorOpacity: 0.5,
      },
      // Floor 2 (3F The Ocean Penthouse): 1-to-1 matching front, side & rear panoramic glass walls!
      { floor: 2, axis: 'z', coord: 10, min: -4.2, max: -1.8, sillY: 0.65, topY: 3.4, frameColor: 0xe6bd68, cols: 2 },
      { floor: 2, axis: 'z', coord: 10, min: 1.8, max: 4.2, sillY: 0.65, topY: 3.4, frameColor: 0xe6bd68, cols: 2 },
      { floor: 2, axis: 'x', coord: 5, min: 5.4, max: 8.6, sillY: 0.65, topY: 3.4, frameColor: 0xe6bd68, cols: 2 },
      { floor: 2, axis: 'z', coord: -8, min: -10.5, max: 10.5, sillY: 0.35, topY: 4.15, frameColor: 0x1a1e2a, cols: 6 },
      { floor: 2, axis: 'z', coord: 4, min: -10.6, max: -5.6, sillY: 0.45, topY: 4.0, frameColor: 0xe6bd68, cols: 3 },
      { floor: 2, axis: 'z', coord: 4, min: 5.6, max: 10.6, sillY: 0.45, topY: 4.0, frameColor: 0xe6bd68, cols: 3 },
      { floor: 2, axis: 'z', coord: -8, min: -20.8, max: -13.6, sillY: 0.35, topY: 3.65, frameColor: 0x1a1e2a, cols: 4 },
      { floor: 2, axis: 'x', coord: -22, min: -6.6, max: -3.6, sillY: 0.55, topY: 3.55, frameColor: 0xe6bd68, cols: 2 },
      {
        floor: 2,
        axis: 'z',
        coord: 10,
        min: -21.0,
        max: -17.2,
        sillY: 0.85,
        topY: 3.1,
        frameColor: 0xe6bd68,
        cols: 3,
        exteriorTintColor: 0x263844,
        exteriorOpacity: 0.46,
      },
    ],
    doors: [
      {
        id: 'door-201',
        label: 'Suite 201 (Ocean Breeze King)',
        floor: 1,
        axis: 'x',
        coord: -12,
        min: 0.75,
        max: 2.25,
        height: 2.6,
        swingDir: 1,
        requiredKeycard: 'hotel-suite-201',
        readerSide: 1,
        lockedToast: 'Suite 201 is locked — check in with Concierge Elena at the 1F Front Desk ($150) for your keycard!',
      },
      {
        id: 'door-bath-201',
        label: 'Suite 201 Bathroom',
        floor: 1,
        axis: 'z',
        coord: -4,
        min: -19.8,
        max: -18.4,
        height: 2.5,
        swingDir: -1,
      },
      {
        id: 'door-202',
        label: 'Suite 202 (Occupied)',
        floor: 1,
        axis: 'x',
        coord: 12,
        min: 0.75,
        max: 2.25,
        height: 2.6,
        swingDir: -1,
        occupied: true,
        readerSide: -1,
        knockLines: [
          'Camila (from inside Suite 202): "Housekeeping? Could you come back in an hour, please?"',
          'Camila (from inside Suite 202): "Occupied! Please respect the Privacy sign."',
        ],
      },
      {
        id: 'door-bath-202',
        label: 'Suite 202 Bathroom',
        floor: 1,
        axis: 'z',
        coord: -4,
        min: 18.4,
        max: 19.8,
        height: 2.5,
        swingDir: -1,
      },
      {
        id: 'door-ph-entry',
        label: 'Ocean Penthouse Double Doors',
        floor: 2,
        axis: 'z',
        coord: 4,
        min: -1.5,
        max: 1.5,
        height: 3.0,
        swingDir: 1,
        doubleDoor: true,
        requiredKeycard: 'hotel-penthouse',
        readerSide: 1,
        lockedToast: 'Penthouse doors require a VIP Keycard — rent the 3F Penthouse with Elena on 1F ($500)!',
      },
      {
        id: 'door-ph-master',
        label: 'Penthouse Master Bedroom',
        floor: 2,
        axis: 'x',
        coord: -12,
        min: -3.2,
        max: -1.6,
        height: 2.7,
        swingDir: 1,
      },
      {
        id: 'door-ph-spa',
        label: 'Penthouse Marble Spa',
        floor: 2,
        axis: 'z',
        coord: 4,
        min: -17.8,
        max: -16.2,
        height: 2.6,
        swingDir: 1,
      },
    ],
    colliders: [
      // Floor 0: 1F Grand Lobby 4 Art Deco Marble Columns (radius 0.36m)
      { floor: 0, minX: -9.56, maxX: -8.84, minZ: -3.56, maxZ: -2.84, minY: 0, maxY: 5.8 },
      { floor: 0, minX: 8.84, maxX: 9.56, minZ: -3.56, maxZ: -2.84, minY: 0, maxY: 5.8 },
      { floor: 0, minX: -9.56, maxX: -8.84, minZ: 10.84, maxZ: 11.56, minY: 0, maxY: 5.8 },
      { floor: 0, minX: 8.84, maxX: 9.56, minZ: 10.84, maxZ: 11.56, minY: 0, maxY: 5.8 },
      // Floor 0: Ocean Cocktail Lounge mahogany bar counter (exact mesh bounds: 1.8x9.2 centered at 19.8, 2.8)
      { floor: 0, minX: 18.9, maxX: 20.7, minZ: -1.8, maxZ: 7.4, minY: 0, maxY: 1.2 },
      // Floor 1: Suite 201 & 202 glass shower curbs/enclosures (walk-in glass partition panels)
      { floor: 1, minX: -17.15, maxX: -17.0, minZ: -9.9, maxZ: -8.3, minY: 0, maxY: 2.4 },
      { floor: 1, minX: 17.0, maxX: 17.15, minZ: -9.9, maxZ: -8.3, minY: 0, maxY: 2.4 },
      // Floor 2: Penthouse Salon private wet bar counter (exact mesh bounds: 1.5x6.8 centered at 9.15, -2.0)
      { floor: 2, minX: 8.4, maxX: 9.9, minZ: -5.4, maxZ: 1.4, minY: 0, maxY: 1.2 },
      // Floor 2: Penthouse Spa glass rain shower partition
      { floor: 2, minX: -16.25, maxX: -16.1, minZ: 8.1, maxZ: 9.9, minY: 0, maxY: 2.4 },
    ],
    props: [
      // ── FLOOR 0: 1F GRAND MARBLE LOBBY ──
      { floor: 0, kind: 'hotel_elevator_doors', x: 0, z: -3.76, rotY: 0, scale: 1.0 },
      { floor: 0, kind: 'hotel_reception_desk', x: -6.2, z: -0.6, rotY: 0, scale: 1.04 },
      { floor: 0, kind: 'art_deco_fountain', x: 0, z: 4.2, scale: 1.0 },
      { floor: 0, kind: 'grand_piano', x: 6.4, z: -0.4, rotY: -Math.PI * 0.28, scale: 1.05 },
      { floor: 0, kind: 'chandelier', x: -4.2, y: 4.65, z: 4.6, scale: 1.65, hangFromCeiling: true },
      { floor: 0, kind: 'chandelier', x: 4.2, y: 4.65, z: 4.6, scale: 1.65, hangFromCeiling: true },
      { floor: 0, kind: 'sofa_luxury', x: -6.2, z: 8.2, rotY: Math.PI, scale: 1.05 },
      { floor: 0, kind: 'coffee_table', x: -6.2, z: 6.7, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 0, kind: 'lounge_chair', x: -4.1, z: 6.8, rotY: -Math.PI * 0.5, scale: 0.95 },
      { floor: 0, kind: 'sofa_luxury', x: 6.2, z: 8.2, rotY: Math.PI, scale: 1.05 },
      { floor: 0, kind: 'coffee_table', x: 6.2, z: 6.7, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 0, kind: 'armchair', x: 4.1, z: 6.8, rotY: Math.PI * 0.5, scale: 1.0 },
      { floor: 0, kind: 'grandfather_clock', x: -9.3, z: 3.2, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 0, kind: 'hotel_luggage_cart', x: -4.8, z: 10.2, rotY: 0.28, scale: 1.0 },
      { floor: 0, kind: 'hotel_luggage_cart', x: 4.8, z: 10.2, rotY: -0.32, scale: 1.0 },
      { floor: 0, kind: 'potted_plant_1', x: -3.4, z: 10.9, scale: 1.3 },
      { floor: 0, kind: 'potted_plant_1', x: 3.4, z: 10.9, scale: 1.3 },
      { floor: 0, kind: 'potted_plant_2', x: -2.2, z: -3.2, scale: 1.15 },
      { floor: 0, kind: 'potted_plant_2', x: 2.2, z: -3.2, scale: 1.15 },

      // ── FLOOR 0: 1F OCEAN COCKTAIL LOUNGE ──
      { floor: 0, kind: 'bar_stool', x: 18.1, z: -0.6, scale: 1.1 },
      { floor: 0, kind: 'bar_stool', x: 18.1, z: 1.4, scale: 1.1 },
      { floor: 0, kind: 'bar_stool', x: 18.1, z: 3.4, scale: 1.1 },
      { floor: 0, kind: 'bar_stool', x: 18.1, z: 5.4, scale: 1.1 },
      { floor: 0, kind: 'cocktail_bar_set', x: 19.7, y: 1.19, z: 0.6, scale: 1.15 },
      { floor: 0, kind: 'cocktail_bar_set', x: 19.7, y: 1.19, z: 4.4, rotY: 1.4, scale: 1.15 },
      { floor: 0, kind: 'neon_palm_sign', x: 16.5, y: 2.1, z: -3.86, rotY: 0, scale: 1.15 },
      { floor: 0, kind: 'cabinet', x: 22.3, z: 0.8, rotY: -Math.PI * 0.5, scale: 1.15 },
      { floor: 0, kind: 'cabinet', x: 22.3, z: 4.6, rotY: -Math.PI * 0.5, scale: 1.15 },
      { floor: 0, kind: 'wine_bottles', x: 22.3, y: 0.78, z: 0.2, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 0, kind: 'wine_bottles', x: 22.3, y: 0.78, z: 1.5, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 0, kind: 'wine_bottles', x: 22.3, y: 0.78, z: 4.0, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 0, kind: 'wine_bottles', x: 22.3, y: 0.78, z: 5.3, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 0, kind: 'wine_bottles', x: 19.7, y: 1.14, z: 2.2, rotY: Math.PI * 0.5, scale: 1.2 },
      { floor: 0, kind: 'sofa_luxury', x: 13.8, z: -2.6, rotY: 0, scale: 1.05 },
      { floor: 0, kind: 'coffee_table', x: 13.8, z: -1.1, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 0, kind: 'sofa_luxury', x: 13.8, z: 8.6, rotY: Math.PI, scale: 1.05 },
      { floor: 0, kind: 'coffee_table', x: 13.8, z: 7.2, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 0, kind: 'potted_plant_1', x: 11.2, z: -2.8, scale: 1.15 },
      { floor: 0, kind: 'potted_plant_2', x: 11.2, z: 8.8, scale: 1.15 },
      { floor: 0, kind: 'pendant_lamp', x: 14.2, y: 4.6, z: 3.0, scale: 1.25, hangFromCeiling: true },
      { floor: 0, kind: 'pendant_lamp', x: 19.0, y: 4.6, z: 1.0, scale: 1.1, hangFromCeiling: true },
      { floor: 0, kind: 'pendant_lamp', x: 19.0, y: 4.6, z: 5.0, scale: 1.1, hangFromCeiling: true },

      // ── FLOOR 1: 2F GUEST CORRIDOR (HOUSEKEEPING CARTS, ROOM SERVICE, ICE MACHINE & LINENS) ──
      { floor: 1, kind: 'hotel_elevator_doors', x: 0, z: -1.76, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'hotel_ice_machine', x: -9.6, z: -1.62, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'hotel_housekeeping_cart', x: -5.8, z: -1.35, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'hotel_housekeeping_cart', x: 8.6, z: -1.35, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'hotel_room_service_cart', x: 5.2, z: 3.9, rotY: Math.PI, scale: 1.0 },
      { floor: 1, kind: 'console_table', x: 0, z: 4.42, rotY: Math.PI, scale: 1.1 },
      { floor: 1, kind: 'ornate_mirror', x: 0, y: 1.55, z: 4.86, rotY: Math.PI, scale: 1.5 },
      { floor: 1, kind: 'potted_plant_1', x: -2.2, z: -1.2, scale: 1.1 },
      { floor: 1, kind: 'potted_plant_1', x: 2.2, z: -1.2, scale: 1.1 },
      { floor: 1, kind: 'potted_plant_2', x: -11.2, z: -1.2, scale: 1.0 },
      { floor: 1, kind: 'potted_plant_2', x: 11.2, z: -1.2, scale: 1.0 },
      { floor: 1, kind: 'pendant_lamp', x: -6.2, y: 3.6, z: 1.5, scale: 1.0, hangFromCeiling: true },
      { floor: 1, kind: 'pendant_lamp', x: 0, y: 3.6, z: 1.5, scale: 1.05, hangFromCeiling: true },
      { floor: 1, kind: 'pendant_lamp', x: 6.2, y: 3.6, z: 1.5, scale: 1.0, hangFromCeiling: true },

      // ── FLOOR 1: SUITE 201 — OCEAN BREEZE KING & MARBLE BATH ──
      { floor: 1, kind: 'bed_suite', x: -20.5, z: 0.8, rotY: Math.PI * 0.5, scale: 1.25 },
      { floor: 1, kind: 'hotel_tv_minibar', x: -12.5, z: 4.1, rotY: -Math.PI * 0.5, scale: 1.0 },
      { floor: 1, kind: 'console_table', x: -15.4, z: 5.2, rotY: Math.PI, scale: 1.1 },
      { floor: 1, kind: 'dining_chair', x: -15.4, z: 4.1, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'ornate_mirror', x: -15.4, y: 1.55, z: 5.84, rotY: Math.PI, scale: 1.3 },
      { floor: 1, kind: 'lounge_chair', x: -19.8, z: 4.6, rotY: Math.PI * 0.25, scale: 0.95 },
      { floor: 1, kind: 'coffee_table', x: -18.4, z: 4.3, rotY: 0, scale: 0.9 },
      { floor: 1, kind: 'cabinet', x: -13.1, z: -2.2, rotY: -Math.PI * 0.5, scale: 0.95 },
      { floor: 1, kind: 'potted_plant_1', x: -21.0, z: -2.9, scale: 1.05 },
      { floor: 1, kind: 'chandelier', x: -17.0, y: 3.6, z: 1.0, scale: 0.9, hangFromCeiling: true },
      // Bath 201 (Soaking Tub + Double Vanity + Glass Rain Shower + Modern Toilet!)
      { floor: 1, kind: 'hotel_soaking_tub', x: -19.8, z: -8.6, rotY: 0, scale: 1.0 },
      { floor: 1, kind: 'hotel_vanity_sink', x: -15.45, z: -6.8, rotY: -Math.PI * 0.5, scale: 1.0 },
      { floor: 1, kind: 'hotel_toilet_bidet', x: -21.3, z: -5.3, rotY: Math.PI * 0.5, scale: 1.0 },

      // ── FLOOR 1: SUITE 202 — ART DECO DELUXE & MARBLE BATH ──
      { floor: 1, kind: 'bed_suite', x: 20.5, z: 0.8, rotY: -Math.PI * 0.5, scale: 1.25 },
      { floor: 1, kind: 'hotel_tv_minibar', x: 12.5, z: 4.1, rotY: Math.PI * 0.5, scale: 1.0 },
      { floor: 1, kind: 'bistro_table', x: 18.8, z: 4.4, scale: 0.82 },
      { floor: 1, kind: 'armchair', x: 17.0, z: 4.4, rotY: Math.PI * 0.5, scale: 0.95 },
      { floor: 1, kind: 'console_table', x: 14.8, z: 5.2, rotY: Math.PI, scale: 1.05 },
      { floor: 1, kind: 'ornate_mirror', x: 14.8, y: 1.55, z: 5.84, rotY: Math.PI, scale: 1.3 },
      { floor: 1, kind: 'cabinet', x: 13.1, z: -2.2, rotY: Math.PI * 0.5, scale: 0.95 },
      { floor: 1, kind: 'potted_plant_1', x: 21.0, z: -2.9, scale: 1.05 },
      { floor: 1, kind: 'chandelier', x: 17.0, y: 3.6, z: 1.0, scale: 0.9, hangFromCeiling: true },
      // Bath 202
      { floor: 1, kind: 'hotel_soaking_tub', x: 19.8, z: -8.6, rotY: Math.PI, scale: 1.0 },
      { floor: 1, kind: 'hotel_vanity_sink', x: 15.45, z: -6.8, rotY: Math.PI * 0.5, scale: 1.0 },
      { floor: 1, kind: 'hotel_toilet_bidet', x: 21.3, z: -5.3, rotY: -Math.PI * 0.5, scale: 1.0 },

      // ── FLOOR 2: 3F PENTHOUSE FOYER, GRAND SALON, MASTER & SPA ──
      { floor: 2, kind: 'hotel_elevator_doors', x: 0, z: 9.76, rotY: Math.PI, scale: 1.0 },
      { floor: 2, kind: 'console_table', x: -4.2, z: 7.2, rotY: Math.PI * 0.5, scale: 1.1 },
      { floor: 2, kind: 'ornate_mirror', x: -4.85, y: 1.6, z: 7.2, rotY: Math.PI * 0.5, scale: 1.5 },
      { floor: 2, kind: 'potted_plant_1', x: -3.6, z: 5.0, scale: 1.2 },
      { floor: 2, kind: 'potted_plant_1', x: 3.6, z: 5.0, scale: 1.2 },
      { floor: 2, kind: 'chandelier', x: 0, y: 4.2, z: 7.0, scale: 1.1, hangFromCeiling: true },
      // Penthouse Grand Salon & Private Wet Bar
      { floor: 2, kind: 'sofa_luxury', x: -3.6, z: -1.8, rotY: Math.PI * 0.5, scale: 1.15 },
      { floor: 2, kind: 'sofa_luxury', x: 3.6, z: -1.8, rotY: -Math.PI * 0.5, scale: 1.15 },
      { floor: 2, kind: 'coffee_table', x: 0, z: -1.8, rotY: 0, scale: 1.25 },
      { floor: 2, kind: 'armchair', x: 0, z: -4.8, rotY: 0, scale: 1.05 },
      { floor: 2, kind: 'hotel_room_service_cart', x: -6.4, z: -5.6, rotY: 0.45, scale: 1.05 },
      { floor: 2, kind: 'bar_stool', x: 7.6, z: -4.2, scale: 1.1 },
      { floor: 2, kind: 'bar_stool', x: 7.6, z: -2.0, scale: 1.1 },
      { floor: 2, kind: 'bar_stool', x: 7.6, z: 0.2, scale: 1.1 },
      { floor: 2, kind: 'cocktail_bar_set', x: 9.1, y: 1.19, z: -3.4, scale: 1.15 },
      { floor: 2, kind: 'wine_bottles', x: 9.1, y: 1.14, z: -1.2, rotY: Math.PI * 0.5, scale: 1.3 },
      { floor: 2, kind: 'cabinet', x: 11.4, z: -2.0, rotY: -Math.PI * 0.5, scale: 1.15 },
      { floor: 2, kind: 'wine_bottles', x: 11.4, y: 0.78, z: -2.6, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 2, kind: 'wine_bottles', x: 11.4, y: 0.78, z: -1.4, rotY: Math.PI * 0.5, scale: 1.35 },
      { floor: 2, kind: 'potted_plant_2', x: -10.6, z: -6.6, scale: 1.3 },
      { floor: 2, kind: 'potted_plant_2', x: -10.6, z: 2.6, scale: 1.2 },
      { floor: 2, kind: 'chandelier', x: -4.2, y: 4.8, z: -2.0, scale: 1.45, hangFromCeiling: true },
      { floor: 2, kind: 'chandelier', x: 4.2, y: 4.8, z: -2.0, scale: 1.45, hangFromCeiling: true },
      // Penthouse Master Bedroom
      { floor: 2, kind: 'bed_suite', x: -20.3, z: -1.8, rotY: Math.PI * 0.5, scale: 1.38 },
      { floor: 2, kind: 'hotel_tv_minibar', x: -12.5, z: -5.2, rotY: -Math.PI * 0.5, scale: 1.02 },
      { floor: 2, kind: 'lounge_chair', x: -16.8, z: -5.8, rotY: Math.PI * 0.2, scale: 1.05 },
      { floor: 2, kind: 'coffee_table', x: -15.3, z: -5.4, rotY: 0, scale: 0.95 },
      { floor: 2, kind: 'console_table', x: -13.1, z: 2.0, rotY: -Math.PI * 0.5, scale: 1.15 },
      { floor: 2, kind: 'ornate_mirror', x: -12.16, y: 1.6, z: 2.0, rotY: -Math.PI * 0.5, scale: 1.5 },
      { floor: 2, kind: 'cabinet', x: -21.2, z: 2.0, rotY: Math.PI * 0.5, scale: 1.05 },
      { floor: 2, kind: 'potted_plant_1', x: -20.8, z: -6.6, scale: 1.25 },
      { floor: 2, kind: 'chandelier', x: -17.0, y: 4.2, z: -1.8, scale: 1.2, hangFromCeiling: true },
      // Penthouse Marble Spa Bath
      { floor: 2, kind: 'hotel_soaking_tub', x: -19.2, z: 8.2, rotY: 0, scale: 1.12 },
      { floor: 2, kind: 'hotel_vanity_sink', x: -12.48, z: 7.0, rotY: -Math.PI * 0.5, scale: 1.08 },
      { floor: 2, kind: 'hotel_toilet_bidet', x: -21.2, z: 5.2, rotY: Math.PI * 0.5, scale: 1.05 },
      { floor: 2, kind: 'potted_plant_2', x: -13.2, z: 5.0, scale: 1.0 },
    ],
    npcs: [
      {
        id: 'solaire-concierge',
        name: 'Elena',
        role: 'Chief Concierge',
        floor: 0,
        uniform: 'concierge',
        x: -6.6,
        z: -2.2,
        yaw: Math.PI,
        variantIndex: 13,
        lines: [
          'Elena: "Welcome to Hotel Solaire! Your keycards are active — enjoy Suite 201 and the 3rd-Floor Ocean Penthouse."',
          'Elena: "Speak with Claire right beside me anytime you are ready for Express Check-Out."',
        ],
      },
      {
        id: 'solaire-clerk',
        name: 'Claire',
        role: 'Front Desk · Check-Out',
        floor: 0,
        uniform: 'concierge',
        x: -4.7,
        z: -2.2,
        yaw: Math.PI,
        variantIndex: 31,
        lines: [
          'Claire: "Welcome! Check in with Chief Concierge Elena beside me to book Suite 201 ($150) or the Penthouse ($500)."',
        ],
      },
      {
        id: 'solaire-bellhop',
        name: 'Marco',
        role: 'Bell Captain',
        floor: 0,
        uniform: 'bellhop',
        x: 3.3,
        z: 8.6,
        yaw: -Math.PI * 0.35,
        variantIndex: 22,
        lines: [
          'Marco: "Welcome to Hotel Solaire! Check in at the reception desk on your left to receive your brass keycard."',
          'Marco: "Our bellhops will bring your bags right up to Suite 201 as soon as you check in!"',
        ],
      },
      {
        id: 'solaire-bellhop-2',
        name: 'Leo',
        role: 'Bellhop',
        floor: 0,
        uniform: 'bellhop',
        x: -3.4,
        z: 8.8,
        yaw: 0,
        variantIndex: 15,
        patrol: [
          { x: -3.4, z: 8.8 },
          { x: -3.2, z: 2.2 },
          { x: -2.6, z: -1.4 },
          { x: -3.2, z: 2.2 },
        ],
        lines: [
          'Leo: "Delivering luggage up to the 2nd floor! Need help with your bags?"',
          'Leo: "Suite 201 is freshly turned down and ready whenever you check in with Elena."',
        ],
      },
      {
        id: 'solaire-security',
        name: 'Marcus',
        role: 'Hotel Security',
        floor: 0,
        uniform: 'security',
        x: 2.5,
        z: -2.0,
        yaw: Math.PI,
        variantIndex: 28,
        lines: [
          'Marcus: "Good evening. Floor 3 Penthouse is private VIP access only — keycard required in the elevator."',
          'Marcus: "All guest suites on Floor 2 are electronic keycard-locked for resident privacy."',
        ],
      },
      {
        id: 'solaire-bartender',
        name: 'Mateo',
        role: 'Master Mixologist',
        floor: 0,
        uniform: 'bartender',
        x: 21.4,
        z: 2.6,
        yaw: -Math.PI * 0.5,
        variantIndex: 18,
        actionCost: 20,
        actionToast: 'Mateo poured you a chilled Sol Coast Mojito at the Ocean Lounge (-$20)!',
        lines: ['Mateo: "House special mojito? Mint fresh from Palm Plaza."'],
      },
      {
        id: 'solaire-guest-2',
        name: 'Devon',
        role: 'Lounge Guest',
        floor: 0,
        x: 13.8,
        z: 0.4,
        yaw: Math.PI * 0.4,
        variantIndex: 32,
        lines: ['Devon: "Best cocktail lounge on Ocean Drive. Mateo never misses."'],
      },
      {
        id: 'solaire-housekeeper',
        name: 'Rosa',
        role: 'Senior Housekeeper',
        floor: 1,
        uniform: 'maid',
        x: -4.2,
        z: -0.4,
        yaw: Math.PI * 0.85,
        variantIndex: 39,
        lines: [
          'Rosa: "Just finished turning down Suite 201 with fresh linens and bath towels! Tap your keycard on the door lock."',
          'Rosa: "Suites 202 through 206 are occupied — please respect the Do Not Disturb signs."',
        ],
      },
      {
        id: 'solaire-maid-2',
        name: 'Lucia',
        role: 'Housekeeping Maid',
        floor: 1,
        uniform: 'maid',
        x: -8.6,
        z: 2.4,
        yaw: Math.PI * 0.5,
        variantIndex: 44,
        patrol: [
          { x: -8.6, z: 2.4 },
          { x: -2.0, z: 2.4 },
          { x: 6.4, z: 2.4 },
          { x: 9.4, z: 0.6 },
          { x: -2.0, z: 2.4 },
        ],
        lines: [
          'Lucia: "Restocking fresh towels and toiletries along Floor 2 — let us know if Suite 201 needs anything!"',
          'Lucia: "Extra bathrobes and minibar refills are on our housekeeping trolley anytime."',
        ],
      },
      {
        id: 'solaire-room-service',
        name: 'Javier',
        role: 'Room Service',
        floor: 1,
        uniform: 'waiter',
        x: 3.4,
        z: 0.8,
        yaw: Math.PI * 0.5,
        variantIndex: 20,
        actionCost: 30,
        actionToast: 'Javier served you a fresh Hotel Solaire Cuban Sandwich & Espresso from the silver cloche (-$30)!',
        patrol: [
          { x: 3.4, z: 0.8 },
          { x: 8.4, z: 0.8 },
          { x: 8.4, z: 3.2 },
          { x: 3.4, z: 3.2 },
        ],
        lines: ['Javier: "Room service! Hot silver-cloche lunch & champagne straight to your suite for $30."'],
      },
      {
        id: 'solaire-guest-1',
        name: 'Camila',
        role: 'Suite 202 Guest',
        floor: 1,
        x: 15.8,
        z: 2.2,
        yaw: -Math.PI * 0.35,
        variantIndex: 25,
        lines: ['Camila: "Love this Art Deco Deluxe suite! The freestanding soaking tub in the marble bath is heaven."'],
      },
      {
        id: 'solaire-ph-butler',
        name: 'Henri',
        role: 'Penthouse Butler',
        floor: 2,
        uniform: 'waiter',
        x: 10.6,
        z: -2.0,
        yaw: -Math.PI * 0.5,
        variantIndex: 47,
        actionCost: 45,
        actionToast: 'Butler Henri uncorked a chilled bottle of Vintage Rosé Champagne at the Penthouse Wet Bar (-$45)!',
        lines: ['Henri: "Good evening. Vintage champagne at your private Penthouse wet bar?"'],
      },
      {
        id: 'solaire-suite-vip',
        name: 'Valery',
        role: 'Penthouse Guest',
        floor: 2,
        x: 4.2,
        z: -4.8,
        yaw: -Math.PI * 0.35,
        variantIndex: 41,
        lines: [
          'Valery: "Look at that sunset over the Atlantic from the 3rd-floor Penthouse — worth every penny."',
          'Valery: "Butler Henri keeps the champagne chilled and the marble spa is right through the master suite."',
        ],
      },
    ],
  }),

  // ─── 2. CLUB NEON (NEON STRIP — 3-ROOM UNDERGROUND NIGHTCLUB) ────────────────
  // Bolted flush onto real Neon Club building b-89 (box x:-1.8..18.6, z:-60.8..-35.9)
  makeVenue({
    id: 'club-neon',
    name: 'Club Neon',
    districtLabel: 'Neon Strip',
    accentColor: 0x2cf3ff,
    entranceX: -4.3,
    entranceZ: -48.4,
    outdoorExitYaw: -Math.PI * 0.5,
    storefront: {
      wallX: -1.8,
      centerZ: -48.4,
      facingSignX: -1,
      signText: 'CLUB NEON',
      subtitle: 'LIVE DJ · DANCE HALL · VIP BAR',
      style: 'neon-club',
    },
    spawnX: 0,
    spawnZ: 16.4,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 18.2,
    rooms: [
      {
        id: 'foyer',
        name: 'Velvet Entry Tunnel',
        shortLabel: 'ENTRY',
        minX: -4,
        maxX: 4,
        minZ: 10,
        maxZ: 19,
        height: 3.6,
        floorColorA: '#130c22',
        floorColorB: '#1c1230',
        floorMapTint: '#2b1b42',
        wallColor: 0x160f28,
        ceilingColor: 0x0b0816,
        lightColor: 0xff2e93,
        lightIntensity: 1.2,
        ambientIntensity: 0.45,
        floorRoughness: 0.22,
        floorPbr: 'concrete',
        floorTint: 0x261d38,
        wallPbr: 'concrete',
        wallTint: 0x261a3d,
        crownColor: 0xff2e93,
        ceilingStyle: 'neon-cove',
        sconceColor: 0xff2e93,
      },
      {
        id: 'main-floor',
        name: 'Main Dance Hall & DJ Stage',
        shortLabel: 'DANCE HALL',
        minX: -12,
        maxX: 12,
        minZ: -12,
        maxZ: 10,
        height: 7.6,
        floorColorA: '#0f0c1d',
        floorColorB: '#17122b',
        floorMapTint: '#1f1938',
        wallColor: 0x100e1e,
        ceilingColor: 0x06060d,
        lightColor: 0x2cf3ff,
        lightIntensity: 1.4,
        ambientIntensity: 0.5,
        floorRoughness: 0.16,
        floorMetalness: 0.25,
        floorPbr: 'concrete',
        floorTint: 0x1d1a2e,
        wallPbr: 'concrete',
        wallTint: 0x1f1c33,
        crownColor: 0x2cf3ff,
        ceilingStyle: 'trusses',
        sconceColor: 0x2cf3ff,
      },
      {
        id: 'vip-bar',
        name: 'Neon VIP Lounge & Bar',
        shortLabel: 'VIP BAR',
        minX: -25,
        maxX: -12,
        minZ: -9,
        maxZ: 7,
        height: 4.4,
        floorColorA: '#190e26',
        floorColorB: '#221233',
        floorMapTint: '#361b47',
        wallColor: 0x1c102b,
        ceilingColor: 0x0e0817,
        lightColor: 0xff46b8,
        lightIntensity: 1.35,
        ambientIntensity: 0.55,
        floorRoughness: 0.2,
        floorPbr: 'parquet',
        floorTint: 0x452b4f,
        wallPbr: 'brick',
        wallTint: 0x3b224a,
        wainscotColor: 0x140c1f,
        crownColor: 0xff46b8,
        ceilingStyle: 'neon-cove',
        sconceColor: 0xff46b8,
      },
      {
        id: 'afterhours-lounge',
        name: 'After-Hours Bottle Lounge',
        shortLabel: 'VIP BOOTHS',
        minX: -25,
        maxX: -12,
        minZ: -21,
        maxZ: -9,
        height: 4.6,
        floorColorA: '#120d22',
        floorColorB: '#1c1432',
        floorMapTint: '#2b1a44',
        wallColor: 0x140e24,
        ceilingColor: 0x090714,
        lightColor: 0x2cf3ff,
        lightIntensity: 1.35,
        ambientIntensity: 0.52,
        floorRoughness: 0.18,
        floorMetalness: 0.2,
        floorPbr: 'concrete',
        floorTint: 0x221b38,
        wallPbr: 'concrete',
        wallTint: 0x221a3a,
        wainscotColor: 0x110b1c,
        crownColor: 0x2cf3ff,
        ceilingStyle: 'neon-cove',
        sconceColor: 0x2cf3ff,
      },
    ],
    doorways: [
      { axis: 'z', coord: 10, min: -2.4, max: 2.4, height: 3.1, frameColor: 0x221636, accentNeon: 0xff2e93 },
      { axis: 'x', coord: -12, min: -3.5, max: 2.5, height: 3.6, frameColor: 0x1a1430, accentNeon: 0x2cf3ff },
      { axis: 'z', coord: -9, min: -21.0, max: -17.0, height: 3.4, frameColor: 0x1a1430, accentNeon: 0x2cf3ff },
    ],
    windows: [
      // Classic dark-tinted nightclub windows (heavily smoked mirror-tinted outside @ 0.78, clear smoked view out from inside @ 0.26!)
      {
        axis: 'z',
        coord: 19,
        min: -3.5,
        max: -1.9,
        sillY: 0.85,
        topY: 2.95,
        frameColor: 0xff2e93,
        cols: 2,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'z',
        coord: 19,
        min: 1.9,
        max: 3.5,
        sillY: 0.85,
        topY: 2.95,
        frameColor: 0xff2e93,
        cols: 2,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      // Main Dance Hall front flanks facing Neon Strip
      {
        axis: 'z',
        coord: 10,
        min: -10.6,
        max: -5.4,
        sillY: 1.1,
        topY: 4.6,
        frameColor: 0x2cf3ff,
        cols: 3,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'z',
        coord: 10,
        min: 5.4,
        max: 10.6,
        sillY: 1.1,
        topY: 4.6,
        frameColor: 0xff2e93,
        cols: 3,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      // Main Dance Hall south wall facing South cross-street
      {
        axis: 'x',
        coord: 12,
        min: -4.6,
        max: 0.6,
        sillY: 1.15,
        topY: 4.6,
        frameColor: 0x2cf3ff,
        cols: 3,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'x',
        coord: 12,
        min: 2.2,
        max: 7.4,
        sillY: 1.15,
        topY: 4.6,
        frameColor: 0xff2e93,
        cols: 3,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      // Main Dance Hall rear windows flanking DJ Stage overlooking the Club Neon VIP Parking Lot!
      {
        axis: 'z',
        coord: -12,
        min: -10.8,
        max: -6.4,
        sillY: 1.1,
        topY: 4.8,
        frameColor: 0x2cf3ff,
        cols: 2,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'z',
        coord: -12,
        min: 6.4,
        max: 10.8,
        sillY: 1.1,
        topY: 4.8,
        frameColor: 0xff2e93,
        cols: 2,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      // VIP Bar front & north tinted windows
      {
        axis: 'z',
        coord: 7,
        min: -20.2,
        max: -14.6,
        sillY: 0.9,
        topY: 3.4,
        frameColor: 0x2cf3ff,
        cols: 3,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'x',
        coord: -25,
        min: 3.2,
        max: 6.0,
        sillY: 0.9,
        topY: 3.4,
        frameColor: 0xff2e93,
        cols: 2,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      // After-Hours Bottle Lounge panoramic tinted windows overlooking the VIP Parking Lot & North Valet Lot!
      {
        axis: 'z',
        coord: -21,
        min: -23.4,
        max: -13.6,
        sillY: 0.65,
        topY: 3.75,
        frameColor: 0x2cf3ff,
        cols: 5,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
      {
        axis: 'x',
        coord: -25,
        min: -19.2,
        max: -11.0,
        sillY: 0.75,
        topY: 3.75,
        frameColor: 0xff2e93,
        cols: 4,
        tintColor: 0x203052,
        opacity: 0.26,
        exteriorTintColor: 0x060a14,
        exteriorOpacity: 0.78,
      },
    ],
    colliders: [
      // Elevated DJ Stage (exact mesh bounds: 11.4x4.4 centered at 0, -9.2)
      { minX: -5.7, maxX: 5.7, minZ: -11.4, maxZ: -7.0, minY: 0, maxY: 3.0 },
      // VIP Lounge Neon Bar Counter (exact mesh bounds: 1.85x10.4 centered at -21.3, -1.0)
      { minX: -22.22, maxX: -20.38, minZ: -6.2, maxZ: 4.2, minY: 0, maxY: 1.2 },
    ],
    props: [
      // Foyer
      { kind: 'cabinet', x: 3.2, z: 13.3, rotY: -Math.PI * 0.5, scale: 1.15 },
      { kind: 'neon_palm_sign', x: -3.86, y: 1.6, z: 14.8, rotY: Math.PI * 0.5, scale: 1.05 },
      { kind: 'potted_plant_2', x: -3.1, z: 12.2, scale: 1.1 },
      // Main Dance Hall & DJ Stage — full custom Blender twin-turntable DJ rig facing +Z dance floor!
      { kind: 'dj_booth_rig', x: 0, y: 0.9, z: -7.8, rotY: 0, scale: 1.22 },
      { kind: 'stage_lights', x: -4.2, y: 0.9, z: -10.4, rotY: 0.25, scale: 0.9 },
      { kind: 'stage_lights', x: 4.2, y: 0.9, z: -10.4, rotY: -0.25, scale: 0.9 },
      { kind: 'sofa_club', x: 10.6, z: -3.2, rotY: -Math.PI * 0.5, scale: 1.3 },
      { kind: 'sofa_club', x: 10.6, z: 0.2, rotY: -Math.PI * 0.5, scale: 1.3 },
      { kind: 'sofa_club', x: 10.6, z: 3.6, rotY: -Math.PI * 0.5, scale: 1.3 },
      { kind: 'coffee_table', x: 9.2, z: -1.5, rotY: 0, scale: 1.15 },
      { kind: 'coffee_table', x: 9.2, z: 2.5, rotY: 0, scale: 1.15 },
      { kind: 'wine_bottles', x: 9.2, y: 0.44, z: -1.5, scale: 1.25 },
      { kind: 'wine_bottles', x: 9.2, y: 0.44, z: 2.5, scale: 1.25 },
      { kind: 'potted_plant_1', x: -10.6, z: 8.6, scale: 1.25 },
      { kind: 'potted_plant_1', x: 10.6, z: 8.6, scale: 1.25 },
      // VIP Lounge & Neon Bar
      { kind: 'bar_stool', x: -19.6, z: -4.2, scale: 1.1 },
      { kind: 'bar_stool', x: -19.6, z: -2.0, scale: 1.1 },
      { kind: 'bar_stool', x: -19.6, z: 0.2, scale: 1.1 },
      { kind: 'bar_stool', x: -19.6, z: 2.4, scale: 1.1 },
      { kind: 'cocktail_bar_set', x: -21.2, y: 1.19, z: -3.8, scale: 1.15 },
      { kind: 'cocktail_bar_set', x: -21.2, y: 1.19, z: 2.1, rotY: 2.0, scale: 1.15 },
      { kind: 'neon_palm_sign', x: -15.6, y: 2.1, z: -8.86, rotY: 0, scale: 1.3 },
      { kind: 'metal_shelves', x: -24.3, z: -3.2, rotY: Math.PI * 0.5, scale: 1.0 },
      { kind: 'metal_shelves', x: -24.3, z: 1.2, rotY: Math.PI * 0.5, scale: 1.0 },
      { kind: 'wine_bottles', x: -21.2, y: 1.14, z: -2.5, rotY: Math.PI * 0.5, scale: 1.3 },
      { kind: 'wine_bottles', x: -21.2, y: 1.14, z: 0.8, rotY: Math.PI * 0.5, scale: 1.3 },
      { kind: 'sofa_club', x: -15.8, z: -7.4, rotY: 0, scale: 1.35 },
      { kind: 'coffee_table', x: -15.8, z: -5.8, rotY: Math.PI * 0.5, scale: 1.15 },
      { kind: 'wine_bottles', x: -15.8, y: 0.44, z: -5.8, scale: 1.2 },
      { kind: 'sofa_club', x: -15.8, z: 5.4, rotY: Math.PI, scale: 1.35 },
      { kind: 'coffee_table', x: -15.8, z: 4.0, rotY: Math.PI * 0.5, scale: 1.15 },
      { kind: 'armchair', x: -13.6, z: -6.0, rotY: -Math.PI * 0.4, scale: 1.0 },
      { kind: 'pendant_lamp', x: -16.2, y: 4.4, z: -1.0, scale: 1.2, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: -21.0, y: 4.4, z: -3.0, scale: 1.1, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: -21.0, y: 4.4, z: 1.5, scale: 1.1, hangFromCeiling: true },
      // After-Hours Bottle Lounge (overlooking the lit VIP Parking Lot!)
      { kind: 'sofa_club', x: -14.8, z: -18.2, rotY: -Math.PI * 0.5, scale: 1.35 },
      { kind: 'sofa_club', x: -14.8, z: -13.2, rotY: -Math.PI * 0.5, scale: 1.35 },
      { kind: 'coffee_table', x: -16.5, z: -15.8, rotY: 0, scale: 1.15 },
      { kind: 'wine_bottles', x: -16.5, y: 0.44, z: -15.8, scale: 1.3 },
      { kind: 'sofa_club', x: -22.2, z: -18.2, rotY: Math.PI * 0.5, scale: 1.35 },
      { kind: 'coffee_table', x: -20.5, z: -18.2, rotY: 0, scale: 1.05 },
      { kind: 'wine_bottles', x: -20.5, y: 0.44, z: -18.2, scale: 1.25 },
      { kind: 'armchair', x: -22.4, z: -13.2, rotY: Math.PI * 0.35, scale: 1.05 },
      { kind: 'potted_plant_1', x: -13.2, z: -20.0, scale: 1.25 },
      { kind: 'potted_plant_2', x: -23.8, z: -10.2, scale: 1.2 },
      { kind: 'pendant_lamp', x: -18.5, y: 4.6, z: -15.5, scale: 1.3, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: -15.5, y: 4.6, z: -18.0, scale: 1.15, hangFromCeiling: true },
    ],
    npcs: [
      {
        id: 'neon-bouncer',
        name: 'Dante',
        role: 'Club Host',
        x: -2.4,
        z: 14.2,
        yaw: Math.PI * 0.5,
        variantIndex: 10,
        lines: ['Dante: "Welcome to Club Neon — main dance floor straight ahead, VIP bottle lounge through the west portal."'],
      },
      {
        id: 'neon-dj',
        name: 'DJ Solis',
        role: 'Resident DJ',
        x: 0,
        z: -8.3,
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
        role: 'VIP Bartender',
        x: -22.9,
        z: -0.9,
        yaw: Math.PI * 0.5,
        variantIndex: 29,
        actionCost: 25,
        actionToast: 'Rico slid you an Electric Neon Spritz in the VIP Bar (-$25)!',
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
        id: 'neon-vip-1',
        name: 'Marcus',
        role: 'VIP Regular',
        x: -15.4,
        z: -3.2,
        yaw: -Math.PI * 0.4,
        variantIndex: 46,
        lines: ['Marcus: "Big drift meet happening over by Sol Coast Arena later tonight."'],
      },
      {
        id: 'neon-vip-2',
        name: 'Sienna',
        role: 'Bottle Service Host',
        x: -18.5,
        z: -14.2,
        yaw: Math.PI * 0.2,
        variantIndex: 35,
        actionCost: 40,
        actionToast: 'Sienna brought a sparkler-lit Rosé Magnum to your After-Hours VIP Booth (-$40)!',
        lines: [
          'Sienna: "Welcome to the After-Hours Lounge — best view of the supercars out in the VIP parking lot!"',
          'Sienna: "Love these smoked privacy windows — we can watch the whole Neon Strip from inside."',
        ],
      },
    ],
  }),

  // ─── 3. CAFÉ HABANA (CORAL HEIGHTS — 3-ROOM CUBAN CAFÉ & ROASTERY) ──────────
  // Bolted flush onto real Mediterranean building b-30 (box x:-272.9..-250.4, z:-4.0..20.8)
  makeVenue({
    id: 'cafe-habana',
    name: 'Café Habana',
    districtLabel: 'Coral Heights',
    accentColor: 0xffb347,
    entranceX: -275.4,
    entranceZ: 8.4,
    outdoorExitYaw: -Math.PI * 0.5,
    storefront: {
      wallX: -272.9,
      centerZ: 8.4,
      facingSignX: -1,
      signText: 'CAFÉ HABANA',
      subtitle: 'CAFECITO · BAKERY · ROASTERY',
      style: 'cuban-cafe',
    },
    spawnX: 0,
    spawnZ: 8.8,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 10.3,
    rooms: [
      {
        id: 'bakery',
        name: 'Espresso Bar & Bakery',
        shortLabel: 'ESPRESSO BAR',
        minX: -8,
        maxX: 8,
        minZ: 0,
        maxZ: 11,
        height: 4.4,
        floorColorA: '#c9744d',
        floorColorB: '#b8633e',
        floorMapTint: '#4f3529',
        wallColor: 0xf7e3c8,
        ceilingColor: 0x5c3c28,
        lightColor: 0xffd296,
        lightIntensity: 1.4,
        ambientIntensity: 0.9,
        floorRoughness: 0.52,
        floorPbr: 'terracotta',
        floorTint: 0xffe8d6,
        wallPbr: 'plaster',
        wallTint: 0xf7e1c2,
        wainscotColor: 0x59341f,
        crownColor: 0x4a2a18,
        ceilingStyle: 'rafters',
        sconceColor: 0xffcf88,
      },
      {
        id: 'conservatory',
        name: 'Palm Conservatory Dining',
        shortLabel: 'DINING ROOM',
        minX: 8,
        maxX: 22,
        minZ: -2,
        maxZ: 11,
        height: 4.8,
        floorColorA: '#e8d9be',
        floorColorB: '#3c7a7a',
        floorMapTint: '#2b4744',
        wallColor: 0xf9ebd4,
        ceilingColor: 0xdff2fa,
        lightColor: 0xfff0cc,
        lightIntensity: 1.5,
        ambientIntensity: 0.95,
        floorRoughness: 0.45,
        floorPbr: 'terracotta',
        floorTint: 0xf2f0e6,
        wallPbr: 'brick',
        wallTint: 0xf0d5be,
        wainscotColor: 0x356968,
        crownColor: 0x59341f,
        ceilingStyle: 'skylight',
        sconceColor: 0xffe4ad,
      },
      {
        id: 'roastery',
        name: 'Coffee Roastery & Kitchen',
        shortLabel: 'KITCHEN',
        minX: -8,
        maxX: 8,
        minZ: -10,
        maxZ: 0,
        height: 3.8,
        floorColorA: '#3d4550',
        floorColorB: '#4c5664',
        floorMapTint: '#2f3742',
        wallColor: 0xedf1f5,
        ceilingColor: 0x303640,
        lightColor: 0xfff5e4,
        lightIntensity: 1.35,
        ambientIntensity: 0.85,
        floorRoughness: 0.4,
        floorPbr: 'concrete',
        floorTint: 0x7b838f,
        wallPbr: 'tile_white',
        wallTint: 0xf5f8fc,
        crownColor: 0x4a525e,
        ceilingStyle: 'gallery-track',
      },
    ],
    doorways: [
      { axis: 'x', coord: 8, min: 3.0, max: 8.0, height: 3.6, frameColor: 0x6b4128 },
      { axis: 'z', coord: 0, min: 2.0, max: 6.2, height: 3.2, frameColor: 0x6b4128 },
    ],
    windows: [
      { axis: 'z', coord: 11, min: -6.6, max: -3.0, sillY: 0.85, topY: 3.3, frameColor: 0x59341f, cols: 3 },
      { axis: 'z', coord: 11, min: 3.0, max: 6.6, sillY: 0.85, topY: 3.3, frameColor: 0x59341f, cols: 3 },
      { axis: 'x', coord: -8, min: 6.4, max: 9.6, sillY: 0.9, topY: 3.3, frameColor: 0x59341f, cols: 2 },
      { axis: 'z', coord: 11, min: 11.4, max: 18.6, sillY: 0.8, topY: 3.6, frameColor: 0x59341f, cols: 5 },
      { axis: 'x', coord: 22, min: 0.4, max: 3.5, sillY: 0.8, topY: 3.6, frameColor: 0x59341f, cols: 2 },
      { axis: 'x', coord: 22, min: 6.1, max: 9.2, sillY: 0.8, topY: 3.6, frameColor: 0x59341f, cols: 2 },
      { axis: 'x', coord: -8, min: -5.2, max: -2.0, sillY: 1.05, topY: 3.05, frameColor: 0x4a525e, cols: 2 },
      { axis: 'x', coord: 8, min: -7.5, max: -3.5, sillY: 1.05, topY: 3.05, frameColor: 0x4a525e, cols: 3 },
    ],
    colliders: [
      // Espresso & pastry bar counter (exact mesh bounds: 5.4x2.0 centered at -4.1, 3.2)
      { minX: -6.8, maxX: -1.4, minZ: 2.2, maxZ: 4.2, minY: 0, maxY: 1.2 },
      // Kitchen stainless prep island (exact mesh bounds: 4.4x1.6 centered at -0.9, -5.3)
      { minX: -3.1, maxX: 1.3, minZ: -6.1, maxZ: -4.5, minY: 0, maxY: 1.1 },
    ],
    props: [
      // Espresso Bar & Bakery — custom Blender 3-group espresso machine & glass pastry vitrine facing customers (+Z)!
      { kind: 'espresso_machine', x: -5.2, y: 1.17, z: 3.2, rotY: 0, scale: 1.1 },
      { kind: 'pastry_display_case', x: 0.2, z: 3.0, rotY: 0, scale: 1.05 },
      { kind: 'coffee_cart', x: -5.6, z: 0.9, rotY: 0, scale: 0.92 },
      { kind: 'cake_display', x: -2.5, y: 1.17, z: 3.2, scale: 1.65 },
      { kind: 'bar_stool', x: -5.6, z: 4.9, scale: 1.05 },
      { kind: 'bar_stool', x: -4.1, z: 4.9, scale: 1.05 },
      { kind: 'bar_stool', x: -2.6, z: 4.9, scale: 1.05 },
      { kind: 'chalkboard', x: -6.4, z: 8.6, rotY: Math.PI * 0.3, scale: 1.05 },
      { kind: 'display_shelves', x: -7.5, z: 5.8, rotY: Math.PI * 0.5, scale: 1.15 },
      { kind: 'bistro_table', x: 4.3, z: 8.5, scale: 0.9 },
      { kind: 'dining_chair', x: 3.1, z: 8.5, rotY: Math.PI * 0.5, scale: 1.05 },
      { kind: 'dining_chair', x: 5.5, z: 8.5, rotY: -Math.PI * 0.5, scale: 1.05 },
      { kind: 'potted_plant_1', x: -2.4, z: 10.0, scale: 1.1 },
      { kind: 'pendant_lamp', x: -4.1, y: 4.4, z: 3.2, scale: 1.15, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 3.5, y: 4.4, z: 6.0, scale: 1.15, hangFromCeiling: true },
      // Palm Conservatory Dining (featuring a bubbling Spanish Courtyard Talavera Tile Fountain!)
      { kind: 'fountain_spanish_courtyard', x: 15.5, z: 4.7, scale: 0.72 },
      { kind: 'dining_table', x: 12.8, z: 1.6, rotY: 0, scale: 1.0 },
      { kind: 'dining_chair', x: 12.2, z: 0.3, rotY: 0, scale: 1.05 },
      { kind: 'dining_chair', x: 13.4, z: 0.3, rotY: 0, scale: 1.05 },
      { kind: 'dining_chair', x: 12.8, z: 2.9, rotY: Math.PI, scale: 1.05 },
      { kind: 'dining_table', x: 18.3, z: 1.6, rotY: 0, scale: 1.0 },
      { kind: 'dining_chair', x: 17.7, z: 0.3, rotY: 0, scale: 1.05 },
      { kind: 'dining_chair', x: 18.9, z: 2.9, rotY: Math.PI, scale: 1.05 },
      { kind: 'bistro_table', x: 12.8, z: 7.8, scale: 0.95 },
      { kind: 'dining_chair', x: 11.6, z: 7.8, rotY: Math.PI * 0.5, scale: 1.05 },
      { kind: 'bistro_table', x: 18.0, z: 7.8, scale: 0.95 },
      { kind: 'dining_chair', x: 19.2, z: 7.8, rotY: -Math.PI * 0.5, scale: 1.05 },
      { kind: 'potted_plant_1', x: 9.2, z: -0.9, scale: 1.35 },
      { kind: 'potted_plant_1', x: 20.9, z: -0.9, scale: 1.35 },
      { kind: 'potted_plant_1', x: 20.9, z: 9.8, scale: 1.3 },
      { kind: 'potted_plant_2', x: 15.6, z: -1.0, scale: 1.25 },
      { kind: 'potted_plant_2', x: 9.4, z: 9.8, scale: 1.2 },
      { kind: 'display_shelves', x: 21.4, z: 4.8, rotY: -Math.PI * 0.5, scale: 1.2 },
      { kind: 'pendant_lamp', x: 12.8, y: 4.8, z: 1.6, scale: 1.2, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 18.3, y: 4.8, z: 1.6, scale: 1.2, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 15.4, y: 4.8, z: 7.8, scale: 1.2, hangFromCeiling: true },
      // Roastery & Kitchen
      { kind: 'coffee_cart', x: -5.8, z: -7.8, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'metal_shelves', x: -1.2, z: -9.3, rotY: 0, scale: 1.0 },
      { kind: 'metal_shelves', x: 3.6, z: -9.3, rotY: 0, scale: 1.0 },
      { kind: 'cake_display', x: -0.9, y: 1.06, z: -5.3, scale: 1.7 },
      { kind: 'pendant_lamp', x: -0.9, y: 3.8, z: -5.3, scale: 1.05, hangFromCeiling: true },
    ],
    npcs: [
      {
        id: 'habana-barista',
        name: 'Sofia',
        role: 'Head Barista',
        x: -3.9,
        z: 1.5,
        yaw: Math.PI,
        variantIndex: 11,
        actionCost: 8,
        actionToast: 'Sofia brewed you a strong Coral Heights Cafecito (-$8)!',
        lines: ['Sofia: "Fresh cafecito at the bar — or step into the palm dining room and kitchen!"'],
      },
      {
        id: 'habana-local-1',
        name: 'Carlos',
        role: 'Neighborhood Regular',
        x: 15.4,
        z: 8.8,
        yaw: 0,
        variantIndex: 24,
        lines: ['Carlos: "Love sitting beside the tiled courtyard fountain here. Try Diego’s pastelitos in the back kitchen!"'],
      },
      {
        id: 'habana-local-2',
        name: 'Nadia',
        role: 'Local',
        x: 10.6,
        z: 5.0,
        yaw: Math.PI * 0.6,
        variantIndex: 37,
        lines: ['Nadia: "Nice shades. You driving that supercar parked out front?"'],
      },
      {
        id: 'habana-baker',
        name: 'Diego',
        role: 'Master Baker & Roaster',
        x: -0.9,
        z: -7.2,
        yaw: Math.PI,
        variantIndex: 19,
        actionCost: 12,
        actionToast: 'Diego handed you a warm box of Guava Pastelitos right from the oven (-$12)!',
        lines: ['Diego: "Small-batch Cuban roast every morning!"'],
      },
    ],
  }),

  // ─── 4. WYNWOOD ART GALLERY (WYNWOOD ARTS — 3-ROOM CONTEMPORARY MUSEUM) ─────
  // Bolted flush onto real mural warehouse b-43 (box x:-183.6..-159.6, z:-240.5..-216.3)
  makeVenue({
    id: 'wynwood-gallery',
    name: 'Wynwood Art Gallery',
    districtLabel: 'Wynwood Arts',
    accentColor: 0xffcf5c,
    entranceX: -186.1,
    entranceZ: -228.4,
    outdoorExitYaw: -Math.PI * 0.5,
    storefront: {
      wallX: -183.6,
      centerZ: -228.4,
      facingSignX: -1,
      signText: 'WYNWOOD GALLERY',
      subtitle: 'CONTEMPORARY · LIGHT LAB · STUDIO',
      style: 'modern-gallery',
    },
    spawnX: 0,
    spawnZ: 7.8,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 9.3,
    rooms: [
      {
        id: 'atrium',
        name: 'White-Cube Main Atrium',
        shortLabel: 'GALLERY',
        minX: -11,
        maxX: 11,
        minZ: -6,
        maxZ: 10,
        height: 6.2,
        floorColorA: '#e0e1e6',
        floorColorB: '#d5d6dc',
        floorMapTint: '#3e4454',
        wallColor: 0xf7f8fb,
        ceilingColor: 0x262a35,
        lightColor: 0xfffaf0,
        lightIntensity: 1.55,
        ambientIntensity: 0.95,
        floorRoughness: 0.32,
        floorPbr: 'concrete',
        floorTint: 0xd9dce3,
        wallPbr: 'plaster',
        wallTint: 0xfafbff,
        crownColor: 0x262a35,
        ceilingStyle: 'gallery-track',
      },
      {
        id: 'darkroom',
        name: 'Neon Light Installation Wing',
        shortLabel: 'LIGHT LAB',
        minX: -24,
        maxX: -11,
        minZ: -8,
        maxZ: 8,
        height: 5.4,
        floorColorA: '#080910',
        floorColorB: '#0c0e18',
        floorMapTint: '#16132b',
        wallColor: 0x090a10,
        ceilingColor: 0x05060a,
        lightColor: 0x2cf3ff,
        lightIntensity: 0.9,
        ambientIntensity: 0.35,
        floorRoughness: 0.1,
        floorMetalness: 0.35,
        floorPbr: 'concrete',
        floorTint: 0x161824,
        wallPbr: 'concrete',
        wallTint: 0x12141e,
        crownColor: 0x2cf3ff,
        ceilingStyle: 'trusses',
      },
      {
        id: 'studio',
        name: 'Artist Studio Loft',
        shortLabel: 'ART STUDIO',
        minX: -10,
        maxX: 10,
        minZ: -18,
        maxZ: -6,
        height: 5.0,
        floorColorA: '#7a593d',
        floorColorB: '#6d4e34',
        floorMapTint: '#47392e',
        wallColor: 0xa6634c,
        ceilingColor: 0x2a2422,
        lightColor: 0xffe4bc,
        lightIntensity: 1.4,
        ambientIntensity: 0.85,
        floorRoughness: 0.65,
        floorPbr: 'parquet',
        floorTint: 0xcfa782,
        wallPbr: 'brick',
        wallTint: 0xe6d4c8,
        crownColor: 0x2e221b,
        ceilingStyle: 'rafters',
        sconceColor: 0xffe0ad,
      },
    ],
    doorways: [
      { axis: 'x', coord: -11, min: -1.5, max: 3.5, height: 3.8, frameColor: 0x161822, accentNeon: 0x2cf3ff },
      { axis: 'z', coord: -6, min: -2.8, max: 2.8, height: 3.8, frameColor: 0x2b2e38 },
    ],
    windows: [
      { axis: 'z', coord: 10, min: -8.0, max: -2.8, sillY: 0.45, topY: 4.5, frameColor: 0x1b1e28, cols: 3 },
      { axis: 'z', coord: 10, min: 2.8, max: 8.0, sillY: 0.45, topY: 4.5, frameColor: 0x1b1e28, cols: 3 },
      { axis: 'x', coord: 11, min: 5.8, max: 8.8, sillY: 0.65, topY: 4.5, frameColor: 0x1b1e28, cols: 2 },
      { axis: 'x', coord: -10, min: -12.8, max: -8.8, sillY: 0.9, topY: 3.9, frameColor: 0x1b1e28, cols: 3 },
      { axis: 'x', coord: 10, min: -13.8, max: -9.2, sillY: 0.9, topY: 3.9, frameColor: 0x1b1e28, cols: 3 },
    ],
    colliders: [
      // Atrium central sculpture plinth (exact mesh bounds: 4.6x3.2 centered at 0, 1.1)
      { minX: -2.3, maxX: 2.3, minZ: -0.5, maxZ: 2.7, minY: 0, maxY: 2.4 },
      // Darkroom 4 glowing neon monolith columns (exact 0.45x0.45 columns)
      { minX: -15.05, maxX: -14.55, minZ: -4.85, maxZ: -4.35, minY: 0, maxY: 4.2 },
      { minX: -21.05, maxX: -20.55, minZ: -4.65, maxZ: -4.15, minY: 0, maxY: 4.2 },
      { minX: -15.05, maxX: -14.55, minZ: 4.35, maxZ: 4.85, minY: 0, maxY: 4.2 },
      { minX: -21.05, maxX: -20.55, minZ: 4.15, maxZ: 4.65, minY: 0, maxY: 4.2 },
      // Artist Studio Loft: oversized leaning WIP canvases along north brick wall
      { minX: -7.2, maxX: -4.4, minZ: -18.0, maxZ: -17.45, minY: 0, maxY: 2.2 },
      { minX: 1.2, maxX: 4.0, minZ: -18.0, maxZ: -17.45, minY: 0, maxY: 2.2 },
    ],
    props: [
      // Main White-Cube Atrium
      { kind: 'marble_bust', x: -1.1, y: 1.15, z: 1.1, rotY: 0.2, scale: 2.1 },
      { kind: 'bronze_shark', x: 1.1, y: 1.15, z: 1.1, rotY: -0.45, scale: 2.0 },
      { kind: 'gallery_bench', x: -6.2, z: 1.2, rotY: Math.PI * 0.5, scale: 1.3 },
      { kind: 'gallery_bench', x: 6.2, z: -1.2, rotY: -Math.PI * 0.5, scale: 1.3 },
      { kind: 'gallery_bench', x: 0, z: -3.4, rotY: 0, scale: 1.35 },
      { kind: 'console_table', x: 7.0, z: 5.6, rotY: 0, scale: 1.4 },
      { kind: 'potted_plant_1', x: -9.6, z: 8.6, scale: 1.35 },
      { kind: 'potted_plant_1', x: 9.6, z: 8.6, scale: 1.35 },
      { kind: 'pendant_lamp', x: -5.5, y: 6.2, z: 2.0, scale: 1.35, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 5.5, y: 6.2, z: 2.0, scale: 1.35, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 0, y: 6.2, z: 1.1, scale: 1.5, hangFromCeiling: true },
      // Darkroom Light Installation Wing — custom Blender kinetic chrome & neon light sculpture!
      { kind: 'neon_sculpture_arch', x: -17.5, z: 0, scale: 1.18 },
      { kind: 'gallery_bench', x: -17.5, z: 5.4, rotY: Math.PI, scale: 1.35 },
      { kind: 'gallery_bench', x: -17.5, z: -5.4, rotY: 0, scale: 1.35 },
      { kind: 'stage_lights', x: -21.5, y: 0, z: -5.5, rotY: Math.PI * 0.25, scale: 0.85 },
      // Artist Studio Loft — custom Blender hardwood A-frame easels with canvases & brushes!
      { kind: 'artist_easel', x: -0.6, z: -13.6, rotY: 0.25, scale: 1.15 },
      { kind: 'artist_easel', x: 2.4, z: -14.8, rotY: -0.35, scale: 1.15 },
      { kind: 'dining_table', x: -5.0, z: -12.6, rotY: 0, scale: 1.15 },
      { kind: 'spray_paint', x: -5.7, y: 1.0, z: -12.6, scale: 1.8 },
      { kind: 'spray_paint', x: -4.8, y: 1.0, z: -12.3, rotY: 1.1, scale: 1.7 },
      { kind: 'spray_paint', x: -4.2, y: 1.0, z: -12.9, rotY: 2.3, scale: 1.8 },
      { kind: 'bistro_table', x: -7.8, z: -8.6, scale: 0.9 },
      { kind: 'spray_paint', x: -7.8, y: 0.91, z: -8.6, scale: 1.8 },
      { kind: 'metal_shelves', x: -9.2, z: -14.8, rotY: Math.PI * 0.5, scale: 1.05 },
      { kind: 'metal_shelves', x: -1.8, z: -17.3, rotY: 0, scale: 1.05 },
      { kind: 'sofa_club', x: 6.6, z: -15.6, rotY: 0, scale: 1.3 },
      { kind: 'lounge_chair', x: 5.0, z: -13.0, rotY: Math.PI * 0.7, scale: 1.05 },
      { kind: 'coffee_table', x: 6.8, z: -13.6, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'boombox', x: 6.8, y: 0.44, z: -13.6, rotY: -0.4, scale: 1.15 },
      { kind: 'potted_plant_2', x: 8.6, z: -8.0, scale: 1.25 },
      { kind: 'pendant_lamp', x: -5.0, y: 5.0, z: -12.6, scale: 1.25, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 6.0, y: 5.0, z: -13.8, scale: 1.25, hangFromCeiling: true },
    ],
    npcs: [
      {
        id: 'wynwood-curator',
        name: 'André',
        role: 'Gallery Curator',
        x: 7.0,
        z: 7.2,
        yaw: 0,
        variantIndex: 16,
        lines: [
          'André: "Welcome to Wynwood Contemporary! Visit the Neon Light Lab on the west wing or our live Artist Studio to the north."',
          'André: "That bronze shark sculpture was cast right here on the Sol Coast waterfront."',
        ],
      },
      {
        id: 'wynwood-visitor-1',
        name: 'Liam',
        role: 'Art Collector',
        x: -4.4,
        z: 2.2,
        yaw: Math.PI * 0.4,
        variantIndex: 27,
        lines: ['Liam: "The palette on these Miami canvases is unreal."'],
      },
      {
        id: 'wynwood-visitor-2',
        name: 'Chloe',
        role: 'Photographer',
        x: -14.2,
        z: -3.2,
        yaw: -Math.PI * 0.4,
        variantIndex: 34,
        lines: ['Chloe: "The reflection of those neon monoliths off the obsidian floor is pure magic."'],
      },
      {
        id: 'wynwood-artist',
        name: 'Kira',
        role: 'Mural Artist',
        x: -2.2,
        z: -11.4,
        yaw: -Math.PI * 0.45,
        variantIndex: 43,
        lines: [
          'Kira: "Painting the next 40-foot mural for Wynwood right here in the studio loft!"',
          'Kira: "Grab a seat on the studio sofa anytime — the boombox is always spinning."',
        ],
      },
    ],
  }),
];

/** Returns the specific room the point (x, z) is inside on the given floor (or closest room on that floor). */
export function getInteriorRoomAt(def: InteriorDef, x: number, z: number, floor = 0): InteriorRoomDef {
  const candidates = def.rooms.filter((r) => (r.floor ?? 0) === floor);
  const pool = candidates.length > 0 ? candidates : def.rooms;
  for (const r of pool) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return r;
    }
  }
  let best = pool[0];
  let bestDist = Infinity;
  for (const r of pool) {
    const cx = clamp(x, r.minX, r.maxX);
    const cz = clamp(z, r.minZ, r.maxZ);
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
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
  floor = 0,
): InteriorNpcDef | null {
  let best: InteriorNpcDef | null = null;
  let bestDist = maxRange;
  for (const npc of def.npcs) {
    if ((npc.floor ?? 0) !== floor) continue;
    const d = distXZ(x, z, npc.x, npc.z);
    if (d <= bestDist) {
      bestDist = d;
      best = npc;
    }
  }
  return best;
}

function isPointInsideVenueFloor(
  def: InteriorDef,
  x: number,
  z: number,
  margin = 0.25,
  floor = 0,
): boolean {
  for (const r of def.rooms) {
    if ((r.floor ?? 0) !== floor) continue;
    if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) {
      return true;
    }
  }
  return false;
}

/**
 * Steps player walking, sprinting, jumping & solid multi-room wall/door/furniture/NPC collisions.
 */
export function stepPlayerInInterior(
  p: PlayerState,
  def: InteriorDef,
  input: FootMoveInput,
  dt: number,
  openDoorIds?: ReadonlySet<string>,
): void {
  const safeDt = clamp(dt, 0.001, 0.05);
  const camFwd = forwardFromYaw(input.cameraYaw);
  const camRight = rightFromYaw(input.cameraYaw);

  let moveX = camFwd.x * input.forward + camRight.x * input.right;
  let moveZ = camFwd.z * input.forward + camRight.z * input.right;
  const moveLen = Math.hypot(moveX, moveZ);

  const maxSpeed = input.sprint ? 7.6 : 4.6;
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

  // Tight realistic human torso radius (28cm -> 56cm wide) so furniture never feels like an invisible forcefield!
  const radius = 0.28;
  const floor = getFloorFromPlayerY(p.y, def);

  // 2 passes resolve tight corners cleanly across walls, built-ins, and all individual 3D prop OBBs on this floor
  for (let pass = 0; pass < 2; pass++) {
    for (const wall of def.walls) {
      if ((wall.floor ?? 0) !== floor) continue;
      const res = resolveCircleAABB(nextX, nextZ, radius, wall);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
      }
    }
    // Closed hinged room doors are 100% solid — players cannot walk into locked suites or penthouses!
    for (const door of def.doors ?? []) {
      if (door.floor !== floor) continue;
      if (openDoorIds?.has(door.id)) continue;
      const doorBox: AABB =
        door.axis === 'x'
          ? { minX: door.coord - 0.14, maxX: door.coord + 0.14, minZ: door.min, maxZ: door.max, minY: 0, maxY: door.height }
          : { minX: door.min, maxX: door.max, minZ: door.coord - 0.14, maxZ: door.coord + 0.14, minY: 0, maxY: door.height };
      const res = resolveCircleAABB(nextX, nextZ, radius, doorBox);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
      }
    }
    for (const box of def.colliders) {
      if ((box.floor ?? 0) !== floor) continue;
      const res = resolveCircleAABB(nextX, nextZ, radius, box);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
      }
    }
    for (const obb of def.propColliders) {
      if ((obb.floor ?? 0) !== floor) continue;
      const res = resolveCircleOBB(nextX, nextZ, radius, obb);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
      }
    }
  }

  // Solid indoor NPC bodies on this floor (tight natural 60cm personal space)
  const npcMinDist = 0.6;
  for (const npc of def.npcs) {
    if ((npc.floor ?? 0) !== floor) continue;
    const dx = nextX - npc.x;
    const dz = nextZ - npc.z;
    const d = Math.hypot(dx, dz);
    if (d < npcMinDist) {
      const nx = d > 0.001 ? dx / d : 0;
      const nz = d > 0.001 ? dz / d : 1;
      nextX = npc.x + nx * npcMinDist;
      nextZ = npc.z + nz * npcMinDist;
    }
  }

  // 4. Safety guard: never escape outside the union of room footprints on this floor
  if (!isPointInsideVenueFloor(def, nextX, nextZ, 0.1, floor)) {
    nextX = prevX;
    nextZ = prevZ;
  }

  p.x = nextX;
  p.z = nextZ;
  p.vx = (nextX - prevX) / safeDt;
  p.vz = (nextZ - prevZ) / safeDt;

  const floorY = INTERIOR_ORIGIN_Y + floor * FLOOR_STRIDE_Y;
  if (input.jump && p.grounded) {
    p.vy = 6.2;
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

// ─── PROCEDURAL TEXTURES FOR FLOORS, ARTWORK, SIGNS & PANORAMIC WINDOW ────────

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

function createSignTexture(title: string, subtitle: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);

  ctx.fillStyle = fg;
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 54);

  ctx.fillStyle = accent;
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText(subtitle, 256, 98);

  const tex = new THREE.CanvasTexture(c);
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

// ─── ARCHITECTURAL OUTDOOR STOREFRONT BUILDER (BOLTED TO REAL BUILDINGS!) ─────

interface OutdoorStorefrontHandle {
  group: THREE.Group;
  thresholdRing: THREE.Mesh;
  propMountSlots: { kind: InteriorPropKind; pos: THREE.Vector3; rotY: number; scale: number }[];
  phase: number;
}

function buildArchitecturalStorefront(def: InteriorDef, index: number): OutdoorStorefrontHandle {
  const sf = def.storefront;
  const gy = getGroundHeight(def.entranceX, def.entranceZ);
  const group = new THREE.Group();
  // Local +Z faces outward onto the sidewalk; local X runs along the building facade
  group.position.set(sf.wallX, gy, sf.centerZ);
  group.rotation.y = sf.facingSignX === 1 ? Math.PI * 0.5 : -Math.PI * 0.5;

  const propMountSlots: OutdoorStorefrontHandle['propMountSlots'] = [];

  const accentHex = `#${def.accentColor.toString(16).padStart(6, '0')}`;
  const signBg = sf.style === 'modern-gallery' ? '#14171f' : sf.style === 'cuban-cafe' ? '#4a2417' : '#120d1f';
  const signTex = createSignTexture(sf.signText, sf.subtitle, signBg, '#ffffff', accentHex);

  const frameColor =
    sf.style === 'art-deco-hotel'
      ? 0xd6a54b
      : sf.style === 'neon-club'
        ? 0x161422
        : sf.style === 'cuban-cafe'
          ? 0x5c341f
          : 0x1b1e28;
  const frameMat = new THREE.MeshStandardMaterial({
    color: frameColor,
    roughness: 0.28,
    metalness: sf.style === 'cuban-cafe' ? 0.15 : 0.72,
  });

  // Projecting 3D architectural entrance canopy + illuminated marquee sign mounted flush onto the real unified building front wall (z = 0.26)!
  const canopyW = sf.style === 'neon-club' ? 6.8 : sf.style === 'modern-gallery' ? 6.4 : 5.8;
  const canopyD = 1.72;
  const canopyY = 3.22;
  const canopySlab = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW, 0.22, canopyD),
    frameMat,
  );
  canopySlab.position.set(0, canopyY, 0.26 + canopyD * 0.5);
  const canopyGlow = new THREE.Mesh(
    new THREE.BoxGeometry(canopyW + 0.08, 0.07, canopyD + 0.06),
    new THREE.MeshBasicMaterial({ color: def.accentColor }),
  );
  canopyGlow.position.set(0, canopyY - 0.13, 0.26 + canopyD * 0.5);
  group.add(canopySlab, canopyGlow);

  const signW = sf.style === 'neon-club' ? 6.6 : sf.style === 'modern-gallery' ? 6.2 : 5.6;
  const signH = 1.15;
  const signY = canopyY + 0.72;
  const signZ = 0.26 + canopyD;
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(signW + 0.24, signH + 0.18, 0.22), frameMat);
  signBack.position.set(0, signY, signZ - 0.12);
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(signW, signH),
    new THREE.MeshBasicMaterial({ map: signTex }),
  );
  signMesh.position.set(0, signY, signZ + 0.01);
  group.add(signBack, signMesh);

  // Real Poly Haven 3D sidewalk accents framing each bespoke Blender showcase entrance!
  if (sf.style === 'art-deco-hotel') {
    propMountSlots.push(
      { kind: 'potted_plant_1', pos: new THREE.Vector3(-2.1, 0, 1.8), rotY: 0, scale: 1.35 },
      { kind: 'potted_plant_1', pos: new THREE.Vector3(2.1, 0, 1.8), rotY: 0.9, scale: 1.35 },
    );
  } else if (sf.style === 'neon-club') {
    propMountSlots.push(
      { kind: 'potted_plant_2', pos: new THREE.Vector3(-3.0, 0, 1.4), rotY: 0, scale: 1.2 },
      { kind: 'potted_plant_2', pos: new THREE.Vector3(3.0, 0, 1.4), rotY: 1.4, scale: 1.2 },
    );
  } else if (sf.style === 'cuban-cafe') {
    propMountSlots.push(
      { kind: 'chalkboard', pos: new THREE.Vector3(-2.2, 0, 1.7), rotY: 0.35, scale: 1.05 },
      { kind: 'potted_plant_1', pos: new THREE.Vector3(2.3, 0, 1.6), rotY: 0.4, scale: 1.25 },
      { kind: 'bistro_table', pos: new THREE.Vector3(4.8, 0, 1.8), rotY: 0, scale: 0.85 },
      { kind: 'dining_chair', pos: new THREE.Vector3(3.8, 0, 1.8), rotY: Math.PI * 0.5, scale: 1.0 },
      { kind: 'dining_chair', pos: new THREE.Vector3(5.8, 0, 1.8), rotY: -Math.PI * 0.5, scale: 1.0 },
      { kind: 'bistro_table', pos: new THREE.Vector3(-4.8, 0, 1.8), rotY: 0, scale: 0.85 },
      { kind: 'dining_chair', pos: new THREE.Vector3(-5.8, 0, 1.8), rotY: Math.PI * 0.5, scale: 1.0 },
    );
  } else {
    propMountSlots.push(
      { kind: 'potted_plant_1', pos: new THREE.Vector3(-3.2, 0, 1.6), rotY: 0, scale: 1.3 },
      { kind: 'potted_plant_1', pos: new THREE.Vector3(3.2, 0, 1.6), rotY: 1.1, scale: 1.3 },
    );
  }

  // Crisp glowing doorway threshold ring right in front of the double doors
  const thresholdRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.18, 28),
    new THREE.MeshBasicMaterial({
      color: def.accentColor,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  thresholdRing.rotation.x = -Math.PI * 0.5;
  thresholdRing.position.set(0, 0.06, 2.5);
  group.add(thresholdRing);

  return { group, thresholdRing, propMountSlots, phase: index * 1.3 };
}

// ─── MULTI-ROOM INTERIOR ARCHITECTURE BUILDER ─────────────────────────────────

interface BuiltNpcHandle {
  def: InteriorNpcDef;
  root: THREE.Group;
  rig: HumanRigController | null;
}

interface BuiltDoorHandle {
  def: InteriorDoorDef;
  pivotA: THREE.Group;
  pivotB?: THREE.Group;
  openProgress: number;
  readerLedMat?: THREE.MeshBasicMaterial;
}

interface PbrSurfaceBinding {
  mat: THREE.MeshStandardMaterial;
  key: InteriorTextureKey;
  repeatX: number;
  repeatY: number;
  tintHex: number;
}

interface RoomLightSpec {
  worldX: number;
  worldY: number;
  worldZ: number;
  color: number;
  intensity: number;
  distance: number;
  floor: number;
}

interface BuiltVenue {
  def: InteriorDef;
  group: THREE.Group;
  propsRoot: THREE.Group;
  pbrBindings: PbrSurfaceBinding[];
  fountainEffects: AnimatedFountainWater[];
  npcs: BuiltNpcHandle[];
  doors: BuiltDoorHandle[];
  roomLights: RoomLightSpec[];
  danceFloorMat?: THREE.MeshStandardMaterial;
  lasers?: THREE.Mesh[];
  monolithMats?: THREE.MeshStandardMaterial[];
  exitRing: THREE.Mesh;
  elevatorRings: THREE.Mesh[];
}

export interface InteriorSystemHandles {
  outdoorMarkersRoot: THREE.Group;
  attachGltfNpcs: (
    clonePedestrian: (variantIndex: number, uniform?: NpcUniformKind) => ClonedPerson | null,
  ) => void;
  attachGltfProps: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
  applyPbrTextures: (texMap: InteriorTextureMap) => void;
  setActiveInterior: (id: InteriorId | null) => void;
  update: (
    elapsed: number,
    dt: number,
    activeId: InteriorId | null,
    playerX: number,
    playerZ: number,
    playerY?: number,
    openDoorIds?: ReadonlySet<string>,
    ownedKeycards?: ReadonlySet<string>,
  ) => void;
}

function addAreaRug(
  group: THREE.Group,
  cx: number,
  cz: number,
  w: number,
  d: number,
  mainHex: number,
  borderHex: number,
  baseY = 0,
): void {
  const outerGeo = new THREE.PlaneGeometry(w, d);
  outerGeo.rotateX(-Math.PI * 0.5);
  const outer = new THREE.Mesh(
    outerGeo,
    new THREE.MeshStandardMaterial({
      color: borderHex,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  outer.position.set(cx, baseY + 0.012, cz);

  const innerGeo = new THREE.PlaneGeometry(w - 0.34, d - 0.34);
  innerGeo.rotateX(-Math.PI * 0.5);
  const inner = new THREE.Mesh(
    innerGeo,
    new THREE.MeshStandardMaterial({
      color: mainHex,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  inner.position.set(cx, baseY + 0.024, cz);
  group.add(outer, inner);
}

function addRoomNumberPlaque(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  rotY: number,
  roomNum: string,
  subtitle = 'SUITE',
): void {
  const tex = createSignTexture(roomNum, subtitle, '#1d1410', '#ffe6a8', '#d9a84e');
  const plaqueGroup = new THREE.Group();
  plaqueGroup.position.set(x, y, z);
  plaqueGroup.rotation.y = rotY;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.3, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xd9a84e, metalness: 0.88, roughness: 0.22 }),
  );
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.24),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  face.position.z = 0.025;
  plaqueGroup.add(back, face);
  group.add(plaqueGroup);
}

function addClosedHotelDoor(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  rotY: number,
  roomNum: string,
): void {
  const doorGroup = new THREE.Group();
  doorGroup.position.set(x, baseY, z);
  doorGroup.rotation.y = rotY;
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x452617, roughness: 0.44, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xd9a84e, metalness: 0.88, roughness: 0.22 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 2.48, 0.1), trimMat);
  frame.position.set(0, 1.24, 0.05);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.18, 2.38, 0.08), woodMat);
  slab.position.set(0, 1.19, 0.09);
  const panelTop = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.9, 0.03), trimMat);
  panelTop.position.set(0, 1.72, 0.13);
  const panelBot = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.8, 0.03), trimMat);
  panelBot.position.set(0, 0.68, 0.13);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), trimMat);
  knob.position.set(0.42, 1.05, 0.18);
  doorGroup.add(frame, slab, panelTop, panelBot, knob);
  group.add(doorGroup);
  addRoomNumberPlaque(group, x, baseY + 1.88, z + (Math.cos(rotY) >= 0 ? 0.15 : -0.15), rotY, roomNum, 'DO NOT DISTURB');
}

function addGlassShower(
  group: THREE.Group,
  x: number,
  baseY: number,
  z: number,
  w: number,
  d: number,
  glassSide: 'west' | 'east',
): void {
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdaf6ff,
    roughness: 0.06,
    metalness: 0.05,
    transparent: true,
    opacity: 0.34,
  });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8e0e8, metalness: 0.94, roughness: 0.16 });
  const marbleCurbMat = new THREE.MeshStandardMaterial({ color: 0xeee9e0, roughness: 0.2 });

  // Shower tray curb
  const tray = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), marbleCurbMat);
  tray.position.set(x, baseY + 0.045, z);
  group.add(tray);

  // Frameless tempered glass partition + chrome rail
  const gx = glassSide === 'west' ? x - w * 0.5 + 0.03 : x + w * 0.5 - 0.03;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.32, d), glassMat);
  panel.position.set(gx, baseY + 1.25, z);
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, d), chromeMat);
  topBar.position.set(gx, baseY + 2.41, z);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10), chromeMat);
  handle.position.set(gx, baseY + 1.15, z + d * 0.25);

  // Overhead rain shower pipe & wide square chrome rain head!
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 10), chromeMat);
  riser.position.set(x, baseY + 1.72, z - d * 0.42);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 10), chromeMat);
  arm.rotation.x = Math.PI * 0.5;
  arm.position.set(x, baseY + 2.42, z - d * 0.22);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.32), chromeMat);
  head.position.set(x, baseY + 2.38, z);

  group.add(panel, topBar, handle, riser, arm, head);
}

function buildVenueGeometry(def: InteriorDef): BuiltVenue {
  const group = new THREE.Group();
  // Anchor the unified building permanently at its real 3D world position & keep it visible at all times
  // so every window inside and outside is literally the exact same window at the exact same 3D coordinates!
  const anchor0 = getInteriorWorldAnchor(def, 0);
  group.position.set(anchor0.worldX, anchor0.worldY, anchor0.worldZ);
  group.rotation.y = anchor0.worldRotY;
  group.visible = true;
  const pbrBindings: PbrSurfaceBinding[] = [];
  const roomLights: RoomLightSpec[] = [];
  const cosAnchor = Math.cos(anchor0.worldRotY);
  const sinAnchor = Math.sin(anchor0.worldRotY);

  const EXT_Z = -0.26;
  const getStoryExtH = (r: InteriorRoomDef): number =>
    def.id === 'hotel-solaire' ? REAL_STORY_HEIGHT : r.height;

  const getRoomExteriorConfig = (
    r: InteriorRoomDef,
  ): { pbr: InteriorTextureKey; tint: number; trimHex: number; plinthHex: number } => {
    if (def.id === 'hotel-solaire') {
      return { pbr: 'plaster', tint: 0xfbf0e4, trimHex: 0xf59eb2, plinthHex: 0xd9a84e };
    }
    if (def.id === 'club-neon') {
      return { pbr: 'concrete', tint: 0x151224, trimHex: 0x2cf3ff, plinthHex: 0x0b0914 };
    }
    if (def.id === 'cafe-habana') {
      return { pbr: 'plaster', tint: 0xf3d7b4, trimHex: 0xb5482c, plinthHex: 0x59341f };
    }
    if (r.id === 'darkroom') {
      return { pbr: 'concrete', tint: 0x161924, trimHex: 0x2cf3ff, plinthHex: 0x0d0f17 };
    }
    if (r.id === 'studio') {
      return { pbr: 'brick', tint: 0xb86b52, trimHex: 0x262a35, plinthHex: 0x1c1f28 };
    }
    return { pbr: 'plaster', tint: 0xf0f2f7, trimHex: 0x1b1e28, plinthHex: 0x262a35 };
  };

  const extStoneMat = new THREE.MeshStandardMaterial({
    color:
      def.id === 'hotel-solaire'
        ? 0xf4e6d8
        : def.id === 'club-neon'
          ? 0x12101e
          : def.id === 'cafe-habana'
            ? 0xc25435
            : 0x262a35,
    roughness: 0.58,
    metalness: 0.14,
  });

  // 1. Build every individual room's PBR floor, architectural ceiling structure, exterior roof/terrace slabs & lighting!
  for (const room of def.rooms) {
    const rFloor = room.floor ?? 0;
    const baseY = getVisualFloorBaseY(rFloor);
    const storyExtH = getStoryExtH(room);
    const rw = room.maxX - room.minX;
    const rd = room.maxZ - room.minZ;
    const cx = (room.minX + room.maxX) * 0.5;
    const cz = (room.minZ + room.maxZ) * 0.5;

    const floorTex = createFloorTileTexture(room.floorColorA, room.floorColorB, 4);
    floorTex.repeat.set(Math.max(2, Math.round(rw / 3)), Math.max(2, Math.round(rd / 3)));

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: room.floorRoughness ?? 0.4,
      metalness: room.floorMetalness ?? 0.08,
    });
    pbrBindings.push({
      mat: floorMat,
      key: room.floorPbr,
      repeatX: Math.max(2, rw / 2.2),
      repeatY: Math.max(2, rd / 2.2),
      tintHex: room.floorTint ?? 0xffffff,
    });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.12, rd), floorMat);
    floor.position.set(cx, baseY - 0.06, cz);
    group.add(floor);

    // Exterior foundation plinth / inter-floor structural slab & upper roof / terrace deck slab
    const basePlinth = new THREE.Mesh(
      new THREE.BoxGeometry(rw + 0.56, 0.16, rd + 0.56),
      extStoneMat,
    );
    basePlinth.position.set(cx, baseY - 0.11, cz);
    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(rw + 0.62, 0.22, rd + 0.62),
      extStoneMat,
    );
    roofCap.position.set(cx, baseY + storyExtH + 0.11, cz);
    group.add(basePlinth, roofCap);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(rw, rd),
      new THREE.MeshStandardMaterial({ color: room.ceilingColor, roughness: 0.85, side: THREE.DoubleSide }),
    );
    ceil.rotation.x = Math.PI * 0.5;
    ceil.position.set(cx, baseY + room.height, cz);
    group.add(ceil);

    // Architectural Ceiling Structure tailored per room style!
    const beamMat = new THREE.MeshStandardMaterial({
      color: room.ceilingStyle === 'rafters' || room.ceilingStyle === 'skylight' ? 0x452817 : room.crownColor ?? 0x262934,
      roughness: room.ceilingStyle === 'trusses' || room.ceilingStyle === 'gallery-track' ? 0.35 : 0.65,
      metalness: room.ceilingStyle === 'trusses' || room.ceilingStyle === 'gallery-track' ? 0.65 : 0.1,
    });

    if (room.ceilingStyle === 'coffered') {
      // Art Deco coffered ceiling grid: primary girders slightly deeper than cross-beams (zero Z-fighting!)
      const stepsX = Math.max(2, Math.round(rw / 4.5));
      for (let i = 1; i < stepsX; i++) {
        const bx = room.minX + (i / stepsX) * rw;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, rd - 0.36), beamMat);
        beam.position.set(bx, baseY + room.height - 0.13, cz);
        group.add(beam);
      }
      const stepsZ = Math.max(2, Math.round(rd / 4.5));
      for (let j = 1; j < stepsZ; j++) {
        const bz = room.minZ + (j / stepsZ) * rd;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.36, 0.17, 0.26), beamMat);
        beam.position.set(cx, baseY + room.height - 0.105, bz);
        group.add(beam);
      }
    } else if (room.ceilingStyle === 'rafters' || room.ceilingStyle === 'skylight') {
      // Exposed timber ceiling rafters spanning cleanly inside crown molding
      const count = Math.max(3, Math.round(rd / 2.4));
      for (let i = 1; i < count; i++) {
        const bz = room.minZ + (i / count) * rd;
        const rafter = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.36, 0.22, 0.18), beamMat);
        rafter.position.set(cx, baseY + room.height - 0.14, bz);
        group.add(rafter);
      }
    } else if (room.ceilingStyle === 'trusses') {
      // Exposed industrial black steel ceiling trusses
      for (let bz = room.minZ + 3.2; bz < room.maxZ - 2.0; bz += 4.5) {
        const truss = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.44, 0.34, 0.28), beamMat);
        truss.position.set(cx, baseY + room.height - 0.38, bz);
        group.add(truss);
      }
    } else if (room.ceilingStyle === 'gallery-track') {
      // Contemporary museum black track-lighting rails + glowing recessed cans
      const railMat = new THREE.MeshStandardMaterial({ color: 0x161820, metalness: 0.75, roughness: 0.3 });
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
      for (const offset of [-0.26, 0.26]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(rw - 2.4, 0.08, 0.1), railMat);
        rail.position.set(cx, baseY + room.height - 0.18, cz + rd * offset);
        group.add(rail);
        for (let sx = room.minX + 2.8; sx <= room.maxX - 2.8; sx += 3.2) {
          const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10), railMat);
          spot.position.set(sx, baseY + room.height - 0.31, cz + rd * offset);
          const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.068, 10), glowMat);
          bulb.rotation.x = Math.PI * 0.5;
          bulb.position.set(sx, baseY + room.height - 0.415, cz + rd * offset);
          group.add(spot, bulb);
        }
      }
    } else if (room.ceilingStyle === 'neon-cove') {
      // Glowing perimeter neon ceiling cove strips
      const coveMat = new THREE.MeshBasicMaterial({ color: room.crownColor ?? 0xff2e93 });
      const barN = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.6, 0.07, 0.08), coveMat);
      barN.position.set(cx, baseY + room.height - 0.24, room.minZ + 0.18);
      const barS = barN.clone();
      barS.position.z = room.maxZ - 0.18;
      group.add(barN, barS);
    }

    // Record room light coordinates for the shared 6-light interior pool (eliminates 38 global PointLights!)
    const spreadX = rw > rd ? rw * 0.24 : 0;
    const spreadZ = rd >= rw ? rd * 0.24 : 0;
    for (const sign of [-1, 1]) {
      const lx = cx + sign * spreadX;
      const ly = baseY + room.height - 0.75;
      const lz = cz + sign * spreadZ;
      roomLights.push({
        worldX: anchor0.worldX + lx * cosAnchor + lz * sinAnchor,
        worldY: anchor0.worldY + ly,
        worldZ: anchor0.worldZ - lx * sinAnchor + lz * cosAnchor,
        color: room.lightColor,
        intensity: room.lightIntensity * 14,
        distance: Math.max(rw, rd) * 1.45,
        floor: rFloor,
      });
    }
  }

  // 2. Build all perimeter & multi-room partition walls with photographic PBR textures,
  //    architectural wainscoting, chair rail, baseboards, crown molding, wall sconces,
  //    cohesive exterior architectural cladding, AND real 1-to-1 cut-out transparent glass windows!
  const exitRoom = getInteriorRoomAt(def, def.exitX, def.exitZ, 0);
  const exitWallZ = exitRoom.maxZ;
  const exitDoorCut: InteriorDoorwayDef = {
    floor: 0,
    axis: 'z',
    coord: exitWallZ,
    min: def.exitX - 1.6,
    max: def.exitX + 1.6,
    height: 2.8,
    frameColor: 0x1a1e2a,
  };
  const windowCuts: InteriorDoorwayDef[] = (def.windows ?? []).map((w) => ({
    floor: w.floor ?? 0,
    axis: w.axis,
    coord: w.coord,
    min: w.min,
    max: w.max,
    height: w.topY,
    frameColor: w.frameColor,
  }));
  const wallSegs = computeRoomWallSegments(def.rooms, [...def.doorways, exitDoorCut, ...windowCuts]);
  const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x221a16, roughness: 0.48, metalness: 0.15 });
  const sconceMetalMat = new THREE.MeshStandardMaterial({ color: 0xd4a44a, metalness: 0.88, roughness: 0.22 });

  let extWallIdx = 0;
  for (const seg of wallSegs) {
    const len = seg.end - seg.start;
    if (len < 0.05) continue;
    const mid = (seg.start + seg.end) * 0.5;
    const room = seg.room;
    const baseY = getVisualFloorBaseY(seg.floor);
    const storyExtH = getStoryExtH(room);

    const wallMat = new THREE.MeshStandardMaterial({
      color: seg.wallColor,
      roughness: 0.82,
      side: seg.isExterior ? THREE.FrontSide : THREE.DoubleSide,
    });
    pbrBindings.push({
      mat: wallMat,
      key: room.wallPbr,
      repeatX: Math.max(1, len / 2.6),
      repeatY: Math.max(1, seg.height / 2.6),
      tintHex: room.wallTint ?? seg.wallColor,
    });

    const segGroup = new THREE.Group();
    if (seg.axis === 'x') {
      segGroup.position.set(seg.coord, baseY, mid);
      segGroup.rotation.y = seg.outwardSign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
    } else {
      segGroup.position.set(mid, baseY, seg.coord);
      segGroup.rotation.y = seg.outwardSign > 0 ? Math.PI : 0;
    }

    // Main PBR textured interior wall plane (faces local +Z inward into room)
    const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(len, seg.height), wallMat);
    wallMesh.position.set(0, seg.height * 0.5, 0);
    segGroup.add(wallMesh);

    // Exterior architectural building facade skin (at z = -0.26, facing local -Z outward to the street!)
    if (seg.isExterior) {
      const extCfg = getRoomExteriorConfig(room);
      const extLen = len + 0.26;
      const extMat = new THREE.MeshStandardMaterial({
        color: extCfg.tint,
        roughness: 0.72,
        side: THREE.FrontSide,
      });
      pbrBindings.push({
        mat: extMat,
        key: extCfg.pbr,
        repeatX: Math.max(1, extLen / 2.8),
        repeatY: Math.max(1, storyExtH / 2.8),
        tintHex: extCfg.tint,
      });
      const extFace = new THREE.Mesh(new THREE.PlaneGeometry(extLen, storyExtH), extMat);
      extFace.rotation.y = Math.PI;
      extFace.position.set(0, storyExtH * 0.5, EXT_Z);
      segGroup.add(extFace);

      const trimMat = new THREE.MeshStandardMaterial({ color: extCfg.trimHex, roughness: 0.45, metalness: 0.25 });
      const plinthMat = new THREE.MeshStandardMaterial({ color: extCfg.plinthHex, roughness: 0.35, metalness: 0.45 });

      const topFrieze = new THREE.Mesh(new THREE.BoxGeometry(extLen + 0.04, 0.22, 0.08), trimMat);
      topFrieze.position.set(0, storyExtH - 0.14, EXT_Z - 0.04);
      const botDado = new THREE.Mesh(new THREE.BoxGeometry(extLen + 0.04, 0.32, 0.07), plinthMat);
      botDado.position.set(0, 0.18, EXT_Z - 0.035);
      segGroup.add(topFrieze, botDado);

      if (def.id === 'hotel-solaire' && len >= 2.8) {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.32, storyExtH, 0.12), trimMat);
        pilaster.position.set(0, storyExtH * 0.5, EXT_Z - 0.06);
        segGroup.add(pilaster);
      } else if (def.id === 'club-neon' && len >= 3.2) {
        const neonCol = extWallIdx % 2 === 0 ? 0xff2e93 : 0x2cf3ff;
        const tube = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, storyExtH - 0.8, 0.1),
          new THREE.MeshBasicMaterial({ color: neonCol }),
        );
        tube.position.set(0, storyExtH * 0.5, EXT_Z - 0.06);
        segGroup.add(tube);
      } else if (def.id === 'wynwood-gallery' && len >= 5.2) {
        const muralW = Math.min(6.4, len - 1.2);
        const muralH = Math.min(3.4, storyExtH - 1.4);
        const muralFrame = new THREE.Mesh(
          new THREE.BoxGeometry(muralW + 0.24, muralH + 0.24, 0.06),
          plinthMat,
        );
        muralFrame.position.set(0, storyExtH * 0.52, EXT_Z - 0.03);
        const muralArt = new THREE.Mesh(
          new THREE.PlaneGeometry(muralW, muralH),
          new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(extWallIdx) }),
        );
        muralArt.rotation.y = Math.PI;
        muralArt.position.set(0, storyExtH * 0.52, EXT_Z - 0.07);
        segGroup.add(muralFrame, muralArt);
      }
      extWallIdx++;
    }

    // Inset X-axis trim ends so 90-degree room corners butt cleanly without overlapping Z-fighting!
    const trimLen = Math.max(0.05, len - (seg.axis === 'x' ? 0.26 : 0.02));

    // Baseboard trim (proud of wall & wainscoting, clear of floor plane)
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(trimLen, 0.18, 0.05), baseboardMat);
    baseboard.position.set(0, 0.1, 0.05);
    segGroup.add(baseboard);

    // Architectural Wainscoting + Chair Rail (on Hotel, Café, VIP Bar walls!)
    if (room.wainscotColor !== undefined) {
      const wainMat = new THREE.MeshStandardMaterial({
        color: room.wainscotColor,
        roughness: 0.55,
        metalness: 0.1,
      });
      const wainPanel = new THREE.Mesh(new THREE.BoxGeometry(trimLen, 0.88, 0.03), wainMat);
      wainPanel.position.set(0, 0.63, 0.035);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(trimLen, 0.08, 0.07),
        new THREE.MeshStandardMaterial({
          color: room.crownColor ?? room.wainscotColor,
          roughness: 0.32,
          metalness: 0.45,
        }),
      );
      rail.position.set(0, 1.11, 0.055);
      segGroup.add(wainPanel, rail);
    }

    // Crown Molding cleanly separated from ceiling & wall (zero Z-fighting!)
    if (room.crownColor !== undefined) {
      const crownMat = new THREE.MeshStandardMaterial({
        color: room.crownColor,
        roughness: 0.35,
        metalness: 0.3,
      });
      const crown = new THREE.Mesh(new THREE.BoxGeometry(trimLen, 0.14, 0.1), crownMat);
      crown.position.set(0, seg.height - 0.1, 0.08);
      segGroup.add(crown);
    }

    // Architectural Wall Sconces spaced cleanly along longer walls!
    if (room.sconceColor !== undefined && len >= 4.2) {
      const glowMat = new THREE.MeshBasicMaterial({ color: room.sconceColor });
      const sconceCount = Math.min(3, Math.floor(len / 4.2));
      for (let si = 0; si < sconceCount; si++) {
        const sx = -len * 0.5 + ((si + 0.5) / sconceCount) * len;
        const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.06), sconceMetalMat);
        backplate.position.set(sx, 2.35, 0.04);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.24, 10), glowMat);
        shade.position.set(sx, 2.42, 0.13);
        segGroup.add(backplate, shade);
      }
    }

    group.add(segGroup);
  }

  // 2b. Build real 1-to-1 cut-out Transparent Architectural Windows shared identically between inside (z=0) and outside (z=-0.26)!
  for (const win of def.windows ?? []) {
    const winFloor = win.floor ?? 0;
    const baseY = getVisualFloorBaseY(winFloor);
    const span = win.max - win.min;
    const mid = (win.min + win.max) * 0.5;
    if (span < 0.1) continue;

    const ownerRoom = def.rooms.find(
      (r) =>
        (r.floor ?? 0) === winFloor &&
        (win.axis === 'x'
          ? (Math.abs(r.minX - win.coord) < 0.08 || Math.abs(r.maxX - win.coord) < 0.08) &&
            mid >= r.minZ &&
            mid <= r.maxZ
          : (Math.abs(r.minZ - win.coord) < 0.08 || Math.abs(r.maxZ - win.coord) < 0.08) &&
            mid >= r.minX &&
            mid <= r.maxX),
    );
    if (!ownerRoom) continue;

    const storyExtH = getStoryExtH(ownerRoom);
    const extCfg = getRoomExteriorConfig(ownerRoom);
    const extTrimMat = new THREE.MeshStandardMaterial({ color: extCfg.trimHex, roughness: 0.45, metalness: 0.25 });
    const extPlinthMat = new THREE.MeshStandardMaterial({ color: extCfg.plinthHex, roughness: 0.35, metalness: 0.45 });

    const outwardSign: 1 | -1 =
      win.axis === 'x'
        ? Math.abs(ownerRoom.maxX - win.coord) < 0.08
          ? 1
          : -1
        : Math.abs(ownerRoom.maxZ - win.coord) < 0.08
          ? 1
          : -1;

    const winSlotGroup = new THREE.Group();
    if (win.axis === 'x') {
      winSlotGroup.position.set(win.coord, baseY, mid);
      winSlotGroup.rotation.y = outwardSign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
    } else {
      winSlotGroup.position.set(mid, baseY, win.coord);
      winSlotGroup.rotation.y = outwardSign > 0 ? Math.PI : 0;
    }

    // Lower wall apron below the window sill (0 .. win.sillY): interior face at z=0, exterior face at z=-0.26!
    if (win.sillY > 0.05) {
      const lowMat = new THREE.MeshStandardMaterial({
        color: ownerRoom.wallColor,
        roughness: 0.82,
        side: THREE.FrontSide,
      });
      pbrBindings.push({
        mat: lowMat,
        key: ownerRoom.wallPbr,
        repeatX: Math.max(1, span / 2.6),
        repeatY: Math.max(0.25, win.sillY / 2.6),
        tintHex: ownerRoom.wallTint ?? ownerRoom.wallColor,
      });
      const lowWall = new THREE.Mesh(new THREE.PlaneGeometry(span, win.sillY), lowMat);
      lowWall.position.set(0, win.sillY * 0.5, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(span, 0.18, 0.05), baseboardMat);
      base.position.set(0, 0.1, 0.05);

      const extLowMat = new THREE.MeshStandardMaterial({
        color: extCfg.tint,
        roughness: 0.72,
        side: THREE.FrontSide,
      });
      pbrBindings.push({
        mat: extLowMat,
        key: extCfg.pbr,
        repeatX: Math.max(1, span / 2.8),
        repeatY: Math.max(0.25, win.sillY / 2.8),
        tintHex: extCfg.tint,
      });
      const extLowWall = new THREE.Mesh(new THREE.PlaneGeometry(span, win.sillY), extLowMat);
      extLowWall.rotation.y = Math.PI;
      extLowWall.position.set(0, win.sillY * 0.5, EXT_Z);
      const botDado = new THREE.Mesh(new THREE.BoxGeometry(span, Math.min(0.32, win.sillY), 0.07), extPlinthMat);
      botDado.position.set(0, Math.min(0.18, win.sillY * 0.5), EXT_Z - 0.035);
      winSlotGroup.add(lowWall, base, extLowWall, botDado);

      if (ownerRoom.wainscotColor !== undefined && win.sillY >= 0.45) {
        const wH = Math.min(0.88, win.sillY - 0.18);
        const wainMat = new THREE.MeshStandardMaterial({
          color: ownerRoom.wainscotColor,
          roughness: 0.55,
          metalness: 0.1,
        });
        const wainPanel = new THREE.Mesh(new THREE.BoxGeometry(span, wH, 0.03), wainMat);
        wainPanel.position.set(0, 0.19 + wH * 0.5, 0.035);
        winSlotGroup.add(wainPanel);
      }
    }

    // Upper wall spandrel above the window head (win.topY .. ownerRoom.height inside, win.topY .. storyExtH outside)!
    const topH = ownerRoom.height - win.topY;
    if (topH > 0.05) {
      const topMat = new THREE.MeshStandardMaterial({
        color: ownerRoom.wallColor,
        roughness: 0.82,
        side: THREE.FrontSide,
      });
      pbrBindings.push({
        mat: topMat,
        key: ownerRoom.wallPbr,
        repeatX: Math.max(1, span / 2.6),
        repeatY: Math.max(0.25, topH / 2.6),
        tintHex: ownerRoom.wallTint ?? ownerRoom.wallColor,
      });
      const topWall = new THREE.Mesh(new THREE.PlaneGeometry(span, topH), topMat);
      topWall.position.set(0, win.topY + topH * 0.5, 0);
      winSlotGroup.add(topWall);

      if (ownerRoom.crownColor !== undefined) {
        const crownMat = new THREE.MeshStandardMaterial({
          color: ownerRoom.crownColor,
          roughness: 0.35,
          metalness: 0.3,
        });
        const crown = new THREE.Mesh(new THREE.BoxGeometry(span, 0.14, 0.1), crownMat);
        crown.position.set(0, ownerRoom.height - 0.1, 0.08);
        winSlotGroup.add(crown);
      }
    }

    const extTopH = storyExtH - win.topY;
    if (extTopH > 0.05) {
      const extTopMat = new THREE.MeshStandardMaterial({
        color: extCfg.tint,
        roughness: 0.72,
        side: THREE.FrontSide,
      });
      pbrBindings.push({
        mat: extTopMat,
        key: extCfg.pbr,
        repeatX: Math.max(1, span / 2.8),
        repeatY: Math.max(0.25, extTopH / 2.8),
        tintHex: extCfg.tint,
      });
      const extTopWall = new THREE.Mesh(new THREE.PlaneGeometry(span, extTopH), extTopMat);
      extTopWall.rotation.y = Math.PI;
      extTopWall.position.set(0, win.topY + extTopH * 0.5, EXT_Z);
      const topFrieze = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.08), extTrimMat);
      topFrieze.position.set(0, storyExtH - 0.14, EXT_Z - 0.04);
      winSlotGroup.add(extTopWall, topFrieze);
    }

    // Transparent Architectural Glass Pane(s) + 3D Casing bridging z = +0.04 (inside) to z = -0.30 (outside)!
    const winH = Math.max(0.2, win.topY - win.sillY);
    const winCY = (win.sillY + win.topY) * 0.5;
    const isClubTint = def.id === 'club-neon' && win.exteriorOpacity !== undefined;
    const frameMat = new THREE.MeshStandardMaterial({
      color: isClubTint ? 0x11131c : win.frameColor,
      roughness: isClubTint ? 0.22 : 0.32,
      metalness: isClubTint ? 0.85 : 0.55,
    });

    if (win.exteriorOpacity !== undefined) {
      // Intentionally treated darker exterior-tinted window (e.g. Club Neon mirror-smoked privacy glass or Hotel bath tint):
      // Inward-facing clear/smoked film pane + outward-facing high-gloss mirror-tinted privacy pane at the exact same opening!
      const inGlassMat = new THREE.MeshPhysicalMaterial({
        color: win.tintColor ?? 0xd8f0ff,
        roughness: 0.05,
        metalness: 0.12,
        transparent: true,
        opacity: win.opacity ?? 0.22,
        clearcoat: 1.0,
        side: THREE.FrontSide,
        depthWrite: false,
      });
      const outGlassMat = new THREE.MeshPhysicalMaterial({
        color: win.exteriorTintColor ?? 0x060a14,
        roughness: isClubTint ? 0.04 : 0.06,
        metalness: isClubTint ? 0.82 : 0.42,
        transparent: true,
        opacity: win.exteriorOpacity,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        envMapIntensity: isClubTint ? 2.2 : 1.3,
        side: THREE.FrontSide,
        depthWrite: false,
      });
      const paneIn = new THREE.Mesh(new THREE.PlaneGeometry(span, winH), inGlassMat);
      paneIn.position.set(0, winCY, -0.09);
      const paneOut = new THREE.Mesh(new THREE.PlaneGeometry(span, winH), outGlassMat);
      paneOut.rotation.y = Math.PI;
      paneOut.position.set(0, winCY, -0.17);
      winSlotGroup.add(paneIn, paneOut);
    } else {
      // Standard crystal-clear window: identical transparency from both inside and outside!
      const clearGlassMat = new THREE.MeshPhysicalMaterial({
        color: win.tintColor ?? 0xd8f0ff,
        roughness: 0.04,
        metalness: 0.08,
        transparent: true,
        opacity: win.opacity ?? 0.18,
        clearcoat: 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(span, winH), clearGlassMat);
      pane.position.set(0, winCY, -0.13);
      winSlotGroup.add(pane);
    }

    // Full-depth 3D window header, sill, side jambs & mullions spanning from interior (+0.05) to exterior (-0.31)
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(span + 0.24, 0.14, 0.36), frameMat);
    topBar.position.set(0, win.topY, -0.13);
    const botSill = new THREE.Mesh(new THREE.BoxGeometry(span + 0.32, 0.14, 0.42), frameMat);
    botSill.position.set(0, win.sillY, -0.13);
    winSlotGroup.add(topBar, botSill);

    const cols = win.cols ?? 3;
    for (let i = 0; i <= cols; i++) {
      const mx = -span * 0.5 + (i / cols) * span;
      const isEdge = i === 0 || i === cols;
      const mull = new THREE.Mesh(
        new THREE.BoxGeometry(isEdge ? 0.12 : 0.085, winH + 0.08, isEdge ? 0.36 : 0.3),
        frameMat,
      );
      mull.position.set(mx, winCY, -0.13);
      winSlotGroup.add(mull);
    }
    const midBar = new THREE.Mesh(new THREE.BoxGeometry(span, 0.07, 0.26), frameMat);
    midBar.position.set(0, winCY + winH * 0.16, -0.13);
    winSlotGroup.add(midBar);

    // Venue-specific exterior window architectural treatments on the outside face (z < -0.26)
    if (def.id === 'hotel-solaire') {
      const coralEyebrowMat = new THREE.MeshStandardMaterial({ color: 0xf6b8be, roughness: 0.65 });
      const eyebrow = new THREE.Mesh(new THREE.BoxGeometry(span + 0.85, 0.22, 0.78), coralEyebrowMat);
      eyebrow.position.set(0, win.topY + 0.18, EXT_Z - 0.36);
      winSlotGroup.add(eyebrow);

      if (winFloor >= 1) {
        const balcSlabMat = new THREE.MeshStandardMaterial({ color: 0xf7eee4, roughness: 0.68 });
        const balcGlassMat = new THREE.MeshPhysicalMaterial({
          color: 0xd8f0ff,
          roughness: 0.05,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const balcSlab = new THREE.Mesh(new THREE.BoxGeometry(span + 0.56, 0.16, 0.85), balcSlabMat);
        balcSlab.position.set(0, 0.08, EXT_Z - 0.42);
        const balcGlass = new THREE.Mesh(new THREE.BoxGeometry(span + 0.44, 0.86, 0.05), balcGlassMat);
        balcGlass.position.set(0, 0.58, EXT_Z - 0.8);
        const balcRail = new THREE.Mesh(new THREE.BoxGeometry(span + 0.52, 0.06, 0.08), frameMat);
        balcRail.position.set(0, 1.03, EXT_Z - 0.8);
        winSlotGroup.add(balcSlab, balcGlass, balcRail);
      }
    } else if (def.id === 'club-neon') {
      const neonMat = new THREE.MeshBasicMaterial({ color: win.frameColor });
      const neonTop = new THREE.Mesh(new THREE.BoxGeometry(span + 0.28, 0.08, 0.08), neonMat);
      neonTop.position.set(0, win.topY + 0.12, EXT_Z - 0.06);
      const neonBot = new THREE.Mesh(new THREE.BoxGeometry(span + 0.28, 0.06, 0.08), neonMat);
      neonBot.position.set(0, win.sillY - 0.1, EXT_Z - 0.06);
      winSlotGroup.add(neonTop, neonBot);
    } else if (def.id === 'cafe-habana') {
      const awningMat = new THREE.MeshStandardMaterial({ color: 0xc25435, roughness: 0.7 });
      const awning = new THREE.Mesh(new THREE.BoxGeometry(span + 0.48, 0.14, 0.82), awningMat);
      awning.rotation.x = -0.24;
      awning.position.set(0, win.topY + 0.22, EXT_Z - 0.38);
      winSlotGroup.add(awning);
    }

    group.add(winSlotGroup);
  }

  // 3. Build architectural Doorway Archways, Frames & Upper Header Transoms (zero gaps to void!)
  for (const dw of def.doorways) {
    const dwFloor = dw.floor ?? 0;
    const baseY = getVisualFloorBaseY(dwFloor);
    const span = dw.max - dw.min;
    const mid = (dw.min + dw.max) * 0.5;
    const frameMat = new THREE.MeshStandardMaterial({
      color: dw.frameColor,
      roughness: 0.3,
      metalness: 0.65,
    });

    const adjacentRooms = def.rooms.filter(
      (r) =>
        (r.floor ?? 0) === dwFloor &&
        (dw.axis === 'x'
          ? Math.abs(r.minX - dw.coord) < 0.1 || Math.abs(r.maxX - dw.coord) < 0.1
          : Math.abs(r.minZ - dw.coord) < 0.1 || Math.abs(r.maxZ - dw.coord) < 0.1),
    );
    const maxH = Math.max(...adjacentRooms.map((r) => r.height), dw.height + 0.4);
    const headerH = Math.max(0.25, maxH - dw.height);

    const header = new THREE.Mesh(
      new THREE.BoxGeometry(dw.axis === 'z' ? span - 0.04 : 0.08, headerH - 0.04, dw.axis === 'x' ? span - 0.04 : 0.08),
      new THREE.MeshStandardMaterial({ color: adjacentRooms[0]?.wallColor ?? 0x222530, roughness: 0.78 }),
    );
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(dw.axis === 'z' ? span + 0.32 : 0.44, 0.22, dw.axis === 'x' ? span + 0.32 : 0.44),
      frameMat,
    );

    if (dw.axis === 'x') {
      header.position.set(dw.coord, baseY + dw.height + headerH * 0.5, mid);
      lintel.position.set(dw.coord, baseY + dw.height, mid);
      for (const edgeZ of [dw.min, dw.max]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.42, dw.height, 0.22), frameMat);
        jamb.position.set(dw.coord, baseY + dw.height * 0.5, edgeZ);
        group.add(jamb);
      }
    } else {
      header.position.set(mid, baseY + dw.height + headerH * 0.5, dw.coord);
      lintel.position.set(mid, baseY + dw.height, dw.coord);
      for (const edgeX of [dw.min, dw.max]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.22, dw.height, 0.42), frameMat);
        jamb.position.set(edgeX, baseY + dw.height * 0.5, dw.coord);
        group.add(jamb);
      }
    }
    group.add(header, lintel);

    if (dw.accentNeon) {
      const neonMat = new THREE.MeshBasicMaterial({ color: dw.accentNeon });
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(dw.axis === 'z' ? span : 0.48, 0.08, dw.axis === 'x' ? span : 0.48),
        neonMat,
      );
      strip.position.set(dw.axis === 'x' ? dw.coord : mid, baseY + dw.height - 0.08, dw.axis === 'x' ? mid : dw.coord);
      group.add(strip);
    }
  }

  // 3b. Build real 3D Animated Hinged Room Doors & Electronic Keycard Readers!
  const doors: BuiltDoorHandle[] = [];
  const doorWoodMat = new THREE.MeshStandardMaterial({ color: 0x452516, roughness: 0.4, metalness: 0.12 });
  const doorBrassMat = new THREE.MeshStandardMaterial({ color: 0xe0b452, roughness: 0.2, metalness: 0.92 });
  const readerBodyMat = new THREE.MeshStandardMaterial({ color: 0x161922, roughness: 0.3, metalness: 0.7 });

  const createDoorLeaf = (
    axis: 'x' | 'z',
    leafWidth: number,
    leafHeight: number,
    dirSign: 1 | -1,
    hasPeephole: boolean,
  ): THREE.Group => {
    const pivot = new THREE.Group();
    const w = Math.max(0.4, leafWidth - 0.04);
    const slab = new THREE.Mesh(
      axis === 'x'
        ? new THREE.BoxGeometry(0.09, leafHeight - 0.04, w)
        : new THREE.BoxGeometry(w, leafHeight - 0.04, 0.09),
      doorWoodMat,
    );
    if (axis === 'x') {
      slab.position.set(0, leafHeight * 0.5, dirSign * (leafWidth * 0.5));
    } else {
      slab.position.set(dirSign * (leafWidth * 0.5), leafHeight * 0.5, 0);
    }
    pivot.add(slab);

    // Art Deco raised brass trim border + kickplate + brass lever handles on both sides
    const kick = new THREE.Mesh(
      axis === 'x' ? new THREE.BoxGeometry(0.105, 0.22, w - 0.06) : new THREE.BoxGeometry(w - 0.06, 0.22, 0.105),
      doorBrassMat,
    );
    kick.position.set(
      axis === 'z' ? dirSign * (leafWidth * 0.5) : 0,
      0.13,
      axis === 'x' ? dirSign * (leafWidth * 0.5) : 0,
    );
    pivot.add(kick);

    const panelTrim = new THREE.Mesh(
      axis === 'x'
        ? new THREE.BoxGeometry(0.102, leafHeight * 0.58, w * 0.68)
        : new THREE.BoxGeometry(w * 0.68, leafHeight * 0.58, 0.102),
      doorBrassMat,
    );
    panelTrim.position.set(
      axis === 'z' ? dirSign * (leafWidth * 0.5) : 0,
      leafHeight * 0.56,
      axis === 'x' ? dirSign * (leafWidth * 0.5) : 0,
    );
    const panelInset = new THREE.Mesh(
      axis === 'x'
        ? new THREE.BoxGeometry(0.11, leafHeight * 0.54, w * 0.62)
        : new THREE.BoxGeometry(w * 0.62, leafHeight * 0.54, 0.11),
      doorWoodMat,
    );
    panelInset.position.copy(panelTrim.position);
    pivot.add(panelTrim, panelInset);

    // Brass door lever handles on both faces near latch edge
    const latchDist = dirSign * (leafWidth - 0.16);
    for (const faceSign of [-1, 1]) {
      const handle = new THREE.Mesh(
        axis === 'x' ? new THREE.BoxGeometry(0.06, 0.035, 0.14) : new THREE.BoxGeometry(0.14, 0.035, 0.06),
        doorBrassMat,
      );
      if (axis === 'x') {
        handle.position.set(faceSign * 0.075, 1.05, latchDist);
      } else {
        handle.position.set(latchDist, 1.05, faceSign * 0.075);
      }
      pivot.add(handle);
    }

    if (hasPeephole) {
      const peep = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.115, 10), doorBrassMat);
      if (axis === 'x') {
        peep.rotation.z = Math.PI * 0.5;
        peep.position.set(0, 1.56, dirSign * (leafWidth * 0.5));
      } else {
        peep.rotation.x = Math.PI * 0.5;
        peep.position.set(dirSign * (leafWidth * 0.5), 1.56, 0);
      }
      pivot.add(peep);
    }

    return pivot;
  };

  for (const d of def.doors ?? []) {
    const baseY = getVisualFloorBaseY(d.floor);
    const span = d.max - d.min;
    const isSuiteEntry = Boolean(d.requiredKeycard || d.occupied);

    let pivotA: THREE.Group;
    let pivotB: THREE.Group | undefined;

    if (d.doubleDoor) {
      const halfW = span * 0.5;
      pivotA = createDoorLeaf(d.axis, halfW, d.height, 1, false);
      pivotB = createDoorLeaf(d.axis, halfW, d.height, -1, false);
      if (d.axis === 'x') {
        pivotA.position.set(d.coord, baseY, d.min);
        pivotB.position.set(d.coord, baseY, d.max);
      } else {
        pivotA.position.set(d.min, baseY, d.coord);
        pivotB.position.set(d.max, baseY, d.coord);
      }
      group.add(pivotA, pivotB);
    } else {
      pivotA = createDoorLeaf(d.axis, span, d.height, 1, isSuiteEntry);
      if (d.axis === 'x') {
        pivotA.position.set(d.coord, baseY, d.min);
      } else {
        pivotA.position.set(d.min, baseY, d.coord);
      }
      group.add(pivotA);
    }

    // Electronic keycard scanner box with red/green status LED mounted next to keycard/occupied doors!
    let readerLedMat: THREE.MeshBasicMaterial | undefined;
    if (d.readerSide !== undefined) {
      const rGroup = new THREE.Group();
      if (d.axis === 'x') {
        rGroup.position.set(d.coord + d.readerSide * 0.13, baseY + 1.24, d.max + 0.16);
        rGroup.rotation.y = d.readerSide > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      } else {
        rGroup.position.set(d.max + 0.16, baseY + 1.24, d.coord + d.readerSide * 0.13);
        rGroup.rotation.y = d.readerSide > 0 ? 0 : Math.PI;
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.045), readerBodyMat);
      readerLedMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.026, 0.02), readerLedMat);
      led.position.set(0, 0.055, 0.02);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.015), doorBrassMat);
      slot.position.set(0, -0.025, 0.02);
      rGroup.add(box, led, slot);
      group.add(rGroup);
    }

    doors.push({ def: d, pivotA, pivotB, openProgress: 0, readerLedMat });
  }

  // 4. Illuminated Front Exit Transparent Glass Double Doors + Upper Wall Transom (Interior & Exterior!) + Glowing Exit Ring (Floor 0)
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x1a1e2a, roughness: 0.3, metalness: 0.7 });
  if (def.id === 'club-neon') {
    // Classic smoked mirror-tinted double entrance doors matching Club Neon's exterior glazing
    const clubDoorInMat = new THREE.MeshPhysicalMaterial({
      color: 0x203052,
      roughness: 0.05,
      metalness: 0.12,
      transparent: true,
      opacity: 0.26,
      clearcoat: 1.0,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    const clubDoorOutMat = new THREE.MeshPhysicalMaterial({
      color: 0x060a14,
      roughness: 0.04,
      metalness: 0.82,
      transparent: true,
      opacity: 0.78,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.2,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    const exitDoorIn = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), clubDoorInMat);
    exitDoorIn.rotation.y = Math.PI;
    exitDoorIn.position.set(def.exitX, 1.4, exitWallZ + 0.09);
    const exitDoorOut = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), clubDoorOutMat);
    exitDoorOut.position.set(def.exitX, 1.4, exitWallZ + 0.17);
    group.add(exitDoorIn, exitDoorOut);
  } else {
    const exitGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8ebff,
      roughness: 0.05,
      metalness: 0.12,
      transparent: true,
      opacity: 0.22,
      clearcoat: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const exitDoorMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), exitGlassMat);
    exitDoorMesh.position.set(def.exitX, 1.4, exitWallZ + 0.13);
    group.add(exitDoorMesh);
  }
  for (const dx of [-1.6, 0, 1.6]) {
    const stile = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.84, 0.36), doorFrameMat);
    stile.position.set(def.exitX + dx, 1.42, exitWallZ + 0.13);
    group.add(stile);
  }
  const doorHeaderBar = new THREE.Mesh(new THREE.BoxGeometry(3.36, 0.16, 0.38), doorFrameMat);
  doorHeaderBar.position.set(def.exitX, 2.82, exitWallZ + 0.13);
  group.add(doorHeaderBar);

  const exitTopH = exitRoom.height - 2.8;
  if (exitTopH > 0.05) {
    const exitTopMat = new THREE.MeshStandardMaterial({
      color: exitRoom.wallColor,
      roughness: 0.82,
      side: THREE.FrontSide,
    });
    pbrBindings.push({
      mat: exitTopMat,
      key: exitRoom.wallPbr,
      repeatX: 3.2 / 2.6,
      repeatY: Math.max(0.3, exitTopH / 2.6),
      tintHex: exitRoom.wallTint ?? exitRoom.wallColor,
    });
    const exitTopWall = new THREE.Mesh(new THREE.PlaneGeometry(3.2, exitTopH), exitTopMat);
    exitTopWall.position.set(def.exitX, 2.8 + exitTopH * 0.5, exitWallZ);
    exitTopWall.rotation.y = Math.PI;
    group.add(exitTopWall);
  }

  const exitStoryExtH = getStoryExtH(exitRoom);
  const exitExtTopH = exitStoryExtH - 2.8;
  if (exitExtTopH > 0.05) {
    const exitExtCfg = getRoomExteriorConfig(exitRoom);
    const exitExtTopMat = new THREE.MeshStandardMaterial({
      color: exitExtCfg.tint,
      roughness: 0.72,
      side: THREE.FrontSide,
    });
    pbrBindings.push({
      mat: exitExtTopMat,
      key: exitExtCfg.pbr,
      repeatX: 3.2 / 2.8,
      repeatY: Math.max(0.3, exitExtTopH / 2.8),
      tintHex: exitExtCfg.tint,
    });
    const exitExtTopWall = new THREE.Mesh(new THREE.PlaneGeometry(3.2, exitExtTopH), exitExtTopMat);
    exitExtTopWall.position.set(def.exitX, 2.8 + exitExtTopH * 0.5, exitWallZ - EXT_Z);
    group.add(exitExtTopWall);
  }

  const exitSignTex = createSignTexture('EXIT', 'PRESS [E] TO STEP OUTSIDE', '#0c261d', '#46f7b4', '#46f7b4');
  const exitSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.55),
    new THREE.MeshBasicMaterial({ map: exitSignTex }),
  );
  exitSign.position.set(def.exitX, 3.22, exitWallZ - 0.08);
  exitSign.rotation.y = Math.PI;
  group.add(exitSign);

  const exitRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.2, 28),
    new THREE.MeshBasicMaterial({
      color: 0x46f7b4,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  exitRing.rotation.x = -Math.PI * 0.5;
  exitRing.position.set(def.exitX, 0.048, def.exitZ);
  exitRing.visible = false;
  group.add(exitRing);

  // 4b. Glowing Cyan Elevator Call Rings on every elevator floor landing!
  const elevatorRings: THREE.Mesh[] = [];
  for (const elev of def.elevators ?? []) {
    const eBaseY = getVisualFloorBaseY(elev.floor);
    const eRing = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.08, 28),
      new THREE.MeshBasicMaterial({
        color: 0x2cf3ff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    eRing.rotation.x = -Math.PI * 0.5;
    eRing.position.set(elev.x, eBaseY + 0.048, elev.z);
    eRing.visible = false;
    group.add(eRing);
    elevatorRings.push(eRing);
  }

  // 5. Coherent Room-Specific Architectural Setpieces (windows, rugs, feature walls, bars, kitchen hood!)
  let danceFloorMat: THREE.MeshStandardMaterial | undefined;
  let lasers: THREE.Mesh[] | undefined;
  let monolithMats: THREE.MeshStandardMaterial[] | undefined;

  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6b958, metalness: 0.85, roughness: 0.22 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x422619, roughness: 0.42, metalness: 0.12 });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf4eee6, roughness: 0.22, metalness: 0.08 });

  if (def.id === 'hotel-solaire') {
    const f1Y = getVisualFloorBaseY(1);
    const f2Y = getVisualFloorBaseY(2);

    // ── EXTERIOR ART DECO GROUNDING PODIUMS, COLONNADE PILLARS & WEDDING-CAKE PENTHOUSE CROWN ──
    const extDecoStucco = new THREE.MeshStandardMaterial({ color: 0xfbf0e4, roughness: 0.7 });
    const extCoralTrim = new THREE.MeshStandardMaterial({ color: 0xf59eb2, roughness: 0.5 });
    // Ground-floor podium under Suite 201 wing (x: -22..-10, z: -4..4.8) & Bath 201/202 wings (z: -10..-4)
    const podSouth = new THREE.Mesh(new THREE.BoxGeometry(12.26, REAL_STORY_HEIGHT, 9.06), extDecoStucco);
    podSouth.position.set(-16.13, REAL_STORY_HEIGHT * 0.5, 0.4);
    const podBathS = new THREE.Mesh(new THREE.BoxGeometry(7.26, REAL_STORY_HEIGHT, 6.26), extDecoStucco);
    podBathS.position.set(-18.63, REAL_STORY_HEIGHT * 0.5, -7.13);
    const podBathN = new THREE.Mesh(new THREE.BoxGeometry(7.26, REAL_STORY_HEIGHT, 6.26), extDecoStucco);
    podBathN.position.set(18.63, REAL_STORY_HEIGHT * 0.5, -7.13);
    group.add(podSouth, podBathS, podBathN);

    // Fluted Art Deco colonnade pillars supporting 3F Penthouse front & rear terraces
    for (const [px, pz, y0, y1] of [
      [-4.75, 9.75, f1Y, f2Y],
      [4.75, 9.75, f1Y, f2Y],
      [-21.75, 9.75, f1Y, f2Y],
      [-12.25, 9.75, f1Y, f2Y],
      [-11.6, -7.75, 0, f2Y],
      [0, -7.75, 0, f2Y],
      [11.6, -7.75, 0, f2Y],
    ] as const) {
      const colH = y1 - y0;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, colH, 12), extDecoStucco);
      pil.position.set(px, y0 + colH * 0.5, pz);
      group.add(pil);
    }

    // Art Deco Stepped Rooftop Crown & Glowing Neon Spire atop the 3F Penthouse roof (y = f2Y + 4.8 = 14.4m)
    const roofY = f2Y + REAL_STORY_HEIGHT + 0.22;
    const crownTier1 = new THREE.Mesh(new THREE.BoxGeometry(10.4, 1.5, 8.4), extDecoStucco);
    crownTier1.position.set(0, roofY + 0.75, -1.0);
    const crownTier2 = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.3, 5.2), extCoralTrim);
    crownTier2.position.set(0, roofY + 2.15, -1.0);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.28, 3.8, 10), goldMat);
    spire.position.set(0, roofY + 4.7, -1.0);
    const spireBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x2cf3ff }),
    );
    spireBeacon.position.set(0, roofY + 6.65, -1.0);
    group.add(crownTier1, crownTier2, spire, spireBeacon);

    // ── FLOOR 0 (1F GRAND LOBBY & OCEAN LOUNGE) ──
    addAreaRug(group, -5.8, 7.5, 5.2, 3.8, 0x7b2839, 0xd9a84e, 0);
    addAreaRug(group, 5.8, 7.5, 5.2, 3.8, 0x7b2839, 0xd9a84e, 0);
    addAreaRug(group, 6.4, -0.4, 3.8, 3.8, 0x274c52, 0xd9a84e, 0);

    // Check-In Feature Wall directly behind Concierge Elena with Wood Slats & Brass "HOTEL SOLAIRE" Crest
    const featureWall = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4.2, 0.16), darkWoodMat);
    featureWall.position.set(-6.2, 2.1, -3.88);
    const hotelCrest = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.05),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('HOTEL SOLAIRE', 'EST. 1938 · CHECK-IN & CONCIERGE', '#2b1a14', '#ffe6b0', '#d9a84e'),
      }),
    );
    hotelCrest.position.set(-6.2, 3.2, -3.76);
    group.add(featureWall, hotelCrest);

    // Elevator Directory Sign beside Floor 1 brass elevator doors
    const dir1 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.85),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('ELEVATOR', '1F LOBBY · 2F SUITES · 3F PENTHOUSE', '#171110', '#ffe6b0', '#2cf3ff'),
      }),
    );
    dir1.position.set(2.35, 2.05, -3.88);
    group.add(dir1);

    // Ocean Cocktail Lounge Mahogany Bar Counter + Glowing Backlit Mirrored Liquor Wall!
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 9.0), darkWoodMat);
    bar.position.set(19.8, 0.55, 2.8);
    const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 9.2), marbleMat);
    barTop.position.set(19.8, 1.14, 2.8);
    const barFootRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 9.0, 8), goldMat);
    barFootRail.rotation.x = Math.PI * 0.5;
    barFootRail.position.set(18.85, 0.22, 2.8);
    group.add(bar, barTop, barFootRail);

    const backMirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.8, 8.4),
      new THREE.MeshStandardMaterial({
        color: 0xffd296,
        emissive: 0xff9e4a,
        emissiveIntensity: 0.42,
        roughness: 0.1,
        metalness: 0.85,
      }),
    );
    backMirror.position.set(22.88, 2.3, 2.8);
    group.add(backMirror);
    for (const sy of [1.55, 2.2, 2.85]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 8.2), goldMat);
      shelf.position.set(22.66, sy, 2.8);
      group.add(shelf);
    }

    // Art Deco Marble Columns in Grand Lobby
    for (const [px, pz] of [
      [-9.2, -3.2],
      [9.2, -3.2],
      [-9.2, 11.2],
      [9.2, 11.2],
    ]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 4.65, 14), marbleMat);
      col.position.set(px, 2.325, pz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.28, 14), goldMat);
      cap.position.set(px, 4.51, pz);
      group.add(col, cap);
    }

    // ── FLOOR 1 (2F GUEST CORRIDOR + SUITES 201 & 202 + EN-SUITE MARBLE BATHS) ──
    addAreaRug(group, 0, 1.5, 22.4, 3.2, 0x732031, 0xd9a84e, f1Y); // Full-length hallway carpet runner
    addAreaRug(group, -18.5, 0.8, 4.8, 4.4, 0xdccbb4, 0x9e7d4b, f1Y); // Suite 201 bedroom rug
    addAreaRug(group, 18.5, 0.8, 4.8, 4.4, 0x2a5458, 0xd9a84e, f1Y); // Suite 202 bedroom rug

    // Elevator Floor 2 Directory Plaque + Numbered Suite Plaques (201–206) + Ice Machine Alcove!
    const dir2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.76),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('FLOOR 2', '← 201 · SUITES 201–206 · 202 →', '#171110', '#ffe6b0', '#2cf3ff'),
      }),
    );
    dir2.position.set(2.35, f1Y + 1.95, -1.88);
    group.add(dir2);

    addRoomNumberPlaque(group, -11.9, f1Y + 1.95, 0.15, Math.PI * 0.5, '201', 'KEYCARD SUITE');
    addRoomNumberPlaque(group, 11.9, f1Y + 1.95, 0.15, -Math.PI * 0.5, '202', 'OCCUPIED');
    addClosedHotelDoor(group, -8.2, f1Y, 4.92, Math.PI, '203');
    addClosedHotelDoor(group, -3.2, f1Y, 4.92, Math.PI, '204');
    addClosedHotelDoor(group, 3.2, f1Y, 4.92, Math.PI, '205');
    addClosedHotelDoor(group, 8.2, f1Y, 4.92, Math.PI, '206');

    // 2F Corridor Complimentary Ice Service Wall Sign above the bespoke Blender hotel_ice_machine.glb!
    const iceSign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.30),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('ICE', 'COMPLIMENTARY · 2F', '#141a24', '#9ceeff', '#2cf3ff'),
      }),
    );
    iceSign.position.set(-9.6, f1Y + 2.02, -1.94);
    group.add(iceSign);

    // Framed coastal hotel art along 2F Corridor North Wall
    for (const [ax, seed] of [
      [-6.5, 0],
      [6.5, 2],
    ] as const) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.07), darkWoodMat);
      f.position.set(ax, f1Y + 2.0, -1.93);
      const a = new THREE.Mesh(
        new THREE.PlaneGeometry(1.82, 1.12),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(seed) }),
      );
      a.position.set(ax, f1Y + 2.0, -1.86);
      group.add(f, a);
    }

    // En-Suite Walk-In Glass Rain Showers in Bath 201 & Bath 202!
    addGlassShower(group, -16.1, f1Y, -9.1, 2.0, 1.6, 'west');
    addGlassShower(group, 16.1, f1Y, -9.1, 2.0, 1.6, 'east');

    // ── FLOOR 2 (3F THE OCEAN PENTHOUSE: FOYER, SALON, WET BAR, MASTER & SPA) ──
    addAreaRug(group, 0, -2.0, 8.2, 6.2, 0x7b2839, 0xe6bd68, f2Y); // Penthouse Grand Salon rug
    addAreaRug(group, -18.2, -1.8, 5.4, 5.2, 0xe2d2be, 0xb08a4e, f2Y); // Master Bedroom rug

    // Penthouse Elevator Plaque
    const dir3 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.72),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('PENTHOUSE 3F', 'PRIVATE RESIDENCE · ELEVATOR', '#171110', '#ffe6b0', '#2cf3ff'),
      }),
    );
    dir3.position.set(-2.35, f2Y + 1.95, 9.88);
    dir3.rotation.y = Math.PI;
    group.add(dir3);

    // Penthouse Private Wet Bar Counter & Glowing Back-Bar Mirror!
    const phBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 6.6), darkWoodMat);
    phBar.position.set(9.15, f2Y + 0.55, -2.0);
    const phBarTop = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 6.8), marbleMat);
    phBarTop.position.set(9.15, f2Y + 1.14, -2.0);
    const phMirror = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.5, 5.8),
      new THREE.MeshStandardMaterial({
        color: 0xffd296,
        emissive: 0xffa04a,
        emissiveIntensity: 0.4,
        roughness: 0.1,
        metalness: 0.85,
      }),
    );
    phMirror.position.set(11.88, f2Y + 2.25, -2.0);
    group.add(phBar, phBarTop, phMirror);

    // Penthouse Spa Walk-In Glass Rain Shower!
    addGlassShower(group, -15.2, f2Y, 9.0, 2.0, 1.8, 'west');
  } else if (def.id === 'club-neon') {
    // Rooftop glowing neon halo crown above Main Dance Hall (y = 7.82m) & After-Hours Lounge (y = 4.82m)
    const pinkHaloMat = new THREE.MeshBasicMaterial({ color: 0xff2e93 });
    const cyanHaloMat = new THREE.MeshBasicMaterial({ color: 0x2cf3ff });
    for (const [rw, rd, rx, ry, rz, mat] of [
      [24.5, 0.14, 0, 7.9, 10.25, pinkHaloMat],
      [24.5, 0.14, 0, 7.9, -12.25, cyanHaloMat],
      [0.14, 22.5, 12.25, 7.9, -1.0, pinkHaloMat],
      [0.14, 22.5, -12.25, 7.9, -1.0, cyanHaloMat],
      [13.4, 0.14, -18.5, 4.9, -21.25, cyanHaloMat],
      [0.14, 28.5, -25.25, 4.9, -7.0, pinkHaloMat],
    ] as const) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.16, rd), mat);
      strip.position.set(rx, ry, rz);
      group.add(strip);
    }

    // Velvet Entry Tunnel Carpet Runner + VIP Lounge & After-Hours Rugs + Glowing Neon Ribs!
    addAreaRug(group, 0, 14.4, 2.8, 7.8, 0x5c1138, 0xff2e93);
    addAreaRug(group, -15.8, -6.2, 4.4, 3.6, 0x26113b, 0x2cf3ff);
    addAreaRug(group, -15.8, 4.6, 4.4, 3.4, 0x26113b, 0xff2e93);
    addAreaRug(group, -18.5, -15.8, 8.8, 7.4, 0x1c1238, 0x2cf3ff);

    for (let z = 11.5; z <= 17.5; z += 2.0) {
      const col = z % 4 === 1.5 ? 0xff2e93 : 0x2cf3ff;
      const ribMat = new THREE.MeshBasicMaterial({ color: col });
      const topRib = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.08, 0.1), ribMat);
      topRib.position.set(0, 3.45, z);
      const lRib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 0.1), ribMat);
      lRib.position.set(-3.92, 1.7, z);
      const rRib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 0.1), ribMat);
      rRib.position.set(3.92, 1.7, z);
      group.add(topRib, lRib, rRib);
    }

    // Elevated DJ Stage + LED Backdrop (DJ console & speaker stacks come from custom Blender dj_booth_rig.glb!)
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(11.4, 0.9, 4.4),
      new THREE.MeshStandardMaterial({ color: 0x161426, roughness: 0.4, metalness: 0.4 }),
    );
    stage.position.set(0, 0.45, -9.2);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 4.5),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('CLUB NEON', 'VICE WAVE 98.5 LIVE', '#0c071a', '#2cf3ff', '#ff2e93'),
      }),
    );
    backdrop.position.set(0, 3.6, -11.88);
    group.add(stage, backdrop);

    // Pulsing Color-Cycling LED Dance Floor
    danceFloorMat = new THREE.MeshStandardMaterial({
      color: 0x18102c,
      emissive: 0xff2e93,
      emissiveIntensity: 1.2,
      roughness: 0.12,
      metalness: 0.35,
    });
    const danceFloor = new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.05, 11.0), danceFloorMat);
    danceFloor.position.set(0, 0.025, 0.4);
    group.add(danceFloor);

    // Sweeping Volumetric Laser Beams
    lasers = [];
    const laserColors = [0xff2e93, 0x2cf3ff, 0xa855f7, 0x46f7b4, 0xffcf5c, 0xff2e93];
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 10.5, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: laserColors[i],
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beam.position.set(-6 + i * 2.4, 7.2, -5.8);
      group.add(beam);
      lasers.push(beam);
    }

    // VIP Lounge Glowing Neon Bar Counter + Backlit Cyan Bottle Wall!
    const vipBar = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.1, 10.2),
      new THREE.MeshStandardMaterial({
        color: 0x161028,
        emissive: 0x2cf3ff,
        emissiveIntensity: 0.25,
        roughness: 0.25,
      }),
    );
    vipBar.position.set(-21.3, 0.55, -1.0);
    const vipBarTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.1, 10.4),
      new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 0.12, metalness: 0.5 }),
    );
    vipBarTop.position.set(-21.3, 1.14, -1.0);
    const vipBackGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(9.2, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x221044 }),
    );
    vipBackGlow.rotation.y = Math.PI * 0.5;
    vipBackGlow.position.set(-24.88, 2.3, -1.0);
    group.add(vipBar, vipBarTop, vipBackGlow);
  } else if (def.id === 'cafe-habana') {
    // Warm Espresso & Bakery Counter with Brass Trim + Wall-Mounted Menu Board Behind Barista!
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.08, 1.8), darkWoodMat);
    counter.position.set(-4.1, 0.54, 3.2);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.1, 2.0), marbleMat);
    counterTop.position.set(-4.1, 1.12, 3.2);
    const counterTrim = new THREE.Mesh(new THREE.BoxGeometry(5.26, 0.1, 1.86), goldMat);
    counterTrim.position.set(-4.1, 0.92, 3.2);
    group.add(counter, counterTop, counterTrim);

    // Wall-mounted CAFÉ HABANA Menu Board directly behind Barista Sofia!
    const menuSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.35),
      new THREE.MeshBasicMaterial({
        map: createSignTexture('CAFÉ HABANA MENU', 'CAFECITO $8 · CORTADITO · PASTELITOS $12', '#261a14', '#fff5e0', '#ffb347'),
      }),
    );
    menuSign.position.set(-4.1, 2.65, 0.12);
    group.add(menuSign);

    // Conservatory Overhead Skylight Panels
    const skyLightMat = new THREE.MeshBasicMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0.45 });
    for (const sx of [11.5, 15.0, 18.5]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9.5), skyLightMat);
      panel.rotation.x = Math.PI * 0.5;
      panel.position.set(sx, 4.74, 4.5);
      group.add(panel);
    }

    // Kitchen Stainless Prep Island + Overhead Commercial Stainless Range Hood!
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.85, roughness: 0.22 });
    const island = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.02, 1.6), steelMat);
    island.position.set(-0.9, 0.51, -5.3);
    const hoodCanopy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 1.7), steelMat);
    hoodCanopy.position.set(-0.9, 2.95, -5.3);
    const hoodDuct = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.9), steelMat);
    hoodDuct.position.set(-0.9, 3.5, -5.3);
    group.add(island, hoodCanopy, hoodDuct);

    // Framed Vintage Havana Art on Conservatory North Wall (4 cm proud of frame to prevent Z-fighting)
    for (let i = 0; i < 3; i++) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.08), darkWoodMat);
      frame.position.set(10.8 + i * 4.0, 2.4, -1.92);
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 1.4),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(i + 1) }),
      );
      art.position.set(10.8 + i * 4.0, 2.4, -1.84);
      group.add(frame, art);
    }
  } else {
    // Wynwood Art Gallery — Main Atrium Dual Sculpture Pedestal
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.15, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xf0f2f7, roughness: 0.35 }),
    );
    plinth.position.set(0, 0.575, 1.1);
    group.add(plinth);

    // Framed Miami Pop-Art Canvases with Dark Museum Frames & White Wall Title Placards!
    const canvasSpots: [number, number, number, number][] = [
      [-6.5, 2.8, -5.88, 0],
      [6.5, 2.8, -5.88, 0],
      [10.88, 2.8, -1.5, -Math.PI * 0.5],
      [10.88, 2.8, 3.5, -Math.PI * 0.5],
      [-10.88, 2.8, -4.0, Math.PI * 0.5],
      [-10.88, 2.8, 6.2, Math.PI * 0.5],
    ];
    const placardMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    canvasSpots.forEach(([x, y, z, ry], idx) => {
      const frameGroup = new THREE.Group();
      frameGroup.position.set(x, y, z);
      frameGroup.rotation.y = ry;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.64, 2.64, 0.08), doorFrameMat);
      frame.position.z = -0.04;
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 2.4),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(idx) }),
      );
      art.position.z = 0.035;
      const placard = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.03), placardMat);
      placard.position.set(1.55, -1.48, -0.02);
      frameGroup.add(frame, art, placard);
      group.add(frameGroup);
    });

    // Artist Studio Loft area rug
    addAreaRug(group, 6.2, -14.2, 4.8, 4.6, 0x3b2f45, 0xffcf5c);

    // Darkroom Wing: 4 Flanking Animated Neon Light Monoliths around the custom Blender kinetic sculpture!
    monolithMats = [];
    const monoCoords: [number, number, number][] = [
      [-14.8, -4.6, 0xff2e93],
      [-20.8, -4.4, 0xa855f7],
      [-14.8, 4.6, 0xffcf5c],
      [-20.8, 4.4, 0x46f7b4],
    ];
    for (const [mx, mz, col] of monoCoords) {
      const mMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 1.8,
        roughness: 0.1,
      });
      monolithMats.push(mMat);
      const monolith = new THREE.Mesh(new THREE.BoxGeometry(0.45, 4.2, 0.45), mMat);
      monolith.position.set(mx, 2.1, mz);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 1.18, 28),
        new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.set(mx, 0.04, mz);
      group.add(monolith, ring);
    }

    // Artist Studio Loft: Oversized Works-In-Progress Canvases Leaning on Brick Wall!
    for (let i = 0; i < 3; i++) {
      const wip = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 2.2, 0.08),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(i + 2) }),
      );
      wip.position.set(-5.8 + i * 4.2, 1.15, -17.6);
      wip.rotation.x = -0.14;
      group.add(wip);
    }
  }

  // Container for real 3D GLB furniture & prop models (attached asynchronously!)
  const propsRoot = new THREE.Group();
  group.add(propsRoot);

  // Live animated water jets & ripples for every indoor fountain prop!
  const fountainEffects: AnimatedFountainWater[] = [];
  for (const p of def.props) {
    const fStyle =
      p.kind === 'art_deco_fountain'
        ? 'art-deco'
        : p.kind === 'fountain_spanish_courtyard'
          ? 'spanish-courtyard'
          : p.kind === 'fountain_modern_zen'
            ? 'modern-zen'
            : p.kind === 'fountain_plaza_grand'
              ? 'plaza-grand'
              : null;
    if (!fStyle) continue;
    const fx = createFountainWaterEffect(fStyle, p.scale ?? 1.0);
    fx.group.position.set(p.x, getVisualFloorBaseY(p.floor ?? 0) + (p.y ?? 0), p.z);
    if (p.rotY) fx.group.rotation.y = p.rotY;
    group.add(fx.group);
    fountainEffects.push(fx);
  }

  // Indoor NPC mount points
  const npcs: BuiltNpcHandle[] = [];
  for (const nDef of def.npcs) {
    const npcRoot = new THREE.Group();
    npcRoot.position.set(nDef.x, getVisualFloorBaseY(nDef.floor ?? 0), nDef.z);
    npcRoot.rotation.y = -nDef.yaw;
    group.add(npcRoot);
    npcs.push({ def: nDef, root: npcRoot, rig: null });
  }

  return {
    def,
    group,
    propsRoot,
    pbrBindings,
    fountainEffects,
    npcs,
    doors,
    roomLights,
    danceFloorMat,
    lasers,
    monolithMats,
    exitRing,
    elevatorRings,
  };
}

export function createInteriorSystem(scene: THREE.Scene): InteriorSystemHandles {
  const venues = new Map<InteriorId, BuiltVenue>();
  const outdoorMarkersRoot = new THREE.Group();
  const storefronts: OutdoorStorefrontHandle[] = [];

  // Shared fixed-size pool of 6 PointLights + 1 interior HemisphereLight so WebGL compiles a tiny
  // constant light loop (6 instead of 38!) with zero shader recompiles on building entry/exit!
  const LIGHT_POOL_SIZE = 6;
  const lightPool: THREE.PointLight[] = [];
  for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
    const pt = new THREE.PointLight(0xfff1dc, 0, 28, 1.35);
    scene.add(pt);
    lightPool.push(pt);
  }
  const interiorHemi = new THREE.HemisphereLight(0xfff1dc, 0x2a2834, 0);
  scene.add(interiorHemi);

  for (let i = 0; i < INTERIORS.length; i++) {
    const def = INTERIORS[i];
    const built = buildVenueGeometry(def);
    scene.add(built.group);
    venues.set(def.id, built);

    const sf = buildArchitecturalStorefront(def, i);
    outdoorMarkersRoot.add(sf.group);
    storefronts.push(sf);
  }
  scene.add(outdoorMarkersRoot);

  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  const shadowGeo = new THREE.PlaneGeometry(1.0, 1.0);
  shadowGeo.rotateX(-Math.PI * 0.5);

  return {
    outdoorMarkersRoot,

    attachGltfNpcs(clonePedestrian) {
      for (const venue of venues.values()) {
        for (let i = 0; i < venue.npcs.length; i++) {
          const handle = venue.npcs[i];
          const cloned = clonePedestrian(handle.def.variantIndex, handle.def.uniform);
          if (!cloned) continue;
          cloned.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });
          const shadow = new THREE.Mesh(shadowGeo, shadowMat);
          shadow.position.y = 0.036;
          handle.root.add(shadow, cloned.scene);

          const rig = createHumanRigController(cloned.scene, cloned.animations);
          rig.update(0.016, 0, false, true, i * 0.8);
          rig.mixer.setTime((i * 0.85) % 2.0);
          handle.rig = rig;
        }
      }
    },

    attachGltfProps(propsMap) {
      // Populate every indoor room across all floors with photorealistic CC0 & Blender 3D furniture & prop GLBs!
      for (const venue of venues.values()) {
        for (const p of venue.def.props) {
          const src = propsMap.get(p.kind);
          if (!src) continue;
          const instance = src.clone(true);
          instance.position.set(p.x, getVisualFloorBaseY(p.floor ?? 0) + (p.y ?? 0), p.z);
          instance.rotation.y = p.rotY ?? 0;
          const sc = p.scale ?? 1.0;
          instance.scale.setScalar(sc);
          venue.propsRoot.add(instance);
        }
      }

      // Also mount outdoor sidewalk storefront props (potted palms & café chalkboard!)
      for (const sf of storefronts) {
        for (const slot of sf.propMountSlots) {
          const src = propsMap.get(slot.kind);
          if (!src) continue;
          const instance = src.clone(true);
          instance.position.copy(slot.pos);
          instance.rotation.y = slot.rotY;
          instance.scale.setScalar(slot.scale);
          sf.group.add(instance);
        }
      }
    },

    applyPbrTextures(texMap) {
      const cloneWithRepeat = (base: THREE.Texture, rx: number, ry: number): THREE.Texture => {
        const t = base.clone();
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.needsUpdate = true;
        return t;
      };

      for (const venue of venues.values()) {
        for (const b of venue.pbrBindings) {
          const pbr = texMap[b.key];
          if (!pbr) continue;
          b.mat.map = cloneWithRepeat(pbr.map, b.repeatX, b.repeatY);
          b.mat.normalMap = cloneWithRepeat(pbr.normalMap, b.repeatX, b.repeatY);
          b.mat.roughnessMap = cloneWithRepeat(pbr.roughnessMap, b.repeatX, b.repeatY);
          b.mat.color.setHex(b.tintHex);
          b.mat.needsUpdate = true;
        }
      }
    },

    setActiveInterior(id: InteriorId | null) {
      // Every venue building & its outdoor storefront remain visible at all times so inside and outside windows
      // are 1-to-1 physical openings you can see through from both the sidewalk and inside the rooms!
      outdoorMarkersRoot.visible = true;
      for (const sf of storefronts) {
        sf.thresholdRing.visible = id === null;
      }
      for (const [vid, venue] of venues) {
        venue.group.visible = true;
        const isCurrent = vid === id;
        venue.exitRing.visible = isCurrent;
        for (const eRing of venue.elevatorRings) {
          eRing.visible = isCurrent;
        }
      }
    },

    update(
      elapsed: number,
      dt: number,
      activeId: InteriorId | null,
      playerX: number,
      playerZ: number,
      playerY = INTERIOR_ORIGIN_Y,
      openDoorIds?: ReadonlySet<string>,
      ownedKeycards?: ReadonlySet<string>,
    ) {
      if (activeId === null) {
        for (const sf of storefronts) {
          sf.thresholdRing.visible = true;
          const s = 1 + Math.sin(elapsed * 3.0 + sf.phase) * 0.08;
          sf.thresholdRing.scale.set(s, s, 1);
        }
      }

      const exitPulse = 1 + Math.sin(elapsed * 3.6) * 0.1;

      // Compute player world coordinates so both distance culling and the 6-light pool work seamlessly indoors & outdoors
      let pWorldX = playerX;
      let pWorldY = 1.6;
      let pWorldZ = playerZ;
      const activeVenue = activeId ? venues.get(activeId) : undefined;
      if (activeVenue) {
        const curFl = getFloorFromPlayerY(playerY, activeVenue.def);
        const pw = interiorLocalToWorld(activeVenue.def, playerX, playerY, playerZ, curFl);
        pWorldX = pw.x;
        pWorldY = pw.y + 1.4;
        pWorldZ = pw.z;
      }

      // Collect candidate interior room lights for the nearest 6 pooled PointLights
      const candidateLights: { spec: RoomLightSpec; distSq: number }[] = [];

      for (const [vid, venue] of venues) {
        const isActive = vid === activeId;
        const distToEntrance = Math.hypot(pWorldX - venue.def.entranceX, pWorldZ - venue.def.entranceZ);

        // Keep architectural exterior shells visible up to 460m, while culling dense indoor GLB props,
        // rigged staff NPCs, and animated fountains beyond 75m outdoors!
        const showShell = isActive || distToEntrance < 460;
        const showInside = isActive || distToEntrance < 75;
        venue.group.visible = showShell;
        venue.propsRoot.visible = showInside;
        for (const h of venue.npcs) {
          h.root.visible = showInside;
        }
        for (const fx of venue.fountainEffects) {
          fx.group.visible = showInside;
        }

        if (isActive) {
          for (const ls of venue.roomLights) {
            const dx = ls.worldX - pWorldX;
            const dy = (ls.worldY - pWorldY) * 2.2; // Strongly prioritize lights on the player's current floor
            const dz = ls.worldZ - pWorldZ;
            candidateLights.push({ spec: ls, distSq: dx * dx + dy * dy + dz * dz });
          }
        } else if (activeId === null && distToEntrance < 45) {
          // Warm ground-floor peek-through glow when walking or cruising right past a storefront!
          for (const ls of venue.roomLights) {
            if (ls.floor !== 0) continue;
            const dx = ls.worldX - pWorldX;
            const dz = ls.worldZ - pWorldZ;
            candidateLights.push({ spec: ls, distSq: dx * dx + dz * dz });
          }
        }

        if (!showInside) continue;

        if (isActive) {
          venue.exitRing.visible = true;
          venue.exitRing.scale.set(exitPulse, exitPulse, 1);
          for (const eRing of venue.elevatorRings) {
            eRing.visible = true;
            eRing.scale.set(exitPulse, exitPulse, 1);
          }
        }

        // Smoothly swing real 3D hinged doors open/closed & update electronic keycard reader LEDs!
        for (const dh of venue.doors) {
          const wantOpen = isActive && openDoorIds?.has(dh.def.id) ? 1 : 0;
          dh.openProgress = lerp(dh.openProgress, wantOpen, clamp(dt * 7.5, 0, 1));
          const angle = dh.openProgress * Math.PI * 0.52 * dh.def.swingDir;
          dh.pivotA.rotation.y = angle;
          if (dh.pivotB) {
            dh.pivotB.rotation.y = -angle;
          }
          if (dh.readerLedMat) {
            const unlocked =
              !dh.def.occupied &&
              (!dh.def.requiredKeycard || Boolean(ownedKeycards?.has(dh.def.requiredKeycard)));
            dh.readerLedMat.color.setHex(unlocked ? 0x46f7b4 : 0xff3b5c);
          }
        }

        // Animate Club Neon pulsing LED floor & sweeping lasers
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

        // Animate Wynwood Gallery Neon Light Installation monoliths!
        if (venue.monolithMats) {
          venue.monolithMats.forEach((mat, idx) => {
            const hue = (elapsed * 0.08 + idx * 0.19) % 1;
            mat.emissive.setHSL(hue, 0.95, 0.58);
            mat.emissiveIntensity = 1.5 + Math.sin(elapsed * 2.5 + idx) * 0.5;
          });
        }

        // Animate indoor fountain water jets & ripples!
        for (const fx of venue.fountainEffects) {
          fx.update(elapsed);
        }

        const playerFloor = isActive ? getFloorFromPlayerY(playerY, venue.def) : -1;
        const localPlayerX = isActive ? playerX : 9999;
        const localPlayerZ = isActive ? playerZ : 9999;

        // Step living hotel staff patrols (bellhops, maids, room service) & drive real mocap Walk/Idle!
        const prevCoords = venue.npcs.map((h) => ({ x: h.def.x, z: h.def.z }));
        stepInteriorPatrols(venue.def, dt, localPlayerX, localPlayerZ, playerFloor);

        for (let i = 0; i < venue.npcs.length; i++) {
          const handle = venue.npcs[i];
          const npcFloor = handle.def.floor ?? 0;
          const npcBaseY = getVisualFloorBaseY(npcFloor);
          const moved = Math.hypot(handle.def.x - prevCoords[i].x, handle.def.z - prevCoords[i].z);
          const speedMps = dt > 0.001 ? moved / dt : 0;

          handle.root.position.x = handle.def.x;
          handle.root.position.z = handle.def.z;
          if (!handle.def.dancing) {
            handle.root.position.y = npcBaseY;
          }

          if (!handle.rig) continue;

          const dx = localPlayerX - handle.def.x;
          const dz = localPlayerZ - handle.def.z;
          const d = Math.hypot(dx, dz);
          const targetYaw =
            speedMps > 0.2
              ? handle.def.yaw
              : npcFloor === playerFloor && d < 4.2
                ? yawFromDir(dx, dz)
                : handle.def.yaw;
          const curYaw = -handle.root.rotation.y;
          const nextYaw = lerpAngle(curYaw, targetYaw, clamp(dt * 5.0, 0, 1));
          handle.root.rotation.y = -nextYaw;

          if (handle.def.dancing) {
            handle.root.position.y = npcBaseY + Math.abs(Math.sin(elapsed * 5.4 + i * 1.1)) * 0.08;
            handle.root.rotation.z = Math.sin(elapsed * 2.7 + i * 0.9) * 0.055;
            handle.rig.update(dt, 0.1, false, true, elapsed + i);
          } else {
            handle.rig.update(dt, speedMps > 0.15 ? 2.4 : 0, false, true, elapsed + i);
          }
        }
      }

      // Position the fixed 6-light interior pool on the closest active/storefront rooms
      candidateLights.sort((a, b) => a.distSq - b.distSq);
      for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
        const pt = lightPool[i];
        const cand = candidateLights[i];
        if (cand) {
          pt.position.set(cand.spec.worldX, cand.spec.worldY, cand.spec.worldZ);
          pt.color.setHex(cand.spec.color);
          pt.intensity = cand.spec.intensity;
          pt.distance = cand.spec.distance;
        } else {
          pt.intensity = 0;
        }
      }
      if (activeVenue) {
        const pr = activeVenue.def.rooms[0];
        interiorHemi.color.setHex(pr.lightColor);
        interiorHemi.intensity = pr.ambientIntensity;
      } else {
        interiorHemi.intensity = 0;
      }
    },
  };
}
