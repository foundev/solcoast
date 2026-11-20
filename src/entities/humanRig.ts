import * as THREE from 'three';
import { clamp } from '../core/math';

export type HumanLocomotionMode = 'idle' | 'walk' | 'run' | 'jump';

export interface MocapClipSet {
  idle: THREE.AnimationClip | null;
  walk: THREE.AnimationClip | null;
  run: THREE.AnimationClip | null;
  jump: THREE.AnimationClip | null;
}

/**
 * Converts a root-motion optical mocap AnimationClip into a clean in-place game clip
 * by removing horizontal (X, Z) translation drift from the Hips position track while
 * preserving natural vertical hip bounce (Y) and all 52 bone rotation tracks untouched.
 */
export function makeInPlaceClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cloned = clip.clone();
  for (const track of cloned.tracks) {
    if (/hips\.position$/i.test(track.name)) {
      const vals = track.values;
      for (let i = 0; i < vals.length; i += 3) {
        vals[i] = 0; // remove lateral X drift
        vals[i + 2] = 0; // remove forward Z root-motion travel
      }
    }
  }
  return cloned;
}

export interface HumanRigController {
  mixer: THREE.AnimationMixer;
  update: (dt: number, speed: number, sprinting: boolean, grounded: boolean, elapsed: number) => void;
}

/**
 * Pure studio optical motion-capture animation controller for Ready Player Me
 * full-body civilian avatars (`Idle`, `Walk`, `Run`, `Jump`) with smooth crossfades
 * and velocity-matched playback speed. Zero procedural joint hacks!
 */
export function createHumanRigController(
  model: THREE.Object3D,
  clips: THREE.AnimationClip[],
): HumanRigController {
  const mixer = new THREE.AnimationMixer(model);

  const findByPattern = (re: RegExp) => clips.find((c) => re.test(c.name)) ?? null;
  const idleClip = findByPattern(/idle/i);
  const walkClip = findByPattern(/walk(?!.*jump)/i);
  const runClip = findByPattern(/run|jog/i);
  const jumpClip = findByPattern(/jump/i);

  const idleAction = idleClip ? mixer.clipAction(makeInPlaceClip(idleClip)) : null;
  const walkAction = walkClip ? mixer.clipAction(makeInPlaceClip(walkClip)) : null;
  const runAction = runClip ? mixer.clipAction(makeInPlaceClip(runClip)) : null;
  const jumpAction = jumpClip ? mixer.clipAction(makeInPlaceClip(jumpClip)) : null;

  if (jumpAction) {
    jumpAction.setLoop(THREE.LoopOnce, 1);
    jumpAction.clampWhenFinished = true;
  }

  let activeMode: HumanLocomotionMode = 'idle';
  if (idleAction) {
    idleAction.reset().play();
  }

  const getAction = (mode: HumanLocomotionMode): THREE.AnimationAction | null => {
    switch (mode) {
      case 'idle':
        return idleAction;
      case 'walk':
        return walkAction ?? idleAction;
      case 'run':
        return runAction ?? walkAction ?? idleAction;
      case 'jump':
        return jumpAction ?? runAction ?? idleAction;
    }
  };

  return {
    mixer,
    update(dt: number, speed: number, sprinting: boolean, grounded: boolean, _elapsed: number) {
      let desired: HumanLocomotionMode;
      if (!grounded && jumpAction) {
        desired = 'jump';
      } else if (speed < 0.35) {
        desired = 'idle';
      } else if (sprinting || speed > 7.5) {
        desired = 'run';
      } else {
        desired = 'walk';
      }

      if (desired !== activeMode) {
        const from = getAction(activeMode);
        const to = getAction(desired);
        if (to) {
          to.enabled = true;
          to.reset().play();
          if (from && from !== to) {
            from.crossFadeTo(to, desired === 'jump' ? 0.1 : 0.18, true);
          }
          activeMode = desired;
        }
      }

      if (walkAction && activeMode === 'walk') {
        walkAction.timeScale = clamp(speed / 2.9, 0.72, 1.55);
      } else if (runAction && activeMode === 'run') {
        runAction.timeScale = clamp(speed / 7.4, 0.85, 1.45);
      }

      mixer.update(dt);
    },
  };
}
