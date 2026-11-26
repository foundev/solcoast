import * as THREE from 'three';

interface CrashSpark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  colorHex: number;
}

const MAX_SPARKS = 90;

/**
 * Single-draw-call instanced metallic crash-spark VFX pool triggered on real
 * car-to-car fender benders and high-speed wall scrapes (zero runtime mesh/material allocations!).
 */
export class CrashEffectsSystem {
  private readonly sparks: CrashSpark[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.34);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.inst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    this.inst.visible = false;
    scene.add(this.inst);
  }

  public spawnSparks(
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    intensity: number,
  ): void {
    const count = Math.min(18, Math.max(5, Math.round(intensity * 1.1)));
    for (let i = 0; i < count; i++) {
      const hot = i % 3 === 0 ? 0xfff5c2 : i % 3 === 1 ? 0xffb336 : 0xff621a;
      const speed = 4 + Math.random() * Math.min(14, intensity * 0.85);
      const spreadX = nx + (Math.random() - 0.5) * 1.4;
      const spreadZ = nz + (Math.random() - 0.5) * 1.4;
      const sLen = Math.hypot(spreadX, spreadZ) || 1;
      const vx = (spreadX / sLen) * speed;
      const vy = 2.2 + Math.random() * 4.8;
      const vz = (spreadZ / sLen) * speed;

      const sx = x + (Math.random() - 0.5) * 0.35;
      const sy = y + 0.45 + Math.random() * 0.4;
      const sz = z + (Math.random() - 0.5) * 0.35;
      const maxAge = 0.24 + Math.random() * 0.28;

      if (this.sparks.length >= MAX_SPARKS) {
        const reused = this.sparks.shift()!;
        reused.x = sx;
        reused.y = sy;
        reused.z = sz;
        reused.vx = vx;
        reused.vy = vy;
        reused.vz = vz;
        reused.age = 0;
        reused.maxAge = maxAge;
        reused.colorHex = hot;
        this.sparks.push(reused);
      } else {
        this.sparks.push({ x: sx, y: sy, z: sz, vx, vy, vz, age: 0, maxAge, colorHex: hot });
      }
    }
  }

  public update(dt: number): void {
    if (this.sparks.length === 0) {
      if (this.inst.visible) {
        this.inst.count = 0;
        this.inst.visible = false;
      }
      return;
    }

    const dummy = this.dummy;
    const tmpColor = this.tmpColor;
    let outIdx = 0;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= 18 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;

      const fade = 1 - s.age / s.maxAge;
      dummy.position.set(s.x, s.y, s.z);
      dummy.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      dummy.scale.set(fade, fade, 0.45 + fade * 0.55);
      dummy.updateMatrix();
      this.inst.setMatrixAt(outIdx, dummy.matrix);
      tmpColor.setHex(s.colorHex).multiplyScalar(fade);
      this.inst.setColorAt(outIdx, tmpColor);
      outIdx++;
    }

    this.inst.count = outIdx;
    this.inst.visible = outIdx > 0;
    if (outIdx > 0) {
      this.inst.instanceMatrix.needsUpdate = true;
      if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
    }
  }
}
