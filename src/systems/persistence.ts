import type { PlayerState } from '../entities/player';
import type { VehicleState } from '../entities/vehicle';
import type { DistrictId } from '../world/types';
import type { MissionManager } from './missions';

export const SAVE_STORAGE_KEY = 'solcoast_world_save_v1';
export const SAVE_VERSION = 1;

export interface SavedVehicle {
  id: string;
  x: number;
  z: number;
  yaw: number;
  paintIndex: number;
  odometerMeters: number;
}

export interface WorldSaveData {
  version: number;
  savedAt: string;
  cash: number;
  timeOfDayHours: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    vehicleId: string | null;
    walkedMeters: number;
  };
  vehicles: SavedVehicle[];
  completedMissions: string[];
  bestTimes: Record<string, number>;
  discoveredDistricts: DistrictId[];
  hotelKeycards?: string[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function serializeWorldState(params: {
  cash: number;
  timeOfDayHours: number;
  player: PlayerState;
  vehicles: VehicleState[];
  missions: MissionManager;
  discoveredDistricts: Set<DistrictId>;
  hotelKeycards?: Set<string>;
}): WorldSaveData {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    cash: params.cash,
    timeOfDayHours: Number(params.timeOfDayHours.toFixed(3)),
    player: {
      x: Number(params.player.x.toFixed(2)),
      y: Number(params.player.y.toFixed(2)),
      z: Number(params.player.z.toFixed(2)),
      yaw: Number(params.player.yaw.toFixed(4)),
      vehicleId: params.player.vehicleId,
      walkedMeters: Number(params.player.walkedMeters.toFixed(1)),
    },
    vehicles: params.vehicles.map((v) => ({
      id: v.id,
      x: Number(v.x.toFixed(2)),
      z: Number(v.z.toFixed(2)),
      yaw: Number(v.yaw.toFixed(4)),
      paintIndex: v.paintIndex,
      odometerMeters: Number(v.odometerMeters.toFixed(1)),
    })),
    completedMissions: Array.from(params.missions.completedIds),
    bestTimes: { ...params.missions.bestTimes },
    discoveredDistricts: Array.from(params.discoveredDistricts),
    hotelKeycards: params.hotelKeycards ? Array.from(params.hotelKeycards) : [],
  };
}

export function saveWorld(data: WorldSaveData, storage?: StorageLike): boolean {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!store) return false;
  try {
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadWorld(storage?: StorageLike): WorldSaveData | null {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldSaveData;
    if (!parsed || parsed.version !== SAVE_VERSION || !parsed.player || !Array.isArray(parsed.vehicles)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearWorldSave(storage?: StorageLike): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  store?.removeItem(SAVE_STORAGE_KEY);
}

export function computePlayerRank(cash: number, completedCount: number): string {
  if (completedCount >= 6 || cash >= 16000) return 'SOL COAST LEGEND';
  if (completedCount >= 4 || cash >= 10000) return 'NEON KINGPIN';
  if (completedCount >= 2 || cash >= 5000) return 'MIAMI DRIVER';
  return 'COASTAL CRUISER';
}
