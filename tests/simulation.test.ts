import { describe, expect, it } from 'vitest';
import {
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
});
