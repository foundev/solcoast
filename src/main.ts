import * as THREE from 'three';

import {
  SoundEngine,
  computeSpatialPanGain,
  detectInteriorFootstepSurface,
  detectOutdoorFootstepSurface,
} from './core/audio';
import { InputManager } from './core/input';
import { clamp, distXZ } from './core/math';
import { createCoastalBoatFleet, createCoastalBoatMeshes } from './entities/boats';
import {
  createPedestrianMeshes,
  createPedestrians,
  stepPedestrians,
} from './entities/pedestrians';
import {
  computeSafeExitPosition,
  createInitialPlayerState,
  createPlayerMesh,
  findNearestVehicle,
  stepPlayerOnFoot,
  type PlayerState,
} from './entities/player';
import {
  createTrafficCars,
  createTrafficMeshes,
  findNearestTrafficCar,
  relocateTrafficCarAway,
  stepTraffic,
} from './entities/traffic';
import {
  DEFAULT_VEHICLES,
  PAINT_FINISHES,
  createActiveHeadlightRig,
  createVehicleConfigForModel,
  createVehicleMesh,
  createVehicleState,
  getModelDisplayName,
  resolveVehiclePairCollisions,
  stepVehiclePhysics,
  type VehicleMeshHandles,
  type VehicleState,
} from './entities/vehicle';
import { CameraController } from './systems/camera';
import { CrashEffectsSystem } from './systems/crashEffects';
import { MissionManager, createMissionBeacons } from './systems/missions';
import {
  clearWorldSave,
  loadWorld,
  saveWorld,
  serializeWorldState,
} from './systems/persistence';
import { RagdollPhysicsWorld } from './systems/ragdollWorld';
import { HudController } from './ui/hud';
import { MinimapRenderer } from './ui/minimap';
import {
  INTERIOR_PROP_KINDS,
  INTERIOR_TEXTURE_KEYS,
  loadGameAssets,
  loadInteriorPropAssets,
  loadInteriorTextures,
} from './world/assets';
import { buildCityScene } from './world/cityBuilder';
import {
  createCityBlueprint,
  getDistrictAt,
  getGroundHeight,
} from './world/cityData';
import {
  FLOOR_STRIDE_Y,
  INTERIOR_ORIGIN_Y,
  createInteriorSystem,
  findNearbyBuildingEntrance,
  findNearbyInteriorDoor,
  findNearbyInteriorElevator,
  findNearbyInteriorNpc,
  getFloorFromPlayerY,
  getInteriorRoomAt,
  interiorLocalToWorld,
  stepPlayerInInterior,
  type InteriorDef,
} from './world/interiors';
import { SkySystem, TIME_PRESETS, formatTimeLabel } from './world/sky';
import { buildStreetProps } from './world/streetProps';
import type { DistrictId } from './world/types';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  const loadingScreen = document.getElementById('loading-screen');
  const loadingBarFill = document.getElementById('loading-bar-fill');
  const loadingStatus = document.getElementById('loading-status');
  const loadingPct = document.getElementById('loading-pct');
  const loadingTip = document.getElementById('loading-tip');
  const hudEl = document.getElementById('hud');

  const tips = [
    'Tip: Press [E] at Hotel Solaire, Club Neon, Café Habana, or Wynwood Gallery to step inside.',
    'Tip: Pull straight into Club Neon’s rear VIP Parking Lot off the east avenue or north street.',
    'Tip: Check in with Concierge Elena at Hotel Solaire’s 1F front desk to unlock Suite 201 & the 3F Penthouse.',
    'Tip: Press [T] anytime to cycle between Sunset Golden Hour, Midday, and Neon Midnight.',
  ];
  if (loadingTip) {
    loadingTip.textContent = tips[Math.floor(Math.random() * tips.length)];
  }

  // Total real tracked asset items: 41 core game assets + 68 Blender/CC0 props + 8 interior PBR sets + Rapier WASM + world build + GPU warm-up
  const totalSteps = 41 + INTERIOR_PROP_KINDS.length + INTERIOR_TEXTURE_KEYS.length + 3;
  let completedSteps = 0;
  const advanceLoading = (label?: string, count = 1) => {
    completedSteps = Math.min(totalSteps, completedSteps + count);
    const pct = Math.round((completedSteps / totalSteps) * 100);
    if (loadingBarFill) loadingBarFill.style.width = `${Math.max(2, pct)}%`;
    if (loadingPct) loadingPct.textContent = `${pct}%`;
    if (label && loadingStatus) loadingStatus.textContent = label;
  };

  // Yield 2 animation frames so the browser immediately paints the loading screen on frame 0 (zero black screen!)
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  advanceLoading('Building Sol Coast metropolis…', 1);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  // Cap DPR at 1.5 for razor-sharp Retina visuals at a fraction of 2x Retina pixel fillrate
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 1250);

  // Build deterministic coastal Miami world + live PMREM reflections + street props
  const blueprint = createCityBlueprint();
  const sky = new SkySystem(scene, renderer);
  const cityHandles = buildCityScene(scene, blueprint);
  const streetProps = buildStreetProps(scene, blueprint);
  const beaconRenderer = createMissionBeacons(scene);
  const interiorSystem = createInteriorSystem(scene);

  // Create all drivable vehicles: 8 coastal fleet cars + 7 Club Neon VIP Parking Lot cars!
  const vipLotConfigs = blueprint.parkedLotCars.map((pc, idx) =>
    createVehicleConfigForModel(
      `vip-lot-${idx}`,
      pc.modelKind,
      pc.x,
      pc.z,
      pc.yaw,
      `VIP ${getModelDisplayName(pc.modelKind)}`,
      pc.paintHex,
    ),
  );
  const vehicles: VehicleState[] = [...DEFAULT_VEHICLES, ...vipLotConfigs].map(createVehicleState);
  const vehicleMeshes = new Map<string, VehicleMeshHandles>();
  for (const v of vehicles) {
    vehicleMeshes.set(v.id, createVehicleMesh(v, scene));
  }
  const activeHeadlights = createActiveHeadlightRig(scene);
  let commandeeredCounter = 0;

  // Player, missions & persistent world state
  const missions = new MissionManager();
  let cash = 1500;
  let timeOfDayHours = TIME_PRESETS[0].hour;
  let timePresetIdx = 0;
  const discoveredDistricts = new Set<DistrictId>(['ocean-drive']);
  const ownedKeycards = new Set<string>();
  const openDoorIds = new Set<string>();
  let player: PlayerState = createInitialPlayerState(vehicles[0]);

  const saved = loadWorld();
  let restoredSave = false;
  if (saved) {
    restoredSave = true;
    cash = saved.cash;
    timeOfDayHours = saved.timeOfDayHours;
    for (const sv of saved.vehicles) {
      const target = vehicles.find((v) => v.id === sv.id);
      if (target) {
        target.x = sv.x;
        target.z = sv.z;
        target.y = getGroundHeight(sv.x, sv.z);
        target.yaw = sv.yaw;
        target.paintIndex =
          ((Math.trunc(sv.paintIndex) % PAINT_FINISHES.length) + PAINT_FINISHES.length) %
          PAINT_FINISHES.length;
        target.odometerMeters = sv.odometerMeters;
        if (target.config.customColorHex === undefined || target.paintIndex !== target.config.defaultPaintIndex) {
          vehicleMeshes.get(target.id)?.applyPaint(target.paintIndex);
        }
      }
    }
    player.x = saved.player.x;
    player.y = saved.player.y;
    player.z = saved.player.z;
    player.yaw = saved.player.yaw;
    player.vehicleId =
      saved.player.vehicleId && vehicles.some((v) => v.id === saved.player.vehicleId)
        ? saved.player.vehicleId
        : null;
    player.walkedMeters = saved.player.walkedMeters;
    saved.completedMissions.forEach((id) => missions.completedIds.add(id));
    for (const [missionId, bestSec] of Object.entries(saved.bestTimes)) {
      missions.setBestTime(missionId, bestSec);
    }
    saved.discoveredDistricts.forEach((d) => discoveredDistricts.add(d));
    saved.hotelKeycards?.forEach((k) => ownedKeycards.add(k));
  }

  const playerMesh = createPlayerMesh(scene);

  // Ambient AI traffic cars (68 across 7 real 3D models with invisible horizon streaming),
  // 144 varied locals & joggers across 36 citywide stroll corridors, & 13 coastal boats/ships
  const trafficCars = createTrafficCars(blueprint.trafficNodes, 68);
  const trafficMeshes = createTrafficMeshes(trafficCars, scene);
  const pedestrians = createPedestrians(144);
  const pedestrianMeshes = createPedestrianMeshes(pedestrians, scene);
  const coastalBoats = createCoastalBoatFleet();
  const boatMeshes = createCoastalBoatMeshes(coastalBoats, scene, () => cityHandles.hideFallbackYachts());

  // Wait for ALL real 3D GLB models, Blender props, HDRI skies, PBR textures & Rapier3D physics behind the
  // loading screen so the player NEVER sees low-poly fallback models pop in on startup!
  const [assets, propsMap, interiorTexMap, ragdollWorld] = await Promise.all([
    loadGameAssets(renderer, (label) => advanceLoading(label)),
    loadInteriorPropAssets((label) => advanceLoading(label)),
    loadInteriorTextures((label) => advanceLoading(label)),
    RagdollPhysicsWorld.create(blueprint)
      .then((rw) => {
        advanceLoading('Initializing Rapier3D physics…');
        return rw;
      })
      .catch((err) => {
        console.warn('[SolCoast] Rapier3D physics init failed, keeping kinematic fallback.', err);
        advanceLoading('Initializing physics…');
        return null;
      }),
  ]);

  // Attach every HD 3D model, uniform, HDRI reflection & photographic PBR texture BEFORE rendering the first frame!
  sky.setHdriSet(assets.hdris);
  cityHandles.applyPhotoTextures(assets.textures);

  for (const v of vehicles) {
    const carModel = assets.cloneCarModel(v.config.modelKind);
    if (carModel) {
      vehicleMeshes.get(v.id)?.attachGltfCar(carModel, v.config.modelKind === 'ferrari');
    }
  }

  trafficMeshes.attachGltfCars((kind) => assets.cloneCarModel(kind));
  cityHandles.attachParkedLotCars((kind) => assets.cloneCarModel(kind));
  boatMeshes.attachGltfBoats((kind) => assets.cloneBoatModel(kind));

  const playerPerson = assets.cloneProtagonist();
  if (playerPerson) {
    playerMesh.attachGltfCharacter(playerPerson.scene, playerPerson.animations);
    if (ragdollWorld) {
      ragdollWorld.registerAvatarRestPose('player', playerPerson.scene);
    }
  }

  if (assets.pedestrianGltfs.length > 0) {
    pedestrianMeshes.attachGltfPeople((idx) => assets.clonePedestrian(idx));
    interiorSystem.attachGltfNpcs((idx, uniform) => assets.clonePedestrian(idx, uniform));
  }

  if (propsMap.size > 0) {
    interiorSystem.attachGltfProps(propsMap);
    cityHandles.attachGltfFountains(propsMap);
    cityHandles.attachShowcaseBuildings(propsMap);
    cityHandles.attachWorldProps(propsMap);
    streetProps.attachGltfProps(propsMap);
  }
  interiorSystem.applyPbrTextures(interiorTexMap);
  cityHandles.applyShowcaseTextures(interiorTexMap);

  const input = new InputManager(canvas);
  const cameraCtrl = new CameraController();
  cameraCtrl.yaw = player.yaw;
  const hud = new HudController();
  const minimap = new MinimapRenderer(minimapCanvas);
  const sound = new SoundEngine();
  const crashEffects = new CrashEffectsSystem(scene);

  let paused = false;
  let elapsed = 0;
  let autoSaveTimer = 0;
  let lastDistrictId: DistrictId = getDistrictAt(player.x, player.z).id;
  let activeInterior: InteriorDef | null = null;
  let interiorTransitionCooldown = 0;
  const npcTalkCounts = new Map<string, number>();

  // Footstep, jump/land & spatialized nearby-walker audio tracking
  let lastPlayerStepIdx = Math.floor(player.walkPhase / Math.PI);
  let wasPlayerGrounded = player.grounded;
  let prevPlayerVy = 0;
  const pedStepIndices = new Map<number, number>();
  const indoorNpcStepAccum = new Map<string, { x: number; z: number; dist: number }>();

  const computeOceanProximity = (wx: number, wz: number): number => {
    const eastBeach = clamp((wx - 115) / 62, 0, 1);
    const southMarina = clamp((wz - 135) / 65, 0, 1);
    const keySol = wx > 230 ? 0.85 : 0;
    return clamp(Math.max(eastBeach, southMarina, keySol), 0, 1);
  };

  const findNearestPassingTrafficAudio = (lx: number, lz: number, lYaw: number) => {
    let best: { gain: number; pan: number; speedMps: number } | null = null;
    for (let i = 0; i < trafficCars.length; i++) {
      const tc = trafficCars[i];
      if (tc.speed < 1.8) continue;
      const sample = computeSpatialPanGain(lx, lz, lYaw, tc.x, tc.z, 38);
      if (sample.gain > 0.005 && (!best || sample.gain > best.gain)) {
        best = { gain: sample.gain, pan: sample.pan, speedMps: tc.speed };
      }
    }
    return best;
  };

  const setOutdoorVisible = (visible: boolean) => {
    cityHandles.root.visible = visible;
    streetProps.root.visible = visible;
    trafficMeshes.root.visible = visible;
    pedestrianMeshes.root.visible = visible;
    boatMeshes.root.visible = visible;
    beaconRenderer.root.visible = visible;
    for (const vm of vehicleMeshes.values()) {
      vm.root.visible = visible;
    }
  };

  const getSaveSafePlayer = (): PlayerState => {
    if (!activeInterior) return player;
    return {
      ...player,
      x: activeInterior.entranceX,
      y: getGroundHeight(activeInterior.entranceX, activeInterior.entranceZ),
      z: activeInterior.entranceZ,
      yaw: activeInterior.outdoorExitYaw,
      vehicleId: null,
    };
  };

  const persistNow = (showBadge = true) => {
    const payload = serializeWorldState({
      cash,
      timeOfDayHours,
      player: getSaveSafePlayer(),
      vehicles,
      missions,
      discoveredDistricts,
      hotelKeycards: ownedKeycards,
    });
    if (saveWorld(payload) && showBadge) {
      hud.flashSaved();
    }
  };

  const getActiveVehicle = (): VehicleState | null => {
    if (!player.vehicleId) return null;
    return vehicles.find((v) => v.id === player.vehicleId) ?? null;
  };

  const unlockAudioOnce = () => {
    sound.unlock();
    window.removeEventListener('keydown', unlockAudioOnce);
    window.removeEventListener('mousedown', unlockAudioOnce);
  };
  window.addEventListener('keydown', unlockAudioOnce);
  window.addEventListener('mousedown', unlockAudioOnce);

  const setPaused = (next: boolean) => {
    paused = next;
    hud.setPauseMenu(paused, missions);
    input.clearAll();
    if (paused) {
      input.releasePointerLock();
      sound.silenceContinuous();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  hud.btnResume.addEventListener('click', () => setPaused(false));
  hud.btnSave.addEventListener('click', () => {
    persistNow(true);
    hud.showToast('World state saved!', 'success');
  });
  hud.btnExport.addEventListener('click', () => {
    const payload = serializeWorldState({
      cash,
      timeOfDayHours,
      player: getSaveSafePlayer(),
      vehicles,
      missions,
      discoveredDistricts,
      hotelKeycards: ownedKeycards,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solcoast-save.json';
    a.rel = 'noopener noreferrer';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    hud.showToast('Exported solcoast-save.json', 'info');
  });
  hud.btnAudio.addEventListener('click', () => {
    sound.unlock();
    const on = sound.toggle();
    hud.setAudioButton(on);
  });
  hud.btnReset.addEventListener('click', () => {
    clearWorldSave();
    window.location.reload();
  });

  window.addEventListener('beforeunload', () => persistNow(false));

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  if (restoredSave) {
    hud.showToast('Welcome back to Sol Coast — persistent world restored.', 'success');
  } else {
    hud.showToast('Welcome to Sol Coast! Hit [W] to cruise Ocean Drive or [E] to walk on foot.', 'info');
  }

  let lastTime = performance.now();
  let fpsFrames = 0;
  let fpsTimer = 0;
  let currentFps = 60;
  let lastDrawCalls = 0;
  const focusVec = new THREE.Vector3();

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const rawDt = (now - lastTime) / 1000;
    const dt = clamp(rawDt, 0.001, 0.05);
    lastTime = now;

    fpsFrames += 1;
    fpsTimer += rawDt;
    if (fpsTimer >= 0.5) {
      currentFps = Math.round(fpsFrames / fpsTimer);
      fpsFrames = 0;
      fpsTimer = 0;
    }

    const snap = input.poll();

    if (snap.pausePressed) {
      setPaused(!paused);
    }

    if (snap.audioTogglePressed) {
      sound.unlock();
      const on = sound.toggle();
      hud.setAudioButton(on);
      hud.showToast(`Audio ${on ? 'ON' : 'OFF'}`);
    }

    if (paused) {
      renderer.render(scene, camera);
      return;
    }

    elapsed += dt;
    timeOfDayHours = (timeOfDayHours + dt * (1 / 150)) % 24;

    if (snap.timeCyclePressed) {
      timePresetIdx = (timePresetIdx + 1) % TIME_PRESETS.length;
      timeOfDayHours = TIME_PRESETS[timePresetIdx].hour;
      hud.showToast(`Time set to ${TIME_PRESETS[timePresetIdx].label}`);
    }

    if (snap.cameraCyclePressed) {
      const mode = cameraCtrl.cycleMode();
      hud.showToast(`Camera: ${mode.toUpperCase()}`);
    }

    if (snap.quickSavePressed) {
      persistNow(true);
      hud.showToast('World saved!', 'success');
    }

    if (snap.trackMissionPressed) {
      const tracked = missions.trackNearestMission(player.x, player.z);
      if (tracked) {
        hud.showToast(`GPS set to ${tracked.title} (${tracked.district})`, 'info');
      }
    }

    if (snap.cancelMissionPressed && missions.active) {
      const cancelled = missions.cancelMission();
      if (cancelled) {
        hud.showToast(`Cancelled ${cancelled.title} — back to free roam.`, 'warn');
      }
    }

    cameraCtrl.applyLookInput(snap.mouseDX, snap.mouseDY, snap.wheelDelta);
    if (interiorTransitionCooldown > 0) {
      interiorTransitionCooldown = Math.max(0, interiorTransitionCooldown - dt);
    }

    let interactConsumed = false;

    // ─── INDOOR BUILDING INTERIOR LOOP ───────────────────────────────────────────
    if (activeInterior) {
      const def = activeInterior;
      const currentFloor = getFloorFromPlayerY(player.y, def);
      const nearExit = currentFloor === 0 && distXZ(player.x, player.z, def.exitX, def.exitZ) <= 2.4;
      const nearbyElevator = nearExit ? null : findNearbyInteriorElevator(def, currentFloor, player.x, player.z);
      const nearbyDoor =
        nearExit || nearbyElevator ? null : findNearbyInteriorDoor(def, currentFloor, player.x, player.z);
      const nearbyNpc =
        nearExit || nearbyElevator || nearbyDoor
          ? null
          : findNearbyInteriorNpc(def, player.x, player.z, 4.2, currentFloor);

      const accessibleElevators = (def.elevators ?? []).filter(
        (e) => !e.requiredKeycard || ownedKeycards.has(e.requiredKeycard),
      );

      let promptText: string | null = null;
      if (nearExit) {
        promptText = `Exit to ${def.districtLabel}`;
      } else if (nearbyElevator && def.elevators && def.elevators.length > 1) {
        const curIdx = accessibleElevators.findIndex((e) => e.floor === currentFloor);
        const nextFloor =
          accessibleElevators[(Math.max(0, curIdx) + 1) % Math.max(1, accessibleElevators.length)] ??
          def.elevators[0];
        const hasPh = ownedKeycards.has('hotel-penthouse');
        promptText = hasPh
          ? `Ride Elevator to ${nextFloor.floorLabel} (or press 1 / 2 / 3)`
          : `Ride Elevator to ${nextFloor.floorLabel} (1 / 2 · 3 Locked: VIP Keycard)`;
      } else if (nearbyDoor) {
        if (nearbyDoor.occupied) {
          promptText = `Knock on ${nearbyDoor.label}`;
        } else if (nearbyDoor.requiredKeycard && !ownedKeycards.has(nearbyDoor.requiredKeycard)) {
          promptText = `Locked — ${nearbyDoor.label} (Keycard Required at 1F Front Desk)`;
        } else {
          const verb = openDoorIds.has(nearbyDoor.id) ? 'Close' : 'Open';
          const badge = nearbyDoor.requiredKeycard ? ' (Keycard)' : '';
          promptText = `${verb} ${nearbyDoor.label}${badge}`;
        }
      } else if (nearbyNpc) {
        if (nearbyNpc.id === 'solaire-concierge') {
          if (!ownedKeycards.has('hotel-suite-201')) {
            promptText = 'Check In with Elena — Book Suite 201 ($150 · Keycard)';
          } else if (!ownedKeycards.has('hotel-penthouse')) {
            promptText = 'Upgrade with Elena — Book 3F Ocean Penthouse ($500 · VIP Keycard)';
          } else {
            promptText = `Talk to ${nearbyNpc.name} (${nearbyNpc.role})`;
          }
        } else if (nearbyNpc.id === 'solaire-clerk' && ownedKeycards.size > 0) {
          promptText = 'Express Check-Out with Claire (Return Room Keycards)';
        } else {
          promptText = nearbyNpc.actionCost
            ? `Talk / Order from ${nearbyNpc.name} (${nearbyNpc.role}) — $${nearbyNpc.actionCost}`
            : `Talk to ${nearbyNpc.name} (${nearbyNpc.role})`;
        }
      }

      const rideElevatorTo = (dest: NonNullable<InteriorDef['elevators']>[number]) => {
        if (dest.requiredKeycard && !ownedKeycards.has(dest.requiredKeycard)) {
          sound.playChime('fail');
          hud.showToast(
            dest.lockedToast ?? `${dest.floorLabel} requires a keycard — inquire at the 1F Front Desk!`,
            'warn',
          );
          return;
        }
        if (dest.floor === currentFloor) return;
        interiorTransitionCooldown = 0.35;
        player.x = dest.spawnX;
        player.y = INTERIOR_ORIGIN_Y + dest.floor * FLOOR_STRIDE_Y;
        player.z = dest.spawnZ;
        player.yaw = dest.spawnYaw;
        player.vx = 0;
        player.vy = 0;
        player.vz = 0;
        player.speed = 0;
        player.grounded = true;
        cameraCtrl.yaw = dest.spawnYaw;
        cameraCtrl.snap();
        sound.playDoorLatch('elevator');
        hud.showDistrictBanner(`${def.name} — ${dest.floorLabel}`);
        hud.showToast(`Elevator arrived at ${dest.floorLabel}`, 'success');
      };

      // Direct floor selection [1] / [2] / [3] when standing at an elevator (enforces VIP Keycard on Floor 3!)
      if (
        nearbyElevator &&
        def.elevators &&
        snap.floorDigitPressed > 0 &&
        interiorTransitionCooldown <= 0
      ) {
        const dest = def.elevators.find((e) => e.floor === snap.floorDigitPressed - 1);
        if (dest) {
          rideElevatorTo(dest);
        }
      }

      if (snap.interactPressed && interiorTransitionCooldown <= 0) {
        if (nearExit) {
          // Step back outside onto the city sidewalk — consume interact so we NEVER re-enter on the same frame!
          interactConsumed = true;
          interiorTransitionCooldown = 0.4;
          activeInterior = null;
          openDoorIds.clear();
          interiorSystem.setActiveInterior(null);
          cityHandles.setActiveInteriorBuilding(null);
          setOutdoorVisible(true);
          sky.setInteriorMode(false);
          player.x = def.entranceX;
          player.y = getGroundHeight(def.entranceX, def.entranceZ);
          player.z = def.entranceZ;
          player.yaw = def.outdoorExitYaw;
          player.vx = 0;
          player.vy = 0;
          player.vz = 0;
          player.speed = 0;
          player.grounded = true;
          cameraCtrl.yaw = def.outdoorExitYaw;
          cameraCtrl.snap();
          camera.far = 1250;
          camera.updateProjectionMatrix();
          sound.playDoorLatch('room');
          hud.showToast(`Stepped back out onto ${def.districtLabel}`, 'info');
          persistNow(false);
        } else if (nearbyElevator && accessibleElevators.length > 1) {
          interactConsumed = true;
          const curIdx = accessibleElevators.findIndex((e) => e.floor === currentFloor);
          const dest = accessibleElevators[(Math.max(0, curIdx) + 1) % accessibleElevators.length];
          rideElevatorTo(dest);
        } else if (nearbyDoor) {
          interactConsumed = true;
          if (nearbyDoor.occupied) {
            const count = npcTalkCounts.get(nearbyDoor.id) ?? 0;
            npcTalkCounts.set(nearbyDoor.id, count + 1);
            sound.playChime('fail');
            const lines = nearbyDoor.knockLines ?? [`${nearbyDoor.label} is occupied.`];
            hud.showToast(lines[count % lines.length], 'info');
          } else if (nearbyDoor.requiredKeycard && !ownedKeycards.has(nearbyDoor.requiredKeycard)) {
            sound.playChime('fail');
            hud.showToast(
              nearbyDoor.lockedToast ?? `${nearbyDoor.label} is locked — keycard required!`,
              'warn',
            );
          } else {
            const wasOpen = openDoorIds.has(nearbyDoor.id);
            if (wasOpen) {
              openDoorIds.delete(nearbyDoor.id);
              sound.playDoorLatch('room');
            } else {
              openDoorIds.add(nearbyDoor.id);
              sound.playDoorLatch('room');
              if (nearbyDoor.requiredKeycard) {
                hud.showToast(`Keycard accepted — unlocked ${nearbyDoor.label}`, 'success');
              }
            }
          }
        } else if (nearbyNpc) {
          interactConsumed = true;
          const count = npcTalkCounts.get(nearbyNpc.id) ?? 0;
          npcTalkCounts.set(nearbyNpc.id, count + 1);

          if (nearbyNpc.id === 'solaire-concierge' && !ownedKeycards.has('hotel-suite-201')) {
            if (cash >= 150) {
              cash -= 150;
              ownedKeycards.add('hotel-suite-201');
              sound.playChime('paint');
              hud.showToast(
                'Checked In (-$150)! Elena issued your Suite 201 Keycard (Floor 2). Visit again to upgrade to the 3F Penthouse ($500)!',
                'success',
              );
              persistNow(false);
            } else {
              sound.playChime('fail');
              hud.showToast('Elena: "Suite 201 is $150 per stay — looks like you need a bit more cash!"', 'warn');
            }
          } else if (nearbyNpc.id === 'solaire-concierge' && !ownedKeycards.has('hotel-penthouse')) {
            if (cash >= 500) {
              cash -= 500;
              ownedKeycards.add('hotel-penthouse');
              sound.playChime('complete');
              hud.showToast(
                'VIP Upgrade (-$500)! Elena issued your 3F Ocean Penthouse Keycard — Floor 3 unlocked in the brass elevator!',
                'success',
              );
              persistNow(false);
            } else {
              sound.playChime('fail');
              hud.showToast('Elena: "The 3rd-Floor Ocean Penthouse is $500 — come back when you are ready!"', 'warn');
            }
          } else if (nearbyNpc.id === 'solaire-clerk' && ownedKeycards.size > 0) {
            ownedKeycards.clear();
            openDoorIds.clear();
            sound.playChime('checkpoint');
            hud.showToast(
              'Claire: "Express Check-Out complete! Your Hotel Solaire keycards have been returned. Safe travels!"',
              'info',
            );
            persistNow(false);
          } else if (nearbyNpc.actionCost && nearbyNpc.actionToast) {
            if (cash >= nearbyNpc.actionCost) {
              cash -= nearbyNpc.actionCost;
              sound.playChime('paint');
              hud.showToast(nearbyNpc.actionToast, 'success');
              persistNow(false);
            } else {
              sound.playChime('fail');
              hud.showToast(`${nearbyNpc.name}: "Looks like you're short on cash ($${nearbyNpc.actionCost})."`, 'warn');
            }
          } else {
            const line = nearbyNpc.lines[count % nearbyNpc.lines.length];
            sound.playChime('checkpoint');
            hud.showToast(line, 'info');
          }
        }
      }

      if (activeInterior) {
        stepPlayerInInterior(
          player,
          activeInterior,
          {
            forward: snap.forward,
            right: snap.right,
            sprint: snap.sprint,
            jump: snap.handbrakeOrJump,
            cameraYaw: cameraCtrl.yaw,
          },
          dt,
          openDoorIds,
        );

        const updatedFloor = getFloorFromPlayerY(player.y, activeInterior);
        const pWorld = interiorLocalToWorld(activeInterior, player.x, player.y, player.z, updatedFloor);

        // Keep the live outdoor world (sky, sun, ocean waves, traffic cars, pedestrians & cruising boats)
        // stepping and visible right outside every hotel suite, penthouse, café & gallery window!
        stepTraffic(
          trafficCars,
          blueprint.trafficNodes,
          vehicles,
          dt,
          blueprint.colliders,
          blueprint.propObbs,
          pWorld.x,
          pWorld.z,
          pedestrians,
        );
        stepPedestrians(pedestrians, vehicles, dt, trafficCars, blueprint.colliders, pWorld.x, pWorld.z);
        focusVec.set(pWorld.x, pWorld.y, pWorld.z);
        const skyRes = sky.update(timeOfDayHours, elapsed, focusVec);
        cityHandles.updateAnimation(
          elapsed,
          skyRes.nightFactor,
          skyRes.sunDirection,
          skyRes.sunColor,
          skyRes.fogColor,
          pWorld.x,
          pWorld.z,
        );
        streetProps.update(elapsed, skyRes.nightFactor, pWorld.x, pWorld.z);
        for (const v of vehicles) {
          vehicleMeshes.get(v.id)?.syncFromState(v, skyRes.nightFactor, dt, false);
        }
        activeHeadlights.sync(null, skyRes.nightFactor);
        trafficMeshes.syncFromState(trafficCars, skyRes.nightFactor, pWorld.x, pWorld.z);
        pedestrianMeshes.syncFromState(pedestrians, dt, pWorld.x, pWorld.z, ragdollWorld);
        boatMeshes.update(elapsed, dt, skyRes.nightFactor);

        interiorSystem.update(
          elapsed,
          dt,
          activeInterior.id,
          player.x,
          player.z,
          player.y,
          openDoorIds,
          ownedKeycards,
        );
        playerMesh.syncFromState(player, elapsed, dt, null, null, false);
        playerMesh.root.position.set(pWorld.x, pWorld.y, pWorld.z);
        playerMesh.root.rotation.y = pWorld.rotY - player.yaw;
        cameraCtrl.update(camera, dt, player, null, activeInterior);
        sound.updateDriving(false, 0, 0, 0, false);

        const outdoorDistrict = getDistrictAt(activeInterior.entranceX, activeInterior.entranceZ);
        const currentRoom = getInteriorRoomAt(activeInterior, player.x, player.z, updatedFloor);
        const indoorSurface = detectInteriorFootstepSurface(currentRoom.floorPbr);

        // Player footsteps & jump/land inside buildings (surface-aware: marble tile, plush carpet, timber!)
        const curStepIdx = Math.floor(player.walkPhase / Math.PI);
        if (player.grounded && player.speed > 0.35 && curStepIdx !== lastPlayerStepIdx) {
          sound.playFootstep(indoorSurface, 0.92, 0, player.sprinting, false);
        }
        lastPlayerStepIdx = curStepIdx;
        if (wasPlayerGrounded && !player.grounded && player.vy > 2.0) {
          sound.playJump(indoorSurface);
        } else if (!wasPlayerGrounded && player.grounded) {
          sound.playLand(indoorSurface, clamp(-prevPlayerVy / 10, 0.3, 1.0));
        }
        wasPlayerGrounded = player.grounded;
        prevPlayerVy = player.vy;

        // Spatialized stereo-panned footsteps for patrolling hotel staff / indoor NPCs on your floor!
        for (const npc of activeInterior.npcs) {
          if ((npc.floor ?? 0) !== updatedFloor || !npc.patrol || npc.patrol.length < 2) continue;
          const prev = indoorNpcStepAccum.get(npc.id);
          if (!prev) {
            indoorNpcStepAccum.set(npc.id, { x: npc.x, z: npc.z, dist: 0 });
            continue;
          }
          const moved = Math.hypot(npc.x - prev.x, npc.z - prev.z);
          prev.x = npc.x;
          prev.z = npc.z;
          prev.dist += moved;
          if (prev.dist >= 0.72) {
            prev.dist -= 0.72;
            const sp = computeSpatialPanGain(player.x, player.z, cameraCtrl.yaw, npc.x, npc.z, 14);
            if (sp.gain > 0.03) {
              sound.playFootstep(indoorSurface, sp.gain * 0.58, sp.pan, false, true);
            }
          }
        }

        sound.updateWorldAmbience({
          elapsed,
          inCar: false,
          inInteriorId: activeInterior.id,
          oceanProximity: 0,
          clubProximity: activeInterior.id === 'club-neon' ? 1.0 : 0,
          nearestTraffic: findNearestPassingTrafficAudio(pWorld.x, pWorld.z, cameraCtrl.yaw),
        });

        autoSaveTimer += dt;
        if (autoSaveTimer >= 15) {
          autoSaveTimer = 0;
          persistNow(true);
        }
        const keyBadges: string[] = [];
        if (ownedKeycards.has('hotel-suite-201')) keyBadges.push('201');
        if (ownedKeycards.has('hotel-penthouse')) keyBadges.push('3F PH');
        const hotelKeyTag =
          activeInterior.id === 'hotel-solaire'
            ? keyBadges.length > 0
              ? `${activeInterior.districtLabel} · KEYCARDS: ${keyBadges.join(' · ')}`
              : `${activeInterior.districtLabel} · CHECK IN AT 1F FRONT DESK`
            : activeInterior.districtLabel;
        hud.update({
          timeLabel: formatTimeLabel(timeOfDayHours),
          district: {
            ...outdoorDistrict,
            name: `${activeInterior.name} — ${currentRoom.name}`,
            tagline: hotelKeyTag,
          },
          cash,
          discoveredCount: discoveredDistricts.size,
          player,
          activeVehicle: null,
          vehicles,
          missions,
          promptText,
          fps: currentFps,
          drawCalls: lastDrawCalls,
        });
        minimap.render(
          blueprint,
          player,
          vehicles,
          trafficCars,
          missions,
          activeInterior,
          openDoorIds,
          ownedKeycards,
        );

        renderer.render(scene, camera);
        lastDrawCalls = renderer.info.render.calls;
        return;
      }
    }

    let activeVehicle = getActiveVehicle();

    if (activeVehicle) {
      if (snap.paintCyclePressed) {
        activeVehicle.paintIndex = (activeVehicle.paintIndex + 1) % PAINT_FINISHES.length;
        vehicleMeshes.get(activeVehicle.id)?.applyPaint(activeVehicle.paintIndex);
        sound.playChime('paint');
        hud.showToast(`Painted ${activeVehicle.name}: ${PAINT_FINISHES[activeVehicle.paintIndex].name}`, 'info');
        persistNow(false);
      }
      if (snap.headlightsPressed) {
        activeVehicle.headlightsOn = !activeVehicle.headlightsOn;
        hud.showToast(`Headlights ${activeVehicle.headlightsOn ? 'ON' : 'OFF'}`);
      }
    }

    const nearbyMission = missions.findNearbyStartBeacon(player.x, player.z);
    const nearbyEntrance =
      !activeVehicle && !player.rapierControlled ? findNearbyBuildingEntrance(player.x, player.z) : null;
    const nearbyCar = activeVehicle ? null : findNearestVehicle(player.x, player.z, vehicles);
    const nearbyTraffic = activeVehicle ? null : findNearestTrafficCar(player.x, player.z, trafficCars, 5.8);
    const preferTraffic =
      nearbyTraffic !== null && (nearbyCar === null || nearbyTraffic.dist < nearbyCar.dist);

    let promptText: string | null = null;
    if (nearbyMission) {
      const doneTag = missions.completedIds.has(nearbyMission.id) ? ' (Replay)' : '';
      promptText = `Start Mission: ${nearbyMission.title}${doneTag} — $${nearbyMission.rewardCash.toLocaleString()}`;
    } else if (nearbyEntrance) {
      promptText = `Enter ${nearbyEntrance.name}`;
    } else if (!activeVehicle && preferTraffic && nearbyTraffic) {
      promptText = `Take ${getModelDisplayName(nearbyTraffic.car.modelKind)}`;
    } else if (!activeVehicle && nearbyCar) {
      promptText = `Enter ${nearbyCar.vehicle.name}`;
    } else if (activeVehicle && Math.abs(activeVehicle.speed) < 3.5) {
      promptText = `Exit ${activeVehicle.name} (On Foot)`;
    }

    if (snap.interactPressed && !interactConsumed) {
      if (nearbyMission) {
        const started = missions.startMission(nearbyMission.id);
        if (started) {
          sound.playChime('checkpoint');
          hud.showToast(`Mission Started: ${started.title} — ${started.description}`, 'success');
        }
      } else if (nearbyEntrance && interiorTransitionCooldown <= 0) {
        // Step inside the building interior (keep the live outdoor 3D world visible outside the windows!)
        interiorTransitionCooldown = 0.4;
        activeInterior = nearbyEntrance;
        setOutdoorVisible(true);
        sky.setInteriorMode(false);
        cityHandles.setActiveInteriorBuilding(nearbyEntrance.id);
        interiorSystem.setActiveInterior(nearbyEntrance.id);
        player.vehicleId = null;
        player.x = nearbyEntrance.spawnX;
        player.y = INTERIOR_ORIGIN_Y;
        player.z = nearbyEntrance.spawnZ;
        player.yaw = nearbyEntrance.spawnYaw;
        player.vx = 0;
        player.vy = 0;
        player.vz = 0;
        player.speed = 0;
        player.grounded = true;
        player.ragdollMode = 'normal';
        player.ragdollTimer = 0;
        player.fallPitch = 0;
        player.fallRoll = 0;
        cameraCtrl.yaw = nearbyEntrance.spawnYaw;
        cameraCtrl.snap();
        camera.far = 1250;
        camera.updateProjectionMatrix();
        sound.playDoorLatch('room');
        hud.showDistrictBanner(nearbyEntrance.name);
        const elevHint =
          nearbyEntrance.elevators && nearbyEntrance.elevators.length > 1
            ? ` — ${nearbyEntrance.elevators.length} floors connected by brass elevator!`
            : ` — explore all ${nearbyEntrance.rooms.length} rooms & talk to locals with [E]!`;
        hud.showToast(`Entered ${nearbyEntrance.name}${elevHint}`, 'success');

        // Render the newly entered interior immediately and return so outdoor stepPlayerOnFoot
        // NEVER runs on this frame and pulls player.y upward from INTERIOR_ORIGIN_Y!
        interiorSystem.update(
          elapsed,
          dt,
          nearbyEntrance.id,
          player.x,
          player.z,
          player.y,
          openDoorIds,
          ownedKeycards,
        );
        const pWorldEnter = interiorLocalToWorld(nearbyEntrance, player.x, player.y, player.z, 0);
        playerMesh.syncFromState(player, elapsed, dt, null, null, false);
        playerMesh.root.position.set(pWorldEnter.x, pWorldEnter.y, pWorldEnter.z);
        playerMesh.root.rotation.y = pWorldEnter.rotY - player.yaw;
        cameraCtrl.update(camera, dt, player, null, nearbyEntrance);
        minimap.render(
          blueprint,
          player,
          vehicles,
          trafficCars,
          missions,
          nearbyEntrance,
          openDoorIds,
          ownedKeycards,
        );
        renderer.render(scene, camera);
        lastDrawCalls = renderer.info.render.calls;
        return;
      } else if (activeVehicle) {
        if (Math.abs(activeVehicle.speed) < 10) {
          const exitPos = computeSafeExitPosition(activeVehicle, blueprint.colliders);
          player.vehicleId = null;
          player.x = exitPos.x;
          player.y = exitPos.y;
          player.z = exitPos.z;
          player.yaw = activeVehicle.yaw;
          player.vx = 0;
          player.vy = 0;
          player.vz = 0;
          player.speed = 0;
          player.ragdollMode = 'normal';
          player.ragdollTimer = 0;
          player.fallPitch = 0;
          player.fallRoll = 0;
          activeVehicle.vx *= 0.2;
          activeVehicle.vz *= 0.2;
          activeVehicle = null;
          sound.playDoorLatch('car');
          persistNow(false);
        } else {
          hud.showToast('Slow down to exit the vehicle!', 'warn');
        }
      } else if (preferTraffic && nearbyTraffic && !player.rapierControlled) {
        // Commandeer any roaming AI traffic car seamlessly into a full drivable VehicleState!
        const tc = nearbyTraffic.car;
        const newId = `street-car-${++commandeeredCounter}`;
        const cfg = createVehicleConfigForModel(
          newId,
          tc.modelKind,
          tc.x,
          tc.z,
          tc.yaw,
          undefined,
          tc.color,
        );
        const promoted = createVehicleState(cfg);
        promoted.y = tc.y;
        promoted.vx = tc.vx * 0.35;
        promoted.vz = tc.vz * 0.35;
        promoted.speed = tc.speed * 0.35;
        promoted.pitchTilt = tc.pitchTilt;
        promoted.rollTilt = tc.rollTilt;

        const meshHandle = createVehicleMesh(promoted, scene);
        const carModel = assets.cloneCarModel(tc.modelKind);
        if (carModel) {
          meshHandle.attachGltfCar(carModel, tc.modelKind === 'ferrari');
        }
        vehicles.push(promoted);
        vehicleMeshes.set(promoted.id, meshHandle);

        // Relocate the AI traffic slot to a distant road so street traffic stays lively
        relocateTrafficCarAway(tc, blueprint.trafficNodes, player.x, player.z);

        // Keep at most 12 dynamically commandeered street cars alive so memory/draws stay bounded
        const baseFleetCount = DEFAULT_VEHICLES.length + vipLotConfigs.length;
        if (vehicles.length > baseFleetCount + 12) {
          const evictIdx = vehicles.findIndex(
            (v, idx) => idx >= baseFleetCount && v.id !== promoted.id && distXZ(v.x, v.z, player.x, player.z) > 60,
          );
          if (evictIdx >= 0) {
            const [oldV] = vehicles.splice(evictIdx, 1);
            vehicleMeshes.get(oldV.id)?.dispose();
            vehicleMeshes.delete(oldV.id);
          }
        }

        player.vehicleId = promoted.id;
        player.x = promoted.x;
        player.y = promoted.y;
        player.z = promoted.z;
        player.yaw = promoted.yaw;
        activeVehicle = promoted;
        sound.playDoorLatch('car');
        hud.showToast(`Took ${promoted.name}!`, 'info');
        persistNow(false);
      } else if (nearbyCar && !player.rapierControlled) {
        player.vehicleId = nearbyCar.vehicle.id;
        player.x = nearbyCar.vehicle.x;
        player.y = nearbyCar.vehicle.y;
        player.z = nearbyCar.vehicle.z;
        player.yaw = nearbyCar.vehicle.yaw;
        activeVehicle = nearbyCar.vehicle;
        sound.playDoorLatch('car');
        persistNow(false);
      }
    }

    // 1. Step all player vehicles (active driven car + any rammed/coasting/spinning parked cars!)
    for (const v of vehicles) {
      if (activeVehicle && v.id === activeVehicle.id) {
        stepVehiclePhysics(
          v,
          {
            throttle: snap.forward,
            steer: snap.right,
            handbrake: snap.handbrakeOrJump,
          },
          dt,
          blueprint.colliders,
          blueprint.propObbs,
        );
      } else if (
        Math.abs(v.vx) > 0.05 ||
        Math.abs(v.vz) > 0.05 ||
        Math.abs(v.yawRate) > 0.04 ||
        !v.grounded ||
        Math.abs(v.suspOffset) > 0.004 ||
        Math.abs(v.pitchTilt) > 0.004
      ) {
        // Unoccupied rammed car skids & coasts naturally to a stop instead of freezing rigidly
        stepVehiclePhysics(
          v,
          { throttle: 0, steer: 0, handbrake: false },
          dt,
          blueprint.colliders,
          blueprint.propObbs,
        );
      } else {
        v.lastCollisionImpact = 0;
      }
    }

    // 2. Resolve exact SAT rigid-body collisions between ALL fleet vehicles & ALL AI traffic cars FIRST!
    resolveVehiclePairCollisions(vehicles);
    stepTraffic(
      trafficCars,
      blueprint.trafficNodes,
      vehicles,
      dt,
      blueprint.colliders,
      blueprint.propObbs,
      player.x,
      player.z,
      pedestrians,
    );

    // 3. Now step player (using up-to-date car positions so traffic can NEVER move onto/through the player!)
    if (activeVehicle) {
      player.x = activeVehicle.x;
      player.y = activeVehicle.y;
      player.z = activeVehicle.z;
      player.yaw = activeVehicle.yaw;
      player.speed = Math.abs(activeVehicle.speed);
    } else {
      stepPlayerOnFoot(
        player,
        {
          forward: snap.forward,
          right: snap.right,
          sprint: snap.sprint,
          jump: snap.handbrakeOrJump,
          cameraYaw: cameraCtrl.yaw,
        },
        dt,
        blueprint.colliders,
        vehicles,
        trafficCars,
        pedestrians,
        blueprint.propObbs,
      );
    }

    stepPedestrians(pedestrians, vehicles, dt, trafficCars, blueprint.colliders, player.x, player.z);

    // Step real Rapier3D WASM 11-limb articulated ragdolls & 3-stage physical get-ups!
    if (ragdollWorld) {
      ragdollWorld.syncVehicles(vehicles, trafficCars, player.x, player.z);

      // Spawn player Rapier3D ragdoll if knocked by oncoming traffic while on foot
      if (player.vehicleId === null && player.pendingRagdollImpact) {
        const pImpact = player.pendingRagdollImpact;
        player.pendingRagdollImpact = null;
        const pAvatar = playerMesh.getAvatarRoot();
        if (pAvatar) {
          playerMesh.root.visible = true;
          playerMesh.root.position.set(player.x, player.y, player.z);
          playerMesh.root.rotation.set(0, -player.yaw, 0);
          playerMesh.root.updateMatrixWorld(true);
          if (ragdollWorld.spawnRagdoll('player', playerMesh.root, pAvatar, pImpact, true)) {
            player.rapierControlled = true;
            player.fallPitch = 0;
            player.fallRoll = 0;
          }
        }
      }

      pedestrianMeshes.spawnPendingRagdolls(pedestrians, ragdollWorld, player.x, player.z);
      ragdollWorld.step(dt);

      if (player.rapierControlled) {
        const pStatus = ragdollWorld.getStatus('player');
        if (pStatus) {
          player.x = pStatus.x;
          player.y = pStatus.y;
          player.z = pStatus.z;
          player.yaw = pStatus.yaw;
          player.ragdollMode = pStatus.phase === 'ragdoll' ? 'airborne' : 'recovering';
          player.grounded = pStatus.phase !== 'ragdoll';
        } else {
          player.rapierControlled = false;
          player.ragdollMode = 'normal';
          player.fallPitch = 0;
          player.fallRoll = 0;
          player.vx = 0;
          player.vz = 0;
          player.grounded = true;
        }
      }
    }

    // Trigger realistic crash audio, metallic impact sparks, and camera shake!
    for (const v of vehicles) {
      if (v.lastCollisionImpact > 3.8) {
        crashEffects.spawnSparks(
          v.lastImpactX,
          v.y,
          v.lastImpactZ,
          v.lastImpactNx,
          v.lastImpactNz,
          v.lastCollisionImpact,
        );
      }
    }
    for (const tc of trafficCars) {
      if (tc.lastImpactSpeed > 4.2) {
        crashEffects.spawnSparks(
          tc.lastImpactX,
          tc.y,
          tc.lastImpactZ,
          tc.lastImpactNx,
          tc.lastImpactNz,
          tc.lastImpactSpeed,
        );
      }
    }
    crashEffects.update(dt);

    if (activeVehicle && activeVehicle.lastCollisionImpact > 2.2) {
      const norm = clamp(activeVehicle.lastCollisionImpact / 18, 0.22, 1.0);
      sound.playImpact('car', norm);
      cameraCtrl.addImpactShake(clamp(activeVehicle.lastCollisionImpact * 0.022, 0.06, 0.48));
    } else if (player.lastImpactKind !== 'none' && player.lastImpactSpeed > 1.5) {
      sound.playImpact(player.lastImpactKind, clamp(player.lastImpactSpeed / 14, 0.2, 1.0));
      if (player.lastImpactKind === 'body') {
        cameraCtrl.addImpactShake(0.28);
      }
    } else {
      for (const ped of pedestrians) {
        if (ped.lastImpactKind !== 'none' && ped.lastImpactSpeed > 2.0) {
          const dSq = (ped.x - player.x) * (ped.x - player.x) + (ped.z - player.z) * (ped.z - player.z);
          if (dSq < 35 * 35) {
            sound.playImpact(ped.lastImpactKind, clamp(ped.lastImpactSpeed / 16, 0.2, 1.0));
            break;
          }
        }
      }
    }

    const missionEvent = missions.update(dt, player.x, player.z, player.vehicleId);
    if (missionEvent) {
      if (missionEvent.type === 'complete') {
        cash += missionEvent.rewardCash ?? 0;
        sound.playChime('complete');
        hud.showToast(missionEvent.message, 'success');
        persistNow(true);
      } else if (missionEvent.type === 'step') {
        sound.playChime('checkpoint');
        hud.showToast(missionEvent.message, 'info');
      } else if (missionEvent.type === 'fail') {
        sound.playChime('fail');
        hud.showToast(missionEvent.message, 'warn');
      }
    }

    const district = getDistrictAt(player.x, player.z);
    if (district.id !== lastDistrictId) {
      lastDistrictId = district.id;
      if (!discoveredDistricts.has(district.id)) {
        discoveredDistricts.add(district.id);
        cash += 250;
        sound.playChime('checkpoint');
        hud.showDistrictBanner(`DISCOVERED: ${district.name} (+$250)`);
        persistNow(false);
      } else {
        hud.showDistrictBanner(district.name);
      }
    }

    focusVec.set(player.x, player.y, player.z);
    const skyRes = sky.update(timeOfDayHours, elapsed, focusVec);
    cityHandles.updateAnimation(
      elapsed,
      skyRes.nightFactor,
      skyRes.sunDirection,
      skyRes.sunColor,
      skyRes.fogColor,
      player.x,
      player.z,
    );
    streetProps.update(elapsed, skyRes.nightFactor, player.x, player.z);

    for (const v of vehicles) {
      const occupied = activeVehicle !== null && activeVehicle.id === v.id;
      vehicleMeshes.get(v.id)?.syncFromState(v, skyRes.nightFactor, dt, occupied);
    }
    activeHeadlights.sync(activeVehicle, skyRes.nightFactor);
    const activeBodyGroup = activeVehicle ? (vehicleMeshes.get(activeVehicle.id)?.bodyGroup ?? null) : null;
    playerMesh.syncFromState(
      player,
      elapsed,
      dt,
      activeVehicle,
      activeBodyGroup,
      cameraCtrl.mode === 'hood',
    );
    trafficMeshes.syncFromState(trafficCars, skyRes.nightFactor, player.x, player.z);
    pedestrianMeshes.syncFromState(pedestrians, dt, player.x, player.z, ragdollWorld);
    boatMeshes.update(elapsed, dt, skyRes.nightFactor);
    beaconRenderer.update(elapsed, missions);
    interiorSystem.update(elapsed, dt, null, player.x, player.z);

    cameraCtrl.update(camera, dt, player, activeVehicle);

    if (activeVehicle) {
      const driftAmt = activeVehicle.drifting ? clamp(Math.abs(activeVehicle.lateralSpeed) / 10, 0.25, 1) : 0;
      if (activeVehicle.lastShiftKind !== 'none') {
        sound.playGearShift(activeVehicle.config.engineSound, activeVehicle.lastShiftKind);
      }
      sound.updateDriving(
        true,
        activeVehicle.rpm,
        snap.forward,
        driftAmt,
        snap.horn,
        activeVehicle.config.engineSound,
        activeVehicle.shiftTimer > 0,
        clamp(Math.abs(activeVehicle.speed) / activeVehicle.config.maxSpeed, 0, 1),
      );
      lastPlayerStepIdx = Math.floor(player.walkPhase / Math.PI);
      wasPlayerGrounded = true;
      prevPlayerVy = 0;
    } else {
      sound.updateDriving(false, 0, 0, 0, false);

      // Player outdoor footsteps & jump/land thuds (surface-aware: concrete, boardwalk wood, beach sand!)
      const surface = detectOutdoorFootstepSurface(player.x, player.z);
      const curStepIdx = Math.floor(player.walkPhase / Math.PI);
      if (player.grounded && !player.rapierControlled && player.speed > 0.35 && curStepIdx !== lastPlayerStepIdx) {
        sound.playFootstep(surface, 1.0, 0, player.sprinting, false);
      }
      lastPlayerStepIdx = curStepIdx;
      if (!player.rapierControlled) {
        if (wasPlayerGrounded && !player.grounded && player.vy > 2.0) {
          sound.playJump(surface);
        } else if (!wasPlayerGrounded && player.grounded) {
          sound.playLand(surface, clamp(-prevPlayerVy / 10, 0.3, 1.0));
        }
      }
      wasPlayerGrounded = player.grounded;
      prevPlayerVy = player.vy;

      // Spatialized stereo-panned footsteps for nearby strolling pedestrians (louder as they pass, fading away!)
      for (let i = 0; i < pedestrians.length; i++) {
        const ped = pedestrians[i];
        const pStep = Math.floor(ped.walkPhase / Math.PI);
        const prevStep = pedStepIndices.get(ped.id);
        pedStepIndices.set(ped.id, pStep);
        if (prevStep === undefined || prevStep === pStep || ped.ragdollMode !== 'normal' || ped.speed < 0.3) {
          continue;
        }
        const sp = computeSpatialPanGain(player.x, player.z, cameraCtrl.yaw, ped.x, ped.z, 15);
        if (sp.gain > 0.025) {
          const pedSurface = detectOutdoorFootstepSurface(ped.x, ped.z);
          sound.playFootstep(pedSurface, sp.gain * 0.56, sp.pan, false, true);
        }
      }
    }

    // Subtle continuous spatial ambience: passing AI traffic hum, coastal ocean surf & Club Neon entrance bass
    const clubDist = distXZ(player.x, player.z, -3.8, -62.0);
    const clubProx = clubDist < 26 ? clamp((26 - clubDist) / 22, 0, 1) * 0.32 : 0;
    sound.updateWorldAmbience({
      elapsed,
      inCar: activeVehicle !== null,
      inInteriorId: null,
      oceanProximity: computeOceanProximity(player.x, player.z),
      clubProximity: clubProx,
      nearestTraffic: findNearestPassingTrafficAudio(player.x, player.z, cameraCtrl.yaw),
    });

    autoSaveTimer += dt;
    if (autoSaveTimer >= 15) {
      autoSaveTimer = 0;
      persistNow(true);
    }

    hud.update({
      timeLabel: skyRes.timeLabel,
      district,
      cash,
      discoveredCount: discoveredDistricts.size,
      player,
      activeVehicle,
      vehicles,
      missions,
      promptText,
      fps: currentFps,
      drawCalls: lastDrawCalls,
    });
    minimap.render(blueprint, player, vehicles, trafficCars, missions);

    renderer.render(scene, camera);
    lastDrawCalls = renderer.info.render.calls;
  };

  // Render the initial fully-loaded HD frame behind the loading screen so GPU shaders compile & textures upload
  // before the curtain lifts (zero black screen, zero procedural fallback pop-in!)
  advanceLoading('Compiling shaders & preparing first frame…', 0);
  const initVehicle = getActiveVehicle();
  focusVec.set(player.x, player.y, player.z);
  const initSky = sky.update(timeOfDayHours, 0, focusVec);
  cityHandles.updateAnimation(
    0,
    initSky.nightFactor,
    initSky.sunDirection,
    initSky.sunColor,
    initSky.fogColor,
    player.x,
    player.z,
  );
  streetProps.update(0, initSky.nightFactor, player.x, player.z);
  for (const v of vehicles) {
    vehicleMeshes.get(v.id)?.syncFromState(v, initSky.nightFactor, 0.016, initVehicle !== null && initVehicle.id === v.id);
  }
  activeHeadlights.sync(initVehicle, initSky.nightFactor);
  const initBodyGroup = initVehicle ? (vehicleMeshes.get(initVehicle.id)?.bodyGroup ?? null) : null;
  playerMesh.syncFromState(player, 0, 0.016, initVehicle, initBodyGroup, false);
  trafficMeshes.syncFromState(trafficCars, initSky.nightFactor, player.x, player.z);
  pedestrianMeshes.syncFromState(pedestrians, 0.016, player.x, player.z, ragdollWorld);
  boatMeshes.update(0, 0.016, initSky.nightFactor);
  beaconRenderer.update(0, missions);
  interiorSystem.update(0, 0.016, null, player.x, player.z);
  cameraCtrl.snap();
  cameraCtrl.update(camera, 0.016, player, initVehicle);
  minimap.render(blueprint, player, vehicles, trafficCars, missions);
  renderer.render(scene, camera);
  lastDrawCalls = renderer.info.render.calls;

  advanceLoading('Welcome to Sol Coast!', totalSteps - completedSteps);
  if (hudEl) hudEl.classList.remove('hud-loading');
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    window.setTimeout(() => loadingScreen.classList.add('hidden'), 520);
  }

  lastTime = performance.now();
  requestAnimationFrame(tick);
}

void bootstrap();
