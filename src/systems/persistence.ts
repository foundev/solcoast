import type { PlayerState } from '../entities/player';
import type { VehicleState } from '../entities/vehicle';
import { ALL_DISTRICT_IDS } from '../world/cityData';
import type { DistrictId } from '../world/types';
import { MISSIONS, type MissionManager } from './missions';

export const SAVE_STORAGE_KEY = 'solcoast_world_save_v1';
export const SAVE_VERSION = 1;
export const MAX_SAVE_LENGTH = 256 * 1024;

const VALID_DISTRICT_SET = new Set<string>(ALL_DISTRICT_IDS);
const VALID_MISSION_SET = new Set<string>(MISSIONS.map((m) => m.id));
export const VALID_HOTEL_KEYCARDS = ['hotel-suite-201', 'hotel-penthouse'] as const;
const VALID_KEYCARD_SET = new Set<string>(VALID_HOTEL_KEYCARDS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const WORLD_MIN_X = -640;
const WORLD_MAX_X = 430;
const WORLD_MIN_Z = -630;
const WORLD_MAX_Z = 320;
const MAX_CASH = 1_000_000_000;
const MAX_DISTANCE = 100_000_000;
const MAX_VEHICLES = 64;
const MAX_KEYCARDS = 32;

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return Math.min(max, Math.max(min, value));
  return value;
}

function asSafeId(value: unknown): string | null {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value) || FORBIDDEN_KEYS.has(value)) {
    return null;
  }
  return value;
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
  const bestTimes: Record<string, number> = {};
  for (const [key, val] of Object.entries(params.missions.bestTimes)) {
    if (!FORBIDDEN_KEYS.has(key) && typeof val === 'number' && Number.isFinite(val) && val > 0) {
      bestTimes[key] = val;
    }
  }

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
    bestTimes,
    discoveredDistricts: Array.from(params.discoveredDistricts),
    hotelKeycards: params.hotelKeycards ? Array.from(params.hotelKeycards) : [],
  };
}

/**
 * Strictly parses and validates untrusted save JSON (e.g. from localStorage),
 * guarding against prototype pollution, NaN/Infinity physics corruption,
 * out-of-bounds indices, and malformed/injected fields.
 */
export function parseAndValidateSaveData(raw: string): WorldSaveData | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SAVE_LENGTH) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainRecord(parsed) || parsed.version !== SAVE_VERSION) {
    return null;
  }

  const cash = asFiniteNumber(parsed.cash, 0, MAX_CASH);
  if (cash === null) return null;

  if (typeof parsed.timeOfDayHours !== 'number' || !Number.isFinite(parsed.timeOfDayHours)) {
    return null;
  }
  const timeOfDayHours = ((parsed.timeOfDayHours % 24) + 24) % 24;

  if (!isPlainRecord(parsed.player)) return null;
  const px = asFiniteNumber(parsed.player.x, WORLD_MIN_X, WORLD_MAX_X);
  const py = asFiniteNumber(parsed.player.y, -20, 120);
  const pz = asFiniteNumber(parsed.player.z, WORLD_MIN_Z, WORLD_MAX_Z);
  const pyaw = asFiniteNumber(parsed.player.yaw, -1000, 1000);
  const walkedMeters = asFiniteNumber(parsed.player.walkedMeters, 0, MAX_DISTANCE);
  if (px === null || py === null || pz === null || pyaw === null || walkedMeters === null) {
    return null;
  }

  let vehicleId: string | null = null;
  if (parsed.player.vehicleId !== null && parsed.player.vehicleId !== undefined) {
    const safeVid = asSafeId(parsed.player.vehicleId);
    if (safeVid === null) return null;
    vehicleId = safeVid;
  }

  if (!Array.isArray(parsed.vehicles)) return null;
  const vehicles: SavedVehicle[] = [];
  for (const item of parsed.vehicles.slice(0, MAX_VEHICLES)) {
    if (!isPlainRecord(item)) continue;
    const id = asSafeId(item.id);
    const vx = asFiniteNumber(item.x, WORLD_MIN_X, WORLD_MAX_X);
    const vz = asFiniteNumber(item.z, WORLD_MIN_Z, WORLD_MAX_Z);
    const vyaw = asFiniteNumber(item.yaw, -1000, 1000);
    const paintRaw = asFiniteNumber(item.paintIndex, 0, 1000);
    const odo = asFiniteNumber(item.odometerMeters, 0, MAX_DISTANCE);
    if (id === null || vx === null || vz === null || vyaw === null || paintRaw === null || odo === null) {
      continue;
    }
    vehicles.push({
      id,
      x: vx,
      z: vz,
      yaw: vyaw,
      paintIndex: Math.floor(paintRaw),
      odometerMeters: odo,
    });
  }

  const completedMissions: string[] = [];
  if (Array.isArray(parsed.completedMissions)) {
    const seen = new Set<string>();
    for (const id of parsed.completedMissions) {
      if (typeof id === 'string' && VALID_MISSION_SET.has(id) && !seen.has(id)) {
        seen.add(id);
        completedMissions.push(id);
      }
    }
  }

  const bestTimes: Record<string, number> = Object.create(null);
  if (isPlainRecord(parsed.bestTimes)) {
    for (const key of Object.keys(parsed.bestTimes)) {
      if (FORBIDDEN_KEYS.has(key) || !VALID_MISSION_SET.has(key)) continue;
      const val = parsed.bestTimes[key];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= 86400) {
        bestTimes[key] = Number(val.toFixed(1));
      }
    }
  }

  const discoveredDistricts: DistrictId[] = [];
  if (Array.isArray(parsed.discoveredDistricts)) {
    const seen = new Set<string>();
    for (const d of parsed.discoveredDistricts) {
      if (typeof d === 'string' && VALID_DISTRICT_SET.has(d) && !seen.has(d)) {
        seen.add(d);
        discoveredDistricts.push(d as DistrictId);
      }
    }
  }

  const hotelKeycards: string[] = [];
  if (Array.isArray(parsed.hotelKeycards)) {
    const seen = new Set<string>();
    for (const k of parsed.hotelKeycards.slice(0, MAX_KEYCARDS)) {
      if (typeof k === 'string' && VALID_KEYCARD_SET.has(k) && !seen.has(k)) {
        seen.add(k);
        hotelKeycards.push(k);
      }
    }
  }

  const savedAt =
    typeof parsed.savedAt === 'string' && parsed.savedAt.length <= 64 ? parsed.savedAt : '';

  return {
    version: SAVE_VERSION,
    savedAt,
    cash,
    timeOfDayHours,
    player: {
      x: px,
      y: py,
      z: pz,
      yaw: pyaw,
      vehicleId,
      walkedMeters,
    },
    vehicles,
    completedMissions,
    bestTimes,
    discoveredDistricts,
    hotelKeycards,
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
    return parseAndValidateSaveData(raw);
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
