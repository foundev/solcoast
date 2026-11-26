import * as THREE from 'three';
import { clamp, forwardFromYaw, lerp, lerpAngle, wrapAngle } from '../core/math';
import type { PlayerState } from '../entities/player';
import type { VehicleState } from '../entities/vehicle';
import {
  getFloorFromPlayerY,
  getInteriorRoomAt,
  interiorLocalToWorld,
  type InteriorDef,
} from '../world/interiors';

export type CameraMode = 'chase' | 'far' | 'hood';

export class CameraController {
  public yaw = 0;
  public pitch = 0.24;
  public zoomOffset = 0;
  public mode: CameraMode = 'chase';

  private orbitCooldown = 0;
  private shakeIntensity = 0;
  private shakePhase = 0;
  private readonly currentPos = new THREE.Vector3(144, 6, 40);
  private readonly currentLook = new THREE.Vector3(144, 2, 24);
  private readonly tmpDesiredPos = new THREE.Vector3();
  private readonly tmpDesiredLook = new THREE.Vector3();
  private initialized = false;

  public addImpactShake(strength: number): void {
    this.shakeIntensity = Math.min(0.65, Math.max(this.shakeIntensity, strength));
  }

  public snap(): void {
    this.initialized = false;
  }

  public cycleMode(): CameraMode {
    if (this.mode === 'chase') this.mode = 'far';
    else if (this.mode === 'far') this.mode = 'hood';
    else this.mode = 'chase';
    return this.mode;
  }

  public applyLookInput(mouseDX: number, mouseDY: number, wheelDelta: number): void {
    if (Math.abs(mouseDX) > 0.01 || Math.abs(mouseDY) > 0.01) {
      this.yaw = wrapAngle(this.yaw + mouseDX * 0.0038);
      this.pitch = clamp(this.pitch + mouseDY * 0.003, -0.08, 0.88);
      this.orbitCooldown = 2.2;
    }
    if (wheelDelta !== 0) {
      this.zoomOffset = clamp(this.zoomOffset + wheelDelta * 0.85, -2.5, 5.5);
    }
  }

  public update(
    camera: THREE.PerspectiveCamera,
    dt: number,
    player: PlayerState,
    activeVehicle: VehicleState | null,
    activeInterior?: InteriorDef | null,
  ): void {
    const safeDt = clamp(dt, 0.001, 0.05);
    if (this.orbitCooldown > 0) {
      this.orbitCooldown = Math.max(0, this.orbitCooldown - safeDt);
    }

    const desiredPos = this.tmpDesiredPos;
    const desiredLook = this.tmpDesiredLook;
    let targetFov = 62;

    if (activeVehicle) {
      // Gently align chase camera behind the car when moving and user isn't orbiting
      const speedAbs = Math.abs(activeVehicle.speed);
      if (this.orbitCooldown <= 0 && speedAbs > 1.2) {
        const alignYaw = activeVehicle.speed >= -0.5 ? activeVehicle.yaw : wrapAngle(activeVehicle.yaw + Math.PI);
        this.yaw = lerpAngle(this.yaw, alignYaw, clamp(safeDt * (3.2 + speedAbs * 0.08), 0, 1));
        this.pitch = lerp(this.pitch, 0.22, clamp(safeDt * 2.5, 0, 1));
      }

      const fwd = forwardFromYaw(activeVehicle.yaw);
      if (this.mode === 'hood') {
        desiredPos.set(
          activeVehicle.x + fwd.x * 0.45,
          activeVehicle.y + 1.55,
          activeVehicle.z + fwd.z * 0.45,
        );
        desiredLook.set(
          activeVehicle.x + fwd.x * 24,
          activeVehicle.y + 1.1,
          activeVehicle.z + fwd.z * 24,
        );
        targetFov = 68 + clamp(speedAbs / 55, 0, 1) * 10;
      } else {
        const baseDist = this.mode === 'far' ? 12.2 : 8.4;
        const speedPull = clamp(speedAbs / 52, 0, 1) * 2.4;
        const dist = clamp(baseDist + speedPull + this.zoomOffset, 5.5, 18);
        const horiz = Math.cos(this.pitch) * dist;
        const height = Math.sin(this.pitch) * dist + 1.85;
        const camFwd = forwardFromYaw(this.yaw);

        desiredPos.set(
          activeVehicle.x - camFwd.x * horiz,
          Math.max(activeVehicle.y + height, activeVehicle.y + 1.2),
          activeVehicle.z - camFwd.z * horiz,
        );
        desiredLook.set(
          activeVehicle.x + fwd.x * 4.2,
          activeVehicle.y + 1.35,
          activeVehicle.z + fwd.z * 4.2,
        );
        targetFov = 62 + clamp(speedAbs / 54, 0, 1) * 14;
      }
    } else {
      // Smooth 3rd-person on-foot orbit camera (tighter & wall-clamped inside building interiors!)
      const dist = activeInterior
        ? clamp(3.5 + this.zoomOffset * 0.35, 2.2, 5.2)
        : clamp(5.2 + this.zoomOffset * 0.65, 3.0, 9.5);
      const horiz = Math.cos(this.pitch) * dist;
      const height = Math.sin(this.pitch) * dist + (activeInterior ? 1.55 : 1.75);
      const camFwd = forwardFromYaw(this.yaw);

      let px = player.x - camFwd.x * horiz;
      let py = Math.max(player.y + height, player.y + 0.8);
      let pz = player.z - camFwd.z * horiz;

      if (activeInterior) {
        const floor = getFloorFromPlayerY(player.y, activeInterior);
        const room = getInteriorRoomAt(activeInterior, player.x, player.z, floor);
        const camRoom = getInteriorRoomAt(activeInterior, px, pz, floor);
        const camInsideRoom =
          px >= camRoom.minX + 0.45 &&
          px <= camRoom.maxX - 0.45 &&
          pz >= camRoom.minZ + 0.45 &&
          pz <= camRoom.maxZ - 0.45;
        if (!camInsideRoom) {
          px = clamp(px, room.minX + 0.55, room.maxX - 0.55);
          pz = clamp(pz, room.minZ + 0.55, room.maxZ - 0.55);
        }
        const ceilH = Math.min(room.height, camRoom.height);
        py = clamp(py, player.y + 0.9, player.y + ceilH - 0.5);
      }

      desiredPos.set(px, py, pz);
      desiredLook.set(
        player.x + camFwd.x * (activeInterior ? 1.8 : 2.2),
        player.y + 1.45,
        player.z + camFwd.z * (activeInterior ? 1.8 : 2.2),
      );
      targetFov = player.sprinting ? 66 : 60;
    }

    if (!this.initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(desiredLook);
      this.initialized = true;
    } else {
      const followRate = activeVehicle && this.mode === 'hood' ? 28 : 11;
      this.currentPos.lerp(desiredPos, clamp(safeDt * followRate, 0, 1));
      this.currentLook.lerp(desiredLook, clamp(safeDt * 14, 0, 1));
    }

    camera.position.copy(this.currentPos);
    if (this.shakeIntensity > 0.005) {
      this.shakePhase += safeDt * 48;
      camera.position.x += Math.sin(this.shakePhase * 1.3) * this.shakeIntensity;
      camera.position.y += Math.cos(this.shakePhase * 1.9) * this.shakeIntensity * 0.7;
      camera.position.z += Math.sin(this.shakePhase * 1.7 + 1.1) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-9.5 * safeDt);
    } else {
      this.shakeIntensity = 0;
    }
    if (activeInterior) {
      const floor = getFloorFromPlayerY(player.y, activeInterior);
      const wPos = interiorLocalToWorld(
        activeInterior,
        camera.position.x,
        camera.position.y,
        camera.position.z,
        floor,
      );
      const wLook = interiorLocalToWorld(
        activeInterior,
        this.currentLook.x,
        this.currentLook.y,
        this.currentLook.z,
        floor,
      );
      camera.position.set(wPos.x, wPos.y, wPos.z);
      camera.lookAt(wLook.x, wLook.y, wLook.z);
    } else {
      camera.lookAt(this.currentLook);
    }
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = lerp(camera.fov, targetFov, clamp(safeDt * 6, 0, 1));
      camera.updateProjectionMatrix();
    }
  }
}
