import { clamp, createRng, type AABB } from '../core/math';
import type {
  BeachPropSpec,
  BuildingSpec,
  BuildingStyle,
  CityBlueprint,
  DistrictId,
  DistrictInfo,
  PalmSpec,
  RoadSegment,
  StreetLightSpec,
  TrafficNode,
  YachtSpec,
} from './types';

export const AVENUE_XS = [-200, -110, -20, 70, 140];
export const STREET_ZS = [-200, -110, -20, 70, 160];
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
  if (z >= 190.4 && z <= 193.2 && x >= -248 && x <= 160) {
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
  const shoreLimitX = z >= -186 && z <= 192 ? getShorelineX(z) + 1.5 : 212;
  const onMainland = x >= -248 && x <= shoreLimitX && z >= -228 && z <= 192.8;
  if (onMainland) {
    // Cutout North Bay inlet east of Ocean Drive (north of Z = -182)
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
  if (x >= -12 && x <= 62 && z >= -12 && z <= 62) return DISTRICTS['palm-plaza'];
  if (x >= 60 && x < 152) return DISTRICTS['ocean-drive'];
  if (x >= -75 && x < 60) return DISTRICTS['neon-strip'];
  return DISTRICTS['downtown-biscayne'];
}

export function isOnRoad(x: number, z: number): boolean {
  const half = ROAD_WIDTH * 0.5 + 1.5;
  // Main avenues
  for (const ax of AVENUE_XS) {
    if (Math.abs(x - ax) <= half && z >= -208 && z <= 168) return true;
  }
  // Main streets
  for (const sz of STREET_ZS) {
    if (Math.abs(z - sz) <= half && x >= -208 && x <= 148) return true;
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

export function createCityBlueprint(): CityBlueprint {
  const rng = createRng(3052026);
  const roads: RoadSegment[] = [];
  const buildings: BuildingSpec[] = [];
  const colliders: AABB[] = [];
  const palms: PalmSpec[] = [];
  const streetLights: StreetLightSpec[] = [];
  const yachts: YachtSpec[] = [];
  const beachProps: BeachPropSpec[] = [];

  // 1. Road network segments
  for (const ax of AVENUE_XS) {
    roads.push({ x1: ax, z1: -200, x2: ax, z2: 160, width: ROAD_WIDTH });
  }
  for (const sz of STREET_ZS) {
    roads.push({ x1: -200, z1: sz, x2: 140, z2: sz, width: ROAD_WIDTH });
  }
  // Key Sol Causeway bridge
  roads.push({ x1: 140, z1: -200, x2: 262, z2: -200, width: ROAD_WIDTH, isBridge: true });
  // Key Sol perimeter loop
  roads.push({ x1: 262, z1: -255, x2: 338, z2: -255, width: 13 });
  roads.push({ x1: 262, z1: -145, x2: 338, z2: -145, width: 13 });
  roads.push({ x1: 262, z1: -255, x2: 262, z2: -145, width: 13 });
  roads.push({ x1: 338, z1: -255, x2: 338, z2: -145, width: 13 });

  // 2. City block buildings
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

      // Keep Palm Plaza block (-20..70, -20..70) open as a lush central park!
      if (AVENUE_XS[bx] === -20 && STREET_ZS[bz] === -20) {
        // Central fountain collider
        colliders.push({
          minX: centerX - 6.5,
          maxX: centerX + 6.5,
          minZ: centerZ - 6.5,
          maxZ: centerZ + 6.5,
          minY: 0,
          maxY: 4,
        });
        // Park palm trees around perimeter
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const r = 21 + (i % 2) * 4;
          palms.push({
            x: centerX + Math.cos(angle) * r,
            y: 0,
            z: centerZ + Math.sin(angle) * r,
            height: 8.5 + rng() * 3.5,
            leanX: (rng() - 0.5) * 0.14,
            leanZ: (rng() - 0.5) * 0.14,
            seed: rng() * 100,
          });
        }
        continue;
      }

      // Determine architectural style based on district column
      let style: BuildingStyle;
      if (bx === 0) {
        style = 'skyscraper';
      } else if (bx === 1) {
        style = rng() < 0.65 ? 'skyscraper' : 'neon-club';
      } else if (bx === 2) {
        style = 'neon-club';
      } else {
        style = 'art-deco';
      }

      // Subdivide each block into 2x2 or 1x2 stylish footprints with walkable alleys
      const cols = style === 'skyscraper' && rng() < 0.4 ? 1 : 2;
      const rows = 2;
      const gap = 6.5;
      const cellW = (maxX - minX - gap * (cols - 1)) / cols;
      const cellD = (maxZ - minZ - gap * (rows - 1)) / rows;

      for (let cx = 0; cx < cols; cx++) {
        for (let cz = 0; cz < rows; cz++) {
          const w = cellW * (0.78 + rng() * 0.18);
          const d = cellD * (0.78 + rng() * 0.18);
          const x = minX + cx * (cellW + gap) + cellW * 0.5;
          const z = minZ + cz * (cellD + gap) + cellD * 0.5;

          let height: number;
          let wallColor: number;
          let accentColor: number;
          let neonColor: number | undefined;
          let hasRoofSign = false;

          if (style === 'skyscraper') {
            height = 34 + rng() * 44;
            wallColor = SKYSCRAPER_WALLS[Math.floor(rng() * SKYSCRAPER_WALLS.length)];
            accentColor = 0x5be3ff;
            neonColor = rng() < 0.7 ? NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)] : undefined;
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
            baseY: 0,
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

  // Avenue sidewalk palms along Collins Way & Neon Ave
  for (const ax of [-20, 70]) {
    for (let z = -175; z <= 135; z += 30) {
      if (STREET_ZS.some((sz) => Math.abs(z - sz) < 16)) continue;
      palms.push({
        x: ax + 11.2,
        y: 0,
        z,
        height: 8 + rng() * 2.5,
        leanX: (rng() - 0.5) * 0.08,
        leanZ: (rng() - 0.5) * 0.08,
        seed: rng() * 100,
      });
    }
  }

  // Marina Cove waterfront palms
  for (let x = -110; x <= 115; x += 22) {
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
    for (let z = -180; z <= 145; z += 45) {
      if (STREET_ZS.some((sz) => Math.abs(z - sz) < 14)) continue;
      streetLights.push({
        x: ax - 10.5,
        y: 0,
        z,
        yaw: Math.PI * 0.5,
        color: ax === 140 ? 0xff9ec7 : ax === -20 ? 0x52f2ff : 0xffdf9e,
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
  const oceanNorthIdx = gridNodeId(AVENUE_XS.length - 1, 0); // (140, -200)
  trafficNodes.push(
    { id: baseIdx + 0, x: 262, z: -200, neighbors: [oceanNorthIdx, baseIdx + 1, baseIdx + 4] },
    { id: baseIdx + 1, x: 262, z: -255, neighbors: [baseIdx + 0, baseIdx + 2] },
    { id: baseIdx + 2, x: 338, z: -255, neighbors: [baseIdx + 1, baseIdx + 3] },
    { id: baseIdx + 3, x: 338, z: -145, neighbors: [baseIdx + 2, baseIdx + 4] },
    { id: baseIdx + 4, x: 262, z: -145, neighbors: [baseIdx + 3, baseIdx + 0] },
  );
  trafficNodes[oceanNorthIdx].neighbors.push(baseIdx + 0);

  return {
    avenueXs: AVENUE_XS,
    streetZs: STREET_ZS,
    roadWidth: ROAD_WIDTH,
    sidewalkWidth: SIDEWALK_WIDTH,
    roads,
    buildings,
    colliders,
    palms,
    streetLights,
    yachts,
    beachProps,
    trafficNodes,
    districts: DISTRICTS,
  };
}
