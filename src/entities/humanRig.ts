import * as THREE from 'three';
import { clamp, lerp } from '../core/math';

export type HumanLocomotionMode = 'idle' | 'walk' | 'run';

const ARM_BONE_PATTERN = /(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/i;

/**
 * Strips broken/stiff arm tracks from an AnimationClip so natural anatomically-correct
 * counter-swinging arm pose can be applied cleanly on top of the real skeletal leg gait.
 */
export function sanitizeHumanClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const filteredTracks = clip.tracks.filter((track) => {
    const boneName = track.name.split('.')[0];
    return !ARM_BONE_PATTERN.test(boneName);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
}

/**
 * Aims a bone whose longitudinal axis is +Y toward a target unit direction
 * expressed in the model's root space (where +Z is character forward, +Y is up, +X is left).
 */
function aimBoneInModelSpace(
  bone: THREE.Object3D,
  targetDirModel: THREE.Vector3,
  restLocalQuat: THREE.Quaternion,
  invModelMat: THREE.Matrix4,
  tmpParentWorld: THREE.Matrix4,
  tmpMat: THREE.Matrix4,
  tmpCurDir: THREE.Vector3,
  tmpDelta: THREE.Quaternion,
): void {
  const parent = bone.parent;
  if (!parent) return;

  // Start from the bone's natural bind-pose orientation (preserves clean anatomical twist/roll)
  bone.quaternion.copy(restLocalQuat);
  bone.updateMatrixWorld(true);

  // Current +Y bone direction in modelRoot space
  tmpMat.multiplyMatrices(invModelMat, bone.matrixWorld);
  tmpCurDir.set(0, 1, 0).transformDirection(tmpMat).normalize();

  // Compute shortest-arc rotation in model space from current +Y to desired targetDirModel
  tmpDelta.setFromUnitVectors(tmpCurDir, targetDirModel);

  // Convert that model-space delta into bone's parent-local space and premultiply
  tmpParentWorld.multiplyMatrices(invModelMat, parent.matrixWorld);
  const parentQuat = new THREE.Quaternion().setFromRotationMatrix(tmpParentWorld);
  const invParentQuat = parentQuat.clone().invert();

  const localDelta = invParentQuat.multiply(tmpDelta).multiply(parentQuat);
  bone.quaternion.premultiply(localDelta).normalize();
  bone.updateMatrixWorld(true);
}

export interface HumanRigController {
  mixer: THREE.AnimationMixer;
  update: (dt: number, speed: number, sprinting: boolean, grounded: boolean, elapsed: number) => void;
}

/**
 * Wraps a cloned Innerscene CC0 rigged human (Sam, Maya, Jordan, Harper) with:
 * - Smooth crossfaded Idle_Standing / Walk_Relaxed / Jog-Run skeletal leg animations
 * - Lifted upright pelvis posture (fixing the baked duck-crouch in Walk/Run clips)
 * - Clean quaternion-aimed counter-swinging arms & forward-bending elbows synced live to the feet!
 */
export function createHumanRigController(
  model: THREE.Object3D,
  rawAnimations: THREE.AnimationClip[],
): HumanRigController {
  const mixer = new THREE.AnimationMixer(model);

  const sanitized = rawAnimations.map(sanitizeHumanClip);
  const findFirst = (names: string[]) => {
    for (const n of names) {
      const hit = sanitized.find((c) => c.name.toLowerCase() === n.toLowerCase());
      if (hit) return hit;
    }
    return sanitized[0] ?? null;
  };

  const cIdle = findFirst(['Idle_Standing', 'Idle']);
  const cWalk = findFirst(['Walk_Relaxed', 'Walk_Brisk', 'Walk']);
  const cRun = findFirst(['Jog', 'Run']);

  const idleAction = cIdle ? mixer.clipAction(cIdle) : null;
  const walkAction = cWalk ? mixer.clipAction(cWalk) : null;
  const runAction = cRun ? mixer.clipAction(cRun) : null;

  let activeMode: HumanLocomotionMode = 'idle';
  if (idleAction) {
    idleAction.reset().play();
  }

  // Locate key skeleton bones once
  const pelvis = model.getObjectByName('pelvis') ?? null;
  const clavL = model.getObjectByName('clavicle_l') ?? null;
  const clavR = model.getObjectByName('clavicle_r') ?? null;
  const upperL = model.getObjectByName('upperarm_l') ?? null;
  const lowerL = model.getObjectByName('lowerarm_l') ?? null;
  const upperR = model.getObjectByName('upperarm_r') ?? null;
  const lowerR = model.getObjectByName('lowerarm_r') ?? null;
  const footL = model.getObjectByName('foot_l') ?? null;
  const footR = model.getObjectByName('foot_r') ?? null;

  // Capture clean bind-pose local quaternions before animation modifies them
  const restClavL = clavL ? clavL.quaternion.clone() : new THREE.Quaternion();
  const restClavR = clavR ? clavR.quaternion.clone() : new THREE.Quaternion();
  const restUpperL = upperL ? upperL.quaternion.clone() : new THREE.Quaternion();
  const restLowerL = lowerL ? lowerL.quaternion.clone() : new THREE.Quaternion();
  const restUpperR = upperR ? upperR.quaternion.clone() : new THREE.Quaternion();
  const restLowerR = lowerR ? lowerR.quaternion.clone() : new THREE.Quaternion();
  const restPelvisZ = pelvis ? pelvis.position.z : 0.89;

  // Reusable scratch math objects (zero per-frame allocations)
  const invModelMat = new THREE.Matrix4();
  const tmpParentWorld = new THREE.Matrix4();
  const tmpMat = new THREE.Matrix4();
  const tmpCurDir = new THREE.Vector3();
  const tmpDelta = new THREE.Quaternion();
  const tmpFootL = new THREE.Vector3();
  const tmpFootR = new THREE.Vector3();
  const tmpDirUpper = new THREE.Vector3();
  const tmpDirLower = new THREE.Vector3();

  let smoothStride = 0;

  return {
    mixer,
    update(dt: number, speed: number, sprinting: boolean, grounded: boolean, elapsed: number) {
      const desired: HumanLocomotionMode =
        speed < 0.35 ? 'idle' : sprinting || speed > 7.5 ? 'run' : 'walk';

      if (desired !== activeMode) {
        const from =
          activeMode === 'idle' ? idleAction : activeMode === 'walk' ? walkAction : runAction;
        const to =
          desired === 'idle' ? idleAction : desired === 'walk' ? walkAction : runAction;
        if (to) {
          to.enabled = true;
          to.reset().play();
          if (from && from !== to) {
            from.crossFadeTo(to, 0.2, true);
          }
          activeMode = desired;
        }
      }

      if (walkAction && activeMode === 'walk') {
        walkAction.timeScale = clamp(speed / 4.2, 0.75, 1.55);
      } else if (runAction && activeMode === 'run') {
        runAction.timeScale = clamp(speed / 7.2, 0.85, 1.55);
      }

      mixer.update(dt);

      // Lift exaggerated baked pelvis crouch back toward natural upright human height
      // (Note: pelvis sits under Root rotated -90 deg X, so pelvis.position.z is vertical height!)
      if (pelvis && activeMode !== 'idle') {
        pelvis.position.z = lerp(pelvis.position.z, restPelvisZ - 0.015, 0.62);
      }

      model.updateMatrixWorld(true);
      invModelMat.copy(model.matrixWorld).invert();

      // Read live stride phase directly from the skeleton's own feet in model space (+Z = forward)
      let rawStride = 0;
      if (footL && footR && activeMode !== 'idle') {
        footL.getWorldPosition(tmpFootL).applyMatrix4(invModelMat);
        footR.getWorldPosition(tmpFootR).applyMatrix4(invModelMat);
        rawStride = clamp((tmpFootL.z - tmpFootR.z) / 0.68, -1, 1);
      }
      smoothStride = lerp(smoothStride, rawStride, clamp(dt * 18, 0, 1));

      // Keep clavicles relaxed & level in bind pose (prevents hunched shoulders)
      if (clavL) clavL.quaternion.copy(restClavL);
      if (clavR) clavR.quaternion.copy(restClavR);
      model.updateMatrixWorld(true);

      const moveNorm = clamp(speed / 6.0, 0, 1);
      const runBlend = activeMode === 'run' ? 1 : 0;
      const idleBreath = Math.sin(elapsed * 2.1) * 0.025;

      // Helper to pose one arm cleanly in model space (+Z = forward, +Y = up, side = +1 left / -1 right)
      const poseArm = (
        upper: THREE.Object3D | null,
        lower: THREE.Object3D | null,
        restU: THREE.Quaternion,
        restL: THREE.Quaternion,
        side: 1 | -1,
        swingSignal: number, // +1 = arm forward, -1 = arm back
      ) => {
        if (!upper || !lower) return;

        let upperOutX: number;
        let upperFwdZ: number;
        let elbowForwardBoost: number;
        let elbowLiftY: number;

        if (!grounded) {
          // Athletic mid-air balance pose
          upperOutX = side * 0.24;
          upperFwdZ = side > 0 ? 0.32 : -0.15;
          elbowForwardBoost = 0.62;
          elbowLiftY = 0.28;
        } else if (activeMode === 'idle') {
          // Relaxed natural standing hang closely alongside hips (NO gorilla bow-out!)
          upperOutX = side * 0.09;
          upperFwdZ = 0.03 + idleBreath;
          elbowForwardBoost = 0.14;
          elbowLiftY = 0.0;
        } else {
          // Smooth natural counter-swinging walk / athletic runner pump
          const swingAmp = lerp(0.46, 0.72, runBlend) * moveNorm;
          upperOutX = side * lerp(0.11, 0.14, runBlend);
          upperFwdZ = swingSignal * swingAmp;
          // Forearm always bends forward (+Z), lifting cleanly when swinging forward or sprinting
          const forwardFlex = Math.max(0, swingSignal);
          elbowForwardBoost = lerp(0.24 + forwardFlex * 0.34, 0.88 + forwardFlex * 0.32, runBlend);
          elbowLiftY = lerp(0.06 + forwardFlex * 0.14, 0.58 + forwardFlex * 0.36, runBlend);
        }

        // Upper arm direction (downward -Y, slight outward X, forward/back Z)
        tmpDirUpper.set(upperOutX, -1.0, upperFwdZ).normalize();
        aimBoneInModelSpace(
          upper,
          tmpDirUpper,
          restU,
          invModelMat,
          tmpParentWorld,
          tmpMat,
          tmpCurDir,
          tmpDelta,
        );

        // Forearm bends strictly forward (+Z) and slightly inward across torso during run
        const lowerOutX = side * (runBlend > 0.5 ? -0.08 : 0.02);
        const lowerY = -1.0 + elbowLiftY;
        const lowerZ = upperFwdZ + elbowForwardBoost;
        tmpDirLower.set(lowerOutX, lowerY, lowerZ).normalize();
        aimBoneInModelSpace(
          lower,
          tmpDirLower,
          restL,
          invModelMat,
          tmpParentWorld,
          tmpMat,
          tmpCurDir,
          tmpDelta,
        );
      };

      // Counter-swing: when left foot is forward (+smoothStride), RIGHT arm swings forward (+smoothStride)
      // and LEFT arm swings backward (-smoothStride)!
      poseArm(upperL, lowerL, restUpperL, restLowerL, 1, -smoothStride);
      poseArm(upperR, lowerR, restUpperR, restLowerR, -1, smoothStride);
    },
  };
}
