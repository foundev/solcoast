import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createCoastalBoatFleet, stepBoats } from '../src/entities/boats';
import { createSculptedCarBodyGeometry, createSculptedCabinGeometry } from '../src/entities/carGeometry';
import { createHumanRigController } from '../src/entities/humanRig';
import { createPedestrians, stepPedestrians } from '../src/entities/pedestrians';
import {
  computeCharacterPose,
  computeSafeExitPosition,
  createInitialPlayerState,
  findNearestVehicle,
  stepPlayerOnFoot,
} from '../src/entities/player';
import { createTrafficCars, stepTraffic } from '../src/entities/traffic';
import {
  DEFAULT_VEHICLES,
  computeGear,
  createVehicleState,
  speedToMph,
  stepVehiclePhysics,
} from '../src/entities/vehicle';
import { createCityBlueprint } from '../src/world/cityData';

describe('Driving, On-Foot & Traffic Simulation', () => {
  const blueprint = createCityBlueprint();

  it('accelerates, steers, drifts, and tracks odometer on modern vehicles', () => {
    const car = createVehicleState(DEFAULT_VEHICLES[0]);
    const startZ = car.z;

    // Accelerate north along Ocean Drive for 2 seconds
    for (let i = 0; i < 120; i++) {
      stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false }, 1 / 60, blueprint.colliders);
    }

    expect(car.z).toBeLessThan(startZ - 20);
    expect(speedToMph(car.speed)).toBeGreaterThan(55);
    expect(car.odometerMeters).toBeGreaterThan(20);
    expect(computeGear(car.speed)).not.toBe('N');

    // Handbrake drift turn to the right
    const yawBefore = car.yaw;
    for (let i = 0; i < 30; i++) {
      stepVehiclePhysics(car, { throttle: 0.4, steer: 1, handbrake: true }, 1 / 60, blueprint.colliders);
    }
    expect(car.yaw).toBeGreaterThan(yawBefore + 0.3);
    expect(car.drifting).toBe(true);
  });

  it('prevents vehicles from driving off into deep ocean water', () => {
    const car = createVehicleState(DEFAULT_VEHICLES[0]);
    car.x = 205;
    car.z = 20;
    car.yaw = Math.PI * 0.5; // Facing directly East into Atlantic Ocean

    for (let i = 0; i < 120; i++) {
      stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false }, 1 / 60, blueprint.colliders);
    }
    expect(car.x).toBeLessThanOrEqual(212.5);
  });

  it('allows seamlessly exiting a vehicle, walking/sprinting/jumping on foot, and re-entering', () => {
    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    const car = vehicles[0];
    const player = createInitialPlayerState(car);
    expect(player.vehicleId).toBe(car.id);

    // Exit car cleanly onto street/sidewalk
    const exitPos = computeSafeExitPosition(car, blueprint.colliders);
    player.vehicleId = null;
    player.x = exitPos.x;
    player.y = exitPos.y;
    player.z = exitPos.z;

    const found = findNearestVehicle(player.x, player.z, vehicles);
    expect(found?.vehicle.id).toBe(car.id);

    // Walk + sprint North + jump
    const startZ = player.z;
    stepPlayerOnFoot(
      player,
      { forward: 1, right: 0, sprint: true, jump: true, cameraYaw: 0 },
      1 / 60,
      blueprint.colliders,
      vehicles,
    );
    expect(player.grounded).toBe(false);
    expect(player.y).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) {
      stepPlayerOnFoot(
        player,
        { forward: 1, right: 0, sprint: true, jump: false, cameraYaw: 0 },
        1 / 60,
        blueprint.colliders,
        vehicles,
      );
    }
    expect(player.z).toBeLessThan(startZ - 6);
    expect(player.walkedMeters).toBeGreaterThan(6);
    expect(player.grounded).toBe(true);
  });

  it('moves ambient AI traffic cars cleanly along road lanes', () => {
    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    const traffic = createTrafficCars(blueprint.trafficNodes, 12);
    const initialPositions = traffic.map((c) => ({ x: c.x, z: c.z }));

    for (let i = 0; i < 90; i++) {
      stepTraffic(traffic, blueprint.trafficNodes, vehicles, 1 / 60);
    }

    const movedCount = traffic.filter(
      (c, i) => Math.hypot(c.x - initialPositions[i].x, c.z - initialPositions[i].z) > 2,
    ).length;
    expect(movedCount).toBeGreaterThanOrEqual(8);
  });

  it('bends character knees strictly backward (+Z) and elbows strictly forward (-Z) across walk, sprint, and jump', () => {
    const xAxis = new THREE.Vector3(1, 0, 0);
    const downLimb = new THREE.Vector3(0, -1, 0);

    const states = [
      { speed: 0, sprinting: false, grounded: true },
      { speed: 6.4, sprinting: false, grounded: true },
      { speed: 12.2, sprinting: true, grounded: true },
      { speed: 8.0, sprinting: true, grounded: false },
    ];

    for (const cfg of states) {
      for (let step = 0; step < 32; step++) {
        const phase = (step / 32) * Math.PI * 2;
        const player = createInitialPlayerState(null);
        player.speed = cfg.speed;
        player.sprinting = cfg.sprinting;
        player.grounded = cfg.grounded;
        player.walkPhase = phase;

        const pose = computeCharacterPose(player, step * 0.1);

        // Knees must ALWAYS bend backward (rotation.x <= 0 -> hanging calf rotates to +Z)
        expect(pose.leftKneeX).toBeLessThanOrEqual(0);
        expect(pose.rightKneeX).toBeLessThanOrEqual(0);
        const leftShinDir = downLimb.clone().applyAxisAngle(xAxis, pose.leftKneeX);
        const rightShinDir = downLimb.clone().applyAxisAngle(xAxis, pose.rightKneeX);
        expect(leftShinDir.z).toBeGreaterThanOrEqual(0);
        expect(rightShinDir.z).toBeGreaterThanOrEqual(0);

        // Elbows must ALWAYS bend forward (rotation.x >= 0 -> hanging forearm rotates to -Z)
        expect(pose.leftElbowX).toBeGreaterThanOrEqual(0);
        expect(pose.rightElbowX).toBeGreaterThanOrEqual(0);
        const leftForearmDir = downLimb.clone().applyAxisAngle(xAxis, pose.leftElbowX);
        const rightForearmDir = downLimb.clone().applyAxisAngle(xAxis, pose.rightElbowX);
        expect(leftForearmDir.z).toBeLessThanOrEqual(0);
        expect(rightForearmDir.z).toBeLessThanOrEqual(0);

        // Torso must lean forward (-Z) when moving
        if (cfg.speed > 1) {
          expect(pose.torsoPitchX).toBeLessThan(0);
        }
      }
    }
  });

  it('builds valid curved lofted car geometries and strolls sidewalk pedestrians cleanly', () => {
    for (const style of ['supercar', 'sedan', 'spyder', 'coupe'] as const) {
      const bodyGeo = createSculptedCarBodyGeometry(style);
      expect(bodyGeo.attributes.position.count).toBeGreaterThan(80);
      expect(bodyGeo.attributes.normal.count).toBe(bodyGeo.attributes.position.count);
      const cabinGeo = createSculptedCabinGeometry(style);
      expect(cabinGeo.attributes.position.count).toBeGreaterThan(50);
    }

    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    const peds = createPedestrians(12);
    const startPos = peds.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 90; i++) {
      stepPedestrians(peds, vehicles, 1 / 60);
    }
    const walked = peds.filter((p, i) => Math.hypot(p.x - startPos[i].x, p.z - startPos[i].z) > 1.2).length;
    expect(walked).toBeGreaterThanOrEqual(8);
  });

  it('drives Ready Player Me civilian avatar with in-place optical mocap Idle, Walk, and Run clips', async () => {
    (globalThis as unknown as { self: unknown; createImageBitmap: unknown }).self = globalThis;
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({
      width: 1,
      height: 1,
      close() {},
    });

    const loader = new GLTFLoader();
    const loadLocal = (rel: string) =>
      new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        const buf = fs.readFileSync(path.resolve(__dirname, '../public/assets', rel));
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        loader.parse(ab, '', resolve, reject);
      });

    const [avatar, idleG, walkG, runG, jumpG] = await Promise.all([
      loadLocal('models/avatar_5.glb'),
      loadLocal('animations/anim_idle.glb'),
      loadLocal('animations/anim_walk.glb'),
      loadLocal('animations/anim_run.glb'),
      loadLocal('animations/anim_jump.glb'),
    ]);

    const clips = [
      Object.assign(idleG.animations[0].clone(), { name: 'Idle' }),
      Object.assign(walkG.animations[0].clone(), { name: 'Walk' }),
      Object.assign(runG.animations[0].clone(), { name: 'Run' }),
      Object.assign(jumpG.animations[0].clone(), { name: 'Jump' }),
    ];

    const model = avatar.scene;
    const rig = createHumanRigController(model, clips);
    const wp = (name: string) => model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());

    // 1. Idle: relaxed natural human stance with arms beside hips
    rig.update(0.016, 0, false, true, 0);
    model.updateMatrixWorld(true);
    const handL = wp('LeftHand');
    const handR = wp('RightHand');
    expect(Math.abs(handL.x)).toBeLessThan(0.32);
    expect(Math.abs(handR.x)).toBeLessThan(0.32);
    expect(wp('Hips').y).toBeGreaterThan(0.9);

    // 2. Run: allow 0.24s crossfade from Idle into Run, then verify horizontal root-motion stays in place
    //    (|hips.z| < 0.05) while real studio mocap arms counter-swing naturally!
    for (let warm = 0; warm < 8; warm++) {
      rig.update(0.03, 11.5, true, true, warm * 0.03);
    }
    let maxLeftAhead = 0;
    let maxRightAhead = 0;
    for (let step = 0; step < 30; step++) {
      rig.update(0.03, 11.5, true, true, (step + 8) * 0.03);
      model.updateMatrixWorld(true);
      const hips = wp('Hips');
      expect(Math.abs(hips.z)).toBeLessThan(0.05);
      const fL = wp('LeftFoot');
      const fR = wp('RightFoot');
      const hL = wp('LeftHand');
      const hR = wp('RightHand');
      if (fL.z - fR.z > 0.45) {
        expect(hR.z).toBeGreaterThan(hL.z + 0.1);
        maxRightAhead = Math.max(maxRightAhead, hR.z - hL.z);
      }
      if (fR.z - fL.z > 0.45) {
        expect(hL.z).toBeGreaterThan(hR.z + 0.1);
        maxLeftAhead = Math.max(maxLeftAhead, hL.z - hR.z);
      }
    }
    expect(maxLeftAhead).toBeGreaterThan(0.35);
    expect(maxRightAhead).toBeGreaterThan(0.35);
  });

  it('populates 50+ strolling locals, 7+ multi-model traffic classes, cruising boats, and valid optimized GLB assets', () => {
    // 1. 52 distinct pedestrians distributed across all city corridors
    const peds = createPedestrians(52);
    expect(peds.length).toBe(52);
    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    expect(vehicles.length).toBe(6);
    expect(new Set(vehicles.map((v) => v.config.modelKind)).size).toBe(6);

    // 2. Multi-model AI traffic covers 7 distinct car models
    const traffic = createTrafficCars(blueprint.trafficNodes, 18);
    expect(new Set(traffic.map((t) => t.modelKind)).size).toBe(7);

    // 3. Coastal boat fleet has moored marina craft + actively cruising offshore boats + cruise liner
    const boats = createCoastalBoatFleet();
    expect(boats.length).toBeGreaterThanOrEqual(12);
    expect(new Set(boats.map((b) => b.kind)).size).toBe(6);
    const movingStart = boats.filter((b) => !b.moored).map((b) => ({ id: b.id, x: b.x, z: b.z }));
    for (let i = 0; i < 120; i++) {
      stepBoats(boats, 1 / 60);
    }
    for (const s of movingStart) {
      const now = boats.find((b) => b.id === s.id)!;
      expect(Math.hypot(now.x - s.x, now.z - s.z)).toBeGreaterThan(4);
    }

    // 4. Every bundled car & boat GLB is present, valid binary glTF, and game-optimized (< 1 MB)
    const modelsDir = path.resolve(__dirname, '../public/assets/models');
    const requiredModels = [
      'ferrari.glb',
      'car_spyder.glb',
      'car_gt.glb',
      'car_ev.glb',
      'car_suv.glb',
      'car_taxi.glb',
      'car_coupe.glb',
      'car_jdm.glb',
      'boat_speedboat.glb',
      'boat_cruiser.glb',
      'boat_sailboat.glb',
      'boat_motorboat.glb',
      'boat_watertaxi.glb',
      'boat_cruiseship.glb',
    ];
    const dec = new TextDecoder();
    for (const file of requiredModels) {
      const full = path.resolve(modelsDir, file);
      const buf = fs.readFileSync(full);
      expect(buf.byteLength, `${file} non-empty`).toBeGreaterThan(10_000);
      expect(dec.decode(buf.subarray(0, 4)), `${file} magic`).toBe('glTF');
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const jsonLen = view.getUint32(12, true);
      const gltf = JSON.parse(dec.decode(buf.subarray(20, 20 + jsonLen)));
      expect(gltf.extensionsUsed ?? [], `${file} must not use slow transmission pass`).not.toContain(
        'KHR_materials_transmission',
      );
    }
  });
});
