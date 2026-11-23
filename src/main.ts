import * as THREE from 'three';

import { SoundEngine } from './core/audio';
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
import { createTrafficCars, createTrafficMeshes, stepTraffic } from './entities/traffic';
import {
  DEFAULT_VEHICLES,
  PAINT_FINISHES,
  createVehicleMesh,
  createVehicleState,
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
import { loadGameAssets, loadInteriorPropAssets } from './world/assets';
import { buildCityScene } from './world/cityBuilder';
import {
  createCityBlueprint,
  getDistrictAt,
  getGroundHeight,
} from './world/cityData';
import {
  INTERIOR_ORIGIN_Y,
  createInteriorSystem,
  findNearbyBuildingEntrance,
  findNearbyInteriorNpc,
  getInteriorRoomAt,
  stepPlayerInInterior,
  type InteriorDef,
} from './world/interiors';
import { SkySystem, TIME_PRESETS, formatTimeLabel } from './world/sky';
import { buildStreetProps } from './world/streetProps';
import type { DistrictId } from './world/types';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

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
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 2200);

  // Build deterministic coastal Miami world + live PMREM reflections + street props
  const blueprint = createCityBlueprint();
  const sky = new SkySystem(scene, renderer);
  const cityHandles = buildCityScene(scene, blueprint);
  const streetProps = buildStreetProps(scene, blueprint);
  const beaconRenderer = createMissionBeacons(scene);
  const interiorSystem = createInteriorSystem(scene);

  // Create sculpted multi-station lofted modern vehicles
  const vehicles: VehicleState[] = DEFAULT_VEHICLES.map(createVehicleState);
  const vehicleMeshes = new Map<string, VehicleMeshHandles>();
  for (const v of vehicles) {
    vehicleMeshes.set(v.id, createVehicleMesh(v, scene));
  }

  // Player, missions & persistent world state
  const missions = new MissionManager();
  let cash = 1500;
  let timeOfDayHours = TIME_PRESETS[0].hour;
  let timePresetIdx = 0;
  const discoveredDistricts = new Set<DistrictId>(['ocean-drive']);
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
        target.paintIndex = sv.paintIndex;
        target.odometerMeters = sv.odometerMeters;
        vehicleMeshes.get(target.id)?.applyPaint(target.paintIndex);
      }
    }
    player.x = saved.player.x;
    player.y = saved.player.y;
    player.z = saved.player.z;
    player.yaw = saved.player.yaw;
    player.vehicleId = saved.player.vehicleId;
    player.walkedMeters = saved.player.walkedMeters;
    saved.completedMissions.forEach((id) => missions.completedIds.add(id));
    Object.assign(missions.bestTimes, saved.bestTimes);
    saved.discoveredDistricts.forEach((d) => discoveredDistricts.add(d));
  }

  const playerMesh = createPlayerMesh(scene);

  // Ambient AI traffic cars (26 across 7 real 3D models), 72 evenly-spread varied pedestrians, & 13 coastal boats/ships
  const trafficCars = createTrafficCars(blueprint.trafficNodes, 26);
  const trafficMeshes = createTrafficMeshes(trafficCars, scene);
  const pedestrians = createPedestrians(72);
  const pedestrianMeshes = createPedestrianMeshes(pedestrians, scene);
  const coastalBoats = createCoastalBoatFleet();
  const boatMeshes = createCoastalBoatMeshes(coastalBoats, scene, () => cityHandles.hideFallbackYachts());

  // Initialize real WASM 3D rigid-body physics engine (Rapier3D) for 11-limb articulated ragdolls & sloped car hoods!
  let ragdollWorld: RagdollPhysicsWorld | null = null;
  void RagdollPhysicsWorld.create(blueprint)
    .then((rw) => {
      ragdollWorld = rw;
      const pAvatar = playerMesh.getAvatarRoot();
      if (pAvatar) rw.registerAvatarRestPose('player', pAvatar);
    })
    .catch((err) => {
      console.warn('[SolCoast] Rapier3D physics init failed, keeping kinematic fallback.', err);
    });

  // Stream all local 3D GLB cars, boats, street-tough protagonist, 52 styled citizens,
  // studio optical mocap clips, Poly Haven Pure Sky HDRIs & photographic PBR textures asynchronously!
  void loadGameAssets(renderer).then((assets) => {
    sky.setHdriSet(assets.hdris);
    cityHandles.applyPhotoTextures(assets.textures);

    for (const v of vehicles) {
      const carModel = assets.cloneCarModel(v.config.modelKind);
      if (carModel) {
        vehicleMeshes.get(v.id)?.attachGltfCar(carModel, v.config.modelKind === 'ferrari');
      }
    }

    trafficMeshes.attachGltfCars((kind) => assets.cloneCarModel(kind));
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
      interiorSystem.attachGltfNpcs((idx) => assets.clonePedestrian(idx));
    }

    // Stream all 30 CC0 photorealistic PBR interior furniture & prop GLBs asynchronously
    void loadInteriorPropAssets().then((propsMap) => {
      interiorSystem.attachGltfProps(propsMap);
    });

    const carCount = Object.keys(assets.carGltfs).length;
    const boatCount = Object.keys(assets.boatGltfs).length;
    if (carCount > 0 || boatCount > 0 || assets.protagonistGltf) {
      hud.showToast(
        `HD Assets Ready: ${carCount} car models, ${boatCount} boat & ship models, & 72 locals across 11 districts!`,
        'success',
      );
    }
  });

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
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solcoast-save.json';
    a.click();
    URL.revokeObjectURL(url);
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
      const nearExit = distXZ(player.x, player.z, def.exitX, def.exitZ) <= 2.4;
      const nearbyNpc = nearExit ? null : findNearbyInteriorNpc(def, player.x, player.z);

      let promptText: string | null = null;
      if (nearExit) {
        promptText = `Exit to ${def.districtLabel}`;
      } else if (nearbyNpc) {
        promptText = nearbyNpc.actionCost
          ? `Talk / Order from ${nearbyNpc.name} (${nearbyNpc.role}) — $${nearbyNpc.actionCost}`
          : `Talk to ${nearbyNpc.name} (${nearbyNpc.role})`;
      }

      if (snap.interactPressed && interiorTransitionCooldown <= 0) {
        if (nearExit) {
          // Step back outside onto the city sidewalk — consume interact so we NEVER re-enter on the same frame!
          interactConsumed = true;
          interiorTransitionCooldown = 0.4;
          activeInterior = null;
          interiorSystem.setActiveInterior(null);
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
          sound.playChime('enter');
          hud.showToast(`Stepped back out onto ${def.districtLabel}`, 'info');
          persistNow(false);
        } else if (nearbyNpc) {
          interactConsumed = true;
          const count = npcTalkCounts.get(nearbyNpc.id) ?? 0;
          npcTalkCounts.set(nearbyNpc.id, count + 1);
          if (nearbyNpc.actionCost && nearbyNpc.actionToast) {
            if (cash >= nearbyNpc.actionCost) {
              cash -= nearbyNpc.actionCost;
              sound.playChime('paint');
              hud.showToast(nearbyNpc.actionToast, 'success');
              persistNow(false);
            } else {
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
        );

        interiorSystem.update(elapsed, dt, activeInterior.id, player.x, player.z);
        playerMesh.syncFromState(player, elapsed, dt, null, null, false);
        cameraCtrl.update(camera, dt, player, null, activeInterior);
        sound.updateDriving(false, 0, 0, 0, false);

        autoSaveTimer += dt;
        if (autoSaveTimer >= 15) {
          autoSaveTimer = 0;
          persistNow(true);
        }

        const outdoorDistrict = getDistrictAt(activeInterior.entranceX, activeInterior.entranceZ);
        const currentRoom = getInteriorRoomAt(activeInterior, player.x, player.z);
        hud.update({
          timeLabel: formatTimeLabel(timeOfDayHours),
          district: {
            ...outdoorDistrict,
            name: `${activeInterior.name} — ${currentRoom.name}`,
            tagline: activeInterior.districtLabel,
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
        minimap.render(blueprint, player, vehicles, trafficCars, missions, activeInterior);

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

    let promptText: string | null = null;
    if (nearbyMission) {
      const doneTag = missions.completedIds.has(nearbyMission.id) ? ' (Replay)' : '';
      promptText = `Start Mission: ${nearbyMission.title}${doneTag} — $${nearbyMission.rewardCash.toLocaleString()}`;
    } else if (nearbyEntrance) {
      promptText = `Enter ${nearbyEntrance.name}`;
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
        // Step inside the building interior!
        interiorTransitionCooldown = 0.4;
        activeInterior = nearbyEntrance;
        setOutdoorVisible(false);
        sky.setInteriorMode(true);
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
        sound.playChime('enter');
        hud.showDistrictBanner(nearbyEntrance.name);
        hud.showToast(`Entered ${nearbyEntrance.name} — explore all ${nearbyEntrance.rooms.length} rooms & talk to locals with [E]!`, 'success');
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
          sound.playChime('enter');
          persistNow(false);
        } else {
          hud.showToast('Slow down to exit the vehicle!', 'warn');
        }
      } else if (nearbyCar && !player.rapierControlled) {
        player.vehicleId = nearbyCar.vehicle.id;
        player.x = nearbyCar.vehicle.x;
        player.y = nearbyCar.vehicle.y;
        player.z = nearbyCar.vehicle.z;
        player.yaw = nearbyCar.vehicle.yaw;
        activeVehicle = nearbyCar.vehicle;
        sound.playChime('enter');
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
        stepVehiclePhysics(v, { throttle: 0, steer: 0, handbrake: false }, dt, blueprint.colliders);
      } else {
        v.lastCollisionImpact = 0;
      }
    }

    // 2. Resolve exact SAT rigid-body collisions between ALL fleet vehicles & ALL AI traffic cars FIRST!
    resolveVehiclePairCollisions(vehicles);
    stepTraffic(trafficCars, blueprint.trafficNodes, vehicles, dt, blueprint.colliders);

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
      );
    }

    stepPedestrians(pedestrians, vehicles, dt, trafficCars, blueprint.colliders);

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
    );
    streetProps.update(elapsed, skyRes.nightFactor);

    for (const v of vehicles) {
      const occupied = activeVehicle !== null && activeVehicle.id === v.id;
      vehicleMeshes.get(v.id)?.syncFromState(v, skyRes.nightFactor, dt, occupied);
    }
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

    const speedNorm = activeVehicle
      ? clamp(Math.abs(activeVehicle.speed) / activeVehicle.config.maxSpeed, 0, 1)
      : 0;

    if (activeVehicle) {
      const driftAmt = activeVehicle.drifting ? clamp(Math.abs(activeVehicle.lateralSpeed) / 10, 0.25, 1) : 0;
      sound.updateDriving(true, speedNorm, snap.forward, driftAmt, snap.horn);
    } else {
      sound.updateDriving(false, 0, 0, 0, false);
    }

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

  requestAnimationFrame(tick);
}

bootstrap();
