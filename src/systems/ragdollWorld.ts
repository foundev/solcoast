import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { clamp, forwardFromYaw, rightFromYaw, wrapAngle, yawFromDir } from '../core/math';
import { getGroundHeight } from '../world/cityData';
import type { CityBlueprint } from '../world/types';
import type { TrafficCarState } from '../entities/traffic';
import type { VehicleState } from '../entities/vehicle';

export interface RagdollImpactSpec {
  /** Linear impulse velocity imparted to the body (m/s) */
  vx: number;
  vy: number;
  vz: number;
  /** 'bumper' sweeps legs first so torso slams onto car hood; 'body' hits chest/hips (sprint tackle) */
  hitZone: 'bumper' | 'body';
  /** Signed lateral hit offset (-1 left .. +1 right) for realistic off-center twist */
  sideOffset: number;
}

export interface RagdollStatus {
  phase: 'ragdoll' | 'getup';
  /** Current world position of the character's pelvis/hips */
  x: number;
  y: number;
  z: number;
  /** Facing yaw aligned to resting body during get-up */
  yaw: number;
}

interface LimbBinding {
  key: string;
  bone: THREE.Object3D;
  body: RAPIER.RigidBody;
  /** Transforms Rapier rigid-body world quaternion -> Three.js bone world quaternion */
  qOffset: THREE.Quaternion;
}

interface GetUpSnapshot {
  hipsPos: THREE.Vector3;
  boneQuats: Map<string, THREE.Quaternion>;
  targetYaw: number;
  facingDown: boolean;
  groundY: number;
  standingHipsLocalY: number;
  restQuats: Map<string, THREE.Quaternion>;
}

interface ActiveRagdoll {
  id: string;
  isPlayer: boolean;
  /** The outer character root (`position = (x,y,z)`, `rotation.y = -yaw`) */
  entityRoot: THREE.Object3D;
  /** The Ready Player Me avatar scene root (`rotation.y = Math.PI`) */
  avatarRoot: THREE.Object3D;
  armature: THREE.Object3D;
  hipsBone: THREE.Object3D;
  phase: 'ragdoll' | 'getup';
  elapsed: number;
  settleTimer: number;
  limbs: LimbBinding[];
  joints: RAPIER.ImpulseJoint[];
  groundColliderBody: RAPIER.RigidBody | null;
  getUp: GetUpSnapshot | null;
  getUpElapsed: number;
  getUpDuration: number;
  /** Saved original local transforms of hips & intermediate bones so we restore cleanly */
  savedHipsLocalPos: THREE.Vector3;
  savedAvatarScale: THREE.Vector3;
  lastHipsWorld: THREE.Vector3;
  restingYaw: number;
}

interface KinematicCarRig {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
}

// Collision groups (16-bit membership << 16 | 16-bit filter):
//   Group 1 (0x0001): Static world (ground, buildings)
//   Group 2 (0x0002): Kinematic vehicles (bumper, sloped hood, cabin)
//   Group 4 (0x0004): Ragdoll limbs (collide with World + Vehicles, NOT with self/other limbs!)
const WORLD_GROUP = (0x0001 << 16) | 0xffff;
const VEHICLE_GROUP = (0x0002 << 16) | 0x0004;
const RAGDOLL_GROUP = (0x0004 << 16) | (0x0001 | 0x0002);

const MAX_ACTIVE_RAGDOLLS = 6;
const FIXED_STEP = 1 / 60;

// Strict living-human anatomical joint limits (radians relative to character's rest pose)
// Prevents broken necks, inverted elbows/knees, hyperextended spines & rubber-spaghetti limbs!
const ANATOMICAL_LIMITS: Record<
  string,
  { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; muscleTone: number }
> = {
  Spine2: { minX: -0.28, maxX: 0.56, minY: -0.38, maxY: 0.38, minZ: -0.32, maxZ: 0.32, muscleTone: 0.22 },
  Head: { minX: -0.44, maxX: 0.48, minY: -0.52, maxY: 0.52, minZ: -0.34, maxZ: 0.34, muscleTone: 0.28 },
  LeftArm: { minX: -0.82, maxX: 0.95, minY: -0.78, maxY: 0.78, minZ: -0.85, maxZ: 0.85, muscleTone: 0.24 },
  LeftForeArm: { minX: -0.15, maxX: 1.35, minY: -0.38, maxY: 0.38, minZ: -0.32, maxZ: 0.82, muscleTone: 0.22 },
  RightArm: { minX: -0.82, maxX: 0.95, minY: -0.78, maxY: 0.78, minZ: -0.85, maxZ: 0.85, muscleTone: 0.24 },
  RightForeArm: { minX: -0.15, maxX: 1.35, minY: -0.38, maxY: 0.38, minZ: -0.82, maxZ: 0.32, muscleTone: 0.22 },
  LeftUpLeg: { minX: -0.42, maxX: 1.28, minY: -0.36, maxY: 0.36, minZ: -0.38, maxZ: 0.42, muscleTone: 0.20 },
  LeftLeg: { minX: -1.68, maxX: 0.05, minY: -0.16, maxY: 0.16, minZ: -0.16, maxZ: 0.16, muscleTone: 0.18 },
  RightUpLeg: { minX: -0.42, maxX: 1.28, minY: -0.36, maxY: 0.36, minZ: -0.42, maxZ: 0.38, muscleTone: 0.20 },
  RightLeg: { minX: -1.68, maxX: 0.05, minY: -0.16, maxY: 0.16, minZ: -0.16, maxZ: 0.16, muscleTone: 0.18 },
};

// Reusable scratch math objects (zero per-frame GC allocations!)
const _vA = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _yDir = new THREE.Vector3();
const _xDir = new THREE.Vector3();
const _zDir = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _qBody = new THREE.Quaternion();
const _qBoneWorld = new THREE.Quaternion();
const _qParentWorld = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _eul = new THREE.Euler(0, 0, 0, 'XYZ');

const TRACKED_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
] as const;

function buildCapsuleBasis(start: THREE.Vector3, end: THREE.Vector3, refRight: THREE.Vector3, outQuat: THREE.Quaternion): number {
  _yDir.subVectors(end, start);
  const len = _yDir.length();
  if (len < 1e-4) {
    outQuat.identity();
    return 0.1;
  }
  _yDir.divideScalar(len);
  // Orthogonalize refRight against yDir so local +X stays aligned with character's anatomical right axis
  _xDir.copy(refRight).addScaledVector(_yDir, -refRight.dot(_yDir));
  if (_xDir.lengthSq() < 1e-4) {
    _xDir.set(0, 0, 1).addScaledVector(_yDir, -_yDir.z);
  }
  _xDir.normalize();
  _zDir.crossVectors(_xDir, _yDir).normalize();
  _mat4.makeBasis(_xDir, _yDir, _zDir);
  outQuat.setFromRotationMatrix(_mat4);
  return len;
}

function smoothstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Real WASM 3D rigid-body physics world powered by `@dimforge/rapier3d-compat`.
 *
 * Drives true 11-limb articulated skeletal ragdolls (Pelvis, Chest, Head, Upper Arms,
 * Forearms, Thighs, Shins) with anatomical spherical & limited-hinge knee joints,
 * sloped multi-collider car hoods/windshields, static building walls, per-ragdoll
 * terrain ground planes, and a 3-stage physical Roll/Push-Up -> Crouch -> Stand-Up
 * recovery sequence blended directly from the captured sprawled ragdoll pose!
 */
export class RagdollPhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly ragdolls = new Map<string, ActiveRagdoll>();
  private readonly carRigs = new Map<string, KinematicCarRig>();
  private readonly restPoseCache = new Map<string, Map<string, THREE.Quaternion>>();
  private accum = 0;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  public static async create(blueprint: CityBlueprint): Promise<RagdollPhysicsWorld> {
    await RAPIER.init();
    // Slightly punchier gravity (-15.5 m/s²) gives weighty, grounded GTA-style impacts without floatiness
    const world = new RAPIER.World({ x: 0, y: -15.5, z: 0 });
    const instance = new RagdollPhysicsWorld(world);
    instance.buildStaticWorldColliders(blueprint);
    return instance;
  }

  private buildStaticWorldColliders(blueprint: CityBlueprint): void {
    // Add all building & landmark AABBs as real static Rapier cuboids so ragdolls bounce off walls!
    const staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const box of blueprint.colliders) {
      const hx = Math.max(0.25, (box.maxX - box.minX) * 0.5);
      const hy = Math.max(0.5, (box.maxY - box.minY) * 0.5);
      const hz = Math.max(0.25, (box.maxZ - box.minZ) * 0.5);
      const cx = (box.minX + box.maxX) * 0.5;
      const cy = (box.minY + box.maxY) * 0.5;
      const cz = (box.minZ + box.maxZ) * 0.5;

      const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(0.75)
        .setRestitution(0.18)
        .setCollisionGroups(WORLD_GROUP);
      this.world.createCollider(col, staticBody);
    }
  }

  /**
   * Captures a clean standing rest pose for an avatar root (called once per character before any ragdoll).
   */
  public registerAvatarRestPose(id: string, avatarRoot: THREE.Object3D): void {
    if (this.restPoseCache.has(id)) return;
    const map = new Map<string, THREE.Quaternion>();
    for (const name of TRACKED_BONES) {
      const b = avatarRoot.getObjectByName(name);
      if (b) map.set(name, b.quaternion.clone());
    }
    this.restPoseCache.set(id, map);
  }

  public isActive(id: string): boolean {
    return this.ragdolls.has(id);
  }

  public getStatus(id: string): RagdollStatus | null {
    const r = this.ragdolls.get(id);
    if (!r) return null;
    return {
      phase: r.phase,
      x: r.lastHipsWorld.x,
      y: getGroundHeight(r.lastHipsWorld.x, r.lastHipsWorld.z),
      z: r.lastHipsWorld.z,
      yaw: r.restingYaw,
    };
  }

  public getActiveCount(): number {
    return this.ragdolls.size;
  }

  /**
   * Syncs sloped 3D kinematic car hulls (front bumper + sloped hood ramp + windshield/roof cabin)
   * into Rapier so ragdolls physically roll up car hoods and over windshields!
   */
  public syncVehicles(
    vehicles: VehicleState[],
    trafficCars: TrafficCarState[],
    focusX: number,
    focusZ: number,
  ): void {
    const syncCar = (key: string, x: number, y: number, z: number, yaw: number) => {
      let rig = this.carRigs.get(key);
      if (!rig) {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
        );
        // 1. Lower chassis + front/rear bumper slab (y = 0.22..0.76, full 4.46m length)
        const lower = RAPIER.ColliderDesc.cuboid(0.98, 0.27, 2.23)
          .setTranslation(0, 0.49, 0)
          .setFriction(0.35)
          .setRestitution(0.25)
          .setCollisionGroups(VEHICLE_GROUP);
        // 2. Sloped front hood & windshield ramp (angled smoothly so bodies flip UP and OVER the hood!)
        const hoodRampQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.34);
        const hood = RAPIER.ColliderDesc.cuboid(0.92, 0.14, 1.15)
          .setTranslation(0, 0.86, -1.05)
          .setRotation({ x: hoodRampQuat.x, y: hoodRampQuat.y, z: hoodRampQuat.z, w: hoodRampQuat.w })
          .setFriction(0.28)
          .setRestitution(0.22)
          .setCollisionGroups(VEHICLE_GROUP);
        // 3. Upper cabin roof & rear glass
        const cabin = RAPIER.ColliderDesc.cuboid(0.84, 0.34, 1.05)
          .setTranslation(0, 1.12, 0.35)
          .setFriction(0.35)
          .setRestitution(0.2)
          .setCollisionGroups(VEHICLE_GROUP);

        rig = {
          body,
          colliders: [
            this.world.createCollider(lower, body),
            this.world.createCollider(hood, body),
            this.world.createCollider(cabin, body),
          ],
        };
        this.carRigs.set(key, rig);
      }

      _qTmp.setFromAxisAngle(_vA.set(0, 1, 0), -yaw);
      rig.body.setNextKinematicTranslation({ x, y, z });
      rig.body.setNextKinematicRotation({ x: _qTmp.x, y: _qTmp.y, z: _qTmp.z, w: _qTmp.w });
    };

    for (const v of vehicles) {
      syncCar(`v:${v.id}`, v.x, v.y, v.z, v.yaw);
    }

    // Only keep kinematic colliders active for nearby AI traffic cars (within 95m)
    const activeTrafficKeys = new Set<string>();
    for (const tc of trafficCars) {
      const dSq = (tc.x - focusX) * (tc.x - focusX) + (tc.z - focusZ) * (tc.z - focusZ);
      if (dSq <= 95 * 95) {
        const key = `t:${tc.id}`;
        activeTrafficKeys.add(key);
        syncCar(key, tc.x, tc.y, tc.z, tc.yaw);
      }
    }
    for (const [key, rig] of this.carRigs) {
      if (key.startsWith('t:') && !activeTrafficKeys.has(key)) {
        this.world.removeRigidBody(rig.body);
        this.carRigs.delete(key);
      }
    }
  }

  /**
   * Spawns a true 11-limb, 10-joint articulated Rapier3D ragdoll directly from the
   * character's live Three.js SkinnedMesh bone transforms and imparts realistic impulse.
   */
  public spawnRagdoll(
    id: string,
    entityRoot: THREE.Object3D,
    avatarRoot: THREE.Object3D,
    impact: RagdollImpactSpec,
    isPlayer = false,
  ): boolean {
    if (this.ragdolls.has(id)) {
      // Already ragdolling — add a secondary kick impulse if hit again while downed!
      const existing = this.ragdolls.get(id)!;
      if (existing.phase === 'ragdoll') {
        for (const limb of existing.limbs) {
          limb.body.setLinvel(
            {
              x: clamp(impact.vx * 0.8, -28, 28),
              y: clamp(impact.vy * 0.75, 1.5, 9),
              z: clamp(impact.vz * 0.8, -28, 28),
            },
            true,
          );
        }
        existing.settleTimer = 0;
        return true;
      }
      this.destroyRagdoll(id);
    }

    // Cap simultaneous active ragdolls so performance stays locked at 60-120 FPS
    if (this.ragdolls.size >= MAX_ACTIVE_RAGDOLLS) {
      let oldestNonPlayer: string | null = null;
      let maxAge = -1;
      for (const [k, r] of this.ragdolls) {
        if (!r.isPlayer && r.elapsed > maxAge) {
          maxAge = r.elapsed;
          oldestNonPlayer = k;
        }
      }
      if (oldestNonPlayer) this.destroyRagdoll(oldestNonPlayer);
    }

    entityRoot.updateMatrixWorld(true);
    const hipsBone = avatarRoot.getObjectByName('Hips');
    const spineBone = avatarRoot.getObjectByName('Spine');
    const spine2Bone = avatarRoot.getObjectByName('Spine2');
    const neckBone = avatarRoot.getObjectByName('Neck');
    const headBone = avatarRoot.getObjectByName('Head');
    const lArm = avatarRoot.getObjectByName('LeftArm');
    const lForeArm = avatarRoot.getObjectByName('LeftForeArm');
    const lHand = avatarRoot.getObjectByName('LeftHand');
    const rArm = avatarRoot.getObjectByName('RightArm');
    const rForeArm = avatarRoot.getObjectByName('RightForeArm');
    const rHand = avatarRoot.getObjectByName('RightHand');
    const lUpLeg = avatarRoot.getObjectByName('LeftUpLeg');
    const lLeg = avatarRoot.getObjectByName('LeftLeg');
    const lFoot = avatarRoot.getObjectByName('LeftFoot');
    const rUpLeg = avatarRoot.getObjectByName('RightUpLeg');
    const rLeg = avatarRoot.getObjectByName('RightLeg');
    const rFoot = avatarRoot.getObjectByName('RightFoot');

    if (
      !hipsBone ||
      !hipsBone.parent ||
      !spineBone ||
      !spine2Bone ||
      !neckBone ||
      !headBone ||
      !lArm ||
      !lForeArm ||
      !lHand ||
      !rArm ||
      !rForeArm ||
      !rHand ||
      !lUpLeg ||
      !lLeg ||
      !lFoot ||
      !rUpLeg ||
      !rLeg ||
      !rFoot
    ) {
      return false;
    }

    this.registerAvatarRestPose(id, avatarRoot);

    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const pHips = wp(hipsBone);
    const pSpine = wp(spineBone);
    const pNeck = wp(neckBone);
    const pHead = wp(headBone);
    const pHeadTop = pHead.clone().add(new THREE.Vector3(0, 0.22, 0));
    const pLArm = wp(lArm);
    const pLFore = wp(lForeArm);
    const pLHand = wp(lHand);
    const pRArm = wp(rArm);
    const pRFore = wp(rForeArm);
    const pRHand = wp(rHand);
    const pLUpLeg = wp(lUpLeg);
    const pLLeg = wp(lLeg);
    const pLFoot = wp(lFoot);
    const pRUpLeg = wp(rUpLeg);
    const pRLeg = wp(rLeg);
    const pRFoot = wp(rFoot);

    // Character anatomical right direction (from left hip toward right hip)
    const refRight = new THREE.Vector3().subVectors(pRUpLeg, pLUpLeg);
    if (refRight.lengthSq() < 1e-4) refRight.set(1, 0, 0);
    else refRight.normalize();

    const limbs: LimbBinding[] = [];
    const byKey = new Map<string, RAPIER.RigidBody>();
    const joints: RAPIER.ImpulseJoint[] = [];

    const createLimb = (
      key: string,
      bone: THREE.Object3D,
      start: THREE.Vector3,
      end: THREE.Vector3,
      radius: number,
      mass: number,
      linDamp = 0.55,
      angDamp = 2.4,
    ): RAPIER.RigidBody => {
      const len = buildCapsuleBasis(start, end, refRight, _qBody);
      _mid.addVectors(start, end).multiplyScalar(0.5);
      const halfHeight = Math.max(0.03, len * 0.5 - radius * 0.55);

      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_mid.x, _mid.y, _mid.z)
        .setRotation({ x: _qBody.x, y: _qBody.y, z: _qBody.z, w: _qBody.w })
        .setLinearDamping(linDamp)
        .setAngularDamping(angDamp)
        .setCcdEnabled(true);
      const body = this.world.createRigidBody(desc);

      const col = RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setMass(mass)
        .setFriction(0.86)
        .setRestitution(0.12)
        .setCollisionGroups(RAGDOLL_GROUP);
      this.world.createCollider(col, body);

      // Capture exact offset from rigid body world rotation -> bone world rotation
      bone.getWorldQuaternion(_qBoneWorld);
      const qOffset = _qBody.clone().invert().multiply(_qBoneWorld);

      limbs.push({ key, bone, body, qOffset });
      byKey.set(key, body);
      return body;
    };

    // 11 articulated rigid bodies matching human mass distribution (~76 kg total) with living-muscle angular damping
    const bHips = createLimb('Hips', hipsBone, pHips.clone().add(new THREE.Vector3(0, -0.06, 0)), pSpine, 0.13, 16, 0.65, 3.8);
    const bChest = createLimb('Spine2', spine2Bone, pSpine, pNeck, 0.15, 22, 0.65, 4.4);
    const bHead = createLimb('Head', headBone, pHead, pHeadTop, 0.105, 5.5, 0.65, 5.2);

    const bLArm = createLimb('LeftArm', lArm, pLArm, pLFore, 0.055, 2.8, 0.6, 5.0);
    const bLFore = createLimb('LeftForeArm', lForeArm, pLFore, pLHand, 0.045, 2.0, 0.6, 5.4);
    const bRArm = createLimb('RightArm', rArm, pRArm, pRFore, 0.055, 2.8, 0.6, 5.0);
    const bRFore = createLimb('RightForeArm', rForeArm, pRFore, pRHand, 0.045, 2.0, 0.6, 5.4);

    const bLUpLeg = createLimb('LeftUpLeg', lUpLeg, pLUpLeg, pLLeg, 0.08, 8.5, 0.65, 4.4);
    const bLLeg = createLimb('LeftLeg', lLeg, pLLeg, pLFoot, 0.06, 4.5, 0.65, 4.8);
    const bRUpLeg = createLimb('RightUpLeg', rUpLeg, pRUpLeg, pRLeg, 0.08, 8.5, 0.65, 4.4);
    const bRLeg = createLimb('RightLeg', rLeg, pRLeg, pRFoot, 0.06, 4.5, 0.65, 4.8);

    // Helper: convert a world anchor point into a rigid body's exact local space
    const toLocal = (body: RAPIER.RigidBody, worldPt: THREE.Vector3) => {
      const t = body.translation();
      const r = body.rotation();
      _qTmp.set(r.x, r.y, r.z, r.w).invert();
      _vA.set(worldPt.x - t.x, worldPt.y - t.y, worldPt.z - t.z).applyQuaternion(_qTmp);
      return { x: _vA.x, y: _vA.y, z: _vA.z };
    };

    const addSpherical = (a: RAPIER.RigidBody, b: RAPIER.RigidBody, anchorWorld: THREE.Vector3) => {
      const jd = RAPIER.JointData.spherical(toLocal(a, anchorWorld), toLocal(b, anchorWorld));
      joints.push(this.world.createImpulseJoint(jd, a, b, true));
    };

    const addHinge = (
      a: RAPIER.RigidBody,
      b: RAPIER.RigidBody,
      anchorWorld: THREE.Vector3,
      minRad: number,
      maxRad: number,
    ) => {
      // Local +X of both thigh & shin capsules is aligned with character's anatomical right axis!
      const jd = RAPIER.JointData.revolute(
        toLocal(a, anchorWorld),
        toLocal(b, anchorWorld),
        { x: 1, y: 0, z: 0 },
      );
      jd.limitsEnabled = true;
      jd.limits = [minRad, maxRad];
      joints.push(this.world.createImpulseJoint(jd, a, b, true));
    };

    // Connect all 10 anatomical joints!
    addSpherical(bHips, bChest, pSpine);
    addSpherical(bChest, bHead, pNeck);
    addSpherical(bChest, bLArm, pLArm);
    addSpherical(bLArm, bLFore, pLFore);
    addSpherical(bChest, bRArm, pRArm);
    addSpherical(bRArm, bRFore, pRFore);
    addSpherical(bHips, bLUpLeg, pLUpLeg);
    addHinge(bLUpLeg, bLLeg, pLLeg, -2.1, 0.08); // Knees bend naturally backward only!
    addSpherical(bHips, bRUpLeg, pRUpLeg);
    addHinge(bRUpLeg, bRLeg, pRLeg, -2.1, 0.08);

    // Local terrain ground slab beneath this ragdoll (tracks exact sidewalk/dune/pier/causeway height!)
    const gY = getGroundHeight(pHips.x, pHips.z);
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pHips.x, gY - 0.5, pHips.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(12, 0.5, 12)
        .setFriction(0.9)
        .setRestitution(0.08)
        .setCollisionGroups(WORLD_GROUP),
      groundBody,
    );

    // Impart anatomically realistic impact velocity distribution!
    // Bumper hit sweeps thighs/hips harder & earlier so the upper torso naturally whips & rolls onto the car hood!
    const baseVx = clamp(impact.vx, -28, 28);
    const baseVy = clamp(impact.vy, 0.8, 8.2);
    const baseVz = clamp(impact.vz, -28, 28);
    const spinYaw = clamp(impact.sideOffset * 5.2, -6.5, 6.5);

    for (const limb of limbs) {
      let mult = 1.0;
      let lift = baseVy;
      if (impact.hitZone === 'bumper') {
        if (limb.key === 'LeftUpLeg' || limb.key === 'RightUpLeg' || limb.key === 'LeftLeg' || limb.key === 'RightLeg') {
          mult = 1.18;
          lift = baseVy * 1.15;
        } else if (limb.key === 'Hips') {
          mult = 1.05;
          lift = baseVy * 1.05;
        } else if (limb.key === 'Spine2' || limb.key === 'Head') {
          // Upper body lags slightly behind swept legs -> natural fold onto hood & whip!
          mult = 0.72;
          lift = baseVy * 0.65;
        } else {
          mult = 0.82;
          lift = baseVy * 0.9;
        }
      } else {
        // Sprint shoulder-tackle hits chest/hips directly
        if (limb.key === 'Spine2' || limb.key === 'Hips') {
          mult = 1.1;
        } else if (limb.key === 'LeftLeg' || limb.key === 'RightLeg') {
          mult = 0.55;
        }
      }

      limb.body.setLinvel({ x: baseVx * mult, y: lift, z: baseVz * mult }, true);
      if (limb.key === 'Hips' || limb.key === 'Spine2') {
        limb.body.setAngvel(
          {
            x: (Math.random() - 0.5) * 2.5,
            y: spinYaw,
            z: (Math.random() - 0.5) * 2.5,
          },
          true,
        );
      }
    }

    const ragdoll: ActiveRagdoll = {
      id,
      isPlayer,
      entityRoot,
      avatarRoot,
      armature: hipsBone.parent,
      hipsBone,
      phase: 'ragdoll',
      elapsed: 0,
      settleTimer: 0,
      limbs,
      joints,
      groundColliderBody: groundBody,
      getUp: null,
      getUpElapsed: 0,
      getUpDuration: isPlayer ? 1.25 : 1.55,
      savedHipsLocalPos: hipsBone.position.clone(),
      savedAvatarScale: avatarRoot.scale.clone(),
      lastHipsWorld: pHips.clone(),
      restingYaw: -entityRoot.rotation.y,
    };

    this.ragdolls.set(id, ragdoll);
    return true;
  }

  public destroyRagdoll(id: string): void {
    const r = this.ragdolls.get(id);
    if (!r) return;
    for (const j of r.joints) {
      this.world.removeImpulseJoint(j, true);
    }
    for (const limb of r.limbs) {
      this.world.removeRigidBody(limb.body);
    }
    if (r.groundColliderBody) {
      this.world.removeRigidBody(r.groundColliderBody);
    }
    // Restore clean local hips height so mocap locomotion picks up seamlessly
    r.hipsBone.position.copy(r.savedHipsLocalPos);
    this.ragdolls.delete(id);
  }

  /**
   * Advances Rapier3D physics & drives all active 11-limb skeletal ragdolls
   * and multi-stage physical get-up sequences!
   */
  public step(dt: number): void {
    const safeDt = clamp(dt, 0.001, 0.05);

    // Only run Rapier solver substeps when at least one dynamic ragdoll is active (0ms idle cost!)
    let anyPhysicsRagdoll = false;
    for (const r of this.ragdolls.values()) {
      if (r.phase === 'ragdoll') {
        anyPhysicsRagdoll = true;
        // Keep each ragdoll's local ground collider locked to exact world ground height (sidewalks, dunes, pier!)
        const hPos = r.limbs[0].body.translation();
        const gY = getGroundHeight(hPos.x, hPos.z);
        if (r.groundColliderBody) {
          r.groundColliderBody.setNextKinematicTranslation({ x: hPos.x, y: gY - 0.5, z: hPos.z });
        }
      }
    }

    if (anyPhysicsRagdoll) {
      this.accum += safeDt;
      let steps = 0;
      while (this.accum >= FIXED_STEP && steps < 3) {
        this.world.step();
        this.accum -= FIXED_STEP;
        steps++;
      }
    } else {
      this.accum = 0;
    }

    const finishedIds: string[] = [];

    for (const [id, r] of this.ragdolls) {
      r.elapsed += safeDt;

      if (r.phase === 'ragdoll') {
        this.syncRagdollBonesToSkeleton(r);

        const hipsVel = r.limbs[0].body.linvel();
        const chestVel = r.limbs[1].body.linvel();
        const speed =
          Math.hypot(hipsVel.x, hipsVel.y, hipsVel.z) +
          Math.hypot(chestVel.x, chestVel.y, chestVel.z);

        const groundY = getGroundHeight(r.lastHipsWorld.x, r.lastHipsWorld.z);
        const nearGround = r.lastHipsWorld.y < groundY + 0.55;

        if (nearGround && speed < 0.75) {
          r.settleTimer += safeDt;
        } else {
          r.settleTimer = Math.max(0, r.settleTimer - safeDt * 0.5);
        }

        const settleNeeded = r.isPlayer ? 0.55 : 1.05;
        const maxRagdollTime = r.isPlayer ? 2.6 : 4.2;
        if (r.settleTimer >= settleNeeded || r.elapsed >= maxRagdollTime) {
          this.transitionToPhysicalGetUp(r);
        }
      } else if (r.phase === 'getup') {
        r.getUpElapsed += safeDt;
        const done = this.updatePhysicalGetUp(r);
        if (done) {
          finishedIds.push(id);
        }
      }
    }

    for (const id of finishedIds) {
      this.destroyRagdoll(id);
    }
  }

  /**
   * Drives the Three.js SkinnedMesh skeleton directly from Rapier's 11 rigid bodies
   * in strict parent-to-child hierarchy order so every limb bends & sprawls authentically!
   */
  private syncRagdollBonesToSkeleton(r: ActiveRagdoll): void {
    const hipsBinding = r.limbs[0];
    const ht = hipsBinding.body.translation();
    const gY = getGroundHeight(ht.x, ht.z);
    // Clamp lowest pelvis slightly above terrain so clothing never dips below pavement
    const clampedY = Math.max(ht.y, gY + 0.12);
    r.lastHipsWorld.set(ht.x, clampedY, ht.z);

    // Keep entityRoot anchored right under the ragdoll's pelvis on the ground
    r.entityRoot.position.set(ht.x, gY, ht.z);
    r.entityRoot.updateMatrixWorld(true);

    // Place Hips bone at exact Rapier pelvis world position
    _vA.set(ht.x, clampedY, ht.z);
    r.armature.worldToLocal(_vA);
    r.hipsBone.position.copy(_vA);

    // Reset intermediate spine/clavicle/neck bones to rest pose so Rapier's chest/arm/head bodies drive cleanly
    const restMap = this.restPoseCache.get(r.id);
    if (restMap) {
      for (const inter of ['Spine', 'Spine1', 'Neck', 'LeftShoulder', 'RightShoulder']) {
        const b = r.avatarRoot.getObjectByName(inter);
        const q = restMap.get(inter);
        if (b && q) b.quaternion.copy(q);
      }
    }

    // Apply Rapier body world rotations in strict parent->child order WITH anatomical limits & active muscle tone!
    // This keeps GTA-style realistic body cohesion so necks, spines, elbows, and knees NEVER look broken!
    for (const limb of r.limbs) {
      const rot = limb.body.rotation();
      _qBody.set(rot.x, rot.y, rot.z, rot.w);
      if (limb.bone.parent) {
        limb.bone.parent.updateMatrixWorld(true);
        limb.bone.parent.getWorldQuaternion(_qParentWorld);
        limb.bone.quaternion.copy(_qParentWorld).invert().multiply(_qBody).multiply(limb.qOffset);

        const limits = ANATOMICAL_LIMITS[limb.key];
        const restQ = restMap?.get(limb.key);
        if (limits && restQ) {
          // Measure local rotation relative to anatomical rest pose and strictly clamp to living-human range!
          _qRel.copy(restQ).invert().multiply(limb.bone.quaternion);
          _eul.setFromQuaternion(_qRel, 'XYZ');
          _eul.x = clamp(_eul.x, limits.minX, limits.maxX);
          _eul.y = clamp(_eul.y, limits.minY, limits.maxY);
          _eul.z = clamp(_eul.z, limits.minZ, limits.maxZ);
          _qTmp.setFromEuler(_eul);
          limb.bone.quaternion.copy(restQ).multiply(_qTmp);
          // Subtle living-muscle tone pulls extreme limb sprawl gently toward natural defensive posture
          limb.bone.quaternion.slerp(restQ, limits.muscleTone);
        }

        limb.bone.updateMatrixWorld(false);
      }
    }
  }

  /**
   * Snapshots the exact sprawled ragdoll bone pose, detects prone vs supine orientation,
   * tears down the Rapier rigid bodies, and begins the 3-stage physical get-up sequence!
   */
  private transitionToPhysicalGetUp(r: ActiveRagdoll): void {
    // Determine facing direction on the ground from Hips -> Head vector
    const headBone = r.avatarRoot.getObjectByName('Head');
    const spine2Bone = r.avatarRoot.getObjectByName('Spine2');
    const pHips = r.hipsBone.getWorldPosition(new THREE.Vector3());
    const pHead = headBone ? headBone.getWorldPosition(new THREE.Vector3()) : pHips.clone().add(new THREE.Vector3(0, 0, -1));

    // Check if torso front (local +Z on RPM Spine2) points downward (prone) or upward (supine)
    let facingDown = true;
    if (spine2Bone) {
      spine2Bone.getWorldQuaternion(_qBoneWorld);
      const torsoFrontWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(_qBoneWorld);
      facingDown = torsoFrontWorld.y < 0;
    }

    // Align standing yaw to where their head/body is pointing on the pavement
    const dirX = pHead.x - pHips.x;
    const dirZ = pHead.z - pHips.z;
    const targetYaw =
      Math.hypot(dirX, dirZ) > 0.15
        ? wrapAngle(yawFromDir(facingDown ? dirX : -dirX, facingDown ? dirZ : -dirZ))
        : r.restingYaw;
    r.restingYaw = targetYaw;

    // Re-orient entityRoot to targetYaw while preserving the EXACT world bone transforms of the sprawled ragdoll!
    const groundY = getGroundHeight(pHips.x, pHips.z);
    const savedWorldQuats = new Map<string, THREE.Quaternion>();
    for (const name of TRACKED_BONES) {
      const b = r.avatarRoot.getObjectByName(name);
      if (b) savedWorldQuats.set(name, b.getWorldQuaternion(new THREE.Quaternion()));
    }

    r.entityRoot.position.set(pHips.x, groundY, pHips.z);
    r.entityRoot.rotation.set(0, -targetYaw, 0);
    r.entityRoot.updateMatrixWorld(true);

    // Recompute local Hips pos & all local bone quaternions in the new entityRoot yaw frame -> ZERO visual pop!
    const hipsLocal = r.armature.worldToLocal(pHips.clone());
    r.hipsBone.position.copy(hipsLocal);
    const snapQuats = new Map<string, THREE.Quaternion>();
    for (const name of TRACKED_BONES) {
      const b = r.avatarRoot.getObjectByName(name);
      const wq = savedWorldQuats.get(name);
      if (b && wq && b.parent) {
        b.parent.updateMatrixWorld(true);
        b.parent.getWorldQuaternion(_qParentWorld);
        b.quaternion.copy(_qParentWorld).invert().multiply(wq);
        b.updateMatrixWorld(false);
        snapQuats.set(name, b.quaternion.clone());
      }
    }

    // Free Rapier bodies immediately now that ragdoll has settled
    for (const j of r.joints) this.world.removeImpulseJoint(j, true);
    for (const limb of r.limbs) this.world.removeRigidBody(limb.body);
    if (r.groundColliderBody) this.world.removeRigidBody(r.groundColliderBody);
    r.joints = [];
    r.limbs = [];
    r.groundColliderBody = null;

    const restQuats = this.restPoseCache.get(r.id) ?? new Map<string, THREE.Quaternion>();
    r.getUp = {
      hipsPos: hipsLocal.clone(),
      boneQuats: snapQuats,
      targetYaw,
      facingDown,
      groundY,
      standingHipsLocalY: r.savedHipsLocalPos.y,
      restQuats,
    };
    r.phase = 'getup';
    r.getUpElapsed = 0;
  }

  /**
   * Evaluates a 3-stage anatomically articulated physical get-up:
   *   Stage 1 (0.00 -> 0.36): Push onto hands & knees from exact sprawled pose (hips 0.18m -> 0.42m)
   *   Stage 2 (0.36 -> 0.72): Plant lead foot & push up into deep one-knee crouch (hips 0.42m -> 0.68m)
   *   Stage 3 (0.72 -> 1.00): Straighten legs & spine smoothly into standing upright posture!
   */
  private updatePhysicalGetUp(r: ActiveRagdoll): boolean {
    const gu = r.getUp;
    if (!gu) return true;

    const u = clamp(r.getUpElapsed / r.getUpDuration, 0, 1);
    const scaleY = Math.max(0.5, r.savedAvatarScale.y);
    const standY = gu.standingHipsLocalY;

    // Build target keyframe offset euler rotations (added onto restQuats in RPM's verified local axes!)
    // Verified RPM axes:
    //   Hips / Spine: +X tilts forward (prone), -X tilts back
    //   LeftUpLeg / RightUpLeg: +X swings thigh forward (hip flexion)
    //   LeftLeg / RightLeg: -X bends knee backward (heel toward butt)
    const getPoseAtStage = (stage: 'kneel' | 'crouch' | 'stand', boneName: string, out: THREE.Quaternion) => {
      const base = gu.restQuats.get(boneName);
      if (base) out.copy(base);
      else out.identity();

      if (stage === 'stand') return;

      if (stage === 'kneel') {
        // Stage 1: Hands-and-knees push-up posture!
        switch (boneName) {
          case 'Hips':
            _eul.set(1.18, 0, 0);
            break;
          case 'Spine':
            _eul.set(-0.22, 0, 0);
            break;
          case 'Spine2':
            _eul.set(-0.28, 0, 0);
            break;
          case 'Head':
            _eul.set(-0.55, 0, 0);
            break;
          case 'LeftUpLeg':
            _eul.set(1.22, 0, 0.08);
            break;
          case 'LeftLeg':
            _eul.set(-1.95, 0, 0);
            break;
          case 'RightUpLeg':
            _eul.set(1.15, 0, -0.08);
            break;
          case 'RightLeg':
            _eul.set(-1.85, 0, 0);
            break;
          case 'LeftArm':
            _eul.set(0.35, 0, -0.75);
            break;
          case 'LeftForeArm':
            _eul.set(0.25, 0, 0.35);
            break;
          case 'RightArm':
            _eul.set(0.35, 0, 0.75);
            break;
          case 'RightForeArm':
            _eul.set(0.25, 0, -0.35);
            break;
          default:
            return;
        }
        _qTmp.setFromEuler(_eul);
        out.multiply(_qTmp);
        return;
      }

      if (stage === 'crouch') {
        // Stage 2: One-knee / low athletic lunge push-up off front knee!
        switch (boneName) {
          case 'Hips':
            _eul.set(0.48, 0.08, 0);
            break;
          case 'Spine':
            _eul.set(0.18, 0, 0);
            break;
          case 'Spine2':
            _eul.set(0.12, 0, 0);
            break;
          case 'Head':
            _eul.set(-0.42, 0, 0);
            break;
          case 'LeftUpLeg':
            _eul.set(1.28, 0, 0.06);
            break;
          case 'LeftLeg':
            _eul.set(-1.32, 0, 0);
            break;
          case 'RightUpLeg':
            _eul.set(0.45, 0, -0.06);
            break;
          case 'RightLeg':
            _eul.set(-1.25, 0, 0);
            break;
          case 'LeftArm':
            _eul.set(0.25, 0, -0.42);
            break;
          case 'LeftForeArm':
            _eul.set(0.15, 0, 0.45);
            break;
          case 'RightArm':
            _eul.set(0.2, 0, 0.45);
            break;
          case 'RightForeArm':
            _eul.set(0.15, 0, -0.38);
            break;
          default:
            return;
        }
        _qTmp.setFromEuler(_eul);
        out.multiply(_qTmp);
      }
    };

    const kneelHipsY = standY * 0.46;
    const crouchHipsY = standY * 0.72;
    let curY: number;
    let curX = 0;
    let curZ = 0;

    const qFrom = new THREE.Quaternion();
    const qTo = new THREE.Quaternion();

    if (u < 0.36) {
      const t = smoothstep01(u / 0.36);
      curY = THREE.MathUtils.lerp(gu.hipsPos.y, kneelHipsY, t);
      curX = THREE.MathUtils.lerp(gu.hipsPos.x, 0, t);
      curZ = THREE.MathUtils.lerp(gu.hipsPos.z, r.savedHipsLocalPos.z, t);
      for (const name of TRACKED_BONES) {
        const b = r.avatarRoot.getObjectByName(name);
        if (!b) continue;
        const startQ = gu.boneQuats.get(name) ?? b.quaternion;
        getPoseAtStage('kneel', name, qTo);
        b.quaternion.copy(startQ).slerp(qTo, t);
      }
    } else if (u < 0.72) {
      const t = smoothstep01((u - 0.36) / 0.36);
      curY = THREE.MathUtils.lerp(kneelHipsY, crouchHipsY, t);
      curZ = r.savedHipsLocalPos.z;
      for (const name of TRACKED_BONES) {
        const b = r.avatarRoot.getObjectByName(name);
        if (!b) continue;
        getPoseAtStage('kneel', name, qFrom);
        getPoseAtStage('crouch', name, qTo);
        b.quaternion.copy(qFrom).slerp(qTo, t);
      }
    } else {
      const t = smoothstep01((u - 0.72) / 0.28);
      curY = THREE.MathUtils.lerp(crouchHipsY, standY, t);
      curZ = r.savedHipsLocalPos.z;
      for (const name of TRACKED_BONES) {
        const b = r.avatarRoot.getObjectByName(name);
        if (!b) continue;
        getPoseAtStage('crouch', name, qFrom);
        getPoseAtStage('stand', name, qTo);
        b.quaternion.copy(qFrom).slerp(qTo, t);
      }
    }

    r.hipsBone.position.set(curX, curY, curZ);
    r.lastHipsWorld.set(r.entityRoot.position.x, gu.groundY + curY * scaleY, r.entityRoot.position.z);
    r.entityRoot.updateMatrixWorld(true);
    return u >= 1;
  }
}

export function buildImpactFromCarHit(
  carVx: number,
  carVz: number,
  carYaw: number,
  hitNx: number,
  hitNz: number,
  localX: number,
  isPlayer: boolean,
): RagdollImpactSpec {
  const carSpeed = Math.hypot(carVx, carVz);
  const speedFactor = clamp((carSpeed - 4) / 22, 0, 1);
  const right = rightFromYaw(carYaw);
  const fwd = forwardFromYaw(carYaw);
  const sideDeflect = (localX >= 0 ? 1 : -1) * (1.2 + speedFactor * 2.0);
  const scale = isPlayer ? 0.78 : 0.92;
  return {
    vx: carVx * scale + hitNx * (2.4 + speedFactor * 3.0) + right.x * sideDeflect + fwd.x * 0.8,
    vy: clamp(2.6 + carSpeed * 0.18, 2.8, isPlayer ? 6.4 : 7.8),
    vz: carVz * scale + hitNz * (2.4 + speedFactor * 3.0) + right.z * sideDeflect + fwd.z * 0.8,
    hitZone: 'bumper',
    sideOffset: clamp(localX, -1, 1),
  };
}
