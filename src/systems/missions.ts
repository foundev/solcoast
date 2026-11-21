import * as THREE from 'three';
import { distXZ } from '../core/math';
import { getGroundHeight } from '../world/cityData';

export type MissionCategory = 'RACE' | 'COURIER' | 'EXPLORE' | 'VALET';

export interface MissionStep {
  label: string;
  x: number;
  z: number;
  radius: number;
  requireOnFoot?: boolean;
  requireInCar?: boolean;
  requireVehicleId?: string;
}

export interface MissionDef {
  id: string;
  title: string;
  district: string;
  category: MissionCategory;
  description: string;
  startX: number;
  startZ: number;
  startRadius: number;
  timeLimitSec: number; // 0 = untimed
  rewardCash: number;
  steps: MissionStep[];
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'ocean-drive-sprint',
    title: 'Ocean Drive Sprint',
    district: 'Ocean Drive',
    category: 'RACE',
    description: 'Tear north up Ocean Drive, cross the Causeway to Key Sol, and race back.',
    startX: 140,
    startZ: 10,
    startRadius: 11,
    timeLimitSec: 110,
    rewardCash: 2500,
    steps: [
      { label: 'Blast North up Ocean Drive', x: 140, z: -110, radius: 13, requireInCar: true },
      { label: 'Hit the Key Sol Causeway entrance', x: 140, z: -200, radius: 13, requireInCar: true },
      { label: 'Cross the Causeway arch onto Key Sol', x: 262, z: -200, radius: 13, requireInCar: true },
      { label: 'Sweep around Key Sol North Point', x: 338, z: -255, radius: 14, requireInCar: true },
      { label: 'Drift the South Villa bend', x: 338, z: -145, radius: 14, requireInCar: true },
      { label: 'Sprint back to the Ocean Drive finish', x: 140, z: 70, radius: 15, requireInCar: true },
    ],
  },
  {
    id: 'south-pier-drop',
    title: 'South Pier Drop',
    district: 'South Pier',
    category: 'COURIER',
    description: 'Park at South Pier, run out on foot to the lighthouse, and deliver the case Downtown.',
    startX: 140,
    startZ: 130,
    startRadius: 11,
    timeLimitSec: 120,
    rewardCash: 3200,
    steps: [
      { label: 'Drive to the South Pier entrance', x: 154, z: 160, radius: 12, requireInCar: true },
      { label: 'Exit car [E] and run on foot to the Lighthouse Pavilion', x: 268, z: 160, radius: 10, requireOnFoot: true },
      { label: 'Hop back in a car and deliver the case to Downtown Biscayne', x: -200, z: -110, radius: 15, requireInCar: true },
    ],
  },
  {
    id: 'neon-midnight-run',
    title: 'Neon Strip Run',
    district: 'Neon Strip',
    category: 'COURIER',
    description: 'Hit four electric Midtown club drops before the clock runs dry.',
    startX: -20,
    startZ: -20,
    startRadius: 11,
    timeLimitSec: 90,
    rewardCash: 3000,
    steps: [
      { label: 'Drop at Club Solaris (North Neon Ave)', x: -20, z: -110, radius: 13, requireInCar: true },
      { label: 'Swing west to Brickell Velvet Lounge', x: -110, z: -20, radius: 13, requireInCar: true },
      { label: 'Cut south to Midtown Arcade', x: -20, z: 70, radius: 13, requireInCar: true },
      { label: 'Finish at Collins Terrace', x: 70, z: -20, radius: 14, requireInCar: true },
    ],
  },
  {
    id: 'boardwalk-stroll',
    title: 'Boardwalk Scoop',
    district: 'Palm Plaza',
    category: 'EXPLORE',
    description: 'Explore Sol Coast on foot from Palm Plaza down to the golden beach lifeguard towers.',
    startX: 40,
    startZ: 25,
    startRadius: 9,
    timeLimitSec: 0,
    rewardCash: 1800,
    steps: [
      { label: 'Walk east to the Boardwalk Promenade', x: 159, z: 10, radius: 9, requireOnFoot: true },
      { label: 'Check the Central Lifeguard Tower on the sand', x: 190, z: 10, radius: 9, requireOnFoot: true },
      { label: 'Stroll south along the surf to the South Lifeguard Tower', x: 190, z: 105, radius: 9, requireOnFoot: true },
      { label: 'Return up the boardwalk steps', x: 159, z: 70, radius: 10, requireOnFoot: true },
    ],
  },
  {
    id: 'marina-valet-express',
    title: 'Marina Valet Express',
    district: 'Marina Cove',
    category: 'VALET',
    description: 'Take the parked Key Sol Spyder from Marina Cove and deliver it to Collins Hotel Row.',
    startX: 10,
    startZ: 176,
    startRadius: 10,
    timeLimitSec: 95,
    rewardCash: 3500,
    steps: [
      {
        label: 'Enter the white Key Sol Spyder parked at Marina Cove',
        x: 18,
        z: 164,
        radius: 14,
        requireVehicleId: 'keysol-spyder',
      },
      {
        label: 'Cruise west along the Marina Boulevard',
        x: -110,
        z: 160,
        radius: 15,
        requireVehicleId: 'keysol-spyder',
      },
      {
        label: 'Deliver the Key Sol Spyder to Collins Hotel Row',
        x: 70,
        z: -110,
        radius: 15,
        requireVehicleId: 'keysol-spyder',
      },
    ],
  },
  {
    id: 'sol-coast-grand-tour',
    title: 'Sol Coast Grand Tour',
    district: 'Downtown Biscayne',
    category: 'RACE',
    description: 'A full-city coastal circuit linking Downtown, Marina Cove, Ocean Drive, and Key Sol.',
    startX: -110,
    startZ: -110,
    startRadius: 12,
    timeLimitSec: 150,
    rewardCash: 4500,
    steps: [
      { label: 'Head south through Biscayne to the Harbor Corner', x: -200, z: 160, radius: 15, requireInCar: true },
      { label: 'Race east along the Marina waterfront to South Pier', x: 140, z: 160, radius: 15, requireInCar: true },
      { label: 'Full throttle north up Ocean Drive to the Causeway', x: 140, z: -200, radius: 15, requireInCar: true },
      { label: 'Loop out to Key Sol East Overlook', x: 338, z: -200, radius: 16, requireInCar: true },
      { label: 'Return across the bridge to Palm Plaza North', x: 25, z: -20, radius: 16, requireInCar: true },
    ],
  },
  {
    id: 'wynwood-mural-dash',
    title: 'Wynwood Mural Dash',
    district: 'Wynwood Arts',
    category: 'COURIER',
    description: 'Weave through the Wynwood gallery blocks and deliver fresh prints to Sol Coast Arena.',
    startX: -110,
    startZ: -290,
    startRadius: 12,
    timeLimitSec: 105,
    rewardCash: 3400,
    steps: [
      { label: 'Pick up prints at Wynwood Central Gallery', x: -200, z: -290, radius: 14, requireInCar: true },
      { label: 'Cut north past the mural alleys', x: -290, z: -380, radius: 14, requireInCar: true },
      { label: 'Deliver to Sol Coast Arena Plaza', x: -290, z: -200, radius: 16, requireInCar: true },
    ],
  },
  {
    id: 'coral-heights-cruise',
    title: 'Coral Heights Tour',
    district: 'Coral Heights',
    category: 'EXPLORE',
    description: 'Cruise the Mediterranean boulevards of Coral Heights and shoot hoops at Coral Park.',
    startX: -290,
    startZ: 70,
    startRadius: 11,
    timeLimitSec: 0,
    rewardCash: 2200,
    steps: [
      { label: 'Drive west down Coral Boulevard', x: -380, z: 70, radius: 14, requireInCar: true },
      { label: 'Pull up to Coral Park Courts and step out [E]', x: -335, z: 25, radius: 12, requireOnFoot: true },
      { label: 'Head south to the West Marina Overlook', x: -380, z: 160, radius: 15, requireInCar: true },
    ],
  },
  {
    id: 'north-beach-grand-prix',
    title: 'North Bay Grand Prix',
    district: 'North Beach',
    category: 'RACE',
    description: 'Flat-out resort boulevard sprint across North Beach, Wynwood, and back down Ocean Drive.',
    startX: 70,
    startZ: -290,
    startRadius: 12,
    timeLimitSec: 125,
    rewardCash: 4200,
    steps: [
      { label: 'Fly north to North Bay Overlook', x: 140, z: -380, radius: 15, requireInCar: true },
      { label: 'Sweep west across North Boulevard', x: -110, z: -380, radius: 15, requireInCar: true },
      { label: 'Dive south through Midtown', x: -20, z: -200, radius: 15, requireInCar: true },
      { label: 'Finish at the North Beach Resort Strip', x: 140, z: -290, radius: 15, requireInCar: true },
    ],
  },
];

export interface ActiveMissionState {
  def: MissionDef;
  stepIndex: number;
  elapsedSec: number;
  remainingSec: number;
}

export interface MissionUpdateEvent {
  type: 'step' | 'complete' | 'fail' | 'hint';
  message: string;
  rewardCash?: number;
  missionId?: string;
  completionSec?: number;
}

export class MissionManager {
  public active: ActiveMissionState | null = null;
  public completedIds = new Set<string>();
  public bestTimes: Record<string, number> = {};
  public trackedMissionId: string | null = null;

  public startMission(id: string): MissionDef | null {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) return null;
    this.active = {
      def,
      stepIndex: 0,
      elapsedSec: 0,
      remainingSec: def.timeLimitSec,
    };
    this.trackedMissionId = null;
    return def;
  }

  public cancelMission(): MissionDef | null {
    if (!this.active) return null;
    const def = this.active.def;
    this.active = null;
    return def;
  }

  public findNearbyStartBeacon(x: number, z: number): MissionDef | null {
    if (this.active) return null;
    for (const m of MISSIONS) {
      if (distXZ(x, z, m.startX, m.startZ) <= m.startRadius) {
        return m;
      }
    }
    return null;
  }

  public trackNearestMission(x: number, z: number): MissionDef | null {
    const uncompleted = MISSIONS.filter((m) => !this.completedIds.has(m.id));
    const pool = uncompleted.length > 0 ? uncompleted : MISSIONS;
    let best: MissionDef | null = null;
    let bestDist = Infinity;
    for (const m of pool) {
      const d = distXZ(x, z, m.startX, m.startZ);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    this.trackedMissionId = best ? best.id : null;
    return best;
  }

  public getCurrentTarget(): { x: number; z: number; label: string; isActiveObjective: boolean } | null {
    if (this.active) {
      const step = this.active.def.steps[this.active.stepIndex];
      return { x: step.x, z: step.z, label: step.label, isActiveObjective: true };
    }
    if (this.trackedMissionId) {
      const m = MISSIONS.find((d) => d.id === this.trackedMissionId);
      if (m) {
        return { x: m.startX, z: m.startZ, label: `Mission: ${m.title}`, isActiveObjective: false };
      }
    }
    return null;
  }

  public update(
    dt: number,
    playerX: number,
    playerZ: number,
    vehicleId: string | null,
  ): MissionUpdateEvent | null {
    if (!this.active) return null;

    this.active.elapsedSec += dt;
    if (this.active.def.timeLimitSec > 0) {
      this.active.remainingSec -= dt;
      if (this.active.remainingSec <= 0) {
        const failedTitle = this.active.def.title;
        this.active = null;
        return {
          type: 'fail',
          message: `${failedTitle} — Time expired! Head back to retry anytime.`,
        };
      }
    }

    const step = this.active.def.steps[this.active.stepIndex];
    const d = distXZ(playerX, playerZ, step.x, step.z);
    if (d <= step.radius) {
      if (step.requireOnFoot && vehicleId !== null) {
        return null;
      }
      if (step.requireInCar && vehicleId === null) {
        return null;
      }
      if (step.requireVehicleId && vehicleId !== step.requireVehicleId) {
        return null;
      }

      this.active.stepIndex += 1;
      if (this.active.stepIndex >= this.active.def.steps.length) {
        const def = this.active.def;
        const sec = Number(this.active.elapsedSec.toFixed(1));
        this.completedIds.add(def.id);
        if (this.bestTimes[def.id] === undefined || sec < this.bestTimes[def.id]) {
          this.bestTimes[def.id] = sec;
        }
        this.active = null;
        return {
          type: 'complete',
          missionId: def.id,
          rewardCash: def.rewardCash,
          completionSec: sec,
          message: `Mission Complete: ${def.title} (+$${def.rewardCash.toLocaleString()})`,
        };
      }

      const nextStep = this.active.def.steps[this.active.stepIndex];
      return {
        type: 'step',
        message: `Checkpoint reached! Next: ${nextStep.label}`,
      };
    }

    return null;
  }
}

export interface MissionBeaconRenderer {
  update: (elapsed: number, manager: MissionManager) => void;
}

export function createMissionBeacons(scene: THREE.Scene): MissionBeaconRenderer {
  const root = new THREE.Group();

  const makeBeacon = (colorHex: number, radius: number, height: number): THREE.Group => {
    const g = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.72, height, 18, 1, true), beamMat);
    beam.position.y = height * 0.5;
    g.add(beam);

    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.72, radius * 0.95, 28), ringMat);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.2;
    g.add(ring);

    const gemMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), gemMat);
    gem.position.y = 3.2;
    g.add(gem);

    return g;
  };

  // Start beacons for all missions (Cyan = new, Mint = completed)
  const startBeacons = MISSIONS.map((m) => {
    const b = makeBeacon(0x2cf3ff, 3.6, 36);
    b.position.set(m.startX, getGroundHeight(m.startX, m.startZ), m.startZ);
    root.add(b);
    return { mission: m, group: b };
  });

  // Active objective gold checkpoint beacon
  const activeBeacon = makeBeacon(0xffcf5c, 5.2, 62);
  activeBeacon.visible = false;
  root.add(activeBeacon);

  scene.add(root);

  return {
    update(elapsed: number, manager: MissionManager) {
      const pulse = 1 + Math.sin(elapsed * 3.5) * 0.1;
      for (const item of startBeacons) {
        item.group.visible = manager.active === null;
        if (item.group.visible) {
          const isDone = manager.completedIds.has(item.mission.id);
          const color = isDone ? 0x46f7b4 : 0x2cf3ff;
          item.group.children.forEach((child) => {
            const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
            mat.color.setHex(color);
            if ('emissive' in mat) mat.emissive.setHex(color);
          });
          const gem = item.group.children[2];
          gem.rotation.y = elapsed * 2.1;
          gem.position.y = 3.2 + Math.sin(elapsed * 2.8) * 0.45;
          item.group.children[1].scale.set(pulse, pulse, 1);
        }
      }

      if (manager.active) {
        const step = manager.active.def.steps[manager.active.stepIndex];
        activeBeacon.visible = true;
        activeBeacon.position.set(step.x, getGroundHeight(step.x, step.z), step.z);
        const gem = activeBeacon.children[2];
        gem.rotation.y = elapsed * 3.0;
        gem.position.y = 4.0 + Math.sin(elapsed * 3.6) * 0.55;
        activeBeacon.children[1].scale.set(pulse, pulse, 1);
      } else {
        activeBeacon.visible = false;
      }
    },
  };
}
