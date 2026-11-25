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

    this.clockEl.textContent = timeLabel;
    this.districtEl.textContent = district.name.toUpperCase();
    this.cashEl.textContent = `$${cash.toLocaleString()}`;
    this.rankEl.textContent = computePlayerRank(cash, missions.completedIds.size);
    this.modeEl.textContent = activeVehicle ? 'DRIVING' : 'ON FOOT';
    const perfStr = fps !== undefined ? ` · ${fps} FPS (${drawCalls ?? 0} draws)` : '';
    this.progressEl.textContent = `Missions ${missions.completedIds.size}/${MISSIONS.length} · Districts ${discoveredCount}/${ALL_DISTRICT_IDS.length}${perfStr}`;

    // Mission panel
    if (missions.active) {
      const m = missions.active;
      const step = m.def.steps[m.stepIndex];
      const dist = Math.round(distXZ(player.x, player.z, step.x, step.z));
      this.missionPanel.classList.remove('hidden');
      this.missionCatEl.textContent = m.def.category;
      this.missionTitleEl.textContent = m.def.title.toUpperCase();
      this.missionObjEl.textContent = step.label;
      this.missionStepEl.textContent = `Objective ${m.stepIndex + 1} / ${m.def.steps.length}`;
      this.missionDistEl.textContent = `${dist}m`;
      if (m.def.timeLimitSec > 0) {
        const secs = Math.max(0, Math.ceil(m.remainingSec));
        const mm = Math.floor(secs / 60);
        const ss = secs % 60;
        this.missionTimerEl.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        this.missionTimerEl.classList.remove('hidden');
      } else {
        this.missionTimerEl.classList.add('hidden');
      }
    } else {
      this.missionPanel.classList.add('hidden');
    }

    // Context interact prompt
    if (promptText) {
      this.interactPrompt.classList.remove('hidden');
      this.interactText.textContent = promptText;
    } else {
      this.interactPrompt.classList.add('hidden');
    }

    // Speedometer vs On-Foot panel
    if (activeVehicle) {
      this.speedoPanel.classList.remove('hidden');
      this.onFootPanel.classList.add('hidden');
      const mph = speedToMph(activeVehicle.speed);
      this.vehicleNameEl.textContent = activeVehicle.name.toUpperCase();
      this.speedValEl.textContent = String(mph);
      this.gearValEl.textContent = formatVehicleGear(activeVehicle);
      this.vehicleBadgeEl.classList.toggle('hidden', !activeVehicle.drifting);
      const rpmPct = Math.round(6 + Math.min(1, Math.max(0, activeVehicle.rpm)) * 94);
      this.rpmFillEl.style.width = `${rpmPct}%`;
      const safePaintIdx =
        ((Math.trunc(activeVehicle.paintIndex) % PAINT_FINISHES.length) + PAINT_FINISHES.length) %
        PAINT_FINISHES.length;
      const finish = PAINT_FINISHES[safePaintIdx];
      this.paintNameEl.textContent = finish.name;
      this.odoValEl.textContent = `${(activeVehicle.odometerMeters / 1609.34).toFixed(1)} mi`;
    } else {
      this.speedoPanel.classList.add('hidden');
      this.onFootPanel.classList.remove('hidden');
      this.onFootStatusEl.textContent = player.sprinting
        ? `Sprinting in ${district.name}`
        : player.speed > 0.4
          ? `Walking in ${district.name}`
          : `Exploring ${district.name}`;
      let minDist = Infinity;
      let nearestName = '';
      for (const v of vehicles) {
        const d = distXZ(player.x, player.z, v.x, v.z);
        if (d < minDist) {
          minDist = d;
          nearestName = v.name;
        }
      }
      this.nearestCarDistEl.textContent = `Nearest: ${nearestName} (${Math.round(minDist)}m)`;
    }
  }
}
