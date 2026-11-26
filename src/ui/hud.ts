import { distXZ } from '../core/math';
import type { PlayerState } from '../entities/player';
import {
  PAINT_FINISHES,
  formatVehicleGear,
  speedToMph,
  type VehicleState,
} from '../entities/vehicle';
import { MISSIONS, type MissionManager } from '../systems/missions';
import { computePlayerRank } from '../systems/persistence';
import { ALL_DISTRICT_IDS } from '../world/cityData';
import type { DistrictInfo } from '../world/types';

export class HudController {
  private readonly clockEl = document.getElementById('hud-clock')!;
  private readonly districtEl = document.getElementById('hud-district')!;
  private readonly cashEl = document.getElementById('hud-cash')!;
  private readonly rankEl = document.getElementById('hud-rank')!;
  private readonly modeEl = document.getElementById('hud-mode')!;
  private readonly progressEl = document.getElementById('hud-progress')!;

  private readonly missionPanel = document.getElementById('mission-panel')!;
  private readonly missionCatEl = document.getElementById('mission-category')!;
  private readonly missionTitleEl = document.getElementById('mission-title')!;
  private readonly missionTimerEl = document.getElementById('mission-timer')!;
  private readonly missionObjEl = document.getElementById('mission-objective')!;
  private readonly missionStepEl = document.getElementById('mission-step')!;
  private readonly missionDistEl = document.getElementById('mission-distance')!;

  private readonly speedoPanel = document.getElementById('speedo-panel')!;
  private readonly vehicleNameEl = document.getElementById('vehicle-name')!;
  private readonly vehicleBadgeEl = document.getElementById('vehicle-badge')!;
  private readonly speedValEl = document.getElementById('speed-value')!;
  private readonly gearValEl = document.getElementById('gear-value')!;
  private readonly rpmFillEl = document.getElementById('rpm-bar-fill')!;
  private readonly paintNameEl = document.getElementById('paint-name')!;
  private readonly odoValEl = document.getElementById('odometer-value')!;

  private readonly onFootPanel = document.getElementById('onfoot-panel')!;
  private readonly onFootStatusEl = document.getElementById('onfoot-status')!;
  private readonly nearestCarDistEl = document.getElementById('nearest-car-dist')!;

  private readonly interactPrompt = document.getElementById('interact-prompt')!;
  private readonly interactText = document.getElementById('interact-text')!;
  private readonly districtBanner = document.getElementById('district-banner')!;
  private readonly toastContainer = document.getElementById('toast-container')!;
  private readonly saveIndicator = document.getElementById('save-indicator')!;

  public readonly pauseOverlay = document.getElementById('pause-overlay')!;
  private readonly pauseMissionList = document.getElementById('pause-mission-list')!;
  public readonly btnResume = document.getElementById('btn-resume')!;
  public readonly btnSave = document.getElementById('btn-save')!;
  public readonly btnExport = document.getElementById('btn-export')!;
  public readonly btnAudio = document.getElementById('btn-audio')!;
  public readonly btnReset = document.getElementById('btn-reset')!;

  private bannerTimer: number | null = null;
  private saveTimer: number | null = null;
  private readonly textCache = new Map<HTMLElement, string>();
  private readonly hiddenCache = new Map<HTMLElement, boolean>();
  private lastRpmPct = -1;

  private setText(el: HTMLElement, text: string): void {
    if (this.textCache.get(el) === text) return;
    this.textCache.set(el, text);
    el.textContent = text;
  }

  private setHidden(el: HTMLElement, hidden: boolean): void {
    if (this.hiddenCache.get(el) === hidden) return;
    this.hiddenCache.set(el, hidden);
    el.classList.toggle('hidden', hidden);
  }

  public showToast(message: string, tone: 'info' | 'success' | 'warn' = 'info'): void {
    while (this.toastContainer.childElementCount >= 6) {
      this.toastContainer.firstElementChild?.remove();
    }
    const el = document.createElement('div');
    el.className = `toast ${tone === 'success' ? 'toast-success' : tone === 'warn' ? 'toast-warn' : ''}`;
    el.textContent = message;
    this.toastContainer.appendChild(el);
    window.setTimeout(() => el.remove(), 4200);
  }

  public showDistrictBanner(title: string): void {
    this.districtBanner.textContent = title;
    this.districtBanner.classList.remove('hidden');
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.districtBanner.classList.add('hidden');
    }, 3200);
  }

  public flashSaved(): void {
    this.saveIndicator.classList.remove('hidden');
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveIndicator.classList.add('hidden');
    }, 1800);
  }

  public setAudioButton(enabled: boolean): void {
    this.btnAudio.textContent = `Audio: ${enabled ? 'ON' : 'OFF'}`;
  }

  public setPauseMenu(open: boolean, missions: MissionManager): void {
    this.pauseOverlay.classList.toggle('hidden', !open);
    if (open) {
      this.pauseMissionList.replaceChildren();
      for (const m of MISSIONS) {
        const done = missions.completedIds.has(m.id);
        const rawBest = Object.prototype.hasOwnProperty.call(missions.bestTimes, m.id)
          ? missions.bestTimes[m.id]
          : undefined;
        const best = typeof rawBest === 'number' && Number.isFinite(rawBest) && rawBest > 0 ? rawBest : undefined;

        const row = document.createElement('div');
        row.className = `pause-mission-item ${done ? 'done' : ''}`;

        const infoWrap = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'm-name';
        nameEl.textContent = m.title;

        const subEl = document.createElement('div');
        subEl.className = 'm-sub';
        subEl.textContent = `${m.district} · $${m.rewardCash.toLocaleString()}`;

        infoWrap.append(nameEl, subEl);

        const pillEl = document.createElement('span');
        pillEl.className = `pill ${done ? 'pill-time' : 'pill-mission'}`;
        pillEl.textContent = done ? (best !== undefined ? `DONE ${best}s` : 'DONE') : m.category;

        row.append(infoWrap, pillEl);
        this.pauseMissionList.appendChild(row);
      }
    }
  }

  public update(params: {
    timeLabel: string;
    district: DistrictInfo;
    cash: number;
    discoveredCount: number;
    player: PlayerState;
    activeVehicle: VehicleState | null;
    vehicles: VehicleState[];
    missions: MissionManager;
    promptText: string | null;
    fps?: number;
    drawCalls?: number;
  }): void {
    const {
      timeLabel,
      district,
      cash,
      discoveredCount,
      player,
      activeVehicle,
      vehicles,
      missions,
      promptText,
      fps,
      drawCalls,
    } = params;

    this.setText(this.clockEl, timeLabel);
    this.setText(this.districtEl, district.name.toUpperCase());
    this.setText(this.cashEl, `$${cash.toLocaleString()}`);
    this.setText(this.rankEl, computePlayerRank(cash, missions.completedIds.size));
    this.setText(this.modeEl, activeVehicle ? 'DRIVING' : 'ON FOOT');
    const perfStr = fps !== undefined ? ` · ${fps} FPS (${drawCalls ?? 0} draws)` : '';
    this.setText(
      this.progressEl,
      `Missions ${missions.completedIds.size}/${MISSIONS.length} · Districts ${discoveredCount}/${ALL_DISTRICT_IDS.length}${perfStr}`,
    );

    // Mission panel
    if (missions.active) {
      const m = missions.active;
      const step = m.def.steps[m.stepIndex];
      const dist = Math.round(distXZ(player.x, player.z, step.x, step.z));
      this.setHidden(this.missionPanel, false);
      this.setText(this.missionCatEl, m.def.category);
      this.setText(this.missionTitleEl, m.def.title.toUpperCase());
      this.setText(this.missionObjEl, step.label);
      this.setText(this.missionStepEl, `Objective ${m.stepIndex + 1} / ${m.def.steps.length}`);
      this.setText(this.missionDistEl, `${dist}m`);
      if (m.def.timeLimitSec > 0) {
        const secs = Math.max(0, Math.ceil(m.remainingSec));
        const mm = Math.floor(secs / 60);
        const ss = secs % 60;
        this.setText(this.missionTimerEl, `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
        this.setHidden(this.missionTimerEl, false);
      } else {
        this.setHidden(this.missionTimerEl, true);
      }
    } else {
      this.setHidden(this.missionPanel, true);
    }

    // Context interact prompt
    if (promptText) {
      this.setHidden(this.interactPrompt, false);
      this.setText(this.interactText, promptText);
    } else {
      this.setHidden(this.interactPrompt, true);
    }

    // Speedometer vs On-Foot panel
    if (activeVehicle) {
      this.setHidden(this.speedoPanel, false);
      this.setHidden(this.onFootPanel, true);
      const mph = speedToMph(activeVehicle.speed);
      this.setText(this.vehicleNameEl, activeVehicle.name.toUpperCase());
      this.setText(this.speedValEl, String(mph));
      this.setText(this.gearValEl, formatVehicleGear(activeVehicle));
      this.setHidden(this.vehicleBadgeEl, !activeVehicle.drifting);
      const rpmPct = Math.round(6 + Math.min(1, Math.max(0, activeVehicle.rpm)) * 94);
      if (rpmPct !== this.lastRpmPct) {
        this.lastRpmPct = rpmPct;
        this.rpmFillEl.style.transform = `scaleX(${(rpmPct / 100).toFixed(2)})`;
      }
      const safePaintIdx =
        ((Math.trunc(activeVehicle.paintIndex) % PAINT_FINISHES.length) + PAINT_FINISHES.length) %
        PAINT_FINISHES.length;
      const finish = PAINT_FINISHES[safePaintIdx];
      this.setText(this.paintNameEl, finish.name);
      this.setText(this.odoValEl, `${(activeVehicle.odometerMeters / 1609.34).toFixed(1)} mi`);
    } else {
      this.setHidden(this.speedoPanel, true);
      this.setHidden(this.onFootPanel, false);
      this.setText(
        this.onFootStatusEl,
        player.sprinting
          ? `Sprinting in ${district.name}`
          : player.speed > 0.4
            ? `Walking in ${district.name}`
            : `Exploring ${district.name}`,
      );
      let minDistSq = Infinity;
      let nearestName = '';
      for (const v of vehicles) {
        const dx = player.x - v.x;
        const dz = player.z - v.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          nearestName = v.name;
        }
      }
      this.setText(this.nearestCarDistEl, `Nearest: ${nearestName} (${Math.round(Math.sqrt(minDistSq))}m)`);
    }
  }
}
