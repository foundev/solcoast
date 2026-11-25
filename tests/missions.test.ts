import { describe, expect, it } from 'vitest';
import { createInitialPlayerState } from '../src/entities/player';
import { DEFAULT_VEHICLES, createVehicleState } from '../src/entities/vehicle';
import { MISSIONS, MissionManager } from '../src/systems/missions';
import {
  MAX_SAVE_LENGTH,
  SAVE_STORAGE_KEY,
  clearWorldSave,
  computePlayerRank,
  loadWorld,
  parseAndValidateSaveData,
  saveWorld,
  serializeWorldState,
  type StorageLike,
} from '../src/systems/persistence';
import type { DistrictId } from '../src/world/types';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('Mission System & World Persistence', () => {
  it('enforces on-foot and in-car requirements across hybrid missions (South Pier Drop)', () => {
    const mgr = new MissionManager();
    const def = mgr.startMission('south-pier-drop');
    expect(def).not.toBeNull();
    expect(mgr.active?.stepIndex).toBe(0);

    // Step 1 requires in car: walking into it should NOT complete step
    const s0 = def!.steps[0];
    expect(mgr.update(1, s0.x, s0.z, null)).toBeNull();
    expect(mgr.active?.stepIndex).toBe(0);

    // Driving into Step 1 advances to Step 2 (on foot at lighthouse)
    const ev1 = mgr.update(1, s0.x, s0.z, 'solstice-gt');
    expect(ev1?.type).toBe('step');
    expect(mgr.active?.stepIndex).toBe(1);

    // Step 2 requires on foot: staying in car does NOT trigger
    const s1 = def!.steps[1];
    expect(mgr.update(1, s1.x, s1.z, 'solstice-gt')).toBeNull();
    const ev2 = mgr.update(1, s1.x, s1.z, null);
    expect(ev2?.type).toBe('step');
    expect(mgr.active?.stepIndex).toBe(2);

    // Step 3: deliver downtown in car completes mission with cash reward
    const s2 = def!.steps[2];
    const done = mgr.update(1, s2.x, s2.z, 'solstice-gt');
    expect(done?.type).toBe('complete');
    expect(done?.rewardCash).toBe(def!.rewardCash);
    expect(mgr.completedIds.has('south-pier-drop')).toBe(true);
    expect(mgr.active).toBeNull();
  });

  it('enforces vehicle-specific delivery in Marina Valet Express', () => {
    const mgr = new MissionManager();
    const def = mgr.startMission('marina-valet-express')!;
    const step0 = def.steps[0];

    // Wrong vehicle does not progress
    expect(mgr.update(0.5, step0.x, step0.z, 'solstice-gt')).toBeNull();
    // Correct Key Sol Spyder progresses
    expect(mgr.update(0.5, step0.x, step0.z, 'keysol-spyder')?.type).toBe('step');
  });

  it('persists and restores player, parked vehicles, paint, cash, and missions accurately', () => {
    const store = createMemoryStorage();
    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    vehicles[0].x = 270;
    vehicles[0].z = -210;
    vehicles[0].paintIndex = 4;
    vehicles[0].odometerMeters = 4200;

    const player = createInitialPlayerState(null);
    player.x = 188;
    player.z = 12;
    player.walkedMeters = 310;

    const missions = new MissionManager();
    missions.completedIds.add(MISSIONS[0].id);
    missions.bestTimes[MISSIONS[0].id] = 48.2;

    const discovered = new Set<DistrictId>(['ocean-drive', 'key-sol', 'south-pier']);

    const snapshot = serializeWorldState({
      cash: 6250,
      timeOfDayHours: 21.5,
      player,
      vehicles,
      missions,
      discoveredDistricts: discovered,
    });

    expect(saveWorld(snapshot, store)).toBe(true);
    const restored = loadWorld(store);
    expect(restored).not.toBeNull();
    expect(restored!.cash).toBe(6250);
    expect(restored!.player.vehicleId).toBeNull();
    expect(restored!.player.x).toBe(188);
    expect(restored!.vehicles[0].paintIndex).toBe(4);
    expect(restored!.vehicles[0].x).toBe(270);
    expect(restored!.completedMissions).toContain('ocean-drive-sprint');
    expect(restored!.discoveredDistricts).toContain('key-sol');
    expect(computePlayerRank(6250, 1)).toBe('MIAMI DRIVER');

    clearWorldSave(store);
    expect(loadWorld(store)).toBeNull();
  });

  it('rejects prototype pollution, XSS payloads, and malformed/out-of-bounds fields in untrusted save data', () => {
    const store = createMemoryStorage();

    // 1. Prototype pollution + string XSS payload in bestTimes + invalid district/mission IDs + negative paintIndex
    const maliciousRaw = JSON.stringify({
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      cash: 5000,
      timeOfDayHours: 30.5,
      player: {
        x: 140,
        y: 0,
        z: 10,
        yaw: 0,
        vehicleId: 'solstice-gt',
        walkedMeters: -50,
      },
      vehicles: [
        {
          id: 'solstice-gt',
          x: 140,
          z: 10,
          yaw: 0,
          paintIndex: -3,
          odometerMeters: 100,
        },
        {
          id: '__proto__',
          x: 0,
          z: 0,
          yaw: 0,
          paintIndex: 0,
          odometerMeters: 0,
        },
      ],
      completedMissions: ['ocean-drive-sprint', '<script>alert(1)</script>', 'ocean-drive-sprint'],
      bestTimes: JSON.parse(
        '{"ocean-drive-sprint":"<img src=x onerror=alert(1)>","south-pier-drop":42.5,"__proto__":{"polluted":true},"constructor":99}',
      ),
      discoveredDistricts: ['ocean-drive', 'not-a-real-district', '__proto__'],
      hotelKeycards: ['hotel-suite-201', '../etc/passwd', '<svg onload=alert(1)>'],
    });

    store.setItem(SAVE_STORAGE_KEY, maliciousRaw);
    const restored = loadWorld(store);
    expect(restored).not.toBeNull();

    // Object.prototype must remain completely clean
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(restored!.bestTimes)).toBeNull();

    // XSS string bestTime rejected; valid numeric bestTime preserved; forbidden keys stripped
    expect(restored!.bestTimes['ocean-drive-sprint']).toBeUndefined();
    expect(restored!.bestTimes['south-pier-drop']).toBe(42.5);
    expect('__proto__' in restored!.bestTimes).toBe(false);
    expect('constructor' in restored!.bestTimes).toBe(false);

    // Arrays strictly filtered & deduplicated; numeric bounds enforced
    expect(restored!.completedMissions).toEqual(['ocean-drive-sprint']);
    expect(restored!.discoveredDistricts).toEqual(['ocean-drive']);
    expect(restored!.hotelKeycards).toEqual(['hotel-suite-201']);
    expect(restored!.timeOfDayHours).toBeCloseTo(6.5, 5);
    expect(restored!.player.walkedMeters).toBe(0);
    expect(restored!.vehicles).toHaveLength(1);
    expect(restored!.vehicles[0].paintIndex).toBe(0);

    // 2. Rejects oversized save payloads (DoS guard) and NaN/non-numeric required fields
    expect(parseAndValidateSaveData('x'.repeat(MAX_SAVE_LENGTH + 1))).toBeNull();
    expect(
      parseAndValidateSaveData(
        JSON.stringify({
          version: 1,
          cash: 'not-a-number',
          timeOfDayHours: 12,
          player: { x: 0, y: 0, z: 0, yaw: 0, vehicleId: null, walkedMeters: 0 },
          vehicles: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseAndValidateSaveData(
        JSON.stringify({
          version: 1,
          cash: 100,
          timeOfDayHours: 12,
          player: { x: null, y: 0, z: 0, yaw: 0, vehicleId: null, walkedMeters: 0 },
          vehicles: [],
        }),
      ),
    ).toBeNull();
  });
});
