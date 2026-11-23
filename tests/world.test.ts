import { describe, expect, it } from 'vitest';
import { resolveCircleAABB } from '../src/core/math';
import { MISSIONS } from '../src/systems/missions';
import {
  BOARDWALK_HEIGHT,
  CAUSEWAY,
  KEY_SOL_BOUNDS,
  SEAWALL_HEIGHT,
  SIDEWALK_HEIGHT,
  SOUTH_PIER,
  createCityBlueprint,
  getBeachHeight,
  getDistrictAt,
  getGroundHeight,
  getShorelineX,
  isDeepWater,
  isOnRoad,
} from '../src/world/cityData';
import { INTERIORS } from '../src/world/interiors';

describe('Sol Coast World Blueprint', () => {
  const blueprint = createCityBlueprint();

  it('builds a dense expanded coastal metropolis with 11 districts, varied building styles, palms, and 54-node traffic graph', () => {
    expect(blueprint.roads.length).toBeGreaterThanOrEqual(18);
    expect(blueprint.buildings.length).toBeGreaterThanOrEqual(100);
    expect(blueprint.palms.length).toBeGreaterThanOrEqual(80);
    expect(blueprint.trafficNodes.length).toBe(54); // 7x7 grid + 5 Key Sol island loop nodes
    const styles = new Set(blueprint.buildings.map((b) => b.style));
    expect(styles.has('art-deco')).toBe(true);
    expect(styles.has('skyscraper')).toBe(true);
    expect(styles.has('warehouse-mural')).toBe(true);
    expect(styles.has('mediterranean')).toBe(true);
    expect(styles.has('resort-tower')).toBe(true);
    expect(styles.has('stadium')).toBe(true);
  });

  it('keeps buildings completely clear of the main road network', () => {
    for (const b of blueprint.buildings) {
      expect(isOnRoad(b.x, b.z)).toBe(false);
    }
  });

  it('provides smooth elevation for Sidewalks, Boardwalk, Seawall, Dock Ramps, Sculpted Dunes, South Pier, and Causeway', () => {
    expect(getGroundHeight(140, 0)).toBe(0); // Ocean Drive asphalt
    expect(getGroundHeight(128, 20)).toBeCloseTo(SIDEWALK_HEIGHT, 3); // Raised city block sidewalk
    expect(getGroundHeight(159, 20)).toBeCloseTo(BOARDWALK_HEIGHT, 3); // Elevated boardwalk
    expect(getGroundHeight(0, 191.8)).toBeCloseTo(SEAWALL_HEIGHT, 3); // Marina Cove walkable seawall curb
    expect(getGroundHeight(-75, 190.5)).toBeCloseTo(0.225, 2); // Smooth Marina dock approach ramp
    expect(getGroundHeight(-75, 210)).toBeCloseTo(0.45, 3); // Marina timber yacht dock
    expect(getGroundHeight(200, CAUSEWAY.centerZ)).toBeGreaterThan(3.5); // Bridge crest
    expect(getGroundHeight(280, -200)).toBeCloseTo(KEY_SOL_BOUNDS.baseY, 3); // Key Sol Island
    expect(getGroundHeight(SOUTH_PIER.startX, SOUTH_PIER.centerZ)).toBeCloseTo(BOARDWALK_HEIGHT, 3); // Pier ramp flush with boardwalk
    expect(getGroundHeight(240, SOUTH_PIER.centerZ)).toBeCloseTo(SOUTH_PIER.deckY, 3); // South Pier deck

    // Sculpted rolling beach dunes rise naturally above the boardwalk and curve into the surf
    const duneHeights = [-80, -20, 40, 100].map((z) => getBeachHeight(177, z));
    expect(Math.max(...duneHeights)).toBeGreaterThan(0.5);
    expect(Math.max(...duneHeights) - Math.min(...duneHeights)).toBeGreaterThan(0.2);

    // Curved scalloped shoreline varies organically along Z and slopes cleanly below 0 offshore
    const shoreVals = [-120, -40, 40, 120].map((z) => getShorelineX(z));
    expect(Math.max(...shoreVals) - Math.min(...shoreVals)).toBeGreaterThan(6);
    expect(getGroundHeight(getShorelineX(0) + 6, 0)).toBeLessThan(-0.3);
  });

  it('classifies water boundaries accurately while keeping pier, causeway, island, and marina docks dry', () => {
    expect(isDeepWater(140, 0)).toBe(false); // Ocean Drive
    expect(isDeepWater(240, SOUTH_PIER.centerZ)).toBe(false); // On South Pier
    expect(isDeepWater(200, CAUSEWAY.centerZ)).toBe(false); // On Causeway bridge
    expect(isDeepWater(300, -200)).toBe(false); // On Key Sol
    expect(isDeepWater(-75, 220)).toBe(false); // Marina dock
    expect(isDeepWater(310, 40)).toBe(true); // Open Atlantic Ocean
    expect(isDeepWater(200, -230)).toBe(true); // North Bay water beside causeway
  });

  it('maps all 11 coastal districts accurately', () => {
    expect(getDistrictAt(140, 20).id).toBe('ocean-drive');
    expect(getDistrictAt(185, 20).id).toBe('sol-beach');
    expect(getDistrictAt(260, SOUTH_PIER.centerZ).id).toBe('south-pier');
    expect(getDistrictAt(25, 25).id).toBe('palm-plaza');
    expect(getDistrictAt(-20, -40).id).toBe('neon-strip');
    expect(getDistrictAt(-190, -50).id).toBe('downtown-biscayne');
    expect(getDistrictAt(300, -200).id).toBe('key-sol');
    expect(getDistrictAt(0, 180).id).toBe('marina-cove');
    expect(getDistrictAt(-160, -290).id).toBe('wynwood-arts');
    expect(getDistrictAt(-335, 25).id).toBe('coral-heights');
    expect(getDistrictAt(90, -290).id).toBe('north-beach');
  });

  it('places every mission start beacon and step waypoint on dry, obstacle-free ground', () => {
    for (const m of MISSIONS) {
      expect(isDeepWater(m.startX, m.startZ), `mission ${m.id} start in water`).toBe(false);
      for (const box of blueprint.colliders) {
        expect(resolveCircleAABB(m.startX, m.startZ, 1.0, box).hit, `mission ${m.id} start inside collider`).toBe(false);
      }
      for (const step of m.steps) {
        expect(isDeepWater(step.x, step.z), `mission ${m.id} step "${step.label}" in water`).toBe(false);
        for (const box of blueprint.colliders) {
          expect(resolveCircleAABB(step.x, step.z, 1.0, box).hit, `mission ${m.id} step "${step.label}" inside collider`).toBe(false);
        }
      }
    }
  });

  it('bolts every enterable storefront flush onto a real building facade with dry sidewalk access and 3+ connected rooms', () => {
    expect(INTERIORS.length).toBeGreaterThanOrEqual(4);
    for (const venue of INTERIORS) {
      // Sidewalk doorway is on dry land and clear of building colliders
      expect(isDeepWater(venue.entranceX, venue.entranceZ), `${venue.id} entrance in water`).toBe(false);
      for (const box of blueprint.colliders) {
        expect(
          resolveCircleAABB(venue.entranceX, venue.entranceZ, 0.8, box).hit,
          `${venue.id} entrance overlapping building collider`,
        ).toBe(false);
      }

      // Storefront wall must be bolted flush against an ACTUAL city building (never an open courtyard gap!)
      const sf = venue.storefront;
      const attachedBuilding = blueprint.buildings.find((b) => {
        const edgeX = sf.facingSignX === 1 ? b.collider.maxX : b.collider.minX;
        return (
          Math.abs(edgeX - sf.wallX) < 0.35 &&
          sf.centerZ > b.collider.minZ + 3 &&
          sf.centerZ < b.collider.maxZ - 3
        );
      });
      expect(attachedBuilding, `${venue.id} storefront must sit flush on a real building facade`).toBeDefined();

      // Multi-room architecture: at least 3 distinct rooms, 2+ connecting doorways, rich 3D props, and 4+ NPCs
      expect(venue.rooms.length, `${venue.id} multi-room count`).toBeGreaterThanOrEqual(3);
      expect(venue.doorways.length, `${venue.id} doorways`).toBeGreaterThanOrEqual(2);
      expect(venue.props.length, `${venue.id} 3D props`).toBeGreaterThanOrEqual(25);
      expect(venue.npcs.length, `${venue.id} NPCs`).toBeGreaterThanOrEqual(4);
    }
  });
});
