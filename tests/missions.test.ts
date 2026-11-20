import { describe, expect, it } from 'vitest';
import { createInitialPlayerState } from '../src/entities/player';
import { DEFAULT_VEHICLES, createVehicleState } from '../src/entities/vehicle';
import { MISSIONS, MissionManager } from '../src/systems/missions';
import {
  clearWorldSave,
  computePlayerRank,
  loadWorld,
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
});
