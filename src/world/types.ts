import type { AABB } from '../core/math';

export type DistrictId =
  | 'ocean-drive'
  | 'sol-beach'
  | 'south-pier'
  | 'neon-strip'
  | 'palm-plaza'
  | 'downtown-biscayne'
  | 'key-sol'
  | 'marina-cove';

export interface DistrictInfo {
  id: DistrictId;
  name: string;
  tagline: string;
}

export type BuildingStyle = 'art-deco' | 'skyscraper' | 'neon-club' | 'villa' | 'pavilion';

export interface BuildingSpec {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  baseY: number;
  style: BuildingStyle;
  wallColor: number;
  accentColor: number;
  neonColor?: number;
  hasRoofSign?: boolean;
  collider: AABB;
}

export interface RoadSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  isBridge?: boolean;
}

export interface PalmSpec {
  x: number;
  y: number;
  z: number;
  height: number;
  leanX: number;
  leanZ: number;
  seed: number;
}

export interface StreetLightSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: number;
}

export interface YachtSpec {
  x: number;
  z: number;
  yaw: number;
  length: number;
  accentColor: number;
}

export interface BeachPropSpec {
  kind: 'lifeguard' | 'umbrella';
  x: number;
  y: number;
  z: number;
  color: number;
  yaw: number;
}

export interface TrafficNode {
  id: number;
  x: number;
  z: number;
  neighbors: number[];
}

export interface CityBlueprint {
  avenueXs: number[];
  streetZs: number[];
  roadWidth: number;
  sidewalkWidth: number;
  roads: RoadSegment[];
  buildings: BuildingSpec[];
  colliders: AABB[];
  palms: PalmSpec[];
  streetLights: StreetLightSpec[];
  yachts: YachtSpec[];
  beachProps: BeachPropSpec[];
  trafficNodes: TrafficNode[];
  districts: Record<DistrictId, DistrictInfo>;
}
