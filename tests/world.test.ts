import { describe, expect, it } from 'vitest';
import { resolveCircleAABB, resolveCircleOBB } from '../src/core/math';
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
  getTerrainHeight,
  isDeepWater,
  isOnRoad,
} from '../src/world/cityData';
import { INTERIORS, INTERIOR_ORIGIN_Y, interiorLocalToWorld } from '../src/world/interiors';

describe('Sol Coast World Blueprint', () => {
  const blueprint = createCityBlueprint();

  it('builds a dense expanded coastal metropolis with 14 districts, varied building styles, terrain variance, street signs, palms, and 86-node traffic graph', () => {
    expect(blueprint.roads.length).toBeGreaterThanOrEqual(22);
    expect(blueprint.buildings.length).toBeGreaterThanOrEqual(160);
    expect(blueprint.palms.length).toBeGreaterThanOrEqual(110);
    expect(blueprint.trafficNodes.length).toBe(86); // 9x9 grid + 5 Key Sol island loop nodes
    expect(blueprint.streetSigns.length).toBe(81); // 9x9 intersection corner street-name signs!
    expect(blueprint.streetSigns.some((s) => s.avenueName === 'OCEAN DR' && s.streetName === '5TH ST')).toBe(true);
    expect(blueprint.streetSigns.some((s) => s.avenueName === 'SUNSET RIDGE DR' && s.streetName === 'HIGHLAND PKWY')).toBe(true);
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

    // Real-world mainland terrain variance: level along Ocean Drive & enterable pads, rising into rolling hills inland!
    expect(getTerrainHeight(140, 0)).toBe(0);
    expect(getTerrainHeight(25, -62)).toBe(0); // Enterable Club Neon pad stays smoothly level
    const urbanSamples = [-340, -240, -155, -70].flatMap((ux) =>
      [-280, -160, -50, 40].map((uz) => getTerrainHeight(ux, uz)),
    );
    expect(Math.max(...urbanSamples)).toBeGreaterThan(1.5); // Rolling urban hills in Downtown/Wynwood/Coral Heights
    expect(Math.max(...urbanSamples) - Math.min(...urbanSamples)).toBeGreaterThan(1.2);
    expect(getTerrainHeight(-470, -470)).toBeGreaterThan(4.0); // Sunset Hills panoramic ridge!
    expect(getTerrainHeight(-110, -470)).toBeGreaterThan(2.5); // North Bay Highlands coastal bluff!
    // Sidewalks remain cleanly +SIDEWALK_HEIGHT above the rolling terrain elevation at the same spot
    const hillSidewalkY = getGroundHeight(-450, -450);
    expect(hillSidewalkY - getTerrainHeight(-450, -450)).toBeCloseTo(SIDEWALK_HEIGHT, 3);
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

  it('maps all 14 coastal districts accurately', () => {
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
    expect(getDistrictAt(-470, -420).id).toBe('sunset-hills');
    expect(getDistrictAt(-470, -40).id).toBe('coconut-grove');
    expect(getDistrictAt(-110, -470).id).toBe('north-highlands');
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
      for (const obb of blueprint.propObbs) {
        expect(
          resolveCircleOBB(venue.entranceX, venue.entranceZ, 0.45, obb).hit,
          `${venue.id} entrance overlapping outdoor prop OBB at (${obb.cx.toFixed(1)}, ${obb.cz.toFixed(1)})`,
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

      // Every room across every floor of the unified 3D venue (including exterior walls & balconies) must stay strictly off every street!
      for (const room of venue.rooms) {
        for (const [lx, lz] of [
          [room.minX - 1.2, room.minZ - 1.2],
          [room.maxX + 1.2, room.minZ - 1.2],
          [room.minX - 1.2, room.maxZ + 1.2],
          [room.maxX + 1.2, room.maxZ + 1.2],
        ]) {
          const wp = interiorLocalToWorld(venue, lx, INTERIOR_ORIGIN_Y, lz, 0);
          expect(
            isOnRoad(wp.x, wp.z),
            `${venue.id} room "${room.id}" corner (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)}) must not protrude onto a road`,
          ).toBe(false);
        }
      }

      // Multi-room architecture: at least 3 distinct rooms, 2+ connecting doorways, rich 3D props, and 4+ NPCs
      expect(venue.rooms.length, `${venue.id} multi-room count`).toBeGreaterThanOrEqual(3);
      expect(venue.doorways.length, `${venue.id} doorways`).toBeGreaterThanOrEqual(2);
      expect(venue.props.length, `${venue.id} 3D props`).toBeGreaterThanOrEqual(25);
      expect(venue.npcs.length, `${venue.id} NPCs`).toBeGreaterThanOrEqual(4);
    }
    // Modern tight OBB colliders cover every outdoor palm, lamp, bollard, hydrant, bench, planter, café, tower & lounger!
    expect(blueprint.propObbs.length).toBeGreaterThanOrEqual(450);
    // Spot-check that mission starts & steps remain clear of outdoor prop OBBs too
    for (const m of MISSIONS) {
      for (const obb of blueprint.propObbs) {
        expect(
          resolveCircleOBB(m.startX, m.startZ, 0.5, obb).hit,
          `mission ${m.id} start overlapping outdoor prop OBB at (${obb.cx}, ${obb.cz})`,
        ).toBe(false);
      }
    }
  });
});
