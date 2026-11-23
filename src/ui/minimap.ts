import type { PlayerState } from '../entities/player';
import type { TrafficCarState } from '../entities/traffic';
import type { VehicleState } from '../entities/vehicle';
import { CAUSEWAY, KEY_SOL_BOUNDS, SOUTH_PIER } from '../world/cityData';
import {
  INTERIORS,
  getFloorFromPlayerY,
  getInteriorFloorLabel,
  type InteriorDef,
} from '../world/interiors';
import type { CityBlueprint } from '../world/types';
import { MISSIONS, type MissionManager } from '../systems/missions';

const WORLD_MIN_X = -460;
const WORLD_MAX_X = 430;
const WORLD_MIN_Z = -450;
const WORLD_MAX_Z = 320;
const CACHE_SCALE = 0.65; // pixels per meter on pre-rendered static map

export class MinimapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private staticMapCanvas: HTMLCanvasElement | null = null;
  private frameSkip = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.size = canvas.width;
  }

  private ensureStaticMap(blueprint: CityBlueprint): HTMLCanvasElement {
    if (this.staticMapCanvas) return this.staticMapCanvas;
    const w = Math.ceil((WORLD_MAX_X - WORLD_MIN_X) * CACHE_SCALE);
    const h = Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) * CACHE_SCALE);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;

    const px = (wx: number) => (wx - WORLD_MIN_X) * CACHE_SCALE;
    const pz = (wz: number) => (wz - WORLD_MIN_Z) * CACHE_SCALE;

    ctx.fillStyle = '#092438';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#1b263b';
    ctx.fillRect(px(-428), pz(-410), 584 * CACHE_SCALE, 602 * CACHE_SCALE);

    ctx.fillStyle = '#a98e62';
    ctx.fillRect(px(165), pz(-184), 46 * CACHE_SCALE, 376 * CACHE_SCALE);

    ctx.fillStyle = '#244b3c';
    ctx.fillRect(
      px(KEY_SOL_BOUNDS.minX),
      pz(KEY_SOL_BOUNDS.minZ),
      (KEY_SOL_BOUNDS.maxX - KEY_SOL_BOUNDS.minX) * CACHE_SCALE,
      (KEY_SOL_BOUNDS.maxZ - KEY_SOL_BOUNDS.minZ) * CACHE_SCALE,
    );

    // Palm Plaza & Coral Park green squares
    ctx.fillStyle = '#235e45';
    ctx.fillRect(px(-8), pz(-8), 66 * CACHE_SCALE, 66 * CACHE_SCALE);
    ctx.fillRect(px(-368), pz(-8), 66 * CACHE_SCALE, 66 * CACHE_SCALE);

    ctx.fillStyle = '#8b6546';
    ctx.fillRect(
      px(SOUTH_PIER.startX),
      pz(SOUTH_PIER.centerZ - SOUTH_PIER.halfWidth),
      (SOUTH_PIER.endX - SOUTH_PIER.startX) * CACHE_SCALE,
      SOUTH_PIER.halfWidth * 2 * CACHE_SCALE,
    );

    ctx.strokeStyle = '#47556f';
    ctx.lineCap = 'square';
    for (const r of blueprint.roads) {
      ctx.lineWidth = Math.max(2, r.width * CACHE_SCALE);
      ctx.beginPath();
      ctx.moveTo(px(r.x1), pz(r.z1));
      ctx.lineTo(px(r.x2), pz(r.z2));
      ctx.stroke();
    }

    ctx.strokeStyle = '#53c8df';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px(CAUSEWAY.startX), pz(CAUSEWAY.centerZ));
    ctx.lineTo(px(CAUSEWAY.endX), pz(CAUSEWAY.centerZ));
    ctx.stroke();

    ctx.fillStyle = 'rgba(130, 155, 195, 0.36)';
    for (const b of blueprint.buildings) {
      ctx.fillRect(
        px(b.x - b.width * 0.5),
        pz(b.z - b.depth * 0.5),
        b.width * CACHE_SCALE,
        b.depth * CACHE_SCALE,
      );
    }

    this.staticMapCanvas = c;
    return c;
  }

  public render(
    blueprint: CityBlueprint,
    player: PlayerState,
    vehicles: VehicleState[],
    traffic: TrafficCarState[],
    missions: MissionManager,
    activeInterior?: InteriorDef | null,
    openDoorIds?: ReadonlySet<string>,
    ownedKeycards?: ReadonlySet<string>,
  ): void {
    // Throttle 2D minimap redraws to every 2nd frame (~30 Hz) for near-zero CPU overhead
    this.frameSkip = (this.frameSkip + 1) % 2;
    if (this.frameSkip !== 0 && this.staticMapCanvas && !activeInterior) return;

    const ctx = this.ctx;
    const s = this.size;
    const half = s * 0.5;

    // Dedicated crisp Multi-Room & Multi-Floor Interior Floorplan Minimap when inside a building!
    if (activeInterior) {
      ctx.fillStyle = '#0c101b';
      ctx.fillRect(0, 0, s, s);

      const floor = getFloorFromPlayerY(player.y, activeInterior);
      const floorRooms = activeInterior.rooms.filter((r) => (r.floor ?? 0) === floor);
      const roomsToDraw = floorRooms.length > 0 ? floorRooms : activeInterior.rooms;
      const minX = Math.min(...roomsToDraw.map((r) => r.minX));
      const maxX = Math.max(...roomsToDraw.map((r) => r.maxX));
      const minZ = Math.min(...roomsToDraw.map((r) => r.minZ));
      const maxZ = Math.max(...roomsToDraw.map((r) => r.maxZ));

      const spanX = Math.max(4, maxX - minX);
      const spanZ = Math.max(4, maxZ - minZ);
      const midX = (minX + maxX) * 0.5;
      const midZ = (minZ + maxZ) * 0.5;
      const roomScale = (s - 34) / Math.max(spanX, spanZ);
      const ix = (wx: number) => half + (wx - midX) * roomScale;
      const iz = (wz: number) => half + 7 + (wz - midZ) * roomScale;

      // 1. Each connected room on this floor shaded with its own distinct tint
      for (const room of roomsToDraw) {
        ctx.fillStyle = room.floorMapTint;
        ctx.fillRect(
          ix(room.minX),
          iz(room.minZ),
          (room.maxX - room.minX) * roomScale,
          (room.maxZ - room.minZ) * roomScale,
        );
      }

      // 2. Built-in counters & individual rotated 3D furniture OBBs on this floor
      ctx.fillStyle = 'rgba(200, 214, 238, 0.34)';
      for (const box of activeInterior.colliders) {
        if ((box.floor ?? 0) !== floor) continue;
        ctx.fillRect(
          ix(box.minX),
          iz(box.minZ),
          (box.maxX - box.minX) * roomScale,
          (box.maxZ - box.minZ) * roomScale,
        );
      }
      ctx.fillStyle = 'rgba(210, 224, 245, 0.28)';
      for (const obb of activeInterior.propColliders) {
        if ((obb.floor ?? 0) !== floor) continue;
        ctx.save();
        ctx.translate(ix(obb.cx), iz(obb.cz));
        ctx.rotate(-obb.rotY);
        ctx.fillRect(
          -obb.halfW * roomScale,
          -obb.halfD * roomScale,
          obb.halfW * 2 * roomScale,
          obb.halfD * 2 * roomScale,
        );
        ctx.restore();
      }

      // 3. Solid perimeter & interior partition walls on this floor (leaves open doorways visible!)
      ctx.fillStyle = '#7cd0ff';
      for (const wall of activeInterior.walls) {
        if ((wall.floor ?? 0) !== floor) continue;
        const wPx = Math.max(1.8, (wall.maxX - wall.minX) * roomScale);
        const hPx = Math.max(1.8, (wall.maxZ - wall.minZ) * roomScale);
        ctx.fillRect(ix(wall.minX), iz(wall.minZ), wPx, hPx);
      }

      // 3b. Interactive Hinged Room Doors (green = open, amber = unlocked/closed, crimson = locked!)
      for (const door of activeInterior.doors ?? []) {
        if ((door.floor ?? 0) !== floor) continue;
        const isOpen = openDoorIds?.has(door.id) ?? false;
        const isLocked = Boolean(
          door.occupied || (door.requiredKeycard && !ownedKeycards?.has(door.requiredKeycard)),
        );
        ctx.fillStyle = isOpen ? '#46f7b4' : isLocked ? '#ff5470' : '#ffcf5c';
        if (door.axis === 'x') {
          ctx.fillRect(ix(door.coord) - 1.5, iz(door.min), 3.0, Math.max(3, (door.max - door.min) * roomScale));
        } else {
          ctx.fillRect(ix(door.min), iz(door.coord) - 1.5, Math.max(3, (door.max - door.min) * roomScale), 3.0);
        }
      }

      // 4. Subtle room labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = 'bold 7px system-ui';
      ctx.textAlign = 'center';
      for (const room of roomsToDraw) {
        const rcx = ix((room.minX + room.maxX) * 0.5);
        const rcz = iz((room.minZ + room.maxZ) * 0.5);
        ctx.fillText(room.shortLabel, rcx, rcz + 2);
      }

      // 5. Exit door marker (mint green, Ground Floor only)
      if (floor === 0) {
        ctx.fillStyle = '#46f7b4';
        ctx.fillRect(ix(activeInterior.exitX) - 7, iz(activeInterior.exitZ) - 3, 14, 6);
      }

      // 5b. Elevator markers on this floor (bright cyan EL badge)
      for (const elev of activeInterior.elevators ?? []) {
        if (elev.floor !== floor) continue;
        const ex = ix(elev.x);
        const ez = iz(elev.z);
        ctx.fillStyle = '#2cf3ff';
        ctx.fillRect(ex - 7, ez - 5, 14, 10);
        ctx.fillStyle = '#08121e';
        ctx.font = 'bold 7px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('EL', ex, ez + 2.5);
      }

      // 6. Indoor NPCs on this floor (gold dots)
      ctx.fillStyle = '#ffd166';
      for (const npc of activeInterior.npcs) {
        if ((npc.floor ?? 0) !== floor) continue;
        ctx.beginPath();
        ctx.arc(ix(npc.x), iz(npc.z), 3.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 7. Player directional arrow
      ctx.save();
      ctx.translate(ix(player.x), iz(player.z));
      ctx.rotate(player.yaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 4.2);
      ctx.lineTo(0, 1.8);
      ctx.lineTo(-4.2, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const floorLabel = getInteriorFloorLabel(activeInterior, floor);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 8.5px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        floorLabel ? `${activeInterior.name.toUpperCase()} · ${floorLabel.toUpperCase()}` : activeInterior.name.toUpperCase(),
        half,
        12,
      );
      return;
    }

    const scale = s / 420;
    const staticCanvas = this.ensureStaticMap(blueprint);

    const toMap = (wx: number, wz: number) => ({
      mx: half + (wx - player.x) * scale,
      my: half + (wz - player.z) * scale,
    });

    ctx.fillStyle = '#092438';
    ctx.fillRect(0, 0, s, s);

    // Blit pre-rendered static city map in ONE fast GPU-accelerated drawImage call
    const ratio = scale / CACHE_SCALE;
    const destX = half + (WORLD_MIN_X - player.x) * scale;
    const destY = half + (WORLD_MIN_Z - player.z) * scale;
    ctx.drawImage(staticCanvas, destX, destY, staticCanvas.width * ratio, staticCanvas.height * ratio);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    for (const t of traffic) {
      const tp = toMap(t.x, t.z);
      ctx.fillRect(tp.mx - 1.5, tp.my - 1.5, 3, 3);
    }

    for (const v of vehicles) {
      const vp = toMap(v.x, v.z);
      ctx.fillStyle = v.id === player.vehicleId ? '#ffffff' : '#ff5e8e';
      ctx.beginPath();
      ctx.arc(vp.mx, vp.my, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!missions.active) {
      for (const m of MISSIONS) {
        const mp = toMap(m.startX, m.startZ);
        const done = missions.completedIds.has(m.id);
        ctx.fillStyle = done ? '#46f7b4' : '#2cf3ff';
        ctx.beginPath();
        ctx.arc(mp.mx, mp.my, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Enterable interior doorway markers (warm amber diamonds on minimap!)
    ctx.fillStyle = '#ffb347';
    for (const venue of INTERIORS) {
      const vp = toMap(venue.entranceX, venue.entranceZ);
      ctx.save();
      ctx.translate(vp.mx, vp.my);
      ctx.rotate(Math.PI * 0.25);
      ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
      ctx.restore();
    }

    const target = missions.getCurrentTarget();
    if (target) {
      const tp = toMap(target.x, target.z);
      const dx = tp.mx - half;
      const dy = tp.my - half;
      const maxR = half - 10;
      const len = Math.hypot(dx, dy);
      const cx = len > maxR ? half + (dx / len) * maxR : tp.mx;
      const cy = len > maxR ? half + (dy / len) * maxR : tp.my;

      ctx.strokeStyle = 'rgba(255, 207, 92, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ffcf5c';
      ctx.beginPath();
      ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#121520';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', half, 12);
  }
}
