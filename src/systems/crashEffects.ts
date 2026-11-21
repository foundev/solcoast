import * as THREE from 'three';

interface CrashSpark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
}

/**
 * Lightweight metallic crash-spark & hood-steam VFX pool triggered on real
 * car-to-car fender benders and high-speed wall scrapes.
 */
export class CrashEffectsSystem {
  private readonly scene: THREE.Scene;
  private readonly sparks: CrashSpark[] = [];
  private readonly sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.34);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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
      if (this.sparks.length >= 90) {
        const old = this.sparks.shift()!;
        this.scene.remove(old.mesh);
        old.mat.dispose();
      }
      const hot = i % 3 === 0 ? 0xfff5c2 : i % 3 === 1 ? 0xffb336 : 0xff621a;
      const mat = new THREE.MeshBasicMaterial({
        color: hot,
        transparent: true,
        opacity: 1.0,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.35,
        y + 0.45 + Math.random() * 0.4,
        z + (Math.random() - 0.5) * 0.35,
      );
      this.scene.add(mesh);

      const speed = 4 + Math.random() * Math.min(14, intensity * 0.85);
      const spreadX = nx + (Math.random() - 0.5) * 1.4;
      const spreadZ = nz + (Math.random() - 0.5) * 1.4;
      const sLen = Math.hypot(spreadX, spreadZ) || 1;
      const vx = (spreadX / sLen) * speed;
      const vy = 2.2 + Math.random() * 4.8;
      const vz = (spreadZ / sLen) * speed;

      mesh.lookAt(mesh.position.x + vx, mesh.position.y + vy, mesh.position.z + vz);

      this.sparks.push({
        mesh,
        mat,
        vx,
        vy,
        vz,
        age: 0,
        maxAge: 0.24 + Math.random() * 0.28,
      });
    }
  }

  public update(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.scene.remove(s.mesh);
        s.mat.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= 18 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.lookAt(
        s.mesh.position.x + s.vx,
        s.mesh.position.y + s.vy,
        s.mesh.position.z + s.vz,
      );
      s.mat.opacity = 1 - s.age / s.maxAge;
    }
  }
}
