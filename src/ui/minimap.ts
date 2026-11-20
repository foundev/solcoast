import type { PlayerState } from '../entities/player';
import type { TrafficCarState } from '../entities/traffic';
import type { VehicleState } from '../entities/vehicle';
import { CAUSEWAY, KEY_SOL_BOUNDS, SOUTH_PIER } from '../world/cityData';
import type { CityBlueprint } from '../world/types';
import { MISSIONS, type MissionManager } from '../systems/missions';

export class MinimapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.size = canvas.width;
  }

  public render(
    blueprint: CityBlueprint,
    player: PlayerState,
    vehicles: VehicleState[],
    traffic: TrafficCarState[],
    missions: MissionManager,
  ): void {
    const ctx = this.ctx;
    const s = this.size;
    const half = s * 0.5;
    // Scale: ~260m radius visible around player
    const scale = s / 420;

    const toMap = (wx: number, wz: number) => ({
      mx: half + (wx - player.x) * scale,
      my: half + (wz - player.z) * scale,
    });

    // Deep Atlantic background
    ctx.fillStyle = '#092438';
    ctx.fillRect(0, 0, s, s);

    // Mainland block
    const ml = toMap(-248, -228);
    ctx.fillStyle = '#1b263b';
    ctx.fillRect(ml.mx, ml.my, 408 * scale, 420 * scale);

    // Sandy beach strip
    const bch = toMap(165, -184);
    ctx.fillStyle = '#a98e62';
    ctx.fillRect(bch.mx, bch.my, 50 * scale, 376 * scale);

    // Key Sol island
    const ks = toMap(KEY_SOL_BOUNDS.minX, KEY_SOL_BOUNDS.minZ);
    ctx.fillStyle = '#244b3c';
    ctx.fillRect(
      ks.mx,
      ks.my,
      (KEY_SOL_BOUNDS.maxX - KEY_SOL_BOUNDS.minX) * scale,
      (KEY_SOL_BOUNDS.maxZ - KEY_SOL_BOUNDS.minZ) * scale,
    );

    // Palm Plaza green park
    const pp = toMap(-8, -8);
    ctx.fillStyle = '#235e45';
    ctx.fillRect(pp.mx, pp.my, 66 * scale, 66 * scale);

    // South Pier
    const sp = toMap(SOUTH_PIER.startX, SOUTH_PIER.centerZ - SOUTH_PIER.halfWidth);
    ctx.fillStyle = '#8b6546';
    ctx.fillRect(
      sp.mx,
      sp.my,
      (SOUTH_PIER.endX - SOUTH_PIER.startX) * scale,
      SOUTH_PIER.halfWidth * 2 * scale,
    );

    // Roads
    ctx.strokeStyle = '#47556f';
    ctx.lineCap = 'square';
    for (const r of blueprint.roads) {
      const p1 = toMap(r.x1, r.z1);
      const p2 = toMap(r.x2, r.z2);
      ctx.lineWidth = Math.max(2, r.width * scale);
      ctx.beginPath();
      ctx.moveTo(p1.mx, p1.my);
      ctx.lineTo(p2.mx, p2.my);
      ctx.stroke();
    }

    // Causeway highlight
    const cw1 = toMap(CAUSEWAY.startX, CAUSEWAY.centerZ);
    const cw2 = toMap(CAUSEWAY.endX, CAUSEWAY.centerZ);
    ctx.strokeStyle = '#53c8df';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cw1.mx, cw1.my);
    ctx.lineTo(cw2.mx, cw2.my);
    ctx.stroke();

    // Buildings
    ctx.fillStyle = 'rgba(130, 155, 195, 0.34)';
    for (const b of blueprint.buildings) {
      const bp = toMap(b.x - b.width * 0.5, b.z - b.depth * 0.5);
      ctx.fillRect(bp.mx, bp.my, b.width * scale, b.depth * scale);
    }

    // Ambient traffic blips
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    for (const t of traffic) {
      const tp = toMap(t.x, t.z);
      ctx.fillRect(tp.mx - 1.5, tp.my - 1.5, 3, 3);
    }

    // Player-drivable vehicles (coral dots)
    for (const v of vehicles) {
      const vp = toMap(v.x, v.z);
      ctx.fillStyle = v.id === player.vehicleId ? '#ffffff' : '#ff5e8e';
      ctx.beginPath();
      ctx.arc(vp.mx, vp.my, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Available mission beacons
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

    // Active objective or tracked mission waypoint (clamped to radar edge if off-screen)
    const target = missions.getCurrentTarget();
    if (target) {
      const tp = toMap(target.x, target.z);
      const dx = tp.mx - half;
      const dy = tp.my - half;
      const maxR = half - 10;
      const len = Math.hypot(dx, dy);
      const cx = len > maxR ? half + (dx / len) * maxR : tp.mx;
      const cy = len > maxR ? half + (dy / len) * maxR : tp.my;

      // Dashed GPS line
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

    // Player directional chevron in center
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

    // North indicator
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', half, 12);
  }
}
