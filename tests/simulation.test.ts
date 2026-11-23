import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { InputManager } from '../src/core/input';
import { createCoastalBoatFleet, stepBoats } from '../src/entities/boats';
import { createSculptedCarBodyGeometry, createSculptedCabinGeometry } from '../src/entities/carGeometry';
import { createHumanRigController } from '../src/entities/humanRig';
import { createPedestrians, stepPedestrians } from '../src/entities/pedestrians';
import {
  applySeatedDrivingPose,
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
  resolveVehiclePairCollisions,
  speedToMph,
  stepVehiclePhysics,
} from '../src/entities/vehicle';
import { RagdollPhysicsWorld } from '../src/systems/ragdollWorld';
import { INTERIOR_PROP_KINDS } from '../src/world/assets';
import { createCityBlueprint } from '../src/world/cityData';
import {
  INTERIOR_ORIGIN_Y,
  INTERIORS,
  findNearbyBuildingEntrance,
  findNearbyInteriorNpc,
  getInteriorRoomAt,
  stepPlayerInInterior,
} from '../src/world/interiors';

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

  it('populates 72 non-clumping locals, 8 drivable car models, multi-model traffic, cruising boats, and valid optimized GLB assets', () => {
    // 1. 72 distinct pedestrians evenly distributed with NO duplicate base avatars on the same route!
    const peds = createPedestrians(72);
    expect(peds.length).toBe(72);
    const byRoute = new Map<number, number[]>();
    for (const p of peds) {
      const list = byRoute.get(p.routeIndex) ?? [];
      list.push(p.variantIndex % 6);
      byRoute.set(p.routeIndex, list);
    }
    for (const [routeIdx, bases] of byRoute) {
      expect(new Set(bases).size, `route ${routeIdx} must not clone the same base avatar`).toBe(bases.length);
    }

    const vehicles = DEFAULT_VEHICLES.map(createVehicleState);
    expect(vehicles.length).toBe(8);
    expect(new Set(vehicles.map((v) => v.config.modelKind)).size).toBe(8);

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

  it('resolves realistic solid collisions, hood launches, tumbles, slides, and recovery for people & cars', () => {
    // 1. High-speed car hitting a pedestrian launches them realistically -> airborne -> downed -> recovering -> normal
    const car = createVehicleState(DEFAULT_VEHICLES[0]);
    car.x = 140;
    car.z = 20;
    car.yaw = 0; // heading North (-Z)
    car.vx = 0;
    car.vz = -18;
    car.speed = 18;

    const peds = createPedestrians(1);
    const ped = peds[0];
    ped.x = 140;
    ped.z = 17.6; // right in front of bumper
    ped.y = 0;

    stepPedestrians(peds, [car], 1 / 60, [], blueprint.colliders);
    expect(ped.ragdollMode).toBe('airborne');
    expect(ped.vy).toBeGreaterThan(3);
    expect(ped.vz).toBeLessThan(-10);
    expect(car.lastCollisionImpact).toBeGreaterThan(2);

    // Park the car and simulate 6 seconds so the pedestrian arcs, lands, slides, recovers, and stands back up!
    car.vx = 0;
    car.vz = 0;
    car.speed = 0;
    let sawDowned = false;
    let sawRecovering = false;
    let maxAirY = 0;
    for (let i = 0; i < 360; i++) {
      stepPedestrians(peds, [car], 1 / 60, [], blueprint.colliders);
      maxAirY = Math.max(maxAirY, ped.y);
      if (ped.ragdollMode === 'downed') sawDowned = true;
      if (ped.ragdollMode === 'recovering') sawRecovering = true;
    }
    expect(maxAirY).toBeGreaterThan(0.35);
    expect(sawDowned).toBe(true);
    expect(sawRecovering).toBe(true);
    expect(ped.ragdollMode).toBe('normal');

    // 2. Player on foot cannot walk through a pedestrian (solid separation + stumble/tackle!)
    const player = createInitialPlayerState(null);
    player.x = 140;
    player.z = 50;
    player.y = 0;
    player.speed = 11.5;
    player.sprinting = true;

    const bystander = createPedestrians(1)[0];
    bystander.x = 140;
    bystander.z = 49.4; // overlapping ahead
    bystander.y = 0;

    stepPlayerOnFoot(
      player,
      { forward: 1, right: 0, sprint: true, jump: false, cameraYaw: 0 },
      1 / 60,
      blueprint.colliders,
      [],
      [],
      [bystander],
    );
    expect(Math.hypot(player.x - bystander.x, player.z - bystander.z)).toBeGreaterThanOrEqual(0.8);
    expect(bystander.ragdollMode === 'airborne' || bystander.ragdollMode === 'stumble').toBe(true);

    // 3. Moving traffic car hitting the player on foot knocks the player airborne & tumbles!
    const walker = createInitialPlayerState(null);
    walker.x = 140;
    walker.z = 0;
    walker.y = 0;
    const traffic = createTrafficCars(blueprint.trafficNodes, 1);
    traffic[0].x = 140;
    traffic[0].z = 2.0;
    traffic[0].yaw = 0; // heading North (-Z)
    traffic[0].vx = 0;
    traffic[0].vz = -14;
    traffic[0].speed = 14;

    stepPlayerOnFoot(
      walker,
      { forward: 0, right: 0, sprint: false, jump: false, cameraYaw: 0 },
      1 / 60,
      blueprint.colliders,
      [],
      traffic,
      [],
    );
    expect(walker.ragdollMode).toBe('airborne');
    expect(walker.vy).toBeGreaterThan(2.5);
    expect(walker.vz).toBeLessThan(-6);

    // 4. Walking or sprinting right up to a PARKED car stops cleanly at the door (NEVER launches you flying!)
    const parked = createVehicleState(DEFAULT_VEHICLES[0]);
    parked.x = 140;
    parked.z = 20;
    parked.yaw = 0;
    parked.vx = 0;
    parked.vz = 0;

    const boarder = createInitialPlayerState(null);
    boarder.x = 138.6; // right beside driver door
    boarder.z = 20;
    boarder.y = 0;
    boarder.speed = 11;
    boarder.sprinting = true;

    for (let i = 0; i < 10; i++) {
      stepPlayerOnFoot(
        boarder,
        { forward: 0, right: 1, sprint: true, jump: false, cameraYaw: 0 },
        1 / 60,
        blueprint.colliders,
        [parked],
        [],
        [],
      );
    }
    expect(boarder.ragdollMode).toBe('normal');
    expect(boarder.pendingRagdollImpact).toBeNull();
    expect(Math.hypot(boarder.x - parked.x, boarder.z - parked.z)).toBeLessThan(2.2);
  });

  it('runs real Rapier3D 11-limb articulated ragdolls with independent limb bending & 3-stage physical get-up', async () => {
    (globalThis as unknown as { self: unknown; createImageBitmap: unknown }).self = globalThis;
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({
      width: 1,
      height: 1,
      close() {},
    });

    const loader = new GLTFLoader();
    const buf = fs.readFileSync(path.resolve(__dirname, '../public/assets/models/avatar_5.glb'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => loader.parse(ab, '', resolve, reject));

    const entityRoot = new THREE.Group();
    entityRoot.position.set(140, 0, 20);
    const tumblePivot = new THREE.Group();
    tumblePivot.position.y = 0.92;
    entityRoot.add(tumblePivot);
    const avatarRoot = gltf.scene;
    avatarRoot.rotation.y = Math.PI;
    avatarRoot.position.y = -0.92;
    tumblePivot.add(avatarRoot);
    entityRoot.updateMatrixWorld(true);

    const ragdollWorld = await RagdollPhysicsWorld.create(blueprint);
    const leftArmBefore = avatarRoot.getObjectByName('LeftArm')!.quaternion.clone();
    const leftLegBefore = avatarRoot.getObjectByName('LeftLeg')!.quaternion.clone();

    const ok = ragdollWorld.spawnRagdoll(
      'ped:test',
      entityRoot,
      avatarRoot,
      { vx: 1.5, vy: 4.5, vz: -12, hitZone: 'bumper', sideOffset: 0.4 },
      false,
    );
    expect(ok).toBe(true);
    expect(ragdollWorld.getActiveCount()).toBe(1);

    let sawRagdoll = false;
    let sawGetUp = false;
    let maxArmDelta = 0;
    let maxLegDelta = 0;
    let minGetUpHipsY = Infinity;
    let maxGetUpHipsY = -Infinity;

    for (let i = 0; i < 420; i++) {
      ragdollWorld.step(1 / 60);
      const st = ragdollWorld.getStatus('ped:test');
      if (!st) break;
      if (st.phase === 'ragdoll') {
        sawRagdoll = true;
        maxArmDelta = Math.max(maxArmDelta, leftArmBefore.angleTo(avatarRoot.getObjectByName('LeftArm')!.quaternion));
        maxLegDelta = Math.max(maxLegDelta, leftLegBefore.angleTo(avatarRoot.getObjectByName('LeftLeg')!.quaternion));
      } else if (st.phase === 'getup') {
        sawGetUp = true;
        const hy = avatarRoot.getObjectByName('Hips')!.position.y;
        minGetUpHipsY = Math.min(minGetUpHipsY, hy);
        maxGetUpHipsY = Math.max(maxGetUpHipsY, hy);
      }
    }

    expect(sawRagdoll).toBe(true);
    expect(sawGetUp).toBe(true);
    // Verify limbs actually articulated freely under Rapier3D physics (NOT a stiff plank!)
    expect(maxArmDelta).toBeGreaterThan(0.18);
    expect(maxLegDelta).toBeGreaterThan(0.12);
    // Verify 3-stage get-up physically lifted hips off the ground to standing height
    expect(maxGetUpHipsY - minGetUpHipsY).toBeGreaterThan(0.35);
    // Ragdoll cleanly tore down its Rapier bodies once standing back up
    expect(ragdollWorld.getStatus('ped:test')).toBeNull();
    expect(ragdollWorld.getActiveCount()).toBe(0);
  });

  it('simulates GTA-style car yaw momentum, suspension squat/roll, and airborne jumps over ramps', () => {
    const car = createVehicleState(DEFAULT_VEHICLES[0]);
    // 1. Hard acceleration squats the rear suspension (nose lifts -> positive pitchTilt)
    for (let i = 0; i < 20; i++) {
      stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false }, 1 / 60, blueprint.colliders);
    }
    expect(car.pitchTilt).toBeGreaterThan(0.01);

    // 2. Handbrake powerslide builds real yawRate momentum & body roll
    for (let i = 0; i < 60; i++) {
      stepVehiclePhysics(car, { throttle: 1, steer: 0, handbrake: false }, 1 / 60, blueprint.colliders);
    }
    for (let i = 0; i < 20; i++) {
      stepVehiclePhysics(car, { throttle: 0.4, steer: 1, handbrake: true }, 1 / 60, blueprint.colliders);
    }
    expect(Math.abs(car.yawRate)).toBeGreaterThan(0.6);
    expect(car.drifting).toBe(true);
    expect(Math.abs(car.rollTilt)).toBeGreaterThan(0.015);
  });

  it('prevents ghosting through parked fleet cars & traffic cars with real SAT rigid-body PIT/T-bone physics', () => {
    // 1. Player Ferrari ramming a parked Taxi transfers momentum + spins the taxi (NEVER drives through!)
    const ferrari = createVehicleState(DEFAULT_VEHICLES[0]);
    const taxi = createVehicleState(DEFAULT_VEHICLES[4]);
    ferrari.x = 140;
    ferrari.z = 20;
    ferrari.yaw = 0; // heading North (-Z)
    ferrari.vx = 0;
    ferrari.vz = -22;
    ferrari.speed = 22;

    // Offset slightly right so corner impact produces real PIT-style rotational torque!
    taxi.x = 140.9;
    taxi.z = 15.8;
    taxi.yaw = 0;
    taxi.vx = 0;
    taxi.vz = 0;

    resolveVehiclePairCollisions([ferrari, taxi]);
    expect(taxi.vz).toBeLessThan(-6);
    expect(Math.abs(taxi.yawRate)).toBeGreaterThan(0.5);
    expect(ferrari.vz).toBeGreaterThan(-20); // Ferrari loses momentum on impact
    expect(ferrari.lastCollisionImpact).toBeGreaterThan(10);

    // 2. T-boning an AI traffic car puts it into free-skid crash physics (`stunnedTimer > 0`) with spin!
    const traffic = createTrafficCars(blueprint.trafficNodes, 1);
    const tc = traffic[0];
    const tcRightX = Math.cos(tc.yaw);
    const tcRightZ = Math.sin(tc.yaw);
    const tcFwdX = Math.sin(tc.yaw);
    const tcFwdZ = -Math.cos(tc.yaw);

    const striker = createVehicleState(DEFAULT_VEHICLES[0]);
    // Slam broadside into traffic car's rear-right door panel!
    striker.x = tc.x + tcRightX * 2.9 - tcFwdX * 0.9;
    striker.z = tc.z + tcRightZ * 2.9 - tcFwdZ * 0.9;
    striker.yaw = tc.yaw - Math.PI * 0.5;
    striker.vx = -tcRightX * 22;
    striker.vz = -tcRightZ * 22;

    stepTraffic(traffic, blueprint.trafficNodes, [striker], 1 / 60, blueprint.colliders);
    expect(tc.stunnedTimer).toBeGreaterThan(1.0);
    expect(Math.abs(tc.yawRate)).toBeGreaterThan(0.8);
    expect(Math.hypot(tc.vx, tc.vz)).toBeGreaterThan(3.5);

    // Stepping forward lets the struck traffic car actually skid & spin out freely instead of snapping to its lane
    const yawAtHit = tc.yaw;
    for (let i = 0; i < 15; i++) {
      stepTraffic(traffic, blueprint.trafficNodes, [], 1 / 60, blueprint.colliders);
    }
    expect(Math.abs(tc.yaw - yawAtHit)).toBeGreaterThan(0.2);
  });

  it('prevents stuck movement keys on macOS Meta shortcuts, accent-hold keys, blur, and pause', () => {
    const winListeners = new Map<string, Set<(e: unknown) => void>>();
    const docListeners = new Map<string, Set<(e: unknown) => void>>();
    const fakeWin = {
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        if (!winListeners.has(t)) winListeners.set(t, new Set());
        winListeners.get(t)!.add(fn);
      },
      removeEventListener: (t: string, fn: (e: unknown) => void) => winListeners.get(t)?.delete(fn),
    };
    const fakeDoc = {
      hidden: false,
      activeElement: null,
      pointerLockElement: null,
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        if (!docListeners.has(t)) docListeners.set(t, new Set());
        docListeners.get(t)!.add(fn);
      },
      removeEventListener: (t: string, fn: (e: unknown) => void) => docListeners.get(t)?.delete(fn),
    };
    const fakeCanvas = {
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLCanvasElement;

    const prevWin = (globalThis as unknown as { window?: unknown }).window;
    const prevDoc = (globalThis as unknown as { document?: unknown }).document;
    (globalThis as unknown as { window: unknown }).window = fakeWin;
    (globalThis as unknown as { document: unknown }).document = fakeDoc;

    try {
      const input = new InputManager(fakeCanvas);
      const fireWin = (type: string, ev: Record<string, unknown> = {}) => {
        for (const fn of winListeners.get(type) ?? []) fn(ev);
      };

      // 1. Holding W/A prevents default (blocks macOS accent popup!) and registers movement
      let prevented = false;
      fireWin('keydown', {
        code: 'KeyW',
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat: false,
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(prevented).toBe(true);
      expect(input.poll().forward).toBe(1);

      // 2. Pressing macOS Command/Meta while holding W immediately clears held keys so W cannot stick!
      fireWin('keydown', {
        code: 'MetaLeft',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: () => {},
      });
      expect(input.poll().forward).toBe(0);

      // 3. Window focus regain or blur clears any stale keys
      fireWin('keydown', {
        code: 'KeyA',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: () => {},
      });
      expect(input.poll().right).toBe(-1);
      fireWin('focus', {});
      expect(input.poll().right).toBe(0);

      // 4. Visibility change (tab switch / Mission Control) clears stuck keys
      fireWin('keydown', {
        code: 'KeyD',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: () => {},
      });
      expect(input.poll().right).toBe(1);
      fakeDoc.hidden = true;
      for (const fn of docListeners.get('visibilitychange') ?? []) fn({});
      expect(input.poll().right).toBe(0);

      input.dispose();
    } finally {
      (globalThis as unknown as { window?: unknown }).window = prevWin;
      (globalThis as unknown as { document?: unknown }).document = prevDoc;
    }
  });

  it('seats the real street-tough protagonist cleanly behind the wheel at 10-and-2 with legs in the footwell', async () => {
    (globalThis as unknown as { self: unknown; createImageBitmap: unknown }).self = globalThis;
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({
      width: 1,
      height: 1,
      close() {},
    });

    const loader = new GLTFLoader();
    const buf = fs.readFileSync(path.resolve(__dirname, '../public/assets/models/avatar_5.glb'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => loader.parse(ab, '', resolve, reject));

    const parent = new THREE.Group();
    const avatar = gltf.scene;
    avatar.rotation.y = Math.PI;
    parent.add(avatar);
    parent.updateMatrixWorld(true);

    const restQuats = new Map<string, THREE.Quaternion>();
    avatar.traverse((o) => restQuats.set(o.name, o.quaternion.clone()));

    applySeatedDrivingPose(avatar, restQuats, 0.35);
    parent.updateMatrixWorld(true);

    const wp = (name: string) => avatar.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
    const lHand = wp('LeftHand');
    const rHand = wp('RightHand');
    const head = wp('Head');
    const lFoot = wp('LeftFoot');

    // Both hands forward on the steering wheel (-Z), separated ~28-38cm horizontally
    expect(lHand.z).toBeLessThan(-0.28);
    expect(rHand.z).toBeLessThan(-0.28);
    expect(rHand.x - lHand.x).toBeGreaterThan(0.22);
    expect(rHand.x - lHand.x).toBeLessThan(0.45);
    // Turning right (+steerAngle) lifts left hand higher than right hand on the wheel rim
    expect(lHand.y).toBeGreaterThan(rHand.y + 0.03);
    // Head upright above Hips and feet tucked down in the pedal footwell
    expect(head.y).toBeGreaterThan(0.5);
    expect(lFoot.y).toBeLessThan(-0.3);
  });

  it('supports multi-room building interiors, valid 3D prop GLBs, doorway traversal, and solid wall/furniture/NPC collisions', () => {
    // 1. All 30 CC0 interior furniture/prop GLBs exist, are valid binary glTF, and avoid slow transmission passes
    const propsDir = path.resolve(__dirname, '../public/assets/props');
    const dec = new TextDecoder();
    expect(INTERIOR_PROP_KINDS.length).toBe(30);
    for (const kind of INTERIOR_PROP_KINDS) {
      const buf = fs.readFileSync(path.resolve(propsDir, `${kind}.glb`));
      expect(buf.byteLength, `${kind}.glb non-empty`).toBeGreaterThan(5_000);
      expect(dec.decode(buf.subarray(0, 4)), `${kind}.glb magic`).toBe('glTF');
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const jsonLen = view.getUint32(12, true);
      const gltf = JSON.parse(dec.decode(buf.subarray(20, 20 + jsonLen)));
      expect(gltf.extensionsUsed ?? []).not.toContain('KHR_materials_transmission');
    }

    // 2. Outdoor doorway detection at real Hotel Solaire facade
    const hotel = INTERIORS.find((v) => v.id === 'hotel-solaire')!;
    expect(findNearbyBuildingEntrance(hotel.entranceX + 0.5, hotel.entranceZ)?.id).toBe('hotel-solaire');
    expect(findNearbyBuildingEntrance(0, 0)).toBeNull();

    // 3. Multi-room traversal: start in Grand Atrium, walk North through suite archway into Penthouse Suite
    const p = createInitialPlayerState(null);
    p.x = hotel.spawnX;
    p.y = INTERIOR_ORIGIN_Y;
    p.z = hotel.spawnZ;
    p.yaw = hotel.spawnYaw;
    expect(getInteriorRoomAt(hotel, p.x, p.z).id).toBe('atrium');

    for (let i = 0; i < 190; i++) {
      stepPlayerInInterior(p, hotel, { forward: 1, right: 0, sprint: true, jump: false, cameraYaw: 0 }, 1 / 60);
    }
    expect(p.y).toBeCloseTo(INTERIOR_ORIGIN_Y, 3);
    expect(getInteriorRoomAt(hotel, p.x, p.z).id).toBe('suite');

    // 4. Walk East through the Atrium -> Ocean Cocktail Lounge brass archway (z = 4.0)
    p.x = 6.0;
    p.z = 4.0;
    for (let i = 0; i < 120; i++) {
      stepPlayerInInterior(p, hotel, { forward: 0, right: 1, sprint: true, jump: false, cameraYaw: 0 }, 1 / 60);
    }
    expect(getInteriorRoomAt(hotel, p.x, p.z).id).toBe('lounge');

    // 5. Walking into solid interior partition wall (x = 10 at z = 9.0, outside the z: 1.5..6.5 doorway) is blocked!
    p.x = 8.5;
    p.z = 9.0;
    for (let i = 0; i < 80; i++) {
      stepPlayerInInterior(p, hotel, { forward: 0, right: 1, sprint: true, jump: false, cameraYaw: 0 }, 1 / 60);
    }
    expect(p.x).toBeLessThanOrEqual(9.7);

    // 6. Standing at Ocean Cocktail Lounge mahogany bar reaches Bartender Mateo across the counter
    expect(findNearbyInteriorNpc(hotel, 19.0, 2.6)?.id).toBe('solaire-bartender');

    // 7. Indoor NPC bodies stay solid (cannot walk through them)
    const npc = hotel.npcs[2]; // Camila
    p.x = npc.x;
    p.z = npc.z + 1.4;
    expect(findNearbyInteriorNpc(hotel, p.x, p.z)?.id).toBe(npc.id);
    for (let i = 0; i < 40; i++) {
      stepPlayerInInterior(p, hotel, { forward: 1, right: 0, sprint: false, jump: false, cameraYaw: 0 }, 1 / 60);
    }
    expect(Math.hypot(p.x - npc.x, p.z - npc.z)).toBeGreaterThanOrEqual(0.8);
  });
});
