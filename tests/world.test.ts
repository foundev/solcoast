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

describe('Sol Coast World Blueprint', () => {
  const blueprint = createCityBlueprint();

  it('builds a dense deterministic coastal city with roads, buildings, palms, and traffic graph', () => {
    expect(blueprint.roads.length).toBeGreaterThanOrEqual(14);
    expect(blueprint.buildings.length).toBeGreaterThanOrEqual(40);
    expect(blueprint.palms.length).toBeGreaterThanOrEqual(40);
    expect(blueprint.trafficNodes.length).toBe(30); // 5x5 grid + 5 Key Sol island loop nodes
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

  it('maps all 8 coastal districts accurately', () => {
    expect(getDistrictAt(140, 20).id).toBe('ocean-drive');
    expect(getDistrictAt(185, 20).id).toBe('sol-beach');
    expect(getDistrictAt(260, SOUTH_PIER.centerZ).id).toBe('south-pier');
    expect(getDistrictAt(25, 25).id).toBe('palm-plaza');
    expect(getDistrictAt(-20, -40).id).toBe('neon-strip');
    expect(getDistrictAt(-190, -50).id).toBe('downtown-biscayne');
    expect(getDistrictAt(300, -200).id).toBe('key-sol');
    expect(getDistrictAt(0, 180).id).toBe('marina-cove');
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
});
