import { clamp, createRng, type AABB, type OBB2D } from '../core/math';
import type {
  BeachPropSpec,
  BuildingSpec,
  BuildingStyle,
  CityBlueprint,
  DistrictId,
  DistrictInfo,
  OutdoorBenchSpec,
  OutdoorBillboardSpec,
  OutdoorBollardSpec,
  OutdoorCafeSetSpec,
  OutdoorHydrantSpec,
  OutdoorLoungerSpec,
  OutdoorMarqueeSpec,
  OutdoorPlanterSpec,
  OutdoorTrafficSignalSpec,
  PalmSpec,
  RoadSegment,
  StreetLightSpec,
  TrafficNode,
  YachtSpec,
} from './types';

export const AVENUE_XS = [-380, -290, -200, -110, -20, 70, 140];
export const STREET_ZS = [-380, -290, -200, -110, -20, 70, 160];
export const ROAD_WIDTH = 16;
export const SIDEWALK_WIDTH = 4;
export const SIDEWALK_HEIGHT = 0.22;
export const BOARDWALK_HEIGHT = 0.14;
export const SEAWALL_HEIGHT = 0.24;

/**
 * Natural scalloped Miami Beach shoreline curve (world X of waterline as a function of Z).
 * Shared identically by beach terrain geometry, deep-water collision, and ocean surf shader.
 */
export function getShorelineX(z: number): number {
  return 203.5 + Math.sin(z * 0.018) * 5.5 + Math.cos(z * 0.041 + 0.7) * 2.5;
}

/**
 * Deterministic sculpted 3D sand dune & foreshore elevation for Sol Beach (x >= 165).
 * Shared identically by the high-resolution beach mesh and player/vehicle ground physics
 * so feet, tires, umbrellas, and lifeguard towers rest flush on the sand curves.
 */
export function getBeachHeight(x: number, z: number): number {
  const shoreX = getShorelineX(z);
  const startX = 165.5;

  // Smooth transition off the boardwalk edge (0.14m) into the coastal dune zone
  const fromBoardwalk = clamp((x - startX) / 5.5, 0, 1);
  const boardBlend = fromBoardwalk * fromBoardwalk * (3 - 2 * fromBoardwalk);

  // Rolling wind-sculpted coastal dunes concentrated behind the foreshore berm (x ~ 170..192)
  const duneBand = Math.exp(-Math.pow((x - 177.5) / 8.8, 2));
  const duneWave =
    Math.sin(z * 0.055 + x * 0.09) * 0.36 +
    Math.cos(z * 0.115 - x * 0.065 + 1.1) * 0.22 +
    Math.sin(z * 0.024 + 0.4) * 0.18;
  // Keep a gentler carved pathway right by the South Pier entrance
  const pierFlatten = 1 - 0.85 * Math.exp(-Math.pow((z - SOUTH_PIER.centerZ) / 14, 2));
  const duneLift = (0.58 + duneWave) * duneBand * pierFlatten;

  // Mid-beach sunbathing berm gently sloping down toward the curving surf line
  const shoreT = (x - startX) / Math.max(12, shoreX - startX);
  let baseSlope: number;
  if (shoreT <= 0.72) {
    // Gentle wide upper/mid beach terrace (+0.14m -> +0.28m -> +0.16m)
    const u = clamp(shoreT / 0.72, 0, 1);
    baseSlope = BOARDWALK_HEIGHT + Math.sin(u * Math.PI) * 0.18;
  } else if (shoreT <= 1.0) {
    // Smooth foreshore wet-sand slope down to waterline (y = -0.08m at shoreX)
    const u = (shoreT - 0.72) / 0.28;
    const smoothU = u * u * (3 - 2 * u);
    baseSlope = BOARDWALK_HEIGHT * (1 - smoothU) - 0.08 * smoothU;
  } else {
    // Natural seabed shelving cleanly under the turquoise Atlantic ocean
    const offshoreDist = x - shoreX;
    baseSlope = -0.08 - Math.min(2.2, offshoreDist * 0.11);
  }

  // Subtle organic micro-undulation across the sand terrace
  const microRipple =
    (Math.sin(x * 0.22 + z * 0.17) * 0.045 + Math.cos(x * 0.13 - z * 0.29) * 0.035) *
    boardBlend *
    clamp(1.15 - shoreT, 0, 1);

  return BOARDWALK_HEIGHT * (1 - boardBlend) + (baseSlope + duneLift + microRipple) * boardBlend;
}

export const KEY_SOL_BOUNDS = {
  minX: 246,
  maxX: 356,
  minZ: -272,
  maxZ: -128,
  baseY: 0.6,
};

export const SOUTH_PIER = {
  startX: 152,
  rampEndX: 168,
  endX: 286,
  centerZ: 160,
  halfWidth: 7,
  deckY: 1.25,
};

export const CAUSEWAY = {
  startX: 150,
  endX: 250,
  centerZ: -200,
  halfWidth: 9.5,
  peakY: 4.0,
};

export const DISTRICTS: Record<DistrictId, DistrictInfo> = {
  'ocean-drive': {
    id: 'ocean-drive',
    name: 'Ocean Drive',
    tagline: 'Pastel Art Deco hotels & palm-lined coastal boulevard',
  },
  'sol-beach': {
    id: 'sol-beach',
    name: 'Sol Beach & Boardwalk',
    tagline: 'Golden sand, turquoise surf & sunset boardwalk',
  },
  'south-pier': {
    id: 'south-pier',
    name: 'South Pier',
    tagline: 'Wooden Atlantic pier & beacon pavilion',
  },
  'neon-strip': {
    id: 'neon-strip',
    name: 'Neon Strip',
    tagline: 'Midtown nightlife, clubs & electric marquees',
  },
  'palm-plaza': {
    id: 'palm-plaza',
    name: 'Palm Plaza',
    tagline: 'Central fountain square & tropical courtyard',
  },
  'downtown-biscayne': {
    id: 'downtown-biscayne',
    name: 'Downtown Biscayne',
    tagline: 'Reflective glass towers & coastal skyline',
  },
  'key-sol': {
    id: 'key-sol',
    name: 'Key Sol',
    tagline: 'Causeway bridge & luxury island villas',
  },
  'marina-cove': {
    id: 'marina-cove',
    name: 'Marina Cove',
    tagline: 'Harbor promenade, boat slips & coastal yachts',
  },
  'wynwood-arts': {
    id: 'wynwood-arts',
    name: 'Wynwood Arts',
    tagline: 'Street-art mural warehouses, galleries & Sol Coast Arena',
  },
  'coral-heights': {
    id: 'coral-heights',
    name: 'Coral Heights',
    tagline: 'Terracotta Mediterranean boulevards & Coral Park courts',
  },
  'north-beach': {
    id: 'north-beach',
    name: 'North Beach',
    tagline: 'Wave-balcony resort towers overlooking North Bay',
  },
};

export const ALL_DISTRICT_IDS = Object.keys(DISTRICTS) as DistrictId[];

/**
 * Computes walkable/drivable ground elevation at world coordinate (x, z).
 */
export function getGroundHeight(x: number, z: number): number {
  // South Pier (smooth ramp rising from boardwalk deck up to elevated pier deck)
  if (
    x >= SOUTH_PIER.startX &&
    x <= SOUTH_PIER.endX &&
    Math.abs(z - SOUTH_PIER.centerZ) <= SOUTH_PIER.halfWidth
  ) {
    if (x < SOUTH_PIER.rampEndX) {
      const t = (x - SOUTH_PIER.startX) / (SOUTH_PIER.rampEndX - SOUTH_PIER.startX);
      return BOARDWALK_HEIGHT + t * (SOUTH_PIER.deckY - BOARDWALK_HEIGHT);
    }
    return SOUTH_PIER.deckY;
  }

  // Key Sol Causeway bridge arch
  if (
    x >= CAUSEWAY.startX &&
    x <= CAUSEWAY.endX &&
    Math.abs(z - CAUSEWAY.centerZ) <= CAUSEWAY.halfWidth
  ) {
    const t = (x - CAUSEWAY.startX) / (CAUSEWAY.endX - CAUSEWAY.startX);
    const arch = Math.sin(t * Math.PI) * CAUSEWAY.peakY;
    const baseBlend = t * KEY_SOL_BOUNDS.baseY;
    return baseBlend + arch;
  }

  // Key Sol luxury island
  if (
    x >= KEY_SOL_BOUNDS.minX - 4 &&
    x <= KEY_SOL_BOUNDS.maxX + 4 &&
    z >= KEY_SOL_BOUNDS.minZ - 4 &&
    z <= KEY_SOL_BOUNDS.maxZ + 4
  ) {
    return KEY_SOL_BOUNDS.baseY;
  }

  // Marina Cove wooden yacht piers & smooth approach ramps from promenade
  if (z >= 187 && z <= 242 && isOnMarinaDock(x, Math.max(z, 190))) {
    if (z < 194) {
      const t = clamp((z - 187) / 7, 0, 1);
      return t * 0.45;
    }
    return 0.45;
  }

  // Marina Cove waterfront seawall promenade edge (low walkable curb, never knee-high!)
  if (z >= 190.4 && z <= 193.2 && x >= -428 && x <= 160) {
    return SEAWALL_HEIGHT;
  }

  // North Bay waterfront seawall promenade (east edge north of Causeway & north rim)
  if (x >= 153.2 && x <= 156.2 && z >= -410 && z <= -212) {
    return SEAWALL_HEIGHT;
  }
  if (z >= -410.5 && z <= -407.5 && x >= -428 && x <= 156) {
    return SEAWALL_HEIGHT;
  }

  // Boardwalk Promenade (elevated timber walkway east of Ocean Drive)
  if (x >= 152 && x <= 165.5 && z >= -188 && z <= 188) {
    return BOARDWALK_HEIGHT;
  }

  // Sculpted Golden Sandy Beach with rolling dunes & curving surf line
  if (x > 165.5 && x <= 232 && z >= -186 && z <= 192) {
    return getBeachHeight(x, z);
  }

  // Raised city-block concrete sidewalks between roads
  if (isOnCityBlockSidewalk(x, z)) {
    return SIDEWALK_HEIGHT;
  }

  return 0;
}

export function isOnCityBlockSidewalk(x: number, z: number): boolean {
  const halfRoad = ROAD_WIDTH * 0.5 + 0.4;
  if (
    x < AVENUE_XS[0] + halfRoad ||
    x > AVENUE_XS[AVENUE_XS.length - 1] - halfRoad ||
    z < STREET_ZS[0] + halfRoad ||
    z > STREET_ZS[STREET_ZS.length - 1] - halfRoad
  ) {
    return false;
  }
  for (const ax of AVENUE_XS) {
    if (Math.abs(x - ax) < halfRoad) return false;
  }
  for (const sz of STREET_ZS) {
    if (Math.abs(z - sz) < halfRoad) return false;
  }
  return true;
}

export function isOnMarinaDock(x: number, z: number): boolean {
  if (z < 190 || z > 240) return false;
  const dockXs = [-75, -15, 45];
  for (const dx of dockXs) {
    if (Math.abs(x - dx) <= 4.5) return true;
  }
  return false;
}

/**
 * Returns true when (x, z) is deep water (ocean, bay lagoon, or marina basin)
 * where neither cars nor pedestrians may travel.
 */
export function isDeepWater(x: number, z: number): boolean {
  // On South Pier
  if (
    x >= SOUTH_PIER.startX &&
    x <= SOUTH_PIER.endX &&
    Math.abs(z - SOUTH_PIER.centerZ) <= SOUTH_PIER.halfWidth
  ) {
    return false;
  }

  // On Key Sol Causeway
  if (
    x >= CAUSEWAY.startX &&
    x <= CAUSEWAY.endX &&
    Math.abs(z - CAUSEWAY.centerZ) <= CAUSEWAY.halfWidth
  ) {
    return false;
  }

  // On Key Sol Island
  if (
    x >= KEY_SOL_BOUNDS.minX &&
    x <= KEY_SOL_BOUNDS.maxX &&
    z >= KEY_SOL_BOUNDS.minZ &&
    z <= KEY_SOL_BOUNDS.maxZ
  ) {
    return false;
  }

  // On Marina Cove Docks
  if (isOnMarinaDock(x, z)) {
    return false;
  }

  // Mainland peninsula boundary with natural curved eastern beach shoreline
  const shoreLimitX = z >= -186 && z <= 192 ? getShorelineX(z) + 1.5 : 156;
  const onMainland = x >= -428 && x <= shoreLimitX && z >= -410 && z <= 192.8;
  if (onMainland) {
    // Cutout North Bay inlet east of Ocean Drive (north of Z = -182) so Key Sol Causeway crosses open water
    if (x > 156 && z < -182) {
      return true;
    }
    return false;
  }

  return true;
}

export function getDistrictAt(x: number, z: number): DistrictInfo {
  if (x >= 180 && z <= -115) return DISTRICTS['key-sol'];
  if (x >= 216 && Math.abs(z - SOUTH_PIER.centerZ) <= 22) return DISTRICTS['south-pier'];
  if (z >= 168 && x < 216) return DISTRICTS['marina-cove'];
  if (x >= 152 && z > -186) return DISTRICTS['sol-beach'];
  if (z < -208) {
    if (x >= -65) return DISTRICTS['north-beach'];
    if (x >= -335) return DISTRICTS['wynwood-arts'];
    return DISTRICTS['coral-heights'];
  }
  if (x < -245) return DISTRICTS['coral-heights'];
  if (x >= -12 && x <= 62 && z >= -12 && z <= 62) return DISTRICTS['palm-plaza'];
  if (x >= 60 && x < 152) return DISTRICTS['ocean-drive'];
  if (x >= -75 && x < 60) return DISTRICTS['neon-strip'];
  return DISTRICTS['downtown-biscayne'];
}

export function isOnRoad(x: number, z: number): boolean {
  const half = ROAD_WIDTH * 0.5 + 1.5;
  // Main avenues
  for (const ax of AVENUE_XS) {
    if (Math.abs(x - ax) <= half && z >= -388 && z <= 168) return true;
  }
  // Main streets
  for (const sz of STREET_ZS) {
    if (Math.abs(z - sz) <= half && x >= -388 && x <= 148) return true;
  }
  // Causeway & Key Sol loop
  if (Math.abs(z - CAUSEWAY.centerZ) <= half && x >= 140 && x <= 268) return true;
  if (x >= 254 && x <= 346 && z >= -263 && z <= -137) {
    if (Math.abs(x - 262) <= half || Math.abs(x - 338) <= half) return true;
    if (Math.abs(z - -255) <= half || Math.abs(z - -145) <= half) return true;
  }
  return false;
}

const ART_DECO_WALLS = [0xffc6d9, 0xbef5e4, 0xc4ecff, 0xfff0c8, 0xe7d1ff, 0xffd7ba];
const ART_DECO_ACCENTS = [0xff5e8e, 0x2cf3ff, 0xffb347, 0x46f7b4, 0xd874ff];
const NEON_COLORS = [0xff2e93, 0x00f0ff, 0xffc83d, 0x52ffaa, 0xc35cff];
const SKYSCRAPER_WALLS = [0x264660, 0x2d5873, 0x1e3852, 0x355f7a, 0x2a4e68];
const VILLA_WALLS = [0xf8f5ef, 0xfff5e9, 0xedf6f9];
const MEDITERRANEAN_WALLS = [0xf6dcc0, 0xf2c6a0, 0xf7e6ce, 0xeebaa0, 0xf4d8ae];
const TERRACOTTA_ROOFS = [0xc25435, 0xb5482c, 0xcf633e, 0xa84126];
const RESORT_WALLS = [0xf2f7fb, 0xeaf4f8, 0xf7f9fc];
const MURAL_SEEDS = [0x110000, 0x110001, 0x110002, 0x110003];

export function createCityBlueprint(): CityBlueprint {
  const rng = createRng(3052026);
  const roads: RoadSegment[] = [];
  const buildings: BuildingSpec[] = [];
  const colliders: AABB[] = [];
  const propObbs: OBB2D[] = [];
  const palms: PalmSpec[] = [];
  const streetLights: StreetLightSpec[] = [];
  const yachts: YachtSpec[] = [];
  const beachProps: BeachPropSpec[] = [];
  const benches: OutdoorBenchSpec[] = [];
  const planters: OutdoorPlanterSpec[] = [];
  const sidewalkCafes: OutdoorCafeSetSpec[] = [];
  const hydrants: OutdoorHydrantSpec[] = [];
  const loungers: OutdoorLoungerSpec[] = [];
  const bollards: OutdoorBollardSpec[] = [];
  const trafficSignals: OutdoorTrafficSignalSpec[] = [];
  const billboards: OutdoorBillboardSpec[] = [];
  const marquees: OutdoorMarqueeSpec[] = [];

  // 1. Road network segments (expanded 7x7 coastal metropolis grid!)
  for (const ax of AVENUE_XS) {
    roads.push({ x1: ax, z1: -380, x2: ax, z2: 160, width: ROAD_WIDTH });
  }
  for (const sz of STREET_ZS) {
    roads.push({ x1: -380, z1: sz, x2: 140, z2: sz, width: ROAD_WIDTH });
  }
  // Key Sol Causeway bridge
  roads.push({ x1: 140, z1: -200, x2: 262, z2: -200, width: ROAD_WIDTH, isBridge: true });
  // Key Sol perimeter loop
  roads.push({ x1: 262, z1: -255, x2: 338, z2: -255, width: 13 });
  roads.push({ x1: 262, z1: -145, x2: 338, z2: -145, width: 13 });
  roads.push({ x1: 262, z1: -255, x2: 262, z2: -145, width: 13 });
  roads.push({ x1: 338, z1: -255, x2: 338, z2: -145, width: 13 });

  // 2. City block buildings (36 blocks spanning 11 distinct districts & 9 architectural styles!)
  const margin = ROAD_WIDTH * 0.5 + SIDEWALK_WIDTH + 3; // 15m from road center
  let buildingIdx = 0;

  for (let bx = 0; bx < AVENUE_XS.length - 1; bx++) {
    for (let bz = 0; bz < STREET_ZS.length - 1; bz++) {
      const minX = AVENUE_XS[bx] + margin;
      const maxX = AVENUE_XS[bx + 1] - margin;
      const minZ = STREET_ZS[bz] + margin;
      const maxZ = STREET_ZS[bz + 1] - margin;
      const centerX = (minX + maxX) * 0.5;
      const centerZ = (minZ + maxZ) * 0.5;

      // Landmark Open Park 1: Palm Plaza Central Park (-20..70, -20..70)
      if (AVENUE_XS[bx] === -20 && STREET_ZS[bz] === -20) {
        colliders.push({
          minX: centerX - 6.5,
          maxX: centerX + 6.5,
          minZ: centerZ - 6.5,
          maxZ: centerZ + 6.5,
          minY: 0,
          maxY: 4,
        });
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const r = 21 + (i % 2) * 4;
          palms.push({
            x: centerX + Math.cos(angle) * r,
            y: SIDEWALK_HEIGHT,
            z: centerZ + Math.sin(angle) * r,
            height: 8.5 + rng() * 3.5,
            leanX: (rng() - 0.5) * 0.14,
            leanZ: (rng() - 0.5) * 0.14,
            seed: rng() * 100,
          });
        }
        continue;
      }

      // Landmark Open Park 2: Coral Park & Outdoor Basketball Courts (-380..-290, -20..70)
      if (AVENUE_XS[bx] === -380 && STREET_ZS[bz] === -20) {
        // Spanish Courtyard Terracotta & Talavera Fountain on East lawn beside basketball court (-314, 25)
        colliders.push({
          minX: -315.8,
          maxX: -312.2,
          minZ: 23.2,
          maxZ: 26.8,
          minY: 0,
          maxY: 2.5,
        });
        for (let i = 0; i < 10; i++) {
          const angle = (i / 10) * Math.PI * 2;
          const r = 26;
          palms.push({
            x: centerX + Math.cos(angle) * r,
            y: SIDEWALK_HEIGHT,
            z: centerZ + Math.sin(angle) * r,
            height: 8.5 + rng() * 3.0,
            leanX: (rng() - 0.5) * 0.12,
            leanZ: (rng() - 0.5) * 0.12,
            seed: rng() * 100,
          });
        }
        continue;
      }

      // Landmark Arena Block: Sol Coast Stadium / Arena (-380..-290, -290..-200)
      if (AVENUE_XS[bx] === -380 && STREET_ZS[bz] === -290) {
        const w = 52;
        const d = 52;
        const h = 23;
        const collider: AABB = {
          minX: centerX - w * 0.5,
          maxX: centerX + w * 0.5,
          minZ: centerZ - d * 0.5,
          maxZ: centerZ + d * 0.5,
          minY: 0,
          maxY: h,
        };
        buildings.push({
          id: `stadium-arena`,
          x: centerX,
          z: centerZ,
          width: w,
          depth: d,
          height: h,
          baseY: SIDEWALK_HEIGHT,
          style: 'stadium',
          wallColor: 0xeaf0f7,
          accentColor: 0x00e5ff,
          neonColor: 0xff2e93,
          collider,
        });
        colliders.push(collider);
        continue;
      }

      // Determine neighborhood architectural style based on district block
      let style: BuildingStyle;
      if (bz <= 1) {
        if (bx >= 4) {
          style = 'resort-tower'; // North Beach oceanfront wave-balcony condos
        } else if (bx >= 1) {
          style = 'warehouse-mural'; // Wynwood Arts mural warehouses & galleries
        } else {
          style = 'mediterranean'; // Northwest Coral Heights
        }
      } else if (bx <= 1) {
        style = 'mediterranean'; // Coral Heights / Little Havana terracotta plazas
      } else if (bx === 2) {
        style = 'skyscraper'; // Downtown Biscayne glass financial skyline
      } else if (bx === 3) {
        style = rng() < 0.65 ? 'skyscraper' : 'neon-club';
      } else if (bx === 4) {
        style = 'neon-club'; // Neon Strip Midtown
      } else {
        style = 'art-deco'; // Iconic Ocean Drive Pastel Art Deco
      }

      // Varied urban block subdivisions so blocks aren't repetitive 2x2 grids!
      const cols =
        style === 'skyscraper' && rng() < 0.45
          ? 1
          : style === 'resort-tower' && rng() < 0.5
            ? 1
            : style === 'warehouse-mural' && rng() < 0.4
              ? 1
              : 2;
      const rows = style === 'resort-tower' && cols === 1 ? 1 : 2;
      const gap = 6.5;
      const cellW = (maxX - minX - gap * (cols - 1)) / cols;
      const cellD = (maxZ - minZ - gap * (rows - 1)) / rows;

      for (let cx = 0; cx < cols; cx++) {
        for (let cz = 0; cz < rows; cz++) {
          const w = cellW * (0.76 + rng() * 0.18);
          const d = cellD * (0.76 + rng() * 0.18);
          const x = minX + cx * (cellW + gap) + cellW * 0.5;
          const z = minZ + cz * (cellD + gap) + cellD * 0.5;

          let height: number;
          let wallColor: number;
          let accentColor: number;
          let neonColor: number | undefined;
          let hasRoofSign = false;

          if (style === 'skyscraper') {
            height = 38 + rng() * 48;
            wallColor = SKYSCRAPER_WALLS[Math.floor(rng() * SKYSCRAPER_WALLS.length)];
            accentColor = 0x5be3ff;
            neonColor = rng() < 0.7 ? NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)] : undefined;
          } else if (style === 'resort-tower') {
            height = 28 + rng() * 34;
            wallColor = RESORT_WALLS[Math.floor(rng() * RESORT_WALLS.length)];
            accentColor = 0x2cf3ff;
            neonColor = rng() < 0.8 ? 0x2cf3ff : 0xff70a6;
          } else if (style === 'warehouse-mural') {
            height = 8.5 + rng() * 6.5;
            wallColor = MURAL_SEEDS[Math.floor(rng() * MURAL_SEEDS.length)];
            accentColor = NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)];
            neonColor = rng() < 0.55 ? accentColor : undefined;
            hasRoofSign = rng() < 0.35;
          } else if (style === 'mediterranean') {
            height = 9.5 + rng() * 8.5;
            wallColor = MEDITERRANEAN_WALLS[Math.floor(rng() * MEDITERRANEAN_WALLS.length)];
            accentColor = TERRACOTTA_ROOFS[Math.floor(rng() * TERRACOTTA_ROOFS.length)];
            neonColor = undefined;
          } else if (style === 'neon-club') {
            height = 13 + rng() * 16;
            wallColor = rng() < 0.5 ? 0x26203b : 0x34234a;
            accentColor = NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)];
            neonColor = accentColor;
            hasRoofSign = rng() < 0.6;
          } else {
            // Iconic Ocean Drive Pastel Art Deco boutique hotels
            height = 12 + rng() * 15;
            wallColor = ART_DECO_WALLS[Math.floor(rng() * ART_DECO_WALLS.length)];
            accentColor = ART_DECO_ACCENTS[Math.floor(rng() * ART_DECO_ACCENTS.length)];
            neonColor = NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)];
            hasRoofSign = cx === cols - 1;
          }

          const collider: AABB = {
            minX: x - w * 0.5,
            maxX: x + w * 0.5,
            minZ: z - d * 0.5,
            maxZ: z + d * 0.5,
            minY: 0,
            maxY: height,
          };

          buildings.push({
            id: `b-${buildingIdx++}`,
            x,
            z,
            width: w,
            depth: d,
            height,
            baseY: SIDEWALK_HEIGHT,
            style,
            wallColor,
            accentColor,
            neonColor,
            hasRoofSign,
            collider,
          });
          colliders.push(collider);
        }
      }
    }
  }

  // 2b. Replace procedural box buildings on the 4 enterable venue blocks (after all block rng() calls complete
  //     so deterministic RNG state is 100% preserved) with the exact multi-wing world-space colliders of the
  //     unified inside/outside 3D venue buildings (Hotel Solaire, Club Neon, Café Habana, Wynwood Art Gallery)!
  const VENUE_HOST_BLOCKS = [
    { minX: 74, maxX: 135, minZ: -105, maxZ: -22 }, // Hotel Solaire block
    { minX: -15, maxX: 65, minZ: -105, maxZ: -22 }, // Club Neon block
    { minX: -285, maxX: -202, minZ: -35, maxZ: 65 }, // Café Habana block
    { minX: -195, maxX: -112, minZ: -285, maxZ: -202 }, // Wynwood Art Gallery block
  ];
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    const inHostBlock = VENUE_HOST_BLOCKS.some(
      (hb) => b.x >= hb.minX && b.x <= hb.maxX && b.z >= hb.minZ && b.z <= hb.maxZ,
    );
    if (inHostBlock) {
      const cIdx = colliders.indexOf(b.collider);
      if (cIdx !== -1) colliders.splice(cIdx, 1);
      buildings.splice(i, 1);
    }
  }

  // Exact world-space building specs & multi-wing exterior wall footprint colliders for the 4 unified enterable buildings
  const hotelMainCol: AABB = { minX: 108.0, maxX: 124.0, minZ: -58.4, maxZ: -26.4, minY: 0, maxY: 16.0 };
  const clubMainCol: AABB = { minX: -1.8, maxX: 7.2, minZ: -52.4, maxZ: -44.4, minY: 0, maxY: 5.0 };
  const cafeMainCol: AABB = { minX: -272.9, maxX: -251.9, minZ: 0.4, maxZ: 16.4, minY: 0, maxY: 5.5 };
  const galleryMainCol: AABB = { minX: -183.6, maxX: -167.6, minZ: -239.4, maxZ: -217.4, minY: 0, maxY: 7.0 };

  buildings.push(
    {
      id: 'b-108',
      x: 116.0,
      z: -42.4,
      width: 16.0,
      depth: 32.0,
      height: 15.0,
      baseY: SIDEWALK_HEIGHT,
      style: 'art-deco',
      wallColor: 0xfbf0e4,
      accentColor: 0xff6ca8,
      neonColor: 0x2cf3ff,
      hasRoofSign: true,
      collider: hotelMainCol,
    },
    {
      id: 'b-89',
      x: 13.7,
      z: -48.4,
      width: 31.0,
      depth: 24.0,
      height: 8.0,
      baseY: SIDEWALK_HEIGHT,
      style: 'neon-club',
      wallColor: 0x151224,
      accentColor: 0x2cf3ff,
      neonColor: 0xff2e93,
      hasRoofSign: true,
      collider: clubMainCol,
    },
    {
      id: 'b-30',
      x: -262.4,
      z: 8.4,
      width: 21.0,
      depth: 16.0,
      height: 5.0,
      baseY: SIDEWALK_HEIGHT,
      style: 'mediterranean',
      wallColor: 0xf3d7b4,
      accentColor: 0xc25435,
      collider: cafeMainCol,
    },
    {
      id: 'b-43',
      x: -175.6,
      z: -228.4,
      width: 16.0,
      depth: 22.0,
      height: 6.5,
      baseY: SIDEWALK_HEIGHT,
      style: 'warehouse-mural',
      wallColor: 0x110000,
      accentColor: 0xffcf5c,
      neonColor: 0x2cf3ff,
      hasRoofSign: true,
      collider: galleryMainCol,
    },
  );

  colliders.push(
    // Hotel Solaire (Ocean Drive): Main Lobby + South Suite Podium, North Ocean Lounge Wing & Rear Bath Podiums
    hotelMainCol,
    { minX: 108.0, maxX: 122.0, minZ: -71.4, maxZ: -58.4, minY: 0, maxY: 16.0 },
    { minX: 102.0, maxX: 108.0, minZ: -33.4, maxZ: -26.4, minY: 0, maxY: 16.0 },
    { minX: 102.0, maxX: 108.0, minZ: -70.4, maxZ: -63.4, minY: 0, maxY: 16.0 },
    // Club Neon (Neon Strip): Velvet Entry Foyer, Main Dance Hall & VIP Bar Wing
    clubMainCol,
    { minX: 7.2, maxX: 29.2, minZ: -60.4, maxZ: -36.4, minY: 0, maxY: 9.0 },
    { minX: 10.2, maxX: 26.2, minZ: -73.4, maxZ: -60.4, minY: 0, maxY: 5.5 },
    // Café Habana (Coral Heights): Espresso Bar + Roastery & Palm Conservatory Dining
    cafeMainCol,
    { minX: -272.9, maxX: -259.9, minZ: 16.4, maxZ: 30.4, minY: 0, maxY: 5.8 },
    // Wynwood Art Gallery (Wynwood Arts): Main Atrium, Light Lab Wing & Artist Studio Loft
    galleryMainCol,
    { minX: -181.6, maxX: -165.6, minZ: -252.4, maxZ: -239.4, minY: 0, maxY: 6.2 },
    { minX: -167.6, maxX: -155.6, minZ: -238.4, maxZ: -218.4, minY: 0, maxY: 5.8 },
  );

  // 3. Key Sol luxury coastal villas inside the island loop
  const villaCoords = [
    { x: 288, z: -225, w: 22, d: 18, h: 9.5 },
    { x: 314, z: -225, w: 20, d: 17, h: 11 },
    { x: 288, z: -176, w: 21, d: 19, h: 10 },
    { x: 315, z: -176, w: 22, d: 18, h: 8.5 },
  ];
  for (const v of villaCoords) {
    const collider: AABB = {
      minX: v.x - v.w * 0.5,
      maxX: v.x + v.w * 0.5,
      minZ: v.z - v.d * 0.5,
      maxZ: v.z + v.d * 0.5,
      minY: KEY_SOL_BOUNDS.baseY,
      maxY: KEY_SOL_BOUNDS.baseY + v.h,
    };
    buildings.push({
      id: `villa-${buildingIdx++}`,
      x: v.x,
      z: v.z,
      width: v.w,
      depth: v.d,
      height: v.h,
      baseY: KEY_SOL_BOUNDS.baseY,
      style: 'villa',
      wallColor: VILLA_WALLS[Math.floor(rng() * VILLA_WALLS.length)],
      accentColor: 0x3ce8f5,
      neonColor: 0x3ce8f5,
      collider,
    });
    colliders.push(collider);
  }

  // Key Sol Island central Modernist Basalt Infinity Fountain (301, -200)
  colliders.push({
    minX: 298.6,
    maxX: 303.4,
    minZ: -201.7,
    maxZ: -198.3,
    minY: KEY_SOL_BOUNDS.baseY,
    maxY: KEY_SOL_BOUNDS.baseY + 3.0,
  });

  // Marina Cove Waterfront Promenade Modernist Basalt Infinity Fountain (-45, 182)
  colliders.push({
    minX: -47.4,
    maxX: -42.6,
    minZ: 180.3,
    maxZ: 183.7,
    minY: 0,
    maxY: 3.0,
  });

  // 4. South Pier Lighthouse Pavilion at the tip of the pier
  const pierPavilion: BuildingSpec = {
    id: 'south-pier-lighthouse',
    x: 279,
    z: SOUTH_PIER.centerZ,
    width: 7,
    depth: 7,
    height: 14,
    baseY: SOUTH_PIER.deckY,
    style: 'pavilion',
    wallColor: 0xfff4e8,
    accentColor: 0xff5e8e,
    neonColor: 0xffcf5c,
    collider: {
      minX: 275.5,
      maxX: 282.5,
      minZ: SOUTH_PIER.centerZ - 3.5,
      maxZ: SOUTH_PIER.centerZ + 3.5,
      minY: SOUTH_PIER.deckY,
      maxY: SOUTH_PIER.deckY + 14,
    },
  };
  buildings.push(pierPavilion);
  colliders.push(pierPavilion.collider);

  // 5. Iconic Palm Trees along Ocean Drive, Boardwalk, Marina Cove, and Key Sol
  for (let z = -182; z <= 170; z += 18) {
    // East side of Ocean Drive / Boardwalk edge
    if (Math.abs(z - SOUTH_PIER.centerZ) > 12) {
      palms.push({
        x: 152.5,
        y: 0,
        z,
        height: 9.5 + rng() * 3.5,
        leanX: 0.08 + rng() * 0.08,
        leanZ: (rng() - 0.5) * 0.08,
        seed: rng() * 100,
      });
    }
    // Beachfront palm clusters
    if (Math.abs(z - SOUTH_PIER.centerZ) > 16 && rng() < 0.7) {
      const bx = 171 + rng() * 14;
      palms.push({
        x: bx,
        y: getGroundHeight(bx, z),
        z: z + (rng() - 0.5) * 6,
        height: 8.5 + rng() * 4.5,
        leanX: 0.1 + rng() * 0.1,
        leanZ: (rng() - 0.5) * 0.12,
        seed: rng() * 100,
      });
    }
  }

  // Avenue sidewalk palms along Coral Blvd, Collins Way, Neon Ave & North Bay Promenade
  for (const ax of [-290, -110, -20, 70]) {
    for (let z = -355; z <= 135; z += 36) {
      if (STREET_ZS.some((sz) => Math.abs(z - sz) < 16)) continue;
      palms.push({
        x: ax + 11.2,
        y: SIDEWALK_HEIGHT,
        z,
        height: 8 + rng() * 2.8,
        leanX: (rng() - 0.5) * 0.08,
        leanZ: (rng() - 0.5) * 0.08,
        seed: rng() * 100,
      });
    }
  }
  // North Bay waterfront palms (overlooking Key Sol across turquoise water)
  for (let z = -392; z <= -220; z += 22) {
    palms.push({
      x: 151.5,
      y: 0,
      z,
      height: 9.2 + rng() * 3.0,
      leanX: 0.09,
      leanZ: (rng() - 0.5) * 0.08,
      seed: rng() * 100,
    });
  }

  // Marina Cove waterfront palms (extended west along Coral Heights harbor!)
  for (let x = -395; x <= 115; x += 26) {
    palms.push({
      x,
      y: 0,
      z: 184,
      height: 8.5 + rng() * 3,
      leanX: (rng() - 0.5) * 0.08,
      leanZ: 0.08,
      seed: rng() * 100,
    });
  }

  // Key Sol Island perimeter palms
  for (let x = 252; x <= 348; x += 20) {
    palms.push({
      x,
      y: KEY_SOL_BOUNDS.baseY,
      z: -266,
      height: 9 + rng() * 3,
      leanX: (rng() - 0.5) * 0.1,
      leanZ: -0.09,
      seed: rng() * 100,
    });
    palms.push({
      x,
      y: KEY_SOL_BOUNDS.baseY,
      z: -134,
      height: 9 + rng() * 3,
      leanX: (rng() - 0.5) * 0.1,
      leanZ: 0.09,
      seed: rng() * 100,
    });
  }

  // 6. Streetlights along avenues & Causeway
  for (const ax of AVENUE_XS) {
    for (let z = -360; z <= 145; z += 54) {
      if (STREET_ZS.some((sz) => Math.abs(z - sz) < 14)) continue;
      streetLights.push({
        x: ax - 10.5,
        y: 0,
        z,
        yaw: Math.PI * 0.5,
        color: ax === 140 ? 0xff9ec7 : ax === -20 ? 0x52f2ff : ax <= -290 ? 0xffd28a : 0xffdf9e,
      });
    }
  }
  // Causeway arch lights
  for (let x = 165; x <= 235; x += 17.5) {
    const y = getGroundHeight(x, CAUSEWAY.centerZ);
    streetLights.push({
      x,
      y,
      z: CAUSEWAY.centerZ - 8.6,
      yaw: Math.PI,
      color: 0x3ef2ff,
    });
    streetLights.push({
      x,
      y,
      z: CAUSEWAY.centerZ + 8.6,
      yaw: 0,
      color: 0xff6da3,
    });
  }

  // 7. Beach lifeguard towers & umbrellas following the curving shoreline
  const lifeguardZs = [-95, 10, 105];
  const lifeguardColors = [0xff6f9c, 0x3ce8f5, 0xffd166];
  lifeguardZs.forEach((z, idx) => {
    const x = getShorelineX(z) - 14.5;
    beachProps.push({
      kind: 'lifeguard',
      x,
      y: getGroundHeight(x, z),
      z,
      color: lifeguardColors[idx % lifeguardColors.length],
      yaw: Math.PI * 0.5,
    });
  });

  const umbrellaColors = [0xff5e8e, 0x2cf3ff, 0xffcf5c, 0x46f7b4, 0xffffff];
  for (let z = -150; z <= 135; z += 22) {
    if (Math.abs(z - SOUTH_PIER.centerZ) < 18) continue;
    const shore = getShorelineX(z);
    const x = 180 + rng() * Math.max(4, shore - 192);
    beachProps.push({
      kind: 'umbrella',
      x,
      y: getGroundHeight(x, z),
      z,
      color: umbrellaColors[Math.floor(rng() * umbrellaColors.length)],
      yaw: rng() * Math.PI * 2,
    });
  }

  // 8. Moored luxury yachts in Marina Cove & offshore Atlantic
  const marinaSlips = [
    { x: -88, z: 215, yaw: 0 },
    { x: -62, z: 222, yaw: Math.PI },
    { x: -28, z: 218, yaw: 0 },
    { x: -2, z: 226, yaw: Math.PI },
    { x: 32, z: 216, yaw: 0 },
    { x: 58, z: 224, yaw: Math.PI },
  ];
  for (const s of marinaSlips) {
    yachts.push({
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      length: 13 + rng() * 5,
      accentColor: ART_DECO_ACCENTS[Math.floor(rng() * ART_DECO_ACCENTS.length)],
    });
  }
  // Offshore cruising yachts
  yachts.push(
    { x: 268, z: -45, yaw: 0.25, length: 22, accentColor: 0x2cf3ff },
    { x: 315, z: 65, yaw: -0.4, length: 26, accentColor: 0xff5e8e },
    { x: 255, z: 245, yaw: 1.1, length: 18, accentColor: 0xffcf5c },
  );

  // 9. Traffic intersection waypoint graph (matches exact grid + Key Sol loop)
  const trafficNodes: TrafficNode[] = [];
  const gridNodeId = (ix: number, iz: number) => iz * AVENUE_XS.length + ix;

  for (let iz = 0; iz < STREET_ZS.length; iz++) {
    for (let ix = 0; ix < AVENUE_XS.length; ix++) {
      const neighbors: number[] = [];
      if (ix > 0) neighbors.push(gridNodeId(ix - 1, iz));
      if (ix < AVENUE_XS.length - 1) neighbors.push(gridNodeId(ix + 1, iz));
      if (iz > 0) neighbors.push(gridNodeId(ix, iz - 1));
      if (iz < STREET_ZS.length - 1) neighbors.push(gridNodeId(ix, iz + 1));
      trafficNodes.push({
        id: gridNodeId(ix, iz),
        x: AVENUE_XS[ix],
        z: STREET_ZS[iz],
        neighbors,
      });
    }
  }

  // Connect Key Sol Causeway & island loop into traffic network
  const baseIdx = trafficNodes.length;
  const causewayStreetIdx = STREET_ZS.indexOf(-200);
  const oceanNorthIdx = gridNodeId(AVENUE_XS.length - 1, causewayStreetIdx); // (140, -200)
  trafficNodes.push(
    { id: baseIdx + 0, x: 262, z: -200, neighbors: [oceanNorthIdx, baseIdx + 1, baseIdx + 4] },
    { id: baseIdx + 1, x: 262, z: -255, neighbors: [baseIdx + 0, baseIdx + 2] },
    { id: baseIdx + 2, x: 338, z: -255, neighbors: [baseIdx + 1, baseIdx + 3] },
    { id: baseIdx + 3, x: 338, z: -145, neighbors: [baseIdx + 2, baseIdx + 4] },
    { id: baseIdx + 4, x: 262, z: -145, neighbors: [baseIdx + 3, baseIdx + 0] },
  );
  trafficNodes[oceanNorthIdx].neighbors.push(baseIdx + 0);

  // 10. Deterministic Street, Park, Beach, Pier & Storefront Props + Tight 2D OBB Colliders!
  //     Every physical outdoor object shares ONE single source of truth for visuals & modern OBB collision!
  const propRng = createRng(773305);
  const halfRoad = ROAD_WIDTH * 0.5;

  // 10a. Sidewalk corner safety bollards (4 corners of every city block)
  for (let bx = 0; bx < AVENUE_XS.length - 1; bx++) {
    for (let bz = 0; bz < STREET_ZS.length - 1; bz++) {
      const minX = AVENUE_XS[bx] + halfRoad + 0.4;
      const maxX = AVENUE_XS[bx + 1] - halfRoad - 0.4;
      const minZ = STREET_ZS[bz] + halfRoad + 0.4;
      const maxZ = STREET_ZS[bz + 1] - halfRoad - 0.4;
      const w = maxX - minX;
      const d = maxZ - minZ;
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = cx + sx * (w * 0.5 - 1.15);
          const z = cz + sz * (d * 0.5 - 1.15);
          bollards.push({ x, y: SIDEWALK_HEIGHT, z });
          propObbs.push({ cx: x, cz: z, halfW: 0.1, halfD: 0.1, rotY: 0 });
        }
      }
    }
  }

  // 10b. Live Intersection Traffic Signal Gantries
  for (let ix = 0; ix < AVENUE_XS.length; ix++) {
    for (let iz = 0; iz < STREET_ZS.length; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      const x = AVENUE_XS[ix] - 9.4;
      const z = STREET_ZS[iz] - 9.4;
      trafficSignals.push({ x, y: 0.2, z, phaseOffset: (ix * 3 + iz * 5) * 1.9 });
      propObbs.push({ cx: x, cz: z, halfW: 0.2, halfD: 0.2, rotY: 0 });
    }
  }

  // 10c. Readable Neon Hotel & District Marquees + dual support posts
  const marqueeSpecs: OutdoorMarqueeSpec[] = [
    { title: 'HOTEL SOLAIRE', sub: 'OCEAN DRIVE · ART DECO', bg: '#1e102b', fg: '#ff6ca8', acc: '#2cf3ff', x: 125, z: -65 },
    { title: 'THE FLAMINGO', sub: 'ROOFTOP LOUNGE & BAR', bg: '#161b30', fg: '#ffd166', acc: '#ff4d8d', x: 125, z: 25 },
    { title: 'PALM ROYALE', sub: 'SOUTH BEACH SUITES', bg: '#0e242c', fg: '#46f7b4', acc: '#ffcf5c', x: 125, z: 112 },
    { title: 'CLUB NEON', sub: 'OPEN LATE · LIVE SYNTH', bg: '#180c2e', fg: '#2cf3ff', acc: '#ff2e93', x: -5, z: -65 },
    { title: 'VELVET PALMS', sub: 'MIDTOWN NIGHTCLUB', bg: '#220f24', fg: '#ff70a6', acc: '#ffe066', x: -5, z: 25 },
    { title: 'MARINA CLUB', sub: 'YACHT CHARTERS & GRILL', bg: '#0c2032', fg: '#72efdd', acc: '#ffb703', x: 12, z: 145 },
    { title: 'WYNWOOD WALLS', sub: 'STREET ART · GALLERIES', bg: '#1a1030', fg: '#ffcf5c', acc: '#ff2e93', x: -185, z: -245 },
    { title: 'SOL ARENA', sub: 'LIVE CONCERTS & HOOPS', bg: '#0c182e', fg: '#2cf3ff', acc: '#ff4d8d', x: -275, z: -245 },
    { title: 'CAFE HABANA', sub: 'CORAL HEIGHTS · ESPRESSO', bg: '#2c1610', fg: '#ffd166', acc: '#ff8a3d', x: -275, z: 25 },
    { title: 'BAYSIDE RESORT', sub: 'NORTH BEACH TOWERS', bg: '#0c2233', fg: '#72efdd', acc: '#2cf3ff', x: 125, z: -245 },
  ];
  for (const m of marqueeSpecs) {
    marquees.push(m);
    for (const bz of [-3.2, 3.2]) {
      propObbs.push({ cx: m.x, cz: m.z + bz, halfW: 0.14, halfD: 0.14, rotY: 0 });
    }
  }

  // 10d. Roadside & Rooftop Miami Billboards + heavy steel monopoles
  const bbSpecs = [
    { headline: 'SOLSTICE GT', sub: '0-60 IN 2.6s · OWN THE COAST', a: '#181436', b: '#ff427b', badge: 'SOL MOTORS', x: 151, z: -155, yaw: -0.35 },
    { headline: 'VICE WAVE 98.5', sub: 'NON-STOP SUNSET SYNTH & COASTAL BEATS', a: '#0c1f3a', b: '#00b4d8', badge: 'LIVE ON AIR', x: -102, z: -62, yaw: Math.PI * 0.5 },
    { headline: 'KEY SOL VILLAS', sub: 'PRIVATE ISLAND LIVING ACROSS THE CAUSEWAY', a: '#122938', b: '#18a999', badge: 'LUXURY REALTY', x: 152, z: -188, yaw: 0.25 },
    { headline: 'SOL COLA', sub: 'ICE COLD MIAMI CITRUS REFRESHMENT', a: '#4a1228', b: '#ff8a3d', badge: 'STAY COOL', x: -188, z: 112, yaw: 0.4 },
  ];
  for (const bb of bbSpecs) {
    billboards.push({ ...bb, y: getGroundHeight(bb.x, bb.z) });
    propObbs.push({ cx: bb.x, cz: bb.z, halfW: 0.4, halfD: 0.4, rotY: 0 });
  }

  // 10e. Ocean Drive Sidewalk Cafés & Boardwalk Bougainvillea Stone Planters
  const cafeColors = [0xff5e8e, 0x22d3ee, 0xf59e0b, 0x34d399];
  for (let z = -155; z <= 125; z += 26) {
    if (STREET_ZS.some((sz) => Math.abs(z - sz) < 16)) continue;
    // Skip right in front of Hotel Solaire entrance (z = -48.4)
    if (Math.abs(z - -48.4) > 5.0) {
      sidewalkCafes.push({ x: 129.2, y: SIDEWALK_HEIGHT, z, color: cafeColors[Math.abs(z) % cafeColors.length] });
      propObbs.push({ cx: 129.2, cz: z, halfW: 0.62, halfD: 0.62, rotY: 0 });
    }
    planters.push({ x: 151.0, y: 0.0, z: z + 10 });
    propObbs.push({ cx: 151.0, cz: z + 10, halfW: 0.8, halfD: 2.3, rotY: 0 });
  }

  // 10f. Park & Boardwalk Benches (rotated OBBs!)
  const benchCoords = [
    { x: 16, z: 16, yaw: 0.78 },
    { x: 34, z: 16, yaw: -0.78 },
    { x: 16, z: 34, yaw: 2.35 },
    { x: 34, z: 34, yaw: -2.35 },
    { x: 163.5, z: -55, yaw: Math.PI * 0.5 },
    { x: 163.5, z: 15, yaw: Math.PI * 0.5 },
    { x: 163.5, z: 85, yaw: Math.PI * 0.5 },
  ];
  for (const bc of benchCoords) {
    benches.push({ x: bc.x, y: getGroundHeight(bc.x, bc.z), z: bc.z, yaw: bc.yaw });
    propObbs.push({ cx: bc.x, cz: bc.z, halfW: 1.05, halfD: 0.3, rotY: bc.yaw });
  }

  // 10g. Street-corner Fire Hydrants
  for (const ax of AVENUE_XS) {
    for (const sz of STREET_ZS) {
      if ((ax + sz) % 40 !== 0) continue;
      const hx = ax + 9.2;
      const hz = sz + 9.2;
      hydrants.push({ x: hx, y: SIDEWALK_HEIGHT, z: hz });
      propObbs.push({ cx: hx, cz: hz, halfW: 0.19, halfD: 0.19, rotY: 0 });
    }
  }

  // 10h. Sol Beach Sun Loungers paired beside every beach umbrella (rotated OBBs!)
  const towelColors = [0xff5e8e, 0x22d3ee, 0xffd166, 0x34d399, 0xa855f7];
  for (const prop of beachProps) {
    if (prop.kind === 'lifeguard') {
      propObbs.push({ cx: prop.x, cz: prop.z, halfW: 1.55, halfD: 1.55, rotY: prop.yaw });
    } else {
      // Umbrella pole (can walk under canopy shade, collides cleanly with the pole!)
      propObbs.push({ cx: prop.x, cz: prop.z, halfW: 0.12, halfD: 0.12, rotY: 0 });
      const tx = prop.x + 1.5;
      const tz = prop.z + 0.8;
      const yaw = Math.PI * 0.5 + (propRng() - 0.5) * 0.35;
      const col = towelColors[Math.abs(Math.round(prop.z)) % towelColors.length];
      loungers.push({ x: tx, y: getGroundHeight(tx, tz) + 0.02, z: tz, yaw, color: col });
      propObbs.push({ cx: tx, cz: tz, halfW: 0.4, halfD: 0.94, rotY: yaw });
    }
  }

  // 10i. Palm Tree Trunks (~150+ palms — tight 0.48m diameter trunk colliders!)
  for (const palm of palms) {
    propObbs.push({ cx: palm.x, cz: palm.z, halfW: 0.24, halfD: 0.24, rotY: 0 });
  }

  // 10j. Streetlight Poles (tight 0.32m pole colliders!)
  for (const sl of streetLights) {
    propObbs.push({ cx: sl.x, cz: sl.z, halfW: 0.16, halfD: 0.16, rotY: 0 });
  }

  // 10k. Coral Park Basketball Hoop Stanchions (-335, 25 ± 14.4)
  for (const side of [-1, 1]) {
    propObbs.push({ cx: -335, cz: 25 + side * 14.4, halfW: 0.18, halfD: 0.18, rotY: 0 });
  }

  // 10l. South Pier Wooden Railing Bollards
  for (let px = SOUTH_PIER.rampEndX + 6; px <= SOUTH_PIER.endX - 2; px += 14) {
    for (const side of [-5.8, 5.8]) {
      propObbs.push({ cx: px, cz: SOUTH_PIER.centerZ + side * 1.15, halfW: 0.15, halfD: 0.15, rotY: 0 });
    }
  }

  // 10m. Outdoor Enterable Storefront Sidewalk Props (potted palms, Café Habana bistro sets & chalkboard!)
  const storefrontPropObbs: OBB2D[] = [
    // Hotel Solaire (wallX: 124, centerZ: -48.4, facing +X)
    { cx: 125.8, cz: -46.3, halfW: 0.28, halfD: 0.28, rotY: 0 },
    { cx: 125.8, cz: -50.5, halfW: 0.28, halfD: 0.28, rotY: 0 },
    // Club Neon (wallX: -1.8, centerZ: -48.4, facing -X)
    { cx: -3.2, cz: -51.4, halfW: 0.28, halfD: 0.28, rotY: 0 },
    { cx: -3.2, cz: -45.4, halfW: 0.28, halfD: 0.28, rotY: 0 },
    // Café Habana (wallX: -272.9, centerZ: 8.4, facing -X)
    { cx: -274.6, cz: 6.2, halfW: 0.4, halfD: 0.32, rotY: 0.35 },
    { cx: -274.5, cz: 10.7, halfW: 0.28, halfD: 0.28, rotY: 0 },
    { cx: -274.7, cz: 13.2, halfW: 0.62, halfD: 0.62, rotY: 0 },
    { cx: -274.7, cz: 3.6, halfW: 0.62, halfD: 0.62, rotY: 0 },
    // Wynwood Art Gallery (wallX: -183.6, centerZ: -228.4, facing -X)
    { cx: -185.2, cz: -231.6, halfW: 0.28, halfD: 0.28, rotY: 0 },
    { cx: -185.2, cz: -225.2, halfW: 0.28, halfD: 0.28, rotY: 0 },
  ];
  propObbs.push(...storefrontPropObbs);

  return {
    avenueXs: AVENUE_XS,
    streetZs: STREET_ZS,
    roadWidth: ROAD_WIDTH,
    sidewalkWidth: SIDEWALK_WIDTH,
    roads,
    buildings,
    colliders,
    propObbs,
    palms,
    streetLights,
    yachts,
    beachProps,
    benches,
    planters,
    sidewalkCafes,
    hydrants,
    loungers,
    bollards,
    trafficSignals,
    billboards,
    marquees,
    trafficNodes,
    districts: DISTRICTS,
  };
}
