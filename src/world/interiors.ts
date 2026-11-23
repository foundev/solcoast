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
import type { ClonedPerson, InteriorPropKind } from './assets';
import { getGroundHeight } from './cityData';
import { createContactShadowTexture } from './textures';

export type InteriorId = 'hotel-solaire' | 'club-neon' | 'cafe-habana' | 'wynwood-gallery';

export interface InteriorRoomDef {
  id: string;
  name: string;
  shortLabel: string;
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
  /** Auto-generated perimeter & interior partition walls (with doorway cutouts) */
  walls: AABB[];
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  exitX: number;
  exitZ: number;
  colliders: AABB[];
  props: InteriorPropPlacement[];
  npcs: InteriorNpcDef[];
}

export const INTERIOR_ORIGIN_Y = -60;

interface WallSegment {
  axis: 'x' | 'z';
  coord: number;
  start: number;
  end: number;
  outwardSign: 1 | -1;
  height: number;
  wallColor: number;
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
    const addEdge = (
      axis: 'x' | 'z',
      coord: number,
      start: number,
      end: number,
      outwardSign: 1 | -1,
    ) => {
      const cuts = doorways
        .filter((d) => d.axis === axis && Math.abs(d.coord - coord) < 0.05)
        .map((d) => ({ min: Math.max(start, d.min), max: Math.min(end, d.max) }))
        .filter((c) => c.max > c.min + 0.05);
      for (const s of subtractIntervals(start, end, cuts)) {
        segs.push({ axis, coord, start: s.start, end: s.end, outwardSign, height: r.height, wallColor: r.wallColor });
      }
    };
    addEdge('x', r.minX, r.minZ, r.maxZ, -1);
    addEdge('x', r.maxX, r.minZ, r.maxZ, 1);
    addEdge('z', r.minZ, r.minX, r.maxX, -1);
    addEdge('z', r.maxZ, r.minX, r.maxX, 1);
  }
  return segs;
}

function buildWallColliders(rooms: InteriorRoomDef[], doorways: InteriorDoorwayDef[]): AABB[] {
  const segs = computeRoomWallSegments(rooms, doorways);
  const thick = 0.28;
  return segs.map((s) => {
    if (s.axis === 'x') {
      const x0 = s.outwardSign > 0 ? s.coord : s.coord - thick;
      const x1 = s.outwardSign > 0 ? s.coord + thick : s.coord;
      return { minX: x0, maxX: x1, minZ: s.start, maxZ: s.end, minY: 0, maxY: s.height };
    }
    const z0 = s.outwardSign > 0 ? s.coord : s.coord - thick;
    const z1 = s.outwardSign > 0 ? s.coord + thick : s.coord;
    return { minX: s.start, maxX: s.end, minZ: z0, maxZ: z1, minY: 0, maxY: s.height };
  });
}

function makeVenue(
  raw: Omit<InteriorDef, 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'walls'>,
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
  };
}

export const INTERIORS: InteriorDef[] = [
  // ─── 1. HOTEL SOLAIRE (OCEAN DRIVE — 3-ROOM ART DECO RESORT) ─────────────────
  // Bolted flush onto real Art Deco building b-108 (box x:109.3..124.0, z:-59.6..-37.2)
  makeVenue({
    id: 'hotel-solaire',
    name: 'Hotel Solaire',
    districtLabel: 'Ocean Drive',
    accentColor: 0xff6ca8,
    entranceX: 126.5,
    entranceZ: -48.4,
    outdoorExitYaw: Math.PI * 0.5,
    storefront: {
      wallX: 124.0,
      centerZ: -48.4,
      facingSignX: 1,
      signText: 'HOTEL SOLAIRE',
      subtitle: 'OCEAN DRIVE · LOBBY · LOUNGE · SUITE',
      style: 'art-deco-hotel',
    },
    spawnX: 0,
    spawnZ: 9.6,
    spawnYaw: 0,
    exitX: 0,
    exitZ: 11.2,
    rooms: [
      {
        id: 'atrium',
        name: 'Grand Marble Atrium',
        shortLabel: 'ATRIUM',
        minX: -10,
        maxX: 10,
        minZ: -2,
        maxZ: 12,
        height: 6.4,
        floorColorA: '#f5efe4',
        floorColorB: '#d9ccb6',
        floorMapTint: '#363c52',
        wallColor: 0xf6e6dc,
        ceilingColor: 0x2a2030,
        lightColor: 0xffdfb0,
        lightIntensity: 1.5,
        ambientIntensity: 0.9,
        floorRoughness: 0.25,
      },
      {
        id: 'lounge',
        name: 'Ocean Cocktail Lounge',
        shortLabel: 'BAR LOUNGE',
        minX: 10,
        maxX: 24,
        minZ: -4,
        maxZ: 10,
        height: 4.6,
        floorColorA: '#543525',
        floorColorB: '#44291c',
        floorMapTint: '#3e2d39',
        wallColor: 0x1e3a42,
        ceilingColor: 0x191620,
        lightColor: 0xffb870,
        lightIntensity: 1.35,
        ambientIntensity: 0.65,
        floorRoughness: 0.35,
      },
      {
        id: 'suite',
        name: 'Penthouse Ocean Suite',
        shortLabel: 'VIP SUITE',
        minX: -9,
        maxX: 9,
        minZ: -16,
        maxZ: -2,
        height: 4.4,
        floorColorA: '#e8dfd2',
        floorColorB: '#dfd4c4',
        floorMapTint: '#3b374f',
        wallColor: 0xf4eee6,
        ceilingColor: 0xede6dc,
        lightColor: 0xffd5a0,
        lightIntensity: 1.35,
        ambientIntensity: 0.85,
        floorRoughness: 0.82,
      },
    ],
    doorways: [
      { axis: 'x', coord: 10, min: 1.5, max: 6.5, height: 3.8, frameColor: 0xd9a84e },
      { axis: 'z', coord: -2, min: -2.8, max: 2.8, height: 3.8, frameColor: 0xd9a84e },
    ],
    colliders: [
      // Atrium reception desk
      { minX: -8.6, maxX: -3.2, minZ: 1.5, maxZ: 3.3, minY: 0, maxY: 1.5 },
      // Atrium west & east lounge islands
      { minX: -8.1, maxX: -3.5, minZ: 5.9, maxZ: 9.0, minY: 0, maxY: 1.2 },
      { minX: 3.5, maxX: 8.1, minZ: 5.9, maxZ: 9.0, minY: 0, maxY: 1.2 },
      // Ocean Cocktail Lounge mahogany bar counter
      { minX: 19.6, maxX: 21.4, minZ: -1.8, maxZ: 7.6, minY: 0, maxY: 1.5 },
      // Lounge VIP booth (north)
      { minX: 11.4, maxX: 16.5, minZ: -3.4, maxZ: -0.4, minY: 0, maxY: 1.2 },
      // Lounge VIP booth (south)
      { minX: 11.4, maxX: 16.5, minZ: 6.8, maxZ: 9.4, minY: 0, maxY: 1.2 },
      // Penthouse Suite king bed
      { minX: -1.6, maxX: 1.6, minZ: -14.6, maxZ: -11.0, minY: 0, maxY: 1.6 },
      // Penthouse Suite west reading group
      { minX: -8.2, maxX: -4.4, minZ: -12.0, maxZ: -7.5, minY: 0, maxY: 1.2 },
      // Penthouse Suite east credenza
      { minX: 5.2, maxX: 8.4, minZ: -12.5, maxZ: -7.5, minY: 0, maxY: 1.2 },
    ],
    props: [
      // Grand Atrium
      { kind: 'chandelier', x: -3.5, y: 6.4, z: 5.2, scale: 1.85, hangFromCeiling: true },
      { kind: 'chandelier', x: 3.5, y: 6.4, z: 5.2, scale: 1.85, hangFromCeiling: true },
      { kind: 'sofa_luxury', x: -6.2, z: 8.1, rotY: Math.PI, scale: 1.05 },
      { kind: 'coffee_table', x: -6.2, z: 6.6, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'lounge_chair', x: -4.1, z: 6.7, rotY: -Math.PI * 0.5, scale: 0.95 },
      { kind: 'sofa_luxury', x: 6.2, z: 8.1, rotY: Math.PI, scale: 1.05 },
      { kind: 'coffee_table', x: 6.2, z: 6.6, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'armchair', x: 4.1, z: 6.7, rotY: Math.PI * 0.5, scale: 1.0 },
      { kind: 'grandfather_clock', x: -9.3, z: -1.1, rotY: 0, scale: 1.1 },
      { kind: 'console_table', x: 6.2, z: -1.3, rotY: 0, scale: 1.15 },
      { kind: 'ornate_mirror', x: 6.2, y: 1.6, z: -1.85, rotY: 0, scale: 1.7 },
      { kind: 'potted_plant_1', x: -3.4, z: 10.9, scale: 1.3 },
      { kind: 'potted_plant_1', x: 3.4, z: 10.9, scale: 1.3 },
      { kind: 'potted_plant_2', x: -3.6, z: -1.2, scale: 1.2 },
      { kind: 'potted_plant_2', x: 3.6, z: -1.2, scale: 1.2 },
      // Ocean Cocktail Lounge
      { kind: 'bar_stool', x: 18.8, z: -0.6, scale: 1.1 },
      { kind: 'bar_stool', x: 18.8, z: 1.4, scale: 1.1 },
      { kind: 'bar_stool', x: 18.8, z: 3.4, scale: 1.1 },
      { kind: 'bar_stool', x: 18.8, z: 5.4, scale: 1.1 },
      { kind: 'cabinet', x: 23.3, z: 0.8, rotY: -Math.PI * 0.5, scale: 1.15 },
      { kind: 'cabinet', x: 23.3, z: 4.6, rotY: -Math.PI * 0.5, scale: 1.15 },
      { kind: 'wine_bottles', x: 23.3, y: 0.78, z: 0.2, rotY: Math.PI * 0.5, scale: 1.35 },
      { kind: 'wine_bottles', x: 23.3, y: 0.78, z: 1.5, rotY: Math.PI * 0.5, scale: 1.35 },
      { kind: 'wine_bottles', x: 23.3, y: 0.78, z: 4.0, rotY: Math.PI * 0.5, scale: 1.35 },
      { kind: 'wine_bottles', x: 23.3, y: 0.78, z: 5.3, rotY: Math.PI * 0.5, scale: 1.35 },
      { kind: 'wine_bottles', x: 20.4, y: 1.14, z: 2.2, rotY: Math.PI * 0.5, scale: 1.2 },
      { kind: 'sofa_luxury', x: 14.0, z: -2.6, rotY: 0, scale: 1.05 },
      { kind: 'coffee_table', x: 14.0, z: -1.1, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'sofa_luxury', x: 14.0, z: 8.6, rotY: Math.PI, scale: 1.05 },
      { kind: 'coffee_table', x: 14.0, z: 7.2, rotY: Math.PI * 0.5, scale: 1.1 },
      { kind: 'potted_plant_1', x: 11.2, z: -2.8, scale: 1.15 },
      { kind: 'potted_plant_2', x: 11.2, z: 8.8, scale: 1.15 },
      { kind: 'pendant_lamp', x: 14.5, y: 4.6, z: 3.0, scale: 1.25, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 19.6, y: 4.6, z: 1.0, scale: 1.1, hangFromCeiling: true },
      { kind: 'pendant_lamp', x: 19.6, y: 4.6, z: 5.0, scale: 1.1, hangFromCeiling: true },
      // Penthouse Ocean Suite
      { kind: 'bed_suite', x: 0, z: -12.8, rotY: 0, scale: 1.35 },
      { kind: 'lounge_chair', x: -6.8, z: -10.5, rotY: Math.PI * 0.35, scale: 1.05 },
      { kind: 'armchair', x: -6.6, z: -8.3, rotY: Math.PI * 0.65, scale: 1.05 },
      { kind: 'coffee_table', x: -5.1, z: -9.5, rotY: 0, scale: 1.0 },
      { kind: 'display_shelves', x: -8.3, z: -5.2, rotY: Math.PI * 0.5, scale: 1.2 },
      { kind: 'console_table', x: 7.4, z: -9.8, rotY: -Math.PI * 0.5, scale: 1.25 },
      { kind: 'ornate_mirror', x: 8.8, y: 1.5, z: -9.8, rotY: -Math.PI * 0.5, scale: 1.8 },
      { kind: 'cabinet', x: 6.4, z: -14.8, rotY: 0, scale: 1.1 },
      { kind: 'potted_plant_1', x: -7.5, z: -14.6, scale: 1.2 },
      { kind: 'potted_plant_2', x: 7.5, z: -4.2, scale: 1.2 },
      { kind: 'chandelier', x: 0, y: 4.4, z: -8.6, scale: 1.35, hangFromCeiling: true },
    ],
    npcs: [
      {
        id: 'solaire-concierge',
        name: 'Elena',
        role: 'Concierge',
        x: -5.9,
        z: 0.7,
        yaw: Math.PI,
        variantIndex: 13,
        lines: [
          'Elena: "Welcome to Hotel Solaire! Explore the Ocean Cocktail Lounge to the east or our Penthouse Suite straight ahead."',
          'Elena: "Take the Key Sol Spyder across the north causeway at golden hour — pure Miami magic."',
        ],
      },
      {
        id: 'solaire-bartender',
        name: 'Mateo',
        role: 'Master Mixologist',
        x: 22.1,
        z: 2.6,
        yaw: -Math.PI * 0.5,
        variantIndex: 18,
        actionCost: 20,
        actionToast: 'Mateo poured you a chilled Sol Coast Mojito at the Ocean Lounge (-$20)!',
        lines: ['Mateo: "House special mojito? Mint fresh from Palm Plaza."'],
      },
      {
        id: 'solaire-guest-1',
        name: 'Camila',
        role: 'Hotel Guest',
        x: -2.4,
        z: 7.2,
        yaw: Math.PI * 0.65,
        variantIndex: 25,
        lines: ['Camila: "Love the Art Deco chandeliers in here. Heading over to Wynwood Gallery next!"'],
      },
      {
        id: 'solaire-guest-2',
        name: 'Devon',
        role: 'Lounge Guest',
        x: 15.6,
        z: 1.8,
        yaw: Math.PI * 0.4,
        variantIndex: 32,
        lines: ['Devon: "Best cocktail lounge on Ocean Drive. Mateo never misses."'],
      },
      {
        id: 'solaire-suite-vip',
        name: 'Valery',
        role: 'Penthouse Guest',
        x: -3.0,
        z: -8.4,
        yaw: Math.PI * 0.2,
        variantIndex: 41,
        lines: ['Valery: "Look at that sunset view from the Penthouse Suite — worth every penny."'],
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
      },
    ],
    doorways: [
      { axis: 'z', coord: 10, min: -2.4, max: 2.4, height: 3.1, frameColor: 0x221636, accentNeon: 0xff2e93 },
      { axis: 'x', coord: -12, min: -3.5, max: 2.5, height: 3.6, frameColor: 0x1a1430, accentNeon: 0x2cf3ff },
    ],
    colliders: [
      // Foyer coat check cabinet
      { minX: 2.4, maxX: 3.9, minZ: 11.4, maxZ: 15.2, minY: 0, maxY: 1.6 },
      // Elevated DJ Stage (North)
      { minX: -5.8, maxX: 5.8, minZ: -11.5, maxZ: -6.8, minY: 0, maxY: 3.0 },
      // East Dance Hall VIP Banquettes
      { minX: 8.6, maxX: 11.8, minZ: -5.5, maxZ: 5.5, minY: 0, maxY: 1.4 },
      // VIP Lounge Neon Bar Counter (West)
      { minX: -22.2, maxX: -20.4, minZ: -6.2, maxZ: 4.2, minY: 0, maxY: 1.6 },
      // VIP Lounge Seating Pods
      { minX: -18.0, maxX: -13.6, minZ: -8.2, maxZ: -5.0, minY: 0, maxY: 1.3 },
      { minX: -18.0, maxX: -13.6, minZ: 3.4, maxZ: 6.4, minY: 0, maxY: 1.3 },
    ],
    props: [
      // Foyer
      { kind: 'cabinet', x: 3.2, z: 13.3, rotY: -Math.PI * 0.5, scale: 1.15 },
      { kind: 'potted_plant_2', x: -3.1, z: 12.2, scale: 1.1 },
      // Main Dance Hall & DJ Stage
      { kind: 'stage_lights', x: -3.5, y: 0.9, z: -10.0, rotY: 0.25, scale: 0.95 },
      { kind: 'stage_lights', x: 3.5, y: 0.9, z: -10.0, rotY: -0.25, scale: 0.95 },
      { kind: 'boombox', x: -1.6, y: 1.96, z: -7.5, rotY: 0.15, scale: 1.15 },
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
        floorRoughness: 0.55,
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
      },
    ],
    doorways: [
      { axis: 'x', coord: 8, min: 3.0, max: 8.0, height: 3.6, frameColor: 0x6b4128 },
      { axis: 'z', coord: 0, min: 2.0, max: 6.2, height: 3.2, frameColor: 0x6b4128 },
    ],
    colliders: [
      // Espresso & pastry bar counter
      { minX: -6.8, maxX: -1.4, minZ: 2.2, maxZ: 4.2, minY: 0, maxY: 1.4 },
      // Front bistro table (right of door)
      { minX: 3.2, maxX: 5.4, minZ: 7.4, maxZ: 9.6, minY: 0, maxY: 1.1 },
      // Conservatory dining tables
      { minX: 11.2, maxX: 14.4, minZ: 0.4, maxZ: 2.8, minY: 0, maxY: 1.1 },
      { minX: 16.8, maxX: 19.8, minZ: 0.4, maxZ: 2.8, minY: 0, maxY: 1.1 },
      { minX: 11.6, maxX: 14.0, minZ: 6.6, maxZ: 9.0, minY: 0, maxY: 1.1 },
      { minX: 16.8, maxX: 19.2, minZ: 6.6, maxZ: 9.0, minY: 0, maxY: 1.1 },
      // Kitchen stainless prep island
      { minX: -3.2, maxX: 1.4, minZ: -6.2, maxZ: -4.4, minY: 0, maxY: 1.4 },
      // Kitchen coffee roaster cart
      { minX: -7.2, maxX: -4.4, minZ: -9.0, maxZ: -6.8, minY: 0, maxY: 1.8 },
    ],
    props: [
      // Espresso Bar & Bakery
      { kind: 'coffee_cart', x: -5.4, z: 1.1, rotY: 0, scale: 0.95 },
      { kind: 'cake_display', x: -2.4, y: 1.14, z: 3.2, scale: 1.65 },
      { kind: 'cake_display', x: -3.4, y: 1.14, z: 3.2, rotY: 1.2, scale: 1.45 },
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
      // Palm Conservatory Dining
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
        z: 4.8,
        yaw: -Math.PI * 0.5,
        variantIndex: 24,
        lines: ['Carlos: "Best sunlit conservatory in Coral Heights. Try Diego’s pastelitos in the back kitchen!"'],
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
      },
    ],
    doorways: [
      { axis: 'x', coord: -11, min: -1.5, max: 3.5, height: 3.8, frameColor: 0x161822, accentNeon: 0x2cf3ff },
      { axis: 'z', coord: -6, min: -2.8, max: 2.8, height: 3.8, frameColor: 0x2b2e38 },
    ],
    colliders: [
      // Atrium central sculpture plinth
      { minX: -2.4, maxX: 2.4, minZ: -0.6, maxZ: 2.8, minY: 0, maxY: 2.4 },
      // Atrium curator desk
      { minX: 5.4, maxX: 8.6, minZ: 4.8, maxZ: 6.4, minY: 0, maxY: 1.4 },
      // Darkroom central monolith cluster
      { minX: -18.8, maxX: -16.2, minZ: -1.6, maxZ: 1.6, minY: 0, maxY: 4.2 },
      // Studio loft worktable
      { minX: -6.8, maxX: -3.2, minZ: -13.8, maxZ: -11.4, minY: 0, maxY: 1.2 },
      // Studio loft chill sofa nook
      { minX: 4.4, maxX: 8.8, minZ: -16.8, maxZ: -12.4, minY: 0, maxY: 1.3 },
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
      // Darkroom Light Installation Wing
      { kind: 'gallery_bench', x: -17.5, z: 5.4, rotY: Math.PI, scale: 1.35 },
      { kind: 'gallery_bench', x: -17.5, z: -5.4, rotY: 0, scale: 1.35 },
      { kind: 'stage_lights', x: -21.5, y: 0, z: -5.5, rotY: Math.PI * 0.25, scale: 0.85 },
      // Artist Studio Loft
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

/** Returns the specific room the point (x, z) is inside (or closest room if in a doorway). */
export function getInteriorRoomAt(def: InteriorDef, x: number, z: number): InteriorRoomDef {
  for (const r of def.rooms) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return r;
    }
  }
  let best = def.rooms[0];
  let bestDist = Infinity;
  for (const r of def.rooms) {
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

function isPointInsideVenueFloor(def: InteriorDef, x: number, z: number, margin = 0.25): boolean {
  for (const r of def.rooms) {
    if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) {
      return true;
    }
  }
  return false;
}

/**
 * Steps player walking, sprinting, jumping & solid multi-room wall/furniture/NPC collisions.
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

  const radius = 0.44;

  // 1. Resolve all perimeter & multi-room partition walls (with smooth doorway cutouts)
  for (let pass = 0; pass < 2; pass++) {
    for (const wall of def.walls) {
      const res = resolveCircleAABB(nextX, nextZ, radius, wall);
      if (res.hit) {
        nextX += res.dx;
        nextZ += res.dz;
      }
    }
  }

  // 2. Solid interior furniture, bar counters, beds, & sculpture pedestals
  for (const box of def.colliders) {
    const res = resolveCircleAABB(nextX, nextZ, radius, box);
    if (res.hit) {
      nextX += res.dx;
      nextZ += res.dz;
    }
  }

  // 3. Solid indoor NPC bodies
  const npcMinDist = 0.84;
  for (const npc of def.npcs) {
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

  // 4. Safety guard: never escape outside the union of room footprints
  if (!isPointInsideVenueFloor(def, nextX, nextZ, 0.1)) {
    nextX = prevX;
    nextZ = prevZ;
  }

  p.x = nextX;
  p.z = nextZ;
  p.vx = (nextX - prevX) / safeDt;
  p.vz = (nextZ - prevZ) / safeDt;

  const floorY = INTERIOR_ORIGIN_Y;
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

function createSunsetOceanViewTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 155);
  sky.addColorStop(0, '#1e2758');
  sky.addColorStop(0.5, '#c44b7a');
  sky.addColorStop(1, '#ff9c63');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 155);

  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.arc(256, 128, 36, 0, Math.PI * 2);
  ctx.fill();

  const sea = ctx.createLinearGradient(0, 155, 0, 256);
  sea.addColorStop(0, '#2e4c7d');
  sea.addColorStop(1, '#0d1e38');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 155, 512, 101);

  ctx.fillStyle = 'rgba(255, 196, 120, 0.55)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(210 + i * 4, 160 + i * 10, 92 - i * 8, 4);
  }

  // Palm silhouettes along the horizon
  ctx.fillStyle = '#121224';
  for (const px of [70, 130, 390, 445]) {
    ctx.fillRect(px - 3, 110, 6, 65);
    ctx.beginPath();
    ctx.arc(px, 110, 18, Math.PI, Math.PI * 2);
    ctx.fill();
  }

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
  // Position right on the actual building facade wall!
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

  // 1. Deep architectural portal surround bolted flush against the building facade
  const surround = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.4, 0.5), frameMat);
  surround.position.set(0, 2.2, 0.2);
  group.add(surround);

  // 2. Warm/neon glowing recessed interior glass double doors + flanking showcase windows!
  const doorGlowColor =
    sf.style === 'neon-club'
      ? 0xc62cff
      : sf.style === 'modern-gallery'
        ? 0xfff8eb
        : 0xffd596;
  const glassMat = new THREE.MeshStandardMaterial({
    color: doorGlowColor,
    emissive: doorGlowColor,
    emissiveIntensity: sf.style === 'neon-club' ? 0.85 : 0.72,
    roughness: 0.12,
    metalness: 0.2,
  });

  // Double doors (center)
  for (const sx of [-0.72, 0.72]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.32, 2.75, 0.08), glassMat);
    leaf.position.set(sx, 1.45, 0.45);
    group.add(leaf);

    // Metallic door mullions & handles
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0xf4d078, metalness: 0.9, roughness: 0.2 }),
    );
    handle.position.set(sx > 0 ? 0.18 : -0.18, 1.25, 0.54);
    group.add(handle);
  }
  const doorDivider = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.85, 0.14), frameMat);
  doorDivider.position.set(0, 1.45, 0.48);
  group.add(doorDivider);

  // Flanking lit storefront windows (left & right of doors)
  for (const wx of [-2.8, 2.8]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 0.08), glassMat);
    win.position.set(wx, 1.75, 0.45);
    group.add(win);
  }

  // 3. Projecting Marquee Canopy / Striped Awning + Illuminated Signboard!
  const canopyDepth = sf.style === 'art-deco-hotel' ? 2.5 : sf.style === 'cuban-cafe' ? 2.1 : 1.9;
  const canopyMat = new THREE.MeshStandardMaterial({
    color:
      sf.style === 'cuban-cafe'
        ? 0xc44b2c
        : sf.style === 'art-deco-hotel'
          ? 0x261d2e
          : 0x161822,
    roughness: 0.45,
    metalness: sf.style === 'cuban-cafe' ? 0.1 : 0.55,
  });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.42, canopyDepth), canopyMat);
  canopy.position.set(0, 3.6, canopyDepth * 0.5 + 0.1);
  group.add(canopy);

  // Illuminated venue sign right on front of the marquee!
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 1.45),
    new THREE.MeshBasicMaterial({ map: signTex }),
  );
  signMesh.position.set(0, 4.35, canopyDepth + 0.12);
  group.add(signMesh);

  const signBack = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.6, 0.24), frameMat);
  signBack.position.set(0, 4.35, canopyDepth - 0.02);
  group.add(signBack);

  // 4. Venue-specific streetfront architectural flair!
  if (sf.style === 'art-deco-hotel') {
    // Red velvet entrance runner carpet out onto Ocean Drive sidewalk
    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.04, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x8f1a2d, roughness: 0.85 }),
    );
    carpet.position.set(0, 0.02, 2.0);
    group.add(carpet);

    // Gold canopy trim tubes
    const neonTrim = new THREE.Mesh(
      new THREE.BoxGeometry(8.7, 0.1, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xff6ca8 }),
    );
    neonTrim.position.set(0, 3.45, canopyDepth + 0.14);
    group.add(neonTrim);

    propMountSlots.push(
      { kind: 'potted_plant_1', pos: new THREE.Vector3(-2.0, 0, 1.5), rotY: 0, scale: 1.35 },
      { kind: 'potted_plant_1', pos: new THREE.Vector3(2.0, 0, 1.5), rotY: 0.8, scale: 1.35 },
    );
  } else if (sf.style === 'neon-club') {
    // Pulsing hot-pink & cyan neon portal frame
    const pinkBar = new THREE.Mesh(
      new THREE.BoxGeometry(8.7, 0.12, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xff2e93 }),
    );
    pinkBar.position.set(0, 3.55, canopyDepth + 0.14);
    group.add(pinkBar);

    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x2cf3ff });
    for (const sx of [-1.65, 1.65]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 0.1), cyanMat);
      post.position.set(sx, 1.6, 0.56);
      group.add(post);

      // Velvet-rope VIP stanchions on the sidewalk
      const stanchion = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.16, 0.95, 10),
        new THREE.MeshStandardMaterial({ color: 0xe6c366, metalness: 0.9, roughness: 0.2 }),
      );
      stanchion.position.set(sx * 1.15, 0.48, 2.4);
      group.add(stanchion);

      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 1.7, 8),
        new THREE.MeshStandardMaterial({ color: 0xb81845, roughness: 0.7 }),
      );
      rope.rotation.x = Math.PI * 0.5;
      rope.position.set(sx * 1.15, 0.76, 1.55);
      group.add(rope);
    }
  } else if (sf.style === 'cuban-cafe') {
    // Striped terracotta & cream awning accents
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf7ebd4, roughness: 0.6 });
    for (let x = -3.5; x <= 3.5; x += 1.4) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.44, canopyDepth + 0.04), stripeMat);
      stripe.position.set(x, 3.6, canopyDepth * 0.5 + 0.1);
      group.add(stripe);
    }
    propMountSlots.push(
      { kind: 'chalkboard', pos: new THREE.Vector3(-2.3, 0, 1.5), rotY: 0.35, scale: 1.05 },
      { kind: 'potted_plant_2', pos: new THREE.Vector3(2.2, 0, 1.4), rotY: 0, scale: 1.2 },
    );
  } else {
    // Sleek modern gallery architectural step & accent light bar
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.1, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xd8dce4, roughness: 0.45 }),
    );
    step.position.set(0, 0.05, 1.3);
    group.add(step);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffcf5c }),
    );
    bar.position.set(0, 3.4, canopyDepth + 0.14);
    group.add(bar);
    propMountSlots.push(
      { kind: 'potted_plant_1', pos: new THREE.Vector3(-2.6, 0, 1.4), rotY: 0, scale: 1.2 },
      { kind: 'potted_plant_1', pos: new THREE.Vector3(2.6, 0, 1.4), rotY: 1.1, scale: 1.2 },
    );
  }

  // 5. Crisp glowing doorway threshold ring right in front of the double doors
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

interface BuiltVenue {
  def: InteriorDef;
  group: THREE.Group;
  propsRoot: THREE.Group;
  npcs: BuiltNpcHandle[];
  danceFloorMat?: THREE.MeshStandardMaterial;
  lasers?: THREE.Mesh[];
  monolithMats?: THREE.MeshStandardMaterial[];
  exitRing: THREE.Mesh;
}

export interface InteriorSystemHandles {
  outdoorMarkersRoot: THREE.Group;
  attachGltfNpcs: (clonePedestrian: (variantIndex: number) => ClonedPerson | null) => void;
  attachGltfProps: (propsMap: Map<InteriorPropKind, THREE.Group>) => void;
  setActiveInterior: (id: InteriorId | null) => void;
  update: (elapsed: number, dt: number, activeId: InteriorId | null, playerX: number, playerZ: number) => void;
}

function buildVenueGeometry(def: InteriorDef): BuiltVenue {
  const group = new THREE.Group();
  group.position.set(0, INTERIOR_ORIGIN_Y, 0);
  group.visible = false;

  // 1. Build every individual room's floor, ceiling, and tailored lighting!
  for (const room of def.rooms) {
    const rw = room.maxX - room.minX;
    const rd = room.maxZ - room.minZ;
    const cx = (room.minX + room.maxX) * 0.5;
    const cz = (room.minZ + room.maxZ) * 0.5;

    const floorTex = createFloorTileTexture(room.floorColorA, room.floorColorB, 4);
    floorTex.repeat.set(Math.max(2, Math.round(rw / 3)), Math.max(2, Math.round(rd / 3)));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(rw, rd),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: room.floorRoughness ?? 0.4,
        metalness: room.floorMetalness ?? 0.08,
      }),
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.set(cx, 0, cz);
    group.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(rw, rd),
      new THREE.MeshStandardMaterial({ color: room.ceilingColor, roughness: 0.85 }),
    );
    ceil.rotation.x = Math.PI * 0.5;
    ceil.position.set(cx, room.height, cz);
    group.add(ceil);

    // Room-specific overhead lighting
    const roomLight = new THREE.PointLight(
      room.lightColor,
      room.lightIntensity * 20,
      Math.max(rw, rd) * 1.4,
      1.35,
    );
    roomLight.position.set(cx, room.height - 0.8, cz);
    group.add(roomLight);
  }

  // Venue-wide soft bounce fill
  const primaryRoom = def.rooms[0];
  const hemi = new THREE.HemisphereLight(primaryRoom.lightColor, 0x202230, primaryRoom.ambientIntensity);
  group.add(hemi);

  // 2. Build all perimeter & multi-room partition walls cleanly split around every doorway!
  const wallSegs = computeRoomWallSegments(def.rooms, def.doorways);
  const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x221d26, roughness: 0.5, metalness: 0.2 });

  for (const seg of wallSegs) {
    const len = seg.end - seg.start;
    if (len < 0.05) continue;
    const mid = (seg.start + seg.end) * 0.5;
    const mat = new THREE.MeshStandardMaterial({ color: seg.wallColor, roughness: 0.78 });

    const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(len, seg.height), mat);
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.06), baseboardMat);

    if (seg.axis === 'x') {
      wallMesh.position.set(seg.coord, seg.height * 0.5, mid);
      wallMesh.rotation.y = seg.outwardSign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
      baseboard.rotation.y = Math.PI * 0.5;
      baseboard.position.set(seg.coord - seg.outwardSign * 0.03, 0.11, mid);
    } else {
      wallMesh.position.set(mid, seg.height * 0.5, seg.coord);
      wallMesh.rotation.y = seg.outwardSign > 0 ? Math.PI : 0;
      baseboard.position.set(mid, 0.11, seg.coord - seg.outwardSign * 0.03);
    }
    group.add(wallMesh, baseboard);
  }

  // 3. Build architectural Doorway Archways, Frames & Upper Header Transoms (zero gaps to void!)
  for (const dw of def.doorways) {
    const span = dw.max - dw.min;
    const mid = (dw.min + dw.max) * 0.5;
    const frameMat = new THREE.MeshStandardMaterial({
      color: dw.frameColor,
      roughness: 0.3,
      metalness: 0.65,
    });

    // Find tallest adjacent room to seal transom header cleanly
    const adjacentRooms = def.rooms.filter((r) =>
      dw.axis === 'x'
        ? Math.abs(r.minX - dw.coord) < 0.1 || Math.abs(r.maxX - dw.coord) < 0.1
        : Math.abs(r.minZ - dw.coord) < 0.1 || Math.abs(r.maxZ - dw.coord) < 0.1,
    );
    const maxH = Math.max(...adjacentRooms.map((r) => r.height), dw.height + 0.4);
    const headerH = Math.max(0.25, maxH - dw.height);

    const header = new THREE.Mesh(
      new THREE.BoxGeometry(dw.axis === 'z' ? span + 0.35 : 0.36, headerH, dw.axis === 'x' ? span + 0.35 : 0.36),
      new THREE.MeshStandardMaterial({ color: adjacentRooms[0]?.wallColor ?? 0x222530, roughness: 0.78 }),
    );
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(dw.axis === 'z' ? span + 0.35 : 0.44, 0.22, dw.axis === 'x' ? span + 0.35 : 0.44),
      frameMat,
    );

    if (dw.axis === 'x') {
      header.position.set(dw.coord, dw.height + headerH * 0.5, mid);
      lintel.position.set(dw.coord, dw.height, mid);
      for (const edgeZ of [dw.min, dw.max]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.42, dw.height, 0.22), frameMat);
        jamb.position.set(dw.coord, dw.height * 0.5, edgeZ);
        group.add(jamb);
      }
    } else {
      header.position.set(mid, dw.height + headerH * 0.5, dw.coord);
      lintel.position.set(mid, dw.height, dw.coord);
      for (const edgeX of [dw.min, dw.max]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.22, dw.height, 0.42), frameMat);
        jamb.position.set(edgeX, dw.height * 0.5, dw.coord);
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
      strip.position.set(dw.axis === 'x' ? dw.coord : mid, dw.height - 0.08, dw.axis === 'x' ? mid : dw.coord);
      group.add(strip);
    }
  }

  // 4. Illuminated Front Exit Double Doors + Glowing Green Exit Threshold Ring
  const exitRoom = getInteriorRoomAt(def, def.exitX, def.exitZ);
  const exitWallZ = exitRoom.maxZ;
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x1a1e2a, roughness: 0.3, metalness: 0.7 });
  const exitDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 2.8, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0x263850,
      emissive: 0x3a648a,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.5,
    }),
  );
  exitDoorMesh.position.set(def.exitX, 1.4, exitWallZ - 0.08);
  const exitSignTex = createSignTexture('EXIT', 'PRESS [E] TO STEP OUTSIDE', '#0c261d', '#46f7b4', '#46f7b4');
  const exitSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.55),
    new THREE.MeshBasicMaterial({ map: exitSignTex }),
  );
  exitSign.position.set(def.exitX, 3.15, exitWallZ - 0.12);
  exitSign.rotation.y = Math.PI;
  group.add(exitDoorMesh, exitSign);

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
  exitRing.position.set(def.exitX, 0.04, def.exitZ);
  group.add(exitRing);

  // 5. Architectural Built-Ins & Hero Setpieces (bars, counters, stages, panoramic windows, art canvases)
  let danceFloorMat: THREE.MeshStandardMaterial | undefined;
  let lasers: THREE.Mesh[] | undefined;
  let monolithMats: THREE.MeshStandardMaterial[] | undefined;

  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6b958, metalness: 0.85, roughness: 0.22 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x422619, roughness: 0.42, metalness: 0.12 });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf4eee6, roughness: 0.22, metalness: 0.08 });

  if (def.id === 'hotel-solaire') {
    // Atrium Art Deco Brass Reception Desk
    const desk = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.12, 1.6), darkWoodMat);
    desk.position.set(-5.9, 0.56, 2.4);
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.1, 1.8), marbleMat);
    deskTop.position.set(-5.9, 1.16, 2.4);
    const deskTrim = new THREE.Mesh(new THREE.BoxGeometry(5.26, 0.12, 1.66), goldMat);
    deskTrim.position.set(-5.9, 0.9, 2.4);
    group.add(desk, deskTop, deskTrim);

    // Ocean Cocktail Lounge Mahogany Bar Counter
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 9.2), darkWoodMat);
    bar.position.set(20.5, 0.55, 2.9);
    const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 9.4), marbleMat);
    barTop.position.set(20.5, 1.14, 2.9);
    const barFootRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 9.2, 8), goldMat);
    barFootRail.rotation.x = Math.PI * 0.5;
    barFootRail.position.set(19.52, 0.22, 2.9);
    group.add(bar, barTop, barFootRail);

    // Penthouse Suite Panoramic Backlit Miami Ocean Sunset Window!
    const sunsetTex = createSunsetOceanViewTexture();
    const panoWindow = new THREE.Mesh(
      new THREE.PlaneGeometry(14.5, 3.2),
      new THREE.MeshBasicMaterial({ map: sunsetTex }),
    );
    panoWindow.position.set(0, 2.2, -15.88);
    group.add(panoWindow);

    for (const mx of [-7.25, -2.4, 2.4, 7.25]) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.3, 0.16), doorFrameMat);
      mullion.position.set(mx, 2.2, -15.82);
      group.add(mullion);
    }

    // Art Deco Accent Pillars in Grand Atrium
    for (const [px, pz] of [
      [-9.2, 5.0],
      [9.2, 9.2],
      [-9.2, 11.2],
      [9.2, 11.2],
    ]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 6.4, 14), marbleMat);
      col.position.set(px, 3.2, pz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.28, 14), goldMat);
      cap.position.set(px, 6.1, pz);
      group.add(col, cap);
    }
  } else if (def.id === 'club-neon') {
    // Velvet Entry Tunnel Glowing Neon Ribs!
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

    // Elevated DJ Stage + Console + LED Backdrop
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(11.4, 0.9, 4.4),
      new THREE.MeshStandardMaterial({ color: 0x161426, roughness: 0.4, metalness: 0.4 }),
    );
    stage.position.set(0, 0.45, -9.2);
    const djDesk = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 1.05, 1.15),
      new THREE.MeshStandardMaterial({
        color: 0x0e0f1c,
        emissive: 0xff2e93,
        emissiveIntensity: 0.55,
        roughness: 0.22,
      }),
    );
    djDesk.position.set(0, 1.42, -7.5);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 4.5),
      new THREE.MeshBasicMaterial({ map: createSignTexture('CLUB NEON', 'VICE WAVE 98.5 LIVE', '#0c071a', '#2cf3ff', '#ff2e93') }),
    );
    backdrop.position.set(0, 3.6, -11.88);
    group.add(stage, djDesk, backdrop);

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

    // VIP Lounge Glowing Neon Bar Counter
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
    group.add(vipBar, vipBarTop);
  } else if (def.id === 'cafe-habana') {
    // Warm Espresso & Bakery Counter
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.08, 1.8), darkWoodMat);
    counter.position.set(-4.1, 0.54, 3.2);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.1, 2.0), marbleMat);
    counterTop.position.set(-4.1, 1.12, 3.2);
    group.add(counter, counterTop);

    // Conservatory Overhead Skylight Beams
    const skyLightMat = new THREE.MeshBasicMaterial({ color: 0xe6f8ff });
    for (const sx of [11.5, 15.0, 18.5]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9.5), skyLightMat);
      panel.rotation.x = Math.PI * 0.5;
      panel.position.set(sx, 4.76, 4.5);
      group.add(panel);
    }

    // Kitchen Stainless Prep Island
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.8, roughness: 0.25 });
    const island = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.02, 1.6), steelMat);
    island.position.set(-0.9, 0.51, -5.3);
    group.add(island);

    // Framed Vintage Havana Art on Conservatory Wall
    for (let i = 0; i < 3; i++) {
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 1.4),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(i + 1) }),
      );
      art.position.set(10.8 + i * 4.0, 2.4, -1.88);
      group.add(art);
    }
  } else {
    // Wynwood Art Gallery — Main Atrium Dual Sculpture Pedestal
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.15, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xf0f2f7, roughness: 0.35 }),
    );
    plinth.position.set(0, 0.575, 1.1);
    group.add(plinth);

    // Framed Miami Pop-Art Canvases across White-Cube Atrium Walls
    const canvasSpots: [number, number, number, number][] = [
      [-6.5, 2.8, -5.88, 0],
      [6.5, 2.8, -5.88, 0],
      [10.88, 2.8, -1.5, -Math.PI * 0.5],
      [10.88, 2.8, 3.5, -Math.PI * 0.5],
      [-10.88, 2.8, -4.0, Math.PI * 0.5],
      [-10.88, 2.8, 6.2, Math.PI * 0.5],
    ];
    canvasSpots.forEach(([x, y, z, ry], idx) => {
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 2.4),
        new THREE.MeshBasicMaterial({ map: createGalleryArtworkTexture(idx) }),
      );
      art.position.set(x, y, z);
      art.rotation.y = ry;
      group.add(art);
    });

    // Darkroom Wing: 5 Glowing Animated Neon Light Monoliths + Reflective Floor Rings!
    monolithMats = [];
    const monoCoords: [number, number, number][] = [
      [-17.5, 0, 0x2cf3ff],
      [-15.2, -4.5, 0xff2e93],
      [-20.5, -4.2, 0xa855f7],
      [-15.2, 4.5, 0xffcf5c],
      [-20.5, 4.2, 0x46f7b4],
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

  // Indoor NPC mount points
  const npcs: BuiltNpcHandle[] = [];
  for (const nDef of def.npcs) {
    const npcRoot = new THREE.Group();
    npcRoot.position.set(nDef.x, 0, nDef.z);
    npcRoot.rotation.y = -nDef.yaw;
    group.add(npcRoot);
    npcs.push({ def: nDef, root: npcRoot, rig: null });
  }

  return { def, group, propsRoot, npcs, danceFloorMat, lasers, monolithMats, exitRing };
}

export function createInteriorSystem(scene: THREE.Scene): InteriorSystemHandles {
  const venues = new Map<InteriorId, BuiltVenue>();
  const outdoorMarkersRoot = new THREE.Group();
  const storefronts: OutdoorStorefrontHandle[] = [];

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

    attachGltfProps(propsMap) {
      // Populate every indoor room with photorealistic CC0 3D furniture & prop GLBs!
      for (const venue of venues.values()) {
        for (const p of venue.def.props) {
          const src = propsMap.get(p.kind);
          if (!src) continue;
          const instance = src.clone(true);
          instance.position.set(p.x, p.y ?? 0, p.z);
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

    setActiveInterior(id: InteriorId | null) {
      outdoorMarkersRoot.visible = id === null;
      for (const [vid, venue] of venues) {
        venue.group.visible = vid === id;
      }
    },

    update(elapsed: number, dt: number, activeId: InteriorId | null, playerX: number, playerZ: number) {
      if (activeId === null) {
        for (const sf of storefronts) {
          const s = 1 + Math.sin(elapsed * 3.0 + sf.phase) * 0.08;
          sf.thresholdRing.scale.set(s, s, 1);
        }
        return;
      }

      const venue = venues.get(activeId);
      if (!venue) return;

      const exitPulse = 1 + Math.sin(elapsed * 3.6) * 0.1;
      venue.exitRing.scale.set(exitPulse, exitPulse, 1);

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

      // Animate indoor NPCs & subtly turn them toward you when you approach to talk!
      for (let i = 0; i < venue.npcs.length; i++) {
        const handle = venue.npcs[i];
        if (!handle.rig) continue;

        const dx = playerX - handle.def.x;
        const dz = playerZ - handle.def.z;
        const d = Math.hypot(dx, dz);
        const targetYaw = d < 4.5 ? yawFromDir(dx, dz) : handle.def.yaw;
        const curYaw = -handle.root.rotation.y;
        const nextYaw = lerpAngle(curYaw, targetYaw, clamp(dt * 5.0, 0, 1));
        handle.root.rotation.y = -nextYaw;

        if (handle.def.dancing) {
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
